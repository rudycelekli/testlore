import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {sharedVitestCommand,nativeEnvironment,normalizeUnifiedExecution} from './execution.js';
import {safePath,listFiles,SOURCE,git,gitBaseline,gitSources} from './files.js';
import {analyze,nativePlanningRoots} from './graph.js';
import {encodeNativeFrame,nativeFrameReader} from './native-protocol.js';
import {digest} from './provenance.js';
import {prepareNativeSourceSummaries} from './native-source-summaries.js';
import {normalizeNativeProjects} from './native-project-contracts.js';
import {captureConfigurationInputs,assertConfigurationInputFreshness} from './configuration-inputs.js';

// Authority is minted only from a live, canonical worker, never public options.
const sessions=new WeakMap();
export function sessionPlanning(token,root) {
 const record=sessions.get(token);
 if(!record||record.root!==fs.realpathSync(root)||record.closed)throw new Error('Unbound unified native session');
 return record.batch;
}
function local(root,file){const result=path.relative(root,path.resolve(root,file)).split(path.sep).join('/');safePath(root,result);return result;}
function normalize(root,value){
 if(value?.complete!==true||value.discovery?.complete!==true||!Array.isArray(value.discovery.files)||!Array.isArray(value.additionalResolutions)||!Array.isArray(value.configFiles)||!Array.isArray(value.projectContracts))throw new Error(value?.error||'Incomplete unified planning');
 if(value.additionalResolutions.length>50000||value.discovery.files.length>10000)throw new Error('Unbounded unified planning');
 const files=[...new Set(value.discovery.files.map(file=>local(root,file)))].sort();
 return {...value,projectContracts:normalizeNativeProjects(root,value.projectContracts,files,local),discovery:{files,complete:true,adapter:'vitest',method:'fresh-unified-native-context',warnings:[]},
 configFiles:value.configFiles.filter(file=>!file.split(path.sep).includes('node_modules')).map(file=>local(root,file)),
 additionalResolutions:value.additionalResolutions.map(item=>{if(typeof item.specifier!=='string'||!Array.isArray(item.resolution?.paths))throw new Error('Invalid unified resolution');return {...item,file:local(root,item.file),resolution:{...item.resolution,paths:item.resolution.paths.map(file=>local(root,file))}};})};
}
export function unifiedNativeEligibility(root,config) {
 if(process.platform==='win32')return 'Unified process-group cleanup requires a POSIX host';
 if(config.integration||!sharedVitestCommand(root,config)||config.discovery!=='native')return 'Canonical Vitest 4.1/5 command required';
 if((config.env?.NODE_OPTIONS??process.env.NODE_OPTIONS??'').trim())return 'NODE_OPTIONS cannot be bound by the unified prototype';
 return null;
}
export async function openNativeSession(root,config,options={},startupInventory) {
 const opened=performance.now();
 const requestedRoot=path.resolve(root);
 if(startupInventory && (startupInventory.root!==requestedRoot || startupInventory.configurationDigest!==digest(config) || !Array.isArray(startupInventory.files)))throw new Error('Unbound startup analysis inventory');
 root=fs.realpathSync(root);
 if(options.signal?.aborted)throw new Error('Unified execution cancelled');
 const unsupported=unifiedNativeEligibility(root,config);if(unsupported)return {unsupported};
 const command=sharedVitestCommand(root,config);
 const timeout=options.timeoutMs??config.runnerTimeoutMs??120000;
 if(!Number.isInteger(timeout)||timeout<1||timeout>600000)throw new Error('Unified deadline must be 1–600000 milliseconds');
 if(options.signal?.aborted)throw new Error('Unified execution cancelled');
 const deadline=Date.now()+timeout,temporary=fs.mkdtempSync(path.join(os.tmpdir(),'testlore-unified-'));
 let child,closed=false,timer,stdout='',stderr='',outputBytes=0,failure,stage='planned',workerSpawned,plannedReceived;const pending=new Map(),workerTimings={};
 const terminate=()=>{if(child?.pid){try{if(process.platform==='win32')child.kill('SIGKILL');else process.kill(-child.pid,'SIGKILL');}catch{}}};
 const rejectAll=error=>{if(failure)return;failure=error;for(const waiter of pending.values())waiter.reject(error);pending.clear();terminate();};
 const cancel=()=>rejectAll(new Error('Unified execution cancelled'));
 const close=async()=>{if(closed)return;closed=true;clearTimeout(timer);options.signal?.removeEventListener('abort',cancel);terminate();if(child&&child.exitCode===null&&child.signalCode===null)await new Promise(resolve=>{child.once('close',resolve);setTimeout(resolve,1000);});sessions.delete(token);fs.rmSync(temporary,{recursive:true,force:true});};
 const token=Object.freeze({});
 try{
  const imports=[];
  // Preserve deleted/import-removed baseline edges in the SAME resolver context.
  if(!options.changed){try{const {baseSha:base,prefix}=gitBaseline(root,options.base||'HEAD');
   const changed=git(root,['diff','--name-only','--no-renames','-z',base,'--','.']).split('\0').filter(Boolean);
   const sources=changed.map(entry=>prefix&&entry.startsWith(prefix)?entry.slice(prefix.length):entry).filter(file=>SOURCE.test(file));
   for(const [file,text] of gitSources(root,base,prefix,sources))for(const specifier of analyze(file,text).imports)imports.push({file,specifier});
  }catch{}}
  const reportFile=path.join(temporary,'results.json'),requestFile=path.join(temporary,'request.json');
  const invocation=[...command,'run','--reporter=json',`--outputFile=${reportFile}`];
  const files=startupInventory?startupInventory.files:listFiles(root);
  const sourceSummaries=prepareNativeSourceSummaries(root,files);
  const configurationInputObservations=captureConfigurationInputs(root,config);
  // The fresh worker expands native-discovered tests, project setup and config
  // transitively. Unreachable repository files still receive parent syntax and
  // uncertainty analysis, but do not require every project's native resolver.
  fs.writeFileSync(requestFile,JSON.stringify({root,adapter:'vitest',command,imports,invocation,discover:true,transitive:true,roots:[...nativePlanningRoots(root,config,files)],sourceSummaries,configurationInputs:config.configurationInputs,configurationInputObservations,unified:true,reportFile}));
  workerSpawned=performance.now();
  child=spawn(process.execPath,[fileURLToPath(new URL('./reporters/resolve.js',import.meta.url)),requestFile],{cwd:root,env:nativeEnvironment(config),detached:process.platform!=='win32',stdio:['ignore','pipe','pipe','pipe','pipe']});
  const wait=phase=>new Promise((resolve,reject)=>{if(failure)return reject(failure);pending.set(phase,{resolve,reject});});
  const planning=wait('planned');
  for(const [stream,name] of [[child.stdout,'stdout'],[child.stderr,'stderr']])stream.on('data',bytes=>{if(failure)return;const text=bytes.toString(),length=Buffer.byteLength(text);if(outputBytes+length>4*1024*1024)return rejectAll(new Error('Unified native output exceeded 4 MiB'));outputBytes+=length;if(name==='stdout')stdout+=text;else stderr+=text;});
  const frames=nativeFrameReader({onError:rejectAll,onFrame:message=>{
   if(message?.phase==='failed')return rejectAll(new Error(`Unified native session failed: ${String(message.error).slice(0,500)}`));
   if(message?.phase!==stage||!pending.has(stage))return rejectAll(new Error('Unexpected unified native protocol event'));
   const timings=message.timings;
   // Passive diagnostics cannot mint execution or dependency authority.
   if(timings && Number.isFinite(timings.totalMs) && timings.totalMs>=0 && timings.totalMs<=600000 && timings.phases && typeof timings.phases==='object' && Object.keys(timings.phases).length<=20 && Object.entries(timings.phases).every(([key,value])=>/^[A-Za-z]+$/.test(key)&&Number.isFinite(value)&&value>=0&&value<=600000))workerTimings[stage]=timings;
   const waiter=pending.get(stage);pending.delete(stage);stage=stage==='planned'?'executed':'closed';waiter.resolve(message.value);
  }});
  child.stdio[4].on('data',chunk=>frames.push(chunk));child.stdio[4].once('end',()=>frames.end());child.stdio[4].once('error',rejectAll);child.stdio[3].once('error',rejectAll);
  child.once('error',rejectAll);child.once('exit',(code,signal)=>{if(stage!=='closed'&&!closed)rejectAll(new Error(`Unified native session exited before completion (${code??signal})`));});
  timer=setTimeout(()=>rejectAll(new Error('Unified native deadline exceeded')),Math.max(1,deadline-Date.now()));options.signal?.addEventListener('abort',cancel,{once:true});
  const planned=await planning;plannedReceived=performance.now();if(Date.now()>=deadline)throw new Error('Unified native-session deadline exceeded');
  const batch=normalize(root,planned);
  assertConfigurationInputFreshness(configurationInputObservations,batch.configurationInputs);
  assertConfigurationInputFreshness(configurationInputObservations,captureConfigurationInputs(root,config));
  // Initial baseline imports precede additional traversal records.
  if(!Array.isArray(batch.resolutions)||batch.resolutions.length!==imports.length)throw new Error('Invalid unified baseline resolution count');
  batch.additionalResolutions.push(...imports.map((item,i)=>({...item,resolution:{...batch.resolutions[i],paths:batch.resolutions[i].paths.map(file=>local(root,file))}})));
  const freeze=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};
  sessions.set(token,{root,batch:freeze(batch),closed:false});
  return {token,close,failureEvidence:()=>({stdout,stderr}),remaining:()=>deadline-Date.now(),execute:async files=>{
   if(failure)throw failure;if(Date.now()>=deadline)throw new Error('Unified native deadline exceeded');if(options.signal?.aborted)throw new Error('Unified execution cancelled');
   assertConfigurationInputFreshness(configurationInputObservations,captureConfigurationInputs(root,config));
   files=[...new Set(files)].sort();files.forEach(file=>safePath(root,file));
   const started=performance.now(),execution=wait('executed');child.stdio[3].end(encodeNativeFrame({phase:'execute',files}));
   const value=await execution,executedReceived=performance.now();
   assertConfigurationInputFreshness(configurationInputObservations,value.configurationInputs,{allowCanonicalTmpdir:true});
   assertConfigurationInputFreshness(configurationInputObservations,captureConfigurationInputs(root,config));if(Date.now()>=deadline)throw new Error('Unified native-session deadline exceeded');
   if(child.exitCode===null&&child.signalCode===null)await new Promise(resolve=>child.once('close',resolve));
   if(failure)throw failure;if(Date.now()>=deadline)throw new Error('Unified native-session deadline exceeded');terminate();
   return normalizeUnifiedExecution(root,files,value,{durationMs:Math.round(performance.now()-started),command:[],nativeInvocation:invocation,nativeExitCode:child.exitCode,signal:child.signalCode,stdout,stderr,unifiedNative:{prototype:true,used:true,programmatic:true,contexts:1,fresh:true,scope:'fresh CLI-selected projects; file memberships are disjoint',projects:batch.projectContracts,sourceSummaryReuse:batch.sourceSummaryReuse,deadlineScope:'native-session; synchronous parent work is not preemptible',timings:{requestPreparationMs:workerSpawned-opened,workerStartupAndPlanningMs:plannedReceived-workerSpawned,executionRequestAndResultMs:executedReceived-started,resultToChildExitMs:performance.now()-executedReceived,worker:workerTimings,scope:'Diagnostic spans; worker starts after static module imports, parent startup includes imports and native planning. Spans overlap and never confer authority.'}}});
  }};
 }catch(error){error.nativeFailureEvidence={stdout,stderr};await close();throw error;}
}
