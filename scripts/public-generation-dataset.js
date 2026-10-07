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
 }else throw new Error('Unknown oracle adaptation');
 return {content:adapted,adapter:'node-test-import-shim-v1',originalHash:hash(original),bodyHash:hash(body),adaptedHash:hash(adapted),scope:'Only imports/framework entry points change. Maintainer assertion bodies remain byte-identical. This is not an upstream AVA/Mocha runner qualification.'};
}
function github(endpoint){
 const result=spawnSync('gh',['api',endpoint],{encoding:'utf8',timeout:30000,maxBuffer:1024*1024});
 if(result.error||result.status!==0)throw new Error(`GitHub source fetch failed: ${endpoint}: ${result.error?.message||String(result.stderr).slice(0,400)}`);
 return JSON.parse(result.stdout);
}
export async function preparePublicGeneration({output,read=github}={}){
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
  for(const profile of profiles){
   const commit=read(`repos/${profile.repo}/commits/${profile.fixed}`);
   if(commit.sha!==profile.fixed||commit.parents?.[0]?.sha!==profile.parent)throw new Error('Historical first-parent identity mismatch');
   const fixed=file(profile,profile.fixed,'index.js'),fault=file(profile,profile.parent,'index.js');
   if(fixed===fault)throw new Error('Historical source does not differ');
   const original=file(profile,profile.oracle,profile.test),oracle=adaptOracle(profile,original);
   const readme=file(profile,profile.oracle,profile.readme);file(profile,profile.oracle,profile.license);
   const source=`src/${profile.id}.cjs`;
   const requirements=`Public maintainer API contract (${profile.repo}, ${profile.oracle}). Test the CommonJS default export at ${source} using Node's test runner. Write exact deterministic assertions from the contract, including boundaries. The README below is authoritative for this API scope. Do not assert undocumented behavior or derive expected values by running the implementation.\n\n${readme}`;
   fixtures.push({id:profile.id,specificationId:profile.specificationId,requirements,files:[{path:source,content:fixed}],referenceTests:[{path:`test/${profile.id}.test.${profile.id==='html'?'cjs':'mjs'}`,content:oracle.content}],defects:[{id:'historical-parent',files:[{path:source,content:fault}]}]});
   provenance.push({...profile,adaptation:oracle,sourceScope:'Exact fixed and parent source bytes; later independent oracle revision is declared separately when applicable. No full upstream dependency installation; only built-in Node assertion runner shims.'});
  }
  const dataset=validateDataset({schemaVersion:1,id:'public-maintainer-contracts-20261007-v1',history:defaultDataset().history,fixtures});
  const commitment=commitDataset(dataset,{owner:'Public upstream maintainers; TestLore transport adaptation',source:'Pinned escape-string-regexp and escape-html README, tests, and genuine historical parent revisions; upstream blob bindings accompany dataset',independentlyMaintained:true,independenceNotes:'Maintainer specifications/assertions/history independently maintained. TestLore selects the snapshots and adapts framework imports only; no original assertion bodies change. One authored, distinct history example is retained for advisory memory. A local byte commitment does not prove model-training isolation, semantic independence or trusted publication time. Two specifications cannot establish general learning efficacy.'});
  for(const [name,value]of [['dataset.json',dataset],['commitment.json',commitment],['provenance.json',{schemaVersion:1,profiles:provenance,bindings}],['budget.json',{mode:'generation-reliability',repeat:2,maxCalls:12,timeoutMs:115000,maxOutputBytes:65536,stabilityRuns:2,retries:0,learningCompared:false}]])fs.writeFileSync(path.join(output,name),JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600});
  return {complete:true,datasetHash:commitment.datasetHash,fixtures:fixtures.length,bindings:bindings.length};
 }catch(error){fs.writeFileSync(path.join(output,'preparation-failure.json'),JSON.stringify({complete:false,error:error.message,bindings},null,2)+'\n',{flag:'wx',mode:0o600});throw error;}
}
export async function main(argv=process.argv.slice(2)){
 if(argv.length!==3||argv[0]!=='--fetch'||argv[1]!=='--output')throw new Error('Use --fetch --output NEW_DIRECTORY. Explicit source fetch; never invokes a provider.');
 return preparePublicGeneration({output:argv[2]});
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){try{console.log(JSON.stringify(await main()));}catch(error){console.error(error.message);process.exitCode=1;}}
