import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { snapshot, freshness, digest } from './provenance.js';
import { readConfig, safePath } from './files.js';
import { discover, execute } from './execution.js';

const MAX_REPORT = 16 * 1024 * 1024;
function write(root, file, value) { const target=safePath(root,file);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,typeof value==='string'||Buffer.isBuffer(value)?value:JSON.stringify(value,null,2),{mode:0o600}); }
function json(root,file) {const target=safePath(root,file);if(fs.statSync(target).size>MAX_REPORT)throw new Error('Quality report exceeds 16 MB');return JSON.parse(fs.readFileSync(target,'utf8'));}
function copy(root, provenance) {
  const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'testlore-measurement-'));let bytes=0;
  try {for(const file of Object.keys(provenance.files)){const content=fs.readFileSync(safePath(root,file));bytes+=content.length;if(bytes>64*1024*1024)throw new Error('Measurement source scope exceeds 64 MB');write(temporary,file,content);}
    const modules=path.join(root,'node_modules');if(fs.existsSync(modules))fs.symlinkSync(fs.realpathSync(modules),path.join(temporary,'node_modules'),'dir');return temporary;
  }catch(error){fs.rmSync(temporary,{recursive:true,force:true});throw error;}
}
function run(argv,root,timeoutMs,effectiveEnvironment) {
  return new Promise(resolve=>{
    const start=performance.now(),deadline=Date.now()+timeoutMs,env={...effectiveEnvironment};delete env.NODE_TEST_CONTEXT;
    const child=spawn(argv[0],argv.slice(1),{cwd:root,env,shell:false,detached:process.platform!=='win32',stdio:['ignore','pipe','pipe']});let stdout='',stderr='',settled=false;
    const kill=()=>{try{process.platform==='win32'?child.kill('SIGKILL'):process.kill(-child.pid,'SIGKILL');}catch{}};
    const finish=(exitCode,error)=>{if(settled)return;settled=true;clearTimeout(timer);resolve({exitCode,error,durationMs:Math.round(performance.now()-start),stdout,stderr,deadlineMs:timeoutMs});};
    const timer=setTimeout(()=>{kill();finish(null,'measurement-timeout');},timeoutMs);
    child.stdout.on('data',data=>{stdout+=data;if(Buffer.byteLength(stdout)+Buffer.byteLength(stderr)>MAX_REPORT){kill();finish(null,'measurement-output-bound');}});
    child.stderr.on('data',data=>{stderr+=data;if(Buffer.byteLength(stdout)+Buffer.byteLength(stderr)>MAX_REPORT){kill();finish(null,'measurement-output-bound');}});
    child.on('error',error=>{kill();finish(null,error.message);});child.on('close',code=>{kill();Date.now()>=deadline?finish(null,'measurement-late-response'):finish(code,null);});
  });
}
const sealed=value=>({...value,integrity:digest(value)});
function tool(toolsRoot) {const location=path.join(toolsRoot,'node_modules/@stryker-mutator/core'),manifest=JSON.parse(fs.readFileSync(path.join(location,'package.json'),'utf8'));if(!/^10\./.test(manifest.version))throw new Error('Installed Stryker 10 is required');const cli=path.resolve(location,typeof manifest.bin==='string'?manifest.bin:Object.values(manifest.bin)[0]);return{cli,version:manifest.version,identity:digest({manifest,cli:digest(fs.readFileSync(cli)),lock:fs.existsSync(path.join(toolsRoot,'package-lock.json'))?digest(fs.readFileSync(path.join(toolsRoot,'package-lock.json'))):null})};}
const shellQuote=value=>`'${value.replaceAll("'","'\\''")}'`;
function scope(root,files){if(!Array.isArray(files)||!files.length||files.length>100||files.some(file=>typeof file!=='string'||! /\.[cm]?[jt]sx?$/.test(file)))throw new Error('Expected 1–100 explicit mutation source paths');for(const file of files){safePath(root,file);if(!fs.statSync(safePath(root,file)).isFile())throw new Error('Mutation scope requires existing files');}return [...new Set(files)].sort();}

/** Genuine Stryker execution; only identical complete producer baselines may be reused. */
export async function measureMutation(root, options={}) {
  root=path.resolve(root);const started=performance.now(),config=readConfig(root),before=snapshot(root,config),mutate=scope(root,options.mutate),timeoutMs=options.timeoutMs??180000;
  if(!Number.isInteger(timeoutMs)||timeoutMs<100||timeoutMs>600000)throw new Error('Invalid measurement deadline');
  if(process.platform==='win32')throw new Error('Command-runner measurement currently requires a POSIX host');
  const discovery=discover(root,config);if(!discovery.complete||!discovery.files.length)throw new Error('Complete nonempty native discovery required');
  const argv=options.commandRunner??[process.execPath,'--test',...discovery.files];if(!Array.isArray(argv)||!argv.length||argv.length>128||argv.some(arg=>typeof arg!=='string'||arg.includes('\0')||arg.length>4096))throw new Error('commandRunner must be bounded explicit argv');
  if(!options.commandRunner&&config.adapter&&config.adapter!=='node')throw new Error('Non-Node mutation measurement requires explicit commandRunner argv');
  const installed=tool(path.resolve(options.toolsRoot??root));
  const stryker={mutate,testRunner:'command',commandRunner:{command:argv.map(shellQuote).join(' ')},coverageAnalysis:'off',concurrency:1,reporters:['json'],jsonReporter:{fileName:'.tddswarm/mutation/report.json'},tempDirName:'.tddswarm/stryker-tmp',cleanTempDir:'always',symlinkNodeModules:true,timeoutMS:5000,logLevel:'info',fileLogLevel:'off',plugins:[],ignorePatterns:['.tddswarm'],thresholds:{high:100,low:0,break:0},incremental:true,incrementalFile:'.tddswarm/mutation/incremental.json'};
  // Includes every tracked/untracked input, not only mutated source or test files. Environment values are hashed, never persisted.
  const effectiveEnvironment={...process.env,...config.env},implementation=digest(Object.fromEntries(['quality-measurement.js','execution.js','provenance.js','files.js','inputs.js'].map(file=>[file,digest(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)),file)))]))),key=digest({fingerprint:before.fingerprint,stryker,tool:installed.identity,implementation,environment:digest(effectiveEnvironment)}),directory='.tddswarm/measurements/mutation',temporary=copy(root,before);let reused=false,cacheReason='no-complete-baseline';
  try {
    const copiedBefore=snapshot(temporary,config),baseline=collect(temporary,config,Math.min(timeoutMs,120000));if(!passed(baseline))throw new Error('Mutation quality requires complete passing cases; skipped/empty/failing baseline cannot qualify');
    let cached;try{cached=json(root,`${directory}/latest.json`);const{integrity,...payload}=cached;if(integrity!==digest(payload)||cached.key!==key||cached.complete!==true)throw new Error('baseline-inputs-or-integrity-changed');const raw=fs.readFileSync(safePath(root,`${directory}/incremental.json`));if(raw.length>MAX_REPORT||digest(raw)!==cached.incrementalHash)throw new Error('baseline-raw-integrity-changed');write(temporary,stryker.incrementalFile,raw.toString());reused=true;cacheReason='exact-complete-baseline';}catch(error){if(error.code!=='ENOENT')cacheReason=error.message;}
    write(temporary,'.tddswarm/mutation/config.json',stryker);
    const execution=await run([process.execPath,installed.cli,'run','.tddswarm/mutation/config.json'],temporary,Math.max(1,timeoutMs-Math.round(performance.now()-started)),effectiveEnvironment);
    const drift=freshness(before,snapshot(root,config)),copyDrift=freshness(copiedBefore,snapshot(temporary,config));drift.reasons.push(...copyDrift.reasons.map(reason=>'measured-copy:'+reason));drift.fresh&&=copyDrift.fresh;let raw,incremental,metrics=null,error=execution.error;
    try{raw=json(temporary,stryker.jsonReporter.fileName);incremental=fs.readFileSync(safePath(temporary,stryker.incrementalFile));if(incremental.length>MAX_REPORT)throw new Error('Incremental baseline exceeds limit');const mutants=Object.values(raw.files||{}).flatMap(file=>file.mutants||[]),counts={};for(const mutant of mutants)counts[mutant.status]=(counts[mutant.status]||0)+1;const valid=mutants.filter(m=>['Killed','Survived','NoCoverage','Timeout'].includes(m.status)).length;metrics={counts,total:mutants.length,valid,killed:counts.Killed||0,effectiveness:valid?(counts.Killed||0)/valid:null};if(!mutants.length||!valid||mutants.some(m=>!['Killed','Survived','NoCoverage','Timeout','CompileError','RuntimeError','Ignored'].includes(m.status))||counts.RuntimeError)throw new Error('Incomplete mutation statuses');}catch(e){error||=e.message;}
    if(performance.now()-started>=timeoutMs)error||='measurement-total-deadline-exceeded';
    const complete=execution.exitCode===0&&!error&&drift.fresh&&!before.serviceWarnings.length;
    const receipt=sealed({schemaVersion:1,kind:'executed-stryker',complete,measured:complete,key,producer:{tool:'@stryker-mutator/core',version:installed.version,toolIdentity:installed.identity,implementation},provenance:before,scope:mutate,configuration:stryker,reusedBaseline:reused,cacheReason,execution,baseline,metrics,cost:{totalMs:Math.round(performance.now()-started),providerTokens:null,providerDollars:null},reasons:[...(error?[error]:[]),...drift.reasons],incrementalHash:incremental?digest(incremental):null,reportHash:raw?digest(raw):null,limitations:['Command runner has no per-test mutation coverage. Exact complete input baseline reuse only; any input or environment change discards it.','Dependencies are shared read-only by convention; installed package identity and tools lock recorded, not every installed dependency byte.','Timeout is a requested wall-clock deadline; host suspension may delay timers. Late responses are rejected.']});
    const id=randomUUID();write(root,`${directory}/${id}.json`,receipt);if(raw)write(root,`${directory}/${id}.raw.json`,raw);if(complete){write(root,`${directory}/incremental.json`,incremental.toString());write(root,`${directory}/latest.json`,receipt);}return{...receipt,receiptPath:`${directory}/${id}.json`,rawPath:raw?`${directory}/${id}.raw.json`:null};
  }finally{fs.rmSync(temporary,{recursive:true,force:true});}
}

const passed=result=>result.complete&&result.exitCode===0&&result.tests.some(test=>test.status==='passed')&&result.tests.every(test=>test.status==='passed');
const caught=result=>result.complete&&result.exitCode===1&&result.tests.some(test=>test.status==='failed'&&test.name!=='<file-load>');
function collect(root,config,timeoutMs){const start=performance.now(),discovery=discover(root,config);if(!discovery.complete||!discovery.files.length)return{complete:false,exitCode:2,tests:[],discovery,durationMs:Math.round(performance.now()-start)};return{...execute(root,discovery.files,config,{capture:true,timeoutMs}),discovery,totalDurationMs:Math.round(performance.now()-start)};}
/** Independently supplied defects + repeated clean executions, never an invented world score. */
export function measureTestEffectiveness(root,options={}){
  root=path.resolve(root);const config=readConfig(root),before=snapshot(root,config),repetitions=options.repetitions??3,timeoutMs=options.timeoutMs??120000,defects=options.defects;
  if(!Number.isInteger(repetitions)||repetitions<2||repetitions>5||!Number.isInteger(timeoutMs)||timeoutMs<100||timeoutMs>120000||!Array.isArray(defects)||!defects.length||defects.length>20)throw new Error('Bounded independent defects and 2–5 repetitions required');
  const seen=new Set();for(const defect of defects){if(!defect||typeof defect.id!=='string'||!/^[A-Za-z0-9_-]{1,64}$/.test(defect.id)||seen.has(defect.id)||typeof defect.requirement!=='string'||!defect.requirement.trim()||defect.requirement.length>16000||!Array.isArray(defect.files)||!defect.files.length||defect.files.length>16)throw new Error('Each defect requires unique ID, independent requirement and replacement source files');seen.add(defect.id);for(const file of defect.files){safePath(root,file.path);if(!/\.[cm]?[jt]sx?$/.test(file.path)||/(?:test|spec)\.[cm]?[jt]sx?$/.test(file.path))throw new Error('Held-out defects cannot replace tests');if(typeof file.content!=='string'||Buffer.byteLength(file.content)>128*1024||!before.files[file.path])throw new Error('Defects may replace bounded existing source files only');}}
  const original=copy(root,before),candidate=copy(root,before),start=performance.now(),totalDeadlineMs=options.totalDeadlineMs??600000;
  if(!Number.isInteger(totalDeadlineMs)||totalDeadlineMs<100||totalDeadlineMs>600000){fs.rmSync(original,{recursive:true,force:true});fs.rmSync(candidate,{recursive:true,force:true});throw new Error('Invalid total quality deadline');}
  const measuredCollect=(location)=>{const remaining=Math.floor(totalDeadlineMs-(performance.now()-start));if(remaining<=0)return{complete:false,exitCode:2,tests:[],error:'quality-total-deadline-exceeded'};const copyBefore=snapshot(location,config),result=collect(location,config,Math.min(timeoutMs,remaining)),check=freshness(copyBefore,snapshot(location,config));if(!check.fresh)return{...result,complete:false,error:'Measured copy changed during execution',provenanceReasons:check.reasons};return result;};
  try{
    const originals=Array.from({length:repetitions},()=>measuredCollect(original));
    if(options.candidateFiles){if(!Array.isArray(options.candidateFiles)||options.candidateFiles.length>50)throw new Error('Invalid candidate files');for(const file of options.candidateFiles){if(!file||typeof file.path!=='string'||typeof file.content!=='string'||Buffer.byteLength(file.content)>128*1024||!/(?:test|spec)\.[cm]?[jt]sx?$/.test(file.path))throw new Error('Only bounded candidate test files allowed');write(candidate,file.path,file.content);}}
    const candidates=Array.from({length:repetitions},()=>measuredCollect(candidate));const caseCounts=result=>{const counts=new Map();for(const test of result.tests.filter(t=>t.status==='passed')){const id=`${test.file}\0${test.name}`;counts.set(id,(counts.get(id)||0)+1);}return counts;},originalCases=caseCounts(originals[0]),originalPassingCases=[...originalCases.values()].reduce((a,b)=>a+b,0);
    const missing=[...originalCases].flatMap(([id,count])=>Array.from({length:Math.max(0,count-Math.min(...candidates.map(r=>caseCounts(r).get(id)||0)))},()=>id));
    const results=defects.map(defect=>{for(const file of defect.files){write(original,file.path,file.content);write(candidate,file.path,file.content);}const reference=measuredCollect(original),proposed=measuredCollect(candidate);for(const file of defect.files){const source=fs.readFileSync(safePath(root,file.path),'utf8');write(original,file.path,source);write(candidate,file.path,source);}return{id:defect.id,requirement: defect.requirement,demonstrated:caught(reference),caught:caught(proposed),original:reference,candidate:proposed};});
    const drift=freshness(before,snapshot(root,config)),stable=originals.every(passed)&&candidates.every(passed)&&originals.every(r=>digest([...caseCounts(r)])===digest([...originalCases]))&&candidates.every(r=>digest([...caseCounts(r)])===digest([...caseCounts(candidates[0])])),complete=stable&&!missing.length&&drift.fresh&&results.every(r=>r.original.complete&&r.candidate.complete);
    const demonstrated=results.filter(r=>r.demonstrated),incrementalDetected=results.filter(r=>!r.demonstrated&&r.caught);
    const receipt=sealed({schemaVersion:1,kind:'independent-defect-stability',complete,provenance:before,baseline:originals,candidate:candidates,missingOriginalCases:missing,defects:results,dimensions:{preservedPassingCases:originalPassingCases-missing.length,originalPassingCases,stability:{repetitions,passingOriginalRuns:originals.filter(passed).length,passingCandidateRuns:candidates.filter(passed).length},defectDetection:{demonstrated:demonstrated.length,caught:demonstrated.filter(r=>r.caught).length,recall:demonstrated.length?demonstrated.filter(r=>r.caught).length/demonstrated.length:null,additionalCandidateDetections:incrementalDetected.length},cost:{totalMs:Math.round(performance.now()-start),providerTokens:null,providerDollars:null}},reasons:drift.reasons,limitations:['Independent requirement labels are supplied by the operator; TestLore does not certify their independence.','Additional candidate detections are retained separately from defects already demonstrated by original tests.','Repeated clean passes are bounded stability evidence, not a proof of absence of flakiness.']});const file=`.tddswarm/measurements/effectiveness/${randomUUID()}.json`;write(root,file,receipt);return{...receipt,receiptPath:file};
  }finally{fs.rmSync(original,{recursive:true,force:true});fs.rmSync(candidate,{recursive:true,force:true});}
}
