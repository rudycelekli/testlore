import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { assessmentImportProof, verifyAssessmentImportRawEvidence } from '../scripts/assessment-import-proof.js';
test('raw installed-transport verifier rejects changed exit evidence and inflated authority even with updated hashes', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'testlore-assessment-proof-'));
  t.after(() => fs.rmSync(root, {recursive:true,force:true}));
  const directory = path.join(root, 'raw');
  // This unit exercises the verifier with the source CLI; packed-proof runs it
  // separately against the actual production-only installed sealed archive.
  const proof = assessmentImportProof({ project: root, cli: fileURLToPath(new URL('../src/cli.js',import.meta.url)), evidenceDirectory: directory });
  assert.equal(verifyAssessmentImportRawEvidence(directory, proof), true);
  for (const [file, mutate] of [
    ['guardana.process.json', value => { value.exitCode = 2; }],
    ['guardana.stdout.json', value => { value.assessments[0].authority.routingOmissions = true; }],
    ['ifixai.stdout.json', value => { value.assessments[0].outcome = 'reported-clean'; }],
    ['unsupported.stdout.json', value => { value.assessments[0].importComplete = true; }]
  ]) {
    const target = path.join(directory, file), before = fs.readFileSync(target);
    const candidate = structuredClone(proof), value = JSON.parse(before); mutate(value);
    const changed = Buffer.from(JSON.stringify(value)); fs.writeFileSync(target, changed);
    const record = candidate.rawEvidence.find(item => item.file === file);
    record.bytes = changed.length; record.sha256 = createHash('sha256').update(changed).digest('hex');
    assert.throws(() => verifyAssessmentImportRawEvidence(directory, candidate));
    fs.writeFileSync(target, before);
  }
});
