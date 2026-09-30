import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createPublicKey, verify } from 'node:crypto';
import { initializeWitness, beginObservation, observeQuality, inspectEvidenceLoop, challengeEvidence, reviewEvidence, recallOutcomeLessons } from '../src/evidence-loop.js';
import { digest } from '../src/provenance.js';
import { recallLessons } from '../src/learning.js';
import { fixture, write, commit, git, twoModules } from './helpers.js';

const nativeConfig = { adapter: 'node', discovery: 'native', runner: [process.execPath, '--test', '{files}'] };
const journalFile = root => path.join(root, '.tddswarm/loop/journal.jsonl');
const canonical = value => JSON.stringify(value && typeof value === 'object' ? Array.isArray(value) ? value.map(v => JSON.parse(canonical(v))) : Object.fromEntries(Object.keys(value).sort().map(k => [k, JSON.parse(canonical(value[k]))])) : value);
function setup(t, { files = {}, config = {} } = {}) {
  const root = fixture(t, { ...twoModules, 'tddswarm.config.json': { ...nativeConfig, ...config }, ...files });
  commit(root);
  // This trust file is retained outside the project and never inferred from its journal.
  const trustRoot = fixture(t), trustedKey = path.join(trustRoot, 'recorder-public.pem');
  const initialized = initializeWitness(root, { output: trustedKey });
  return { root, trustRoot, trustedKey, initialized };
}
function observe(t, options = {}) {
  const state = setup(t, options);
  return { ...state, observation: observeQuality(state.root, { revision: 'ledger-v1', base: 'HEAD', ...options.observation }) };
}
function records(root) { return fs.readFileSync(journalFile(root), 'utf8').trimEnd().split('\n').map(line => JSON.parse(line)); }
function saveRecords(root, values) { fs.writeFileSync(journalFile(root), values.map(value => JSON.stringify(value)).join('\n') + '\n'); }
function pinned(state, checkpoint) {
  const file = path.join(state.trustRoot, 'checkpoint.json');
  fs.writeFileSync(file, JSON.stringify(checkpoint));
  return file;
}
function challenge(state, claim = 'observed-pass') { return challengeEvidence(state.root, { trustedKey: state.trustedKey, id: state.observation.id, claim }); }
function review(state, claim = 'observed-pass', verdict = 'accepted') {
  return reviewEvidence(state.root, { trustedKey: state.trustedKey, id: state.observation.id, claim, verdict, reviewer: 'independent-reviewer' });
}

test('real native full-shadow passing observation produces independently verified signed records', t => {
  const state = observe(t), { root, trustedKey, observation } = state;
  assert.equal(observation.status, 'passed'); assert.equal(observation.complete, true);
  assert.deepEqual(observation.cases, { passed: 2, failed: 0, skipped: 0, other: 0 });
  assert.equal(observation.exitCode, 0); assert.equal(observation.routingMisses, 0);
  const receipt = JSON.parse(fs.readFileSync(observation.receipt, 'utf8'));
  assert.equal(receipt.executed, true); assert.equal(receipt.shadow, true); assert.equal(receipt.complete, true);
  assert.equal(receipt.plan.discovery.adapter, 'node'); assert.equal(receipt.plan.discovery.complete, true);
  assert.notEqual(receipt.plan.diagnostic, true); assert.equal(receipt.comparison.complete, true);
  assert.equal(receipt.tests.length, 2); assert.ok(receipt.tests.every(value => value.status === 'passed'));
  assert.equal(observation.revision.servingRevisionVerified, false); assert.equal(observation.deploymentSafety, 'not-established');
  const key = createPublicKey(fs.readFileSync(trustedKey)), values = records(root);
  assert.equal(key.asymmetricKeyType, 'ed25519'); assert.equal(values.length, 2);
  for (const [index, record] of values.entries()) {
    assert.equal(record.payload.sequence, index + 1);
    assert.equal(record.payload.previous, index ? values[index - 1].hash : null);
    assert.equal(record.hash, digest(canonical({ payload: record.payload, signature: record.signature })));
    assert.equal(verify(null, Buffer.from(`TestLore evidence loop v1\0${canonical(record.payload)}`), key, Buffer.from(record.signature, 'base64url')), true);
  }
  assert.equal(values[1].payload.receiptHash, digest(fs.readFileSync(observation.receipt)));
  const result = inspectEvidenceLoop(root, { trustedKey });
  assert.equal(result.valid, true); assert.equal(result.complete, true); assert.equal(result.health, 'recorded');
  assert.equal(challenge(state).supported, true); assert.equal(challenge(state, 'no-observed-routing-miss').supported, true);
});

test('actual source defect fails the observed-pass claim while a complete route can still catch every observed failure', t => {
  const state = setup(t);
  write(state.root, 'src/a.js', 'export const a = 99;');
  state.observation = observeQuality(state.root, { revision: 'ledger-defect', base: 'HEAD' });
  assert.equal(state.observation.status, 'failed'); assert.equal(state.observation.complete, true);
  assert.equal(state.observation.cases.failed, 1); assert.equal(state.observation.cases.passed, 1);
  assert.notEqual(state.observation.exitCode, 0);
  assert.equal(challenge(state).supported, false);
  assert.ok(challenge(state).reasons.includes('not-all-observed-cases-passed'));
  assert.equal(challenge(state, 'no-observed-routing-miss').supported, true);
  assert.throws(() => review(state), /Unsupported claims/);
  assert.equal(review(state, 'observed-pass', 'rejected').recorded, true);
});

test('full-shadow evidence detects a genuine failing case omitted by proposed routing', t => {
  const state = setup(t, { files: { 'src/b.js': 'export const b = 99;' } });
  write(state.root, 'src/a.js', 'export const a = 1; // changed input');
  state.observation = observeQuality(state.root, { revision: 'ledger-routing-miss', base: 'HEAD' });
  const receipt = JSON.parse(fs.readFileSync(state.observation.receipt, 'utf8'));
  assert.deepEqual(receipt.plan.selected, ['test/a.test.js']);
  assert.equal(state.observation.complete, true); assert.equal(state.observation.routingMisses, 1);
  assert.equal(challenge(state, 'no-observed-routing-miss').supported, false);
  assert.throws(() => review(state, 'no-observed-routing-miss'), /Unsupported claims/);
});

test('real runner timeout records incomplete execution and never supports success', t => {
  const state = observe(t, { config: { discovery: 'static', runnerTimeoutMs: 400 }, files: {
    'test/a.test.js': "import test from 'node:test';test('slow case',async()=>{await new Promise(resolve=>setTimeout(resolve,2000));});"
  } });
  assert.equal(state.observation.status, 'incomplete'); assert.equal(state.observation.complete, false);
  assert.equal(state.observation.exitCode, 2); assert.equal(challenge(state).supported, false);
  const receipt = JSON.parse(fs.readFileSync(state.observation.receipt, 'utf8'));
  assert.equal(receipt.executed, true); assert.match(receipt.error, /timed out|ETIMEDOUT/);
  assert.equal(challenge(state, 'no-observed-routing-miss').supported, false);
});

test('expired deadline remains incomplete even when native cases pass', t => {
  const state = observe(t, { observation: { deadlineMs: 1 } });
  assert.equal(state.observation.status, 'incomplete'); assert.equal(state.observation.exitCode, 2);
  const assessment = challenge(state);
  assert.equal(assessment.supported, false); assert.ok(assessment.reasons.includes('observation-deadline-exceeded'));
});

test('config errors produce a signed not-started witness instead of recycling last-run evidence', t => {
  const state = observe(t);
  write(state.root, 'tddswarm.config.json', '{malformed');
  state.observation = observeQuality(state.root, { revision: 'broken-config' });
  assert.equal(state.observation.status, 'not-started'); assert.equal(state.observation.complete, false);
  assert.equal(state.observation.exitCode, 2); assert.deepEqual(state.observation.cases, { passed: 0, failed: 0, skipped: 0, other: 0 });
  assert.equal(challenge(state).supported, false); assert.equal(records(state.root).length, 4);
  const receipt = JSON.parse(fs.readFileSync(state.observation.receipt, 'utf8'));
  assert.equal(receipt.executed, false); assert.equal(receipt.complete, false); assert.ok(receipt.error);
});

test('registered observations without a witness become stalled and cannot be reviewed', t => {
  const state = setup(t), registration = beginObservation(state.root, { revision: 'registered-only', deadlineMs: 1000 });
  const pending = inspectEvidenceLoop(state.root, { trustedKey: state.trustedKey, now: registration.payload.at });
  assert.equal(pending.health, 'awaiting-evidence'); assert.equal(pending.complete, false);
  const expired = inspectEvidenceLoop(state.root, { trustedKey: state.trustedKey, now: registration.payload.deadline });
  assert.equal(expired.health, 'recorder-unhealthy'); assert.equal(expired.attempts[0].recorder, 'stalled');
  const assessment = challengeEvidence(state.root, { trustedKey: state.trustedKey, id: registration.id, claim: 'observed-pass' });
  assert.equal(assessment.supported, false); assert.deepEqual(assessment.reasons, ['expected-result-missing']);
  assert.throws(() => reviewEvidence(state.root, { trustedKey: state.trustedKey, id: registration.id, claim: 'observed-pass', verdict: 'rejected', reviewer: 'reviewer' }), /Missing observation|requires a witness/);
  assert.equal(records(state.root).length, 1);
});

test('inspection requires explicit independent trust and rejects a different recorder', t => {
  const state = observe(t), other = setup(t);
  for (const trustedKey of [undefined, other.trustedKey]) {
    const result = inspectEvidenceLoop(state.root, { trustedKey });
    assert.equal(result.valid, false); assert.equal(result.authority, 'none'); assert.equal(result.complete, false);
    assert.equal(challengeEvidence(state.root, { trustedKey, id: state.observation.id, claim: 'observed-pass' }).supported, false);
  }
  assert.equal(inspectEvidenceLoop(state.root, { trustedKey: state.trustedKey }).valid, true);
});

test('payload tampering remains untrusted after an attacker recomputes the unsigned hash', t => {
  const state = observe(t), values = records(state.root);
  values[1].payload.status = 'failed';
  values[1].hash = digest(canonical({ payload: values[1].payload, signature: values[1].signature }));
  saveRecords(state.root, values);
  const result = inspectEvidenceLoop(state.root, { trustedKey: state.trustedKey });
  assert.equal(result.valid, false); assert.match(result.error, /signature or digest mismatch/);
  assert.equal(challenge(state).authority, 'none'); assert.throws(() => review(state), /untrusted or invalid/);
  assert.equal(recallOutcomeLessons(state.root, { trustedKey: state.trustedKey, query: 'ledger' }).lessons.length, 0);
});

test('changed, missing and oversized native receipts break observation claims and recalled lessons', t => {
  for (const mutation of ['changed', 'missing', 'oversized']) {
    const state = observe(t); review(state);
    if (mutation === 'changed') fs.appendFileSync(state.observation.receipt, ' ');
    else if (mutation === 'missing') fs.unlinkSync(state.observation.receipt);
    else fs.writeFileSync(state.observation.receipt, 'x'.repeat(16 * 1024 * 1024 + 1));
    const result = inspectEvidenceLoop(state.root, { trustedKey: state.trustedKey });
    assert.equal(result.complete, false); assert.equal(result.health, 'recorder-unhealthy'); assert.equal(result.attempts[0].recorder, 'broken');
    assert.equal(challenge(state).supported, false); assert.throws(() => review(state, 'no-observed-routing-miss'), /Unsupported claims/);
    assert.deepEqual(recallOutcomeLessons(state.root, { trustedKey: state.trustedKey, query: 'ledger' }).lessons, []);
  }
});

test('reordering, deleting an interior record and incomplete final records are rejected', t => {
  for (const mutation of ['reorder', 'interior', 'partial']) {
    const state = observe(t); review(state); const values = records(state.root);
    if (mutation === 'reorder') saveRecords(state.root, [values[1], values[0], values[2]]);
    else if (mutation === 'interior') saveRecords(state.root, [values[0], values[2]]);
    else fs.writeFileSync(journalFile(state.root), JSON.stringify(values[0]));
    assert.equal(inspectEvidenceLoop(state.root, { trustedKey: state.trustedKey }).valid, false);
    assert.equal(challenge(state).authority, 'none');
  }
});

test('independently pinned checkpoint detects deletion of a valid journal suffix', t => {
  const state = observe(t), outcome = review(state), checkpoint = pinned(state, outcome.checkpoint), values = records(state.root);
  assert.equal(inspectEvidenceLoop(state.root, { trustedKey: state.trustedKey, checkpoint }).externallyAnchored, true);
  saveRecords(state.root, values.slice(0, 2));
  // The retained signatures alone cannot detect suffix deletion; the external anchor can.
  assert.equal(inspectEvidenceLoop(state.root, { trustedKey: state.trustedKey }).valid, true);
  const result = inspectEvidenceLoop(state.root, { trustedKey: state.trustedKey, checkpoint });
  assert.equal(result.valid, false); assert.match(result.error, /checkpoint.*suffix is missing/);
  assert.equal(challengeEvidence(state.root, { trustedKey: state.trustedKey, checkpoint, id: state.observation.id, claim: 'observed-pass' }).authority, 'none');
});

test('unsupported deployment and learning effectiveness claims cannot be accepted', t => {
  const state = observe(t);
  for (const claim of ['deployment-safe', 'learning-gain']) {
    const assessment = challenge(state, claim);
    assert.equal(assessment.supported, false); assert.equal(assessment.deploymentSafety, 'not-established');
    assert.throws(() => review(state, claim), /Unsupported claims/);
    assert.equal(review(state, claim, 'rejected').advisoryOnly, true);
  }
  const result = inspectEvidenceLoop(state.root, { trustedKey: state.trustedKey });
  assert.equal(result.authority, 'historical-observation-only'); assert.equal(result.attempts[0].servingRevisionVerified, false);
  assert.ok(result.attempts[0].outcomes.every(value => value.identityVerified === false));
  const lessons = recallOutcomeLessons(state.root, { trustedKey: state.trustedKey, query: 'ledger' });
  assert.equal(lessons.improvementDemonstrated, false); assert.equal(lessons.authority, 'none');
});

test('duplicate outcomes cannot overwrite review or corrupt the signed journal', t => {
  const state = observe(t); review(state); const before = fs.readFileSync(journalFile(state.root));
  assert.throws(() => review(state, 'observed-pass', 'rejected'), /duplicate witness\/outcome/);
  assert.deepEqual(fs.readFileSync(journalFile(state.root)), before);
  assert.equal(inspectEvidenceLoop(state.root, { trustedKey: state.trustedKey }).valid, true);
  assert.equal(records(state.root).length, 3);
});

test('only reviewed relevant historical outcomes enter advisory recall and inspection runs no runner', t => {
  const state = observe(t);
  assert.deepEqual(recallOutcomeLessons(state.root, { trustedKey: state.trustedKey, query: 'ledger' }).lessons, []);
  review(state);
  const before = fs.readFileSync(journalFile(state.root)), receipt = fs.readFileSync(state.observation.receipt);
  // If any read API executes the configured runner it creates this marker.
  write(state.root, 'sentinel.cjs', "require('node:fs').writeFileSync('runner-was-executed','unexpected');process.exit(99);");
  write(state.root, 'tddswarm.config.json', { ...nativeConfig, runner: [process.execPath, 'sentinel.cjs', '{files}'] });
  assert.equal(inspectEvidenceLoop(state.root, { trustedKey: state.trustedKey }).valid, true);
  assert.equal(challenge(state).supported, true);
  const recalled = recallOutcomeLessons(state.root, { trustedKey: state.trustedKey, query: 'ledger' });
  assert.equal(recalled.lessons.length, 1); assert.equal(recalled.advisoryOnly, true); assert.equal(recalled.authority, 'none');
  assert.equal(recalled.lessons[0].evidenceId, state.observation.id); assert.equal(recalled.lessons[0].historical, true);
  assert.equal(recalled.lessons[0].routingAuthority, 'none'); assert.equal(recalled.lessons[0].reviewerIdentity, 'operator-asserted');
  assert.deepEqual(recallOutcomeLessons(state.root, { trustedKey: state.trustedKey, query: 'unrelatedxyz' }).lessons, []);
  assert.equal(fs.existsSync(path.join(state.root, 'runner-was-executed')), false);
  assert.deepEqual(fs.readFileSync(journalFile(state.root)), before); assert.deepEqual(fs.readFileSync(state.observation.receipt), receipt);
  write(state.root, 'tddswarm.config.json', { ...nativeConfig, learning: { enabled: false } });
  const disabled = recallOutcomeLessons(state.root, { trustedKey: state.trustedKey, query: 'ledger' });
  assert.equal(disabled.reason, 'learning-disabled'); assert.deepEqual(disabled.lessons, []);
});

test('symlinked journal, receipt, key and evidence directories fail closed', t => {
  for (const target of ['journal', 'receipt', 'trustedKey', 'directory']) {
    const state = observe(t), outside = fixture(t);
    const file = target === 'journal' ? journalFile(state.root) : target === 'receipt' ? state.observation.receipt : target === 'trustedKey' ? state.trustedKey : path.join(state.root, '.tddswarm/loop');
    const moved = path.join(outside, 'artifact'); fs.renameSync(file, moved); fs.symlinkSync(moved, file);
    const before = target === 'directory' ? fs.readFileSync(path.join(moved, 'journal.jsonl')) : fs.readFileSync(moved);
    const result = inspectEvidenceLoop(state.root, { trustedKey: state.trustedKey });
    if (target === 'receipt') { assert.equal(result.complete, false); assert.equal(result.attempts[0].recorder, 'broken'); }
    else assert.equal(result.valid, false);
    assert.equal(challenge(state).supported, false);
    assert.throws(() => review(state), /Unsupported claims|untrusted or invalid/);
    assert.deepEqual(target === 'directory' ? fs.readFileSync(path.join(moved, 'journal.jsonl')) : fs.readFileSync(moved), before);
  }
});

test('initialization refuses silent key replacement and unsafe writer paths', t => {
  const state = setup(t), before = fs.readFileSync(state.trustedKey);
  assert.throws(() => initializeWitness(state.root, { output: state.trustedKey }), /already exists/);
  assert.throws(() => initializeWitness(state.root, { output: path.join(state.trustRoot, 'replacement.pem') }), /already initialized/);
  assert.deepEqual(fs.readFileSync(state.trustedKey), before);
  const root = fixture(t), outside = fixture(t);
  fs.mkdirSync(path.join(root, '.tddswarm')); fs.symlinkSync(outside, path.join(root, '.tddswarm/loop'));
  assert.throws(() => initializeWitness(root, { output: path.join(state.trustRoot, 'unsafe.pem') }), /Symlink/);
  assert.deepEqual(fs.readdirSync(outside), []);
});

test('native output above the receipt bound leaves its signed expected observation pending', t => {
  const state = setup(t, { files: {
    'test/a.test.js': "import test from 'node:test';test('large actual output',()=>{console.log('x'.repeat(17*1024*1024));});"
  } });
  assert.throws(() => observeQuality(state.root, { revision: 'large-native-output', base: 'HEAD' }), /Native receipt exceeds witness size limit/);
  const values = records(state.root); assert.equal(values.length, 1); assert.equal(values[0].payload.type, 'expected');
  assert.equal(fs.existsSync(path.join(state.root, '.tddswarm/loop/receipts', `${values[0].payload.id}.json`)), false);
  const result = inspectEvidenceLoop(state.root, { trustedKey: state.trustedKey, now: values[0].payload.deadline });
  assert.equal(result.complete, false); assert.equal(result.attempts[0].recorder, 'stalled');
});

test('journal byte and record limits fail closed without rewriting the evidence', t => {
  for (const content of ['x'.repeat(8 * 1024 * 1024 + 1), '{}\n'.repeat(1001), 'x'.repeat(32769) + '\n']) {
    const state = setup(t); fs.writeFileSync(journalFile(state.root), content);
    assert.equal(inspectEvidenceLoop(state.root, { trustedKey: state.trustedKey }).valid, false);
    assert.throws(() => beginObservation(state.root, { revision: 'bounded-input' }), /limit/);
    assert.equal(fs.readFileSync(journalFile(state.root), 'utf8'), content);
  }
});

test('clock regression rejects a new record before it corrupts valid historical evidence', t => {
  const state = setup(t), clock = t.mock.method(Date, 'now', () => 2000);
  beginObservation(state.root, { revision: 'first-timestamp' }); const before = fs.readFileSync(journalFile(state.root));
  clock.mock.mockImplementation(() => 1000);
  assert.throws(() => beginObservation(state.root, { revision: 'backward-timestamp' }), /clock moved backwards/);
  clock.mock.restore();
  assert.deepEqual(fs.readFileSync(journalFile(state.root)), before);
  assert.equal(inspectEvidenceLoop(state.root, { trustedKey: state.trustedKey }).valid, true);
});

test('recorder secret stays private and untracked even without a project-wide ignore policy', t => {
  const state = setup(t, { files: { '.gitignore': '' } });
  const untracked = git(state.root, 'ls-files', '--others', '--exclude-standard').split('\n');
  assert.ok(!untracked.some(file => file.startsWith('.tddswarm/loop/')));
  const privateKey = path.join(state.root, '.tddswarm/loop/private.pem');
  if (process.platform !== 'win32') assert.equal(fs.statSync(privateKey).mode & 0o077, 0);
  beginObservation(state.root, { revision: 'private-recorder' });
  if (process.platform !== 'win32') {
    fs.chmodSync(privateKey, 0o644); const before = fs.readFileSync(journalFile(state.root));
    assert.throws(() => beginObservation(state.root, { revision: 'unsafe-permissions' }), /private file permissions/);
    assert.deepEqual(fs.readFileSync(journalFile(state.root)), before);
  }
});

test('opted-in learning context admits only reviewed topic-relevant outcomes within its response budget', t => {
  const state = observe(t, { observation: { revision: 'revision-7bd903', focus: 'ledger normalization' } });
  const config = { ...nativeConfig, learning: { enabled: true, outcomes: { trustedKey: state.trustedKey } } };
  const options = { config, contract: 'Ledger balances preserve normalization.' };
  assert.deepEqual(recallLessons(state.root, 'ledger', options).reviewedOutcomes, []);
  const outcome = review(state); config.learning.outcomes.checkpoint = pinned(state, outcome.checkpoint);
  const relevant = recallLessons(state.root, 'ledger', options);
  assert.equal(relevant.reviewedOutcomes.length, 1); assert.equal(relevant.advisoryOnly, true);
  const lesson = relevant.reviewedOutcomes[0];
  assert.equal(lesson.evidenceId, state.observation.id); assert.equal(lesson.focus, 'ledger normalization');
  assert.equal(lesson.sourceCompatible, true); assert.equal(lesson.sourceFingerprint, state.observation.sourceFingerprint);
  assert.equal(lesson.advisoryOnly, true); assert.equal(lesson.historical, true); assert.equal(lesson.routingAuthority, 'none');
  assert.equal(lesson.reviewerIdentity, 'operator-asserted');
  assert.equal(recallLessons(state.root, 'ledger', { contract: options.contract }).reviewedOutcomes, undefined);
  assert.deepEqual(recallLessons(state.root, 'unrelatedxyz', options).reviewedOutcomes, []);
  assert.deepEqual(recallLessons(state.root, 'ledger', { ...options, contract: 'Unicode text preserves whitespace.' }).reviewedOutcomes, []);
  for (const maxChars of [256, 600, 1000]) {
    const bounded = recallLessons(state.root, 'ledger', { ...options, maxChars });
    assert.ok(JSON.stringify(bounded).length <= maxChars);
  }
  const disabled = recallLessons(state.root, 'ledger', { ...options, config: { ...config, learning: { ...config.learning, enabled: false } } });
  assert.equal(disabled.reason, 'learning-disabled'); assert.equal(disabled.reviewedOutcomes, undefined);
  const values = records(state.root); values[1].signature = 'A'.repeat(86); saveRecords(state.root, values);
  const corrupted = recallLessons(state.root, 'ledger', options);
  assert.deepEqual(corrupted.reviewedOutcomes, []); assert.equal(corrupted.advisoryOnly, true);
  assert.ok(corrupted.warnings.some(value => /outcome history unavailable/.test(value)));
});
