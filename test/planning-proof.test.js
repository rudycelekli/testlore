import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runPlanningProof, validateNativeFull } from '../scripts/planning-proof.js';
import { fixture } from './helpers.js';
const repository=fileURLToPath(new URL('..',import.meta.url));
const full=()=>({complete:true,exitCode:1,files:Array.from({length:12},(_,i)=>`test/leaf-${i}.test.js`),tests:Array.from({length:12},(_,i)=>({id:`case-${i}`,file:`test/leaf-${i}.test.js`,name:`leaf ${i}`,status:i===0?'failed':'passed'}))});

test('benchmark refuses existing frozen receipts before source reads or workers',t=>{
  const root=fixture(t,{'frozen.json':'immutable original'}),output=path.join(root,'frozen.json');
  let calls=0;
  assert.throws(()=>runPlanningProof({baseline:path.join(root,'missing-baseline'),output,repetitions:1,spawnWorker:()=>{calls++;}}),{code:'EEXIST'});
  assert.equal(fs.readFileSync(output,'utf8'),'immutable original');assert.equal(calls,0);
});
test('benchmark retains earlier trials, the failed native worker and partial summaries',t=>{
  const root=fixture(t),output=path.join(root,'partial.json');
  const report=runPlanningProof({baseline:repository,output,repetitions:1,spawnWorker:(_command,args)=>{
    const method=args[4],scenario=args[5];
    if(method==='native')return {status:7,signal:null,stderr:'native worker stopped',stdout:'partial native bytes'};
    return {status:0,signal:null,stdout:JSON.stringify({method,elapsedMs:2,normalized:scenario==='traversal'?{digest:'same'}:{complete:true,exitCode:1,files:['test/leaf-0.test.js'],tests:[full().tests[0]]}})};
  }});
  assert.equal(report.complete,false);assert.equal(report.trials.length,5);
  assert.equal(report.trials.at(-1).method,'native');assert.equal(report.trials.at(-1).workerComplete,false);
  assert.equal(report.trials.at(-1).worker.status,7);assert.equal(report.trials.at(-1).worker.stderr,'native worker stopped');
  assert.equal(report.summary.find(row=>row.method==='native').attempts,1);
  assert.equal(report.summary.find(row=>row.method==='native').completedWorkers,0);
  assert.match(report.failure.message,/Worker failed/);
  assert.deepEqual(JSON.parse(fs.readFileSync(output,'utf8')),JSON.parse(JSON.stringify(report)));
});
test('benchmark full oracle rejects missing, duplicate, file-load and wrong failing cases',()=>{
  assert.doesNotThrow(()=>validateNativeFull(full()));
  for(const mutate of [
    value=>value.tests.pop(),
    value=>{value.tests[1].id=value.tests[0].id;},
    value=>{value.tests[0].name='<file-load>';},
    value=>{value.tests[0].status='passed';value.tests[1].status='failed';},
    value=>{value.files[11]='test/unexpected.test.js';}
  ]){const value=full();mutate(value);assert.throws(()=>validateNativeFull(value));}
});
test('benchmark seals failed full oracle evidence rather than discarding completed workers',t=>{
  const root=fixture(t),output=path.join(root,'oracle-failure.json');
  const report=runPlanningProof({baseline:repository,output,repetitions:1,spawnWorker:(_command,args)=>{
    const method=args[4],scenario=args[5],value=full();
    value.tests[0].name='<file-load>';
    const normalized=scenario==='traversal'?{digest:'same'}:method==='full'?value:{complete:true,exitCode:1,files:['test/leaf-0.test.js'],tests:[full().tests[0]]};
    return {status:0,signal:null,stdout:JSON.stringify({method,elapsedMs:2,normalized})};
  }});
  assert.equal(report.complete,false);assert.equal(report.trials.length,6);
  assert.equal(report.trials.at(-1).nativeCaseCount,12);
  assert.ok(report.failure.message.includes('<file-load>'));
  assert.equal(JSON.parse(fs.readFileSync(output,'utf8')).complete,false);
});
