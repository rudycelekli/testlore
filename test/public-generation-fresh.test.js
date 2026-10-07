import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {freshProfiles,adaptOracle,preparePublicGeneration} from '../scripts/public-generation-dataset.js';
import {validateDataset} from '../scripts/learning-evaluation.js';
import {verifyDatasetCommitment} from '../scripts/evaluation-commitment.js';

const directory=new URL('../benchmarks/public-generation/fresh-maintainer-contracts-v1/',import.meta.url);
const read=name=>JSON.parse(fs.readFileSync(new URL(name,directory),'utf8'));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
test('fresh public cohort binds four disjoint units and unchanged maintainer assertion bodies',()=>{
 const dataset=validateDataset(read('dataset.json')),provenance=read('provenance.json');
 assert.equal(verifyDatasetCommitment(dataset,read('commitment.json')).verified,true);
 assert.equal(dataset.fixtures.length,4);assert.equal(provenance.bindings.length,20);
 const previous=JSON.parse(fs.readFileSync(new URL('../benchmarks/public-generation/maintainer-contracts-v1/dataset.json',import.meta.url),'utf8'));
 const previousIds=new Set(previous.fixtures.map(f=>f.specificationId));
 const previousSources=new Set(previous.fixtures.flatMap(f=>f.files.map(file=>hash(file.content))));
 for(const fixture of dataset.fixtures){assert.equal(previousIds.has(fixture.specificationId),false);for(const file of fixture.files)assert.equal(previousSources.has(hash(file.content)),false);}
 for(const binding of provenance.bindings){
  const profile=freshProfiles.find(profile=>profile.repo===binding.repo);
  const bytes=fs.readFileSync(new URL(`upstream/${profile.id}/${binding.revision}/${binding.path}`,directory));
  assert.equal(hash(bytes),binding.sha256);assert.equal(bytes.length,binding.bytes);
  assert.equal(createHash('sha1').update(Buffer.from(`blob ${bytes.length}\0`)).update(bytes).digest('hex'),binding.gitBlob);
 }
 for(const profile of freshProfiles){
  const original=fs.readFileSync(new URL(`upstream/${profile.id}/${profile.oracle}/${profile.test}`,directory),'utf8');
  const oracle=adaptOracle(profile,original);
  assert.equal(dataset.fixtures.find(f=>f.id===profile.id).referenceTests[0].content,oracle.content);
  assert.equal(provenance.profiles.find(p=>p.id===profile.id).adaptation.bodyHash,oracle.bodyHash);
  assert.throws(()=>adaptOracle(profile,'// changed import\n'+original),/prefix changed/);
 }
 const budget=read('budget.json');assert.equal(budget.maxCalls,48);assert.equal(budget.retries,0);assert.equal(budget.promotionAuthorized,false);
});

test('four maintainer oracles pass unchanged sources and retain historical parent faults twice',t=>{
 const base=fs.mkdtempSync(path.join(os.tmpdir(),'testlore-fresh-maintainer-'));t.after(()=>fs.rmSync(base,{recursive:true,force:true}));
 const env={...process.env};delete env.NODE_TEST_CONTEXT;
 for(const fixture of read('dataset.json').fixtures){
  const root=path.join(base,fixture.id);fs.mkdirSync(root);fs.writeFileSync(path.join(root,'package.json'),JSON.stringify({type:'module'}));
  for(const file of [...fixture.files,...fixture.referenceTests]){fs.mkdirSync(path.dirname(path.join(root,file.path)),{recursive:true});fs.writeFileSync(path.join(root,file.path),file.content);}
  const run=()=>spawnSync(process.execPath,['--test','--test-reporter=tap',fixture.referenceTests[0].path],{cwd:root,env,encoding:'utf8',timeout:10000,maxBuffer:1024*1024});
  const fixed=[run(),run()];
  for(const result of fixed){assert.equal(result.status,0,fixture.id+'\n'+result.stdout+result.stderr);assert.match(result.stdout,/# fail 0/);}
  for(const file of fixture.defects[0].files)fs.writeFileSync(path.join(root,file.path),file.content);
  const faults=[run(),run()];
  for(const result of faults){assert.equal(result.status,1,fixture.id+'\n'+result.stdout+result.stderr);assert.match(result.stdout,/ERR_ASSERTION/);assert.doesNotMatch(result.stdout,/Cannot find module|SyntaxError: Unexpected/);}
  const failures=result=>[...result.stdout.matchAll(/^\s*not ok \d+ - (.+)$/gm)].map(match=>match[1]);
  assert.deepEqual(failures(faults[0]),failures(faults[1]));
 }
});

test('unknown cohort cannot create an output or fetch source',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'testlore-cohort-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const output=path.join(root,'attempt');let calls=0;
 await assert.rejects(preparePublicGeneration({output,cohort:'invented',read:()=>{calls++;}}),/Unknown frozen public cohort/);
 assert.equal(calls,0);assert.equal(fs.existsSync(output),false);
});
