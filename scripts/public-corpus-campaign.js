#!/usr/bin/env node
/** Opt-in original upstream campaign. The default command only returns a plan. */
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {digest} from '../src/provenance.js';
import {pilotEnvironment} from '../src/pilot.js';
import {fileIdentity} from './worker-identity.js';
import {readBoundedJson} from './evaluation-commitment.js';
import {validateCandidates,preparePublicCandidate,executePreparedPublic,publicAttemptSummary} from './public-corpus.js';
import {installUpstreamCandidate,boundedInstallProcess} from './public-corpus-upstream.js';
import {preflightPublicCandidate} from './public-corpus-preflight.js';
import {captureCorpusIdentity} from './regression-corpus.js';

const controller=fileURLToPath(import.meta.url),repository=fileURLToPath(new URL('../',import.meta.url));
export const campaignSelection='065b79f7f345a971e76b0a2d1bdc4f4ab34c9c3b254837b693dee552b71af65a';
const frozen=value=>{for(const child of Object.values(value))if(child&&typeof child==='object')frozen(child);return Object.freeze(value);};
export const campaignLimits=frozen({maxCampaignMs:480000,minFreeBytes:2*1024**3,maxLogBytes:2*1024**2,phases:{clone:{timeoutMs:60000,maxGrowthBytes:128*1024**2},install:{timeoutMs:180000,maxGrowthBytes:450*1024**2},preflight:{timeoutMs:90000,maxGrowthBytes:64*1024**2},prepare:{timeoutMs:30000,maxGrowthBytes:16*1024**2},run:{timeoutMs:120000,maxGrowthBytes:128*1024**2}}});
const ids=new Set(['unjs-unctx-1bb220dccf40','unjs-mlly-abef19c940da']);
const save=(file,value)=>fs.writeFileSync(file,JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600});
const git=(root,...args)=>execFileSync('git',['-C',root,...args],{encoding:'utf8',timeout:15000,maxBuffer:2*1024**2}).trim();
const freeBytes=root=>{const s=fs.statfsSync(root);return s.bavail*s.bsize;};
const keys=(object,expected)=>object&&JSON.stringify(Object.keys(object).sort())===JSON.stringify([...expected].sort());

export function validatePortableProfile(selection,profile){
 validateCandidates(selection);
 if(selection.commitmentSha256!==campaignSelection||!keys(profile,['schemaVersion','kind','reviewed','candidateId','selectionCommitmentSha256','fixRevision','parentRevision','packageManager','dependencySha256','installedVitest','scope'])||profile.schemaVersion!==1||profile.kind!=='reviewed-original-upstream-campaign-profile'||profile.reviewed!==true||!ids.has(profile.candidateId)||profile.selectionCommitmentSha256!==campaignSelection||typeof profile.scope!=='string'||!profile.scope||profile.scope.length>500)throw Error('Require a closed reviewed portable profile and original frozen selection');
 const candidate=selection.candidates.find(c=>c.id===profile.candidateId);
 if(!candidate||candidate.fixRevision!==profile.fixRevision||candidate.parentRevision!==profile.parentRevision||candidate.runtimeIdentity?.packageManager!==profile.packageManager||candidate.sourcePaths.length!==1||!candidate.maintainerOraclePaths.length||!keys(profile.dependencySha256,['package.json','pnpm-lock.yaml'])||!/^\d+\.\d+\.\d+$/.test(profile.installedVitest))throw Error('Portable candidate commit, manager or native profile mismatch');
 for(const file of ['package.json','pnpm-lock.yaml'])if(candidate.byteBindings.find(b=>b.kind==='dependency'&&b.path===file)?.sha256!==profile.dependencySha256[file])throw Error('Portable original manifest/lock mismatch');
 return candidate;
}
export function campaignEnvironment(){
 // No ambient credentials, NODE_OPTIONS, arbitrary project env or personal Git configuration.
 return {...pilotEnvironment({jitiFilesystem:false}),GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_TERMINAL_PROMPT:'0',GIT_ASKPASS:'/usr/bin/false',GIT_CONFIG_COUNT:'0'};
}
function sourceBinding(selectionPath,profilePath){
 if(process.version!=='v22.19.0')throw Error('Hosted campaign requires exact Node v22.19.0');
 if(git(repository,'status','--porcelain'))throw Error('Campaign requires a clean TestLore source checkout');
 for(const filename of [selectionPath,profilePath]){const relative=path.relative(repository,filename);if(relative.startsWith('..')||path.isAbsolute(relative)||digest(fs.readFileSync(filename))!==digest(execFileSync('git',['-C',repository,'show','HEAD:'+relative],{maxBuffer:16*1024**2,timeout:15000})))throw Error('Use exact tracked selection and reviewed profile bytes');}
 const core=captureCorpusIdentity();const additional=['public-corpus-campaign.js','public-corpus-upstream.js','public-corpus-preflight.js','public-corpus.js'].map(file=>fileIdentity(path.join(repository,'scripts',file)));
 return {sourceRevision:git(repository,'rev-parse','HEAD'),sourceTreeClean:true,files:[...core.bindings,core.nodeBinding,...additional,fileIdentity(selectionPath,16*1024**2),fileIdentity(profilePath)],core:core.public};
}
function assertBinding(binding){
 if(git(repository,'rev-parse','HEAD')!==binding.sourceRevision||git(repository,'status','--porcelain'))throw Error('Campaign source revision or cleanliness drift');
 for(const identity of binding.files)if(JSON.stringify(fileIdentity(identity.path,identity.bytes>2*1024**2?512*1024**2:2*1024**2))!==JSON.stringify(identity))throw Error('Campaign source/input/runtime drift');
}
export function phaseCompletionReason(receipt,limits,campaignElapsedMs,availableBytes){
 if(receipt.reason)return receipt.reason;
 if(receipt.exitCode!==0)return 'phase-rejected';
 const state=receipt.finalResources;
 if(!state||!['availableBytes','growthBytes','stdoutBytes','stderrBytes'].every(key=>Number.isFinite(state[key]))||!Number.isFinite(receipt.durationMs))return 'observation-failed';
 if(receipt.durationMs>limits.timeoutMs)return 'timeout';
 if(campaignElapsedMs>campaignLimits.maxCampaignMs)return 'campaign-deadline';
 if(availableBytes<campaignLimits.minFreeBytes||state.availableBytes<campaignLimits.minFreeBytes)return 'disk-reserve';
 if(state.growthBytes>limits.maxGrowthBytes)return 'disk-growth';
 if(state.stdoutBytes+state.stderrBytes>campaignLimits.maxLogBytes)return 'log-budget';
 if(!/^[a-f0-9]{64}$/.test(receipt.stdoutSha256||'')||!/^[a-f0-9]{64}$/.test(receipt.stderrSha256||''))return 'log-identity-unavailable';
 return null;
}
export function campaignPlan({selectionPath,profilePath,directory,relative}){
 selectionPath=path.resolve(selectionPath);profilePath=path.resolve(profilePath);directory=path.resolve(directory);
 const selection=readBoundedJson(selectionPath,16*1024**2),profile=readBoundedJson(profilePath);validatePortableProfile(selection,profile);
 if(!/^\.tddswarm\/public-campaigns\/[A-Za-z0-9_-]{1,64}$/.test(relative)||directory===repository||directory.startsWith(repository+path.sep)||fs.existsSync(directory))throw Error('Use a new private installation directory outside TestLore and .tddswarm/public-campaigns/ALIAS');
 if(!fs.statSync(path.dirname(directory)).isDirectory())throw Error('Private installation parent must already exist');
 return {schemaVersion:1,kind:'original-upstream-campaign-plan',execute:false,candidateId:profile.candidateId,selectionPath,profilePath,profile,selectionCommitmentSha256:campaignSelection,directory,relative,limits:campaignLimits,binding:sourceBinding(selectionPath,profilePath),cachePolicy:{jitiFilesystem:false},automaticRetries:0};
}
function runtimeProfile(plan,installation){
 const project=path.join(plan.directory,'installation/project');
 const framework=readBoundedJson(path.join(project,'node_modules/vitest/package.json'),128*1024);
 if(framework.version!==plan.profile.installedVitest)throw Error('Installed original Vitest version differs from reviewed portable profile');
 return {reviewed:true,candidateId:plan.candidateId,root:project,scope:plan.profile.scope,config:{adapter:'vitest',discovery:'native',runner:[process.execPath,path.join(project,'node_modules/vitest/vitest.mjs'),'run','--maxWorkers=1','--cache=false','{files}'],analysisCache:{enabled:false}},executionMode:'legacy',expectedFailureNames:['__preflight_pending__'],upstreamInstallation:{receiptPath:path.join(plan.directory,'installation/receipt.json'),expectedSha256:fileIdentity(path.join(plan.directory,'installation/receipt.json')).sha256},cachePolicy:{jitiFilesystem:false}};
}

async function worker(phase,input){
 const plan=readBoundedJson(input,16*1024**2);if(plan.execute!==true||plan.kind!=='original-upstream-campaign-plan'||JSON.stringify(plan.limits)!==JSON.stringify(campaignLimits))throw Error('Worker needs an explicit bound execution plan');
 assertBinding(plan.binding);const selection=readBoundedJson(plan.selectionPath,16*1024**2),candidate=validatePortableProfile(selection,plan.profile),privateRoot=plan.directory,out=path.join(repository,plan.relative),checkout=path.join(privateRoot,'checkout');let result;
 if(phase==='clone'){
  // Fetch only the supplied immutable revision and its first parent, without authentication.
  fs.mkdirSync(checkout);git(checkout,'init');git(checkout,'remote','add','origin',candidate.repository);
  git(checkout,'fetch','--depth=2','--filter=blob:none','origin',candidate.fixRevision);git(checkout,'checkout','--detach',candidate.fixRevision);
  if(git(checkout,'rev-parse','HEAD')!==candidate.fixRevision||git(checkout,'rev-parse','HEAD^')!==candidate.parentRevision||git(checkout,'status','--porcelain'))throw Error('Fresh checkout identity mismatch');
  // Original installer materializes the bounded fixed/oracle/parent blobs before local cloning.
  result={completed:true,fixRevision:candidate.fixRevision,parentRevision:candidate.parentRevision};
 }else if(phase==='install'){
  result=await installUpstreamCandidate({selection,id:plan.candidateId,checkout,directory:path.join(privateRoot,'installation'),reserveBytes:campaignLimits.minFreeBytes,timeoutMs:campaignLimits.phases.install.timeoutMs,maxGrowthBytes:campaignLimits.phases.install.maxGrowthBytes});
  if(result.status!=='completed')throw Error('Original upstream installation rejected; retain original receipt');
  save(path.join(out,'native-profile.json'),runtimeProfile(plan,result));
 }else if(phase==='preflight'){
  const profile=readBoundedJson(path.join(out,'native-profile.json'));result=preflightPublicCandidate(selection,plan.candidateId,profile,path.join(out,'independent-preflight'));
  if(!result.completed)throw Error('Independent fixed/fault preflight rejected; retain every native receipt');
 }else if(phase==='prepare'){
  const profile=readBoundedJson(path.join(out,'native-profile.json')),preflight=readBoundedJson(path.join(out,'independent-preflight/preflight.json'),16*1024**2);
  if(preflight.completed!==true||preflight.independentFullFaultRuns!==2||!preflight.expectedFailureNames?.length)throw Error('Require successful independent fixed/fault preflight');
  profile.expectedFailureNames=preflight.expectedFailureNames;profile.baselineDeclaredSkips=preflight.baselineDeclaredSkips;
  save(path.join(out,'reviewed-native-profile.json'),profile);result=preparePublicCandidate(selection,plan.candidateId,profile);save(path.join(out,'prepared.json'),result);
 }else if(phase==='run'){
  result=executePreparedPublic(repository,selection,readBoundedJson(path.join(out,'prepared.json'),16*1024**2),plan.relative+'/corpus');
 }else throw Error('Unsupported campaign worker phase');
 assertBinding(plan.binding);save(path.join(out,'phases',phase,'result.json'),result);
 if(phase==='run'&&!result.assessment?.qualified)throw Error('Three-arm qualification rejected; retain public attempt');
 return result;
}

/** Injectable phase executor supports source-only guard/accounting tests; the CLI always uses native execution. */
export async function runCampaign(plan,{executePhase=boundedInstallProcess,availableBytes=freeBytes,now=()=>performance.now()}={}){
 if(plan.execute!==false||JSON.stringify(plan.limits)!==JSON.stringify(campaignLimits))throw Error('Require an unchanged dry-run campaign plan before explicit execution');
 assertBinding(plan.binding);const output=path.join(repository,plan.relative);
 if(fs.existsSync(output)||fs.existsSync(plan.directory))throw Error('Campaign output/private directory must be new; interrupted phases cannot be retried');
 fs.mkdirSync(path.dirname(output),{recursive:true});fs.mkdirSync(output,{mode:0o700});fs.mkdirSync(path.join(output,'phases'));
 const executed={...plan,execute:true};save(path.join(output,'plan.json'),executed);const executionInputIdentity=fileIdentity(path.join(output,'plan.json'),16*1024**2),start=now(),phases=[];let failedPhase=null,stopReason=null;
 try{
  if(availableBytes(path.dirname(plan.directory))<campaignLimits.minFreeBytes)throw Error('disk-reserve');
  fs.mkdirSync(plan.directory,{mode:0o700});
  for(const [phase,limits]of Object.entries(campaignLimits.phases)){
   const elapsed=now()-start;if(elapsed>=campaignLimits.maxCampaignMs){failedPhase=phase;throw Error('campaign-deadline');}
   if(availableBytes(plan.directory)<campaignLimits.minFreeBytes){failedPhase=phase;throw Error('disk-reserve');}
   assertBinding(plan.binding);const phaseRoot=path.join(output,'phases',phase);fs.mkdirSync(phaseRoot);
   save(path.join(phaseRoot,'started.json'),{phase,planSha256:fileIdentity(path.join(output,'plan.json'),16*1024**2).sha256,startedAt:new Date().toISOString(),limits});
   const timeoutMs=Math.min(limits.timeoutMs,Math.floor(campaignLimits.maxCampaignMs-elapsed));
   const processReceipt=await executePhase(process.execPath,[controller,'--worker',phase,'--input',path.join(output,'plan.json'),'--execute'],{cwd:repository,directory:phaseRoot,env:campaignEnvironment(),timeoutMs,reserveBytes:campaignLimits.minFreeBytes,maxGrowthBytes:limits.maxGrowthBytes,maxLogBytes:campaignLimits.maxLogBytes,terminateDescendants:true});
   save(path.join(phaseRoot,'process.json'),processReceipt);let finalReason=phaseCompletionReason(processReceipt,{...limits,timeoutMs},now()-start,availableBytes(plan.directory));
   if(JSON.stringify(fileIdentity(executionInputIdentity.path,16*1024**2))!==JSON.stringify(executionInputIdentity))finalReason='execution-input-drift';
   if(!finalReason&&!fs.existsSync(path.join(phaseRoot,'result.json')))finalReason='phase-result-missing';
   const completed=processReceipt.exitCode===0&&!finalReason;save(path.join(phaseRoot,'finished.json'),{phase,completed,processSha256:fileIdentity(path.join(phaseRoot,'process.json')).sha256});phases.push({phase,completed,reason:finalReason,exitCode:processReceipt.exitCode});
   if(!completed){failedPhase=phase;throw Error(finalReason||'phase-rejected');}try{assertBinding(plan.binding);}catch(error){failedPhase=phase;throw error;}
  }
 }catch(error){stopReason=['disk-reserve','campaign-deadline','timeout','disk-growth','log-budget','phase-rejected'].includes(error.message)?error.message:'controller-rejected';save(path.join(output,'controller-failure.json'),{failedPhase,reason:stopReason,detail:String(error.message).slice(0,500),qualified:false});}
 let attempt=null;try{attempt=readBoundedJson(path.join(output,'corpus/public-attempt.json'),16*1024**2);}catch{}
 const selection=readBoundedJson(plan.selectionPath,16*1024**2),accounted=attempt||{candidateId:plan.candidateId,status:phases.length?'partial':'blocked',reason:stopReason||'unfinished',assessment:{qualified:false}};
 if(stopReason)accounted.assessment={...accounted.assessment,qualified:false};
 const accounting=publicAttemptSummary(selection,[accounted]);
 const observed=attempt?.assessment||{},pilot=observed.pilot||{},numbers=(object,fields)=>Object.fromEntries(fields.filter(key=>typeof object[key]==='number').map(key=>[key,object[key]]));
 const observations={...numbers(observed,['requestedTrials','completedTrials','uncompletedTrials','independentlyDemonstratedFaultTrials','preservedFaultTrials','fullFallbackTrials','selectiveTrials','controllerElapsedMs']),...numbers(pilot,['missedFailures','nativeMissedFailures','invalidTrials','nativeValidTrials']),timing:numbers(pilot.allTrialTimings||{},['fullMs','testLoreMs','nativeMs','netVsFullMs','netVsNativeMs']),trialSpans:(attempt?.trialSpans||[]).map(trial=>({...numbers(trial,['repetition','fullMs','testLoreMs','nativeMs','planningMs','subsetExecutionMs','selectedFiles','totalFiles','missedFailures','nativeMissedFailures']),valid:trial.valid===true,stable:trial.stable===true,mode:trial.mode==='full'?'full':trial.mode==='selective'?'selective':'unknown'}))};
 const summary={schemaVersion:1,kind:'scoped-original-upstream-campaign',candidateId:plan.candidateId,selectionCommitmentSha256:campaignSelection,sourceRevision:plan.binding.sourceRevision,sourceTreeCleanAtStart:true,sourceRevalidatedThroughFinalPhase:!stopReason,qualified:!stopReason&&accounting.qualified===1,completed:!stopReason,failedPhase,stopReason,phases,accounting,observations,controllerMs:Math.ceil(now()-start),automaticRetries:0,cachePolicy:{jitiFilesystem:false,vitestResults:false,testLoreDiskAnalysis:false},receiptSha256:{initialPlan:executionInputIdentity.sha256,finalPlan:fileIdentity(path.join(output,'plan.json'),16*1024**2).sha256},limitations:['One candidate per invocation; unchanged upstream full manifest/lock installation and independent baseline/fault are prerequisites, not qualification by themselves.','Native caches are disabled equally; OS/package caches remain uncontrolled. No native-default or OS-cold timing claim.','Every failed/unfinished phase and original native receipt is retained; no automatic retry or prior receipt reclassification.','Deadlines and observed descendant termination are best effort, not a security sandbox or containment of arbitrary child processes.','The 30/5 and 100/10 targets are not established by these scoped campaign results.']};
 save(path.join(output,'summary.json'),summary);return summary;
}
export function parseCampaignArguments(args){
 if(![8,9].includes(args.length)||args[0]!=='--selection'||args[2]!=='--profile'||args[4]!=='--directory'||args[6]!=='--output'||(args.length===9&&args[8]!=='--install-and-execute'))throw Error('Use --selection FROZEN --profile REVIEWED_PORTABLE --directory NEW_PRIVATE --output .tddswarm/public-campaigns/ALIAS [--install-and-execute]');
 return {selectionPath:args[1],profilePath:args[3],directory:args[5],relative:args[7],execute:args.length===9};
}
if(process.argv[1]&&path.resolve(process.argv[1])===controller){try{const args=process.argv.slice(2);if(args.length===5&&args[0]==='--worker'&&args[2]==='--input'&&args[4]==='--execute'){await worker(args[1],args[3]);}else{const options=parseCampaignArguments(args),plan=campaignPlan(options);if(options.execute){const summary=await runCampaign(plan);console.log(JSON.stringify(summary,null,2));process.exitCode=summary.qualified?0:1;}else console.log(JSON.stringify({kind:plan.kind,candidateId:plan.candidateId,selectionCommitmentSha256:plan.selectionCommitmentSha256,sourceRevision:plan.binding.sourceRevision,execute:false,limits:campaignLimits,phases:Object.keys(campaignLimits.phases),automaticRetries:0},null,2));}}catch(error){console.error(error.message);process.exitCode=1;}}
