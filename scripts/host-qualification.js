#!/usr/bin/env node
// Opt-in native subscription hosts. Never replaces a failed host with an SDK client.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawn, spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';

export function executableIdentity(filename) {
  const realpath = fs.realpathSync(filename), stat = fs.statSync(realpath);
  if (!stat.isFile() || stat.size > 512 * 1024 * 1024) throw new Error('Executable identity needs a regular file <=512 MiB');
  const hash = createHash('sha256'), descriptor = fs.openSync(realpath, 'r'), buffer = Buffer.alloc(1024 * 1024);
  let bytes = 0, length;
  try {while ((length = fs.readSync(descriptor, buffer, 0, buffer.length, null)) > 0) {
    bytes += length; if (bytes > 512 * 1024 * 1024) throw new Error('Executable grew beyond identity byte budget');
    hash.update(buffer.subarray(0, length));
  }} finally {fs.closeSync(descriptor);}
  return {path: path.resolve(filename), realpath, bytes: stat.size,
    sha256: hash.digest('hex')};
}

// Allow subscription login through the host's existing HOME; strip keys and provider routing.
// The harness never reads, copies or writes personal credentials/configuration.
export function safeHostEnvironment(input) {
  const allowed = /^(PATH|HOME|USER|LOGNAME|SHELL|LANG|LC_[A-Z_]+|TERM|TMPDIR|TEMP|TMP|CODEX_HOME|SSL_CERT_FILE|SSL_CERT_DIR|CLAUDE_CODE_OAUTH_TOKEN)$/;
  return Object.fromEntries(Object.entries(input).filter(([key]) => allowed.test(key)));
}

export function packageSnapshot(entrypoint) {
  const root = path.resolve(path.dirname(fs.realpathSync(entrypoint)), '..'), files = [];
  const walk = directory => {
    for (const item of fs.readdirSync(directory, {withFileTypes: true}).sort((a, b) => a.name.localeCompare(b.name))) {
      const filename = path.join(directory, item.name);
      if (item.isSymbolicLink()) throw new Error('Package source symlinks cannot be qualified');
      if (item.isDirectory()) walk(filename);
      else if (item.isFile()) files.push({file: path.relative(root, filename).split(path.sep).join('/'), ...executableIdentity(filename)});
      if (files.length > 5000) throw new Error('Package source inventory budget exceeded');
    }
  };
  walk(path.join(root, 'src')); files.push({file: 'package.json', ...executableIdentity(path.join(root, 'package.json'))});
  const digest = createHash('sha256').update(JSON.stringify(files.map(({file, sha256}) => ({file, sha256})))).digest('hex');
  return {root, sha256: digest, files};
}

function hostIdentityFor(filename, host) {
  const identity = executableIdentity(filename);
  if (host === 'codex' && identity.realpath.endsWith('/bin/codex.js')) {
    const target = `${process.arch === 'arm64' ? 'aarch64' : 'x86_64'}-${process.platform === 'darwin' ? 'apple-darwin' : process.platform === 'win32' ? 'pc-windows-msvc' : 'unknown-linux-musl'}`;
    const suffix = `${process.platform === 'darwin' ? 'darwin' : process.platform === 'win32' ? 'win32' : 'linux'}-${process.arch}`;
    const require = createRequire(identity.realpath);
    try {
      const metadata = require.resolve(`@openai/codex-${suffix}/package.json`);
      identity.nativeBinary = executableIdentity(path.join(path.dirname(metadata), 'vendor', target, 'bin', process.platform === 'win32' ? 'codex.exe' : 'codex'));
    } catch (error) {identity.nativeBinaryUnavailable = error.code || error.message;}
  }
  return identity;
}

export function hostEvents(host, stdout) {
  const events = [];
  for (const line of stdout.split('\n')) {try {events.push(JSON.parse(line));} catch {}}
  const result = events.findLast(row => row.type === 'result');
  const allowed = new Set(['mcp__testlore_readonly__testlore_brief', 'mcp__testlore_readonly__testlore_status',
    'mcp__testlore_execution__testlore_plan', 'mcp__testlore_execution__testlore_verify']);
  const unauthorized = events.flatMap(row => {
    if (row.item?.type === 'mcp_tool_call' && !['testlore_readonly', 'testlore_execution'].includes(row.item.server)) return [`unexpected-mcp-server:${row.item.server}`];
    if (['command_execution', 'file_change', 'web_search'].includes(row.item?.type)) return [`unexpected-host-tool:${row.item.type}`];
    return (row.message?.content || []).filter(item => item.type === 'tool_use' && !allowed.has(item.name)).map(item => `unexpected-host-tool:${item.name}`);
  });
  return {finalMessage: host === 'claude' ? result?.result || '' : '',
    model: events.find(row => row.type === 'system' && row.subtype === 'init')?.model || null,
    nativeApiRetriesObserved: events.filter(row => row.type === 'system' && row.subtype === 'api_retry').length,
    errors: [...unauthorized, ...events.flatMap(row => row.type === 'system' && row.subtype === 'api_retry'
      ? [{status: row.error_status, error: row.error, nativeRetryAttempt: row.attempt}]
      : row.type === 'error' ? [row.message || row.error] : row.item?.error ? [row.item.error] : row.is_error ? [row.errors || row.result || 'host-error'] : [])].slice(0, 8)};
}

export function assessHost({processResult, observed, finalMessage, entrypoint, hostErrors = []}) {
  const reasons = [];
  if (processResult.status !== 'completed' || processResult.exitCode !== 0)
    reasons.push(`host-${processResult.status}:${processResult.reason || processResult.exitCode}`);
  for (const error of hostErrors) reasons.push(`host-reported-error:${JSON.stringify(error).slice(0, 1000)}`);
  const readOnly = observed.find(row => row.mode === 'readonly'), execution = observed.find(row => row.mode === 'execution');
  for (const [mode, receipt, tools] of [['readonly', readOnly, ['testlore_brief', 'testlore_status']],
    ['execution', execution, ['testlore_brief', 'testlore_status', 'testlore_plan', 'testlore_verify']]]) {
    if (!receipt) {reasons.push(`${mode}-server-not-started`); continue;}
    if (receipt.entrypoint?.sha256 !== entrypoint.sha256) reasons.push(`${mode}-entrypoint-mismatch`);
    if (receipt.incomplete) reasons.push(`${mode}-observer-incomplete`);
    if (JSON.stringify([...(receipt.tools || [])].sort()) !== JSON.stringify([...tools].sort())) reasons.push(`${mode}-tool-surface-mismatch`);
  }
  const result = (receipt, name) => receipt?.calls?.find(row => row.name === name && row.result && !row.isError)?.result;
  const brief = result(readOnly, 'testlore_brief'), status = result(readOnly, 'testlore_status');
  const plan = result(execution, 'testlore_plan'), verify = result(execution, 'testlore_verify');
  if (JSON.stringify((readOnly?.calls || []).map(row => row.name)) !== JSON.stringify(['testlore_brief', 'testlore_status'])) reasons.push('default-tool-call-sequence-mismatch');
  if (JSON.stringify((execution?.calls || []).map(row => row.name)) !== JSON.stringify(['testlore_plan', 'testlore_verify'])) reasons.push('execution-tool-call-sequence-mismatch');
  const statusCall = readOnly?.calls?.find(row => row.name === 'testlore_status'), planCall = execution?.calls?.find(row => row.name === 'testlore_plan');
  if (statusCall?.respondedAt && planCall?.requestedAt && statusCall.respondedAt > planCall.requestedAt) reasons.push('execution-preceded-default-status');
  if (brief?.execution?.projectCommandsInvoked !== false || brief.authority !== 'advisory') reasons.push('default-brief-not-observed');
  if (status?.projectCommandsInvoked !== false || status.present !== false || status.reason !== 'no-retained-run') reasons.push('initial-status-not-observed');
  if (plan?.authority !== 'routing-proposal' || plan.complete !== true) reasons.push('native-plan-not-complete');
  if (verify?.verdict !== 'failed' || verify.complete !== true || verify.executed !== true || verify.outcomes?.failed !== 1)
    reasons.push('planted-failure-not-observed');
  const failure = verify?.failedCases?.find(row => row.file === 'test/fault.test.js');
  if (!failure?.id || failure.name !== 'independent value remains one') reasons.push('failed-case-identity-missing');
  if (JSON.stringify([...(verify?.executedFiles || [])].sort()) !== JSON.stringify(['test/fault.test.js', 'test/preserved.test.js'])) reasons.push('full-shadow-scope-not-observed');
  let summary;
  try {summary = JSON.parse(finalMessage.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '').trim());
    if (!summary || typeof summary !== 'object' || Array.isArray(summary)) throw new Error();
  } catch {summary = null; reasons.push('host-summary-not-json-object');}
  if (summary) {
    const caseTuples = rows => {
      if (!Array.isArray(rows) || rows.some(row => !row || typeof row !== 'object' || Array.isArray(row)
        || ['id', 'file', 'name'].some(key => typeof row[key] !== 'string' || !row[key].length))) return null;
      const tuples = rows.map(({id, file, name}) => JSON.stringify([id, file, name])).sort();
      return new Set(tuples).size === tuples.length ? JSON.stringify(tuples) : null;
    };
    const fileSet = rows => Array.isArray(rows) && rows.every(row => typeof row === 'string' && row.length)
      && new Set(rows).size === rows.length ? JSON.stringify([...rows].sort()) : null;
    const actualCases = caseTuples(verify?.failedCases), reportedCases = caseTuples(summary.failedCases);
    if (!actualCases || !reportedCases || reportedCases !== actualCases) reasons.push('host-summary-failure-identities-mismatch');
    const actualFiles = fileSet(verify?.executedFiles), reportedFiles = fileSet(summary.executedFiles);
    if (!actualFiles || !reportedFiles || reportedFiles !== actualFiles) reasons.push('host-summary-scope-mismatch');
    if (typeof summary.uncertainty !== 'string' || summary.uncertainty.length < 20) reasons.push('host-summary-uncertainty-missing');
    if (typeof summary.nextAction !== 'string' || summary.nextAction.length < 20) reasons.push('host-summary-next-action-missing');
    if (summary.verdict !== 'failed' || summary.deploymentSafety !== 'not-established') reasons.push('host-summary-overclaims-or-loses-failure');
  }
  return {qualified: reasons.length === 0, status: reasons.length ? 'not-qualified' : 'qualified-in-fixture-scope', reasons,
    observedFailure: failure || null, observedVerdict: verify?.verdict || null,
    observedScope: verify?.executedFiles || [], summary: summary || null,
    observedStage: verify ? 'verification-response' : plan ? 'plan-response' : brief ? 'default-tools' : observed.some(row => row.tools?.length) ? 'tool-discovery-only' : 'host-startup',
    nextAction: reasons.length ? (hostErrors.some(error => /approval/i.test(JSON.stringify(error)))
      ? 'Review the host approval rejection for the isolated configured fixture; execution was not observed. Preserve this receipt.'
      : hostErrors.some(error => error?.status === 401)
        ? 'Repair the native host subscription login independently, then review a fresh isolated invocation; no provider key or paid fallback is authorized.'
        : processResult.status === 'timeout'
        ? 'Inspect native host startup and subscription connectivity independently; the deadline expired and no unobserved cause is asserted. Preserve this receipt.'
        : 'Inspect the exact failing qualification obligations and receipts before a separately reviewed native-host invocation.')
      : 'Keep the fixture-scope receipt with this exact package identity; other repositories and host versions need their own qualification.',
    limitation: 'One synthetic fixture and one invocation; does not establish other host versions, repositories or deployment safety.'};
}

export async function boundedProcess(command, args, {cwd, env, timeoutMs = 90000, maximumBytes = 1024 * 1024, stopOnNativeRetry = false} = {}) {
  return await new Promise(resolve => {
    const started = Date.now(); let stdout = '', stderr = '', bytes = 0, reason = null;
    const child = spawn(command, args, {cwd, env, shell: false, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe']});
    let terminating = false;
    const stop = why => {
      reason ||= why; if (terminating || !child.pid) return; terminating = true;
      // Let TestLore's SIGTERM handler kill its separately supervised worker
      // group before forcibly terminating remaining host/MCP descendants.
      try {if (process.platform !== 'win32') process.kill(-child.pid, 'SIGTERM'); else child.kill('SIGKILL');} catch {}
      if (process.platform !== 'win32') setTimeout(() => {try {process.kill(-child.pid, 'SIGKILL');} catch {}}, 750);
    };
    const timer = setTimeout(() => stop('deadline-exceeded'), timeoutMs);
    const collect = stream => chunk => {
      bytes += chunk.length;
      if (bytes > maximumBytes) return stop('output-limit-exceeded');
      if (stream === 'stdout') stdout += chunk.toString('utf8'); else stderr += chunk.toString('utf8');
      if (stopOnNativeRetry && stream === 'stdout') for (const line of stdout.split('\n')) {
        let event; try {event = JSON.parse(line);} catch {continue;}
        if (event.type === 'system' && event.subtype === 'api_retry')
          stop(`native-host-retry-refused:${event.error_status}:${event.error}`);
      }
    };
    child.stdout.on('data', collect('stdout')); child.stderr.on('data', collect('stderr'));
    child.once('error', error => {reason ||= error.code || error.message;});
    child.once('close', (exitCode, signal) => {
      clearTimeout(timer); if (Date.now() - started >= timeoutMs) reason ||= 'deadline-exceeded';
      // MCP subprocesses must not survive a host's completion.
      stop(reason);
      resolve({status: reason === 'deadline-exceeded' ? 'timeout' : reason ? (child.pid ? 'failed' : 'not-started') : 'completed',
        reason, exitCode, signal, durationMs: Date.now() - started, outputBytes: bytes, stdout, stderr});
    });
  });
}

function createFixture(directory) {
  fs.mkdirSync(directory, {recursive: true});
  const files = {'package.json': JSON.stringify({type: 'module'}), '.gitignore': '.tddswarm/\n',
    'tddswarm.config.json': JSON.stringify({adapter: 'node', executionMode: 'shadow'}),
    'tddswarm.requirements.md': 'Independently expected behavior: value must be exactly 1; preserved value must be exactly 2.\n',
    'src/value.js': 'export const value=1;\n', 'src/preserved.js': 'export const preserved=2;\n',
    'test/fault.test.js': "import test from 'node:test';import assert from 'node:assert/strict';import {value} from '../src/value.js';test('independent value remains one',()=>assert.equal(value,1));\n",
    'test/preserved.test.js': "import test from 'node:test';import assert from 'node:assert/strict';import {preserved} from '../src/preserved.js';test('preserved value remains two',()=>assert.equal(preserved,2));\n"};
  for (const [file, text] of Object.entries(files)) {const target = path.join(directory, file); fs.mkdirSync(path.dirname(target), {recursive: true}); fs.writeFileSync(target, text);}
  for (const args of [['init', '-b', 'main'], ['config', 'user.name', 'Host Fixture'], ['config', 'user.email', 'fixture@example.invalid'], ['add', '.'], ['commit', '-m', 'independent baseline']]) {
    const response = spawnSync('git', args, {cwd: directory, env: safeHostEnvironment(process.env), encoding: 'utf8', timeout: 10000});
    if (response.status !== 0) throw new Error(`Fixture Git operation failed: ${response.stderr}`);
  }
  fs.writeFileSync(path.join(directory, 'src/value.js'), 'export const value=9;\n');
}

const prompt = `This is an isolated synthetic TestLore host qualification fixture. Use ONLY the two TestLore MCP servers; do not use shell/read/edit/network tools or change files. First call testlore_brief and testlore_status on testlore_readonly (the status must precede execution). Then call testlore_plan on testlore_execution with base HEAD, and testlore_verify on testlore_execution with base HEAD and mode shadow. Exactly once per tool; stop on tool failure. The fixture intentionally has one broken implementation and one passing existing test. Return ONLY a JSON object with verdict, failedCases (copy exact id/file/name), executedFiles, uncertainty (what these observations cannot establish), nextAction (concrete repair and fresh full verification), and deploymentSafety. Report actual observations; never invent success or failure identities. No other task is authorized.`;

export async function qualifyHosts(options) {
  const entrypoint = executableIdentity(options.entrypoint), node = executableIdentity(process.execPath);
  if (options.expectedSha256 && entrypoint.sha256 !== options.expectedSha256) throw new Error('Expected entrypoint SHA-256 mismatch');
  const packagePath = path.resolve(path.dirname(entrypoint.realpath), '../package.json');
  const packageIdentity = executableIdentity(packagePath), packageData = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  if (packageData.name !== 'testlore' || path.basename(entrypoint.realpath) !== 'cli.js' || packageData.bin?.testlore !== 'src/cli.js') throw new Error('Entrypoint must be TestLore src/cli.js from a source/installed package');
  const snapshot = packageSnapshot(options.entrypoint);
  let archive = null;
  if (options.archive) {
    archive = executableIdentity(options.archive);
    if (!options.expectedArchiveSha256 || archive.sha256 !== options.expectedArchiveSha256) throw new Error('Archive requires matching --expected-archive-sha256');
    for (const file of snapshot.files) {
      const packed = spawnSync('tar', ['-xOf', archive.realpath, `package/${file.file}`], {encoding: null, timeout: 10000, maxBuffer: 4 * 1024 * 1024});
      if (packed.status !== 0 || createHash('sha256').update(packed.stdout).digest('hex') !== file.sha256) throw new Error(`Installed package differs from immutable archive: ${file.file}`);
    }
    archive.installedSourceFilesMatched = snapshot.files.length;
  }
  if (options.expectedSourceSha && packageData.gitHead !== options.expectedSourceSha) throw new Error('Installed package gitHead does not match --expected-source-sha');
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'testlore-native-hosts-'));
  const report = {schemaVersion: 1, kind: 'native-agent-host-qualification', startedAt: new Date().toISOString(),
    entrypoint, node, package: {identity: packageIdentity, name: packageData.name, version: packageData.version, gitHead: packageData.gitHead || null, source: snapshot}, archive,
    workspace, timeoutMs: options.timeoutMs, hosts: [], providerApiKeysRemoved: true, retries: 0};
  const observer = fileURLToPath(new URL('./host-mcp-observer.js', import.meta.url));
  for (const name of ['codex', 'claude']) {
    const executable = options[name];
    if (!executable) {report.hosts.push({host: name, qualified: false, status: 'not-started', reasons: ['explicit-host-executable-not-supplied']}); continue;}
    const hostRoot = path.join(workspace, name), fixture = path.join(hostRoot, 'fixture'); createFixture(fixture);
    const env = safeHostEnvironment(process.env), finalPath = path.join(hostRoot, 'final.json');
    let hostIdentity;
    try {hostIdentity = hostIdentityFor(executable, name);} catch (error) {report.hosts.push({host: name, qualified: false, status: 'not-started', reasons: [error.code || error.message]}); continue;}
    const helpArgs = name === 'codex' ? ['exec', '--help'] : ['--help'];
    const help = await boundedProcess(executable, helpArgs, {cwd: fixture, env, timeoutMs: 10000});
    const requiredFlags = name === 'codex' ? ['--ignore-user-config', '--ignore-rules', '--ephemeral', '--output-last-message', '--json']
      : ['--setting-sources', '--strict-mcp-config', '--tools', '--allowedTools', '--disable-slash-commands', '--no-session-persistence', '--output-format', '--verbose'];
    if (help.exitCode !== 0 || help.status !== 'completed' || requiredFlags.some(flag => !help.stdout.includes(flag))) {
      report.hosts.push({host: name, identity: hostIdentity, qualified: false, status: 'not-started', reasons: ['installed-host-help-does-not-support-isolated-invocation'], help: {...help, stdout: help.stdout.slice(0, 12000)}}); continue;
    }
    const servers = {}, configurations = [];
    for (const mode of ['readonly', 'execution']) {
      const configuration = {mode, root: fixture, node: node.realpath, entrypoint: entrypoint.realpath, receipt: path.join(hostRoot, `${mode}-mcp.json`)};
      const configPath = path.join(hostRoot, `${mode}-observer.json`); fs.writeFileSync(configPath, JSON.stringify(configuration)); configurations.push(configuration);
      servers[`testlore_${mode}`] = {command: node.realpath, args: [observer, configPath]};
    }
    let args;
    if (name === 'codex') {
      args = ['exec', '--ignore-user-config', '--ignore-rules', '--ephemeral', '--sandbox', 'read-only', '--json', '--output-last-message', finalPath,
        '-c', 'model_reasoning_effort="low"', '-c', 'approval_policy="never"'];
      for (const [server, config] of Object.entries(servers)) for (const [key, value] of Object.entries(config))
        args.push('-c', `mcp_servers.${server}.${key}=${JSON.stringify(value)}`);
      args.push(prompt);
    } else {
      const mcpPath = path.join(hostRoot, 'mcp.json'); fs.writeFileSync(mcpPath, JSON.stringify({mcpServers: servers}));
      const settings = path.join(hostRoot, 'settings.json'); fs.writeFileSync(settings, JSON.stringify({disableAllHooks: true}));
      args = ['--print', '--setting-sources', '', '--settings', settings, '--strict-mcp-config', '--mcp-config', mcpPath,
        '--tools', '', '--allowedTools', 'mcp__testlore_readonly__testlore_brief,mcp__testlore_readonly__testlore_status,mcp__testlore_execution__testlore_plan,mcp__testlore_execution__testlore_verify',
        '--disable-slash-commands', '--no-session-persistence', '--verbose', '--output-format', 'stream-json', '--effort', 'low', prompt];
    }
    const processResult = await boundedProcess(executable, args, {cwd: fixture, env, timeoutMs: options.timeoutMs, stopOnNativeRetry: name === 'claude'});
    const observed = configurations.map(config => {try {return JSON.parse(fs.readFileSync(config.receipt, 'utf8'));} catch {return null;}}).filter(Boolean);
    let finalMessage = '';
    if (name === 'codex' && fs.existsSync(finalPath)) finalMessage = fs.readFileSync(finalPath, 'utf8').slice(0, 16384);
    const events = hostEvents(name, processResult.stdout);
    if (name === 'claude') finalMessage = events.finalMessage;
    const assessment = assessHost({processResult, observed, finalMessage, entrypoint, hostErrors: events.errors});
    report.hosts.push({host: name, identity: hostIdentity, helpSha256: createHash('sha256').update(help.stdout).digest('hex'),
      invocation: {command: executable, args, cwd: fixture, inheritedConfiguration: false},
      ...assessment, model: events.model, nativeApiRetriesObserved: events.nativeApiRetriesObserved,
      process: {...processResult, stdout: processResult.stdout.slice(0, 20000), stderr: processResult.stderr.slice(0, 8000)}, observed});
    if (packageSnapshot(options.entrypoint).sha256 !== snapshot.sha256) {report.hosts.at(-1).qualified = false; report.hosts.at(-1).status = 'not-qualified'; report.hosts.at(-1).reasons.push('package-source-changed-during-run');}
  }
  report.complete = report.hosts.length === 2 && report.hosts.every(row => row.qualified);
  report.finishedAt = new Date().toISOString();
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  if (!argv.includes('--run')) {
    console.error('Opt-in only: node scripts/host-qualification.js --run --entrypoint /abs/testlore/src/cli.js --codex /abs/codex --claude /abs/claude --output /abs/receipt.json [--timeout-ms 90000] [--expected-sha256 HEX]');
    process.exitCode = 2;
  } else {
    const read = flag => {const index = argv.indexOf(flag); return index < 0 ? null : argv[index + 1];};
    const timeoutMs = Number(read('--timeout-ms') || 90000), output = read('--output'), entrypoint = read('--entrypoint');
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 120000 || !output || !entrypoint || !path.isAbsolute(entrypoint) || !path.isAbsolute(output)) throw new Error('Explicit absolute entrypoint/output and timeout 1000..120000ms are required');
    const report = await qualifyHosts({entrypoint, codex: read('--codex'), claude: read('--claude'), timeoutMs, expectedSha256: read('--expected-sha256'),
      archive: read('--archive'), expectedArchiveSha256: read('--expected-archive-sha256'), expectedSourceSha: read('--expected-source-sha')});
    fs.mkdirSync(path.dirname(output), {recursive: true}); fs.writeFileSync(output, JSON.stringify(report, null, 2), {mode: 0o600});
    console.log(JSON.stringify({complete: report.complete, output, workspace: report.workspace, hosts: report.hosts.map(({host, status, reasons}) => ({host, status, reasons}))}));
    process.exitCode = report.complete ? 0 : 1;
  }
}
