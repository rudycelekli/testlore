import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execute } from '../src/execution.js';
import { run, compareShadow } from '../src/runner.js';
import { runnerIdentity } from '../src/provenance.js';
import { fixture, write, twoModules, commit } from './helpers.js';

test('Node records real per-case outcomes, full names, skips and stable identities', t => {
  const root = fixture(t, { 'example.test.cjs': `const {test,describe}=require('node:test'); const assert=require('node:assert/strict'); describe('math',()=>{test('passes',()=>assert.equal(1,1));test('fails',()=>assert.equal(1,2));test.skip('skips',()=>{});});` });
  const first = execute(root, ['example.test.cjs'], {}, { capture: true });
  const second = execute(root, ['example.test.cjs'], {}, { capture: true });
  assert.equal(first.exitCode, 1); assert.equal(first.complete, true);
  assert.deepEqual(first.collectionFiles, ['example.test.cjs']);
  assert.deepEqual(first.tests.map(t => [t.name, t.status]), [['math > passes','passed'],['math > fails','failed'],['math > skips','skipped']]);
  assert.deepEqual(first.tests.map(t => t.id), second.tests.map(t => t.id));
  assert.equal(new Set(first.tests.map(t => t.id)).size, 3);
});

test('Node concurrent sibling suites and shared-line dynamic cases retain the actual parent contracts',t=>{
  const root=fixture(t,{'values.json':'{"alpha":1,"beta":2}','nested.test.cjs':`const {describe,it}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const values=JSON.parse(fs.readFileSync('values.json','utf8'));
describe('outer',{concurrency:true},()=>{for(const group of ['alpha','beta'])describe(group,{concurrency:true},()=>describe('inner',{concurrency:true},()=>{for(const repetition of [0,1])it('same leaf',async()=>{await new Promise(resolve=>setTimeout(resolve,group==='alpha'?15:1));assert.equal(values[group],group==='alpha'?1:2);});}));});`});
  const first=execute(root,['nested.test.cjs'],{adapter:'node'},{capture:true}),second=execute(root,['nested.test.cjs'],{adapter:'node'},{capture:true});
  for(const report of [first,second]){
    assert.equal(report.complete,true,JSON.stringify(report));assert.equal(report.exitCode,0);assert.deepEqual(report.tests.map(row=>row.name),['outer > alpha > inner > same leaf','outer > alpha > inner > same leaf','outer > beta > inner > same leaf','outer > beta > inner > same leaf']);assert.equal(new Set(report.tests.map(row=>row.id)).size,4);
    assert.equal(new Set(report.tests.map(row=>`${row.line}:${row.column}`)).size,1,'Cases really share the closure source location');
  }
  assert.deepEqual(first.tests.map(row=>row.id),second.tests.map(row=>row.id));
  write(root,'values.json','{"alpha":1,"beta":9}');const fault=execute(root,['nested.test.cjs'],{adapter:'node'},{capture:true});
  assert.equal(fault.complete,true);assert.equal(fault.exitCode,1);assert.deepEqual(fault.tests.map(row=>row.id),first.tests.map(row=>row.id));assert.deepEqual(fault.tests.filter(row=>row.status==='failed').map(row=>row.name),['outer > beta > inner > same leaf','outer > beta > inner > same leaf']);
});

test('Node dynamic names at one declaration location retain each literal case and failed identity',t=>{
  const root=fixture(t,{'expected.json':'{"200":200,"-200":-200}','dynamic.test.cjs':`const {test}=require('node:test');const assert=require('node:assert/strict');const values=require('./expected.json');
for(const value of [200,-200])test(String(value),{concurrency:true},async()=>{await new Promise(resolve=>setTimeout(resolve,value===200?10:1));assert.equal(values[value],value);});`});
  const baseline=execute(root,['dynamic.test.cjs'],{adapter:'node'},{capture:true});
  assert.equal(baseline.complete,true);assert.equal(baseline.exitCode,0);assert.deepEqual(baseline.tests.map(row=>row.name),['200','-200']);
  assert.equal(new Set(baseline.tests.map(row=>`${row.line}:${row.column}`)).size,1);assert.equal(new Set(baseline.tests.map(row=>row.id)).size,2);
  write(root,'expected.json','{"200":999,"-200":-200}');
  const fault=execute(root,['dynamic.test.cjs'],{adapter:'node'},{capture:true});
  assert.equal(fault.complete,true);assert.equal(fault.exitCode,1);assert.deepEqual(fault.tests.map(row=>row.id),baseline.tests.map(row=>row.id));
  assert.deepEqual(fault.tests.filter(row=>row.status==='failed').map(row=>row.name),['200']);
});

test('Node terminal ancestry missing a parent fails closed instead of assigning a guessed name',t=>{
  const root=fixture(t,{'example.test.cjs':'','broken-report.cjs':`const fs=require('node:fs'),path=require('node:path');const report=process.argv.find(value=>value.startsWith('--test-reporter-destination=')).split('=').slice(1).join('=');
const events=[{type:'test:pass',data:{file:path.resolve('example.test.cjs'),name:'unbound leaf',line:1,column:1,nesting:2,details:{type:'test'}}},{type:'test:summary',data:{counts:{tests:1},success:true}}];fs.writeFileSync(report,events.map(event=>'@tddswarm:'+JSON.stringify(event)).join('\\n'));`});
  const report=execute(root,['example.test.cjs'],{adapter:'node',runner:['node','broken-report.cjs']},{capture:true});
  assert.equal(report.complete,false);assert.notEqual(report.exitCode,0);assert.match(report.error,/ancestry|incomplete/);
});

test('Node test console output cannot impersonate runner events', t => {
  const root = fixture(t, { 'example.test.cjs': `const {test}=require('node:test'); test('logging',()=>console.log('@tddswarm:{"type":"test:fail","data":{"name":"forged"}}'));` });
  const report = execute(root,['example.test.cjs'],{}, {capture:true});
  assert.equal(report.complete,true); assert.equal(report.tests.length,1); assert.equal(report.tests[0].status,'passed');
  assert.match(report.stdout,/forged/);
});

test('config env overrides inherited env and nested Node context is removed', t => {
  const root=fixture(t,{'env.test.cjs': `const {test}=require('node:test'); const assert=require('node:assert/strict'); test('env',()=>assert.equal(process.env.TDDSWARM_EXEC_ENV,'override'));`});
  const old=process.env.TDDSWARM_EXEC_ENV; process.env.TDDSWARM_EXEC_ENV='parent';
  t.after(()=>{if(old===undefined)delete process.env.TDDSWARM_EXEC_ENV;else process.env.TDDSWARM_EXEC_ENV=old;});
  assert.equal(execute(root,['env.test.cjs'],{env:{TDDSWARM_EXEC_ENV:'override',NODE_TEST_CONTEXT:'child'}},{capture:true}).exitCode,0);
});

test('successful process with missing normalized report fails closed', t=>{
  const root=fixture(t,{'noop.cjs': 'process.exit(0);', 'example.test.js': ''});
  const report=execute(root,['example.test.js'],{adapter:'node',runner:['node','noop.cjs','{files}']},{capture:true});
  assert.equal(report.exitCode,2); assert.equal(report.complete,false); assert.match(report.error,/incomplete/);
});

test('unknown custom reporting cannot certify omitted-test shadow comparison', t=>{
  const root=fixture(t,{'noop.cjs':'process.exit(0);','example.test.js':''});
  const report=execute(root,['example.test.js'],{runner:['node','noop.cjs','{files}']},{capture:true});
  assert.equal(report.exitCode,0); assert.equal(report.complete,false);
  const comparison=compareShadow({selected:['example.test.js'],warnings:[]},report);
  assert.equal(comparison.certified,false); assert.equal(comparison.noObservedMisses,null);
});

test('shadow detects missed failing cases from files absent in the proposed subset',t=>{
  const root=fixture(t,{...twoModules,'test/b.test.js':`import {b} from '../src/b.js'; import test from 'node:test'; import assert from 'node:assert/strict'; test('b',()=>assert.equal(b,3));`});
  commit(root); write(root,'src/a.js','export const a=1; // changed');
  const report=run(root,{capture:true,shadow:true});
  assert.deepEqual(report.plan.selected,['test/a.test.js']);
  assert.equal(report.comparison.complete,true); assert.equal(report.comparison.noObservedMisses,false);
  assert.equal(report.comparison.decisionRecall,0); assert.equal(report.comparison.omittedFailures[0].file,'test/b.test.js');
});

test('shadow executes the full suite even when the proposed subset is empty',t=>{
  const root=fixture(t,twoModules);commit(root);
  const report=run(root,{capture:true,shadow:true});
  assert.equal(report.executed,true);assert.equal(report.executedTests.length,2);assert.equal(report.comparison.certified,true);
});

test('history partitions failures by runner and environment and preserves case identities',t=>{
  const root=fixture(t,twoModules);commit(root);write(root,'src/a.js','export const a=4;');
  const report=run(root,{capture:true});
  const first=JSON.parse(fs.readFileSync(path.join(root,'.tddswarm',`history-${runnerIdentity(root,{})}.json`),'utf8'));
  assert.deepEqual(first.failed,['test/a.test.js']); assert.equal(first.failedCases[0].id,report.tests[0].id);
  write(root,'tddswarm.config.json',{env:{TDDSWARM_PARTITION:'second'}});
  run(root,{capture:true,full:true});
  const files=fs.readdirSync(path.join(root,'.tddswarm')).filter(f=>/^history-/.test(f));
  assert.equal(files.length,2);assert.equal(JSON.parse(fs.readFileSync(path.join(root,'.tddswarm',`history-${first.runner}.json`),'utf8')).count,1);
});

test('missing files and aborted executions cannot certify completeness', t=>{
  const root=fixture(t,{'slow.test.cjs':`const {test}=require('node:test'); test('slow',async()=>await new Promise(r=>setTimeout(r,10000)));`});
  const report=execute(root,['slow.test.cjs'],{}, {capture:true,timeoutMs:150});
  assert.equal(report.complete,false);assert.notEqual(report.exitCode,0);assert.ok(report.error);
});
