import {qualityAgent,ensureQualityAgent} from './agent-profile.js';
import {copyLearning,mergeLearning} from './learning.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { git, readConfig, safePath, listFiles } from './files.js';
import { snapshot, freshness, digest } from './provenance.js';
import { stagePatch, validateCandidates, applyPatch } from './candidates.js';
import { generate } from './swarm.js';
import { discover, execute } from './execution.js';

const candidateId = id => typeof id === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(id);
function changes(root) {
  const records = git(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all']).split('\0').filter(Boolean);
  const result = [];
  for (let i = 0; i < records.length; i++) {
    const status = records[i].slice(0, 2), file = records[i].slice(3);
    result.push({ status, file });
    if (/[RC]/.test(status)) { i++; if (records[i]) result.push({ status, file: records[i] }); }
  }
  return result;
}
function metadata(change, prefix = '') {
  const local = prefix && change.file.startsWith(prefix + '/') ? change.file.slice(prefix.length + 1) : change.file;
  return change.status === '??' && ['.tddswarm', 'node_modules'].some(directory => local === directory || local.startsWith(directory + '/'));
}
function clean(root, prefix) { return changes(root).filter(change => !metadata(change, prefix)); }
function changedPath(root, file) {
  safePath(root, file);
  if (file.split('/').some(part => !part || part === '.' || ['.git', 'node_modules', '.tddswarm'].includes(part))) throw new Error(`Unsafe improvement path: ${file}`);
  return file;
}
function manifest(root, id) {
  if (!candidateId(id)) throw new Error('Invalid candidate id');
  const directory = safePath(root, `.tddswarm/candidates/${id}`);
  const value = JSON.parse(fs.readFileSync(safePath(directory, 'manifest.json'), 'utf8'));
  if (value.id !== id || !Array.isArray(value.files) || !Array.isArray(value.delete)) throw new Error('Invalid candidate manifest');
  for (const file of value.files) changedPath(root, file.path);
  for (const file of value.delete) changedPath(root, file);
  return { directory, value };
}
function copyCandidate(root, destination, id) {
  const source = manifest(root, id);
  const validation = JSON.parse(fs.readFileSync(safePath(source.directory, 'validation.json'), 'utf8'));
  const {integrity,...payload}=validation;
  if(!integrity||integrity!==digest(payload))throw new Error('Candidate validation integrity mismatch');
  if (!validation.accepted || validation.manifestHash !== digest(source.value)) throw new Error('Existing candidate requires accepted validation of this exact manifest');
  const target = safePath(destination, `.tddswarm/candidates/${id}`);
  fs.mkdirSync(target, { recursive: true });
  fs.writeFileSync(path.join(target, 'manifest.json'), JSON.stringify(source.value, null, 2));
  for (const file of source.value.files) {
    const content = fs.readFileSync(safePath(source.directory, `files/${file.path}`));
    if (digest(content) !== file.hash) throw new Error(`Candidate content changed: ${file.path}`);
    const output = safePath(target, `files/${file.path}`);
    fs.mkdirSync(path.dirname(output), { recursive: true }); fs.writeFileSync(output, content);
  }
  return { id, directory: target };
}
const repositoryInputs=root=>digest(Object.fromEntries(listFiles(root).map(file=>[file,digest(fs.readFileSync(safePath(root,file)))])));
function fullSuite(root, options) {
  const config = readConfig(root);
  const discovery = discover(root, { ...config, discovery: Array.isArray(config.discovery) ? config.discovery : 'native' });
  if (!discovery.complete || !discovery.files.length) return { exitCode: 2, complete: false, discovery, tests: [], error: 'Full native test scope is incomplete or empty' };
  return { ...execute(root, discovery.files, config, { capture: true, timeoutMs: options.timeoutMs }), discovery };
}
function missingPassingCases(expected, actual) {
  const counts = new Map();
  for (const test of actual || []) if (test.status === 'passed') counts.set(test.name, (counts.get(test.name) || 0) + 1);
  const missing = [];
  for (const test of expected || []) if (test.status === 'passed') {
    const count = counts.get(test.name) || 0;
    if (count) counts.set(test.name, count - 1); else missing.push(test.name);
  }
  return missing;
}

/** Improve in a new branch. Never check out, apply into, or merge the caller's checkout. */
export async function improve(root, options = {}) {
  root = fs.realpathSync(path.resolve(root));
  if (options.agent !== undefined && (!Array.isArray(options.agent) || !options.agent.length || options.agent.some(argument => typeof argument !== 'string' || !argument))) throw new Error('agent must be a nonempty executable and argv array');
  if (options.id && options.patch) throw new Error('Use a candidate id or a patch, not both');
  if (options.id && !candidateId(options.id)) throw new Error('Invalid candidate id');
  if (options.worktree !== undefined) throw new Error('Improvement worktree paths are generated, not supplied');
  const repository = fs.realpathSync(git(root, ['rev-parse', '--show-toplevel']).trim());
  const prefix = path.relative(repository, root).split(path.sep).join('/');
  if (prefix.startsWith('../')) throw new Error('Project must be inside its Git repository');
  const dirty = clean(repository, prefix);
  if (dirty.length) throw new Error(`Commit or stash project changes before improvement; the original checkout will not be discarded (${dirty.map(change => change.file).join(', ')})`);
  const before = snapshot(root, readConfig(root));
  const base = git(repository, ['rev-parse', '--verify', 'HEAD^{commit}']).trim();
  let baseBranch = null;
  try { baseBranch = git(repository, ['symbolic-ref', '--short', 'HEAD']).trim(); } catch {}
  const id = randomUUID();
  const branch = options.branch || `tddswarm/improve-${id}`;
  if (!/^tddswarm\/improve-[a-zA-Z0-9][a-zA-Z0-9_-]{0,100}$/.test(branch)) throw new Error('Improvement branch must use tddswarm/improve- followed by letters, digits, hyphens or underscores');
  git(repository, ['check-ref-format', '--branch', branch]);
  const worktreeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tddswarm-improve-'));
  const worktree = prefix ? path.join(worktreeRoot, prefix) : worktreeRoot;
  const result = { schemaVersion: 1, id, branch, worktree, worktreeRoot, base, sourceHead: base, baseBranch, sha: null, status: 'preparing', merged: false, originalCheckout: root };
  const receipt = () => {
    result.learning=mergeLearning(worktree,root);
    const directory = safePath(worktree, '.tddswarm/improvement'); fs.mkdirSync(directory, { recursive: true });
    result.receipt = path.join(directory, 'result.json'); fs.writeFileSync(result.receipt, JSON.stringify(result, null, 2)); return result;
  };
  try {
    git(repository, ['worktree', 'add', '-b', branch, worktreeRoot, base]);
    const dependencies = path.join(root, 'node_modules');
    if (fs.existsSync(dependencies) && !fs.existsSync(path.join(worktree, 'node_modules'))) fs.symlinkSync(fs.realpathSync(dependencies), path.join(worktree, 'node_modules'), 'dir');
    result.agentProfile=ensureQualityAgent(worktree,{name:qualityAgent(root).name}).profile;
    result.learningSeed=copyLearning(root,worktree);
    // Bound original input must match the checked-out branch before any agent runs.
    const initial = freshness(before, snapshot(worktree, readConfig(worktree)));
    if (!initial.fresh) throw new Error(`Branch inputs differ from original: ${initial.reasons.join(', ')}`);
    const initialized = [];
    if (!options.id && !options.patch && options.initialize) {
      if (typeof options.initialize !== 'function') throw new Error('initialize must be a trusted function returning changed paths');
      const files = await options.initialize(worktree);
      if (!Array.isArray(files) || files.some(file => typeof file !== 'string')) throw new Error('initialize must return changed project paths');
      initialized.push(...files.map(file => changedPath(worktree, file)));
    }
    let staged;
    if (options.id) staged = copyCandidate(root, worktree, options.id);
    else if (options.patch) staged = stagePatch(worktree, options.patch);
    else {
      if (!readConfig(worktree).agent && !options.agent) {
        result.status = 'awaiting-agent'; result.workOrder = await generate(worktree); return receipt();
      }
      const requirements=safePath(worktree,'tddswarm.requirements.md');
      if(!fs.existsSync(requirements)||!fs.readFileSync(requirements,'utf8').trim()){result.status='awaiting-requirements';result.workOrder=await generate(worktree);return receipt();}
      staged = await generate(worktree, { execute: true, agent: options.agent });
    }
    result.candidate = { id: staged.id, directory: staged.directory };
    const validation = validateCandidates(worktree, staged.id, options);
    result.validation = validation;
    if (!validation.accepted) { result.status = 'validation-rejected'; return receipt(); }
    result.application = applyPatch(worktree, staged.id, { execute: true });
    const candidate = manifest(worktree, staged.id).value;
    let prepared = [];
    if (options.prepare) {
      if (typeof options.prepare !== 'function') throw new Error('prepare must be a trusted function returning changed paths');
      prepared = await options.prepare(worktree);
      if (!Array.isArray(prepared) || prepared.some(file => typeof file !== 'string')) throw new Error('prepare must return an array of changed project paths');
      prepared = prepared.map(file => changedPath(worktree, file));
    }
    let repositoryPrepared=[];
    if(options.prepareRepository){
      if(typeof options.prepareRepository!=='function')throw new Error('prepareRepository must be a trusted callback');
      repositoryPrepared=await options.prepareRepository(worktreeRoot,{project:prefix||'.'});
      if(!Array.isArray(repositoryPrepared)||repositoryPrepared.some(file=>typeof file!=='string'))throw new Error('prepareRepository must return repository paths');
      repositoryPrepared=repositoryPrepared.map(file=>changedPath(worktreeRoot,file));
    }
    const paths = [...new Set([...candidate.files.map(file => file.path), ...candidate.delete, ...initialized, ...prepared])];
    for (const file of candidate.files) if (digest(fs.readFileSync(safePath(worktree, file.path))) !== file.hash) throw new Error(`Preparation altered reviewed candidate: ${file.path}`);
    for (const file of candidate.delete) if (fs.existsSync(safePath(worktree, file))) throw new Error(`Preparation restored a reviewed deletion: ${file}`);
    const installed = snapshot(worktree, readConfig(worktree));
    const testedRepository=repositoryInputs(worktreeRoot);
    const report = fullSuite(worktree, options); result.fullRun = report;
    result.missingCases = missingPassingCases(validation.candidate?.tests, report.tests);
    if (!report.complete || report.exitCode !== 0 || !report.tests.some(test => test.status === 'passed') || result.missingCases.length) {
      result.status = 'full-run-failed'; return receipt();
    }
    if(repositoryInputs(worktreeRoot)!==testedRepository)throw new Error('Repository inputs changed during full execution');
    const branchFresh = freshness(installed, snapshot(worktree, readConfig(worktree)));
    if (!branchFresh.fresh) throw new Error(`Branch changed during full execution: ${branchFresh.reasons.join(', ')}`);
    const originalFresh = freshness(before, snapshot(root, readConfig(root)));
    if (!originalFresh.fresh || git(repository, ['rev-parse', 'HEAD']).trim() !== base || clean(repository, prefix).length) throw new Error('Original checkout changed while improvement was running; branch retained without a commit');
    const allowed = new Set([...paths.map(file => prefix ? `${prefix}/${file}` : file),...repositoryPrepared]);
    const unexpected = changes(worktreeRoot).filter(change => !metadata(change, prefix) && !allowed.has(change.file));
    if (unexpected.length) throw new Error(`Unexpected changes outside the reviewed patch: ${unexpected.map(change => change.file).join(', ')}`);
    git(worktreeRoot, ['add', '--', ...allowed]);
    if (!git(worktreeRoot, ['diff', '--cached', '--name-only']).trim()) { result.status = 'no-changes'; return receipt(); }
    const intendedTree=git(worktreeRoot,['write-tree']).trim();
    git(worktreeRoot, ['commit', '-m', 'test: improve reviewed test quality with full-suite evidence']);
    result.sha = git(worktreeRoot, ['rev-parse', 'HEAD']).trim();
    const afterCommit = freshness(installed, snapshot(worktree, readConfig(worktree)));
    const committedMatches = !git(worktreeRoot, ['diff', 'HEAD', '--name-only']).trim() && !changes(worktreeRoot).some(change => !metadata(change, prefix));
    const treeMatches=git(worktreeRoot,['rev-parse','HEAD^{tree}']).trim()===intendedTree&&repositoryInputs(worktreeRoot)===testedRepository;
    result.status = afterCommit.fresh && committedMatches && treeMatches ? 'ready-for-review' : 'commit-requires-review';
    if(!treeMatches)result.error='Committed repository tree differs from the exact tested and staged inputs';
    if (!committedMatches) result.error = 'Committed tree differs from the inputs that passed the full suite';
    if (!afterCommit.fresh) result.error = `Git hooks changed tested inputs: ${afterCommit.reasons.join(', ')}`;
    result.preparedPaths = [...initialized, ...prepared];result.repositoryPreparedPaths=repositoryPrepared;
    result.next = ['Review the branch diff and retained original/candidate/full-run evidence.', 'Open a pull request when ready; merge is explicit.', 'Keep configured quality workflows enabled after merge.'];
    return receipt();
  } catch (error) {
    result.status = 'failed'; result.error = error.message;
    // A created branch/worktree is intentionally retained, including rejected code.
    if (fs.existsSync(path.join(worktreeRoot, '.git'))) return receipt();
    fs.rmSync(worktreeRoot, { recursive: true, force: true });
    return result;
  }
}
