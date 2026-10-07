#!/usr/bin/env node
// Explicitly fetched maintainer contracts and historical faults; no provider calls.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {defaultDataset,validateDataset} from './learning-evaluation.js';
import {commitDataset} from './evaluation-commitment.js';

export const profiles=Object.freeze([
 {id:'regexp',repo:'sindresorhus/escape-string-regexp',fixed:'732905da074f0220487ad6a27590f89bd0819374',parent:'5085b257c801507460270b747f645276fbc1d937',oracle:'732905da074f0220487ad6a27590f89bd0819374',test:'test.js',readme:'readme.md',license:'license',specificationId:'maintainer-regexp-unicode-escaping'},
 {id:'html',repo:'component/escape-html',fixed:'725d6a54cde8254e78d11ab138d6acbeecd973b4',parent:'137fd500001809ac0848107a0750648a11949ad5',oracle:'7a0e1a7139d03f5efca21322d58dfdbfb317f1dc',test:'test/index.js',readme:'README.md',license:'LICENSE',specificationId:'maintainer-html-text-escaping'}
]);
// Separate prospective cohort: none of these units appeared in the first live assay.
export const freshProfiles=Object.freeze([
 {id:'milliseconds',repo:'vercel/ms',fixed:'2669f23e99be0bb6b65d365151884de52434301c',parent:'fe0bae301a6c41f68a01595658a4f4f0dcba0e84',oracle:'2669f23e99be0bb6b65d365151884de52434301c',test:'tests.js',readme:'readme.md',license:'license.md',specificationId:'maintainer-time-conversion'},
 {id:'promise',repo:'then/is-promise',fixed:'ed0eaa4dec17597f0dae892a0472a9b7f459320d',parent:'2dfb684306b6f3b8b374478c86e63f8bab4a7f06',oracle:'ed0eaa4dec17597f0dae892a0472a9b7f459320d',test:'test.js',readme:'readme.md',license:'LICENSE',specificationId:'maintainer-promise-predicate'},
 {id:'plain',repo:'sindresorhus/is-plain-obj',fixed:'b51c26ace163a0761fbe0603cdc270192ef23ce9',parent:'d88f6db1ec1b5aeb4f4d6ed2655e0e8d049ab602',oracle:'b51c26ace163a0761fbe0603cdc270192ef23ce9',test:'test.js',readme:'readme.md',license:'license',extension:'mjs',specificationId:'maintainer-plain-object-predicate'},
 {id:'stream',repo:'sindresorhus/is-stream',fixed:'2070240b28cb734eb34c70dac92b6064260a0621',parent:'23a6c15f83866c3c59f509d7515ab43ed8e6e367',oracle:'2070240b28cb734eb34c70dac92b6064260a0621',test:'test.js',readme:'readme.md',license:'license',specificationId:'maintainer-stream-predicates'}
]);
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const blobHash=bytes=>createHash('sha1').update(Buffer.from(`blob ${bytes.length}\0`)).update(bytes).digest('hex');
export function adaptOracle(profile,original){
 if(typeof original!=='string'||Buffer.byteLength(original)>65536)throw new Error('Bounded maintainer oracle required');
 let prefix,body,adapted;
 if(profile.id==='regexp'){
  prefix="import test from 'ava';\nimport escapeStringRegexp from '.';\n";
  if(!original.startsWith(prefix))throw new Error('Maintainer AVA import prefix changed');
  body=original.slice(prefix.length);
  adapted="import nodeTest from 'node:test';\nimport assert from 'node:assert/strict';\nimport escapeStringRegexp from '../src/regexp.cjs';\nconst test=(name,fn)=>nodeTest(name,()=>fn({is:assert.strictEqual,regex:assert.match}));\n"+body;
 }else if(profile.id==='html'){
  prefix="var assert = require('assert')\nvar escapeHtml = require('..')\n";
  if(!original.startsWith(prefix))throw new Error('Maintainer Mocha import prefix changed');
  body=original.slice(prefix.length);
  adapted="const {describe,it}=require('node:test');\nvar assert = require('assert')\nvar escapeHtml = require('../src/html.cjs')\n"+body;
 }else if(profile.id==='promise'){
  prefix="var isPromise = require('./');\nvar assert = require('better-assert');\n";
  if(!original.startsWith(prefix))throw new Error('Maintainer Mocha import prefix changed');
  body=original.slice(prefix.length);
  adapted="const {describe,it}=require('node:test');\nvar isPromise=require('../src/promise.cjs');\nvar assert=require('node:assert/strict').ok;\n"+body;
 }else if(profile.id==='plain'){
  prefix="import test from 'ava';\nimport isPlainObject from './index.js';\nimport {runInNewContext} from 'vm';\n";
  if(!original.startsWith(prefix))throw new Error('Maintainer AVA import prefix changed');
  body=original.slice(prefix.length);
  adapted="import nodeTest from 'node:test';\nimport assert from 'node:assert/strict';\nimport isPlainObject from '../src/plain.mjs';\nimport {runInNewContext} from 'node:vm';\nconst test=(name,fn)=>nodeTest(name,()=>fn({true:value=>assert.strictEqual(value,true),false:value=>assert.strictEqual(value,false)}));\n"+body;
 }else if(profile.id==='milliseconds'){
  prefix="/* eslint-disable no-undef */\n/**\n * Dependencies.\n */\n\nif (typeof require !== 'undefined') {\n  expect = require('expect.js');\n  ms = require('./');\n}\n";
  if(!original.startsWith(prefix))throw new Error('Maintainer expect.js import prefix changed');
  body=original.slice(prefix.length);
  adapted="const {describe,it}=require('node:test');\nconst assert=require('node:assert/strict');\nconst ms=require('../src/milliseconds.cjs');\nconst expect=value=>({to:{be:expected=>assert.strictEqual(value,expected),throwError:()=>assert.throws(value),not:{throwError:()=>assert.doesNotThrow(value)}}});\n"+body;
 }else if(profile.id==='stream'){
  prefix="import fs from 'fs';\nimport Stream from 'stream';\nimport net from 'net';\nimport test from 'ava';\nimport tempy from 'tempy';\nimport isStream from '.';\n";
  if(!original.startsWith(prefix))throw new Error('Maintainer AVA stream import prefix changed');
  body=original.slice(prefix.length);
  adapted="import nodeTest from 'node:test';\nimport assert from 'node:assert/strict';\nimport nativeFs from 'node:fs';\nimport os from 'node:os';\nimport path from 'node:path';\nimport {fileURLToPath} from 'node:url';\nimport Stream from 'node:stream';\nimport net from 'node:net';\nimport isStream from '../src/stream.cjs';\nconst test=(name,fn)=>nodeTest(name,async()=>{const streams=[],directory=nativeFs.mkdtempSync(path.join(os.tmpdir(),'testlore-maintainer-stream-'));let count=0;\nconst track=stream=>(streams.push(stream),stream);\nfs={createReadStream:file=>track(nativeFs.createReadStream(file==='test.js'?fileURLToPath(import.meta.url):file)),createWriteStream:file=>track(nativeFs.createWriteStream(file))};\ntempy={file:()=>path.join(directory,String(count++))};\ntry{fn({true:value=>assert.strictEqual(value,true),false:value=>assert.strictEqual(value,false)});}finally{await Promise.all(streams.map(stream=>new Promise(resolve=>{stream.once('close',resolve);stream.destroy();})));nativeFs.rmSync(directory,{recursive:true,force:true});}});\nlet fs,tempy;\n"+body;
 }else throw new Error('Unknown oracle adaptation');
 return {content:adapted,adapter:'node-test-import-shim-v1',originalHash:hash(original),bodyHash:hash(body),adaptedHash:hash(adapted),scope:profile.id==='stream'?'Maintainer assertion bodies remain byte-identical. Imports use Node assertions; tempy uses a disposable directory, relocated test.js reads target this test file, and opened streams are closed after each case. This is not upstream AVA/tempy or historical Node qualification.':'Only imports/framework entry points change. Maintainer assertion bodies remain byte-identical. This is not an upstream runner qualification.'};
}
function github(endpoint){
 const result=spawnSync('gh',['api',endpoint],{encoding:'utf8',timeout:30000,maxBuffer:1024*1024});
 if(result.error||result.status!==0)throw new Error(`GitHub source fetch failed: ${endpoint}: ${result.error?.message||String(result.stderr).slice(0,400)}`);
 return JSON.parse(result.stdout);
}
export async function preparePublicGeneration({output,read=github,cohort='original'}={}){
 if(!['original','fresh'].includes(cohort))throw new Error('Unknown frozen public cohort');
 const selectedProfiles=cohort==='fresh'?freshProfiles:profiles;
 if(!output)throw new Error('Explicit new output directory required');
 output=path.resolve(output);if(fs.existsSync(output))throw new Error('Preserve previous dataset: output exists');
 fs.mkdirSync(output,{recursive:true,mode:0o700});
 const bindings=[],fixtures=[],provenance=[];
 function file(profile,revision,name){
  const data=read(`repos/${profile.repo}/contents/${name}?ref=${revision}`);
  if(data.type!=='file'||data.encoding!=='base64'||typeof data.content!=='string'||!Number.isInteger(data.size)||data.size>65536)throw new Error('Invalid bounded GitHub file');
  const bytes=Buffer.from(data.content,'base64');
  if(bytes.length!==data.size||blobHash(bytes)!==data.sha||!bytes.equals(Buffer.from(bytes.toString('utf8'))))throw new Error('GitHub blob bytes do not match identity/UTF-8');
  const binding={repo:profile.repo,revision,path:name,gitBlob:data.sha,sha256:hash(bytes),bytes:bytes.length,url:`https://github.com/${profile.repo}/blob/${revision}/${name}`};
  bindings.push(binding);
  const archive=path.join(output,'upstream',profile.id,revision,name);fs.mkdirSync(path.dirname(archive),{recursive:true});fs.writeFileSync(archive,bytes,{flag:'wx'});
  return bytes.toString('utf8');
 }
 try{
  for(const profile of selectedProfiles){
   const commit=read(`repos/${profile.repo}/commits/${profile.fixed}`);
   if(commit.sha!==profile.fixed||commit.parents?.[0]?.sha!==profile.parent)throw new Error('Historical first-parent identity mismatch');
   const fixed=file(profile,profile.fixed,'index.js'),fault=file(profile,profile.parent,'index.js');
   if(fixed===fault)throw new Error('Historical source does not differ');
   const original=file(profile,profile.oracle,profile.test),oracle=adaptOracle(profile,original);
   const readme=file(profile,profile.oracle,profile.readme);file(profile,profile.oracle,profile.license);
   const source=`src/${profile.id}.${profile.extension||'cjs'}`;
   const requirements=`Public maintainer API contract (${profile.repo}, ${profile.oracle}). Test the ${profile.extension==='mjs'?'ESM':'CommonJS'} default export at ${source} using Node's test runner. Write exact deterministic assertions from the contract, including boundaries. The README below is authoritative for this API scope. Do not assert undocumented behavior or derive expected values by running the implementation.\n\n${readme}`;
   fixtures.push({id:profile.id,specificationId:profile.specificationId,requirements,files:[{path:source,content:fixed}],referenceTests:[{path:`test/${profile.id}.test.${['html','promise','milliseconds'].includes(profile.id)?'cjs':'mjs'}`,content:oracle.content}],defects:[{id:'historical-parent',files:[{path:source,content:fault}]}]});
   provenance.push({...profile,adaptation:oracle,sourceScope:'Exact fixed and parent source bytes; later independent oracle revision is declared separately when applicable. No full upstream dependency installation; only built-in Node assertion runner shims.'});
  }
  const dataset=validateDataset({schemaVersion:1,id:cohort==='fresh'?'public-maintainer-fresh-contracts-20261007-v1':'public-maintainer-contracts-20261007-v1',history:defaultDataset().history,fixtures});
  const commitment=commitDataset(dataset,{owner:'Public upstream maintainers; TestLore transport adaptation',source:`Pinned ${selectedProfiles.map(profile=>profile.repo).join(', ')} README, tests, and genuine historical parent revisions; upstream blob bindings accompany dataset`,independentlyMaintained:true,independenceNotes:'Maintainer specifications/assertions/history independently maintained. TestLore selects snapshots and adapts framework entry points; no assertion bodies change. Stream imports also relocate the fixture read and replace tempy with disposable paths/cleanup. One authored distinct history example is advisory memory. Local byte commitments do not prove model-training isolation, semantic independence or trusted publication time. Four fresh units cannot establish general learning efficacy.'});
  for(const [name,value]of [['dataset.json',dataset],['commitment.json',commitment],['provenance.json',{schemaVersion:1,profiles:provenance,bindings}],['budget.json',{mode:cohort==='fresh'?'paired-learning':'generation-reliability',repeat:2,maxCalls:cohort==='fresh'?48:12,timeoutMs:115000,maxOutputBytes:65536,stabilityRuns:2,retries:0,learningCompared:cohort==='fresh',promotionAuthorized:false}]])fs.writeFileSync(path.join(output,name),JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600});
  return {complete:true,datasetHash:commitment.datasetHash,fixtures:fixtures.length,bindings:bindings.length};
 }catch(error){fs.writeFileSync(path.join(output,'preparation-failure.json'),JSON.stringify({complete:false,error:error.message,bindings},null,2)+'\n',{flag:'wx',mode:0o600});throw error;}
}
export async function main(argv=process.argv.slice(2)){
 if(![3,5].includes(argv.length)||argv[0]!=='--fetch'||argv[1]!=='--output'||(argv.length===5&&(argv[3]!=='--cohort'||argv[4]!=='fresh')))throw new Error('Use --fetch --output NEW_DIRECTORY [--cohort fresh]. Explicit source fetch; never invokes a provider.');
 return preparePublicGeneration({output:argv[2],cohort:argv[4]||'original'});
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){try{console.log(JSON.stringify(await main()));}catch(error){console.error(error.message);process.exitCode=1;}}
