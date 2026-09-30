import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fixture, write} from './helpers.js';
import {verificationBrief, inspectVerificationStatus} from '../src/agent-contract.js';

test('agent brief exposes independent obligations without invoking project runners or service probes', t => {
  const command = [process.execPath, '-e', "require('fs').writeFileSync('executed','unsafe')"];
  const root = fixture(t, {'tddswarm.config.json': {discovery: command, runner: [...command, '{files}'], services: {api: {tests: ['test/entry.test.js'], probe: command}}, env: {SECRET: 'must-not-return'}}, 'tddswarm.requirements.md': 'Review the requirement: invalid values throw RangeError.', 'test/entry.test.js': "import test from 'node:test';test('weak',()=>{});"});
  const brief = verificationBrief(root, {task: 'Improve invalid-input quality', changed: ['src/entry.js']});
  assert.equal(brief.authority, 'advisory'); assert.equal(brief.execution.projectCommandsInvoked, false); assert.equal(brief.inventory.nativeScopeEstablished, false);
  assert.equal(brief.independentContract.reviewRequired, true); assert.equal(brief.triage.totals.emptyCases, 1); assert.ok(brief.obligations.some(row => row.id === 'bug-detection'));
  assert.equal(fs.existsSync(path.join(root, 'executed')), false); assert.equal(fs.existsSync(path.join(root, '.tddswarm')), false); assert.ok(!JSON.stringify(brief).includes('must-not-return'));
  const previous = brief.contractDigest; write(root, 'test/entry.test.js', "import test from 'node:test';test('different',()=>{});"); assert.notEqual(verificationBrief(root, {task: brief.task, changed: brief.changed}).contractDigest, previous);
});

test('missing contracts, symlink inputs, oversized tests and scoped path escapes stay explicit', t => {
  const root = fixture(t, {'test/oversized.test.js': 'x'.repeat(256 * 1024 + 1), 'src/entry.js': 'export const value=1;'});
  fs.symlinkSync(path.join(root, 'src'), path.join(root, 'outside'));
  const brief = verificationBrief(root);
  assert.ok(brief.risks.includes('independent-behavior-contract-needed')); assert.ok(brief.risks.includes('static-inspection-incomplete')); assert.equal(brief.inventory.nativeScopeEstablished, false); assert.equal(brief.inventory.completeWithinStaticScope, false);
  assert.throws(() => verificationBrief(root, {changed: ['../secret.js']}), /Unsafe/); assert.throws(() => verificationBrief(root, {changed: ['outside/entry.js']}), /Symlink/);
  assert.throws(() => verificationBrief(root, {task: 'x'.repeat(2001)}), /2000/);
});

test('agent status cannot turn retained success or a forged certificate into current qualification', t => {
  const root = fixture(t, {'.tddswarm/last-run.json': {complete: true, exitCode: 0, certified: true, shadow: true, tests: [{status: 'passed'}], executedTests: ['test/a.test.js'], plan: {selected: []}}});
  const status = inspectVerificationStatus(root);
  assert.equal(status.observed.complete, true); assert.equal(status.certified, false); assert.equal(status.freshness, 'not-checked'); assert.equal(status.authority, 'historical-unverified');
  write(root, '.tddswarm/last-run.json', '{broken'); assert.equal(inspectVerificationStatus(root).reason, 'invalid-retained-run');
  fs.unlinkSync(path.join(root, '.tddswarm/last-run.json')); assert.equal(inspectVerificationStatus(root).present, false);
});
