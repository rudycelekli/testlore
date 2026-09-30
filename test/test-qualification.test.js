import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './helpers.js';
import {qualifyTests, inspectQualificationTap, verifySourceScope} from '../scripts/test-qualification.js';

test('qualification accepts a complete nonempty native suite including nested tests', async t => {
  const root = fixture(t, {'package.json': {type: 'module'}, 'pass.test.js': "import {test,describe} from 'node:test';describe('nested',()=>{test('first',()=>{});test('second',()=>{})});"});
  const result = await qualifyTests(root, ['pass.test.js']);
  assert.equal(result.qualified, true); assert.equal(result.counts.tests, 2); assert.equal(result.counts.passed, 2);
});

test('a passing native subset cannot certify full source or absent browser qualification', async t => {
  const root = fixture(t, {'package.json': {type: 'module'}, 'pass.test.js': "import test from 'node:test';test('passes',()=>{});"});
  const result = await qualifyTests(root, ['pass.test.js']);
  assert.equal(result.qualified, true);
  const scope = verifySourceScope(result, ['pass.test.js', 'omitted.test.js']);
  assert.equal(scope.qualified, false); assert.ok(scope.reasons.includes('not-full-test-file-scope'));
  assert.ok(scope.reasons.includes('browser-tests-disabled')); assert.equal(scope.reasons.filter(reason => reason.startsWith('required-browser-case-missing:')).length, 3);
});

test('qualification rejects native success with skipped, todo or zero tests', async t => {
  for (const [name, body, reason] of [['skip', "test('missing', {skip:true},()=>{});", 'nonzero-skipped'], ['todo', "test.todo('unfinished');", 'nonzero-todo'], ['empty', '', 'zero-tests']]) {
    const root = fixture(t, {'package.json': {type: 'module'}, 'case.test.js': "import test from 'node:test';" + body});
    const result = await qualifyTests(root, ['case.test.js']);
    assert.equal(result.exitCode, 0); assert.equal(result.qualified, false); assert.ok(result.reasons.includes(reason), name + JSON.stringify(result));
  }
});

test('qualification retains real failure and deadline failure instead of accepting partial output', async t => {
  const root = fixture(t, {'package.json': {type: 'module'}, 'fail.test.js': "import test from 'node:test';test('fails',()=>{throw new Error('independent defect')});", 'hang.test.js': "import test from 'node:test';test('hangs',async()=>await new Promise(()=>{}));setInterval(()=>{},1000);"});
  const failing = await qualifyTests(root, ['fail.test.js']);
  assert.equal(failing.qualified, false); assert.ok(failing.reasons.includes('nonzero-failed'));
  assert.equal(inspectQualificationTap(failing.stdout.replace('# pass 0', '# pass 1').replace('# fail 1', '# fail 0')).qualified, false);
  const timeout = await qualifyTests(root, ['hang.test.js'], {timeoutMs: 150});
  assert.equal(timeout.qualified, false); assert.ok(timeout.reasons.includes('deadline-exceeded')); assert.ok(timeout.durationMs < 3000);
});

test('qualification rejects excessive output and native cancellation', async t => {
  const root = fixture(t, {'package.json': {type: 'module'}, 'output.test.js': "import test from 'node:test';test('output',()=>{console.log('x'.repeat(5000))});", 'cancel.test.js': "import test from 'node:test';test('cancelled',{timeout:50},async()=>await new Promise(()=>{}));"});
  const output = await qualifyTests(root, ['output.test.js'], {maxBytes: 1024});
  assert.equal(output.qualified, false); assert.ok(output.reasons.includes('output-budget-exceeded'));
  const cancelled = await qualifyTests(root, ['cancel.test.js'], {timeoutMs: 3000});
  assert.equal(cancelled.qualified, false); assert.ok(cancelled.reasons.includes('nonzero-cancelled'));
});

test('qualification rejects altered counts, truncated plans and footer injection', async t => {
  const root = fixture(t, {'package.json': {type: 'module'}, 'pass.test.js': "import test from 'node:test';test('passes',()=>{});"});
  const {stdout} = await qualifyTests(root, ['pass.test.js']);
  assert.equal(inspectQualificationTap(stdout).qualified, true);
  assert.equal(inspectQualificationTap(stdout.replace('# tests 1', '# tests 2')).qualified, false);
  assert.equal(inspectQualificationTap(stdout.replace('1..1\n', '1..2\n')).qualified, false);
  assert.equal(inspectQualificationTap(stdout.slice(0, -30)).qualified, false);
  assert.equal(inspectQualificationTap(stdout + 'unverified trailing output\n').qualified, false);
});
