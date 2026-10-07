import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {fixture, twoModules, commit, write} from './helpers.js';
import {execute} from '../src/execution.js';
import {profileCli} from '../scripts/cli-profile.js';
const cli = fileURLToPath(new URL('../src/cli.js', import.meta.url));
const vitest = fileURLToPath(new URL('../node_modules/vitest/vitest.mjs', import.meta.url));
const invoke = (root, args, preload) => {
  const env = {...process.env}; delete env.NODE_TEST_CONTEXT;
  return spawnSync(process.execPath, [...(preload ? ['--import', preload] : []), cli, ...args], {cwd: root, env, encoding: 'utf8', timeout: 30000});
};
function blocker(root, allowed = []) {
  const preload = path.join(root, 'block-command-graph.mjs');
  fs.writeFileSync(preload, `import {registerHooks} from 'node:module';
registerHooks({load(url,context,nextLoad){
 if(url.includes('/src/') && url!==${JSON.stringify(new URL('../src/cli.js', import.meta.url).href)} && !${JSON.stringify(allowed)}.some(name=>url.endsWith('/src/'+name+'.js')))throw new Error('UNEXPECTED_COMMAND_IMPORT:'+url);
 return nextLoad(url,context);
}});`);
  return preload;
}
test('help/version and rejected options load no command implementation, including a missing project root', t => {
  const root = fixture(t), preload = blocker(root);
  for (const args of [[], ['--help'], ['audit', '--help'], ['--version']]) {
    const result = invoke(root, [...args, '--root', path.join(root, 'missing')], preload);
    assert.equal(result.status, 0, result.stderr); assert.doesNotMatch(result.stderr, /UNEXPECTED_COMMAND_IMPORT/);
  }
  for (const [args, message] of [
    [['run', '--changed', 'src/a.js'], /diagnostic only/],
    [['run', '--selective', '--shadow'], /Choose --shadow or --selective/],
    [['brief', '--unified-native'], /applies only to run/],
    [['plan', '--base'], /Missing value/],
    [['plan', '--magic'], /Unknown option/],
    [['does-not-exist'], /Unknown command/],
    [['constructor'], /Unknown command/],
    [['__proto__'], /Unknown command/]
  ]) {
    const result = invoke(root, args, preload);
    assert.equal(result.status, 2, result.stderr); assert.match(result.stderr, message);
    assert.doesNotMatch(result.stderr, /UNEXPECTED_COMMAND_IMPORT/); assert.equal(result.stdout, '');
  }
});
test('run imports its graph without loading unrelated orchestration or the public index', t => {
  const root = fixture(t, {...twoModules, 'src/a.js': 'export const a=9;'});
  const preload = path.join(root, 'reject-unrelated.mjs');
  fs.writeFileSync(preload, `import {registerHooks} from 'node:module';registerHooks({load(url,context,nextLoad){
 if(/\\/src\\/(?:index|improvement|swarm|pilot|browser-evidence|plugins|agent-profile)\\.js$/.test(url))throw new Error('UNRELATED_COMMAND_IMPORT');
 return nextLoad(url,context);}});`);
  const result = invoke(root, ['run', '--full', '--json'], preload), report = JSON.parse(result.stdout);
  assert.equal(result.status, 1, result.stderr); assert.equal(report.exitCode, 1); assert.equal(report.complete, true);
  assert.equal(report.tests.filter(row => row.status === 'failed').length, 1);
});
test('CLI failure oracle detects a mutant that swallows the native runner exit', t => {
  const root = fixture(t, {...twoModules, 'src/a.js': 'export const a=9;'});
  const native = invoke(root, ['run', '--full', '--json']);
  assert.equal(native.status, 1); assert.equal(JSON.parse(native.stdout).exitCode, 1);
  const preload = path.join(root, 'swallow-exit.mjs');
  fs.writeFileSync(preload, `import {registerHooks} from 'node:module';registerHooks({load(url,context,nextLoad){
 const result=nextLoad(url,context);if(url===${JSON.stringify(new URL('../src/cli.js', import.meta.url).href)}){
 const text=Buffer.from(result.source).toString();const before="if(['plan','run','external-run','external-plan','aqe'].includes(command))return result.exitCode||0;";
 if(!text.includes(before))throw new Error('Mutant target absent');return {...result,source:text.replace(before,"if(command==='run')return 0;" )};}return result;}});`);
  const mutant = invoke(root, ['run', '--full', '--json'], preload);
  assert.equal(mutant.status, 0, mutant.stderr); assert.equal(JSON.parse(mutant.stdout).exitCode, 1);
  assert.notEqual(mutant.status, native.status, 'A process-status assertion must expose a swallowed runner failure');
});
test('lazy native CLI preserves independent full failures and reloads changed configuration each invocation', t => {
  const config = {adapter: 'vitest', discovery: 'native', runner: [process.execPath, vitest, 'run', '--maxWorkers=1', '{files}']};
  const root = fixture(t, {'package.json': {type: 'module'}, '.gitignore': '.tddswarm/\nnode_modules\n', 'tddswarm.config.json': config,
    'src/a.js': 'export default 1;', 'src/b.js': 'export default 2;',
    'checks/a.check.js': "import {test,expect} from 'vitest';import value from '@subject';test('independent a contract',()=>expect(value).toBe(1));",
    'checks/b.check.js': "import {test,expect} from 'vitest';import value from '../src/b.js';test('independent b contract',()=>expect(value).toBe(2));",
    'vitest.config.mjs': "export default {test:{include:['checks/*.check.js'],alias:{'@subject':new URL('./src/a.js',import.meta.url).pathname}}};"});
  fs.symlinkSync(path.dirname(path.dirname(vitest)), path.join(root, 'node_modules'), 'dir'); commit(root);
  const baseline = invoke(root, ['run', '--unified-native', '--full', '--json']);
  assert.equal(baseline.status, 0, baseline.stderr); assert.equal(JSON.parse(baseline.stdout).unifiedNative.used, true);
  write(root, 'src/a.js', 'export default 7;');
  const full = execute(root, ['checks/a.check.js', 'checks/b.check.js'], config, {capture: true});
  assert.equal(full.complete, true); assert.equal(full.exitCode, 1);
  const failing = invoke(root, ['run', '--unified-native', '--base', 'HEAD', '--selective', '--json']);
  assert.equal(failing.status, 1, failing.stderr);
  const report = JSON.parse(failing.stdout); assert.equal(report.complete, true); assert.equal(report.unifiedNative.used, true);
  assert.deepEqual(report.tests.filter(row => row.status === 'failed').map(row => row.id), full.tests.filter(row => row.status === 'failed').map(row => row.id));
  assert.deepEqual(report.executedTests, ['checks/a.check.js']);
  write(root, 'src/b.js', 'export default 1;');
  write(root, 'vitest.config.mjs', "export default {test:{include:['checks/*.check.js'],alias:{'@subject':new URL('./src/b.js',import.meta.url).pathname}}};");
  const reconfigured = invoke(root, ['run', '--unified-native', '--full', '--json']);
  assert.equal(reconfigured.status, 1, reconfigured.stderr);
  const fresh = JSON.parse(reconfigured.stdout);
  assert.equal(fresh.complete, true); assert.equal(fresh.unifiedNative.used, true);
  assert.equal(fresh.tests.find(row => row.name === 'independent a contract').status, 'passed', 'Changed alias must load current b value, not cached a value');
  assert.equal(fresh.tests.find(row => row.name === 'independent b contract').status, 'failed');
});
test('profiler retains raw errors and invalidates a source-drifting command', t => {
  const root = fixture(t), tool = path.join(root, 'tool'); fs.mkdirSync(path.join(tool, 'src'), {recursive: true});
  const entrypoint = path.join(tool, 'src', 'cli.js');
  fs.writeFileSync(entrypoint, "import fs from 'node:fs';fs.appendFileSync(new URL('./cli.js',import.meta.url),'\\n');console.error('retained failure');process.exitCode=1;");
  const output = path.join(root, 'profile');
  const report = profileCli({entrypoints: [{id: 'mutated', path: entrypoint}], root: tool, args: [], repetitions: 1, expectedExit: 1, output});
  assert.equal(report.sourceUnchanged, false); assert.equal(report.complete, false);
  assert.equal(report.samples[0].exitCode, 1); assert.ok(report.diagnostics[0].tracePresent);
  assert.match(fs.readFileSync(path.join(output, 'mutated-0.stderr'), 'utf8'), /retained failure/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(output, 'summary.json'))).complete, false);
});

test('profiler retains a timed-out attempt and never credits it as completion', t => {
  const root = fixture(t), tool = path.join(root, 'tool'); fs.mkdirSync(path.join(tool, 'src'), {recursive: true});
  const entrypoint = path.join(tool, 'src', 'cli.js');
  fs.writeFileSync(entrypoint, "setInterval(()=>{},1000);");
  const output = path.join(root, 'profile-timeout');
  const report = profileCli({entrypoints: [{id: 'hung', path: entrypoint}], root: tool, args: [], repetitions: 1, timeoutMs: 100, output});
  assert.equal(report.sourceUnchanged, true); assert.equal(report.complete, false);
  assert.equal(report.samples[0].error, 'ETIMEDOUT'); assert.equal(report.samples[0].matchedExit, false);
  assert.equal(fs.existsSync(path.join(output, 'hung-0.stdout')), true);
  assert.equal(fs.existsSync(path.join(output, 'hung-0.stderr')), true);
  assert.equal(JSON.parse(fs.readFileSync(path.join(output, 'summary.json'))).complete, false);
});

test('profiler seals an incomplete receipt when an attempted command removes its own source', t => {
  const root = fixture(t), tool = path.join(root, 'tool'); fs.mkdirSync(path.join(tool, 'src'), {recursive: true});
  const entrypoint = path.join(tool, 'src', 'cli.js');
  fs.writeFileSync(entrypoint, "import fs from 'node:fs';fs.unlinkSync(new URL('./cli.js',import.meta.url));console.error('removed source');process.exitCode=1;");
  const output = path.join(root, 'profile-deletion');
  const report = profileCli({entrypoints: [{id: 'removed', path: entrypoint}], root: tool, args: [], repetitions: 1, expectedExit: 1, output});
  assert.equal(report.sourceUnchanged, false); assert.equal(report.complete, false);
  assert.equal(report.samples[0].exitCode, 1); assert.ok(report.identityError || report.sourceBefore[0].digest !== report.sourceAfter[0]?.digest);
  assert.match(fs.readFileSync(path.join(output, 'removed-0.stderr'), 'utf8'), /removed source/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(output, 'summary.json'))).complete, false);
});
