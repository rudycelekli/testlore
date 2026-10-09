import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {installedRepairEvidenceComplete,verifyInstalledRepairRawEvidence} from '../scripts/installed-repair-proof.js';

const run=failed=>({complete:true,exitCode:failed?1:0,files:['test/a.test.js','test/b.test.js'],cases:[{file:'test/a.test.js',name:'independent required a value',status:failed?'failed':'passed'},{file:'test/b.test.js',name:'unchanged required b value',status:'passed'}]});
const receipt={qualified:true,mode:'installed-cli-deterministic-worker',productionInstalled:true,realModelProvider:false,liveGitHub:false,modelCost:null,status:'ready-for-review',published:false,merged:false,omitted:0,originalCallerUnchanged:true,originalAssertionsUnchanged:true,exactCommitVerified:true,sourceHead:'a'.repeat(40),sha:'b'.repeat(40),branch:'tddswarm/repair-proof',installedManifestSha256:'a'.repeat(64),archiveSha256:'b'.repeat(64),proofScriptSha256:'c'.repeat(64),workers:{completedCalls:3,executionValidated:false},baseline:[run(true),run(true)],candidateRuns:[run(false),run(false)],assertionRuns:2,finalRun:run(false),wrongSource:{rejected:true,sha:null,published:false},oracleEdit:{rejected:true,sha:null,published:false}};
receipt.rawEvidence=['oracle-edit.json','oracle-edit.requests.jsonl','successful.json','successful.requests.jsonl','wrong-source.json','wrong-source.requests.jsonl'].map(file=>({file,bytes:3,sha256:createHash('sha256').update('{}\n').digest('hex')}));

test('installed repair verifier distinguishes deterministic transport from live provider/PR proof',()=>{
 assert.equal(installedRepairEvidenceComplete(receipt),true);
 for(const field of ['realModelProvider','liveGitHub','published','merged'])assert.equal(installedRepairEvidenceComplete({...receipt,[field]:true}),false,field);
 for(const field of ['qualified','productionInstalled','originalCallerUnchanged','originalAssertionsUnchanged','exactCommitVerified'])for(const value of [undefined,false,'true'])assert.equal(installedRepairEvidenceComplete({...receipt,[field]:value}),false,field);
 for(const value of [null,undefined,{},true])assert.equal(installedRepairEvidenceComplete(value),false);
});

test('installed repair verifier rejects incomplete, renamed, duplicated or omitted original assertions',()=>{
 const corruptions=[{baseline:[]},{baseline:{length:2}},{baseline:[run(true),{...run(true),complete:false}]},{candidateRuns:[run(false),{...run(false),exitCode:1}]},{candidateRuns:[run(false),{...run(false),cases:[run(false).cases[0],run(false).cases[0]]}]},{finalRun:{...run(false),cases:[{...run(false).cases[0],name:'weaker renamed oracle'},run(false).cases[1]]}},{finalRun:{...run(false),cases:[{...run(false).cases[0],status:'skipped'},run(false).cases[1]]}},{finalRun:{...run(false),files:['test/a.test.js']}},{assertionRuns:1},{omitted:1},{sha:receipt.sourceHead},{workers:{completedCalls:2,executionValidated:false}},{wrongSource:{rejected:true,sha:'b'.repeat(40),published:false}},{oracleEdit:{rejected:false,sha:null,published:false}}];
 for(const change of corruptions)assert.equal(installedRepairEvidenceComplete({...receipt,...change}),false);
});

test('installed repair evidence must retain exact bounded raw receipts, not altered or linked files',()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'installed-repair-raw-'));
 try{
  for(const item of receipt.rawEvidence)fs.writeFileSync(path.join(directory,item.file),'{}\n');
  assert.equal(verifyInstalledRepairRawEvidence(directory,receipt),true);
  fs.writeFileSync(path.join(directory,'successful.json'),'[]\n');assert.throws(()=>verifyInstalledRepairRawEvidence(directory,receipt),/raw evidence changed/);
  fs.unlinkSync(path.join(directory,'successful.json'));fs.symlinkSync(path.join(directory,'wrong-source.json'),path.join(directory,'successful.json'));assert.throws(()=>verifyInstalledRepairRawEvidence(directory,receipt));
  assert.equal(installedRepairEvidenceComplete({...receipt,rawEvidence:[]}),false);
 }finally{fs.rmSync(directory,{recursive:true,force:true});}
});
