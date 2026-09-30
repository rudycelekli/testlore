import test from 'node:test';
import assert from 'node:assert/strict';
import { audit, inspectTest, modules } from '../src/index.js';
import { fixture, twoModules } from './helpers.js';

test('empty repositories remain ungraded and never pretend effectiveness was measured', t => {
  const report = audit(fixture(t, { 'src/a.js': 'export const a=1' }));
  assert.equal(report.score, null); assert.equal(report.grade, 'ungraded');
  assert.ok(Object.values(report.measured).every(v => !v));
});
test('AST audit ignores comment text and catches disabled, exclusive, empty, and sleeping tests', () => {
  const report = inspectTest('test/a.test.js', `// expect(x).toEqual(x); test.only('fake',()=>{});
  test.skip('disabled',()=>{}); it.only('focus',()=>{setTimeout(()=>{},500)});`);
  assert.equal(report.metrics.assertions, 0);
  assert.equal(report.metrics.skipped, 1); assert.equal(report.metrics.exclusive, 1);
  assert.equal(report.metrics.emptyCases, 2); assert.equal(report.metrics.fixedSleeps, 1);
});
test('snapshot-only files get a concrete improvement suggestion', () => {
  const report = inspectTest('a.test.js', "it('renders', () => {expect(view()).toMatchSnapshot();});");
  assert.equal(report.metrics.assertions, 1); assert.equal(report.metrics.snapshots, 1);
  assert.ok(report.findings.some(f => f.code === 'snapshot-only'));
});
test('bare expect calls do not count as a meaningful assertion', () => {
  const report = inspectTest('a.test.js', "it('value', () => {expect(1);});");
  assert.equal(report.metrics.emptyCases, 1); assert.equal(report.metrics.assertions, 0);
});
test('actual matcher calls and Node assertions are recognized', () => {
  const report = inspectTest('a.test.js', "it('value', () => {expect(\n 1\n).not.toBe(2); assert.equal(1,1);});");
  assert.equal(report.metrics.assertions, 2); assert.equal(report.metrics.emptyCases, 0);
});
test('source import reachability is labeled as distinct from coverage', t => {
  const root = fixture(t, { ...twoModules, 'src/unused.js': 'export const x=1;' });
  const report = audit(root);
  assert.deepEqual(report.sourcesWithoutImportingTests, ['src/unused.js']);
  assert.equal(report.measured.coverage, false);
});
test('modularization makes a proposal without changing source', t => {
  const root = fixture(t, twoModules);
  const report = modules(root);
  assert.equal(report.rewritten, false); assert.equal(report.groups[0].tests.length, 2);
  assert.deepEqual(audit(root).testFiles, 2);
});
