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
if (process.argv[2] === '--worker') {
  const [implementation, fixture, method, scenario] = process.argv.slice(3);
  const { plan } = await import(pathToFileURL(path.join(implementation, 'src/selector.js')));
  const { run } = await import(pathToFileURL(path.join(implementation, 'src/runner.js')));
  const { execute, executeNativeRelated } = await import(pathToFileURL(path.join(implementation, 'src/execution.js')));
  const { snapshot, freshness } = await import(pathToFileURL(path.join(implementation,'src/provenance.js')));
  const config = JSON.parse(fs.readFileSync(path.join(fixture,'tddswarm.config.json')));
  const changed = scenario === 'traversal' ? Array.from({length:40},(_,i)=>`src/shared-${i}.js`) : ['src/leaf-0.js'];
  const before = snapshot(fixture,config);
  const started = performance.now();
  const result = method === 'plan' ? plan(fixture,{changed}) : method === 'testlore' ? run(fixture,{capture:true}) : method === 'native' ? executeNativeRelated(fixture,changed,config,{capture:true}) : execute(fixture,Array.from({length:12},(_,i)=>`test/leaf-${i}.test.js`),config,{capture:true});
  const elapsedMs = performance.now()-started;
  const after = snapshot(fixture,config);
  assert.equal(freshness(before,after).fresh,true);
  const normalized = method === 'plan' ? { mode:result.mode,selected:result.selected,reasons:result.reasons,decisionDigest:hash(JSON.stringify({decisions:result.decisions,warnings:result.warnings})),fingerprint:result.fingerprint } : {complete:result.complete,exitCode:result.exitCode,files:result.executedFiles,tests:result.tests};
  console.log(JSON.stringify({method,elapsedMs,config,sourceBefore:before.fingerprint,sourceAfter:after.fingerprint,timings:method==='plan'?result.timings:result.plan?.timings,normalized}));
} else {
  const baseline = path.resolve(process.argv[2] || repository), output = path.resolve(process.argv[3] || 'benchmarks/planning-proof.json');
  const repetitions = Number(process.env.TESTLORE_PLANNING_REPETITIONS || 3);
  assert.ok(Number.isInteger(repetitions) && repetitions>=1 && repetitions<=10);
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(),'testlore-planning-proof-'));
  const frozenImplementation={baseline:implementationHash(baseline),candidate:implementationHash(repository)};
  const trials=[];
  const write=(root,file,value)=>{const target=path.join(root,file);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,typeof value==='string'?value:JSON.stringify(value));};
  function fixture(scenario,label) {
    const root=path.join(temporary,label);fs.mkdirSync(root);
    write(root,'package.json',{type:'module'});write(root,'.gitignore','.tddswarm/\nnode_modules/\n');
    const native=scenario==='native';
    write(root,'tddswarm.config.json',native?{adapter:'vitest',discovery:'native',analysisCache:{enabled:false},runner:[process.execPath,path.join(repository,'node_modules/vitest/vitest.mjs'),'run','--maxWorkers=1','--no-file-parallelism','{files}']}:{analysisCache:{enabled:false}});
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
    for(const scenario of ['traversal','native'])for(let repetition=0;repetition<repetitions;repetition++) {
      const methods=scenario==='traversal'?[['baseline','plan'],['candidate','plan']]:[['baseline','testlore'],['candidate','testlore'],['candidate','native'],['candidate','full']];
      if(repetition%2)methods.reverse();
      for(const [arm,method] of methods) {
        const root=fixture(scenario,`${scenario}-${repetition}-${arm}-${method}`), implementation=arm==='baseline'?baseline:repository;
        const start=performance.now();
        const result=spawnSync(process.execPath,[fileURLToPath(import.meta.url),'--worker',implementation,root,method,scenario],{encoding:'utf8',timeout:30000,maxBuffer:4*1024*1024});
        assert.equal(result.status,0,result.stderr);
        const receipt=JSON.parse(result.stdout);trials.push({scenario,repetition,arm,outerMs:performance.now()-start,...receipt});
        fs.rmSync(root,{recursive:true,force:true});
      }
    }
    const median=values=>[...values].sort((a,b)=>a-b)[Math.floor(values.length/2)];
    const summary=[];
    for(const scenario of ['traversal','native'])for(const arm of ['baseline','candidate'])for(const method of ['plan','testlore','native','full']) {
      const rows=trials.filter(t=>t.scenario===scenario&&t.arm===arm&&t.method===method);if(!rows.length)continue;
      summary.push({scenario,arm,method,trials:rows.length,medianMs:median(rows.map(t=>t.elapsedMs)),minimumMs:Math.min(...rows.map(t=>t.elapsedMs)),maximumMs:Math.max(...rows.map(t=>t.elapsedMs)),medianOuterMs:median(rows.map(t=>t.outerMs))});
    }
    for(let repetition=0;repetition<repetitions;repetition++) {
      const rows=trials.filter(t=>t.repetition===repetition);
      assert.deepEqual(rows.find(t=>t.scenario==='traversal'&&t.arm==='candidate').normalized,rows.find(t=>t.scenario==='traversal'&&t.arm==='baseline').normalized);
      const native=rows.filter(t=>t.scenario==='native'),full=native.find(t=>t.method==='full').normalized;
      assert.equal(full.complete,true);assert.equal(full.exitCode,1);
      for(const row of native.filter(t=>t.method!=='full')) {
        assert.equal(row.normalized.complete,true);assert.equal(row.normalized.exitCode,1);assert.deepEqual(row.normalized.files,['test/leaf-0.test.js']);
        assert.deepEqual(row.normalized.tests.map(t=>[t.id,t.status]),full.tests.filter(t=>t.file==='test/leaf-0.test.js').map(t=>[t.id,t.status]));
      }
    }
    assert.equal(implementationHash(baseline),frozenImplementation.baseline);
    assert.equal(implementationHash(repository),frozenImplementation.candidate);
    const report={schemaVersion:1,kind:'authored-fixtures-only',generatedAt:new Date().toISOString(),runtime:process.version,platform:process.platform,arch:process.arch,baselineImplementation:frozenImplementation.baseline,candidateImplementation:frozenImplementation.candidate,harnessDigest:hash(fs.readFileSync(fileURLToPath(import.meta.url),'utf8')),baselineSourcePreparation:'Instrumented pre-optimization planning commit f37f134f3c98f72948c8c3f9fb665890ce2dd78c; full src snapshot only, dependencies shared, source hashes recorded.',dependencies:{vitest:JSON.parse(fs.readFileSync(path.join(repository,'node_modules/vitest/package.json'),'utf8')).version,packageLock:hash(fs.readFileSync(path.join(repository,'package-lock.json'),'utf8'))},summary,trials,limitations:['Fresh fixture and process for every arm; analysis disk cache disabled and cold history. OS and dependency caches are not flushed.','Traversal fixture deliberately concentrates 40 changes in one shared closure; results do not estimate typical production speedup.','Native fixture has twelve Vitest files with one independently asserted regression. TestLore and native related execute the same one-file case scope; full executes all twelve.','Internal spans exclude module import and fixture setup; outer spans include fresh process/module startup and equal harness source verification but exclude fixture creation.','Local timing, three repetitions and a narrow authored workload cannot establish universal speed advantage. No private repository was executed.']};
    fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({output,summary}));
  } finally {fs.rmSync(temporary,{recursive:true,force:true});}
}
