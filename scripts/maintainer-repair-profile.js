// Qualification-only, locally frozen maintainer contract. No fetch or provider.
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readBoundedText,safeHostEnvironment} from './host-qualification.js';
import {readBoundedJson,verifyDatasetCommitment} from './evaluation-commitment.js';

const hash=value=>createHash('sha256').update(value).digest('hex');
const directory=new URL('../benchmarks/public-generation/fresh-maintainer-contracts-v1/',import.meta.url);
const fixedRevision='ed0eaa4dec17597f0dae892a0472a9b7f459320d',parentRevision='2dfb684306b6f3b8b374478c86e63f8bab4a7f06';
const pinned=[
  [fixedRevision,'index.js','748c681ba64081193dc5fbb27f8b3539c09ba08f4e31ec6d588e2ae8c39234a8'],
  [parentRevision,'index.js','1bcef4c606ce23b0a7334bb7e01bec64266b7947c0a9c6acd715d94865c3a25d'],
  [fixedRevision,'test.js','0fce78dda44690c59ba7b397dea9683242d5ce7a1cf7c260a1d92cc4a4dd2b34'],
  [fixedRevision,'readme.md','2831cabb33577b1054b575c0b7cca7b4f446510d59cab316414122e43234410f'],
  [fixedRevision,'LICENSE','44191656d296391e0ec97e32f5385f0d02b6f2992694082d22ea04ba0f66f9e4']
];
export function maintainerRepairProfile(){
  const dataset=readBoundedJson(new URL('dataset.json',directory)),commitment=readBoundedJson(new URL('commitment.json',directory));
  verifyDatasetCommitment(dataset,commitment);
  if(commitment.datasetHash!=='78d7e6127d15873b351f6c5128e951a39bd14a167fc2c9b8d9d1a5d354fedc0f')throw new Error('Frozen maintainer dataset changed');
  const provenance=readBoundedJson(new URL('provenance.json',directory)),bindings=[];
  for(const [revision,file,sha256]of pinned){
    const bytes=Buffer.from(readBoundedText(new URL(`upstream/promise/${revision}/${file}`,directory),16384));
    const binding=provenance.bindings.find(row=>row.repo==='then/is-promise'&&row.revision===revision&&row.path===file);
    const blob=createHash('sha1').update(Buffer.from(`blob ${bytes.length}\0`)).update(bytes).digest('hex');
    if(hash(bytes)!==sha256||binding?.sha256!==sha256||binding.bytes!==bytes.length||binding.gitBlob!==blob)throw new Error('Frozen maintainer source binding changed');
    bindings.push({...binding});
  }
  const fixture=dataset.fixtures.find(row=>row.id==='promise'),fixed=fixture?.files?.[0],fault=fixture?.defects?.[0]?.files?.[0],oracle=fixture?.referenceTests?.[0];
  if(fixture?.files?.length!==1||fixture.defects.length!==1||fixture.defects[0].files.length!==1||fixture.referenceTests.length!==1||fixed.path!=='src/promise.cjs'||fault.path!==fixed.path||oracle.path!=='test/promise.test.cjs'
    ||hash(fixed.content)!==pinned[0][2]||hash(fault.content)!==pinned[1][2]||hash(oracle.content)!=='16c34847cebbc85ed84ed991a7608da6b0bd2697514f3a5003e58e7973108dbf')throw new Error('Frozen maintainer repair contract changed');
  const original=readBoundedText(new URL(`upstream/promise/${fixedRevision}/test.js`,directory),16384);
  const prefix="var isPromise = require('./');\nvar assert = require('better-assert');\n",adapted="const {describe,it}=require('node:test');\nvar isPromise=require('../src/promise.cjs');\nvar assert=require('node:assert/strict').ok;\n";
  if(!original.startsWith(prefix)||oracle.content!==adapted+original.slice(prefix.length))throw new Error('Maintainer assertion bodies changed');
  return {name:'maintainer-is-promise',target:fixed.path,files:[oracle.path],count:8,failedCount:2,maxSourceBytes:1024,fixed:fixed.content,fault:fault.content,
    caseNames:['a promise','null','undefined','a number','a string','a bool','an object','an array'].map((name,index)=>`calling isPromise > with ${name} > returns ${index===0?'true':'false'}`),
    oracle:oracle.content,requirements:fixture.requirements,original,
    readme:readBoundedText(new URL(`upstream/promise/${fixedRevision}/readme.md`,directory),16384),license:readBoundedText(new URL(`upstream/promise/${fixedRevision}/LICENSE`,directory),16384),
    provenance:{repository:'https://github.com/then/is-promise',fixed:fixedRevision,parent:parentRevision,oracle:fixedRevision,datasetHash:commitment.datasetHash,bindings,
      adaptation:'Only imports/framework entry points change; original maintainer assertion bodies remain byte-identical. Not a full upstream Mocha/better-assert qualification.'},
    limitation:'One genuine historical null/undefined boolean predicate defect, with eight unchanged maintainer assertion bodies on a Node import shim. No general application repair, upstream Mocha environment, or deployment safety claim.'};
}
export function repairProfile(name='synthetic'){
  if(name==='maintainer-is-promise')return maintainerRepairProfile();
  if(name!=='synthetic')throw new Error('Unknown named repair qualification profile');
  return {name,target:'src/value.js',files:['test/fault.test.js','test/preserved.test.js'],count:2,failedCount:1,maxSourceBytes:128,
    fault:'export const value=9;\n',fixed:'export const value=1;\n',caseNames:['independent value remains one','preserved value remains two'],
    limitation:'One bounded constant repair in a disposable synthetic fixture. Independent fixed tests and semantics are preserved; no general repair or deployment claim.'};
}
export function authorizedRepairSource(profile,source){
  if(typeof source!=='string'||Buffer.byteLength(source)>profile.maxSourceBytes)return false;
  return profile.name==='synthetic'?/^export\s+const\s+value\s*=\s*1\s*;\s*$/.test(source):hash(source)===hash(profile.fixed);
}
export function maintainerFixtureContents(profile=maintainerRepairProfile()){
  if(profile.name!=='maintainer-is-promise')throw new Error('Named maintainer fixture required');
  return {'package.json':JSON.stringify({type:'module'}),'.gitignore':'.tddswarm/\n','tddswarm.config.json':JSON.stringify({adapter:'node',executionMode:'shadow'}),
    'tddswarm.requirements.md':profile.requirements,'README.maintainer.md':profile.readme,'LICENSE.maintainer':profile.license,'provenance/original-test.txt':profile.original,
    'maintainer-provenance.json':JSON.stringify(profile.provenance),[profile.target]:profile.fixed,[profile.files[0]]:profile.oracle};
}
export function createMaintainerRepairFixture(root){
  const profile=maintainerRepairProfile();fs.mkdirSync(root,{recursive:true});
  const files=maintainerFixtureContents(profile);
  for(const [file,content]of Object.entries(files)){const target=path.join(root,file);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,content);}
  for(const args of [['init','-b','main'],['config','user.name','Maintainer Repair Qualification'],['config','user.email','fixture@example.invalid'],['add','.'],['commit','-m','unchanged independent maintainer baseline']]){
    const result=spawnSync('git',args,{cwd:root,env:safeHostEnvironment(process.env),encoding:'utf8',timeout:10000});if(result.status!==0)throw new Error(`Fixture Git operation failed: ${result.stderr}`);
  }
  fs.writeFileSync(path.join(root,profile.target),profile.fault);return profile;
}
