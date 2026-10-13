import fs from 'node:fs';
import path from 'node:path';
import {readConfig,safePath} from './files.js';
import {digest,freshness} from './provenance.js';
import {captureRepairState,isRepairSourcePath} from './repair-candidates.js';
import {captureRepairChallenges,runRepairChallenges} from './repair-challenges.js';

/** Explicit repository oracles supplement native tests. They never authorize
 * omissions, prove authorship, or establish universal defect coverage. */
export function verifyBehavioralContracts(root,{timeoutMs=20000,totalTimeoutMs=120000,expectedProvenance}={}) {
 root=path.resolve(root);const started=performance.now();
 if(!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>120000||!Number.isSafeInteger(totalTimeoutMs)||totalTimeoutMs<1||totalTimeoutMs>120000)throw Error('behavioral-contract-budget-invalid');
 const deadline=started+totalTimeoutMs;
 const report={schemaVersion:1,kind:'behavioral-contract-verification',status:'incomplete',complete:false,exitCode:2,
  runs:[],reasons:[],repetitions:1,independence:'maintainer-attestation-not-inferred-from-execution',
  authority:'additional-oracles-only-no-selection-or-publication-authority',
  limitations:['Only explicitly configured Node CommonJS challenges were requested.','Passing these assertions does not establish all bugs are caught.','Trusted project execution; this is not an OS sandbox.'],
  nextAction:'Inspect incomplete contract evidence; preserve the independent assertions and rerun verification.'};
 const finish=()=>({...report,durationMs:Math.round(performance.now()-started)});
 try {
  const config=readConfig(root),definition=captureRepairChallenges(root,config);
  if(definition.status==='not-configured')return {...finish(),status:'not-configured',exitCode:2,reasons:['behavioral-contracts-not-configured'],nextAction:'Commit independently maintained behavioral challenges and configure repair.challenges and repair.sourcePaths. No additional behavioral check ran.'};
  const sourcePaths=config.repair?.sourcePaths;
  if(!Array.isArray(sourcePaths)||!sourcePaths.length||sourcePaths.length>32||new Set(sourcePaths).size!==sourcePaths.length||sourcePaths.some(file=>!isRepairSourcePath(file)))throw Error('behavioral-contract-source-scope-invalid');
  sourcePaths.forEach(file=>safePath(root,file));
  const before=captureRepairState(root,{deadline});
  if(expectedProvenance&&(!freshness(expectedProvenance,before.provenance).fresh||expectedProvenance.revision!==before.provenance.revision))throw Error('behavioral-contract-native-source-drift');
  report.binding={oracle:definition.identity,source:before.scope.fingerprint,dependencies:before.dependencies.fingerprint,provenance:before.provenance.fingerprint};
  const assertFresh=()=>{
   const current=captureRepairState(root,{deadline});
   if(current.scope.fingerprint!==before.scope.fingerprint||current.dependencies.fingerprint!==before.dependencies.fingerprint||digest(current.nativeRuntime)!==digest(before.nativeRuntime)||!freshness(before.provenance,current.provenance).fresh||current.provenance.revision!==before.provenance.revision)throw Error('behavioral-contract-input-drift');
  };
  const actual=runRepairChallenges(root,definition,{sourcePaths,timeoutMs,deadline,assertFresh,continueOnFailure:true});
  report.execution=actual;report.runs=actual.runs;report.reasons=actual.reasons;
  assertFresh();
  // A process problem, missing tracked assertions or malformed output is not
  // a demonstrated behavioral failure. Keep it in the denominator as incomplete.
  report.complete=actual.runs.length===definition.cases.length&&actual.runs.every(item=>
   !item.signal&&!item.errorCode&&item.stderrSha256===digest('')&&item.observed?.id===item.id&&item.observed.assertions>0&&
   ((item.passed&&item.exitCode===0)||(!item.passed&&item.exitCode===1&&item.observed.status==='failed')))&&
   actual.reasons.every(reason=>reason.startsWith('repair-challenge-failed:'));
  report.status=!report.complete?'incomplete':actual.accepted?'passed':'failed';
  report.exitCode=!report.complete?2:actual.accepted?0:1;
  report.nextAction=report.status==='passed'?'These declared behavioral challenges passed. Review uncovered failure families; no universal defect coverage is established.':
   report.status==='failed'?'Inspect the named behavioral failures even if native tests passed. Repair independently established defects and preserve the challenge assertions.':report.nextAction;
 }catch(error){report.complete=false;report.status='incomplete';report.exitCode=2;report.reasons.push(String(error.message).slice(0,500));}
 return finish();
}

/** Native cases/history retain their meaning; the overall exit includes the
 * additional dimension. Missing configuration remains an explicit coverage gap. */
export function supplementWithBehavioralContracts(root,report) {
 const config=readConfig(root);
 if(config.repair?.challenges===undefined)return report;
 const contracts=verifyBehavioralContracts(root,{expectedProvenance:report.provenance||report.plan?.provenance});
 return {...report,nativeExitCode:report.exitCode,nativeComplete:report.complete,contracts,
  exitCode:contracts.exitCode===2||report.exitCode===2?2:contracts.exitCode===1?1:report.exitCode,
  ...(report.timings?{timings:{...report.timings,contractsMs:contracts.durationMs,totalMs:report.timings.totalMs+contracts.durationMs}}:{})};
}

export function saveBehavioralContractReport(root,report) {
 const directory=safePath(root,'.tddswarm');fs.mkdirSync(directory,{recursive:true});
 const file=safePath(root,'.tddswarm/contracts.json');fs.writeFileSync(file,JSON.stringify(report,null,2),{mode:0o600,flag:fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_TRUNC|fs.constants.O_NOFOLLOW});
 return {...report,receipt:'.tddswarm/contracts.json'};
}
