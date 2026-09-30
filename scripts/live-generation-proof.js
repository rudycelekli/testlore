#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {generate} from '../src/swarm.js';
import {validateCandidates,applyPatch} from '../src/candidates.js';
import {discover,execute} from '../src/execution.js';
import {digest} from '../src/provenance.js';
const repository=fileURLToPath(new URL('../',import.meta.url));
const outputIndex=process.argv.indexOf('--output');
const output=outputIndex>=0?process.argv[outputIndex+1]:undefined;
const source="export function clamp(value,min,max){if(min>max)throw new RangeError('invalid bounds');return Math.min(max,Math.max(min,value));}\n";
const requirements='For finite numeric values, clamp returns min below the lower bound, max above the upper bound, and the input within the inclusive interval. Equal bounds return that bound. Reversed bounds throw RangeError. Cover negative numbers, zero and boundary values with exact expectations, not implementation-generated values. Use Node test and assert, named runnable cases, and only test paths.';
const defects=[['lower-bound','return Math.min(max,value);'],['upper-bound','return Math.max(min,value);'],['interior','return min;'],['reversed-bounds','return Math.min(max,Math.max(min,value));']];
const sourceDigests=Object.fromEntries(['src/swarm.js','src/adapters/codex.js','src/candidates.js','scripts/live-generation-proof.js'].map(f=>[f,digest(fs.readFileSync(path.join(repository,f)))]));
const root=fs.mkdtempSync(path.join(os.tmpdir(),'tddswarm-live-proof-'));
function write(file,content){const target=path.join(root,file);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,typeof content==='string'?content:JSON.stringify(content));}
try{
 const version=spawnSync('codex',['--version'],{encoding:'utf8',timeout:10000});if(version.status!==0)throw new Error('An authenticated installed Codex CLI is required; no fallback worker');
 write('package.json',{type:'module'});write('src/clamp.js',source);write('tddswarm.requirements.md',requirements);
 const config={adapter:'node',runner:[process.execPath,'--test','{files}'],agent:[process.execPath,path.join(repository,'src/adapters/codex.js')]};write('tddswarm.config.json',config);
 const staged=await generate(root,{execute:true});const validation=validateCandidates(root,staged.id);
 if(!validation.accepted)throw new Error('Actual generated candidates failed validation: '+JSON.stringify(validation.reasons));
 applyPatch(root,staged.id,{execute:true});const files=discover(root,config).files;
 const baseline=execute(root,files,config,{capture:true});if(!baseline.complete||baseline.exitCode!==0||!baseline.tests.length)throw new Error('Generated baseline is not complete and passing');
 const heldOut=[];
 for(const [name,body] of defects){const mutated=name==='reversed-bounds'?`export function clamp(value,min,max){${body}}\n`:`export function clamp(value,min,max){if(min>max)throw new RangeError('invalid bounds');${body}}\n`;write('src/clamp.js',mutated);const result=execute(root,files,config,{capture:true});const detected=result.complete&&result.exitCode!==0&&result.tests.some(t=>t.status==='failed'&&t.name!=='<file-load>');heldOut.push({name,mutated,detected,result});write('src/clamp.js',source);}
 const receipt={schemaVersion:1,generatedAt:new Date().toISOString(),scope:'Actual installed Codex architect/author/reviewer calls on one controlled specification; no claim of general model quality',cli:version.stdout.trim(),node:process.version,source,requirements,sourceDigests,files:staged.files.map(file=>({path:file,content:fs.readFileSync(path.join(root,file),'utf8')})),review:staged.review,validation,baseline,heldOut,detected:heldOut.filter(d=>d.detected).length,total:heldOut.length,limitations:['One small deterministic specification and one unpinned CLI default model; no general efficacy or vendor-diverse review claim.','Four mutations are withheld from worker payloads; independent requirements are supplied.','Installed native credentials/allowance are used; provider API environment keys are stripped by the adapter.']};
 let serialized=JSON.stringify(receipt,null,2);for(const [from,to] of [[root,'<fixture>'],[repository,'<repository>'],[process.execPath,'<node>']])serialized=serialized.split(from).join(to);
 if(output&&output!=='--output'){fs.mkdirSync(path.dirname(path.resolve(output)),{recursive:true});fs.writeFileSync(output,serialized+'\n');}
 console.log(JSON.stringify({scope:receipt.scope,calls:staged.calls,cases:baseline.tests.length,detected:receipt.detected,total:receipt.total,output},null,2));
 if(receipt.detected!==receipt.total)process.exitCode=1;
}catch(error){console.error(error.message);process.exitCode=1;}
finally{fs.rmSync(root,{recursive:true,force:true});}
