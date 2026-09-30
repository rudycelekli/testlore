#!/usr/bin/env node
// Independent native Node TAP qualification. A zero exit code alone is insufficient.
import fs from 'node:fs';
import path from 'node:path';
import {spawn, spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';

const repository = fileURLToPath(new URL('../', import.meta.url));
const hash = value => createHash('sha256').update(value).digest('hex');

export function inspectQualificationTap(stdout) {
  const tail = stdout.match(/\n1\.\.(\d+)\n# tests (\d+)\n# suites (\d+)\n# pass (\d+)\n# fail (\d+)\n# cancelled (\d+)\n# skipped (\d+)\n# todo (\d+)\n# duration_ms (\d+(?:\.\d+)?)\s*$/);
  if (!stdout.startsWith('TAP version 13\n') || !tail || /^Bail out!/m.test(stdout)) return {qualified: false, reasons: ['incomplete-native-summary']};
  const [plan, tests, suites, passed, failed, cancelled, skipped, todo] = tail.slice(1, 9).map(Number);
  const counts = {tests, suites, passed, failed, cancelled, skipped, todo};
  const results = [...stdout.matchAll(/^(?:ok|not ok) (\d+)(?: -|\s*$)/gm)].map(match => Number(match[1]));
  const reasons = [];
  if (/^[ \t]*not ok \d+(?: -|\s*$)/m.test(stdout) || /^[ \t]*(?:ok|not ok) \d+[^\n]* # (?:SKIP|TODO)(?:\s|$)/mi.test(stdout)) reasons.push('unqualified-native-result');
  if (![plan, ...Object.values(counts)].every(value => Number.isSafeInteger(value) && value >= 0 && value <= 1000000) ||
      results.length !== plan || results.some((number, index) => number !== index + 1) ||
      passed + failed + cancelled + skipped + todo !== tests) reasons.push('inconsistent-native-summary');
  if (tests === 0 || plan === 0) reasons.push('zero-tests');
  for (const [key, value] of Object.entries({failed, cancelled, skipped, todo})) if (value) reasons.push('nonzero-' + key);
  return {qualified: reasons.length === 0, counts, reasons};
}

export async function qualifyTests(root, files, {timeoutMs = 900000, maxBytes = 16 * 1024 * 1024} = {}) {
  if (!Array.isArray(files) || !files.length || files.some(file => typeof file !== 'string' || path.isAbsolute(file) || file.split(/[\\/]/).some(part => !part || part === '.' || part === '..') || !fs.lstatSync(path.join(root, file)).isFile())) throw new Error('Qualification requires explicit regular test files');
  if (!Number.isInteger(timeoutMs) || timeoutMs < 50 || timeoutMs > 1200000 || !Number.isInteger(maxBytes) || maxBytes < 1024 || maxBytes > 32 * 1024 * 1024) throw new Error('Invalid qualification budget');
  const started = performance.now(), command = [process.execPath, '--test', '--test-concurrency=2', '--test-reporter=tap', ...files.map(file => './' + file)];
  const env = {...process.env}; delete env.NODE_TEST_CONTEXT;
  const execution = await new Promise(resolve => {
    const child = spawn(command[0], command.slice(1), {cwd: root, env, shell: false, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe']});
    const output = [], errors = []; let bytes = 0, failure = null;
    const stop = () => {try {if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, 'SIGKILL'); else child.kill('SIGKILL');} catch { /* Already stopped. */ }};
    const timer = setTimeout(() => {failure ||= 'deadline-exceeded'; stop();}, timeoutMs);
    const capture = collection => chunk => {bytes += chunk.length; if (bytes > maxBytes) {failure ||= 'output-budget-exceeded'; stop();} else collection.push(chunk);};
    child.stdout.on('data', capture(output)); child.stderr.on('data', capture(errors));
    child.on('error', error => {failure ||= 'spawn-failed: ' + error.message;});
    child.on('close', (exitCode, signal) => {
      clearTimeout(timer); stop();
      if (performance.now() - started > timeoutMs) failure ||= 'deadline-exceeded';
      resolve({exitCode, signal, failure, stdout: Buffer.concat(output).toString('utf8'), stderr: Buffer.concat(errors).toString('utf8'), durationMs: Math.round(performance.now() - started)});
    });
  });
  const inspected = inspectQualificationTap(execution.stdout), reasons = [...inspected.reasons];
  const names = [...execution.stdout.matchAll(/^# Subtest: (.+)$/gm)].map(match => match[1]);
  const fileLoads = names.filter(name => files.some(file => [file, './' + file, path.basename(file), path.join(root, file)].includes(name)));
  if (fileLoads.length) reasons.push('file-load-without-declared-tests');
  const declaredCases = (inspected.counts?.tests || 0) - fileLoads.length;
  if (declaredCases === 0 && !reasons.includes('zero-tests')) reasons.push('zero-tests');
  if (execution.failure) reasons.push(execution.failure);
  if (execution.exitCode !== 0 || execution.signal) reasons.push('native-process-incomplete-or-failed');
  return {schemaVersion: 1, qualified: inspected.qualified && reasons.length === 0, counts: inspected.counts || null, declaredCases, reasons, command, files, node: process.version, ...execution};
}

const requiredBrowserCases = [
  'real Chromium validates declared route selection, full/subset fault identity and candidate copies',
  'real Chromium maps isolated HTML/style/bundle/source inputs and preserves three independent named faults'
];
export function verifySourceScope(result, expectedFiles, {browserEnabled = false} = {}) {
  const reasons = [...result.reasons];
  if (JSON.stringify([...result.files].sort()) !== JSON.stringify([...expectedFiles].sort())) reasons.push('not-full-test-file-scope');
  if (!browserEnabled) reasons.push('browser-tests-disabled');
  const names = new Set([...result.stdout.matchAll(/^# Subtest: (.+)$/gm)].map(match => match[1]));
  for (const name of requiredBrowserCases) if (!names.has(name)) reasons.push('required-browser-case-missing:' + name);
  return {...result, qualified: result.qualified && reasons.length === 0, reasons, requiredBrowserCases};
}

function git(...args) {
  const result = spawnSync('git', args, {cwd: repository, encoding: 'utf8', shell: false, timeout: 10000});
  if (result.error || result.status !== 0) throw new Error('Cannot bind qualification to Git source');
  return result.stdout.trim();
}

export async function main(args = process.argv.slice(2)) {
  if (args.length !== 2 || args[0] !== '--output' || !args[1]) throw new Error('Use --output NEW_RECEIPT.json');
  const output = path.resolve(args[1]);
  if (fs.existsSync(output) || fs.existsSync(output + '.tap') || fs.existsSync(output + '.stderr')) throw new Error('Preserve prior qualification: output must be new');
  const sourceRevision = git('rev-parse', 'HEAD');
  if (!/^[a-f0-9]{40}$/.test(sourceRevision) || git('status', '--porcelain')) throw new Error('Qualification requires clean immutable source');
  if (process.env.TESTLORE_PLAYWRIGHT_BROWSER !== '1') throw new Error('Full source qualification requires TESTLORE_PLAYWRIGHT_BROWSER=1 and an installed Chromium browser');
  const files = fs.readdirSync(path.join(repository, 'test')).filter(name => name.endsWith('.test.js')).sort().map(name => 'test/' + name);
  const sourceHashes = Object.fromEntries(files.map(file => [file, hash(fs.readFileSync(path.join(repository, file)))]));
  const result = verifySourceScope(await qualifyTests(repository, files), files, {browserEnabled: true});
  if (sourceRevision !== git('rev-parse', 'HEAD') || git('status', '--porcelain') || files.some(file => hash(fs.readFileSync(path.join(repository, file))) !== sourceHashes[file])) {
    result.qualified = false; result.reasons.push('source-drift');
  }
  fs.mkdirSync(path.dirname(output), {recursive: true});
  fs.writeFileSync(output + '.tap', result.stdout, {flag: 'wx'}); fs.writeFileSync(output + '.stderr', result.stderr, {flag: 'wx'});
  const {stdout, stderr, ...receipt} = result;
  Object.assign(receipt, {sourceRevision, scope: 'complete-test-directory-with-browser-tests-enabled', browserTestsEnabled: true, browserChannel: process.env.TESTLORE_BROWSER_CHANNEL || 'bundled-chromium', testSourceHashes: sourceHashes, tapSha256: hash(stdout), stderrSha256: hash(stderr), producerSha256: hash(fs.readFileSync(fileURLToPath(import.meta.url)))});
  fs.writeFileSync(output, JSON.stringify(receipt, null, 2) + '\n', {flag: 'wx'});
  console.log(JSON.stringify({qualified: receipt.qualified, sourceRevision, counts: receipt.counts, reasons: receipt.reasons, output}, null, 2));
  return receipt.qualified ? 0 : 1;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {process.exitCode = await main();} catch (error) {console.error(error.message); process.exitCode = 1;}
}
