#!/usr/bin/env node
/** Independent fixed-baseline and prior-source executions; never routing qualification. */
import fs from 'node:fs';import path from 'node:path';import {execFileSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
import {discover,execute} from '../src/execution.js';import {linkInstalledDependencies} from '../src/pilot-history.js';import {digest} from '../src/provenance.js';import {readBoundedJson} from './evaluation-commitment.js';import {fileIdentity} from './worker-identity.js';import {validateCandidates,preparePublicCandidate} from './public-corpus.js';import {captureCorpusIdentity} from './regression-corpus.js';
const git=(root,...args)=>execFileSync('git',['-C',root,...args],{encoding:'utf8',timeout:15000,maxBuffer:2*1024*1024});
const save=(file,value)=>fs.writeFileSync(file,JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600});
const signatures=run=>JSON.stringify((run.tests||[]).map(t=>[t.id,t.file,t.name,t.status]).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))));
const complete=run=>run.complete===true&&Array.isArray(run.tests)&&run.tests.length>0&&run.tests.every(t=>['passed','failed','skipped'].includes(t.status)&&t.name!=='<file-load>');
export function preflightPublicCandidate(selection,id,profile,output){
 validateCandidates(selection);const candidate=selection.candidates.find(c=>c.id===id);if(!candidate)throw Error('Candidate absent from frozen selection');
 // Preparation validates exact upstream bytes, clean checkout, config and runtime before any process.
 const probe={...profile,expectedFailureNames:['__preflight_pending__']};delete probe.baselineDeclaredSkips;
 const prepared=preparePublicCandidate(selection,id,probe);fs.mkdirSync(output);save(path.join(output,'input.json'),{selectionCommitmentSha256:selection.commitmentSha256,candidateId:id,profile,preparedHash:digest(prepared)});
 const implementation=captureCorpusIdentity();save(path.join(output,'implementation.json'),implementation.public);const root=path.join(output,'workspace'),bindings=[fileIdentity(fileURLToPath(import.meta.url)),fileIdentity(fileURLToPath(new URL('./public-corpus.js',import.meta.url))),...implementation.bindings,implementation.nodeBinding,...prepared.runtimeFiles,...prepared.dependencyFiles.map(({logicalPath:_,...file})=>file)];let result;
 try{
  git(path.dirname(root),'clone','--local','--no-hardlinks',profile.root,root);git(root,'checkout','--detach',candidate.fixRevision);linkInstalledDependencies(profile.root,root);
  const nativeConfig={...profile.config,runnerTimeoutMs:30000};const discovery=discover(root,nativeConfig);save(path.join(output,'discovery.json'),discovery);if(!discovery.complete||!discovery.files.length)throw Error('Native discovery incomplete or empty');
  const baseline=execute(root,discovery.files,nativeConfig,{capture:true,timeoutMs:30000});save(path.join(output,'baseline.json'),baseline);
  if(!complete(baseline)||baseline.exitCode!==0||!baseline.tests.some(t=>t.status==='passed'))throw Error('Unchanged fixed upstream baseline must pass');
  fs.writeFileSync(path.join(root,candidate.sourcePaths[0]),prepared.corpus.pilot.projects[0].changes[0].after);
  const runs=[];for(let repeat=0;repeat<2;repeat++){const run=execute(root,discovery.files,nativeConfig,{capture:true,timeoutMs:30000});save(path.join(output,'fault-'+repeat+'.json'),run);runs.push(run);}
  const faults=runs[0].tests.filter(t=>t.status==='failed'&&candidate.maintainerOraclePaths.includes(t.file));
  if(runs.some(run=>!complete(run)||run.exitCode===0)||!faults.length||signatures(runs[0])!==signatures(runs[1]))throw Error('Prior source needs stable independently demonstrated unchanged maintainer failures');
  if(faults.some(fault=>!baseline.tests.some(t=>t.id===fault.id&&t.file===fault.file&&t.name===fault.name&&t.status==='passed')))throw Error('Every defect oracle must be runnable and passing in fixed baseline');
  const skips=baseline.tests.filter(t=>t.status==='skipped').map(({id,file,name})=>({id,file,name}));
  if(runs.some(run=>JSON.stringify(run.tests.filter(t=>t.status==='skipped').map(({id,file,name})=>({id,file,name})).sort((a,b)=>a.id.localeCompare(b.id)))!==JSON.stringify([...skips].sort((a,b)=>a.id.localeCompare(b.id)))))throw Error('Skip identities changed under prior source');
  if(prepared.corpus.labels[0].oracleFiles.some(file=>fileIdentity(path.join(root,file.path)).sha256!==file.sha256))throw Error('Upstream oracles changed during independent runs');
  result={candidateId:id,completed:true,qualified:false,selectionCommitmentSha256:selection.commitmentSha256,fixedBaseline:{cases:baseline.tests.length,passed:baseline.tests.filter(t=>t.status==='passed').length,skipped:skips.length,exitCode:0},independentFullFaultRuns:2,stableNamedFailuresPerFaultRun:faults.length,expectedFailureNames:[...new Set(faults.map(t=>t.name))],baselineDeclaredSkips:skips,scope:'Independent native full executions only; no routing, speed, upstream-lock installation or learning qualification'};
 }catch(error){result={candidateId:id,completed:false,qualified:false,selectionCommitmentSha256:selection.commitmentSha256,error:String(error.message).slice(0,500)};}
 try{for(const identity of bindings)if(JSON.stringify(fileIdentity(identity.path,identity.bytes>2*1024*1024?512*1024*1024:2*1024*1024))!==JSON.stringify(identity))throw Error('Controller/input/runtime identity drift');}catch{result={...result,completed:false,error:'Bound preflight identity changed'};}
 result.implementationIdentity=implementation.public;result.receiptSha256=Object.fromEntries(fs.readdirSync(output).filter(name=>name.endsWith('.json')).map(name=>[name,fileIdentity(path.join(output,name),16*1024*1024).sha256]));save(path.join(output,'preflight.json'),result);return result;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){try{const args=process.argv.slice(2);if(args.length!==8||args[0]!=='--selection'||args[2]!=='--candidate'||args[4]!=='--profile'||args[6]!=='--output')throw Error('Use --selection FROZEN --candidate ID --profile REVIEWED --output NEW_PRIVATE_DIRECTORY');const result=preflightPublicCandidate(readBoundedJson(args[1],16*1024*1024),args[3],readBoundedJson(args[5]),path.resolve(args[7]));console.log(JSON.stringify(result,null,2));process.exitCode=result.completed?0:1;}catch(error){console.error(error.message);process.exitCode=1;}}
