import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fixture,write,commit} from './helpers.js';
import {proposeRepair} from '../src/repair-swarm.js';

// Deterministic subprocess protocol fixtures; no model, provider cost or live PR is qualified.
const worker=String.raw`const fs=require('fs');let input='';process.stdin.on('data',c=>input+=c);process.stdin.on('end',async()=>{
 const p=JSON.parse(input),mode=process.argv[2]||'valid',record=e=>fs.appendFileSync('.tddswarm/calls.jsonl',JSON.stringify({role:p.role,subject:p.task?.subject,event:e,time:Date.now(),timeout:p.transportBudget.timeoutMs,context:p.context?.map(v=>v.file)})+'\n');record('start');
 if(mode==='hung'){setInterval(()=>{},1000);return;}
 if(mode==='oversize'){process.stdout.write('x'.repeat(20000));return;}
 if(mode==='invalid-json'){process.stdout.write('not JSON');return;}
 if(mode==='slow')await new Promise(r=>setTimeout(r,90));
 let response;
 if(p.role==='repair-architect'){
  response={tasks:p.sourcePaths.slice(0,p.maxTasks).map(subject=>({subject,instructions:'Repair the independent one/two public contract.'}))};
  if(mode==='duplicate-owners')response.tasks=[response.tasks[0],response.tasks[0]];
  if(mode==='too-many-tasks')response.tasks=Array(4).fill(response.tasks[0]);
 }else if(p.role==='repair-author'){
  if(mode==='parallel')await new Promise(r=>setTimeout(r,150));
  const content=p.task.subject.endsWith('a.js')?'export const a=1;':'export const b=2;';response={files:[{path:p.task.subject,content}]};
  if(mode==='escape')response.files[0].path='../outside.js';
  if(mode==='tests')response.files[0].path='test/a.test.js';
  if(mode==='config')response.files[0].path='vitest.config.js';
  if(mode==='new-path')response.files[0].path='src/new.js';
  if(mode==='cross-owner')response.files[0].path=p.task.subject.endsWith('a.js')?'lib/b.cjs':'src/a.js';
  if(mode==='delete')response.delete=[p.task.subject];
  if(mode==='commands')response.command=['touch','executed-output-command'];
  if(mode==='unchanged')response.files[0].content=p.context[0].content;
  if(mode==='mutate-test')fs.writeFileSync('test/a.test.js','weakened oracle');
  if(mode==='mutate-dependency')fs.writeFileSync('node_modules/proof.marker','changed shared dependency');
  if(mode==='mutate-mode')fs.chmodSync('test/a.test.js',0o600);
  if(mode==='new-file')fs.writeFileSync('src/unauthorized.js','new unchecked source');
 }else if(p.role==='repair-reviewer'){
  response={accepted:mode!=='reject',findings:mode==='reject'?['Deterministic fake reviewer rejected this proposal.']:[],oracle:{independent:mode!=='no-oracle',basis:mode==='empty-basis'?[]:['Independent requirements specify a=1 and b=2.']}};
  if(mode==='invented-cost')response.usage={tokens:1,dollars:0};
 }else{process.exit(9);return;}
 record('end');process.stdout.write(JSON.stringify(response));
});`;
function project(t,mode='valid',extras={}){
 const root=fixture(t,{'package.json':{type:'module'},'src/a.js':'export const a=99;','lib/b.cjs':'export const b=99;','test/a.test.js':'Independent immutable oracle bytes.','.tddswarm/worker.cjs':worker,...extras});
 const baseline={complete:true,exitCode:1,tests:[{file:'test/a.test.js',name:'a satisfies independent contract',status:'failed'}]};
 return {root,options:{agent:[process.execPath,path.join(root,'.tddswarm/worker.cjs'),mode],sourcePaths:['src/a.js','lib/b.cjs'],requirements:'Independent specification: a is one and b is two.',baseline,timeoutMs:2000,deadlineMs:10000}};
}
const log=root=>fs.existsSync(path.join(root,'.tddswarm/calls.jsonl'))?fs.readFileSync(path.join(root,'.tddswarm/calls.jsonl'),'utf8').trim().split('\n').map(line=>JSON.parse(line)):[];
test('deterministic repair protocol proposes disjoint source patches without applying or certifying them',async t=>{
 const {root,options}=project(t),before=fs.readFileSync(path.join(root,'test/a.test.js'),'utf8');
 const result=await proposeRepair(root,options);
 assert.equal(result.status,'reviewed-repair');assert.equal(result.accepted,true);assert.equal(result.applied,false);assert.equal(result.executionValidated,false);assert.equal(result.authority,'proposal-only');
 assert.deepEqual(result.files.map(file=>file.path),options.sourcePaths);assert.deepEqual(result.workerReceipts.map(receipt=>receipt.role),['repair-architect','repair-author','repair-author','repair-reviewer']);
 assert.equal(result.attemptedCalls,4);assert.equal(result.completedCalls,4);assert.equal(result.budgets.rounds,1);assert.equal(result.budgets.maxCalls,5);assert.deepEqual(result.cost,{measurement:'not-measured',tokens:null,amount:null,currency:null});
 assert.ok(result.workerReceipts.every(receipt=>receipt.durationMs>=0&&receipt.responseSha256.length===64));assert.equal(result.provenance.fingerprint,result.inputBindings.repositoryFingerprint);
 assert.equal(fs.readFileSync(path.join(root,'src/a.js'),'utf8'),'export const a=99;');assert.equal(fs.readFileSync(path.join(root,'test/a.test.js'),'utf8'),before);
 assert.ok(log(root).filter(row=>row.role==='repair-author').every(row=>row.context.length===1&&row.context[0]===row.subject));
});
test('deterministic authors actually overlap while ownership and a single reviewer remain distinct',async t=>{
 const {root,options}=project(t,'parallel');await proposeRepair(root,options);const events=log(root),starts=events.filter(row=>row.role==='repair-author'&&row.event==='start'),ends=events.filter(row=>row.role==='repair-author'&&row.event==='end');
 assert.equal(starts.length,2);assert.ok(Math.max(...starts.map(row=>row.time))<Math.min(...ends.map(row=>row.time)));assert.equal(events.filter(row=>row.role==='repair-reviewer'&&row.event==='start').length,1);
});
test('architect duplicate ownership and over-budget task counts stop before authors',async t=>{
 for(const mode of ['duplicate-owners','too-many-tasks']){const {root,options}=project(t,mode);await assert.rejects(proposeRepair(root,options),/architect/);assert.deepEqual(log(root).map(row=>row.role),['repair-architect','repair-architect']);}
});
test('author escapes, tests, config, new paths, cross-owner edits and deletes are never admitted',async t=>{
 for(const mode of ['escape','tests','config','new-path','cross-owner','delete','commands','unchanged']){
  const {root,options}=project(t,mode);await assert.rejects(proposeRepair(root,options),/author/);assert.equal(log(root).some(row=>row.role==='repair-reviewer'),false);assert.equal(fs.existsSync(path.join(root,'executed-output-command')),false);
 }
});
test('review rejection and absent independent oracle remain rejected proposals',async t=>{
 for(const mode of ['reject','no-oracle','empty-basis']){const {root,options}=project(t,mode);const result=await proposeRepair(root,options);assert.equal(result.accepted,false);assert.equal(result.status,'review-rejected');assert.equal(result.applied,false);assert.equal(result.executionValidated,false);}
});
test('worker-supplied cost counters cannot become measured provider cost',async t=>{
 const {root,options}=project(t,'invented-cost');await assert.rejects(proposeRepair(root,options),error=>{assert.match(error.message,/reviewer/);assert.equal(error.repairSwarm.cost.measurement,'not-measured');assert.equal(error.repairSwarm.cost.amount,null);return true;});
});
test('all repository inputs are immutable across workers, including tests and new files',async t=>{
 for(const mode of ['mutate-test','new-file']){const {root,options}=project(t,mode);await assert.rejects(proposeRepair(root,options),error=>{assert.match(error.message,/inputs changed/);assert.equal(error.repairSwarm.accepted,false);return true;});assert.equal(log(root).some(row=>row.role==='repair-reviewer'),false);}
});
test('Git-ignored oracles, file modes and trusted dependency bytes also bind before any worker',async t=>{
 for(const mode of ['mutate-test','mutate-dependency','mutate-mode']){
  const {root,options}=project(t,mode,{'.gitignore':'test/a.test.js\n.tddswarm/\nnode_modules/\n','node_modules/proof.marker':'unchanged trusted dependency'});commit(root);
  await assert.rejects(proposeRepair(root,options),error=>{assert.match(error.message,/inputs changed/);assert.equal(error.repairSwarm.accepted,false);return true;});assert.equal(log(root).some(row=>row.role==='repair-reviewer'),false);
 }
});
test('source admission rejects missing, symlinked, test and config paths before any worker',async t=>{
 const {root,options}=project(t);fs.symlinkSync(path.join(root,'src/a.js'),path.join(root,'src/link.js'));
 for(const sourcePaths of [['src/missing.js'],['src/link.js'],['test/a.test.js'],['vitest.config.js'],['../escape.js'],['src/a.js','src/a.js']])await assert.rejects(proposeRepair(root,{...options,sourcePaths}));
 assert.equal(log(root).length,0);
});
test('missing requirements, nonassertion or ambiguous baseline and invalid budgets invoke no workers',async t=>{
 const {root,options}=project(t);
 for(const edit of [{requirements:''},{baseline:{complete:false,exitCode:1,tests:options.baseline.tests}},{baseline:{complete:true,exitCode:0,tests:options.baseline.tests}},{baseline:{complete:true,exitCode:1,tests:[{file:'test/a.test.js',name:'<file-load>',status:'failed'}]}},{baseline:{...options.baseline,tests:[...options.baseline.tests,...options.baseline.tests]}},{maxTasks:4},{deadlineMs:0},{agent:['node','bad\0arg']}])await assert.rejects(proposeRepair(root,{...options,...edit}));
 assert.equal(log(root).length,0);
});
test('source and aggregate context byte bounds prevent large payload submission',async t=>{
 const {root,options}=project(t);write(root,'src/huge.js','x'.repeat(64*1024+1));await assert.rejects(proposeRepair(root,{...options,sourcePaths:['src/huge.js']}),/64 KiB/);
 for(const file of ['src/v.js','src/w.js','src/x.js','src/y.js','src/z.js'])write(root,file,'x'.repeat(60000));await assert.rejects(proposeRepair(root,{...options,sourcePaths:['src/v.js','src/w.js','src/x.js','src/y.js','src/z.js']}),/256 KiB/);assert.equal(log(root).length,0);
});
test('a UTF-8 BOM is retained in the admitted source binding rather than silently stripped',async t=>{
 const {root,options}=project(t,'valid',{'src/a.js':'\uFEFFexport const a=99;'});const result=await proposeRepair(root,{...options,sourcePaths:['src/a.js']});
 assert.equal(result.accepted,true);assert.equal(fs.readFileSync(path.join(root,'src/a.js'),'utf8'),'\uFEFFexport const a=99;');assert.equal(result.inputBindings.sourceHashes['src/a.js'],result.provenance.files['src/a.js']);
});
test('hung, malformed and oversized deterministic workers leave bounded failed receipts',async t=>{
 for(const mode of ['hung','invalid-json','oversize']){
  const {root,options}=project(t,mode);await assert.rejects(proposeRepair(root,{...options,timeoutMs:100,maxOutputBytes:1024}),error=>{assert.equal(error.repairSwarm.attemptedCalls,1);assert.equal(error.repairSwarm.completedCalls,0);assert.equal(error.repairSwarm.workerReceipts[0].status,'failed');assert.equal(error.repairSwarm.cost.measurement,'not-measured');return true;});
 }
});
test('one global deadline bounds later roles instead of granting every role a fresh round budget',async t=>{
 const {root,options}=project(t,'slow');const start=performance.now();await assert.rejects(proposeRepair(root,{...options,timeoutMs:1000,deadlineMs:170}),error=>{assert.ok(error.repairSwarm.workerReceipts.every(receipt=>receipt.timeoutMs<=170));assert.ok(error.repairSwarm.workerReceipts.length<=3);assert.equal(error.repairSwarm.accepted,false);return true;});assert.ok(performance.now()-start<1200);assert.equal(log(root).some(row=>row.role==='repair-reviewer'),false);
});
