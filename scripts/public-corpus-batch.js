#!/usr/bin/env node
/** Sequential public campaigns. No downloads, installations, retries or provider calls. */
import fs from 'node:fs';
import path from 'node:path';
import {spawn,execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {digest} from '../src/provenance.js';
import {readBoundedJson} from './evaluation-commitment.js';
import {fileIdentity} from './worker-identity.js';
import {validateCandidates,publicAttemptSummary} from './public-corpus.js';
const HASH=/^[a-f0-9]{64}$/, controller=fileURLToPath(import.meta.url), worker=fileURLToPath(new URL('./public-corpus.js',import.meta.url));
const save=(file,value)=>fs.writeFileSync(file,JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600});
export function validateBatch(selection,plan){
 validateCandidates(selection);
 if(plan?.schemaVersion!==1||plan.kind!=='public-corpus-batch-plan'||plan.selectionCommitmentSha256!==selection.commitmentSha256||!Array.isArray(plan.entries)||!plan.entries.length||plan.entries.length>100||!Number.isInteger(plan.maxCandidateMs)||plan.maxCandidateMs<1000||plan.maxCandidateMs>1800000||!Number.isInteger(plan.maxCampaignMs)||plan.maxCampaignMs<plan.maxCandidateMs||plan.maxCampaignMs>7200000||!Number.isSafeInteger(plan.minFreeBytes)||plan.minFreeBytes<1024**3)throw Error('Supply frozen entries, bounded deadlines and at least 1 GiB disk reserve');
 const seen=new Set();for(const entry of plan.entries){if(!selection.candidates.some(c=>c.id===entry.candidateId)||seen.has(entry.candidateId))throw Error('Each selected candidate has one batch entry');seen.add(entry.candidateId);if(entry.blockedReason!==undefined){if(typeof entry.blockedReason!=='string'||!entry.blockedReason||entry.blockedReason.length>500||entry.preparedPath!==undefined)throw Error('Blocked entries need a bounded reason and no prepared trial');}else if(!path.isAbsolute(entry.preparedPath||'')||!HASH.test(entry.preparedSha256||''))throw Error('Bind reviewed prepared input by absolute path and SHA-256');}
 return plan;
}
function freeBytes(root){const stat=fs.statfsSync(root);return stat.bavail*stat.bsize;}
async function runChild({root,selectionPath,entry,relative,output,timeoutMs,minFreeBytes}){
 if(process.platform==='win32')return {reason:'process-group-deadline-unsupported-on-windows',exitCode:null};
 const out=fs.openSync(path.join(output,'stdout.log'),'wx',0o600),err=fs.openSync(path.join(output,'stderr.log'),'wx',0o600);let reason=null;
 const child=spawn(process.execPath,[worker,'run','--selection',selectionPath,'--prepared',entry.preparedPath,'--output',relative],{cwd:root,stdio:['ignore',out,err],detached:process.platform!=='win32'});
 const stop=why=>{if(reason)return;reason=why;
  // Native sessions create their own groups. Observe the tree before stopping the
  // controller and terminate descendants first; this is best-effort cleanup,
  // not a claim that an arbitrary subprocess cannot detach/reparent itself.
  try{const rows=execFileSync('ps',['-axo','pid=,ppid='],{encoding:'utf8',timeout:1000,maxBuffer:2*1024*1024}).trim().split('\n').map(line=>line.trim().split(/\s+/).map(Number));const descendants=new Set([child.pid]);let added=true;while(added){added=false;for(const [pid,parent]of rows)if(descendants.has(parent)&&!descendants.has(pid)){descendants.add(pid);added=true;}}for(const pid of [...descendants].reverse())if(pid!==child.pid){try{process.kill(-pid,'SIGKILL');}catch{}try{process.kill(pid,'SIGKILL');}catch{}}}catch{}
  try{process.kill(-child.pid,'SIGKILL');}catch{}try{child.kill('SIGKILL');}catch{}
 };
 const timer=setTimeout(()=>stop('candidate-deadline'),timeoutMs);
 const guard=setInterval(()=>{try{if(freeBytes(root)<minFreeBytes)stop('disk-reserve');else if(fs.fstatSync(out).size+fs.fstatSync(err).size>16*1024*1024)stop('log-byte-budget');}catch{stop('resource-observation-failed');}},250);
 try{return await new Promise(resolve=>{child.once('error',()=>resolve({reason:'native-controller-start-failed',exitCode:null}));child.once('close',(exitCode,signal)=>resolve({reason,exitCode,signal,descendantCleanup:reason?'observed-process-tree-best-effort':'not-requested'}));});}finally{clearTimeout(timer);clearInterval(guard);fs.closeSync(out);fs.closeSync(err);}
}
/** Interrupted starts are terminal partial attempts; resume never silently retries them. */
export async function runPublicBatch(root,selectionPath,plan,relative,{executeCandidate=runChild,availableBytes=freeBytes}={}){
 root=fs.realpathSync(root);const selection=readBoundedJson(selectionPath,16*1024*1024);validateBatch(selection,plan);
 if(!/^\.tddswarm\/public-batches\/[A-Za-z0-9_-]+$/.test(relative))throw Error('Use .tddswarm/public-batches/ALIAS');
 const directory=path.join(root,relative);fs.mkdirSync(directory,{recursive:true});const sourceFiles=[];const inventory=folder=>{for(const item of fs.readdirSync(folder,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){const file=path.join(folder,item.name);if(item.isDirectory())inventory(file);else if(item.isFile())sourceFiles.push([path.relative(path.dirname(controller),file),fileIdentity(file).sha256]);else throw Error('Implementation inventory requires regular files');if(sourceFiles.length>256)throw Error('Implementation inventory exceeds bound');}};inventory(fileURLToPath(new URL('../src',import.meta.url)));const frozen={implementationSha256:digest(sourceFiles),selectionSha256:digest(selection),planSha256:digest(plan),controllerSha256:fileIdentity(controller).sha256,workerSha256:fileIdentity(worker).sha256};
 const commitment=path.join(directory,'commitment.json');if(fs.existsSync(commitment)){if(JSON.stringify(readBoundedJson(commitment))!==JSON.stringify(frozen))throw Error('Resume requires unchanged selection, plan and controller bytes');}else{save(commitment,frozen);save(path.join(directory,'plan.json'),plan);}
 const lock=path.join(directory,'running.json');if(fs.existsSync(lock)){const old=readBoundedJson(lock);if(!Number.isInteger(old.pid))throw Error('Invalid campaign lock');try{process.kill(old.pid,0);throw Error('Campaign controller is already running');}catch(error){if(error.code!=='ESRCH')throw error;}fs.unlinkSync(lock);}save(lock,{pid:process.pid});
 const started=performance.now(),attempts=[];let stopped=null,campaignMs=0;
 try{
  for(let index=0;index<plan.entries.length;index++){
   const entry=plan.entries[index],prefix=String(index).padStart(3,'0')+'-'+entry.candidateId,output=path.join(directory,prefix),begin=path.join(output,'started.json'),end=path.join(output,'finished.json');
   if(fs.existsSync(end)){const old=readBoundedJson(end,16*1024*1024);if(old.candidateId!==entry.candidateId||old.entryHash!==digest(entry)||old.receiptSha256!==digest(old.attempt)||!Number.isSafeInteger(old.chargedMs)||old.chargedMs<0||old.chargedMs>plan.maxCandidateMs+30000)throw Error('Retained attempt commitment mismatch');attempts.push(old.attempt);campaignMs+=old.chargedMs;continue;}
   if(fs.existsSync(begin)){const old=readBoundedJson(begin);if(old.entryHash!==digest(entry))throw Error('Interrupted attempt identity differs');const attempt={candidateId:entry.candidateId,status:'partial',reason:'interrupted-controller; retained start cannot be retried in this campaign',assessment:{qualified:false}};save(end,{candidateId:entry.candidateId,entryHash:digest(entry),chargedMs:plan.maxCandidateMs,attempt,receiptSha256:digest(attempt)});attempts.push(attempt);campaignMs+=plan.maxCandidateMs;continue;}
   if(campaignMs+performance.now()-started>=plan.maxCampaignMs){stopped='campaign-deadline';break;}
   if(availableBytes(root)<plan.minFreeBytes){stopped='disk-reserve';break;}
   fs.mkdirSync(output);save(begin,{candidateId:entry.candidateId,entryHash:digest(entry),startedAt:new Date().toISOString(),maxCandidateMs:plan.maxCandidateMs});
   let attempt,result=null;const attemptStart=performance.now();
   try{
    if(entry.blockedReason!==undefined)attempt={candidateId:entry.candidateId,status:'blocked',reason:entry.blockedReason};
    else{
     if(fileIdentity(entry.preparedPath,16*1024*1024).sha256!==entry.preparedSha256)throw Error('Prepared input drift');
     const trialRelative='.tddswarm/pilots/batch-'+digest(relative).slice(0,12)+'-'+index;
     result=await executeCandidate({root,selectionPath:path.resolve(selectionPath),entry,relative:trialRelative,output,timeoutMs:Math.min(plan.maxCandidateMs,Math.max(1,Math.floor(plan.maxCampaignMs-campaignMs-(performance.now()-started)))),minFreeBytes:plan.minFreeBytes});
     save(path.join(output,'process.json'),result);
     if(result.reason)throw Error(result.reason);
     attempt=readBoundedJson(path.join(root,trialRelative,'public-attempt.json'),16*1024*1024);
     if(attempt.candidateId!==entry.candidateId||![0,1].includes(result.exitCode)||result.exitCode!==(attempt.assessment?.qualified?0:1))throw Error('Native process and retained candidate assessment disagree');
    }
   }catch(error){attempt={candidateId:entry.candidateId,status:'partial',reason:String(error.message).slice(0,500),assessment:{qualified:false}};}
   const chargedMs=Math.ceil(performance.now()-attemptStart);save(end,{candidateId:entry.candidateId,entryHash:digest(entry),chargedMs,attempt,receiptSha256:digest(attempt)});attempts.push(attempt);
   if(result?.reason==='disk-reserve'||availableBytes(root)<plan.minFreeBytes){stopped='disk-reserve';break;}
  }
  const summary={...publicAttemptSummary(selection,attempts),campaignElapsedMs:Math.ceil(campaignMs+performance.now()-started),invocationElapsedMs:Math.ceil(performance.now()-started),stopped,complete:attempts.length===plan.entries.length,plannedEntries:plan.entries.length,notPlanned:selection.candidates.length-plan.entries.length,automaticRetries:0,limitations:['SHA commitments preserve local controller accounting, not external trust or authorship.','Interruptions, failed starts, drift and rejected reports remain in the attempted denominator.','Resource stops leave remaining candidates unattempted; resumed starts are never rerun.','Hard deadline bounds controller lifetime; observed descendant termination is best effort, not containment of arbitrary subprocesses.','This controller performs no dependency installation and makes no upstream-lock installation claim.']};
  save(path.join(directory,'summary-'+fs.readdirSync(directory).filter(name=>/^summary-\d+\.json$/.test(name)).length+'.json'),summary);return summary;
 }finally{fs.unlinkSync(lock);}
}
if(process.argv[1]&&path.resolve(process.argv[1])===controller){try{const args=process.argv.slice(2);if(args.length!==6||args[0]!=='--selection'||args[2]!=='--plan'||args[4]!=='--output')throw Error('Use --selection FROZEN --plan REVIEWED_BATCH --output .tddswarm/public-batches/ALIAS');const result=await runPublicBatch(process.cwd(),path.resolve(args[1]),readBoundedJson(args[3]),args[5]);console.log(JSON.stringify(result,null,2));process.exitCode=result.targetMet?0:1;}catch(error){console.error(error.message);process.exitCode=1;}}
