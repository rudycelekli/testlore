import {rememberValidation} from './learning.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { TEST, listFiles, readConfig, safePath } from './files.js';
import { digest, freshness, snapshot } from './provenance.js';
import { discover, execute } from './execution.js';

const forbiddenPath = file => file.split('/').some(part => ['.git', '.tddswarm', 'node_modules'].includes(part));
const protectedPath = file => forbiddenPath(file) || /(?:^|\/)(?:package(?:-lock)?\.json|(?:pnpm-lock\.yaml|yarn\.lock)|tddswarm\.config\.json)$/.test(file);
function projectPath(root, file) {
  safePath(root, file);
  if (file.split('/').some(part => !part || part === '.')) throw new Error(`Noncanonical patch path: ${file}`);
  if (forbiddenPath(file)) throw new Error(`Forbidden patch path: ${file}`);
  return file;
}
function directory(root, id) {
  if (typeof id !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(id)) throw new Error('Invalid candidate id');
  return safePath(root, `.tddswarm/candidates/${id}`);
}
const json = file => JSON.parse(fs.readFileSync(file, 'utf8'));
function assertReview(review) {
  if (!review || typeof review.accepted !== 'boolean' || !Array.isArray(review.findings) || review.findings.some(value => typeof value !== 'string')) throw new Error('Patch requires reviewer accepted:boolean and findings:string[]');
}
function manifestFor(root, id) {
  const dir = directory(root, id), file = safePath(dir, 'manifest.json');
  if (!fs.existsSync(file)) throw new Error('Candidate has no provenance manifest; regenerate or restage legacy candidates');
  const manifest = json(file);
  if (manifest.schemaVersion !== 1 || manifest.id !== id || !Array.isArray(manifest.files) || !Array.isArray(manifest.delete) || !Array.isArray(manifest.heldOutDefects)) throw new Error('Invalid candidate manifest');
  assertReview(manifest.review);
  if (typeof manifest.requirements !== 'string' || !manifest.requirements.trim()) throw new Error('Candidate requires independent requirements');
  const seen = new Set();
  for (const file of manifest.files) {
    projectPath(root, file.path);
    if (seen.has(file.path) || typeof file.hash !== 'string') throw new Error('Duplicate or invalid manifest file');
    seen.add(file.path);
    if (digest(fs.readFileSync(safePath(dir, `files/${file.path}`))) !== file.hash) throw new Error(`Candidate content changed: ${file.path}`);
  }
  for (const file of manifest.delete) {
    projectPath(root, file);
    if (seen.has(file)) throw new Error(`Conflicting patch path: ${file}`);
    seen.add(file);
  }
  for (const file of seen) if (protectedPath(file) && !manifest.allowProtectedPaths?.includes(file)) throw new Error(`Protected patch path: ${file}`);
  for (const defect of manifest.heldOutDefects) {
    projectPath(root, defect.path);
    if (TEST.test(defect.path) || protectedPath(defect.path) || typeof defect.content !== 'string' || !defect.name || defect.hash !== digest(defect.content)) throw new Error('Invalid held-out source defect');
  }
  return { dir, manifest, hash: digest(manifest) };
}

/** Stage a complete, reviewable patch. This never writes project files. */
export function stagePatch(root, patch) {
  const config = readConfig(root);
  if (!patch || !Array.isArray(patch.files) || !Array.isArray(patch.delete || [])) throw new Error('Patch requires files and optional delete arrays');
  if (!patch.files.length || patch.files.length > 100) throw new Error('Patch requires 1–100 changed files');
  assertReview(patch.review);
  if (typeof patch.requirements !== 'string' || !patch.requirements.trim()) throw new Error('Independent requirements are mandatory');
  const removed = patch.delete || [], allowed = patch.allowProtectedPaths || [], seen = new Set();
  if (!Array.isArray(allowed) || allowed.some(file => typeof file !== 'string')) throw new Error('allowProtectedPaths must be explicit project paths');
  for (const file of patch.files) {
    if (!file || typeof file.content !== 'string' || Buffer.byteLength(file.content) > 512 * 1024) throw new Error('Patch files require text content <=512 KB');
    projectPath(root, file.path);
    if (seen.has(file.path)) throw new Error(`Duplicate patch path: ${file.path}`);
    seen.add(file.path);
  }
  for (const file of removed) {
    projectPath(root, file);
    if (seen.has(file)) throw new Error(`Conflicting patch path: ${file}`);
    if (!fs.existsSync(safePath(root, file)) || !fs.statSync(safePath(root, file)).isFile()) throw new Error(`Deleted path is not an existing file: ${file}`);
    seen.add(file);
  }
  for (const file of seen) if (protectedPath(file) && !allowed.includes(file)) throw new Error(`Protected patch path requires explicit allowProtectedPaths: ${file}`);
  const defects = patch.heldOutDefects || [];
  if (!Array.isArray(defects) || defects.length > 100) throw new Error('heldOutDefects must contain at most 100 source defects');
  const defectNames = new Set();
  for (const defect of defects) {
    projectPath(root, defect.path);
    if (typeof defect.name !== 'string' || !defect.name.trim() || defectNames.has(defect.name) || typeof defect.content !== 'string' || Buffer.byteLength(defect.content) > 512 * 1024 || TEST.test(defect.path) || protectedPath(defect.path) || seen.has(defect.path) || !fs.existsSync(safePath(root, defect.path))) throw new Error('Held-out defects require unique names and existing unchanged source paths');
    defectNames.add(defect.name);
  }
  const current = snapshot(root, config), base = patch.provenance || current;
  const fresh = freshness(base, current);
  if (!fresh.fresh) throw new Error(`Patch provenance is stale: ${fresh.reasons.join(', ')}`);
  const id = randomUUID(), dir = directory(root, id);
  fs.mkdirSync(dir, { recursive: true });
  for (const file of patch.files) {
    const target = safePath(dir, `files/${file.path}`);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, file.content, { flag: 'wx' });
  }
  const manifest = { schemaVersion: 1, id, createdAt: new Date().toISOString(), provenance: base, files: patch.files.map(file => ({ path: file.path, hash: digest(file.content) })), delete: removed, allowProtectedPaths: allowed, review: patch.review, requirements: patch.requirements, heldOutDefects: defects.map(defect => ({ ...defect, hash: digest(defect.content) })), purpose: patch.purpose || (removed.length ? 'modularization' : 'candidate-tests') };
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  // Original generated-candidate layout remains readable for human review.
  for (const file of patch.files) {
    const target = safePath(dir, file.path);
    if (['manifest.json', 'review.json', 'validation.json', 'applied.json'].includes(file.path) || file.path.startsWith('files/')) continue;
    fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, file.content);
  }
  const result = { id, directory: dir, files: manifest.files.map(file => file.path), delete: removed, review: patch.review, provenance: base, status: patch.review.accepted ? 'reviewed-candidates' : 'rejected-candidates', applied: false, measured: { execution: false, mutation: false } };
  fs.writeFileSync(path.join(dir, 'review.json'), JSON.stringify(result, null, 2));
  return result;
}

function workspace(root, action) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'tddswarm-review-'));
  try {
    for (const file of listFiles(root)) {
      const target = safePath(temp, file);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(safePath(root, file), target);
    }
    // Dependencies are trusted code. This is file-state isolation, not a security sandbox.
    if (fs.existsSync(path.join(root, 'node_modules'))) fs.symlinkSync(path.join(root, 'node_modules'), path.join(temp, 'node_modules'), 'dir');
    return action(temp);
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
}
function installPatch(temp, dir, manifest) {
  for (const file of manifest.delete) fs.unlinkSync(safePath(temp, file));
  for (const file of manifest.files) {
    const target = safePath(temp, file.path);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const content = fs.readFileSync(safePath(dir, `files/${file.path}`));
    if (digest(content) !== file.hash) throw new Error(`Candidate content changed: ${file.path}`);
    fs.writeFileSync(target, content);
  }
}
function suite(root, config, options) {
  try {
    const discovery = discover(root, { ...config, discovery: Array.isArray(config.discovery) ? config.discovery : 'native' });
    if (!discovery.complete) return { discovery, exitCode: 2, complete: false, tests: [], error: 'Native full-suite discovery is incomplete' };
    if (!discovery.files.length) return { discovery, exitCode: 0, complete: true, tests: [], collectionFiles: [], executedFiles: [] };
    return { ...execute(root, discovery.files, config, { capture: true, timeoutMs: options.timeoutMs ?? options.timeout }), discovery };
  } catch (error) { return { exitCode: 2, complete: false, tests: [], error: error.message }; }
}
function names(tests = []) {
  const result = new Map();
  for (const item of tests) result.set(item.name, (result.get(item.name) || 0) + 1);
  return result;
}
function successful(report) { return report.complete && report.exitCode === 0 && !report.tests?.some(test => test.status === 'failed'); }
function defectCaught(report) { return report.complete && report.exitCode !== 0 && report.tests?.some(test => test.status === 'failed' && test.name !== '<file-load>'); }

/** Execute original and proposed suites independently in disposable copies. */
export function validateCandidates(root, id, options = {}) {
  const { dir, manifest, hash } = manifestFor(root, id), config = readConfig(root), reasons = [];
  const current = snapshot(root, config), fresh = freshness(manifest.provenance, current);
  if (!fresh.fresh) reasons.push(...fresh.reasons);
  if (!manifest.review.accepted) reasons.push('independent-review-rejected');
  const oracle = manifest.review.oracle;
  if (!oracle?.independent || !Array.isArray(oracle.basis) || !oracle.basis.length || oracle.basis.some(item => typeof item !== 'string' || !item.trim())) reasons.push('independent-oracle-review-missing');
  let candidateTests = manifest.files.map(file => file.path).filter(file => TEST.test(file));
  let original, candidate, missingCases = [], defects = [];
  if (!reasons.length) {
    original = workspace(root, temp => suite(temp, config, options));
    candidate = workspace(root, temp => { installPatch(temp, dir, manifest); return suite(temp, readConfig(temp), options); });
    candidateTests = manifest.files.map(file => file.path).filter(file => TEST.test(file) || candidate.discovery?.files.includes(file));
    if (!candidateTests.length) reasons.push('no-candidate-test-files');
    if (!successful(original)) reasons.push('original-suite-failed-or-incomplete');
    if (!successful(candidate) || !candidate.tests.length) reasons.push('candidate-suite-failed-empty-or-incomplete');
    for (const file of candidateTests) if (!candidate.collectionFiles?.includes(file) || !candidate.tests.some(test => test.file === file && test.status !== 'skipped')) reasons.push(`candidate-not-executed:${file}`);
    const expected = names(original.tests), actual = names(candidate.tests);
    missingCases = [...expected].filter(([name, count]) => (actual.get(name) || 0) < count).map(([name, count]) => ({ name, expected: count, actual: actual.get(name) || 0 }));
    if (missingCases.length) reasons.push('original-test-cases-removed');
    const expectedPasses = names((original.tests || []).filter(test => test.status === 'passed'));
    const actualPasses = names((candidate.tests || []).filter(test => test.status === 'passed'));
    for (const [name, count] of expectedPasses) if ((actualPasses.get(name) || 0) < count) reasons.push(`original-case-no-longer-passes:${name}`);
    if (!reasons.length) {
      for (const defect of manifest.heldOutDefects) {
        if (original.discovery.files.includes(defect.path)) { reasons.push(`held-out-defect-target-is-test:${defect.path}`); continue; }
        const baseline = workspace(root, temp => { fs.writeFileSync(safePath(temp, defect.path), defect.content); return suite(temp, config, options); });
        const proposed = workspace(root, temp => { installPatch(temp, dir, manifest); fs.writeFileSync(safePath(temp, defect.path), defect.content); return suite(temp, readConfig(temp), options); });
        const observed = { name: defect.name, path: defect.path, baseline, candidate: proposed, demonstrated: defectCaught(baseline), caught: defectCaught(proposed) };
        defects.push(observed);
        if (!observed.demonstrated) reasons.push(`held-out-defect-not-demonstrated:${defect.name}`);
        if (!observed.caught) reasons.push(`held-out-defect-missed:${defect.name}`);
      }
    }
    const after = freshness(current, snapshot(root, readConfig(root)));
    if (!after.fresh) reasons.push(...after.reasons.map(reason => `changed-during-validation:${reason}`));
  }
  const result = { schemaVersion: 1, id, validatedAt: new Date().toISOString(), manifestHash: hash, provenance: current, accepted: !reasons.length, reasons: [...new Set(reasons)], original, candidate, missingCases, defects, measured: { execution: Boolean(original && candidate), heldOutDefects: defects.length }, isolation: 'disposable-file-copy-with-trusted-dependencies', applied: false };
  result.integrity=digest(result);
  fs.writeFileSync(path.join(dir, 'validation.json'), JSON.stringify(result, null, 2));
  // Historical learning is advisory and never changes acceptance.
  rememberValidation(root, manifest, result, config);
  return result;
}

/** Explicit opt-in application of a previously accepted validation. */
export function applyPatch(root, id, options = {}) {
  const { dir, manifest, hash } = manifestFor(root, id);
  const validationFile = safePath(dir, 'validation.json');
  if (!fs.existsSync(validationFile)) throw new Error('Validate the staged patch before applying');
  const validation = json(validationFile);
  const {integrity,...payload}=validation;
  if(!integrity||integrity!==digest(payload))throw new Error('Candidate validation integrity mismatch');
  if (!validation.accepted || validation.manifestHash !== hash || !manifest.review.accepted) throw new Error('Patch lacks accepted validation of this exact manifest');
  const fresh = freshness(validation.provenance, snapshot(root, readConfig(root)));
  if (!fresh.fresh) throw new Error(`Patch is stale: ${fresh.reasons.join(', ')}`);
  if (!options.execute) return { id, applied: false, ready: true, files: manifest.files.map(file => file.path), delete: manifest.delete };
  const paths = [...manifest.delete, ...manifest.files.map(file => file.path)], backups = new Map(), touched = [], prepared = new Map();
  const rename = options.renameSync || fs.renameSync;
  try {
    for (const file of paths) {
      const target = safePath(root, file);
      backups.set(file, fs.existsSync(target) ? { content: fs.readFileSync(target), mode: fs.statSync(target).mode } : null);
    }
    for (const file of manifest.files) {
      const target = safePath(root, file.path);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      const staged = safePath(dir, `.apply-${randomUUID()}.tmp`);
      const content = fs.readFileSync(safePath(dir, `files/${file.path}`));
      if (digest(content) !== file.hash) throw new Error(`Candidate content changed: ${file.path}`);
      fs.writeFileSync(staged, content, { flag: 'wx' });
      if (backups.get(file.path)) fs.chmodSync(staged, backups.get(file.path).mode);
      prepared.set(file.path, staged);
    }
    const ready = freshness(validation.provenance, snapshot(root, readConfig(root)));
    if (!ready.fresh) throw new Error(`Project changed while preparing patch: ${ready.reasons.join(', ')}`);
    for (const file of manifest.delete) { fs.unlinkSync(safePath(root, file)); touched.push(file); }
    for (const file of manifest.files) { rename(prepared.get(file.path), safePath(root, file.path)); touched.push(file.path); }
    const result = { id, applied: true, files: manifest.files.map(file => file.path), delete: manifest.delete, appliedAt: new Date().toISOString() };
    fs.writeFileSync(path.join(dir, 'applied.json'), JSON.stringify(result, null, 2));
    return result;
  } catch (error) {
    const failures = [];
    for (const file of touched.reverse()) {
      try {
        const target = safePath(root, file), backup = backups.get(file);
        if (backup) { fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, backup.content); fs.chmodSync(target, backup.mode); }
        else fs.rmSync(target, { force: true });
      } catch (rollback) { failures.push(`${file}: ${rollback.message}`); }
    }
    if (failures.length) throw new Error(`Apply failed: ${error.message}; rollback failed: ${failures.join('; ')}`);
    throw new Error(`Apply failed and file changes rolled back: ${error.message}`);
  } finally { for (const staged of prepared.values()) fs.rmSync(staged, { force: true }); }
}
