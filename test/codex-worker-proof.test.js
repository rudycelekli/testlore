import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {qualifyCodexWorker} from '../scripts/codex-worker-proof.js';

test('worker proof is opt-in and rejects invalid budgets before creating evidence',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'testlore-worker-proof-test-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const output=path.join(root,'new');await assert.rejects(qualifyCodexWorker({output}),/explicit --execute/);assert.equal(fs.existsSync(output),false);
  await assert.rejects(qualifyCodexWorker({output,executeNative:true,timeoutMs:Infinity}),/timeoutMs/);assert.equal(fs.existsSync(output),false);
});
test('independent faults expose weak generated assertions and retain failures without retries',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'testlore-worker-proof-test-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));let calls=0;
  const request=async payload=>{calls++;assert.equal(JSON.stringify(payload).includes('reversed-byte-order'),false);assert.equal(payload.reference,undefined);const value=payload.role==='architect'?{tasks:[{subject:'src/encode16.js',instructions:'Use independent expectations'}]}:payload.role==='author'?{files:[{path:'test/weak.test.js',content:"import test from 'node:test';import assert from 'node:assert/strict';import {encode16} from '../src/encode16.js';test('weak',()=>assert.equal(encode16(0).length,2));"}]}:{accepted:true,findings:[],oracle:{independent:true,basis:['Declared requirements']}};return {value,audit:null};};
  const output=path.join(root,'weak'),result=await qualifyCodexWorker({output,request});assert.equal(result.evidenceKind,'protocol-fixture');assert.equal(result.complete,false);assert.equal(calls,3);assert.equal(result.referenceDemonstrated,3);assert.equal(result.detected,0);assert.match(result.error.message,/did not stably detect/);assert.equal(result.model.verified,null);assert.equal(result.billingUSD,null);
  assert.ok(fs.existsSync(path.join(output,'generated-reversed-byte-order.json')));await assert.rejects(qualifyCodexWorker({output,request}),/must be new/);assert.equal(calls,3);
});
test('successful fixture proof repeats baselines and every independently demonstrated defect',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'testlore-worker-proof-test-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const request=async payload=>({value:payload.role==='architect'?{tasks:[{subject:'src/encode16.js',instructions:'Test byte order and invalid range'}]}:payload.role==='author'?{files:[{path:'test/contract.test.js',content:"import test from 'node:test';import assert from 'node:assert/strict';import {encode16} from '../src/encode16.js';test('independent contract',()=>{assert.deepEqual(encode16(4660),[18,52]);assert.throws(()=>encode16(65536),RangeError);assert.throws(()=>encode16(1.5),RangeError);});"}]}:{accepted:true,findings:[],oracle:{independent:true,basis:['Declared big-endian and integer range contract']}},audit:null});
  const output=path.join(root,'strong'),result=await qualifyCodexWorker({output,request});assert.equal(result.complete,true);assert.equal(result.detected,3);assert.equal(result.roleInvocations,3);assert.equal(result.evidenceKind,'protocol-fixture');
  for(const name of ['generated-baselines','generated-reversed-byte-order','generated-upper-bound-accepted','generated-fractional-value-accepted']){const executions=JSON.parse(fs.readFileSync(path.join(output,name+'.json')));assert.equal(executions.length,2);assert.equal(executions.every(r=>r.complete),true);}
});
