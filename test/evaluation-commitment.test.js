import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fixture} from './helpers.js';
import {defaultDataset,evaluateLearning,validateDataset,stableOutcomes} from '../scripts/learning-evaluation.js';
import {commitDataset,verifyDatasetCommitment,main} from '../scripts/evaluation-commitment.js';
import {prospectiveContracts} from '../scripts/prospective-contracts.js';
import {execute} from '../src/execution.js';
const provenance={owner:'Explicit fixture owner',source:'local prospectively supplied dataset',independentlyMaintained:false,independenceNotes:'Hash binding cannot establish independent authorship or secrecy.'};
test('prospective commitments bind specifications, references, faults and declared ownership without authenticating them',async t=>{
  const dataset=defaultDataset(),commitment=commitDataset(dataset,provenance),verified=verifyDatasetCommitment(dataset,commitment);
  assert.equal(verified.verified,true);assert.equal(verified.authorshipVerified,false);assert.equal(verified.independenceVerified,false);assert.equal(verified.externallyAnchored,false);
  for(const mutate of [d=>d.fixtures[0].requirements+=' altered',d=>d.fixtures[0].referenceTests[0].content+=' altered',d=>d.fixtures[0].defects[0].files[0].content+=' altered']){const changed=structuredClone(dataset);mutate(changed);assert.throws(()=>verifyDatasetCommitment(changed,commitment),/mismatch/);}
  const root=fixture(t,{}),output=path.join(root,'should-not-create'),marker=path.join(root,'worker-called');
  const changed=structuredClone(dataset);changed.fixtures[0].requirements+=' changed';await assert.rejects(evaluateLearning({output,agent:[process.execPath,'-e',`require('node:fs').writeFileSync(${JSON.stringify(marker)},'bad')`],identity:'fixture',dataset:changed,commitment}),/mismatch/);assert.equal(fs.existsSync(marker),false);assert.equal(fs.existsSync(output),false);
  fs.writeFileSync(path.join(root,'dataset.json'),JSON.stringify(dataset));fs.writeFileSync(path.join(root,'provenance.json'),JSON.stringify(provenance));const args=['--dataset',path.join(root,'dataset.json'),'--provenance',path.join(root,'provenance.json'),'--output',path.join(root,'commitment.json')];await main(args);await assert.rejects(main(args),/exist/i);
});
test('new prospectively authored nontrivial contracts demonstrate every reference fault repeatedly',t=>{
  const dataset=validateDataset(prospectiveContracts());assert.equal(dataset.fixtures.length,2);assert.equal(dataset.fixtures.reduce((n,f)=>n+f.defects.length,0),6);
  for(const contract of dataset.fixtures){const root=fixture(t,{'package.json':{type:'module'}});const write=files=>{for(const file of files){const output=path.join(root,file.path);fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,file.content);}};write(contract.files);write(contract.referenceTests);
    const collect=()=>execute(root,contract.referenceTests.map(file=>file.path),{adapter:'node',runner:[process.execPath,'--test','{files}']},{capture:true,timeoutMs:10000});
    const baselines=[collect(),collect()];assert.ok(stableOutcomes(baselines));assert.ok(baselines.every(run=>run.exitCode===0&&run.tests.every(test=>test.status==='passed')));
    for(const fault of contract.defects){write(fault.files);const outcomes=[collect(),collect()];assert.ok(stableOutcomes(outcomes),fault.id);assert.ok(outcomes.every(run=>run.exitCode===1&&run.tests.some(test=>test.name!=='<file-load>'&&test.status==='failed')),fault.id);write(contract.files);}
  }
});
