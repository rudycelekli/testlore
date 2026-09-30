import fs from 'node:fs';
import path from 'node:path';
import { generateKeyPairSync, createPrivateKey, createPublicKey, sign, verify, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { safePath, readConfig } from './files.js';
import { digest } from './provenance.js';
import { run } from './runner.js';

const DIRECTORY = '.tddswarm/loop', JOURNAL = `${DIRECTORY}/journal.jsonl`;
const MAX_BYTES = 8 * 1024 * 1024, MAX_EVENTS = 1000, MAX_RECEIPT = 16 * 1024 * 1024;
const hash = z.string().regex(/^[a-f0-9]{64}$/), uuid = z.string().uuid();
const label = z.string().min(1).max(200).regex(/^[^\x00-\x1f]*$/);
const claimSchema = z.enum(['observed-pass', 'no-observed-routing-miss', 'deployment-safe', 'learning-gain']);
const common = { schemaVersion: z.literal(1), sequence: z.number().int().min(1).max(MAX_EVENTS), previous: hash.nullable(), keyId: hash, at: z.number().int().nonnegative() };
const expectedSchema = z.strictObject({ ...common, type: z.literal('expected'), id: uuid, revision: label, focus: label.optional(), deadline: z.number().int().nonnegative() });
const witnessedSchema = z.strictObject({ ...common, type: z.literal('witness'), id: uuid, receiptHash: hash, status: z.enum(['passed', 'failed', 'incomplete', 'not-started']), exitCode: z.number().int().nullable(), complete: z.boolean(), cases: z.strictObject({ passed: z.number().int().nonnegative(), failed: z.number().int().nonnegative(), skipped: z.number().int().nonnegative(), other: z.number().int().nonnegative() }), sourceFingerprint: hash.nullable(), sourceRevision: z.string().max(200).nullable(), routingMisses: z.number().int().nonnegative().nullable() });
const outcomeSchema = z.strictObject({ ...common, type: z.literal('outcome'), id: uuid, claim: claimSchema, verdict: z.enum(['accepted', 'rejected']), reviewer: label, challengeHash: hash });
const eventSchema = z.discriminatedUnion('type', [expectedSchema, witnessedSchema, outcomeSchema]);
const envelopeSchema = z.strictObject({ payload: eventSchema, signature: z.string().regex(/^[A-Za-z0-9_-]{86}$/), hash });
const checkpointSchema = z.strictObject({ schemaVersion: z.literal(1), sequence: z.number().int().min(0).max(MAX_EVENTS), hash: hash.nullable(), keyId: hash });
const canonical = value => JSON.stringify(value && typeof value === 'object' ? Array.isArray(value) ? value.map(v => JSON.parse(canonical(v))) : Object.fromEntries(Object.keys(value).sort().map(k => [k, JSON.parse(canonical(value[k]))])) : value);
const signedBytes = payload => Buffer.from(`TestLore evidence loop v1\0${canonical(payload)}`);
const keyId = key => digest((key.type === 'public' ? key : createPublicKey(key)).export({ type: 'spki', format: 'der' }));
const localPath = (root, name) => safePath(root, `${DIRECTORY}/${name}`);
function boundedRead(file, max) {
  const fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.size > max) throw new Error('Evidence artifact exceeds limit or is not a regular file');
    const bytes = fs.readFileSync(fd);
    if (bytes.length > max) throw new Error('Evidence artifact exceeds limit');
    return bytes;
  } finally { fs.closeSync(fd); }
}
function publicKey(file) {
  if (typeof file !== 'string' || !file) throw new Error('An explicitly trusted public-key file is required');
  const key = createPublicKey(boundedRead(path.resolve(file), 4096));
  if (key.asymmetricKeyType !== 'ed25519') throw new Error('Witness trust requires an Ed25519 public key');
  return key;
}
function privateKey(root) {
  const file = localPath(root, 'private.pem');
  if (process.platform !== 'win32' && (fs.statSync(file).mode & 0o077)) throw new Error('Witness private key must have private file permissions');
  const key = createPrivateKey(boundedRead(file, 4096));
  if (key.asymmetricKeyType !== 'ed25519') throw new Error('Witness private key must be Ed25519');
  return key;
}
function checkpoint(events, id) { return { schemaVersion: 1, sequence: events.length, hash: events.at(-1)?.hash || null, keyId: id }; }
function journal(root, key, anchor) {
  const file = safePath(root, JOURNAL), id = keyId(key);
  const raw = fs.existsSync(file) ? boundedRead(file, MAX_BYTES).toString('utf8') : '';
  if (raw && !raw.endsWith('\n')) throw new Error('Evidence journal has an incomplete final record');
  const lines = raw ? raw.slice(0, -1).split('\n') : [];
  if (lines.length > MAX_EVENTS) throw new Error('Evidence journal record limit exceeded');
  const events = [], attempts = new Map(), outcomes = new Set();
  for (const line of lines) {
    if (Buffer.byteLength(line) > 32768) throw new Error('Evidence record limit exceeded');
    const envelope = envelopeSchema.parse(JSON.parse(line)), p = envelope.payload;
    if (p.keyId !== id || p.sequence !== events.length + 1 || p.previous !== (events.at(-1)?.hash || null) || (events.length && p.at < events.at(-1).payload.at)) throw new Error('Evidence chain order, signer or continuity mismatch');
    if (envelope.hash !== digest(canonical({ payload: p, signature: envelope.signature })) || !verify(null, signedBytes(p), key, Buffer.from(envelope.signature, 'base64url'))) throw new Error('Evidence signature or digest mismatch');
    if (p.type === 'expected') {
      if (attempts.has(p.id) || p.deadline <= p.at) throw new Error('Invalid duplicate or expired observation');
      attempts.set(p.id, { expected: p });
    } else {
      const attempt = attempts.get(p.id);
      if (!attempt) throw new Error('Witness or outcome has no registered observation');
      if (p.type === 'witness') {
        if (attempt.witness) throw new Error('Duplicate witness');
        attempt.witness = p;
      } else {
        const identity = `${p.id}:${p.claim}`;
        if (!attempt.witness || outcomes.has(identity)) throw new Error('Outcome requires a witness and cannot be overwritten');
        outcomes.add(identity); (attempt.outcomes ||= []).push(p);
      }
    }
    events.push(envelope);
  }
  if (anchor) {
    const pinned = checkpointSchema.parse(JSON.parse(boundedRead(path.resolve(anchor), 4096)));
    if (pinned.keyId !== id || pinned.sequence > events.length || pinned.hash !== (pinned.sequence ? events[pinned.sequence - 1]?.hash : null)) throw new Error('External checkpoint does not match: evidence suffix is missing or history changed');
  }
  return { events, attempts, keyId: id, checkpoint: checkpoint(events, id), rawBytes: Buffer.byteLength(raw) };
}
function locked(root, callback) {
  const dir = safePath(root, DIRECTORY); fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const lock = localPath(root, 'writer.lock'); fs.mkdirSync(lock);
  try { return callback(); } finally { fs.rmdirSync(lock); }
}
function append(root, fields, { trustedKey, checkpoint: anchor } = {}) {
  return locked(root, () => {
    const key = privateKey(root), trust = trustedKey ? publicKey(trustedKey) : createPublicKey(key);
    if (keyId(key) !== keyId(trust)) throw new Error('Signing key does not match trusted recorder');
    const state = journal(root, trust, anchor);
    const at = Date.now();
    if (fields.type === 'expected') { const { deadlineMs, ...other } = fields; fields = { ...other, deadline: at + deadlineMs }; }
    const payload = eventSchema.parse({ schemaVersion: 1, sequence: state.events.length + 1, previous: state.events.at(-1)?.hash || null, keyId: state.keyId, at, ...fields });
    if (state.events.length && payload.at < state.events.at(-1).payload.at) throw new Error('Recorder clock moved backwards');
    const attempt = state.attempts.get(payload.id);
    if (payload.type !== 'expected' && (!attempt || (payload.type === 'witness' && attempt.witness) || (payload.type === 'outcome' && (!attempt.witness || (attempt.outcomes || []).some(o => o.claim === payload.claim))))) throw new Error('Missing observation or duplicate witness/outcome');
    const signature = sign(null, signedBytes(payload), key).toString('base64url');
    const envelope = { payload, signature, hash: digest(canonical({ payload, signature })) };
    const text = JSON.stringify(envelope) + '\n';
    if (state.rawBytes + Buffer.byteLength(text) > MAX_BYTES) throw new Error('Evidence journal is full; archive with its external checkpoint');
    const fd = fs.openSync(safePath(root, JOURNAL), fs.constants.O_WRONLY | fs.constants.O_APPEND | fs.constants.O_CREAT | (fs.constants.O_NOFOLLOW || 0), 0o600);
    try { fs.writeFileSync(fd, text); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    return { payload, checkpoint: checkpoint([...state.events, envelope], state.keyId) };
  });
}

/** Explicit opt-in creates a recorder identity. Keep the exported public key independently. */
export function initializeWitness(root, { output } = {}) {
  if (!output) throw new Error('An explicit --output public-key destination is required');
  const target = path.resolve(output);
  if (fs.existsSync(target)) throw new Error('Public-key output already exists');
  return locked(root, () => {
    const ignore = localPath(root, '.gitignore');
    if (!fs.existsSync(ignore)) fs.writeFileSync(ignore, '*\n', { flag: 'wx', mode: 0o600 });
    const keyPath = localPath(root, 'private.pem');
    if (fs.existsSync(keyPath) || fs.existsSync(safePath(root, JOURNAL))) throw new Error('Witness already initialized; keys are never silently replaced');
    const keys = generateKeyPairSync('ed25519');
    fs.writeFileSync(keyPath, keys.privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600, flag: 'wx' });
    try { fs.writeFileSync(target, keys.publicKey.export({ type: 'spki', format: 'pem' }), { flag: 'wx', mode: 0o644 }); }
    catch (error) { fs.unlinkSync(keyPath); throw error; }
    return { initialized: true, keyId: keyId(keys.publicKey), publicKey: target, trust: 'operator-must-retain-public-key-independently', authority: 'recorder-identity-only' };
  });
}
export function beginObservation(root, { revision, focus = revision, deadlineMs = 300000 } = {}) {
  label.parse(revision); label.parse(focus);
  if (!Number.isInteger(deadlineMs) || deadlineMs < 1 || deadlineMs > 3600000) throw new Error('Observation deadline must be 1..3600000ms');
  const id = randomUUID();
  const record = append(root, { type: 'expected', id, revision, focus, deadlineMs });
  return { id, ...record };
}
function classify(report, late) {
  const tests = Array.isArray(report.tests) ? report.tests : [];
  const cases = { passed: 0, failed: 0, skipped: 0, other: 0 };
  for (const test of tests) { const key = ['passed', 'failed', 'skipped'].includes(test.status) ? test.status : 'other'; cases[key]++; }
  const complete = !late && report.executed === true && report.complete === true && tests.length > 0 && report.shadow === true && report.comparison?.complete === true && report.comparison?.omittedFailures instanceof Array && report.comparison.omittedFailures.every(t => t.status === 'failed') && typeof report.provenance?.fingerprint === 'string' && /^[a-f0-9]{64}$/.test(report.provenance.fingerprint) && !cases.other;
  const status = report.executed !== true ? 'not-started' : !complete ? 'incomplete' : report.exitCode !== 0 || cases.failed ? 'failed' : 'passed';
  return { cases, complete: Boolean(complete), status, exitCode: Number.isInteger(report.exitCode) ? report.exitCode : null,
    sourceFingerprint: typeof report.provenance?.fingerprint === 'string' && /^[a-f0-9]{64}$/.test(report.provenance.fingerprint) ? report.provenance.fingerprint : null,
    sourceRevision: report.provenance?.revision || null,
    routingMisses: complete ? report.comparison.omittedFailures.length : null };
}

/** Executes the existing full shadow pipeline. Never imports old last-run.json as a new witness. */
export function observeQuality(root, options = {}) {
  const expected = beginObservation(root, options);
  let report;
  try { report = run(root, { base: options.base, shadow: true, capture: true }); }
  catch (error) { report = { executed: false, complete: false, exitCode: 2, error: String(error.message).slice(0, 2000) }; }
  const text = JSON.stringify(report), bytes = Buffer.byteLength(text);
  if (bytes > MAX_RECEIPT) throw new Error('Native receipt exceeds witness size limit; expected observation remains pending');
  const receipts = localPath(root, 'receipts'); fs.mkdirSync(receipts, { recursive: true, mode: 0o700 });
  const file = localPath(root, `receipts/${expected.id}.json`);
  fs.writeFileSync(file, text, { flag: 'wx', mode: 0o600 });
  const at = Date.now();
  const result = classify(report, at >= expected.payload.deadline);
  const record = append(root, { type: 'witness', at, id: expected.id, receiptHash: digest(text), ...result });
  return { id: expected.id, ...result, exitCode: result.complete ? result.exitCode : 2, checkpoint: record.checkpoint, receipt: file,
    revision: { declared: options.revision, servingRevisionVerified: false }, authority: 'historical-observation-only', deploymentSafety: 'not-established' };
}
function receiptFor(root, attempt) {
  const raw = boundedRead(localPath(root, `receipts/${attempt.expected.id}.json`), MAX_RECEIPT);
  if (digest(raw) !== attempt.witness.receiptHash) throw new Error('Native receipt is missing or altered');
  const report = JSON.parse(raw);
  const reconstructed = classify(report, attempt.witness.at >= attempt.expected.deadline);
  for (const key of Object.keys(reconstructed)) if (canonical(reconstructed[key]) !== canonical(attempt.witness[key])) throw new Error('Witness contradicts its native receipt');
  return report;
}
function inspect(root, options) {
  const state = journal(root, publicKey(options.trustedKey), options.checkpoint), attempts = [];
  const now = options.now ?? Date.now();
  if (!Number.isFinite(now) || now < 0) throw new Error('Invalid inspection time');
  for (const a of state.attempts.values()) {
    let recorder = a.witness ? 'recorded' : now >= a.expected.deadline ? 'stalled' : 'pending', error = null;
    if (a.witness) { try { receiptFor(root, a); } catch (e) { recorder = 'broken'; error = e.message; } }
    attempts.push({ id: a.expected.id, revision: a.expected.revision, servingRevisionVerified: false, deadline: a.expected.deadline, recorder,
      status: a.witness?.status || 'not-observed', cases: a.witness?.cases || null, sourceRevision: a.witness?.sourceRevision || null, error, outcomes: (a.outcomes || []).map(o => ({ claim: o.claim, verdict: o.verdict, reviewer: o.reviewer, identityVerified: false })) });
  }
  const bad = attempts.some(a => ['stalled', 'broken'].includes(a.recorder));
  return { state, result: { schemaVersion: 1, valid: true, complete: attempts.length > 0 && !bad && attempts.every(a => a.recorder === 'recorded'), health: bad ? 'recorder-unhealthy' : attempts.some(a => a.recorder === 'pending') ? 'awaiting-evidence' : attempts.length ? 'recorded' : 'no-observations', attempts,
    checkpoint: state.checkpoint, externallyAnchored: Boolean(options.checkpoint), authority: 'historical-observation-only', deploymentSafety: 'not-established', limitations: ['Signatures authenticate the trusted recorder; they do not prove truthful tests or a serving deployment revision.', 'Without an independently retained checkpoint, deleting a valid journal suffix cannot be detected.', 'Historical observations do not certify current source, deployment safety or learning effectiveness.'] } };
}
export function inspectEvidenceLoop(root, options = {}) {
  try { return inspect(root, options).result; }
  catch (error) { return { valid: false, complete: false, health: 'untrusted-or-invalid-evidence', error: String(error.message).slice(0, 2000), attempts: [], authority: 'none', deploymentSafety: 'not-established' }; }
}
function evaluate(root, state, { id, claim }) {
  uuid.parse(id); claimSchema.parse(claim);
  const reasons = [], attempt = state.attempts.get(id);
  if (!attempt) reasons.push('observation-not-found');
  else if (!attempt.witness) reasons.push('expected-result-missing');
  else {
    try { receiptFor(root, attempt); } catch { reasons.push('native-receipt-missing-or-altered'); }
    const w = attempt.witness;
    if (w.at >= attempt.expected.deadline) reasons.push('observation-deadline-exceeded');
    if (!w.complete) reasons.push('native-observation-incomplete');
    if (claim === 'observed-pass') {
      if (w.status !== 'passed' || !w.cases.passed || w.cases.failed || w.cases.skipped || w.cases.other) reasons.push('not-all-observed-cases-passed');
    } else if (claim === 'no-observed-routing-miss') {
      if (w.routingMisses !== 0) reasons.push('routing-miss-or-comparison-incomplete');
    }
  }
  if (claim === 'deployment-safe') reasons.push('tests-do-not-establish-deployment-safety');
  if (claim === 'learning-gain') reasons.push('independent-repeated-held-out-evaluation-required');
  return { id, claim, supported: !reasons.length, reasons, authority: 'historical-observation-only', scope: 'Registered native full-shadow observation only; subset order effects and unexercised behavior remain unknown.', deploymentSafety: 'not-established' };
}
export function challengeEvidence(root, options = {}) {
  try { const { state } = inspect(root, options); return evaluate(root, state, options); }
  catch (error) { return { id: options.id, claim: options.claim, supported: false, reasons: ['untrusted-or-invalid-evidence'], error: String(error.message).slice(0, 2000), authority: 'none', deploymentSafety: 'not-established' }; }
}
export function reviewEvidence(root, options = {}) {
  uuid.parse(options.id); claimSchema.parse(options.claim); label.parse(options.reviewer);
  if (!['accepted', 'rejected'].includes(options.verdict)) throw new Error('Outcome must be accepted or rejected');
  const assessment = challengeEvidence(root, options);
  if (assessment.authority === 'none') throw new Error('Cannot record an outcome against untrusted or invalid evidence');
  if (options.verdict === 'accepted' && !assessment.supported) throw new Error('Unsupported claims cannot be accepted');
  const outcome = append(root, { type: 'outcome', id: options.id, claim: options.claim, verdict: options.verdict, reviewer: options.reviewer, challengeHash: digest(canonical(assessment)) }, options);
  return { recorded: true, id: options.id, claim: options.claim, verdict: options.verdict, checkpoint: outcome.checkpoint, reviewerIdentity: 'operator-asserted-not-verified', advisoryOnly: true };
}
export function recallOutcomeLessons(root, options = {}) {
  if (typeof options.query !== 'string' || !options.query.trim() || options.query.length > 2000) throw new Error('A bounded lesson query is required');
  try {
    if (readConfig(root).learning?.enabled === false) return { advisoryOnly: true, authority: 'none', lessons: [], reason: 'learning-disabled' };
    const { state } = inspect(root, options);
    const query = new Set(options.query.toLowerCase().match(/[a-z0-9]+/g) || []), lessons = [];
    for (const attempt of state.attempts.values()) for (const outcome of attempt.outcomes || []) {
      const assessment = evaluate(root, state, outcome);
      if (outcome.challengeHash !== digest(canonical(assessment)) || (outcome.verdict === 'accepted' && !assessment.supported)) continue;
      const terms = new Set(`${attempt.expected.focus || attempt.expected.revision} ${outcome.claim} ${outcome.verdict} ${assessment.reasons.join(' ')}`.toLowerCase().match(/[a-z0-9]+/g) || []);
      if (![...query].some(word => terms.has(word))) continue;
      lessons.push({ evidenceId: attempt.expected.id, sourceFingerprint: attempt.witness.sourceFingerprint, focus: attempt.expected.focus || attempt.expected.revision, claim: outcome.claim, outcome: outcome.verdict, reasons: assessment.reasons, reviewerIdentity: 'operator-asserted', historical: true, advisoryOnly: true, routingAuthority: 'none' });
    }
    return { advisoryOnly: true, authority: 'none', lessons: lessons.slice(-50), truncated: lessons.length > 50, improvementDemonstrated: false };
  } catch (error) { return { advisoryOnly: true, authority: 'none', lessons: [], reason: 'invalid-evidence', error: String(error.message).slice(0, 2000) }; }
}
