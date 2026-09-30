#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {measureMutation} from '../src/quality-measurement.js';
const repository=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export async function incrementalQualityProof({toolsRoot=repository,output}={}){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'testlore-incremental-proof-'));
 const write=(file,text)=>{const target=path.join(root,file);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,text);};
 try{
  write('package.json',JSON.stringify({type:'module'}));write('tddswarm.config.json',JSON.stringify({env:{TESTLORE_MUTATION_EXPECTED:'ten'}}));write('src/helper.js',"export const limit=10;\n");write('src/clamp.js',"import {limit} from './helper.js';export function clamp(x){return Math.max(0,Math.min(limit,x));}\n");
  write('test/clamp.test.js',"import test from 'node:test';import assert from 'node:assert/strict';import {clamp} from '../src/clamp.js';assert.equal(process.env.TESTLORE_MUTATION_EXPECTED,'ten');test('independent clamp lower bound zero',()=>assert.equal(clamp(-1),0));test('independent upper bound ten',()=>assert.equal(clamp(20),10));test('independent in-range identity',()=>assert.equal(clamp(4),4));\n");
  const options={toolsRoot,mutate:['src/clamp.js'],timeoutMs:180000};const first=await measureMutation(root,options),warm=await measureMutation(root,options);
  assert.equal(first.complete,true,first.reasons.join(','));assert.equal(first.reusedBaseline,false);assert.equal(warm.complete,true,warm.reasons.join(','));assert.equal(warm.reusedBaseline,true);assert.deepEqual(first.metrics,warm.metrics);
  assert.match(warm.execution.stdout,/of \d+ mutant result/);
  write('src/helper.js',"export const limit=5+5; // changed non-mutated supporting source, same independent contract\n");const helper=await measureMutation(root,options);assert.equal(helper.complete,true,helper.reasons.join(','));assert.equal(helper.reusedBaseline,false);assert.deepEqual(helper.metrics,first.metrics);
  write('package-lock.json',JSON.stringify({lockfileVersion:3,packages:{},proof:'changed dependencies'}));const lock=await measureMutation(root,options);assert.equal(lock.complete,true,lock.reasons.join(','));assert.equal(lock.reusedBaseline,false);
  write('tddswarm.config.json',JSON.stringify({runner:['node','--test','{files}'],env:{TESTLORE_MUTATION_EXPECTED:'ten'},environment:{contract:'proof-v2'}}));const config=await measureMutation(root,options);assert.equal(config.complete,true,config.reasons.join(','));assert.equal(config.reusedBaseline,false);
  const environmentName='TESTLORE_INCREMENTAL_PROOF_ENV',previous=process.env[environmentName];let environment;try{process.env[environmentName]='different-environment';environment=await measureMutation(root,options);assert.equal(environment.complete,true,environment.reasons.join(','));assert.equal(environment.reusedBaseline,false);}finally{if(previous===undefined)delete process.env[environmentName];else process.env[environmentName]=previous;}
  const raw=Object.fromEntries(Object.entries({first,warm,helper,lock,config,environment}).map(([name,result])=>[name,JSON.parse(fs.readFileSync(path.join(root,result.rawPath),'utf8'))]));
  const receipt={schemaVersion:1,verified:true,sanitized:true,authority:'reproduction-fixture-display-only',scope:'Real installed Stryker 10 command-runner fixture; same independent clamp oracle retained. Not production/model effectiveness evidence.',first,warm,helperInvalidation:helper,lockInvalidation:lock,configInvalidation:config,environmentInvalidation:environment,raw,limits:['Exact-input reuse; mutated source and tests changes also force full measurement for command-runner safety.','Six executions measure a tiny fixture; timings cannot establish production speedup.']};
  let text=JSON.stringify(receipt,null,2).split(root).join('<fixture>').split(path.resolve(toolsRoot)).join('<tools>').split(process.execPath).join('<node>').split(repository).join('<repository>').replace(/(?:\/private)?\/var\/folders\/[^\s\"']*?(?:testlore-measurement|tddswarm-report)-[A-Za-z0-9_-]+/g,'<measurement>');if(output){fs.mkdirSync(path.dirname(path.resolve(output)),{recursive:true});fs.writeFileSync(output,text+'\n');}return JSON.parse(text);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){const args=process.argv.slice(2),options={};for(let i=0;i<args.length;i+=2){if(!['--tools-root','--output'].includes(args[i])||!args[i+1])throw new Error('Expected --tools-root or --output');options[args[i]==='--tools-root'?'toolsRoot':'output']=args[i+1];}try{const result=await incrementalQualityProof(options);console.log(JSON.stringify({verified:result.verified,first:result.first.metrics,warmReused:result.warm.reusedBaseline,helperInvalidated:!result.helperInvalidation.reusedBaseline,lockInvalidated:!result.lockInvalidation.reusedBaseline}));}catch(error){console.error(error.stack);process.exitCode=1;}}
