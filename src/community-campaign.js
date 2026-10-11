import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { safePath } from './files.js';
import { parseAssessmentJSON } from './assessments.js';

const sha = value => createHash('sha256').update(value).digest('hex');
const hashPattern = /^[a-f0-9]{64}$/;
const revisionPattern = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
const requireThat = (condition, message) => { if (!condition) throw new Error(message); };
const sameSet = (a, b) => a.length === b.length && a.every(item => b.includes(item));
const median = values => { const ordered = [...values].sort((a,b)=>a-b); const i=Math.floor(ordered.length/2); return ordered.length%2 ? ordered[i] : (ordered[i-1]+ordered[i])/2; };

/** Verify immutable byte references. Hashes establish identity, never semantic truth. */
function readCampaignSnapshot(root, reference, verifyHash=true) {
  requireThat(reference && typeof reference.path === 'string' && reference.path.length <= 512 && (!verifyHash||hashPattern.test(reference.sha256)), 'Invalid evidence reference');
  const file = safePath(root, reference.path), located = fs.lstatSync(file);
  requireThat(located.isFile() && located.size <= 4*1024*1024, 'Evidence must be a bounded regular file');
  const fd = fs.openSync(file, fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
  try {
    const before = fs.fstatSync(fd);
    requireThat(before.isFile() && before.dev === located.dev && before.ino === located.ino && before.size <= 4*1024*1024, 'Evidence changed while opening');
    const bytes = Buffer.alloc(before.size+1); let size=0;
    while(size<bytes.length) { const count=fs.readSync(fd,bytes,size,bytes.length-size,null); if(!count)break; size+=count; }
    const after=fs.fstatSync(fd), current=fs.lstatSync(safePath(root,reference.path));
    requireThat(size===before.size && after.size===before.size && after.mtimeMs===before.mtimeMs && after.ctimeMs===before.ctimeMs && current.dev===before.dev && current.ino===before.ino && current.isFile(), 'Evidence changed during read');
    const snapshot=bytes.subarray(0,size);
    const sha256=sha(snapshot);
    requireThat(!verifyHash||sha256===reference.sha256, 'Evidence hash mismatch');
    return {value:parseAssessmentJSON(new TextDecoder('utf-8',{fatal:true}).decode(snapshot)),sha256};
  } finally { fs.closeSync(fd); }
}

export function readCampaignEvidence(root, reference) { return readCampaignSnapshot(root,reference).value; }

/** Read a bounded manifest snapshot; returned digest identifies the exact bytes assessed. */
export function assessCommunityCampaignFile(root, relative) {
  const snapshot=readCampaignSnapshot(root,{path:relative},false);
  return {...assessCommunityCampaign(snapshot.value,{root}),manifest:{path:relative,sha256:snapshot.sha256}};
}

function files(value) {
  requireThat(Array.isArray(value)&&value.length>0&&value.length<=2048, 'Missing bounded native file inventory');
  const result=[];
  for(const file of value) {
    requireThat(typeof file==='string'&&file.length<=512&&!path.isAbsolute(file)&&!file.includes('\\')&&!file.includes('\0')&&!file.split('/').some(part=>['','..','.'].includes(part)), 'Invalid native file path');
    requireThat(!result.includes(file), 'Duplicate native file inventory'); result.push(file);
  }
  return result.sort();
}
function integer(value) { return Number.isSafeInteger(value)&&value>=0; }

/** Strict Vitest JSON qualification; unsupported runners cannot certify an outcome. */
export function inspectCampaignProcess(root, reference, binding) {
  const receipt=readCampaignEvidence(root,reference);
  requireThat(receipt.schemaVersion===1&&receipt.format==='vitest-json', 'Unsupported native process receipt');
  requireThat(receipt.revision===binding.revision&&receipt.environmentSha256===binding.environmentSha256&&receipt.oracleSha256===binding.oracleSha256, 'Native revision, environment or oracle binding differs');
  requireThat(Array.isArray(receipt.command)&&receipt.command.length>0&&receipt.command.length<=128&&receipt.command.every(value=>typeof value==='string'&&value.length>0&&value.length<=4096), 'Missing bounded process command');
  requireThat(receipt.measurementScope==='whole-command'&&typeof receipt.elapsedMs==='number'&&Number.isFinite(receipt.elapsedMs)&&receipt.elapsedMs>0&&receipt.elapsedMs<=3600000, 'Missing complete command timing');
  requireThat([0,1].includes(receipt.exitCode)&&receipt.signal===null&&receipt.timedOut===false&&receipt.started===true, 'Native process did not complete normally');
  requireThat(typeof receipt.projectRoot==='string'&&path.isAbsolute(receipt.projectRoot), 'Native project root missing');
  const expected=files(receipt.expectedFiles);
  if(binding.expectedFiles)requireThat(sameSet(expected,files(binding.expectedFiles)), 'Expected full native inventory differs');
  const report=readCampaignEvidence(root,receipt.report);
  requireThat(typeof report.success==='boolean'&&Array.isArray(report.testResults)&&report.testResults.length>0&&report.testResults.length<=2048&&!report.testExecError&&(!Object.hasOwn(report,'numRuntimeErrorTestSuites')||report.numRuntimeErrorTestSuites===0), 'Native report incomplete or runtime error');
  const cases=[], observed=[], identities=new Set(), nativeSuites=new Map();
  for(const suite of report.testResults) {
    requireThat(typeof suite.name==='string'&&path.isAbsolute(suite.name)&&Array.isArray(suite.assertionResults)&&suite.assertionResults.length>0&&suite.assertionResults.length<=4096, 'Missing native assertion inventory');
    const file=path.relative(receipt.projectRoot,suite.name).split(path.sep).join('/'); files([file]);
    requireThat(!observed.includes(file), 'Duplicate native suite'); observed.push(file);
    requireThat(typeof suite.message==='string'&&suite.message==='', 'Native file or hook error is not an independently reproduced assertion');
    let suiteFailed=false; nativeSuites.set(file+'\0',false);
    for(const assertion of suite.assertionResults) {
      requireThat(typeof assertion.fullName==='string'&&assertion.fullName.length>0&&assertion.fullName.length<=2048&&['passed','failed','pending','skipped','todo'].includes(assertion.status), 'Missing native named terminal outcome');
      requireThat(Array.isArray(assertion.ancestorTitles)&&assertion.ancestorTitles.length<=32&&assertion.ancestorTitles.every(title=>typeof title==='string'&&title.length<=2048), 'Native describe ancestry missing');
      requireThat(Array.isArray(assertion.failureMessages)&&assertion.failureMessages.every(message=>typeof message==='string')&&(assertion.status==='failed'||assertion.failureMessages.length===0), 'Native assertion diagnostics contradict terminal outcome');
      const identity=file+':'+assertion.fullName;
      requireThat(!identities.has(identity), 'Ambiguous native case identity'); identities.add(identity);
      if(assertion.status==='failed') { requireThat(Array.isArray(assertion.failureMessages)&&assertion.failureMessages.some(message=>typeof message==='string'&&message.length>0), 'Failed assertion has no native diagnostic'); suiteFailed=true; }
      for(let depth=1;depth<=assertion.ancestorTitles.length;depth++) { const key=file+'\0'+JSON.stringify(assertion.ancestorTitles.slice(0,depth)); nativeSuites.set(key,(nativeSuites.get(key)||false)||assertion.status==='failed'); }
      cases.push({id:identity,status:assertion.status}); requireThat(cases.length<=10000, 'Native case budget exceeded');
    }
    requireThat(suite.status===(suiteFailed?'failed':'passed'), 'Native suite status disagrees with assertions');
    nativeSuites.set(file+'\0',suiteFailed);
  }
  requireThat(sameSet(expected,observed), 'Native file inventory incomplete');
  const failedSuites=[...nativeSuites.values()].filter(Boolean).length;
  const failed=cases.filter(item=>item.status==='failed').map(item=>item.id), passed=cases.filter(item=>item.status==='passed').length, pending=cases.length-passed-failed.length;
  for(const [key,count] of Object.entries({numTotalTests:cases.length,numPassedTests:passed,numFailedTests:failed.length,numPendingTests:pending,numTotalTestSuites:nativeSuites.size,numPassedTestSuites:nativeSuites.size-failedSuites,numFailedTestSuites:failedSuites,numPendingTestSuites:0}))requireThat(integer(report[key])&&report[key]===count, 'Native count mismatch: '+key);
  if(Object.hasOwn(report,'numTodoTests'))requireThat(integer(report.numTodoTests)&&report.numTodoTests===cases.filter(item=>item.status==='todo').length, 'Native count mismatch: numTodoTests');
  requireThat(report.success===(failed.length===0)&&receipt.exitCode===(failed.length?1:0), 'Native report and process exit disagree');
  requireThat(passed+failed.length>0, 'No native cases executed');
  return {cases,failed,passed,pending,files:observed.sort(),elapsedMs:receipt.elapsedMs,receiptSha256:reference.sha256,reportSha256:receipt.report.sha256};
}

function contribution(root,value,attempt) {
  if(!value||value.status==='not-submitted')return {status:'not-submitted',accepted:false};
  requireThat(['submitted','accepted','closed'].includes(value.status), 'Invalid contribution status');
  requireThat(value.pullRequest&&new RegExp('^'+attempt.repository.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'/pull/[1-9][0-9]*$').test(value.pullRequest), 'Contribution URL differs from target repository');
  const snapshot=readCampaignEvidence(root,value.snapshot);
  requireThat(snapshot.url===value.pullRequest&&snapshot.headRefOid===attempt.fixedRevision&&['OPEN','CLOSED','MERGED'].includes(snapshot.state), 'GitHub contribution snapshot binding differs');
  requireThat(value.status==='accepted'?snapshot.state==='MERGED'&&revisionPattern.test(snapshot.mergeCommit?.oid):value.status==='closed'?snapshot.state==='CLOSED':snapshot.state==='OPEN', 'Contribution status is not supported by captured GitHub state');
  return {status:value.status,accepted:value.status==='accepted',url:value.pullRequest,evidenceKind:'captured-github-state',authenticityVerified:false};
}

function assessAttempt(root,attempt) {
  requireThat(attempt&&typeof attempt.id==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(attempt.id), 'Invalid attempt identity');
  requireThat(/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(attempt.repository)&&revisionPattern.test(attempt.baseRevision)&&revisionPattern.test(attempt.fixedRevision)&&attempt.baseRevision!==attempt.fixedRevision&&hashPattern.test(attempt.environmentSha256)&&hashPattern.test(attempt.patchSha256), 'Missing immutable repository, change or environment identity');
  requireThat(attempt.attribution&&['testlore','manual-investigation','existing-upstream-report'].includes(attempt.attribution.discovery)&&Array.isArray(attempt.attribution.testloreContribution)&&attempt.attribution.testloreContribution.every(item=>['routing','regression-test','bounded-repair','evidence-validation'].includes(item)), 'Discovery attribution missing');
  const result={id:attempt.id,repository:attempt.repository,status:'inconclusive',regressionQualified:false,routingQualified:false,speedQualified:false,additionalFailurePreservation:false,contribution:{status:'not-submitted',accepted:false},reasons:[],attribution:attempt.attribution};
  try { result.contribution=contribution(root,attempt.contribution,attempt); } catch(error) { result.reasons.push(error.message); }
  if(!attempt.nativeBaseline) { result.reasons.push('native-baseline-unavailable'); return result; }
  try {
    requireThat(attempt.oracle&&['maintainer-existing','independent-specification'].includes(attempt.oracle.independence)&&hashPattern.test(attempt.oracle.sha256)&&Array.isArray(attempt.oracle.expectedFailures)&&attempt.oracle.expectedFailures.length>0&&new Set(attempt.oracle.expectedFailures).size===attempt.oracle.expectedFailures.length&&attempt.oracle.expectedFailures.every(value=>typeof value==='string'&&value.length<=2560), 'Independent oracle and expected failure identities missing');
    const fullFiles=files(attempt.fullInventory), baseBinding={revision:attempt.baseRevision,environmentSha256:attempt.environmentSha256,oracleSha256:attempt.oracle.sha256}, fixedBinding={...baseBinding,revision:attempt.fixedRevision};
    const baselineFiles=files(attempt.baselineInventory||fullFiles);
    requireThat(baselineFiles.every(file=>fullFiles.includes(file)), 'Fixed native inventory drops original test files');
    requireThat(hashPattern.test(attempt.baselineOracleSha256||attempt.oracle.sha256), 'Original baseline oracle binding missing');
    const baseline=inspectCampaignProcess(root,attempt.nativeBaseline,{...baseBinding,oracleSha256:attempt.baselineOracleSha256||attempt.oracle.sha256,expectedFiles:baselineFiles});
    requireThat(baseline.failed.length===0&&baseline.pending===0, 'Original native baseline fails or contains unexecuted cases');
    const before=inspectCampaignProcess(root,attempt.regressionBefore,baseBinding), after=inspectCampaignProcess(root,attempt.regressionAfter,fixedBinding), full=inspectCampaignProcess(root,attempt.fullAfter,{...fixedBinding,expectedFiles:fullFiles});
    requireThat(attempt.oracle.expectedFailures.every(identity=>before.failed.includes(identity))&&before.failed.every(identity=>attempt.oracle.expectedFailures.includes(identity)), 'Independent regression not reproduced exactly');
    requireThat(after.failed.length===0&&full.failed.length===0&&after.pending===0&&full.pending===0, 'Fixed regression or full native suite fails or skips regression');
    requireThat(before.cases.every(item=>after.cases.some(next=>next.id===item.id&&next.status==='passed')), 'Fixed regression drops or skips original case identities');
    requireThat(after.cases.every(item=>full.cases.some(next=>next.id===item.id&&next.status==='passed')), 'Full native suite omits independent regression');
    requireThat(baseline.cases.every(item=>full.cases.some(next=>next.id===item.id&&next.status==='passed')), 'Fixed full native suite drops original baseline cases');
    result.regressionQualified=true; result.status='regression-qualified';
    result.observations={baselineCases:baseline.cases.length,fullCases:full.cases.length,independentFailures:before.failed.length};
    if(!Array.isArray(attempt.comparisons)||attempt.comparisons.length<4||attempt.comparisons.length>32) { result.reasons.push('Repeated cold and warm three-arm comparisons missing'); return result; }
    let nativeQualityEquivalent=true;
    const seen=new Set(), receipts=new Set(), states={cold:new Set(),warm:new Set()}, timings={cold:{native:[],testlore:[],full:[]},warm:{native:[],testlore:[],full:[]}};
    for(const trial of attempt.comparisons) {
      requireThat(['cold','warm'].includes(trial.cache)&&integer(trial.repetition)&&['original','fixed'].includes(trial.state), 'Invalid comparison trial');
      const key=trial.cache+':'+trial.repetition+':'+trial.state; requireThat(!seen.has(key), 'Duplicate comparison trial'); seen.add(key);
      states[trial.cache].add(trial.state);
      for(const arm of ['native','testlore','full']) { requireThat(trial[arm]&&!receipts.has(trial[arm].path)&&!receipts.has(trial[arm].sha256), 'Reused comparison process receipt'); receipts.add(trial[arm].path); receipts.add(trial[arm].sha256); }
      const binding=trial.state==='original'?baseBinding:fixedBinding;
      const native=inspectCampaignProcess(root,trial.native,binding), routed=inspectCampaignProcess(root,trial.testlore,binding), complete=inspectCampaignProcess(root,trial.full,{...binding,expectedFiles:fullFiles});
      requireThat(sameSet(complete.cases.map(item=>item.id),full.cases.map(item=>item.id)), 'Comparison full native case inventory differs from fixed independent full run');
      if(trial.state==='fixed')requireThat(complete.failed.length===0, 'Fixed comparison full native suite regressed');
      if(trial.state==='original')requireThat(attempt.oracle.expectedFailures.every(identity=>complete.failed.includes(identity)), 'Original comparison does not reproduce independent regression');
      requireThat(complete.cases.every(item=>item.status==='passed'||item.status==='failed'), 'Comparison full suite contains skipped cases');
      requireThat(routed.failed.every(identity=>complete.failed.includes(identity))&&complete.failed.every(identity=>routed.failed.includes(identity)), 'TestLore fails to preserve independently observed full-suite failures');
      requireThat(routed.cases.every(item=>complete.cases.some(next=>next.id===item.id&&next.status===item.status)), 'TestLore outcomes differ from independent full native run');
      requireThat(native.cases.every(item=>complete.cases.some(next=>next.id===item.id&&next.status===item.status)), 'Native selector outcomes differ from independent full run');
      if(complete.failed.some(identity=>!native.failed.includes(identity))) { result.additionalFailurePreservation=true; nativeQualityEquivalent=false; }
      for(const [arm,process] of Object.entries({native,testlore:routed,full:complete}))timings[trial.cache][arm].push(process.elapsedMs);
    }
    requireThat(states.cold.size===2&&states.warm.size===2&&timings.cold.native.length>=2&&timings.warm.native.length>=2, 'At least two cold and two warm comparison trials required');
    result.routingQualified=true;
    result.timings=Object.fromEntries(Object.entries(timings).map(([cache,arms])=>[cache,Object.fromEntries(Object.entries(arms).map(([arm,values])=>[arm,{trials:values.length,medianMs:median(values)}]))]));
    result.nativeQualityEquivalent=nativeQualityEquivalent;
    result.speedQualified=nativeQualityEquivalent&&['cold','warm'].every(cache=>result.timings[cache].testlore.medianMs<result.timings[cache].native.medianMs&&result.timings[cache].testlore.medianMs<result.timings[cache].full.medianMs);
    if(!nativeQualityEquivalent)result.reasons.push('Native selector misses full-suite failures; its timing is not quality-equivalent');
    if(!result.speedQualified)result.reasons.push('No demonstrated cold and warm speed advantage over both native selection and full execution');
  } catch(error) { result.reasons.push(error.message); }
  return result;
}

/** Offline qualification of retained captures. This evaluator executes no commands or promotions. */
export function assessCommunityCampaign(manifest,{root}={}) {
  requireThat(root&&fs.statSync(root).isDirectory(), 'Evidence root required');
  requireThat(manifest?.schemaVersion===1&&typeof manifest.campaignId==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(manifest.campaignId)&&['public-capture','constructed-contract-test'].includes(manifest.evidenceClass), 'Unsupported community campaign');
  requireThat(Array.isArray(manifest.attempts)&&manifest.attempts.length>0&&manifest.attempts.length<=32, 'Campaign needs one to 32 retained attempts');
  const ids=new Set(), changes=new Set(), patches=new Set();
  const attempts=manifest.attempts.map(attempt=>{const change=attempt.repository+':'+attempt.baseRevision+':'+attempt.fixedRevision; requireThat(!ids.has(attempt.id)&&!changes.has(change)&&!patches.has(attempt.patchSha256), 'Duplicate campaign attempt or change'); ids.add(attempt.id); changes.add(change); patches.add(attempt.patchSha256);return assessAttempt(root,attempt);});
  const eligible=manifest.evidenceClass==='public-capture';
  return {schemaVersion:1,kind:'community-campaign-assessment',campaignId:manifest.campaignId,evidenceClass:manifest.evidenceClass,attempts,summary:{retainedAttempts:attempts.length,inconclusive:attempts.filter(item=>!item.regressionQualified).length,qualifiedRegressions:eligible?attempts.filter(item=>item.regressionQualified).length:0,qualifiedRouting:eligible?attempts.filter(item=>item.routingQualified).length:0,measuredSpeedAdvantages:eligible?attempts.filter(item=>item.speedQualified).length:0,additionalFailurePreservation:eligible?attempts.filter(item=>item.routingQualified&&item.additionalFailurePreservation).length:0,submitted:eligible?attempts.filter(item=>item.contribution.status==='submitted').length:0,accepted:eligible?attempts.filter(item=>item.contribution.accepted).length:0},authority:{routingOmissions:false,repairAcceptance:false,learningPromotion:false},limitations:['Scoped replay of captured producer and native reports; hashes identify bytes and do not prove truth or authenticity.','Declared oracle independence, process timing, environment and discovery attribution need independent review; this offline evaluator cannot establish them.','Cold and warm describe declared campaign cache protocols; OS-cold hardware and cache equivalence are not established.','Captured GitHub states do not establish current PR status or maintainer satisfaction. Submitted contributions are separate from accepted contributions.','Passing this contract establishes no universal correctness, general speed advantage, learning benefit or gold-standard ranking.']};
}
