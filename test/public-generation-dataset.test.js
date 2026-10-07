import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {profiles,adaptOracle,preparePublicGeneration} from '../scripts/public-generation-dataset.js';
import {validateDataset} from '../scripts/learning-evaluation.js';
import {verifyDatasetCommitment} from '../scripts/evaluation-commitment.js';
const directory=new URL('../benchmarks/public-generation/maintainer-contracts-v1/',import.meta.url);
const read=name=>JSON.parse(fs.readFileSync(new URL(name,directory),'utf8'));
const sha=text=>createHash('sha256').update(text).digest('hex');
test('public dataset binds unchanged maintainer bodies, fixed/parent bytes and licenses',()=>{
 const dataset=validateDataset(read('dataset.json')),commitment=verifyDatasetCommitment(dataset,read('commitment.json')),provenance=read('provenance.json');
 assert.equal(commitment.provenance.independentlyMaintained,true);
 assert.equal(provenance.bindings.length,10);
 for(const binding of provenance.bindings){const bytes=fs.readFileSync(new URL(`upstream/${profiles.find(p=>p.repo===binding.repo).id}/${binding.revision}/${binding.path}`,directory));assert.equal(sha(bytes),binding.sha256);assert.equal(bytes.length,binding.bytes);}
 for(const profile of profiles){const original=fs.readFileSync(new URL(`upstream/${profile.id}/${profile.oracle}/${profile.test}`,directory),'utf8');const adaptation=adaptOracle(profile,original);assert.equal(dataset.fixtures.find(f=>f.id===profile.id).referenceTests[0].content,adaptation.content);assert.equal(provenance.profiles.find(p=>p.id===profile.id).adaptation.bodyHash,adaptation.bodyHash);assert.throws(()=>adaptOracle(profile,'// changed import\n'+original),/prefix changed/);}
 const tampered=structuredClone(dataset);tampered.fixtures[0].referenceTests[0].content+='\n// altered';assert.throws(()=>verifyDatasetCommitment(tampered,commitment),/mismatch/);
});
test('independent maintainer assertions pass fixed sources and catch both genuine parents',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'testlore-public-generation-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 fs.writeFileSync(path.join(root,'package.json'),JSON.stringify({type:'module'}));
 for(const fixture of read('dataset.json').fixtures){
  for(const file of [...fixture.files,...fixture.referenceTests]){fs.mkdirSync(path.dirname(path.join(root,file.path)),{recursive:true});fs.writeFileSync(path.join(root,file.path),file.content);}
  const env={...process.env};delete env.NODE_TEST_CONTEXT;
  const run=()=>spawnSync(process.execPath,['--test','--test-reporter=tap',fixture.referenceTests[0].path],{cwd:root,env,encoding:'utf8',timeout:10000});
  const baseline=run();assert.equal(baseline.status,0,baseline.stdout+baseline.stderr);assert.match(baseline.stdout,/# fail 0/);
  for(const file of fixture.defects[0].files)fs.writeFileSync(path.join(root,file.path),file.content);
  const fault=run();assert.equal(fault.status,1,fault.stdout+fault.stderr);assert.match(fault.stdout,/ERR_ASSERTION|Invalid regular expression/);assert.doesNotMatch(fault.stdout,/Cannot find module|SyntaxError: Unexpected/);
 }
});
test('source fetch rejects dishonest blobs and preserves an incomplete preparation receipt',async t=>{
 const base=fs.mkdtempSync(path.join(os.tmpdir(),'testlore-public-source-'));t.after(()=>fs.rmSync(base,{recursive:true,force:true}));const output=path.join(base,'attempt');
 await assert.rejects(preparePublicGeneration({output,read:endpoint=>endpoint.includes('/commits/')?{sha:profiles[0].fixed,parents:[{sha:profiles[0].parent}]}:{type:'file',encoding:'base64',size:1,sha:'0'.repeat(40),content:Buffer.from('x').toString('base64')}}),/blob bytes/);
 assert.equal(JSON.parse(fs.readFileSync(path.join(output,'preparation-failure.json'))).complete,false);
 await assert.rejects(preparePublicGeneration({output}),/output exists/);
});
