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
