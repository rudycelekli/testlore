import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {assessContributedE2E,declaredPnpmExecutable} from '../scripts/contributed-e2e-pilot.js';
const root='/upstream/packages/e2e',oracle='tests/unit/globs.test.ts',other='tests/unit/regexp.test.ts';
const name='glob grammar ? matches exactly one non-/ character';
const raw=(failed=false,files=[oracle,other])=>({success:!failed,numTotalTests:files.length,numPassedTests:files.length-(failed?1:0),numFailedTests:failed?1:0,numPendingTests:0,numRuntimeErrorTestSuites:0,testResults:files.map(file=>({name:root+'/'+file,status:failed&&file===oracle?'failed':'passed',assertionResults:[{fullName:file===oracle?name:'regexp escapes literal symbols',status:failed&&file===oracle?'failed':'passed'}]}))});
const event=failed=>({exitCode:failed?1:0,signal:null,stoppedReason:null,durationMs:20});
function fixture(){
 const trials=[];for(let change=0;change<2;change++)for(let repetition=0;repetition<3;repetition++){
  const failed=change===1,full=raw(failed),files=[oracle],testLore={complete:true,executed:true,exitCode:failed?1:0,executedTests:files,collectionFiles:files,tests:[{file:oracle,name,status:failed?'failed':'passed'}],plan:{selected:files,total:2,mode:'affected',decisions:[{test:other,selected:false,reasons:['no-known-dependency-on-change']}]}};
  trials.push({change,repetition,full,native:raw(failed,files),testLore,fullEvent:event(failed),nativeEvent:event(failed),testLoreEvent:{...event(failed),durationMs:30}});
 }
 return {baseline:raw(),trials};
}
const assess=x=>assessContributedE2E(x.baseline,x.trials,root,{protectedInputsUnchanged:true,restoredGreen:true});
test('qualifies genuine exact case preservation while retaining a native performance loss',()=>{const result=assess(fixture());assert.equal(result.qualified,true);assert.equal(result.observationCompleted,true);assert.equal(result.rows[0].omittedFiles,1);assert.equal(result.speedAdvantageObserved,false);assert.equal(result.claims.independentTestAuthorship,false);});
test('aggregate claims cannot hide a missed actual Unicode failure',()=>{const x=fixture();x.trials[3].testLore.tests[0].status='passed';x.trials[3].testLore.exitCode=0;x.trials[3].testLoreEvent.exitCode=0;assert.equal(assess(x).qualified,false);});
test('a source reversion requires the exact upstream Unicode assertion failure',()=>{const x=fixture();for(const trial of x.trials.filter(t=>t.change===1)){trial.full.testResults[0].assertionResults[0].fullName='unrelated failure';}assert.equal(assess(x).qualified,false);});
test('equal counts cannot substitute, rename or duplicate named cases',()=>{for(const mutate of [x=>x.trials[0].testLore.tests[0].name='substitute',x=>x.baseline.testResults[0].assertionResults.push(x.baseline.testResults[0].assertionResults[0]),x=>x.trials[0].native.testResults[0].name=root+'/../escape.test.ts']){const x=fixture();mutate(x);assert.equal(assess(x).qualified,false);}});
test('retains upstream skips and rejects interrupted processes despite positive aggregates',()=>{const x=fixture();x.trials[0].testLoreEvent.signal='SIGKILL';const result=assess(x);assert.equal(result.qualified,false);assert.equal(result.observationCompleted,false);});
test('every omission needs a source file explanation and all six repetitions must exist',()=>{const x=fixture();x.trials[0].testLore.plan.decisions=[];assert.equal(assess(x).qualified,false);x.trials.pop();assert.equal(assess(x).observationCompleted,false);});
test('changed protected sources and failed restoration cannot qualify',()=>{for(const opts of [{protectedInputsUnchanged:false,restoredGreen:true},{protectedInputsUnchanged:true,restoredGreen:false}]){const x=fixture();assert.equal(assessContributedE2E(x.baseline,x.trials,root,opts).qualified,false);}});
test('file load failures cannot be misrepresented as an independently detected assertion bug',()=>{const x=fixture();x.trials[3].full.testResults[0].assertionResults[0].status='passed';assert.equal(assess(x).observationCompleted,false);});
test('contradictory exit metadata and native count tampering cannot qualify',()=>{
 const x=fixture();x.trials[3].testLore.exitCode=0;assert.equal(assess(x).qualified,false);
 const y=fixture();y.trials[0].native.numTotalTests=999;assert.equal(assess(y).observationCompleted,false);
});
test('native selection misses remain measured while preserved TestLore failures can qualify',()=>{
 const x=fixture();for(const trial of x.trials.filter(row=>row.change===1)){trial.native=raw(false,[]);trial.nativeEvent=event(false);}
 const result=assess(x);assert.equal(result.qualified,true);assert.equal(result.rows[3].nativeMissedFailures,1);assert.equal(result.rows[3].missedFailures,0);
});

test('pnpm executable follows exact installed metadata instead of guessed v11 layout',()=>{
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'testlore-pnpm-bin-')));
 try{
  const manifest={name:'pnpm',version:'12.3.4',bin:{pnpm:'pnpm'}};
  fs.writeFileSync(path.join(root,'package.json'),JSON.stringify(manifest));fs.writeFileSync(path.join(root,'pnpm'),'#!/bin/sh\nexit 0\n',{mode:0o755});
  const result=declaredPnpmExecutable(root);assert.equal(result.executable,path.join(root,'pnpm'));assert.equal(result.entry,'pnpm');assert.match(result.executableSha256,/^[a-f0-9]{64}$/);
  for(const bin of ['../outside','/absolute','missing']){fs.writeFileSync(path.join(root,'package.json'),JSON.stringify({...manifest,bin:{pnpm:bin}}));assert.throws(()=>declaredPnpmExecutable(root));}
  fs.writeFileSync(path.join(root,'package.json'),JSON.stringify({...manifest,version:'11.0.0'}));assert.throws(()=>declaredPnpmExecutable(root));
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
