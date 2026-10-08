import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {verifySeededArchive,verifySeededMatrix} from '../scripts/rea-seeded-replay.js';
import {REA_REVISION,REPLAY_SEEDS} from '../scripts/rea-public-pilot.js';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
function fixture(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'seeded-replay-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return root;}
function write(root,seed,{mutateFiles=()=>{},mutateIntegrity=()=>{}}={}){
 const candidate={kind:'explicit-source-candidate-not-registry-release',sha256:'a'.repeat(64),sourceRevision:'b'.repeat(40),version:'0.1.0'};
 const values={
  'preregistered-manifest.json':{projects:[{root:'/experiment/upstream',propertyReplay:{schemaVersion:1,seed}}]},
  'assessment.json':{qualified:false,candidateProvenance:candidate,protectedSourceUnchanged:true},
  'candidate-install-binding.json':candidate,'source-binding.json':{revision:REA_REVISION},
  'pilot-summary.json':{valid:false,projects:[{revision:REA_REVISION,sourceCheckoutUnchanged:true,changes:[]}],repetitions:3},
  'independent-baseline.json':{success:false,numPassedTests:0,numFailedTests:0,testResults:[]},
  'node-oracle-assessment.json':{testsUnchanged:true},
  'execution.json':{events:[{label:'pilot-execution',exitCode:1}]}
 };
 for(const label of ['node-oracle-fixed-baseline','node-oracle-source-reversion-0','node-oracle-source-reversion-1','node-oracle-source-reversion-2','node-oracle-fixed-restored']){
  values[label+'.json']={testResults:[]};values['execution.json'].events.push({label,exitCode:1});
 }
 for(let c=0;c<2;c++)for(let r=0;r<3;r++)for(const arm of ['full','subset','native','plan'])values[`raw-pilot/change-${c}-trial-${r}-${arm}.json`]={};
 mutateFiles(values);
 const files=Object.fromEntries(Object.entries(values).map(([name,value])=>[name,JSON.stringify(value)]));
 const compressed=gzipSync(JSON.stringify({schemaVersion:1,files}));
 const integrity={schemaVersion:1,seed,campaignSourceRevision:candidate.sourceRevision,runId:123,artifactId:seed,archiveBytes:compressed.length,archiveSha256:hash(compressed),members:Object.fromEntries(Object.entries(files).map(([name,bytes])=>[name,hash(bytes)]))};
 mutateIntegrity(integrity);
 fs.writeFileSync(path.join(root,`seed-${seed}.json.gz`),compressed);fs.writeFileSync(path.join(root,`seed-${seed}.integrity.json`),JSON.stringify(integrity));
}
test('intact but incomplete synthetic evidence stays negative and cannot certify a matrix',t=>{
 const root=fixture(t);for(const seed of REPLAY_SEEDS)write(root,seed);
 const result=verifySeededMatrix(root);assert.equal(result.qualified,false);assert.equal(result.completed,false);
 assert.equal(result.results.every(row=>row.originalQualified===false&&row.assessment.qualified===false),true);
 assert.equal(result.claims.exactGeneratedInputsCertified,false);
});
test('rejects archive bytes, member digests and malformed seed provenance',t=>{
 const root=fixture(t),seed=REPLAY_SEEDS[0];
 write(root,seed);fs.appendFileSync(path.join(root,`seed-${seed}.json.gz`),'changed');assert.throws(()=>verifySeededArchive(root,seed),/digest/);
 write(root,seed,{mutateIntegrity:v=>v.members['assessment.json']='c'.repeat(64)});assert.throws(()=>verifySeededArchive(root,seed),/member digest/);
 for(const mutateIntegrity of [v=>v.seed++,v=>v.runId=0,v=>v.artifactId='123',v=>v.campaignSourceRevision='HEAD',v=>v.members['../escape.json']='a'.repeat(64)]){
  write(root,seed,{mutateIntegrity});assert.throws(()=>verifySeededArchive(root,seed),/integrity binding/);
 }
});
test('even recomputed hashes cannot hide inconsistent source/candidate/profile bindings',t=>{
 const root=fixture(t),seed=REPLAY_SEEDS[0];
 for(const mutateFiles of [v=>v['source-binding.json'].revision='c'.repeat(40),v=>v['candidate-install-binding.json']={...v['candidate-install-binding.json'],version:'0.2.0'},v=>v['preregistered-manifest.json'].projects[0].propertyReplay.seed++,v=>v['assessment.json'].candidateProvenance={...v['assessment.json'].candidateProvenance,sha256:'c'.repeat(64)}]){
  write(root,seed,{mutateFiles});assert.throws(()=>verifySeededArchive(root,seed),/source\/profile binding/);
 }
});
test('matrix requires the same run/candidate and distinct retained artifacts',t=>{
 const root=fixture(t);for(const seed of REPLAY_SEEDS)write(root,seed);
 write(root,REPLAY_SEEDS[1],{mutateIntegrity:v=>v.runId=456});assert.throws(()=>verifySeededMatrix(root),/Mixed source\/run/);
 write(root,REPLAY_SEEDS[1],{mutateIntegrity:v=>v.artifactId=REPLAY_SEEDS[0]});assert.throws(()=>verifySeededMatrix(root),/duplicated artifact/);
});
test('rejects oversized regular inputs and symlink archive substitution before loading',t=>{
 const root=fixture(t),seed=REPLAY_SEEDS[0];write(root,seed);
 const archive=path.join(root,`seed-${seed}.json.gz`),real=archive+'.original';fs.renameSync(archive,real);fs.symlinkSync(real,archive);assert.throws(()=>verifySeededArchive(root,seed));
 fs.rmSync(archive);fs.writeFileSync(archive,'');fs.truncateSync(archive,16*1024**2+1);assert.throws(()=>verifySeededArchive(root,seed),/Unbounded/);
});
