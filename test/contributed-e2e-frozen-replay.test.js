import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {fixture} from './helpers.js';
import {readContributedE2EFrozen,replayContributedE2EOutcomes} from '../scripts/contributed-e2e-frozen-replay.js';
const directory=fileURLToPath(new URL('../benchmarks/contributed-e2e/observed-20261009/',import.meta.url));
const original=readContributedE2EFrozen(directory);
function changed(mutator){const packet={...original,files:{...original.files}};const edit=(name,change)=>{const item=JSON.parse(packet.files[name].text);change(item);packet.files[name]={...packet.files[name],text:JSON.stringify(item)};};mutator(edit);return packet;}
function modifyTrial(edit,change,arm,mutator){
 const name=`trial-${change}-0.json`,raw=arm==='testLore'?`change-${change}-trial-0-testLore.stdout`:`change-${change}-trial-0-${arm}.json`;
 edit(name,trial=>mutator(trial[arm]));edit(raw,mutator);
}
test('original complete negative e2e observation replays without inventing identities or speed',()=>{
 const result=replayContributedE2EOutcomes(original);assert.equal(result.observationCompleted,true);assert.equal(result.qualified,false);assert.equal(result.caseIdentitiesComplete,false);assert.equal(result.rows.length,6);assert.ok(result.rows.every(row=>row.omittedFiles===0));assert.equal(result.ambiguousNames[0].multiplicity,2);assert.equal(result.avoidedPairCallsTotal,0);assert.equal(result.completeProcessMedians.testLoreMs,27440.5);assert.equal(result.claims.independentTestAuthorship,false);
});
test('raw native counts cannot certify fabricated failures',()=>{
 const packet=changed(edit=>modifyTrial(edit,1,'full',report=>{report.numFailedTests=999;}));assert.throws(()=>replayContributedE2EOutcomes(packet),/counts/);
});
test('a runtime exception under the oracle title cannot replace the observed assertion bug',()=>{
 const packet=changed(edit=>modifyTrial(edit,1,'full',report=>{report.testResults.flatMap(suite=>suite.assertionResults).find(item=>item.status==='failed').failureMessages=['TypeError: infrastructure failed'];}));assert.throws(()=>replayContributedE2EOutcomes(packet),/assertion evidence/);
});
test('a TestLore missed raw oracle failure cannot be concealed by matching embedded receipts',()=>{
 const packet=changed(edit=>modifyTrial(edit,1,'testLore',report=>{report.tests.find(item=>item.status==='failed').status='passed';}));assert.throws(()=>replayContributedE2EOutcomes(packet),/lost raw named outcomes/);
});
test('a fabricated positive producer assessment never promotes ambiguous original raw cases',()=>{
 const packet=changed(edit=>edit('assessment.json',report=>{report.qualified=true;}));assert.throws(()=>replayContributedE2EOutcomes(packet),/rejected qualification/);
});
test('protected oracle drift and remote source misbinding remain rejected',()=>{
 const packet=changed(edit=>modifyTrial(edit,0,'testLore',report=>{report.provenance.files['tests/unit/globs.test.ts']='0'.repeat(64);}));assert.throws(()=>replayContributedE2EOutcomes(packet),/Protected in-scope bytes/);
 const other=changed(edit=>edit('candidate-install-binding.json',report=>{report.revision='0'.repeat(40);}));assert.throws(()=>replayContributedE2EOutcomes(other),/input bindings/);
});
test('interrupted actual processes and invented avoided resolver calls cannot qualify',()=>{
 const interrupted=changed(edit=>edit('trial-1-0.json',report=>{report.testLoreEvent.signal='SIGKILL';}));assert.throws(()=>replayContributedE2EOutcomes(interrupted),/process event/);
 const cached=changed(edit=>modifyTrial(edit,0,'testLore',report=>{report.unifiedNative.resolutionDiagnostics.avoidedPairCalls=1;}));assert.throws(()=>replayContributedE2EOutcomes(cached),/diagnostic evidence/);
});
test('frozen compression anchors reject modified bytes before any report interpretation',t=>{
 const root=fixture(t),integrity=fs.readFileSync(path.join(directory,'original-outcomes.integrity.json'));
 fs.writeFileSync(path.join(root,'original-outcomes.integrity.json'),integrity);
 const bytes=fs.readFileSync(path.join(directory,'original-outcomes.json.gz'));bytes[bytes.length-1]^=1;fs.writeFileSync(path.join(root,'original-outcomes.json.gz'),bytes);
 assert.throws(()=>readContributedE2EFrozen(root),/compressed bytes changed/);
 const replaced=JSON.parse(integrity);replaced.file='../outside.gz';fs.writeFileSync(path.join(root,'original-outcomes.integrity.json'),JSON.stringify(replaced));assert.throws(()=>readContributedE2EFrozen(root),/integrity anchor/);
});
