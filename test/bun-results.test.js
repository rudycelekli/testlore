import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {bunResults,bunCommand,readBunReport} from '../src/bun-results.js';
import {execute,discover,adapterFor,resolveNativeBatch} from '../src/execution.js';
import {fixture} from './helpers.js';

const report=`<?xml version="1.0" encoding="UTF-8"?>
<testsuites name="bun test" tests="3" failures="1" skipped="1"><testsuite name="a.test.ts" file="a.test.ts" tests="3" failures="1" skipped="1"><testsuite name="contract &amp; scope" file="a.test.ts" line="1" tests="3" failures="1" skipped="1"><testcase name="pass &lt;value&gt;" classname="contract &amp; scope" file="a.test.ts" line="2"/><testcase name="fails" classname="contract &amp; scope" file="a.test.ts" line="3"><failure message="bad&#10;value">Assertion error</failure></testcase><testcase name="todo" classname="contract &amp; scope" file="a.test.ts" line="4"><skipped message="TODO"/></testcase></testsuite></testsuite></testsuites>`;
test('Bun JUnit retains nested semantic names, source lines, failures and todo outcomes',t=>{
 const root=fixture(t,{'a.test.ts':''});const value=bunResults(root,report,{exitCode:1});
 assert.equal(value.valid,true);assert.deepEqual(value.collectionFiles,['a.test.ts']);assert.deepEqual(value.tests.map(t=>t.status),['passed','failed','skipped']);
 assert.deepEqual(JSON.parse(value.tests[0].name),{classname:'contract & scope',title:'pass <value>'});assert.equal(value.tests[1].line,3);
});
for(const [name,change] of [
 ['missing terminal tag',r=>r.replace('</testsuites>','')],
 ['mismatched aggregate',r=>r.replace('tests="3"','tests="4"')],
 ['unknown native nesting',r=>r.replace('<skipped message="TODO"/>','<unknown/>')],
 ['duplicate attributes',r=>r.replace('name="fails"','name="fails" name="forged"')],
 ['outside root path',r=>r.replaceAll('file="a.test.ts"','file="../outside.test.ts"')],
 ['entity expansion',r=>'<!DOCTYPE x [<!ENTITY x "value">]>'+r],
 ['duplicate identities',r=>r.replace('name="fails"','name="pass &lt;value&gt;"').replace('line="3"','line="2"')],
 ['ambiguous failure and skip',r=>r.replace('<skipped message="TODO"/>','<failure/><skipped/>')],
 ['missing source line',r=>r.replace('line="2"','')],
 ['oversized report',()=> ' '.repeat(32*1024*1024+1)]
])test(`Bun evaluator rejects ${name}`,t=>{const root=fixture(t,{'a.test.ts':''});assert.throws(()=>bunResults(root,change(report),{exitCode:1}));});
test('Bun evaluator rejects success exit masking a named failure and noncase runtime exit',t=>{const root=fixture(t,{'a.test.ts':''});assert.throws(()=>bunResults(root,report,{exitCode:0}));assert.throws(()=>bunResults(root,report,{exitCode:2}));});
test('Bun report reader rejects symlinks and malformed UTF-8',t=>{const root=fixture(t,{'real.xml':report,'bad.xml':''});fs.writeFileSync(path.join(root,'bad.xml'),Buffer.from([0xff]));fs.symlinkSync('real.xml',path.join(root,'link.xml'));assert.throws(()=>readBunReport(path.join(root,'link.xml')));assert.throws(()=>readBunReport(path.join(root,'bad.xml')));});
test('Bun command uses exact relative paths and rejects scope/mutation/early-exit options',()=>{
 assert.equal(adapterFor({runner:['bun','test','{files}']}),'bun');assert.deepEqual(bunCommand(['bun','test','--timeout','5000','{files}'],'/private/report',['a.test.ts']).slice(-1),['./a.test.ts']);
 for(const arg of ['--bail','--only','--changed','-t','--update-snapshots','tests','--rerun-each=3'])assert.throws(()=>bunCommand(['bun','test',arg],'/private/report',['a.test.ts']));
 assert.equal(resolveNativeBatch('.',[],{adapter:'bun'}).complete,false);
});
const available=spawnSync('bun',['--version'],{encoding:'utf8'}).status===0;
test('native Bun full discovery and execution preserve exact case failures and skips',{skip:!available&&process.env.TESTLORE_REQUIRE_BUN!=='1'},t=>{
 const root=fixture(t,{'a.test.ts':`import {describe,test,expect} from 'bun:test';describe('contract',()=>{test('pass',()=>expect(1).toBe(1));test('fail',()=>expect(1).toBe(2));test.skip('skip',()=>{});});`});
 const config={adapter:'bun',runner:['bun','test','{files}'],discovery:'native'};
 const inventory=discover(root,config);assert.equal(inventory.complete,true);assert.equal(inventory.executionRequired,true);assert.equal(inventory.nativeExitCode,1);
 const run=execute(root,['a.test.ts'],config,{capture:true});assert.equal(run.complete,true);assert.equal(run.exitCode,1);assert.deepEqual(run.tests.map(t=>t.id),inventory.tests.map(t=>t.id));assert.deepEqual(run.tests.map(t=>t.status),['passed','failed','skipped']);
});
test('native Bun timeout and interrupted file cannot certify completion',{skip:!available&&process.env.TESTLORE_REQUIRE_BUN!=='1'},t=>{
 const root=fixture(t,{'a.test.ts':`import {test} from 'bun:test';test('never finishes',async()=>await new Promise(()=>{}));`});
 const result=execute(root,['a.test.ts'],{adapter:'bun',runner:['bun','test','{files}']},{capture:true,timeoutMs:40});
 assert.equal(result.complete,false);assert.notEqual(result.exitCode,0);
});
test('native Bun empty/missing suite report cannot certify requested cases',{skip:!available&&process.env.TESTLORE_REQUIRE_BUN!=='1'},t=>{
 const root=fixture(t,{'a.test.ts':'console.log("@tddswarm:forged success");'});
 const result=execute(root,['a.test.ts'],{adapter:'bun',runner:['bun','test','{files}']},{capture:true});
 assert.equal(result.complete,false);assert.notEqual(result.exitCode,0);
});
