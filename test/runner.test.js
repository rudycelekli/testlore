import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { run, plan } from '../src/index.js';
import { parseArgs } from '../src/cli.js';
import { fixture, write, commit, twoModules } from './helpers.js';

test('runner executes only affected files, records time, and propagates failures', t => {
  const root = fixture(t, twoModules); commit(root);
  write(root, 'src/a.js', 'export const a=3;');
  const result = run(root, { capture: true });
  assert.equal(result.exitCode, 1); assert.deepEqual(result.executedTests, ['test/a.test.js']);
  assert.equal(result.command.includes('./test/b.test.js'), false);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, '.tddswarm/history.json'))).failed, ['test/a.test.js']);
  assert.ok(result.durationMs > 0);
});
test('shadow mode executes full suite while retaining proposed subset', t => {
  const root = fixture(t, twoModules); commit(root); write(root, 'src/a.js', 'export const a=1; // changed');
  const result = run(root, { shadow: true, capture: true });
  assert.deepEqual(result.plan.selected, ['test/a.test.js']);
  assert.equal(result.executedTests.length, 2); assert.equal(result.exitCode, 0);
});
test('empty test discovery returns failure rather than a misleading pass', t => {
  assert.equal(run(fixture(t, {}), { capture: true }).exitCode, 2);
});
test('missing runner executable is a failed run with recorded retries', t => {
  const root = fixture(t, { ...twoModules, 'tddswarm.config.json': { runner: ['tddswarm-missing-executable', '{files}'] } });
  const result = run(root, { capture: true, full: true });
  assert.equal(result.exitCode, 1); assert.ok(result.error);
  assert.equal(plan(root, { changed: [] }).selected.length, 2);
});
test('runner refuses ambiguous file expansion instead of dropping selection', t => {
  const root = fixture(t, { ...twoModules, 'tddswarm.config.json': { runner: ['node', '--test'] } });
  assert.throws(() => run(root), /exactly one/);
});
test('file names with spaces are passed as one argv element', t => {
  const files = { ...twoModules, 'test/a space.test.js': twoModules['test/a.test.js'] };
  delete files['test/a.test.js'];
  const result = run(fixture(t, files), { full: true, capture: true });
  assert.equal(result.exitCode, 0);
  assert.ok(result.command.includes('./test/a space.test.js'));
});
test('unchanged repositories do not invoke a runner unnecessarily', t => {
  const root = fixture(t, twoModules); commit(root);
  const result = run(root, { capture: true });
  assert.equal(result.executed, false); assert.equal(result.exitCode, 0);
});
test('TypeScript suites require an explicitly capable runner', t => {
  const root = fixture(t, { 'a.test.ts': 'test("x",()=>{})' });
  const result = run(root, { capture: true, full: true });
  assert.equal(result.exitCode, 2); assert.match(result.error, /TypeScript/);
});
test('CLI flags reject missing values and unknown arguments', () => {
  assert.throws(() => parseArgs(['plan','--base']), /Missing value/);
  assert.throws(() => parseArgs(['plan','--magic']), /Unknown option/);
  assert.deepEqual(parseArgs(['plan','--changed','a.js,b.js']).options.changed, ['a.js','b.js']);
});
