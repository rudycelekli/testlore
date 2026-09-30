import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { plan } from '../src/index.js';
const count = Number(process.env.TDDSWARM_BENCH_TESTS || 1000);
if (!Number.isInteger(count) || count < 1 || count > 10000) throw new Error('TDDSWARM_BENCH_TESTS must be 1–10000');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tddswarm-benchmark-'));
const write = (file, text) => { const p = path.join(root,file); fs.mkdirSync(path.dirname(p),{recursive:true}); fs.writeFileSync(p,text); };
const git = (...args) => execFileSync('git',['-C',root,...args],{stdio:'pipe',encoding:'utf8'});
try {
  write('package.json','{"type":"module"}');
  for (let i=0;i<count;i++) {
    write(`src/m${i}.js`, `export const value=${i};`);
    write(`test/m${i}.test.js`, `import {value} from '../src/m${i}.js';import test from 'node:test';import assert from 'node:assert/strict';test('contract',()=>assert.equal(value,${i}));`);
  }
  const start=performance.now();
  const selection=plan(root,{changed:['src/m0.js']});
  const synthetic={testFiles:count,selectedFiles:selection.selected.length,selectionReduction:selection.selectionReduction,planningMs:Math.round(performance.now()-start),executed:false};
  fs.rmSync(path.join(root,'test'),{recursive:true}); fs.rmSync(path.join(root,'src'),{recursive:true});
  const baseline={
    'src/a.js':'export const a=1;', 'src/b.js':'export const b=2;',
    'test/a.test.js':"import {a} from '../src/a.js';import test from 'node:test';import assert from 'node:assert/strict';test('a contract',()=>assert.equal(a,1));",
    'test/b.test.js':"import {b} from '../src/b.js';import test from 'node:test';import assert from 'node:assert/strict';test('b contract',()=>assert.equal(b,2));"
  };
  Object.entries(baseline).forEach(([p,c])=>write(p,c));
  git('init','-b','main'); git('config','user.name','TDDSwarm Benchmark'); git('config','user.email','benchmark@example.invalid');git('add','.');git('commit','-m','known contracts');
  const baselineSha=git('rev-parse','HEAD').trim();
  const mutations=[
    ['wrong-a',()=>write('src/a.js','export const a=9;')],
    ['wrong-b',()=>write('src/b.js','export const b=9;')],
    ['deleted-a',()=>fs.unlinkSync(path.join(root,'src/a.js'))],
    ['unknown-import',()=>write('src/a.js',"import './missing.js';export const a=1;")],
    ['runtime-import',()=>write('src/a.js',"const f='./missing.js';await import(f);export const a=1;")],
    ['clean-comment',()=>write('src/a.js','export const a=1; // harmless comment')]
  ];
  const outcomes=[];
  for(const [name,mutate] of mutations) {
    Object.entries(baseline).forEach(([p,c])=>write(p,c));mutate();
    const p=plan(root);
    const execute=files=>{const begin=performance.now();const r=spawnSync('node',['--test',...files.map(f=>'./'+f)],{cwd:root,encoding:'utf8'});return {exitCode:r.status??1,durationMs:Math.round(performance.now()-begin),stdout:r.stdout,stderr:r.stderr};};
    outcomes.push({name,mode:p.mode,selected:p.selected,total:p.total,full:execute(['test/a.test.js','test/b.test.js']),subset:p.selected.length?execute(p.selected):{exitCode:0,durationMs:0,stdout:'',stderr:''}});
  }
  const faulty=outcomes.filter(o=>o.full.exitCode!==0);
  const srcRoot=new URL('../src/',import.meta.url);
  const fingerprint=createHash('sha256');
  for(const file of ['files.js','graph.js','selector.js','runner.js'])fingerprint.update(fs.readFileSync(new URL(file,srcRoot)));
  const report={schemaVersion:1,kind:'synthetic-fixtures-only',runtime:process.version,platform:`${os.platform()} ${os.arch()}`,cpu:os.cpus()[0]?.model,selectorSourceHash:fingerprint.digest('hex'),baselineSha,synthetic,faultyChanges:faulty.length,detectedFaultyChanges:faulty.filter(o=>o.subset.exitCode!==0).length,fixtureFaultyChangeRecall:faulty.length?faulty.filter(o=>o.subset.exitCode!==0).length/faulty.length:null,outcomes,limitations:['Synthetic independence is deliberately easy.','No production repository comparison or wall-clock savings claim.','Full suite detection supplies fixture ground truth; untested faults remain possible.']};
  const output=process.argv[2];if(output){fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');}
  console.log(JSON.stringify({...report,outcomes:outcomes.map(({full,subset,...o})=>({...o,fullExit:full.exitCode,subsetExit:subset.exitCode}))},null,2));
  if(report.detectedFaultyChanges!==report.faultyChanges)process.exitCode=1;
} finally {fs.rmSync(root,{recursive:true,force:true});}
