import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { listFiles, TEST, normalize, safePath } from './files.js';

const reporter = fileURLToPath(new URL('./reporters/node.js', import.meta.url));
export function adapterFor(config = {}) {
  if (config.adapter) return config.adapter;
  const argv = config.runner || ['node', '--test', '{files}'];
  if (argv.some(x => /(?:^|[/\\])vitest(?:\.mjs)?$/.test(x))) return 'vitest';
  if (argv.some(x => /(?:^|[/\\])jest(?:\.js)?$/.test(x))) return 'jest';
  return argv.includes('--test') ? 'node' : 'custom';
}
function environment(config) {
  const env = { ...process.env, ...config.env };
  delete env.NODE_TEST_CONTEXT;
  return env;
}
function spawn(root, command, config, options = {}) {
  return spawnSync(command[0], command.slice(1), {
    cwd: root, env: environment(config), shell: false, encoding: 'utf8',
    stdio: 'pipe', maxBuffer: 64 * 1024 * 1024,
    timeout: options.timeoutMs ?? config.runnerTimeoutMs ?? 120000
  });
}
function localFile(root, file) {
  if (typeof file !== 'string') throw new Error('Runner reported a non-string file');
  const base = fs.realpathSync(root);
  const absolute = path.isAbsolute(file) && fs.existsSync(file) ? fs.realpathSync(file) : file;
  const relative = normalize(path.isAbsolute(absolute) ? path.relative(base, absolute) : absolute);
  safePath(root, relative);
  return relative;
}
function commandBase(config, adapter) {
  const argv = config.runner || (adapter === 'jest' ? ['jest', '{files}'] : adapter === 'vitest' ? ['vitest', 'run', '{files}'] : ['node', '--test', '{files}']);
  if (!Array.isArray(argv) || !argv.length || argv.some(x => typeof x !== 'string' || !x)) throw new Error('runner must be a nonempty argv array');
  return argv;
}
function withoutFiles(command) { return command.filter(x => x !== '{files}'); }
function frameworkBase(command, adapter) {
  const argv = withoutFiles(command);
  if (adapter === 'vitest') {
    const index = argv.findIndex(x => /(?:^|[/\\])vitest(?:\.mjs)?$/.test(x));
    if (['run', 'list', 'watch', 'related'].includes(argv[index + 1])) argv.splice(index + 1, 1);
  }
  return argv;
}
function nodeCommand(base, report, files, discovery = false) {
  // Retain runtime/preload settings but own reporters so completeness is verifiable.
  const command = [];
  for (let i = 0; i < base.length; i++) {
    const arg = base[i];
    if (arg === '{files}') continue;
    if (/^--test-reporter(?:-destination)?=/.test(arg)) continue;
    if (['--test-reporter', '--test-reporter-destination'].includes(arg)) { i++; continue; }
    command.push(arg);
  }
  command.push(`--test-reporter=${reporter}`, `--test-reporter-destination=${report}`);
  if (discovery) command.push('--test-name-pattern=(?!)');
  else command.push(...files.map(f => './' + f));
  return command;
}
function nodeEvents(root, text) {
  const events = text.split('\n').filter(x => x.startsWith('@tddswarm:')).map(x => JSON.parse(x.slice(10)));
  const collectionFiles = new Set();
  const names = new Map();
  const hierarchy = new Map();
  let stdout = '', stderr = '';
  const tests = [];
  let summary = false;
  let summaryCounts;
  for (const { type, data } of events) {
    if (type === 'test:stdout') stdout += data.message || '';
    if (type === 'test:stderr') stderr += data.message || '';
    let file;
    try { if (data.file) file = localFile(root, data.file); } catch { continue; }
    if (type === 'test:summary' && !data.file) { summary = true; summaryCounts = data.counts; }
    if (file) collectionFiles.add(file);
    if (type === 'test:enqueue' && file) {
      const ancestors = hierarchy.get(file) || [];
      ancestors[data.nesting || 0] = data.name;
      ancestors.length = (data.nesting || 0) + 1;
      hierarchy.set(file, ancestors);
      names.set(`${file}:${data.line}:${data.column}:${data.nesting}`, ancestors.join(' > '));
    }
    if (!['test:pass', 'test:fail'].includes(type) || !file || data.details?.type === 'suite') continue;
    // Synthetic file wrappers are useful collection evidence but aren't cases.
    if (data.name === path.join(root, file) || data.name === file) {
      if (type === 'test:fail') tests.push({ file, name: '<file-load>', status: 'failed', durationMs: data.details?.duration_ms || 0, line: 0, column: 0 });
      continue;
    }
    tests.push({ file, name: names.get(`${file}:${data.line}:${data.column}:${data.nesting}`) || data.name, status: data.skip || data.todo ? 'skipped' : type === 'test:pass' ? 'passed' : 'failed', durationMs: data.details?.duration_ms || 0, line: data.line, column: data.column });
  }
  // Native counts include synthetic empty/load files. Named case counts may be
  // lower, but they must never exceed what the terminal summary acknowledges.
  const validCounts = Number.isInteger(summaryCounts?.tests) && tests.length <= summaryCounts.tests;
  return { tests, collectionFiles: [...collectionFiles].sort(), valid: summary && validCounts, errors: [], stdout, stderr };
}
function frameworkResults(root, value) {
  if (!value || !Array.isArray(value.testResults)) throw new Error('Missing testResults in runner report');
  const tests = [];
  const collectionFiles = [];
  for (const suite of value.testResults) {
    const file = localFile(root, suite.name || suite.testFilePath);
    collectionFiles.push(file);
    if (!Array.isArray(suite.assertionResults)) throw new Error('Missing assertionResults in runner report');
    for (const assertion of suite.assertionResults) {
      const status = ['pending', 'todo', 'disabled', 'skipped'].includes(assertion.status) ? 'skipped' : assertion.status;
      if (!['passed', 'failed', 'skipped'].includes(status)) throw new Error(`Unknown case status: ${status}`);
      tests.push({ file, name: assertion.fullName || [...(assertion.ancestorTitles || []), assertion.title].join(' '), status, durationMs: assertion.duration ?? 0 });
    }
    if (suite.status === 'failed' && !suite.assertionResults.some(t => t.status === 'failed')) {
      tests.push({ file, name: '<file-load>', status: 'failed', durationMs: 0 });
    }
  }
  const errors = (value.testExecError ? [value.testExecError] : []).concat(value.numRuntimeErrorTestSuites ? ['runtime-error-test-suites'] : []);
  return { tests, collectionFiles: [...new Set(collectionFiles)].sort(), valid: typeof value.success === 'boolean' && (!Number.isInteger(value.numTotalTests) || value.numTotalTests === tests.filter(t => t.name !== '<file-load>').length), errors };
}
function identities(tests) {
  const counts = new Map();
  return tests.map(test => {
    const key = `${test.file}\0${test.name}\0${test.line || ''}\0${test.column || ''}`;
    const ordinal = counts.get(key) || 0; counts.set(key, ordinal + 1);
    return { ...test, id: createHash('sha256').update(key + '\0' + ordinal).digest('hex') };
  });
}

/** Execute exact requested files. Unsupported runners never certify report completeness. */
export function execute(root, files, config = {}, options = {}) {
  root = path.resolve(root);
  files = [...new Set(files.map(file => localFile(root, file)))].sort();
  const adapter = adapterFor(config);
  if (!files.length) return { adapter, exitCode: 0, tests: [], collectionFiles: [], requestedFiles: [], executedFiles: [], complete: true, durationMs: 0, command: [], stdout: '', stderr: '' };
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'tddswarm-report-'));
  const reportFile = path.join(temporary, 'results.json');
  const base = commandBase(config, adapter);
  let command;
  if (adapter === 'node') command = nodeCommand(base, reportFile, files);
  else if (adapter === 'jest') command = [...frameworkBase(base, adapter), '--runTestsByPath', '--watch=false', '--json', `--outputFile=${reportFile}`, ...files.map(f => './' + f)];
  else if (adapter === 'vitest') command = [...frameworkBase(base, adapter), 'run', '--reporter=json', `--outputFile=${reportFile}`, ...files.map(f => './' + f)];
  else command = base.flatMap(x => x === '{files}' ? files.map(f => './' + f) : [x]);
  const start = performance.now();
  const result = spawn(root, command, config, options);
  let normalized = { tests: [], collectionFiles: [], valid: false, errors: [] };
  let reportError;
  try {
    if (adapter === 'node') normalized = nodeEvents(root, fs.readFileSync(reportFile, 'utf8'));
    else if (['jest', 'vitest'].includes(adapter)) normalized = frameworkResults(root, JSON.parse(fs.readFileSync(reportFile, 'utf8')));

  } catch (error) { reportError = error.message; }
  finally { fs.rmSync(temporary, { recursive: true, force: true }); }
  const missingFiles = files.filter(f => !normalized.collectionFiles.includes(f));
  const unknownFiles = normalized.collectionFiles.filter(f => !files.includes(f));
  const complete = normalized.valid && !result.error && !result.signal && !missingFiles.length && !unknownFiles.length && !normalized.errors.length;
  const tests = identities(normalized.tests);
  // A success exit without a valid supported report is an execution failure.
  const unreportedSuccess = result.status === 0 && adapter !== 'custom' && !complete;
  const exitCode = unreportedSuccess ? 2 : result.status ?? 1;
  const stdout = (result.stdout || '') + (normalized.stdout || '');
  const stderr = (result.stderr || '') + (normalized.stderr || '');
  if (!options.capture) {
    if (stdout) process.stdout.write(stdout);
    if (stderr) process.stderr.write(stderr);
  }
  return { adapter, exitCode, durationMs: Math.round(performance.now() - start), tests, collectionFiles: normalized.collectionFiles,
    requestedFiles: files, executedFiles: files, missingFiles, unknownFiles, complete,
    command, stdout, stderr, signal: result.signal,
    error: result.error?.message || (unreportedSuccess ? 'Runner report is incomplete; successful execution cannot be verified.' : reportError), reportErrors: normalized.errors };
}

/** Native discovery can evaluate module top-level code. It never writes run history. */
export function discover(root, config = {}) {
  root = path.resolve(root);
  const adapter = adapterFor(config);
  const fallback = () => listFiles(root).filter(f => TEST.test(f));
  if (config.discovery !== 'native' && !Array.isArray(config.discovery)) return { files: fallback(), complete: true, adapter: 'filesystem', warnings: [] };
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'tddswarm-discovery-'));
  const reportFile = path.join(temporary, 'files.json');
  let result;
  try {
    let command;
    if (Array.isArray(config.discovery)) command = config.discovery;
    else if (adapter === 'node') command = nodeCommand(commandBase(config, adapter), reportFile, [], true);
    else if (adapter === 'jest') command = [...frameworkBase(commandBase(config, adapter), adapter), '--listTests', '--json', '--watch=false'];
    else if (adapter === 'vitest') command = [...frameworkBase(commandBase(config, adapter), adapter), 'list', '--filesOnly', `--json=${reportFile}`];
    else throw new Error('Custom native discovery requires a discovery argv array');
    result = spawn(root, command, config);
    if (result.error || result.status !== 0) throw new Error(result.error?.message || result.stderr || `Discovery exited ${result.status}`);
    let files, complete = true;
    if (Array.isArray(config.discovery)) {
      const value = JSON.parse(result.stdout);
      if (!Array.isArray(value.files) || typeof value.complete !== 'boolean') throw new Error('Custom discovery must output {files: string[], complete: boolean}');
      files = value.files; complete = value.complete;
    } else if (adapter === 'node') {
      const report = nodeEvents(root, fs.readFileSync(reportFile, 'utf8'));
      files = report.collectionFiles; complete = report.valid;
    } else {
      const value = JSON.parse(adapter === 'vitest' ? fs.readFileSync(reportFile, 'utf8') : result.stdout);
      if (!Array.isArray(value)) throw new Error('Native discovery report must be a file array');
      files = value.map(file => typeof file === 'string' ? file : file.filepath || file.file);
    }
    files = [...new Set(files.map(file => localFile(root, file)))].sort();
    for (const file of files) if (!fs.statSync(safePath(root, file)).isFile()) throw new Error(`Discovered file is missing: ${file}`);
    return { files, complete, adapter, warnings: complete ? [] : ['native-discovery-incomplete'] };
  } catch (error) {
    return { files: fallback(), complete: false, adapter, warnings: [`native-discovery-failed:${error.message.trim().slice(0, 500)}`] };
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
}

const resolverCache = new Map();
function resolutionStamp(root, config) {
  const candidates = listFiles(root).filter(file => /(?:^|\/)(?:package(?:-lock)?\.json|[^/]*(?:jest|vite|vitest|babel|tsconfig)[^/]*\.(?:[cm]?[jt]s|json))$/.test(file));
  for (const arg of config.runner || []) {
    const explicit = arg.startsWith('--config=') ? arg.slice(9) : arg;
    try { const local = localFile(root, explicit); if (fs.statSync(safePath(root, local)).isFile()) candidates.push(local); } catch {}
  }
  const digest = createHash('sha256');
  for (const file of [...new Set(candidates)].sort()) digest.update(file).update(fs.readFileSync(safePath(root, file)));
  return digest.digest('hex');
}
/** Delegate alias/package resolution to the configured framework, returning local paths only. */
export function resolveNative(root, file, specifier, config = {}) {
  const adapter = adapterFor(config);
  if (!['jest', 'vitest'].includes(adapter)) return null;
  const key = JSON.stringify([path.resolve(root), file, specifier, config, resolutionStamp(root, config)]);
  if (resolverCache.has(key)) {
    const cached = resolverCache.get(key);
    try { if (fs.statSync(safePath(root, cached)).isFile()) return cached; } catch {}
    resolverCache.delete(key);
  }
  const request = { root: fs.realpathSync(root), file, specifier, adapter, command: frameworkBase(commandBase(config, adapter), adapter) };
  const script = fileURLToPath(new URL('./reporters/resolve.js', import.meta.url));
  const result = spawn(root, [process.execPath, script, JSON.stringify(request)], config);
  let resolved = null;
  try { if (result.status === 0) { const value = JSON.parse(result.stdout); if (value.file) resolved = localFile(root, value.file); } } catch {}
  // New modules may appear between plans; unresolved lookups must be retried.
  if (resolved) resolverCache.set(key, resolved);
  return resolved;
}
