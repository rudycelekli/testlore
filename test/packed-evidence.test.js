import test from 'node:test';
import assert from 'node:assert/strict';
import {packedEvidenceComplete} from '../scripts/packed-evidence.js';

const identity = 'a'.repeat(40), archive = 'b'.repeat(64), manifest = 'c'.repeat(64), source = 'd'.repeat(64), proof = 'e'.repeat(64);
const receipt = {schemaVersion: 1, qualified: true, sourceRevision: identity, archiveSha256: archive, packedManifestSha256: manifest, sourceManifestSha256: source, version: '0.1.0', archiveRecipe: 'tracked-source-with-exact-gitHead'};
const evidence = {schemaVersion: 1, sha256: archive, version: '0.1.0', exactInputArchive: true, productionInstall: true, shadowSetupVerified: true, mcpStdioVerified: true, mcpShadowVerified: true, briefInspectionVerified: true, actionIdentityVerified: true, runtimeCaptureComplete: true, proofScriptSha256: proof, packedManifestSha256: manifest, actionReference: identity, workflowActionReference: identity, nativeShadow: {complete: true, detected: true, selected: ['test/a.test.js'], executed: 2}, improvement: {status: 'ready-for-review', cases: 3, originalBranch: 'main'}};
const context = {proofScriptSha256: proof, sourceManifestSha256: source};

test('installed qualification requires explicit evidence for persisted shadow and generated Action identity', () => {
  assert.equal(packedEvidenceComplete(receipt, evidence, context), true);
  for (const field of ['exactInputArchive', 'productionInstall', 'shadowSetupVerified', 'mcpStdioVerified', 'mcpShadowVerified', 'briefInspectionVerified', 'actionIdentityVerified', 'runtimeCaptureComplete']) {
    for (const value of [undefined, false, 'true']) assert.equal(packedEvidenceComplete(receipt, {...evidence, [field]: value}, context), false, field + ':' + value);
  }
  assert.equal(packedEvidenceComplete({...receipt, qualified: 'true'}, evidence, context), false);
  for (const field of ['complete', 'detected']) for (const value of [undefined, false, 'true']) assert.equal(packedEvidenceComplete(receipt, {...evidence, nativeShadow: {...evidence.nativeShadow, [field]: value}}, context), false);
});

test('installed qualification rejects lineage, manifest, fixture scope and proof producer drift', () => {
  for (const field of ['sha256', 'packedManifestSha256', 'proofScriptSha256', 'actionReference', 'workflowActionReference']) assert.equal(packedEvidenceComplete(receipt, {...evidence, [field]: '0'.repeat(64)}, context), false, field);
  assert.equal(packedEvidenceComplete({...receipt, packedManifestSha256: undefined}, {...evidence, packedManifestSha256: undefined}, context), false);
  assert.equal(packedEvidenceComplete(receipt, {...evidence, nativeShadow: {...evidence.nativeShadow, executed: 1}}, context), false);
  assert.equal(packedEvidenceComplete(receipt, {...evidence, improvement: {...evidence.improvement, cases: 0}}, context), false);
  assert.equal(packedEvidenceComplete(receipt, evidence, {...context, sourceManifestSha256: 'f'.repeat(64)}), false);
});
