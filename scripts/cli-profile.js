import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const probe = fileURLToPath(new URL('./cli-profile-probe.js', import.meta.url));
function sourceIdentity(entrypoint) {
  const root = path.dirname(path.dirname(entrypoint)), files = [];
  function walk(directory, depth = 0) {
    if (depth > 8) throw new Error('Source depth budget exceeded');
    for (const item of fs.readdirSync(directory, {withFileTypes: true})) {
      const full = path.join(directory, item.name);
      if (item.isSymbolicLink()) throw new Error('Source identity rejects symlinks');
      if (item.isDirectory()) walk(full, depth + 1);
      else if (item.isFile()) {
        const size = fs.statSync(full).size;
        if (size > 4 * 1024 * 1024 || files.length >= 256) throw new Error('Source identity budget exceeded');
        files.push({file: path.relative(root, full).split(path.sep).join('/'), sha256: hash(fs.readFileSync(full))});
      }
    }
  }
  walk(path.join(root, 'src'));
  for (const file of ['package.json', 'package-lock.json']) if (fs.existsSync(path.join(root, file))) {
    if (!fs.lstatSync(path.join(root, file)).isFile() || fs.statSync(path.join(root, file)).size > 4 * 1024 * 1024) throw new Error('Source metadata identity budget exceeded');
    files.push({file, sha256: hash(fs.readFileSync(path.join(root, file)))});
  }
  files.sort((a, b) => a.file.localeCompare(b.file));
  return {files, digest: hash(JSON.stringify(files))};
}
/** Outer process spans, with separate instrumentation. No cache deletion or installs. */
export function profileCli({entrypoints, root, args, repetitions = 3, expectedExit = 0, timeoutMs = 30000, output}) {
  if (!Array.isArray(entrypoints) || !entrypoints.length || entrypoints.length > 4 || entrypoints.some(row => !row || !/^[a-z0-9-]{1,40}$/.test(row.id) || typeof row.path !== 'string')) throw new Error('Provide one to four identified entrypoints');
  if (new Set(entrypoints.map(row => row.id)).size !== entrypoints.length) throw new Error('Entrypoint IDs must be unique');
  if (!Array.isArray(args) || args.length > 50 || args.some(value => typeof value !== 'string' || value.length > 4096 || value.includes('\0'))) throw new Error('Arguments exceed diagnostic budget');
  if (!Number.isSafeInteger(repetitions) || repetitions < 1 || repetitions > 20) throw new Error('Repetitions must be 1–20');
  if (!Number.isSafeInteger(expectedExit) || expectedExit < 0 || expectedExit > 255) throw new Error('Expected exit must be 0–255');
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120000) throw new Error('Timeout must be 1–120000 ms');
  root = fs.realpathSync(root); output = path.resolve(output);
  if (output === root || output.startsWith(root + path.sep) && !path.relative(root, output).startsWith('.tddswarm' + path.sep)) throw new Error('Inside-project output must be under ignored .tddswarm');
  const sources = entrypoints.map(row => ({...row, path: fs.realpathSync(row.path)}));
  const before = sources.map(row => ({id: row.id, ...sourceIdentity(row.path)}));
  const node = {version: process.version, executableSha256: hash(fs.readFileSync(process.execPath))};
  fs.mkdirSync(output, {recursive: false, mode: 0o700});
  const env = {...process.env}; delete env.NODE_TEST_CONTEXT; delete env.TESTLORE_CLI_PROFILE_TRACE;
  const samples = [], diagnostics = [];
  function execute(row, repetition, diagnostic = false) {
    const label = `${row.id}-${diagnostic ? 'diagnostic' : repetition}`, trace = path.join(output, label + '-trace.json');
    const argv = diagnostic ? ['--import', probe, row.path, ...args] : [row.path, ...args];
    const started = performance.now();
    const result = spawnSync(process.execPath, argv, {cwd: root, env: diagnostic ? {...env, TESTLORE_CLI_PROFILE_TRACE: trace} : env,
      encoding: 'utf8', timeout: timeoutMs, killSignal: 'SIGKILL', detached: process.platform !== 'win32', maxBuffer: 8 * 1024 * 1024, shell: false});
    // Bound child workers together with the CLI on POSIX; retain timeout receipts.
    if (process.platform !== 'win32' && result.pid) {try {process.kill(-result.pid, 'SIGKILL');} catch {}}
    const durationMs = performance.now() - started;
    fs.writeFileSync(path.join(output, label + '.stdout'), result.stdout || '', {flag: 'wx', mode: 0o600});
    fs.writeFileSync(path.join(output, label + '.stderr'), result.stderr || '', {flag: 'wx', mode: 0o600});
    let reportedSpans = null, traceComplete = false;
    try {
      const value = JSON.parse(result.stdout);
      reportedSpans = {timings: value.timings || null, planningPhases: value.plan?.timings || null};
    } catch {}
    if (diagnostic && fs.existsSync(trace) && fs.statSync(trace).size <= 2 * 1024 * 1024) {
      try {const value = JSON.parse(fs.readFileSync(trace)); traceComplete = value.kind === 'cli-diagnostic-profile' && value.truncated === false && value.processes.every(row => row.method !== 'spawn' || row.complete === true);} catch {}
    }
    return {id: row.id, repetition, durationMs, reportedSpans, exitCode: result.status, signal: result.signal || null, error: result.error?.code || null,
      stdoutSha256: hash(result.stdout || ''), stderrSha256: hash(result.stderr || ''), expectedExit, matchedExit: !result.error && result.status === expectedExit,
      ...(diagnostic ? {traceComplete, tracePresent: fs.existsSync(trace), traceSha256: fs.existsSync(trace) ? hash(fs.readFileSync(trace)) : null} : {})};
  }
  for (let repetition = 0; repetition < repetitions; repetition++) {
    // Rotate order. Every arm remains a fresh Node/CLI process and native context.
    const ordered = [...sources.slice(repetition % sources.length), ...sources.slice(0, repetition % sources.length)];
    for (const row of ordered) samples.push(execute(row, repetition));
  }
  for (const row of sources) diagnostics.push(execute(row, null, true));
  let after = [], identityError = null;
  try {after = sources.map(row => ({id: row.id, ...sourceIdentity(row.path)}));} catch (error) {identityError = String(error.message).slice(0, 1000);}
  const sourceUnchanged = !identityError && before.every((row, index) => row.digest === after[index]?.digest);
  const summary = {schemaVersion: 1, kind: 'cli-outer-span-profile', complete: sourceUnchanged && samples.every(row => row.matchedExit) && diagnostics.every(row => row.matchedExit && row.traceComplete),
    root, args, expectedExit, timeoutMs, repetitions, node, sourceBefore: before, sourceAfter: after, sourceUnchanged, identityError,
    profilerSha256: hash(fs.readFileSync(fileURLToPath(import.meta.url))), probeSha256: hash(fs.readFileSync(probe)), samples, diagnostics,
    scope: 'Uninstrumented complete Node/CLI process spans; import, Git and hash diagnostics are separately instrumented.',
    limitations: ['No fully cold OS or dependency-cache claim; observed cache state is uncontrolled.',
      'Commands execute configured project code when their ordinary CLI semantics require it.',
      'Exit matching and source stability alone do not establish case parity, dependency completeness or failure preservation.',
      'Source identity excludes installed dependency bytes and project inputs; a qualification controller must independently seal those.']};
  fs.writeFileSync(path.join(output, 'summary.json'), JSON.stringify(summary, null, 2), {flag: 'wx', mode: 0o600});
  return summary;
}
if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) {
  try {
    if (process.argv.length !== 3) throw new Error('Usage: node scripts/cli-profile.js private-profile-settings.json');
    const configPath = path.resolve(process.argv[2]);
    if (fs.statSync(configPath).size > 64 * 1024) throw new Error('Settings exceed 64 KiB');
    const summary = profileCli(JSON.parse(fs.readFileSync(configPath, 'utf8')));
    console.log(JSON.stringify({complete: summary.complete, sourceUnchanged: summary.sourceUnchanged, samples: summary.samples.map(({id, repetition, durationMs, exitCode}) => ({id, repetition, durationMs, exitCode}))}, null, 2));
    process.exitCode = summary.complete ? 0 : 1;
  } catch (error) {console.error(error.message); process.exitCode = 2;}
}
