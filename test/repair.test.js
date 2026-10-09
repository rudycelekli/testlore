import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {repair,repairFullSuite} from '../src/repair.js';
import {fixture,commit,git,twoModules,write} from './helpers.js';
const requirements='Module a must export the integer 1. Module b must continue exporting 2. Preserve all public behavior and unchanged tests.';
const review={accepted:true,findings:[],oracle:{independent:true,basis:[requirements]}};
function project(t,files={}){const root=fixture(t,{...twoModules,'src/a.js':'export const a=9;','tddswarm.requirements.md':requirements,...files});commit(root);return root;}
function cleanup(t,root,result){if(!result.worktreeRoot)return;t.after(()=>{try{git(root,'worktree','remove','--force',result.worktreeRoot);}catch{};try{git(root,'branch','-D',result.branch);}catch{};fs.rmSync(result.worktreeRoot,{force:true,recursive:true});});}
const patch=content=>({files:[{path:'src/a.js',content}],review});
test('full native discovery and execution share one phase timeout rather than separate allowances',t=>{
 const root=fixture(t,{
  'package.json':{type:'module'},
  'test/slow.test.js':"import test from 'node:test';test('slow independent case',async()=>{await new Promise(resolve=>setTimeout(resolve,1800));});",
  'tddswarm.config.json':{adapter:'node',discovery:[process.execPath,'-e',"setTimeout(()=>console.log(JSON.stringify({complete:true,files:['test/slow.test.js']})),1800)"],runner:[process.execPath,'--test','{files}']}
 });
 const report=repairFullSuite(root,{timeoutMs:3000});
 assert.equal(report.discovery.complete,true);assert.equal(report.complete,false);assert.notEqual(report.exitCode,0);
});
test('source repair validates repeated unchanged assertions and commits an isolated exact tree',async t=>{
 const root=project(t),head=git(root,'rev-parse','HEAD').trim();
 const result=await repair(root,{patch:patch('export const a=1;'),sourcePaths:['src/a.js'],deadlineMs:30000});cleanup(t,root,result);
 assert.equal(result.status,'ready-for-review',JSON.stringify(result));assert.equal(result.fullRun.complete,true);assert.equal(result.validation.accepted,true);assert.equal(result.fullRun.tests.length,2);assert.equal(result.fullRun.tests.every(row=>row.status==='passed'),true);
 assert.equal(result.kind,'source-repair');assert.equal(result.merged,false);assert.equal(result.published,false);assert.equal(result.sourceHead,head);assert.notEqual(result.sha,head);
 assert.equal(git(root,'rev-parse','HEAD').trim(),head);assert.equal(git(root,'status','--porcelain').trim(),'');assert.equal(fs.readFileSync(path.join(root,'src/a.js'),'utf8'),'export const a=9;');assert.equal(fs.readFileSync(path.join(root,'test/a.test.js'),'utf8'),fs.readFileSync(path.join(result.worktree,'test/a.test.js'),'utf8'));
 assert.equal(git(result.worktreeRoot,'show','--format=','--name-only','HEAD').trim(),'src/a.js');
});
test('wrong source repair never commits, and test edits cannot replace a repair',async t=>{
 const root=project(t),wrong=await repair(root,{patch:patch('export const a=99;'),sourcePaths:['src/a.js']});cleanup(t,root,wrong);assert.equal(wrong.status,'validation-rejected');assert.equal(wrong.sha,null);
 const oracle=await repair(root,{patch:{files:[{path:'test/a.test.js',content:"import test from 'node:test';test('a',()=>{});"}],review},sourcePaths:['src/a.js']});cleanup(t,root,oracle);assert.equal(oracle.status,'failed');assert.equal(oracle.sha,null);assert.match(oracle.error,/source|path|scope|file/i);
});
test('a final assertion unexpectedly skipped after repeated candidate passes cannot commit',async t=>{
 const root=project(t,{'test/a.test.js':`import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import {a} from '../src/a.js';
const marker='.tddswarm/executed-original-case';test('a',{skip:a===1&&fs.existsSync(marker)},()=>{fs.mkdirSync('.tddswarm',{recursive:true});fs.writeFileSync(marker,'observed');assert.equal(a,1);});`});
 const result=await repair(root,{patch:patch('export const a=1;'),sourcePaths:['src/a.js']});cleanup(t,root,result);
 assert.equal(result.validation.accepted,true);assert.equal(result.fullRun.complete,true);assert.equal(result.fullRun.exitCode,0);
 assert.equal(result.fullRun.tests.find(row=>row.name==='a').status,'skipped');
 assert.equal(result.status,'full-run-failed');assert.equal(result.sha,null);assert.equal(result.published,false);
});
test('dirty callers, empty requirements, unsupported evidence and oversized scopes stay bounded',async t=>{
 const root=project(t);write(root,'src/b.js','export const b=3;');await assert.rejects(repair(root,{patch:patch('export const a=1;')}),/Commit or stash/);git(root,'restore','src/b.js');
 await assert.rejects(repair(root,{sourcePaths:Array(33).fill('src/a.js')}),/1–32/);await assert.rejects(repair(root,{deadlineMs:900001}),/deadlineMs/);
 const unsupported=project(t,{'tddswarm.config.json':{adapter:'vitest'}});assert.equal((await repair(unsupported)).status,'unsupported-repair-evidence');
 const missing=fixture(t,twoModules);commit(missing);assert.equal((await repair(missing)).status,'awaiting-requirements');
});
test('installed-style CLI delegates bounded worker roles and preserves caller checkout',t=>{
 const worker=fixture(t,{'worker.cjs':`let input='';process.stdin.on('data',d=>input+=d);process.stdin.on('end',()=>{const p=JSON.parse(input);process.stdout.write(JSON.stringify(p.role==='repair-architect'?{tasks:[{subject:'src/a.js',instructions:'Restore required public value.'}]}:p.role==='repair-author'?{files:[{path:'src/a.js',content:'export const a=1;'}]}:${JSON.stringify(review)}));});`});
 const root=project(t,{'tddswarm.config.json':{adapter:'node',discovery:'native',runner:[process.execPath,'--test','{files}'],agent:[process.execPath,path.join(worker,'worker.cjs')]}});
 const cli=fileURLToPath(new URL('../src/cli.js',import.meta.url));const invocation=spawnSync(process.execPath,[cli,'autopilot','--root',root,'--sources','src/a.js','--local','--json'],{encoding:'utf8',timeout:30000});
 assert.equal(invocation.status,0,invocation.stderr||invocation.stdout);const result=JSON.parse(invocation.stdout);cleanup(t,root,result);assert.equal(result.status,'ready-for-review');assert.equal(result.workers.completedCalls,3);assert.equal(result.workers.executionValidated,false);assert.equal(result.fullRun.exitCode,0);assert.equal(result.published,false);assert.equal(git(root,'status','--porcelain').trim(),'');
 // This is a deterministic worker transport check, not real model or GitHub evidence.
});
