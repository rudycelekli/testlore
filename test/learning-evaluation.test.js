import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { evaluateLearning, defaultDataset, validateDataset, evaluationSchedule, summarizeEvaluation } from '../scripts/learning-evaluation.js';

function temporary(t) { const root = fs.mkdtempSync(path.join(os.tmpdir(),'testlore-evaluation-test-')); t.after(() => fs.rmSync(root,{recursive:true,force:true})); return root; }
test('evaluation manifests reject overlap and traversal; schedules are repeatable and balanced', () => {
  const data = defaultDataset(); assert.equal(validateDataset(data),data);
  const overlap = structuredClone(data); overlap.fixtures[0].specificationId = overlap.history[0].specificationId; assert.throws(() => validateDataset(overlap),/distinct/);
  const traversal = structuredClone(data); traversal.fixtures[0].files[0].path = '../private.js'; assert.throws(() => validateDataset(traversal),/path/);
  const nativeNames=structuredClone(data);nativeNames.fixtures[0].referenceTests[0].path='tests/normalize.test.mjs';assert.equal(validateDataset(nativeNames),nativeNames);
  const repeated = evaluationSchedule(data.fixtures,4,7); assert.deepEqual(repeated,evaluationSchedule(data.fixtures,4,7)); assert.equal(repeated.filter(p => p.arms[0] === 'with_memory').length,6);
});
test('ties and fixture-only workers never establish a learning gain; repetitions are clustered', () => {
  const fixtures = [{id:'one'},{id:'two'}], trials = [];
  for (const f of fixtures) for (let repetition=0;repetition<3;repetition++) for (const arm of ['with_memory','without_memory']) trials.push({fixture:f.id,repetition,arm,recall:1,cases:4,generationMs:10,outputBytes:100});
  const result = summarizeEvaluation(trials,fixtures,3); assert.equal(result.inference,'inconclusive'); assert.equal(result.exactTwoSidedSignTest.p,1); assert.equal(result.independentSpecificationUnits.length,2); assert.equal(result.pairs.length,6);
});
test('paired controller executes withheld defects, retains raw outputs, and never exposes labels to workers', async t => {
  const root = temporary(t), worker = path.join(root,'worker.cjs');
  fs.writeFileSync(worker, `const fs=require('node:fs');let input='';process.stdin.on('data',s=>input+=s);process.stdin.on('end',()=>{const p=JSON.parse(input);if(input.includes('referenceTests')||input.includes('trim-omitted')||input.includes('type-collapse')||fs.existsSync('test'))throw Error('Leaked holdout or preinstalled tests');const subject=p.context[0].file;const name=subject.split('/').pop().split('.')[0];let r;if(p.role==='architect')r={tasks:[{subject,instructions:p.requirements}]};if(p.role==='author'){const body=name==='normalize'?"assert.equal(normalize(' X '),'x');assert.equal(normalize(' A  B '),'a  b');assert.throws(()=>normalize(2),TypeError);":"assert.deepEqual(unique([3,1,3,'1',1]),[3,1,'1']);assert.deepEqual(unique([]),[]);assert.throws(()=>unique(null),TypeError);";r={files:[{path:'test/generated.test.js',content:"import test from 'node:test';import assert from 'node:assert/strict';import {"+name+"} from '../"+subject+"';test('contract',()=>{"+body+"});"}]};}if(p.role==='reviewer')r={accepted:true,findings:[],oracle:{independent:true,basis:[p.requirements]}};process.stdout.write(JSON.stringify(r));});`);
  const dataset = defaultDataset(); dataset.fixtures = dataset.fixtures.slice(0,2); dataset.fixtures.forEach(f => {f.defects=f.defects.slice(0,1);});
  const output = path.join(root,'receipt');
  const summary = await evaluateLearning({output,agent:[process.execPath,worker],identity:'controlled-protocol-fixture',dataset,repeat:1,seed:4,maxCalls:12,evidenceKind:'protocol-fixture'});
  assert.equal(summary.calls,12); assert.equal(summary.comparison.complete,true); assert.equal(summary.comparison.inference,'inconclusive-protocol-fixture'); assert.equal(summary.arms.every(arm => arm.detected===2),true);
  const warm = JSON.parse(fs.readFileSync(path.join(output,'trial-normalize-0-with_memory.json'))); const cold = JSON.parse(fs.readFileSync(path.join(output,'trial-normalize-0-without_memory.json')));
  assert.equal(warm.recalledRecords,0); assert.equal(warm.noApplicableMemory,true); assert.equal(summary.comparison.applicableMemoryInAllTrials,false); assert.equal(cold.recalledRecords,0); assert.equal(warm.calls.length,3); assert.equal(warm.calls[2].input.learning,undefined); assert.equal(warm.defects[0].detected,true); assert.equal(warm.defects[0].result.tests.some(t => t.status==='failed' && t.name!=='<file-load>'),true);
  await assert.rejects(evaluateLearning({output,agent:[process.execPath,worker],identity:'fixture',dataset,repeat:1,maxCalls:12}),/new directory/);
  const failureOutput=path.join(root,'failed-receipt'); const failed=await evaluateLearning({output:failureOutput,agent:[process.execPath,'-e','process.exit(9)'],identity:'failed-protocol-fixture',dataset,repeat:1,maxCalls:12,evidenceKind:'protocol-fixture'});
  assert.equal(failed.calls,4); assert.equal(failed.comparison.complete,false); assert.equal(failed.arms.every(arm=>arm.detected===0&&arm.failedTrials===2),true);
  const attempted=JSON.parse(fs.readFileSync(path.join(failureOutput,'trial-normalize-0-with_memory.json'))); assert.equal(attempted.calls[0].role,'architect'); assert.match(attempted.calls[0].error,/exited 9/); assert.ok(attempted.calls[0].input.requirements);
  const injected=await evaluateLearning({output:path.join(root,'injected'),agent:[process.execPath,'-e',"const fs=require('node:fs');fs.mkdirSync('tests');fs.writeFileSync('tests/hidden.test.mjs','');process.stdout.write(JSON.stringify({tasks:[{subject:'src/normalize.js',instructions:'test'}]}));"],identity:'side-effect-fixture',dataset,repeat:1,maxCalls:12,evidenceKind:'protocol-fixture'});
  assert.equal(injected.comparison.complete,false);assert.equal(injected.calls,4);
  assert.match(JSON.parse(fs.readFileSync(path.join(root,'injected','trial-normalize-0-with_memory.json'))).error,/outside the JSON protocol/);
  const ignored=await evaluateLearning({output:path.join(root,'ignored-write'),agent:[process.execPath,'-e',"const fs=require('node:fs');fs.writeFileSync('.tddswarm/hidden','side effect');process.stdout.write(JSON.stringify({tasks:[{subject:'src/normalize.js',instructions:'test'}]}));"],identity:'ignored-side-effect-fixture',dataset,repeat:1,maxCalls:12,evidenceKind:'protocol-fixture'});assert.equal(ignored.comparison.complete,false);assert.match(JSON.parse(fs.readFileSync(path.join(root,'ignored-write','trial-normalize-0-with_memory.json'))).error,/outside the JSON protocol/);
});
test('call budget fails before any output directory or worker invocation', async t => {
  const root = temporary(t), output = path.join(root,'budget-receipt');
  await assert.rejects(evaluateLearning({output,agent:['unavailable'],identity:'fixture',maxCalls:1}),/requires 54 calls/); assert.equal(fs.existsSync(output),false);
});
