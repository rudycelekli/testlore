import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { git, readConfig, safePath } from './files.js';
import { digest } from './provenance.js';
import { adapterFor } from './execution.js';
import { captureRepairState, isRepairSourcePath } from './repair-candidates.js';
import { repair, repairFullSuite } from './repair.js';
import { planBugInvestigation, readInvestigationReport, readInvestigationInput, buildInvestigationRegressionProposal } from './bug-investigation.js';

const SHA = /^[a-f0-9]{64}$/;
const INDEX = '.tddswarm/learning/contributions/index.json';
const requireThat = (condition, reason) => { if (!condition) throw new Error(reason); };
function clean(root) {
  const rows = git(root,['status','--porcelain=v1','-z','--untracked-files=all']).split('\0').filter(Boolean);
  return rows.every(row => row.startsWith('?? ') && (row.slice(3).startsWith('.tddswarm/') || row.slice(3) === 'node_modules' || row.slice(3).startsWith('node_modules/'))) || rows.length === 0;
}
function inventory(run) {
  requireThat(run?.complete === true && Array.isArray(run.tests) && run.tests.length > 0 && run.tests.length <= 10000 && !run.error && !run.signal && !run.reportErrors?.length && !run.missingFiles?.length && !run.unknownFiles?.length, 'incomplete-native-investigation-evidence');
  const result = new Map();
  for (const item of run.tests) {
    requireThat(typeof item.file === 'string' && typeof item.name === 'string' && item.name.length > 0 && item.name !== '<file-load>' && ['passed','failed','skipped'].includes(item.status), 'invalid-native-investigation-case');
    const id = JSON.stringify([item.file,item.name,item.project || null]);
    requireThat(!result.has(id), 'ambiguous-native-investigation-case'); result.set(id,item.status);
  }
  return [...result].sort(([a],[b]) => a.localeCompare(b));
}
function sameScope(first, second) {
  return first.scope.fingerprint === second.scope.fingerprint && first.dependencies.fingerprint === second.dependencies.fingerprint && first.provenance.fingerprint === second.provenance.fingerprint;
}
function onlyChanges(original, current, allowed) {
  requireThat(original.dependencies.fingerprint === current.dependencies.fingerprint && original.provenance.runner === current.provenance.runner && digest(original.provenance.services) === digest(current.provenance.services), 'investigation-runtime-inputs-changed');
  const changed = [];
  for (const name of new Set([...Object.keys(original.scope.files), ...Object.keys(current.scope.files)])) {
    if (digest(original.scope.files[name] ?? null) !== digest(current.scope.files[name] ?? null)) { requireThat(allowed.has(name), 'changes-outside-investigation-repair'); changed.push(name); }
  }
  return changed;
}
function knowledge(root, enabled) {
  if (!enabled) return null;
  try { const input = readInvestigationInput(root, INDEX, { json:false, maxBytes:8*1024*1024 }); return { status:'captured',sha256:input.sha256,text:input.value }; }
  catch { return { status:fs.existsSync(path.join(root,INDEX))?'unavailable':'missing' }; }
}

/** Convert a reproduced approved probe into a new regression before source-only repair.
 * Neither the original green suite nor an agent's explanation proves intended behavior.
 * This controller adds exactly the reviewed probe regression in a disposable branch,
 * demonstrates its stable native assertion failure, then delegates the existing repair gates.
 */
export async function repairInvestigation(root, options = {}) {
  const started = performance.now();
  const deadlineMs = options.deadlineMs ?? 900000;
  requireThat(Number.isSafeInteger(deadlineMs) && deadlineMs >= 1 && deadlineMs <= 900000, 'Invalid investigation repair deadline');
  requireThat(options && typeof options === 'object' && Object.keys(options).every(key => ['report','reportSha256','findingId','agent','patch','deadlineMs'].includes(key)) && typeof options.report === 'string' && SHA.test(options.reportSha256) && SHA.test(options.findingId), 'Investigation repair requires exact report and finding identities');
  const deadline = started + deadlineMs, remaining = () => { const value = Math.floor(deadline-performance.now()); requireThat(value > 0, 'investigation-repair-deadline-exhausted'); return value; };
  root = path.resolve(root); requireThat(!fs.lstatSync(root).isSymbolicLink(), 'Investigation repair root must be a regular directory'); root = fs.realpathSync(root);
  const config = readConfig(root);
  const unsupported = reason => ({schemaVersion:1,kind:'source-repair',status:'unsupported-investigation-repair',published:false,merged:false,reason,next:[reason]});
  if (config.integration || adapterFor(config) !== 'node' || Object.keys(config.services || {}).length) return unsupported('Proactive source repair currently requires a standalone Node project with complete named native assertions and no external service profile.');
  const repository = fs.realpathSync(git(root,['rev-parse','--show-toplevel']).trim());
  if (repository !== root) return unsupported('Nested project and monorepo proactive repair profiles are not yet qualified.');
  requireThat(clean(root), 'Commit or stash project changes before investigation repair; the caller is preserved');
  const requirements = safePath(root,'tddswarm.requirements.md');
  if (!fs.existsSync(requirements) || !fs.lstatSync(requirements).isFile() || fs.statSync(requirements).size > 65536) return {kind:'source-repair',status:'awaiting-requirements',published:false,merged:false,next:['Commit independently reviewed tddswarm.requirements.md before repairing a newly discovered defect.']};
  requireThat(readInvestigationInput(root,'tddswarm.requirements.md',{json:false,maxBytes:65536}).value.trim().length > 0,'Independent requirements are empty');
  const captured = readInvestigationReport(root,options.report,{expectedSha256:options.reportSha256});
  requireThat(!captured.stale,'Investigation report is stale');
  const finding = captured.report.findings.find(item => item.id === options.findingId);
  requireThat(finding?.outcome === 'reproduced' && finding.regressionProposal && finding.probeReceipt,'Repair requires an actually reproduced investigation with a regression proposal');
  if (!isRepairSourcePath(finding.module)) return unsupported('This finding is outside the qualified existing production source repair allowlist.');
  if (config.repair?.sourcePaths !== undefined && (!Array.isArray(config.repair.sourcePaths) || !config.repair.sourcePaths.includes(finding.module))) return {schemaVersion:1,kind:'source-repair',status:'awaiting-source-ownership',published:false,merged:false,findingId:finding.id,module:finding.module,next:['The reproduced target is outside configured repair.sourcePaths. Review source ownership explicitly before attempting a repair.']};
  const production = fs.lstatSync(safePath(root,finding.module));
  if (!production.isFile() || production.size > 65536) return unsupported('Proactive repair requires an existing regular production module of at most 64 KiB.');
  const manifestReferences = captured.report.sourceBinding.files.filter(item => item.sha256 === captured.report.manifestSha256);
  requireThat(manifestReferences.length === 1,'Investigation manifest identity is ambiguous');
  const plan = planBugInvestigation(root,{manifest:manifestReferences[0].path});
  requireThat(plan.manifestSha256 === captured.report.manifestSha256 && plan.recipeCatalogSha256 === captured.report.recipeCatalogSha256 && digest(plan.sourceBinding) === digest(captured.report.sourceBinding),'Current investigation plan differs from retained inputs');
  const candidate = plan.candidates.find(item => item.targetId === finding.targetId && item.recipeId === finding.recipeId && item.recipeSha256 === finding.recipeSha256 && item.module === finding.module && item.sourceSha256 === finding.sourceSha256);
  requireThat(candidate?.applicable === true,'Finding lacks a current independently approved target expectation');
  const proposal = readInvestigationInput(root,finding.regressionProposal.path,{expectedSha256:finding.regressionProposal.sha256,maxBytes:131072}).value;
  requireThat(digest(proposal) === digest(buildInvestigationRegressionProposal(candidate)),'Regression proposal differs from the approved recipe contract');
  const added = proposal.files[0];
  requireThat(proposal.files.length === 1 && /^test\/testlore-[a-zA-Z0-9_-]+\.test\.mjs$/.test(added.path) && typeof added.content === 'string' && Buffer.byteLength(added.content) <= 65536 && !fs.existsSync(safePath(root,added.path)), 'Regression must be one new bounded native test file');
  const probe = readInvestigationInput(root,finding.probeReceipt.path,{expectedSha256:finding.probeReceipt.sha256}).value;
  const expectedCases = probe.cases.map(item => [JSON.stringify([added.path,item.id,null]), item.status === 'mismatch' ? 'failed' : 'passed']).sort(([a],[b]) => a.localeCompare(b));
  requireThat(expectedCases.some(([,status]) => status === 'failed') && expectedCases.length === candidate.recipe.probe.cases.length, 'Probe lacks exact independent mismatch identities');
  const base = git(root,['rev-parse','HEAD']).trim(); let baseBranch = null; try { baseBranch = git(root,['symbolic-ref','--short','HEAD']).trim(); } catch {}
  let initial;
  try { initial = captureRepairState(root,{deadline}); }
  catch (error) {
    if (performance.now() >= deadline) return {schemaVersion:1,kind:'source-repair',status:'failed',sha:null,published:false,merged:false,error:'investigation-repair-deadline-exhausted-before-worktree',sourceHead:base,base,baseBranch,next:['Increase the explicit deadline if this repository can be qualified within an acceptable budget.']};
    throw error;
  }
  const enabled = config.learning?.enabled !== false && config.learning?.contributions?.enabled === true, originalKnowledge = knowledge(root,enabled);
  const assertCaller = () => {
    remaining(); requireThat(git(root,['rev-parse','HEAD']).trim() === base && clean(root),'Original caller changed during investigation repair');
    requireThat(sameScope(initial,captureRepairState(root,{deadline})),'Original caller inputs changed during investigation repair');
    const current = readInvestigationReport(root,options.report,{expectedSha256:options.reportSha256}); requireThat(!current.stale,'Original investigation inputs changed during repair');
    readInvestigationInput(root,finding.regressionProposal.path,{expectedSha256:finding.regressionProposal.sha256,maxBytes:131072});
    requireThat(digest(knowledge(root,enabled)) === digest(originalKnowledge),'Original contribution knowledge changed during investigation repair');
  };
  const outer = fs.mkdtempSync(path.join(os.tmpdir(),'testlore-investigation-repair-'));
  const id = randomUUID(); let result = {schemaVersion:1,kind:'source-repair',id,originalCheckout:root,sourceHead:base,base,baseBranch,worktree:outer,worktreeRoot:outer,sha:null,status:'preparing',published:false,merged:false,sourcePaths:[finding.module],investigation:{report:options.report,reportSha256:options.reportSha256,findingId:finding.id,recipeId:finding.recipeId,recipeSha256:finding.recipeSha256,regressionTest:added.path,regressionSha256:digest(added.content),originalGreenRuns:[],regressionFailureRuns:[],deadlineMs,scope:'standalone-node-approved-module-probe-to-native-regression',limitations:['Target approval is a reviewed declaration; this controller does not independently authenticate the reviewer.','A new passing regression does not certify behavior outside the observed native and module scopes.']}};
  const save = () => { remaining(); const directory = safePath(result.worktree,'.tddswarm/investigation-repair'); fs.mkdirSync(directory,{recursive:true,mode:0o700}); result.receipt = path.join(directory,'result.json'); fs.writeFileSync(result.receipt,JSON.stringify(result,null,2)+'\n',{mode:0o600}); return result; };
  try {
    assertCaller(); git(root,['worktree','add','--detach',outer,base]);
    const dependencies = path.join(root,'node_modules'); if (fs.existsSync(dependencies) && !fs.existsSync(path.join(outer,'node_modules'))) fs.symlinkSync(fs.realpathSync(dependencies),path.join(outer,'node_modules'),'dir');
    if (originalKnowledge?.status === 'captured') { const file=safePath(outer,INDEX); fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700}); fs.writeFileSync(file,originalKnowledge.text,{flag:'wx',mode:0o600}); }
    const outerOriginal = captureRepairState(outer,{deadline}); requireThat(sameScope(initial,outerOriginal),'Disposable branch differs from original runtime inputs');
    for (let index=0;index<2;index++) {
      const observed = repairFullSuite(outer,{timeoutMs:Math.min(120000,remaining())}); result.investigation.originalGreenRuns.push(observed); assertCaller();
      const cases = inventory(observed); requireThat(observed.exitCode === 0 && cases.some(([,status]) => status === 'passed') && cases.every(([,status]) => status !== 'failed'),'Original native suite is not completely green');
      requireThat(sameScope(outerOriginal,captureRepairState(outer,{deadline})),'Native baseline changed original inputs');
      if (index) requireThat(digest(cases) === digest(inventory(result.investigation.originalGreenRuns[0])),'Original native case identities or outcomes are unstable');
    }
    const originalCases = inventory(result.investigation.originalGreenRuns[0]);
    fs.mkdirSync(path.dirname(safePath(outer,added.path)),{recursive:true}); fs.writeFileSync(safePath(outer,added.path),added.content,{flag:'wx',mode:0o644});
    const staged = captureRepairState(outer,{deadline});
    requireThat(onlyChanges(outerOriginal,staged,new Set([added.path])).join(',') === added.path,'Regression staging changed original source or assertions');
    for (let index=0;index<2;index++) {
      const observed = repairFullSuite(outer,{timeoutMs:Math.min(120000,remaining())}); result.investigation.regressionFailureRuns.push(observed); assertCaller();
      requireThat(observed.exitCode === 1 && digest(inventory(observed)) === digest([...originalCases,...expectedCases].sort(([a],[b]) => a.localeCompare(b))),'Native regression does not exactly preserve original cases and demonstrate the approved mismatches');
      requireThat(sameScope(staged,captureRepairState(outer,{deadline})),'Native regression execution changed tested inputs');
    }
    assertCaller(); git(outer,['add','--',added.path]); const intendedTree=git(outer,['write-tree']).trim();
    git(outer,['-c','core.hooksPath=/dev/null','-c','commit.gpgSign=false','commit','-m','test: demonstrate approved TestLore investigation regression']);
    requireThat(git(outer,['rev-parse','HEAD^{tree}']).trim() === intendedTree && clean(outer) && sameScope(staged,captureRepairState(outer,{deadline})),'Regression commit differs from tested bytes');
    result.investigation.regressionCommit=git(outer,['rev-parse','HEAD']).trim(); assertCaller();
    const repaired = await repair(outer,{...(options.agent ? {agent:options.agent} : {}),...(options.patch ? {patch:options.patch} : {}),sourcePaths:[finding.module],deadlineMs:remaining(),timeoutMs:Math.min(120000,remaining()),assertInputsFresh:assertCaller,disableCommitHooks:true});
    result = {...repaired,originalCheckout:root,sourceHead:base,base,baseBranch,investigation:{...result.investigation,outerWorktree:outer,innerSourceHead:repaired.sourceHead,durationMs:Math.round(performance.now()-started)}};
    assertCaller();
    if (result.status !== 'ready-for-review') return save();
    requireThat(result.validation?.accepted && result.fullRun?.complete && result.fullRun.exitCode === 0 && result.sha,'Inner native source repair was not accepted');
    const changed = onlyChanges(initial,captureRepairState(result.worktree,{deadline}),new Set([added.path,finding.module]));
    requireThat(changed.length === 2 && changed.includes(added.path) && changed.includes(finding.module),'Final repair changes must contain exactly the new regression and approved production source');
    requireThat(readInvestigationInput(result.worktree,added.path,{json:false,maxBytes:65536}).sha256 === digest(added.content),'Accepted regression bytes changed during repair');
    const committedFiles = git(result.worktree,['diff','--name-only',base,result.sha,'--']).trim().split('\n').filter(Boolean).sort();
    requireThat(digest(committedFiles) === digest([added.path,finding.module].sort()) && clean(result.worktree),'Final committed diff changed original assertions or project inputs');
    const expectedPassing = [...originalCases,...expectedCases.map(([key]) => [key,'passed'])].sort(([a],[b]) => a.localeCompare(b));
    requireThat(digest(inventory(result.fullRun)) === digest(expectedPassing),'Final native run omitted or weakened original or newly demonstrated cases');
    result.investigation.originalAssertionsPreserved=true; result.investigation.newRegressionVerified=true; result.investigation.durationMs=Math.round(performance.now()-started);
    result.next=['Review the newly demonstrated regression, approved source-only fix and retained native evidence.','Publication may open a reviewed PR; no automatic merge is authorized by this result.'];
    assertCaller(); return save();
  } catch (error) {
    result.status='failed'; result.error=error.message; result.published=false; result.merged=false;
    if (fs.existsSync(path.join(result.worktree,'.git'))) { const directory=safePath(result.worktree,'.tddswarm/investigation-repair');fs.mkdirSync(directory,{recursive:true,mode:0o700});result.receipt=path.join(directory,'result.json');fs.writeFileSync(result.receipt,JSON.stringify(result,null,2)+'\n',{mode:0o600}); }
    else fs.rmSync(outer,{recursive:true,force:true});
    return result;
  }
}
