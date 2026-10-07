import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repository = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const hash = text => createHash('sha256').update(typeof text==='string'?text:JSON.stringify(text)).digest('hex');
const implementationHash = root => hash(fs.readdirSync(path.join(root,'src'),{recursive:true,withFileTypes:true}).filter(entry=>entry.isFile()).map(entry=>path.join(entry.parentPath,entry.name)).sort().map(file=>[path.relative(root,file),fs.readFileSync(file,'utf8')]));
async function worker() {
  const [implementation, fixture, method, scenario, cacheState='disabled'] = process.argv.slice(3);
  const { plan } = await import(pathToFileURL(path.join(implementation, 'src/selector.js')));
  const { run } = await import(pathToFileURL(path.join(implementation, 'src/runner.js')));
  const { execute, executeNativeRelated } = await import(pathToFileURL(path.join(implementation, 'src/execution.js')));
  const { snapshot, freshness } = await import(pathToFileURL(path.join(implementation,'src/provenance.js')));
  const config = JSON.parse(fs.readFileSync(path.join(fixture,'tddswarm.config.json')));
  const changed = scenario === 'traversal' ? Array.from({length:40},(_,i)=>`src/shared-${i}.js`) : ['src/leaf-0.js'];
  const before = snapshot(fixture,config);
  const started = performance.now();
  const result = method === 'plan' ? plan(fixture,{changed}) : method === 'testlore' ? run(fixture,{capture:true,selective:true}) : method === 'native' ? executeNativeRelated(fixture,changed,config,{capture:true}) : execute(fixture,Array.from({length:12},(_,i)=>`test/leaf-${i}.test.js`),config,{capture:true});
  const elapsedMs = performance.now()-started;
  const after = snapshot(fixture,config);
  assert.equal(freshness(before,after).fresh,true);
  const normalized = method === 'plan' ? { mode:result.mode,selected:result.selected,reasons:result.reasons,decisionDigest:hash(JSON.stringify({decisions:result.decisions,warnings:result.warnings})),fingerprint:result.fingerprint } : {complete:result.complete,exitCode:result.exitCode,files:result.executedFiles,tests:result.tests};
  console.log(JSON.stringify({method,cacheState,elapsedMs,config,sourceBefore:before.fingerprint,sourceAfter:after.fingerprint,analysisCache:method==='plan'?result.analysisCache:result.plan?.analysisCache,timings:method==='plan'?result.timings:result.plan?.timings,normalized}));
}

export function reserveReceipt(output) {
  fs.mkdirSync(path.dirname(output),{recursive:true});
  // wx also rejects directories and dangling symlinks, before fixture creation.
  const fd=fs.openSync(output,'wx');
  fs.writeSync(fd,JSON.stringify({schemaVersion:1,complete:false,trials:[]}));
  return fd;
}

/** Preserve the reserved receipt and journal if a disk write cannot seal it. */
export function sealReceipt(output, reserved, report, {write=fs.writeSync}={}) {
  const partial=output+'.partial',fd=fs.openSync(partial,'wx',0o600);
  try {
    const bytes=Buffer.from(JSON.stringify(report,null,2)+'\n');
    for(let offset=0;offset<bytes.length;) {
      const count=write(fd,bytes,offset,bytes.length-offset,null);
      if(!Number.isInteger(count)||count<=0)throw new Error('Receipt writer made no progress');
      offset+=count;
    }
    fs.fsyncSync(fd);
    const original=fs.fstatSync(reserved),current=fs.statSync(output);
    if(original.dev!==current.dev||original.ino!==current.ino)throw new Error('Reserved receipt was replaced during qualification');
    fs.renameSync(partial,output);
  } finally {fs.closeSync(fd);}
}

export function validateNativeFull(full) {
  assert.equal(full.complete,true);assert.equal(full.exitCode,1);
  const expected=Array.from({length:12},(_,i)=>[`test/leaf-${i}.test.js`,`leaf ${i}`,i===0?'failed':'passed']);
  assert.deepEqual([...full.files].sort(),expected.map(t=>t[0]).sort());
  assert.equal(full.tests.length,12);
  assert.equal(new Set(full.tests.map(t=>t.id)).size,12);
  assert.deepEqual(full.tests.map(t=>[t.file,t.name,t.status]).sort((a,b)=>a[0].localeCompare(b[0])),expected.sort((a,b)=>a[0].localeCompare(b[0])));
}

function summarize(trials) {
  const median=values=>[...values].sort((a,b)=>a-b)[Math.floor(values.length/2)];
  const summary=[];
  for(const cacheState of [...new Set(trials.map(t=>t.cacheState||'disabled'))])for(const scenario of ['traversal','native'])for(const arm of ['baseline','candidate'])for(const method of ['plan','testlore','native','full']) {
    const attempts=trials.filter(t=>(t.cacheState||'disabled')===cacheState&&t.scenario===scenario&&t.arm===arm&&t.method===method);
    const rows=attempts.filter(t=>t.workerComplete===true&&Number.isFinite(t.elapsedMs));
    if(!attempts.length)continue;
    summary.push({cacheState,scenario,arm,method,attempts:attempts.length,completedWorkers:rows.length,...(rows.length?{medianMs:median(rows.map(t=>t.elapsedMs)),minimumMs:Math.min(...rows.map(t=>t.elapsedMs)),maximumMs:Math.max(...rows.map(t=>t.elapsedMs)),medianOuterMs:median(rows.map(t=>t.outerMs)),medianWarmupMs:median(rows.map(t=>t.warmupMs||0))}:{})});
  }
  return summary;
}

export function runPlanningProof({baseline,output,repetitions=3,cacheStates=['disabled'],baselineDescription,spawnWorker=spawnSync}) {
  baseline=path.resolve(baseline);output=path.resolve(output);
  assert.ok(Number.isInteger(repetitions)&&repetitions>=1&&repetitions<=10);
  assert.ok(Array.isArray(cacheStates)&&cacheStates.length&&new Set(cacheStates).size===cacheStates.length&&cacheStates.every(state=>['disabled','cold','warm'].includes(state)));
  const fd=reserveReceipt(output);
  let journal;
  let temporary;
  const trials=[];
  const report={schemaVersion:1,kind:'authored-fixtures-only',complete:false,generatedAt:new Date().toISOString(),runtime:process.version,platform:process.platform,arch:process.arch,harnessDigest:hash(fs.readFileSync(fileURLToPath(import.meta.url),'utf8')),baselineSourcePreparation:'Instrumented pre-optimization planning commit f37f134f3c98f72948c8c3f9fb665890ce2dd78c; full src snapshot only, dependencies shared, source hashes recorded.',summary:[],trials,limitations:['Fresh fixture and process for every arm; analysis disk cache disabled and cold history. OS and dependency caches are not flushed.','Traversal fixture deliberately concentrates 40 changes in one shared closure; results do not estimate typical production speedup.','Native fixture has twelve Vitest files with one independently asserted regression. TestLore and native related execute the same one-file case scope; full executes all twelve.','Internal spans exclude module import and fixture setup; outer spans include fresh process/module startup and equal harness source verification but exclude fixture creation.','Local timing, three repetitions and a narrow authored workload cannot establish universal speed advantage. No private repository was executed.','Dependencies are shared and identified by lockfile/version; installed dependency bytes and Node executable bytes are not frozen.']};
  if(baselineDescription)report.baselineSourcePreparation=baselineDescription;
  report.cacheStates=cacheStates;
  if(cacheStates.some(state=>state!=='disabled'))report.limitations[0]='Fresh fixture and measured process for every arm; disabled and cold caches start empty. Warm TestLore spans follow one explicit separate-process planning warmup, whose time and status are recorded separately and excluded from measured spans. Only pure source summaries persist; native comparison does not use that cache. OS and dependency caches are not flushed.';
  const write=(root,file,value)=>{const target=path.join(root,file);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,typeof value==='string'?value:JSON.stringify(value));};
  function fixture(scenario,label,cacheState) {
    const root=path.join(temporary,label);fs.mkdirSync(root);
    write(root,'package.json',{type:'module'});write(root,'.gitignore','.tddswarm/\nnode_modules/\n');
    const native=scenario==='native';
    write(root,'tddswarm.config.json',native?{adapter:'vitest',discovery:'native',analysisCache:{enabled:cacheState!=='disabled'},runner:[process.execPath,path.join(repository,'node_modules/vitest/vitest.mjs'),'run','--maxWorkers=1','--no-file-parallelism','{files}']}:{analysisCache:{enabled:cacheState!=='disabled'}});
    const count=native?12:120;
    if(!native)for(let i=0;i<100;i++)write(root,`src/shared-${i}.js`,i<99?`export {value} from './shared-${i+1}.js';`:'export const value=1;');
    for(let i=0;i<count;i++) {
      write(root,`src/leaf-${i}.js`,native?`export const value=${i};`:`export {value} from './shared-0.js';`);
      write(root,`test/leaf-${i}.test.js`,native?`import {test,expect} from 'vitest';import {value} from '../src/leaf-${i}.js';test('leaf ${i}',async()=>{await new Promise(r=>setTimeout(r,6));expect(value).toBe(${i});});`:`import {value} from '../src/leaf-${i}.js';import test from 'node:test';test('leaf ${i}',()=>{});`);
    }
    if(native)fs.symlinkSync(path.join(repository,'node_modules'),path.join(root,'node_modules'));
    const git=(...args)=>execFileSync('git',['-C',root,...args],{stdio:'pipe'});
    git('init','-b','main');git('config','user.name','TestLore Planning Proof');git('config','user.email','proof@example.invalid');git('add','.');git('commit','-m','authored baseline');
    if(native)write(root,'src/leaf-0.js','export const value=99;');
    return root;
  }
  try {
    journal=fs.openSync(output+'.attempts.jsonl','wx',0o600);
    const append=value=>{fs.writeSync(journal,JSON.stringify(value)+'\n');fs.fsyncSync(journal);};
    temporary=fs.mkdtempSync(path.join(os.tmpdir(),'testlore-planning-proof-'));
    report.baselineImplementation=implementationHash(baseline);
    report.candidateImplementation=implementationHash(repository);
    report.dependencies={vitest:JSON.parse(fs.readFileSync(path.join(repository,'node_modules/vitest/package.json'),'utf8')).version,packageLock:hash(fs.readFileSync(path.join(repository,'package-lock.json'),'utf8'))};
    append({event:'qualification-started',baselineImplementation:report.baselineImplementation,candidateImplementation:report.candidateImplementation,harnessDigest:report.harnessDigest,runtime:report.runtime,dependencies:report.dependencies,cacheStates});
    for(const cacheState of cacheStates)for(const scenario of ['traversal','native'])for(let repetition=0;repetition<repetitions;repetition++) {
      const methods=scenario==='traversal'?[['baseline','plan'],['candidate','plan']]:[['baseline','testlore'],['candidate','testlore'],['candidate','native'],['candidate','full']];
      if(repetition%2)methods.reverse();
      for(const [arm,method] of methods) {
        const attempt={cacheState,scenario,repetition,arm,method,workerComplete:false};
        trials.push(attempt); // Retain even fixture/worker/JSON/assertion failure.
        append({event:'attempt-started',attempt});
        const root=fixture(scenario,`${cacheState}-${scenario}-${repetition}-${arm}-${method}`,cacheState),implementation=arm==='baseline'?baseline:repository;
        if(cacheState==='warm'&&['plan','testlore'].includes(method)) {
          const primingStart=performance.now();
          const priming=spawnWorker(process.execPath,[fileURLToPath(import.meta.url),'--worker',implementation,root,'plan',scenario,'cold'],{encoding:'utf8',timeout:30000,maxBuffer:4*1024*1024});
          attempt.warmupMs=performance.now()-primingStart;
          attempt.warmup={status:priming.status,signal:priming.signal||null,error:priming.error?.message};
          if(priming.status!==0||priming.error||priming.signal) {
            attempt.warmup.stdout=String(priming.stdout||'').slice(0,16384);attempt.warmup.stderr=String(priming.stderr||'').slice(0,16384);
            attempt.warmup.outputTruncated=String(priming.stdout||'').length>16384||String(priming.stderr||'').length>16384;
            throw new Error(`Warmup worker failed for ${scenario}/${arm}/${method}`);
          }
          const warmReceipt=JSON.parse(priming.stdout);
          if(warmReceipt.sourceBefore!==warmReceipt.sourceAfter)throw new Error('Warmup provenance drift');
          attempt.warmup.sourceFingerprint=warmReceipt.sourceAfter;
          append({event:'warmup-completed',attempt});
        }
        const start=performance.now();
        const result=spawnWorker(process.execPath,[fileURLToPath(import.meta.url),'--worker',implementation,root,method,scenario,cacheState],{encoding:'utf8',timeout:30000,maxBuffer:4*1024*1024});
        attempt.outerMs=performance.now()-start;
        attempt.worker={status:result.status,signal:result.signal||null,error:result.error?.message};
        if(result.status!==0||result.error||result.signal) {
          attempt.worker.stdout=String(result.stdout||'').slice(0,16384);
          attempt.worker.stderr=String(result.stderr||'').slice(0,16384);
          attempt.worker.outputTruncated=String(result.stdout||'').length>16384||String(result.stderr||'').length>16384;
          throw new Error(`Worker failed for ${scenario}/${arm}/${method}: ${result.error?.message||result.signal||result.status}`);
        }
        let receipt;
        try {receipt=JSON.parse(result.stdout);}catch(error) {
          attempt.worker.stdout=String(result.stdout||'').slice(0,16384);
          throw new Error(`Invalid worker receipt for ${scenario}/${arm}/${method}: ${error.message}`);
        }
        Object.assign(attempt,receipt,{workerComplete:true});
        attempt.nativeCaseCount=scenario==='native'?receipt.normalized?.tests?.length:undefined;
        append({event:'worker-completed',attempt});
        fs.rmSync(root,{recursive:true,force:true});
      }
    }
    for(const cacheState of cacheStates)for(let repetition=0;repetition<repetitions;repetition++) {
      const rows=trials.filter(t=>t.cacheState===cacheState&&t.repetition===repetition);
      assert.deepEqual(rows.find(t=>t.scenario==='traversal'&&t.arm==='candidate').normalized,rows.find(t=>t.scenario==='traversal'&&t.arm==='baseline').normalized);
      const native=rows.filter(t=>t.scenario==='native'),full=native.find(t=>t.method==='full').normalized;
      validateNativeFull(full);
      for(const row of native.filter(t=>t.method!=='full')) {
        assert.equal(row.normalized.complete,true);assert.equal(row.normalized.exitCode,1);assert.deepEqual(row.normalized.files,['test/leaf-0.test.js']);
        assert.equal(row.nativeCaseCount,1);
        assert.deepEqual(row.normalized.tests.map(t=>[t.file,t.name,t.status]),[['test/leaf-0.test.js','leaf 0','failed']]);
        assert.deepEqual(row.normalized.tests.map(t=>[t.id,t.status]),full.tests.filter(t=>t.file==='test/leaf-0.test.js').map(t=>[t.id,t.status]));
      }
    }
    assert.equal(implementationHash(baseline),report.baselineImplementation);
    assert.equal(implementationHash(repository),report.candidateImplementation);
    report.complete=true;
    append({event:'qualification-validated',complete:true,attempts:trials.length});
  } catch(error) {
    report.failure={message:error.message};
    if(journal!==undefined)try{fs.writeSync(journal,JSON.stringify({event:'qualification-failed',failure:report.failure,attempt:trials.at(-1)})+'\n');fs.fsyncSync(journal);}catch{}
  } finally {
    report.summary=summarize(trials);
    report.nativeCaseObservations=trials.reduce((n,t)=>n+(t.nativeCaseCount||0),0);
    try {
      sealReceipt(output,fd,report);
    } finally {
      fs.closeSync(fd);
      if(journal!==undefined)fs.closeSync(journal);
      if(temporary)fs.rmSync(temporary,{recursive:true,force:true});
    }
  }
  return report;
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  if(process.argv[2]==='--worker')await worker();
  else {
    const output=path.resolve(process.argv[3]||'.tddswarm/planning-reproduction.json');
    const report=runPlanningProof({baseline:process.argv[2]||repository,output,repetitions:Number(process.env.TESTLORE_PLANNING_REPETITIONS||3)});
    console.log(JSON.stringify({output,complete:report.complete,summary:report.summary,failure:report.failure}));
    if(!report.complete)process.exitCode=1;
  }
}
