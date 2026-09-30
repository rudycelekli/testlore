#!/usr/bin/env node
// Actual native-worker ablation. Requires existing Codex authentication; never substitutes a mock.
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {spawnSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
import {stagePatch,validateCandidates,applyPatch} from '../src/candidates.js';
import {generate} from '../src/swarm.js';import {discover,execute} from '../src/execution.js';
import {recallLessons} from '../src/learning.js';import {digest} from '../src/provenance.js';
const repository=fileURLToPath(new URL('../',import.meta.url));
const outputIndex=process.argv.indexOf('--output');if(outputIndex<0)throw new Error('--output new-directory is required');
const output=path.resolve(process.argv[outputIndex+1]);if(fs.existsSync(output))throw new Error('Preserve prior evidence; output must be new');fs.mkdirSync(output,{recursive:true});
const version=spawnSync('codex',['--version'],{encoding:'utf8',timeout:10000});if(version.status!==0)throw new Error('Installed authenticated Codex CLI required');
const workspace=fs.mkdtempSync(path.join(os.tmpdir(),'testlore-learning-ablation-'));
const source="export function bounded(value,lower,upper){if(lower>upper)throw new RangeError('bounds');return Math.min(upper,Math.max(lower,value));}\n";
const requirements='For finite numbers, bounded(value,lower,upper) returns lower below the lower bound, upper above the upper bound, and the unchanged value within inclusive bounds. Equal bounds return that bound. Reversed bounds throw RangeError. Test negative values, zero, boundaries and interior values with independent exact expectations, not implementation-computed oracles. Use named Node test/assert cases.';
const variants=process.argv.includes('--warm-first')?['historical_memory','without_memory']:['without_memory','historical_memory'];
const outcomes=[];
const implementationHashes=Object.fromEntries(['src/learning.js','src/swarm.js','src/candidates.js','src/adapters/codex.js','scripts/learning-ablation.js'].map(file=>[file,digest(fs.readFileSync(path.join(repository,file)))]));
function write(root,file,value){const target=path.join(root,file);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,typeof value==='string'?value:JSON.stringify(value));}
function persist(file,value){let serialized=JSON.stringify(value,null,2);for(const [from,to] of [[workspace,'<workspace>'],[repository,'<repository>'],[process.execPath,'<node>']])serialized=serialized.split(from).join(to);fs.writeFileSync(path.join(output,file),serialized+'\n');}
try{
 for(const variant of variants){
  const root=path.join(workspace,variant);fs.mkdirSync(root);
  const config={adapter:'node',discovery:'native',runner:[process.execPath,'--test','{files}'],agent:[process.execPath,path.join(repository,'src/adapters/codex.js')],learning:{enabled:true}};
  write(root,'package.json',{type:'module'});write(root,'tddswarm.config.json',config);
  if(variant==='historical_memory'){
   write(root,'src/prior.js','export function clamp(x,min,max){if(min>max)throw new RangeError();return Math.min(max,Math.max(min,x));}');
   const seed=stagePatch(root,{files:[{path:'test/prior.test.js',content:"import test from 'node:test';import assert from 'node:assert/strict';import {clamp} from '../src/prior.js';test('clamp boundary lower upper interior equal negative zero',()=>{assert.equal(clamp(-4,-2,3),-2);assert.equal(clamp(4,-2,3),3);assert.equal(clamp(0,-2,3),0);assert.equal(clamp(-1,-2,3),-1);assert.equal(clamp(7,2,2),2);assert.throws(()=>clamp(0,2,1),RangeError);});"}],review:{accepted:true,findings:[],oracle:{independent:true,basis:['Numeric clamp lower/upper/interior contract, equal bounds, reversed bounds RangeError.']}},requirements:'Numeric clamp lower/upper/interior contract, equal bounds, reversed bounds RangeError.'});
   const validation=validateCandidates(root,seed.id);if(!validation.accepted)throw new Error('Historical seed failed genuine validation');persist('seed-validation.json',validation);
   fs.unlinkSync(path.join(root,'src/prior.js'));
  }else{config.learning.enabled=false;write(root,'tddswarm.config.json',config);}
  write(root,'src/bounded.js',source);write(root,'tddswarm.requirements.md',requirements);
  const recalled=recallLessons(root,requirements,{config,limit:5,maxChars:12000});persist(variant+'-recalled.json',recalled);
  const start=performance.now();let staged,validation,baseline,heldOut=[],error;
  try{
   staged=await generate(root,{execute:true});validation=validateCandidates(root,staged.id);
   if(!validation.accepted)throw new Error('Generated candidate rejected: '+validation.reasons.join(', '));
   applyPatch(root,staged.id,{execute:true});const files=discover(root,config).files;baseline=execute(root,files,config,{capture:true});
   if(!baseline.complete||baseline.exitCode!==0||!baseline.tests.some(t=>t.status==='passed'))throw new Error('Incomplete generated baseline');
   const mutations=[['lower','return Math.min(upper,value);'],['upper','return Math.max(lower,value);'],['interior','return lower;'],['reversed','return Math.min(upper,Math.max(lower,value));']];
   for(const [name,body] of mutations){write(root,'src/bounded.js',`export function bounded(value,lower,upper){${name==='reversed'?'':"if(lower>upper)throw new RangeError('bounds');"}${body}}`);const result=execute(root,files,config,{capture:true});heldOut.push({name,detected:result.complete&&result.exitCode!==0&&result.tests.some(t=>t.status==='failed'&&t.name!=='<file-load>'),result});write(root,'src/bounded.js',source);}
  }catch(e){error=e.message;}
  const outcome={variant,durationMs:Math.round(performance.now()-start),recalledRecords:recalled.records.length,calls:staged?.calls,review:staged?.review,validation,baseline,heldOut,error,detected:heldOut.filter(d=>d.detected).length,total:4,generatedFiles:staged?.files.map(file=>({path:file,content:fs.readFileSync(path.join(staged.directory,'files',file),'utf8')}))};outcomes.push(outcome);persist(variant+'-outcomes.json',outcome);
  console.log(JSON.stringify({variant,error,calls:outcome.calls,cases:baseline?.tests.length,detected:outcome.detected,total:4,recalledRecords:outcome.recalledRecords,durationMs:outcome.durationMs}));
 }
 const summary={schemaVersion:1,date:new Date().toISOString(),scope:'One actual native Codex held-out mutation ablation with and without one prior validated historical example',cli:version.stdout.trim(),node:process.version,model:'installed CLI default; unpinned',order:variants,source,requirements,implementationHashes,variants:outcomes.map(({variant,durationMs,recalledRecords,calls,error,detected,total,baseline})=>({variant,durationMs,recalledRecords,calls,error,detected,total,cases:baseline?.tests.length,complete:baseline?.complete})),limitations:['One stochastic run per variant on one small controlled task; not a general learning improvement or competitor ranking.','Historical pattern is human-authored and genuinely validated; learned snippets are advisory, not model-weight training.','Identical current source/specification is supplied; four mutation payloads are withheld from every worker.','Execution order and unpinned default model may confound timing and output differences.','Generation consumes the existing native account allowance; no provider API-key fallback.']};persist('summary.json',summary);console.log(JSON.stringify(summary,null,2));if(outcomes.some(o=>o.error))process.exitCode=1;
}finally{fs.rmSync(workspace,{recursive:true,force:true});}
