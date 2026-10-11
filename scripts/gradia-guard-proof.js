// Explicit development qualification of the pinned public Python SDK verifier.
// No downloads, installs, provider calls, project commands or automatic activation.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const GUARD_SOURCE_REVISION = '92a93c610f4d02c3db21fe6a6d526d9bd046fe86';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const hashes = {
  'LICENSE': 'c71d239df91726fc519c6eb72d318ec65820627232b2f796219e87dcf35d0ab4',
  'NOTICE': 'e8ec55daaf701e31c0636b71fa8e9478ba09088c9f057eb48af67c2754352882',
  'python/src/gradia_guard/__init__.py': 'b1f093bb8b8b2825d7d71ee15b152bba457fd145c151355e77c0413311db2ded',
  'python/src/gradia_guard/core.py': 'cf14e1b2d3fce02bd6df96e835b06e4a8434abceb1e3f7fe62dbc3faf97edcd5',
  'python/src/gradia_guard/frameworks.py': '36cc3ac899eb32115d69f497e84f123b28c4b45c3c2419e6c78addaa805d08ba',
  'python/src/gradia_guard/verify.py': 'd77873fd1b35c008a6247520d5cbd887e9b116266f40e3ccd09e84b4bfd5a57e',
  'python/src/gradia_guard/cli.py': 'c99132a7a0088f62d3d4090a8d0a6bec4478af8e834e1006df0edb69cf01114b',
  'test/fixtures/sdk-reference-bundle/bundle.json': '212cb8885a057bc5650c747588286b0802a17f91837b93c27e062f0a0716116c',
  'test/fixtures/sdk-reference-bundle/frames.ndjson': 'f3cd4b4fc04fc29e862cbc4ab769ba6b03b7f48df722784bfbe4bab11fb472d5'
};
const canonical = value => JSON.stringify(sort(value));
function sort(value) {
  if (Array.isArray(value)) return value.map(sort);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, sort(value[key])]));
  return value;
}
function rechain(manifest, frames) {
  let head = digest('');
  for (const frame of frames) {
    frame.previous_frame_sha256 = head;
    const { frame_sha256, ...body } = frame;
    frame.frame_sha256 = digest(canonical(body)); head = frame.frame_sha256;
  }
  manifest.chain_head_sha256 = head;
}
export function guardProofCases(manifest, frames) {
  const clone = () => ({ manifest: structuredClone(manifest), frames: structuredClone(frames) });
  const valid = clone();
  const failed = clone(); failed.frames[1].outcome = 'decision_failure'; failed.frames[1].failure_code = 'owned_negative_decision'; rechain(failed.manifest, failed.frames);
  const truncated = clone(); truncated.frames.pop();
  const digestChanged = clone(); digestChanged.frames[0].frame_sha256 = '0'.repeat(64);
  const overclaim = clone(); overclaim.manifest.coverage.full_world_capture = true;
  for (const frame of overclaim.frames) frame.coverage.full_world_capture = true;
  rechain(overclaim.manifest, overclaim.frames);
  const schema = clone(); schema.manifest.schema_version = 'gradia.guard.sdk-bundle.v999';
  return [
    { id: 'producer-golden', ...valid, exit: 0, ok: true, blocker: null },
    { id: 'owned-valid-failure', ...failed, exit: 0, ok: true, blocker: null },
    { id: 'truncated', ...truncated, exit: 1, ok: false, blocker: 'sdk_' },
    { id: 'changed-digest', ...digestChanged, exit: 1, ok: false, blocker: 'sdk_' },
    { id: 'rehashed-full-world-overclaim', ...overclaim, exit: 1, ok: false, blocker: 'sdk_' },
    { id: 'unsupported-schema', ...schema, exit: 1, ok: false, blocker: 'sdk_' }
  ];
}
export function verifyGradiaGuardProofRaw(directory, proof) {
  assert.equal(proof.schema, 'testlore.gradia-guard-sdk-proof.v1');
  assert.equal(proof.sourceRevision, GUARD_SOURCE_REVISION);
  assert.equal(proof.profile, 'gradia.guard.sdk-bundle.v1');
  assert.equal(proof.mode, 'pinned-python-verifier-producer-fixture-and-owned-controls');
  assert.equal(proof.independentNodeParityExecuted, false); assert.equal(proof.applicationTestsExecuted, false);
  assert.equal(proof.providerCalls, 0); assert.equal(proof.qualityImprovementClaim, false);
  assert.deepEqual(proof.authority, { routingOmissions: false, candidateAcceptance: false, repairAcceptance: false, learningPromotion: false });
  assert.equal(proof.proofScriptSha256, digest(fs.readFileSync(fileURLToPath(import.meta.url))));
  const raw = new Map();
  assert.equal(proof.rawEvidence.length, 41);
  for (const item of proof.rawEvidence) {
    assert.ok(/^[a-zA-Z0-9_./-]+$/.test(item.file) && !item.file.split('/').includes('..') && !path.isAbsolute(item.file));
    assert.equal(raw.has(item.file), false);
    assert.ok(Number.isSafeInteger(item.bytes) && item.bytes >= 0 && item.bytes <= 128 * 1024);
    const bytes = readPinned(directory, item.file, item.sha256); assert.equal(bytes.length, item.bytes); raw.set(item.file, bytes);
  }
  for (const [file, expected] of Object.entries(hashes)) assert.equal(digest(raw.get(`source/${file}`)), expected);
  const runtime = JSON.parse(raw.get('python-runtime.stdout.json'));
  assert.deepEqual(runtime, proof.pythonRuntime);
  const version = /^(\d+)\.(\d+)\./.exec(runtime.version); assert.ok(version && (Number(version[1]) > 3 || Number(version[1]) === 3 && Number(version[2]) >= 12));
  const manifest = JSON.parse(raw.get('source/test/fixtures/sdk-reference-bundle/bundle.json'));
  const frames = raw.get('source/test/fixtures/sdk-reference-bundle/frames.ndjson').toString('utf8').trimEnd().split('\n').map(line => JSON.parse(line));
  const cases = guardProofCases(manifest, frames); assert.equal(proof.outcomes.length, cases.length);
  cases.forEach((item, index) => {
    assert.equal(raw.get(`${item.id}/bundle.json`).toString('utf8'), `${canonical(item.manifest)}\n`);
    assert.equal(raw.get(`${item.id}/frames.ndjson`).toString('utf8'), `${item.frames.map(canonical).join('\n')}\n`);
    assert.deepEqual(JSON.parse(raw.get(`${item.id}/process.json`)), { exitCode: item.exit, signal: null, spawnError: false });
    const verdict = JSON.parse(raw.get(`${item.id}/stdout.json`)); assert.equal(verdict.ok, item.ok);
    assert.ok(Array.isArray(verdict.blockers));
    if (item.blocker) assert.ok(verdict.blockers.some(code => code.startsWith(item.blocker)));
    else { assert.deepEqual(verdict.blockers, []); assert.equal(verdict.payloads_unavailable, 3); }
    assert.deepEqual(proof.outcomes[index], { id: item.id, nativeExitCode: item.exit, verificationValid: verdict.ok,
      blockers: verdict.blockers, payloadsUnavailable: verdict.payloads_unavailable,
      recordedActionOutcomes: item.frames.filter(frame => frame.frame_kind === 'action').map(frame => frame.outcome), testPassAuthority: false });
  });
  assert.equal(proof.verified, true);
  return true;
}
function readPinned(source, relative, expected) {
  let current = path.resolve(source);
  for (const part of relative.split('/')) {
    current = path.join(current, part);
    assert.equal(fs.lstatSync(current).isSymbolicLink(), false, `Symlink refused: ${relative}`);
  }
  const stat = fs.lstatSync(current);
  assert.equal(stat.isFile(), true); assert.ok(stat.size <= 128 * 1024);
  const bytes = fs.readFileSync(current); assert.equal(digest(bytes), expected, `Pinned bytes mismatch: ${relative}`);
  return bytes;
}
export function gradiaGuardProof({ source, python = 'python3', output }) {
  assert.ok(source && output, 'Explicit reviewed source and fresh private output required');
  const inputs = Object.entries(hashes).map(([file, sha256]) => ({ file, sha256, bytes: readPinned(source, file, sha256) }));
  const env = { PATH: process.env.PATH || '', LANG: 'C.UTF-8' };
  const run = argv => spawnSync(python, ['-I', '-B', ...argv], { encoding: 'utf8', env, shell: false, timeout: 10000, maxBuffer: 1024 * 1024 });
  const runtime = run(['-c', 'import json,sys; print(json.dumps({"version":sys.version,"executable":sys.executable})); sys.exit(0 if sys.version_info >= (3,12) else 2)']);
  assert.equal(runtime.status, 0, 'Existing Python >=3.12 is required'); assert.equal(Boolean(runtime.error), false);
  const pythonRuntime = JSON.parse(runtime.stdout);
  fs.mkdirSync(output, { recursive: false, mode: 0o700 });
  const rawEvidence = [];
  const record = (file, bytes) => {
    const target = path.join(output, file); fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
    fs.writeFileSync(target, bytes, { flag: 'wx', mode: 0o600 });
    rawEvidence.push({ file, bytes: Buffer.byteLength(bytes), sha256: digest(bytes) });
  };
  for (const item of inputs) record(`source/${item.file}`, item.bytes);
  record('python-runtime.stdout.json', runtime.stdout); record('python-runtime.stderr.txt', runtime.stderr);
  const fixture = name => inputs.find(item => item.file.endsWith(name)).bytes.toString('utf8');
  const cases = guardProofCases(JSON.parse(fixture('bundle.json')), fixture('frames.ndjson').trimEnd().split('\n').map(line => JSON.parse(line)));
  const outcomes = [];
  for (const item of cases) {
    record(`${item.id}/bundle.json`, `${canonical(item.manifest)}\n`);
    record(`${item.id}/frames.ndjson`, `${item.frames.map(canonical).join('\n')}\n`);
    const bootstrap = 'import runpy,sys; sys.path.insert(0,sys.argv.pop(1)); sys.argv=["gradia-guard-python","verify",sys.argv[1]]; runpy.run_module("gradia_guard.cli",run_name="__main__")';
    const result = run(['-c', bootstrap, path.resolve(output, 'source/python/src'), path.resolve(output, item.id)]);
    record(`${item.id}/stdout.json`, result.stdout || ''); record(`${item.id}/stderr.txt`, result.stderr || '');
    record(`${item.id}/process.json`, JSON.stringify({ exitCode: result.status, signal: result.signal, spawnError: Boolean(result.error) }));
    assert.equal(Boolean(result.error), false); assert.equal(result.signal, null); assert.equal(result.status, item.exit, result.stderr);
    const verdict = JSON.parse(result.stdout); assert.equal(verdict.ok, item.ok);
    assert.ok(Array.isArray(verdict.blockers));
    if (item.blocker) assert.ok(verdict.blockers.some(code => code.startsWith(item.blocker)), `${item.id}: refusal reason missing`);
    else { assert.deepEqual(verdict.blockers, []); assert.equal(verdict.payloads_unavailable, 3); }
    outcomes.push({ id: item.id, nativeExitCode: result.status, verificationValid: verdict.ok, blockers: verdict.blockers, payloadsUnavailable: verdict.payloads_unavailable,
      recordedActionOutcomes: item.frames.filter(frame => frame.frame_kind === 'action').map(frame => frame.outcome), testPassAuthority: false });
  }
  const proof = { schema: 'testlore.gradia-guard-sdk-proof.v1', verified: true, sourceRevision: GUARD_SOURCE_REVISION,
    profile: 'gradia.guard.sdk-bundle.v1', mode: 'pinned-python-verifier-producer-fixture-and-owned-controls', pythonRuntime,
    independentNodeParityExecuted: false, applicationTestsExecuted: false, providerCalls: 0, qualityImprovementClaim: false,
    authority: { routingOmissions: false, candidateAcceptance: false, repairAcceptance: false, learningPromotion: false },
    proofScriptSha256: digest(fs.readFileSync(fileURLToPath(import.meta.url))), outcomes, rawEvidence };
  verifyGradiaGuardProofRaw(output, proof);
  fs.writeFileSync(path.join(output, 'proof.json'), `${JSON.stringify(proof, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  return proof;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const options = {};
  for (let i = 2; i < process.argv.length; i += 2) {
    const key = process.argv[i]; assert.ok(['--source', '--python', '--output'].includes(key) && process.argv[i + 1], 'Use --source PATH --python EXECUTABLE --output FRESH_DIRECTORY');
    const name = key.slice(2); assert.equal(options[name], undefined, 'Duplicate option'); options[name] = process.argv[i + 1];
  }
  console.log(JSON.stringify(gradiaGuardProof(options), null, 2));
}
