// Actual installed CLI transport over owned native-shaped synthetic reports.
// This qualifies packaging and refusal behavior, not upstream evaluator efficacy.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { safePath } from '../src/files.js';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const cases = [
  { id: 'guardana', plugin: 'guardana', fixture: 'guardana-clean-v17.json', exit: 0, outcome: 'reported-clean', complete: true },
  { id: 'ifixai', plugin: 'ifixai', fixture: 'ifixai-native.json', exit: 2, outcome: 'incomplete', complete: true },
  { id: 'unsupported', plugin: 'guardana', fixture: null, exit: 2, outcome: 'incomplete', complete: false }
];
export function assessmentImportProof({ project, cli, evidenceDirectory, archiveSha256, installedManifestSha256, sourceRevision }) {
  fs.mkdirSync(evidenceDirectory, { recursive: true });
  const rawEvidence = [], outcomes = [];
  function record(file, bytes) {
    fs.writeFileSync(path.join(evidenceDirectory, file), bytes, { flag: 'wx', mode: 0o600 });
    rawEvidence.push({ file, bytes: Buffer.byteLength(bytes), sha256: digest(bytes) });
  }
  for (const item of cases) {
    const input = item.fixture ? fs.readFileSync(new URL(`../test/fixtures/assessments/${item.fixture}`, import.meta.url)) : Buffer.from('{"schema_version":999,"score":100}');
    const relative = `.tddswarm/assessment-input/${item.id}.json`;
    const file = path.join(project, relative); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, input);
    const result = spawnSync(process.execPath, [cli, 'assess', '--root', project, '--plugin', item.plugin, '--report', relative, '--json'], { encoding: 'utf8', timeout: 10000, maxBuffer: 1024 * 1024, shell: false });
    record(`${item.id}.input.json`, input); record(`${item.id}.stdout.json`, result.stdout || ''); record(`${item.id}.stderr.txt`, result.stderr || '');
    record(`${item.id}.process.json`, JSON.stringify({ exitCode: result.status, signal: result.signal, spawnError: Boolean(result.error) }));
    const receipt = JSON.parse(result.stdout);
    assert.match(receipt.receipt, /^\.tddswarm\/assessments\/[a-f0-9-]{36}\.json$/);
    const persisted = fs.readFileSync(safePath(project, receipt.receipt));
    const { receipt: receiptPath, ...stored } = receipt;
    assert.deepEqual(JSON.parse(persisted), stored, 'Installed CLI must persist its reported assessment receipt');
    record(`${item.id}.receipt.json`, persisted);
    assert.equal(result.status, item.exit, result.stderr); assert.equal(receipt.exitCode, item.exit);
    assert.equal(receipt.assessments[0].outcome, item.outcome); assert.equal(receipt.assessments[0].importComplete, item.complete);
    assert.equal(receipt.assessments[0].currentBinding, 'unverified'); assert.deepEqual(Object.values(receipt.assessments[0].authority), [false,false,false,false]);
    assert.equal(receipt.nativeVerificationExecuted, false); assert.equal(receipt.providerCalls, 0);
    if (item.complete) assert.equal(receipt.assessments[0].source.sha256, digest(input));
    outcomes.push({ id: item.id, exitCode: item.exit, outcome: item.outcome });
  }
  const proof = { verified: true, mode: 'installed-cli-synthetic-report-import', liveEvaluation: false, providerCalls: 0,
    archiveSha256, installedManifestSha256, sourceRevision, installedCliSha256: digest(fs.readFileSync(cli)),
    proofScriptSha256: digest(fs.readFileSync(fileURLToPath(import.meta.url))), outcomes, rawEvidence };
  verifyAssessmentImportRawEvidence(evidenceDirectory, proof);
  return proof;
}
export function assessmentImportEvidenceComplete(proof) {
  return proof?.verified === true && proof.mode === 'installed-cli-synthetic-report-import' && proof.liveEvaluation === false && proof.providerCalls === 0 &&
    [proof.archiveSha256,proof.installedManifestSha256,proof.installedCliSha256,proof.proofScriptSha256].every(value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)) &&
    typeof proof.sourceRevision === 'string' && /^[a-f0-9]{40}$/.test(proof.sourceRevision) &&
    JSON.stringify(proof.outcomes) === JSON.stringify(cases.map(item => ({ id: item.id, exitCode: item.exit, outcome: item.outcome }))) &&
    Array.isArray(proof.rawEvidence) && proof.rawEvidence.length === 15 && new Set(proof.rawEvidence.map(item => item.file)).size === 15 &&
    proof.rawEvidence.every(item => /^(guardana|ifixai|unsupported)\.(input\.json|stdout\.json|stderr\.txt|process\.json|receipt\.json)$/.test(item.file) && Number.isSafeInteger(item.bytes) && item.bytes >= 0 && /^[a-f0-9]{64}$/.test(item.sha256));
}
export function verifyAssessmentImportRawEvidence(directory, proof) {
  assert.equal(assessmentImportEvidenceComplete(proof), true, 'Installed assessment import proof is incomplete');
  for (const record of proof.rawEvidence) {
    const file = path.join(directory, record.file); assert.equal(fs.lstatSync(file).isFile(), true);
    const bytes = fs.readFileSync(file); assert.equal(bytes.length, record.bytes); assert.equal(digest(bytes), record.sha256);
  }
  for (const item of cases) {
    const result = JSON.parse(fs.readFileSync(path.join(directory, `${item.id}.stdout.json`)));
    const stored = JSON.parse(fs.readFileSync(path.join(directory, `${item.id}.receipt.json`)));
    assert.match(result.receipt, /^\.tddswarm\/assessments\/[a-f0-9-]{36}\.json$/);
    const { receipt: receiptPath, ...reported } = result; assert.deepEqual(stored, reported);
    const process = JSON.parse(fs.readFileSync(path.join(directory, `${item.id}.process.json`)));
    assert.deepEqual(process, { exitCode: item.exit, signal: null, spawnError: false });
    assert.equal(result.exitCode, item.exit); assert.equal(result.nativeVerificationExecuted, false); assert.equal(result.providerCalls, 0);
    assert.equal(result.assessments.length, 1);
    const assessment = result.assessments[0]; assert.equal(assessment.plugin, item.plugin); assert.equal(assessment.outcome, item.outcome);
    assert.equal(assessment.importComplete, item.complete); assert.equal(assessment.currentBinding, 'unverified'); assert.equal(assessment.advisory, true);
    assert.deepEqual(assessment.authority, { routingOmissions: false, candidateAcceptance: false, repairAcceptance: false, learningPromotion: false });
    if (item.complete) assert.equal(assessment.source.sha256, digest(fs.readFileSync(path.join(directory, `${item.id}.input.json`))));
  }
  return true;
}
