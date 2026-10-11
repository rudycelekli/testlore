import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { gradiaGuardProof, guardProofCases, verifyGradiaGuardProofRaw, GUARD_SOURCE_REVISION } from '../scripts/gradia-guard-proof.js';

test('wrong producer source is refused before any supplied executable runs', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'testlore-guard-pins-')); t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  fs.writeFileSync(path.join(directory, 'LICENSE'), 'untrusted license/source');
  const output = path.join(directory, 'output');
  assert.throws(() => gradiaGuardProof({ source: directory, python: '/must-never-execute', output }), /Pinned bytes mismatch/);
  assert.equal(fs.existsSync(output), false);
});
test('source symlinks are refused before qualification execution', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'testlore-guard-link-')); t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  fs.mkdirSync(path.join(directory, 'python/src/gradia_guard'), { recursive: true });
  fs.writeFileSync(path.join(directory, 'other.py'), 'untrusted implementation');
  fs.symlinkSync(path.join(directory, 'other.py'), path.join(directory, 'LICENSE'));
  assert.throws(() => gradiaGuardProof({ source: directory, python: '/must-never-execute', output: path.join(directory, 'output') }), /Symlink refused/);
});
test('coverage overclaim control has a consistent rebuilt chain and preserves original inputs', () => {
  const original = { chain_head_sha256: 'old', coverage: { full_world_capture: false } };
  const frames = [{ frame_kind: 'decision', previous_frame_sha256: 'old', frame_sha256: 'old', coverage: { full_world_capture: false } },
    { frame_kind: 'action', outcome: 'success', failure_code: null, previous_frame_sha256: 'old', frame_sha256: 'old', coverage: { full_world_capture: false } }];
  const before = structuredClone({ original, frames }); const cases = guardProofCases(original, frames);
  assert.deepEqual({ original, frames }, before);
  const control = cases.find(item => item.id === 'rehashed-full-world-overclaim');
  assert.equal(control.manifest.coverage.full_world_capture, true);
  let head = createHash('sha256').update('').digest('hex');
  function canonical(value) {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]));
    return value;
  }
  for (const frame of control.frames) {
    assert.equal(frame.previous_frame_sha256, head);
    const { frame_sha256, ...body } = frame;
    head = createHash('sha256').update(JSON.stringify(canonical(body))).digest('hex'); assert.equal(frame_sha256, head);
  }
  assert.equal(control.manifest.chain_head_sha256, head);
  const validFailure = cases.find(item => item.id === 'owned-valid-failure');
  assert.equal(validFailure.ok, true); assert.equal(validFailure.frames[1].outcome, 'decision_failure');
});
test('proof inspection rejects source substitution and invented acceptance authority', () => {
  assert.throws(() => verifyGradiaGuardProofRaw('/must-never-read', { schema: 'testlore.gradia-guard-sdk-proof.v1', sourceRevision: '0'.repeat(40) }));
  assert.throws(() => verifyGradiaGuardProofRaw('/must-never-read', {
    schema: 'testlore.gradia-guard-sdk-proof.v1', sourceRevision: GUARD_SOURCE_REVISION,
    profile: 'gradia.guard.sdk-bundle.v1', mode: 'pinned-python-verifier-producer-fixture-and-owned-controls',
    independentNodeParityExecuted: false, applicationTestsExecuted: false, providerCalls: 0, qualityImprovementClaim: false,
    authority: { routingOmissions: true, candidateAcceptance: true, repairAcceptance: true, learningPromotion: true }
  }));
});
