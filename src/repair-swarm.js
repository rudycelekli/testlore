import fs from 'node:fs';
import path from 'node:path';
import {callAgent} from './swarm.js';
import {safePath,readConfig} from './files.js';
import {freshness,digest} from './provenance.js';
import {isRepairSourcePath,captureRepairState} from './repair-candidates.js';

const plain=value=>value&&typeof value==='object'&&!Array.isArray(value);
const exact=(value,keys)=>plain(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const boundedString=(value,max)=>typeof value==='string'&&value.trim().length>0&&Buffer.byteLength(value)<=max;
const CONTRIBUTION_INDEX='.tddswarm/learning/contributions/index.json';
const bytePrefix=(value,max)=>{let result='',bytes=0;for(const char of value){const size=Buffer.byteLength(char);if(bytes+size>max)break;result+=char;bytes+=size;}return result;};
// The learning directory is excluded from the repository repair inventory.
// Bind the admitted local bytes separately so concurrent refreshes cannot
// change the hypotheses used halfway through this single bounded round.
function contributionSnapshot(root){
 let fd;
 try{
  const target=safePath(root,CONTRIBUTION_INDEX);
  fd=fs.openSync(target,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0)|(fs.constants.O_NONBLOCK||0));
  const before=fs.fstatSync(fd);
  if(!before.isFile()||before.size>8*1024*1024)return {status:'unavailable'};
  const buffer=Buffer.alloc(before.size+1);let size=0;
  for(let count;size<buffer.length&&(count=fs.readSync(fd,buffer,size,buffer.length-size,null));)size+=count;
  const after=fs.fstatSync(fd),named=fs.lstatSync(safePath(root,CONTRIBUTION_INDEX));
  if(size!==before.size||after.size!==before.size||after.mtimeMs!==before.mtimeMs||after.ctimeMs!==before.ctimeMs||named.isSymbolicLink()||named.dev!==before.dev||named.ino!==before.ino)throw Error('Contribution index changed during admission');
  return {status:'captured',sha256:digest(buffer.subarray(0,size)),bytes:size};
 }catch(error){if(error.message==='Contribution index changed during admission')throw error;return {status:error.code==='ENOENT'?'missing':'unavailable'};}
 finally{if(fd!==undefined)fs.closeSync(fd);}
}
function sourceText(root,file){
 const target=safePath(root,file);let fd;
 try{
  fd=fs.openSync(target,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0)|(fs.constants.O_NONBLOCK||0));
  const before=fs.fstatSync(fd);if(!before.isFile()||before.size>64*1024)throw Error('Repair source must be an existing regular file of at most 64 KiB');
  const buffer=Buffer.alloc(before.size+1);let size=0;
  for(let count;size<buffer.length&&(count=fs.readSync(fd,buffer,size,buffer.length-size,null));)size+=count;
  const after=fs.fstatSync(fd),named=fs.lstatSync(safePath(root,file));
  if(size!==before.size||after.size!==before.size||after.mtimeMs!==before.mtimeMs||after.ctimeMs!==before.ctimeMs||named.isSymbolicLink()||named.dev!==before.dev||named.ino!==before.ino)throw Error('Repair source changed during admission');
  return new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(buffer.subarray(0,size));
 }finally{if(fd!==undefined)fs.closeSync(fd);}
}
function namedFailures(root,baseline){
 if(!plain(baseline)||baseline.complete!==true||baseline.exitCode!==1||baseline.signal||baseline.error||baseline.reportErrors?.length||!Array.isArray(baseline.tests)||baseline.tests.length>10000)throw Error('Repair requires a complete failing baseline');
 const failures=[],keys=new Set();
 for(const test of baseline.tests){
  if(!plain(test)||!['passed','failed','skipped'].includes(test.status))throw Error('Repair baseline has unsupported case outcomes');
  if(test.status!=='failed')continue;
  if(!boundedString(test.file,4096)||!boundedString(test.name,2048)||test.name==='<file-load>')throw Error('Repair requires named assertion failures, not file-load failures');
  safePath(root,test.file);
  const key=JSON.stringify([test.file,test.name]);if(keys.has(key))throw Error('Repair baseline failure identities are ambiguous');keys.add(key);
  failures.push({file:test.file,name:test.name,status:'failed'});
 }
 if(!failures.length||failures.length>32)throw Error('Repair requires 1–32 named baseline failures');
 return failures;
}
function workerFailure(error){
 if(/timed out|late response|deadline/i.test(error?.message||''))return 'worker deadline exceeded';
 if(/output.*budget|output.*limit/i.test(error?.message||''))return 'worker output budget exceeded';
 if(/JSON object/i.test(error?.message||''))return 'worker returned invalid JSON';
 if(error?.code==='ENOENT')return 'worker executable unavailable';
 if(/inputs changed|freshness/i.test(error?.message||''))return 'immutable repository inputs changed';
 return 'worker invocation or protocol failed';
}

/** One bounded source-repair proposal round. Acceptance here is review, never execution proof. */
export async function proposeRepair(root,{agent,sourcePaths,requirements,baseline,timeoutMs=60000,deadlineMs=180000,maxTasks=3,maxOutputBytes=128*1024,contributionSourceRoot}={}){
 const started=performance.now(),workerReceipts=[];
 let inputBindings=null,budgets=null,phase='admission',contributionRetrieval=null;
 const accounting=()=>({attemptedCalls:workerReceipts.length,completedCalls:workerReceipts.filter(receipt=>receipt.status==='completed').length,durationMs:Math.round(performance.now()-started),workerReceipts,budgets,...(contributionRetrieval?{contributionRetrieval}:{}),cost:{measurement:'not-measured',tokens:null,amount:null,currency:null}});
 try{
 root=fs.realpathSync(path.resolve(root));
 if(!Array.isArray(agent)||!agent.length||agent.length>64||agent.some(arg=>typeof arg!=='string'||!arg||arg.includes('\0')))throw Error('Repair agent must be an executable and argv array');
 if(!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>360000||!Number.isInteger(deadlineMs)||deadlineMs<1||deadlineMs>900000||!Number.isInteger(maxTasks)||maxTasks<1||maxTasks>3||!Number.isInteger(maxOutputBytes)||maxOutputBytes<1024||maxOutputBytes>256*1024)throw Error('Invalid repair worker budgets');
 budgets={timeoutMs,deadlineMs,maxTasks,maxCalls:maxTasks+2,maxOutputBytes,rounds:1};
 if(!boundedString(requirements,64*1024))throw Error('Repair requires independent requirements of at most 64 KiB');
 if(!Array.isArray(sourcePaths)||!sourcePaths.length||sourcePaths.length>32||new Set(sourcePaths).size!==sourcePaths.length||sourcePaths.some(file=>!isRepairSourcePath(file)||file.split('/').some(part=>!part||part==='.')))throw Error('Repair requires 1–32 distinct allowlisted existing source paths');
 const failures=namedFailures(root,baseline),inputState=captureRepairState(root,{deadline:started+deadlineMs}),provenance=inputState.provenance;
 const context=sourcePaths.map(file=>({file,content:sourceText(root,file)}));
 if(context.some(item=>digest(item.content)!==inputState.scope.files[item.file]?.hash))throw Error('Repair sources are outside the immutable repository input inventory');
 if(Buffer.byteLength(JSON.stringify({context,requirements,failures}))>256*1024)throw Error('Repair context exceeds 256 KiB');
 const config=readConfig(root),contributionsEnabled=config.learning?.enabled!==false&&config.learning?.contributions?.enabled===true;
 let contributionBinding=null,contributionKnowledge=null,sourceContributionBinding=null,sourceContributionRoot=null;
 if(contributionsEnabled){
  const begin=performance.now(),contract=bytePrefix(requirements,16000),query=bytePrefix(requirements+' '+sourcePaths.join(' ')+' '+failures.map(item=>item.name).join(' '),4096);
  contributionBinding=contributionSnapshot(root);
  if(contributionSourceRoot!==undefined){
   if(typeof contributionSourceRoot!=='string')throw Error('Contribution source root must be an existing project directory');
   sourceContributionRoot=fs.realpathSync(path.resolve(contributionSourceRoot));sourceContributionBinding=contributionSnapshot(sourceContributionRoot);
   if(sourceContributionBinding.status==='captured'&&digest(sourceContributionBinding)!==digest(contributionBinding))throw Error('Repair contribution knowledge inputs changed during branch admission');
  }
  contributionRetrieval={advisory:true,status:'unavailable',index:contributionBinding,querySha256:digest(query),contractSha256:digest(contract),contractTruncated:contract!==requirements,queryBytes:Buffer.byteLength(query),contractBytes:Buffer.byteLength(contract),maxEntries:3,maxPayloadBytes:6000,payloadBytes:0,providerCalls:0,networkRequests:0,durationMs:0,reviewerReceivesKnowledge:false};
  try{
   if(contributionBinding.status==='captured'){
    const {recallContributionKnowledge}=await import('./contribution-knowledge.js');
    const recalled=recallContributionKnowledge(root,query,{contract,limit:3,maxChars:6000,excludeRepositories:[]});
    if(!plain(recalled)||recalled.advisoryOnly!==true||recalled.authority!=='none'||Buffer.byteLength(JSON.stringify(recalled))>6000)throw Error('Invalid bounded contribution recall');
    if(recalled.records?.length&&recalled.corpusStoreSha256!==contributionBinding.sha256)throw Error('Repair contribution knowledge inputs changed during retrieval');
    contributionKnowledge=recalled;contributionRetrieval.status=recalled.records?.length?'recalled':recalled.reason==='invalid-contribution-retrieval-or-store'?'unavailable':'abstained';contributionRetrieval.payloadBytes=Buffer.byteLength(JSON.stringify(recalled));contributionRetrieval.payloadSha256=digest(recalled);
    if(recalled.reason)contributionRetrieval.reason=recalled.reason;
   }
  }catch(error){if(error.message==='Repair contribution knowledge inputs changed during retrieval')throw error;contributionRetrieval.status='unavailable';contributionRetrieval.reason='Local contribution knowledge could not be safely recalled';}
  contributionRetrieval.durationMs=Math.round((performance.now()-begin)*1000)/1000;
  if(digest(contributionSnapshot(root))!==digest(contributionBinding))throw Error('Repair contribution knowledge inputs changed during retrieval');
  if(sourceContributionBinding&&digest(contributionSnapshot(sourceContributionRoot))!==digest(sourceContributionBinding))throw Error('Repair contribution knowledge inputs changed during retrieval');
 }
 const immutable=()=>{
  let current;try{current=captureRepairState(root,{deadline:started+deadlineMs});}catch(error){if(performance.now()-started>=deadlineMs)throw Error('Repair round deadline exhausted');throw Error('Repair inputs changed while workers were running');}
  const state=freshness(provenance,current.provenance);
  if(!state.fresh||provenance.revision!==current.provenance.revision||inputState.scope.fingerprint!==current.scope.fingerprint||inputState.dependencies.fingerprint!==current.dependencies.fingerprint)throw Error('Repair inputs changed while workers were running: '+state.reasons.join(', '));
  if(contributionBinding&&digest(contributionSnapshot(root))!==digest(contributionBinding))throw Error('Repair contribution knowledge inputs changed while workers were running');
  if(sourceContributionBinding&&digest(contributionSnapshot(sourceContributionRoot))!==digest(sourceContributionBinding))throw Error('Repair contribution knowledge inputs changed while workers were running');
 };
 const remaining=()=>Math.floor(deadlineMs-(performance.now()-started));
 inputBindings={requirementsSha256:digest(requirements),baselineFailuresSha256:digest(failures),sourceHashes:Object.fromEntries(context.map(item=>[item.file,digest(item.content)])),repositoryFingerprint:provenance.fingerprint,scopeFingerprint:inputState.scope.fingerprint,dependencyFingerprint:inputState.dependencies.fingerprint};
 if(contributionRetrieval)inputBindings.contributionKnowledge={index:contributionBinding,...(sourceContributionBinding?{callerIndex:sourceContributionBinding}:{}),querySha256:contributionRetrieval.querySha256,contractSha256:contributionRetrieval.contractSha256,payloadSha256:contributionRetrieval.payloadSha256||null};
 async function invoke(role,payload,subject){
  immutable();const available=remaining();if(available<1)throw Error('Repair round deadline exhausted');
  const timeout=Math.min(timeoutMs,available),begin=performance.now(),request={schemaVersion:1,role,requirements,baselineFailures:failures,...payload};
  if(contributionKnowledge&&role!=='repair-reviewer')request.contributionKnowledge=contributionKnowledge;
  const receipt={role,...(subject?{subject}:{}),round:1,startedAfterMs:Math.round(begin-started),timeoutMs:timeout,requestPayloadSha256:digest(request),status:'running'};workerReceipts.push(receipt);
  try{
   const response=await callAgent(agent,request,root,timeout,{maxOutputBytes});receipt.responseSha256=digest(response);
   immutable();if(remaining()<1)throw Error('Repair round deadline exhausted');receipt.status='completed';return response;
  }catch(error){receipt.status='failed';receipt.failure=workerFailure(error);throw Error(`Repair ${role}: ${receipt.failure}`);}
  finally{receipt.durationMs=Math.round(performance.now()-begin);}
 }
  phase='proposal';
  immutable();
  const plan=await invoke('repair-architect',{context,sourcePaths,maxTasks,acceptance:['Repair only existing allowlisted source files.','Each task owns exactly one distinct source path.','Tests, configuration, requirements and dependencies are immutable.','Return JSON proposals only; do not execute tools or edit files.']});
  if(!exact(plan,['tasks'])||!Array.isArray(plan.tasks)||!plan.tasks.length||plan.tasks.length>maxTasks)throw Error('Repair architect must return 1–'+maxTasks+' tasks');
  const owners=new Set();
  for(const task of plan.tasks){
   if(!exact(task,['subject','instructions'])||!sourcePaths.includes(task.subject)||owners.has(task.subject)||!boundedString(task.instructions,16*1024))throw Error('Repair architect tasks require distinct allowlisted source ownership');owners.add(task.subject);
  }
  // Wait for every bounded author to settle before returning any failed round.
  const authors=await Promise.allSettled(plan.tasks.map(async task=>{
   const own=context.find(item=>item.file===task.subject);
   const draft=await invoke('repair-author',{task,sourcePaths:[task.subject],context:[own]},task.subject);
   if(!exact(draft,['files'])||!Array.isArray(draft.files)||draft.files.length!==1||!exact(draft.files[0],['path','content'])||draft.files[0].path!==task.subject||!boundedString(draft.files[0].content,64*1024))throw Error('Repair author must return only its owned existing source file');
   if(digest(draft.files[0].content)===inputBindings.sourceHashes[task.subject])throw Error('Repair author returned unchanged source');
   return draft.files[0];
  }));
  const rejected=authors.find(result=>result.status==='rejected');if(rejected)throw rejected.reason;
  const files=authors.map(result=>result.value);
  if(Buffer.byteLength(JSON.stringify(files))>64*1024)throw Error('Repair proposals exceed 64 KiB');
  const review=await invoke('repair-reviewer',{context,sourcePaths,files,acceptance:['Check each proposal against independent requirements and the named original failures.','Reject test/configuration changes, oracle weakening, unsupported claims and changes outside source ownership.','A review is advisory; full native validation independently decides acceptance.']});
  if(!exact(review,['accepted','findings','oracle'])||typeof review.accepted!=='boolean'||!Array.isArray(review.findings)||review.findings.length>50||review.findings.some(value=>!boundedString(value,2048))||!exact(review.oracle,['independent','basis'])||typeof review.oracle.independent!=='boolean'||!Array.isArray(review.oracle.basis)||review.oracle.basis.length>20||review.oracle.basis.some(value=>!boundedString(value,2048)))throw Error('Repair reviewer returned invalid review evidence');
  const accepted=review.accepted&&review.oracle.independent&&review.oracle.basis.length>0;
  immutable();if(remaining()<1)throw Error('Repair round deadline exhausted');
  return {schemaVersion:1,status:accepted?'reviewed-repair':'review-rejected',accepted,review,files,requirements,sourcePaths:[...sourcePaths],baselineFailures:failures,provenance,inputBindings,...accounting(),applied:false,executionValidated:false,authority:'proposal-only'};
 }catch(error){error.repairSwarm={schemaVersion:1,status:'failed',accepted:false,failureStage:phase,inputBindings,...accounting(),applied:false,executionValidated:false,authority:'proposal-only'};throw error;}
}
