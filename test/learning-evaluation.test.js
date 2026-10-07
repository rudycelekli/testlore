import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { evaluateLearning, defaultDataset, validateDataset, evaluationSchedule, summarizeEvaluation, stableOutcomes } from '../scripts/learning-evaluation.js';
import {qualificationContracts} from '../scripts/qualification-contracts.js';
import {commitDataset} from '../scripts/evaluation-commitment.js';

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
  const commitment=commitDataset(dataset,{owner:'Protocol test fixture',source:'constructed test',independentlyMaintained:false,independenceNotes:'This exercises transport exclusion, not AI quality or independent external authorship.'});
  const summary = await evaluateLearning({output,agent:[process.execPath,worker],identity:'controlled-protocol-fixture',dataset,commitment,repeat:1,seed:4,maxCalls:12,evidenceKind:'protocol-fixture'});
  assert.equal(summary.calls,12); assert.equal(summary.comparison.complete,true); assert.equal(summary.comparison.inference,'inconclusive-protocol-fixture'); assert.equal(summary.arms.every(arm => arm.detected===2),true);
  const warm = JSON.parse(fs.readFileSync(path.join(output,'trial-normalize-0-with_memory.json'))); const cold = JSON.parse(fs.readFileSync(path.join(output,'trial-normalize-0-without_memory.json')));
  assert.equal(summary.datasetCommitment.verified,true);assert.equal(summary.learningPromotion.enabled,false);assert.equal(fs.existsSync(path.join(output,'dataset-commitment.json')),true);
  for(const row of [warm,cold])for(const call of row.calls){const input=JSON.stringify(call.input);assert.ok(!input.includes(commitment.datasetHash));assert.ok(!input.includes('referenceTests'));assert.ok(!input.includes('trim-omitted'));assert.ok(!input.includes('independenceNotes'));}
  assert.equal(warm.recalledRecords,0); assert.equal(warm.noApplicableMemory,true); assert.equal(summary.comparison.applicableMemoryInAllTrials,false); assert.equal(cold.recalledRecords,0); assert.equal(warm.calls.length,3); assert.equal(warm.calls[2].input.learning,undefined); assert.equal(warm.defects[0].detected,true); assert.equal(warm.defects[0].result.tests.some(t => t.status==='failed' && t.name!=='<file-load>'),true);
  assert.equal(warm.baselines.length,2);assert.equal(warm.defects[0].executions.length,2);assert.equal(warm.defects[0].stable,true);assert.equal(warm.billing.amount,null);assert.ok(warm.inputBytes>0);assert.equal(summary.arms.every(a=>a.stableTrials===2&&a.billingUSD===null),true);
  assert.equal(warm.accountingVersion,2);assert.equal(warm.byteAccounting.transportBudgetBytes,'excluded');assert.ok(warm.setupMs>=0&&warm.retrievalMs>=0);assert.ok(warm.totalMs>=warm.setupMs+warm.retrievalMs-1);
  assert.equal(warm.inputBytes,warm.calls.reduce((bytes,call)=>bytes+Buffer.byteLength(JSON.stringify(call.input)),0));assert.equal(warm.outputBytes,warm.calls.reduce((bytes,call)=>bytes+Buffer.byteLength(JSON.stringify(call.output)),0));
  await assert.rejects(evaluateLearning({output,agent:[process.execPath,worker],identity:'fixture',dataset,repeat:1,maxCalls:12}),/new directory/);
  const failureOutput=path.join(root,'failed-receipt'); const failed=await evaluateLearning({output:failureOutput,agent:[process.execPath,'-e','process.exit(9)'],identity:'failed-protocol-fixture',dataset,repeat:1,maxCalls:12,evidenceKind:'protocol-fixture'});
  assert.equal(failed.calls,4); assert.equal(failed.comparison.complete,false); assert.equal(failed.arms.every(arm=>arm.detected===0&&arm.failedTrials===2),true);
  const attempted=JSON.parse(fs.readFileSync(path.join(failureOutput,'trial-normalize-0-with_memory.json'))); assert.equal(attempted.calls[0].role,'architect'); assert.match(attempted.calls[0].error,/exited 9/); assert.ok(attempted.calls[0].input.requirements);
  const injected=await evaluateLearning({output:path.join(root,'injected'),agent:[process.execPath,'-e',"const fs=require('node:fs');fs.mkdirSync('tests');fs.writeFileSync('tests/hidden.test.mjs','');process.stdout.write(JSON.stringify({tasks:[{subject:'src/normalize.js',instructions:'test'}]}));"],identity:'side-effect-fixture',dataset,repeat:1,maxCalls:12,evidenceKind:'protocol-fixture'});
  assert.equal(injected.comparison.complete,false);assert.equal(injected.calls,4);
  assert.match(JSON.parse(fs.readFileSync(path.join(root,'injected','trial-normalize-0-with_memory.json'))).error,/outside the JSON protocol/);
  const ignored=await evaluateLearning({output:path.join(root,'ignored-write'),agent:[process.execPath,'-e',"const fs=require('node:fs');fs.writeFileSync('.tddswarm/hidden','side effect');process.stdout.write(JSON.stringify({tasks:[{subject:'src/normalize.js',instructions:'test'}]}));"],identity:'ignored-side-effect-fixture',dataset,repeat:1,maxCalls:12,evidenceKind:'protocol-fixture'});assert.equal(ignored.comparison.complete,false);assert.match(JSON.parse(fs.readFileSync(path.join(root,'ignored-write','trial-normalize-0-with_memory.json'))).error,/outside the JSON protocol/);
});
test('failed reference baseline and undemonstrated held-out fault retain native executions before cleanup without worker calls',async t=>{
  const root=temporary(t),marker=path.join(root,'worker-called');
  const agent=[process.execPath,'-e',`require('node:fs').writeFileSync(${JSON.stringify(marker)},'called');process.exit(9);`];
  for(const failure of ['baseline','defect']){
    const dataset=defaultDataset();dataset.fixtures=dataset.fixtures.slice(0,2);dataset.fixtures.forEach(f=>{f.defects=f.defects.slice(0,1);});
    const first=dataset.fixtures[0];
    if(failure==='baseline')first.referenceTests[0].content+="test('deliberate reference failure',()=>assert.fail('retain native failure'));";
    else first.defects[0].files[0].content=first.files[0].content+' // behavior-preserving non-fault';
    const output=path.join(root,failure);
    await assert.rejects(evaluateLearning({output,agent,identity:'never-invoked-protocol-fixture',dataset,repeat:1,maxCalls:12,evidenceKind:'protocol-fixture'}),failure==='baseline'?/reference baseline failed/:/Undemonstrated/);
    assert.equal(fs.existsSync(marker),false);
    const label=JSON.parse(fs.readFileSync(path.join(output,'labels-normalize.json')));assert.equal(label.complete,false);assert.ok(label.error);assert.equal(label.baselines.length,2);
    const {controller}=JSON.parse(fs.readFileSync(path.join(output,'controller.json')));assert.equal(controller.completed,false);assert.ok(controller.error);assert.ok(controller.groundTruthMs>=0&&controller.sharedPreparationMs>=0);assert.ok(controller.elapsedMs>=controller.setupMs+controller.sharedPreparationMs+controller.groundTruthMs-2);
    for(let i=0;i<2;i++){
      const baseline=JSON.parse(fs.readFileSync(path.join(output,`labels-normalize-baseline-${i}.json`)));assert.equal(baseline.complete,true);
      if(failure==='baseline')assert.ok(baseline.tests.some(test=>test.status==='failed'&&test.name!=='<file-load>'));
      else{const fault=JSON.parse(fs.readFileSync(path.join(output,`labels-normalize-defect-trim-omitted-${i}.json`)));assert.equal(fault.complete,true);assert.equal(fault.exitCode,0);assert.ok(fault.tests.every(test=>test.status==='passed'));}
    }
  }
});
test('focused protocol accounting labels normalized JSON bytes and includes setup and recall in trial spans',async t=>{
  const root=temporary(t),dataset=defaultDataset();dataset.fixtures=dataset.fixtures.slice(0,2);dataset.fixtures.forEach(f=>{f.defects=f.defects.slice(0,1);});
  const worker=path.join(root,'accounting.cjs');fs.writeFileSync(worker,"let input='';process.stdin.on('data',s=>input+=s);process.stdin.on('end',()=>{const p=JSON.parse(input);process.stdout.write('  '+JSON.stringify({tasks:[],transportBudgetReceived:Boolean(p.transportBudget)})+'\\n  ');});");
  const output=path.join(root,'accounting');const summary=await evaluateLearning({output,agent:[process.execPath,worker],identity:'accounting-protocol-fixture',dataset,repeat:1,maxCalls:12,evidenceKind:'protocol-fixture'});
  assert.equal(summary.calls,4);assert.equal(summary.accountingVersion,2);assert.equal(summary.comparison.complete,false);assert.equal(summary.byteAccounting.transportBudgetBytes,'excluded');assert.match(summary.byteAccounting.rawStdoutBytes,/not measured/);
  assert.equal(summary.controller.completed,true);assert.ok(summary.controller.groundTruthMs>=0&&summary.controller.sharedPreparationMs>=0);assert.equal(JSON.parse(fs.readFileSync(path.join(output,'controller.json'))).controller.elapsedMs,summary.controller.elapsedMs);assert.deepEqual(JSON.parse(fs.readFileSync(path.join(output,'summary.json'))).controller,summary.controller);
  for(const arm of ['with_memory','without_memory']){
    const row=JSON.parse(fs.readFileSync(path.join(output,`trial-normalize-0-${arm}.json`))),call=row.calls[0];
    assert.ok(Number.isInteger(row.setupMs)&&row.setupMs>=0);assert.ok(Number.isInteger(row.retrievalMs)&&row.retrievalMs>=0);assert.ok(row.totalMs>=row.setupMs+row.retrievalMs+row.generationMs-2);
    assert.equal(call.input.transportBudget,undefined);assert.equal(call.output.transportBudgetReceived,true);assert.equal(row.inputBytes,Buffer.byteLength(JSON.stringify(call.input)));assert.equal(row.outputBytes,Buffer.byteLength(JSON.stringify(call.output)));assert.equal(call.outputBytes,row.outputBytes);
  }
});
test('call budget fails before any output directory or worker invocation', async t => {
  const root = temporary(t), output = path.join(root,'budget-receipt');
  await assert.rejects(evaluateLearning({output,agent:['unavailable'],identity:'fixture',maxCalls:1}),/requires 54 calls/); assert.equal(fs.existsSync(output),false);
});
test('stability needs repeated complete named outcomes and rejects skips, status changes and identity changes',()=>{
  const r={complete:true,exitCode:0,tests:[{id:'a',file:'test/a.test.js',name:'contract',status:'passed'}]};
  assert.equal(stableOutcomes([r,structuredClone(r)]),true);
  for(const changed of [{...r,complete:false},{...r,exitCode:1},{...r,tests:[]},{...r,tests:[{...r.tests[0],status:'skipped'}]},{...r,tests:[{...r.tests[0],status:'failed'}]},{...r,tests:[{...r.tests[0],id:'other'}]}])assert.equal(stableOutcomes([r,changed]),false);
  assert.equal(stableOutcomes([r]),false);
});
test('fresh qualification contracts are distinct and paired accounting retains total cost and input overhead',()=>{
  const dataset=qualificationContracts();assert.equal(validateDataset(dataset),dataset);assert.equal(dataset.fixtures.length,6);assert.equal(dataset.fixtures.flatMap(f=>f.defects).length,18);
  const fixtures=[{id:'one'}],without={fixture:'one',repetition:0,arm:'without_memory',recall:1,cases:1,generationMs:10,totalMs:30,inputBytes:100,outputBytes:50};
  const result=summarizeEvaluation([without,{...without,arm:'with_memory',totalMs:45,inputBytes:200}],fixtures,1);
  assert.equal(result.pairedMeans.totalMsDelta,15);assert.equal(result.pairedMeans.inputBytesDelta,100);assert.equal(result.inference,'inconclusive');
});
