import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {assessReaPilot,assessNodeOracle,preservePilotReceipts,REA_REVISION} from '../scripts/rea-public-pilot.js';

// Synthetic assessor controls only; public qualification comes from native runs.
function fixture(){
 const report={valid:true,repetitions:3,projects:[{revision:REA_REVISION,sourceCheckoutUnchanged:true,changes:[]}]};
 const raw=[],baseline={success:true,numPassedTests:1,numFailedTests:0,testResults:[{name:'case.test.ts',assertionResults:[{fullName:'retained-case',status:'passed'},{fullName:'skip-case',status:'pending'}]}]};
 for(let c=0;c<2;c++){
  const change={name:'change-'+c,expectedFailure:c>0,trials:[]};report.projects[0].changes.push(change);
  for(let r=0;r<3;r++){
   const id=name=>createHash('sha256').update('case.test.ts\0'+name+'\0\0\0'+0).digest('hex');
   const tests=[{id:id('retained-case'),file:'case.test.ts',name:'retained-case',status:c?'failed':'passed'},{id:id('skip-case'),file:'case.test.ts',name:'skip-case',status:'skipped'}],execution={complete:true,exitCode:c?1:0,executedFiles:['case.test.ts'],collectionFiles:['case.test.ts'],tests};
   raw.push({change:c,repetition:r,full:structuredClone(execution),subset:structuredClone(execution),native:structuredClone(execution),plan:{total:1,mode:'full',selected:['case.test.ts'],decisions:[{reasons:['dependency-graph-incomplete']}]}});
   change.trials.push({valid:true,stable:true,casePreservation:{complete:true},missedFailures:0,fullFailures:c?1:0,testLoreMs:100,nativeMs:50,fullMs:80,nativeFiles:1,verificationDiscoveryMs:20});
  }
 }
 return {report,baseline,raw};
}
const assess=x=>assessReaPilot(x.report,x.baseline,x.raw);
test('retains losses and fallback without turning qualification into superiority',()=>{
 const result=assess(fixture());assert.equal(result.qualified,true);assert.equal(result.trialCount,6);assert.equal(result.fullFallbackTrials,6);assert.equal(result.omittedFileObservations,0);assert.equal(result.claims.worldClassEstablished,false);assert.equal(result.claims.generalSpeedAdvantageEstablished,false);assert.equal(result.claims.learningImprovementEstablished,false);assert.equal(result.rows[0].testLoreOuterMs,100);
});
test('rejects optimistic aggregate when a raw subset loses an actual failure',()=>{
 const x=fixture();x.raw[3].subset.tests[0].status='passed';const result=assess(x);assert.equal(result.qualified,false);assert.equal(result.missedFailures,1);assert.ok(result.reasons.some(x=>x.startsWith('failure-preservation-mismatch')));
});
test('rejects an alleged historical reversion without independent failing cases',()=>{
 const x=fixture();for(const key of ['full','subset','native'])x.raw[3][key].tests[0].status='passed';x.report.projects[0].changes[1].trials[0].fullFailures=0;assert.ok(assess(x).reasons.some(x=>x.startsWith('independent-defect-not-demonstrated')));
});
test('rejects missing trials and lost original native file scope',()=>{
 const x=fixture();x.raw.pop();x.baseline.testResults.push({name:'other.test.ts',assertionResults:[]});const result=assess(x);assert.equal(result.qualified,false);assert.ok(result.reasons.includes('requested-trials-incomplete'));assert.ok(result.reasons.some(x=>x.startsWith('file-execution-binding-mismatch')));
});
test('rejects red or empty baselines and changed upstream identity',()=>{
 const x=fixture();x.baseline.success=false;x.baseline.numPassedTests=0;x.report.projects[0].sourceCheckoutUnchanged=false;const result=assess(x);assert.equal(result.qualified,false);assert.ok(result.reasons.includes('independent-baseline-not-green'));assert.ok(result.reasons.includes('upstream-source-binding-unverified'));
});
test('rejects incomplete native execution despite a positive aggregate',()=>{
 const x=fixture();x.raw[0].full.complete=false;x.raw[1].native.complete=false;assert.equal(assess(x).qualified,false);
});
test('native missed failures remain explicit rather than counted as safe speed gains',()=>{
 const x=fixture();x.raw[3].native.tests=[];x.raw[3].native.executedFiles=[];x.raw[3].native.collectionFiles=[];x.raw[3].native.exitCode=0;const result=assess(x);assert.equal(result.nativeMissedFailures,1);assert.equal(result.claims.generalSpeedAdvantageEstablished,false);
});

test('rejects equal-count scope substitution',()=>{const x=fixture();x.baseline.testResults[0].name='different.test.ts';assert.equal(assess(x).qualified,false);});
test('rejects lost passing cases independently of aggregate flags',()=>{const x=fixture();x.raw[0].subset.tests.shift();assert.equal(assess(x).qualified,false);});
test('rejects changed skipped outcomes',()=>{const x=fixture();x.raw[0].subset.tests[1].status='passed';assert.equal(assess(x).qualified,false);});
test('rejects native case loss within an executed file',()=>{const x=fixture();x.raw[0].native.tests.shift();assert.equal(assess(x).qualified,false);});
test('rejects out-of-scope native files and fabricated IDs',()=>{const x=fixture();x.raw[0].native.executedFiles=['other.test.ts'];x.raw[1].subset.tests[0].id='forged';assert.equal(assess(x).qualified,false);});
test('rejects execution/collection drift and an unexpected exit status',()=>{const x=fixture();x.raw[0].subset.collectionFiles=[];x.raw[1].full.exitCode=2;assert.equal(assess(x).qualified,false);});
test('retains interrupted nested receipts without copying upstream workspace',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'rea-receipt-test-'));try{
  const source=path.join(root,'source'),out=path.join(root,'out');fs.mkdirSync(path.join(source,'project','workspace'),{recursive:true});
  fs.writeFileSync(path.join(source,'project','request.json'),'{}');fs.writeFileSync(path.join(source,'project','worker.log'),'partial');fs.writeFileSync(path.join(source,'project','workspace','private.json'),'exclude');
  assert.deepEqual(preservePilotReceipts(source,out),['project/request.json','project/worker.log']);assert.equal(fs.existsSync(path.join(out,'project','workspace')),false);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});

function nodeFixture(){
 const names=['import uses main before bundler module','import ignores a module-only entry','require ignores a module-only entry','import preserves a main-only entry'].map(x=>'matches the native Node loader when '+x);
 return Array.from({length:5},(_,i)=>({label:'run-'+i,event:{exitCode:i===0||i===4?0:1},result:{numPassedTests:i===0||i===4?4:1,numPendingTests:0,testResults:[{name:'oracle.test.ts',assertionResults:names.map((fullName,n)=>({fullName,status:i>0&&i<4&&n<3?'failed':'passed'}))}]}}));
}
test('separate native oracle requires the exact independent Node failures and restored statuses',()=>{
 const runs=nodeFixture();assert.equal(assessNodeOracle(runs,'/',true).qualified,true);
 runs[4].result.testResults[0].assertionResults[0].status='pending';assert.equal(assessNodeOracle(runs,'/',true).qualified,false);
});
test('rejects unrelated Node failure, interrupted outcome and modified upstream tests',()=>{
 const runs=nodeFixture();runs[1].result.testResults[0].assertionResults[3].status='failed';assert.equal(assessNodeOracle(runs,'/',true).qualified,false);
 assert.equal(assessNodeOracle(nodeFixture(),'/',false).qualified,false);
 const killed=nodeFixture();killed[2].event.stoppedReason='deadline';assert.equal(assessNodeOracle(killed,'/',true).qualified,false);
});
test('named assertion failure requires exit1 rather than arbitrary native errors',()=>{const x=fixture();x.raw[3].subset.exitCode=2;assert.equal(assess(x).qualified,false);});

test('rejects new skips across every arm and preserves independent baseline skips',()=>{
 const x=fixture();for(const arm of ['full','subset','native'])x.raw[0][arm].tests[0].status='skipped';assert.equal(assess(x).qualified,false);
 const y=fixture();for(const arm of ['full','subset','native'])y.raw[3][arm].tests[1].status='passed';assert.equal(assess(y).qualified,false);
});

test('complete negative measurements remain rejected qualifications',()=>{
 const x=fixture();for(const arm of ['full','subset']){
  x.raw[0][arm].tests[0].name='different parameter';x.raw[0][arm].tests[0].id=createHash('sha256').update(['case.test.ts','different parameter','','','0'].join('\0')).digest('hex');
 }
 const result=assess(x);assert.equal(result.qualified,false);assert.equal(result.observationCompleted,true);assert.equal(result.claims.worldClassEstablished,false);
});
test('incomplete observations cannot be published as completed negatives',()=>{
 for(const mutate of [x=>x.raw.pop(),x=>x.raw[0].full.complete=false,x=>x.raw[0].full.tests.pop(),x=>x.raw[0].subset.exitCode=2,x=>x.report.projects[0].changes[0].trials[0].stable=false]){
  const x=fixture();mutate(x);assert.equal(assess(x).observationCompleted,false);
 }
});
