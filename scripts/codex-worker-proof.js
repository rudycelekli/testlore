#!/usr/bin/env node
// Opt-in bounded native worker exercise; importing does not invoke a model.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {codexRequest, runCodex} from '../src/adapters/codex.js';
import {digest} from '../src/provenance.js';
import {discover, execute} from '../src/execution.js';
import {stableOutcomes} from './learning-evaluation.js';

const contract = 'encode16 accepts an integer from 0 through 65535 inclusive and returns a new two-element number array containing its unsigned big-endian bytes. All other values, including non-numbers, non-finite numbers, fractional values, negative integers and 65536, throw RangeError. Each byte is an integer from 0 through 255. Use exact independent expectations and boundary/error cases. Return Node built-in test/assert tests importing src/encode16.js; no dependencies.';
const correct = 'export function encode16(n){if(!Number.isInteger(n)||n<0||n>65535)throw new RangeError();return [n>>>8,n&255];}';
const reference = "import test from 'node:test';import assert from 'node:assert/strict';import {encode16} from '../src/encode16.js';test('independent byte expectations',()=>{assert.deepEqual(encode16(0),[0,0]);assert.deepEqual(encode16(1),[0,1]);assert.deepEqual(encode16(4660),[18,52]);assert.deepEqual(encode16(65535),[255,255]);});test('independent range and type contract',()=>{for(const n of [-1,65536,1.5,NaN,Infinity,'1',null])assert.throws(()=>encode16(n),RangeError);});";
const defects = [
  {id:'reversed-byte-order',source:'export function encode16(n){if(!Number.isInteger(n)||n<0||n>65535)throw new RangeError();return [n&255,n>>>8];}'},
  {id:'upper-bound-accepted',source:'export function encode16(n){if(!Number.isInteger(n)||n<0||n>65536)throw new RangeError();return [n>>>8,n&255];}'},
  {id:'fractional-value-accepted',source:'export function encode16(n){if(typeof n!=="number"||!Number.isFinite(n)||n<0||n>65535)throw new RangeError();return [n>>>8,n&255];}'}
];
const config = {adapter:'node',discovery:'native',runner:[process.execPath,'--test','{files}'],runnerTimeoutMs:10000};
const repository=fileURLToPath(new URL('../',import.meta.url));
function sourceIdentity(){
  const revision=spawnSync('git',['rev-parse','HEAD'],{cwd:repository,encoding:'utf8',timeout:10000});
  const status=spawnSync('git',['status','--porcelain'],{cwd:repository,encoding:'utf8',timeout:10000});
  if(revision.status!==0||status.status!==0||status.stdout.trim()||!(/^[a-f0-9]{40}$/.test(revision.stdout.trim())))throw new Error('Native proof requires clean committed source');
  const hashes=Object.fromEntries(['scripts/codex-worker-proof.js','src/adapters/codex.js','src/adapters/codex-protocol.js','src/execution.js','scripts/learning-evaluation.js'].map(file=>[file,digest(fs.readFileSync(path.join(repository,file)))]));
  return {revision:revision.stdout.trim(),hashes};
}
function put(root,file,value){const target=path.join(root,file);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,value);}
function project(root,files){fs.mkdirSync(root);put(root,'package.json',JSON.stringify({type:'module'}));put(root,'src/encode16.js',correct);for(const file of files)put(root,file.path,file.content);}
function collect(root){const discovery=discover(root,config);if(!discovery.complete||!discovery.files.length)throw new Error('Incomplete or empty native discovery');return {...execute(root,discovery.files,config,{capture:true,timeoutMs:10000}),discovery};}
const pass = r=>r.complete&&r.exitCode===0&&r.tests.length>0&&r.tests.every(t=>t.status==='passed');
const caught = r=>r.complete&&r.exitCode===1&&r.tests.some(t=>t.status==='failed'&&t.name!=='<file-load>');
function generatedFiles(value){
  if(!value||!Array.isArray(value.files)||!value.files.length||value.files.length>4)throw new Error('Author requires 1–4 bounded test files');
  const seen=new Set();for(const file of value.files){if(!/^test\/[A-Za-z0-9_-]+\.test\.[cm]?js$/.test(file.path)||seen.has(file.path)||typeof file.content!=='string'||!file.content.trim()||Buffer.byteLength(file.content)>32768)throw new Error('Invalid generated test file');seen.add(file.path);}return value.files;
}
async function nativeRequest(payload,requestDirectory,timeoutMs){
  const request=codexRequest(payload,requestDirectory),env={...process.env};
  for(const key of ['OPENAI_API_KEY','CODEX_API_KEY','AZURE_OPENAI_API_KEY','ANTHROPIC_API_KEY','OPENROUTER_API_KEY'])delete env[key];
  const deadlineAt=Date.now()+timeoutMs;
  const version=spawnSync('codex',['--version'],{cwd:requestDirectory,env,encoding:'utf8',timeout:Math.min(5000,timeoutMs),maxBuffer:4096,shell:false});
  if(version.status!==0||!/^codex-cli [A-Za-z0-9.+_-]+\s*$/.test(version.stdout||''))throw new Error('Codex version preflight failed');
  const result=await runCodex(request.args,request.prompt,requestDirectory,env,{deadlineAt,maxOutputBytes:32768});
  result.audit.cliReportedVersion=version.stdout.trim();return result;
}

/** Protocol fixture injection is test-only evidence, never native qualification. */
export async function qualifyCodexWorker({output,executeNative=false,timeoutMs=60000,request}={}){
  if(!Number.isInteger(timeoutMs)||timeoutMs<100||timeoutMs>120000)throw new Error('timeoutMs must be 100–120000');
  if(typeof output!=='string'||!output.trim())throw new Error('A new private output directory is required');
  if(request!==undefined&&typeof request!=='function')throw new Error('Invalid fixture request');
  if(!request&&!executeNative)throw new Error('Native model execution requires explicit --execute');
  const identity=request?null:sourceIdentity();
  output=path.resolve(output);if(fs.existsSync(output))throw new Error('Preserve prior evidence: output must be new');fs.mkdirSync(output,{recursive:true,mode:0o700});
  const evidenceKind=request?'protocol-fixture':'native-codex-worker',worker=request||nativeRequest;
  const workspace=fs.mkdtempSync(path.join(os.tmpdir(),'testlore-codex-proof-')),started=performance.now(),calls=[];
  const receipt=(file,value)=>fs.writeFileSync(path.join(output,file),JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600});
  let summary,detected=0,referenceDemonstrated=0,error;
  try{
    receipt('manifest.json',{schemaVersion:1,evidenceKind,sourceIdentity:identity,contractHash:digest(contract),contract,source:correct,reference,defects,budget:{maxRoleInvocations:3,timeoutMs,maxResponseBytes:32768,stabilityRuns:2,retries:0},model:{requested:null,verified:null},billingUSD:null});
    const oracle=path.join(workspace,'oracle');project(oracle,[{path:'test/reference.test.js',content:reference}]);
    const baselines=[collect(oracle),collect(oracle)];receipt('reference-baselines.json',baselines);
    if(!baselines.every(pass)||!stableOutcomes(baselines))throw new Error('Independent reference baseline is invalid');
    for(const defect of defects){put(oracle,'src/encode16.js',defect.source);const results=[collect(oracle),collect(oracle)];receipt('reference-'+defect.id+'.json',results);if(!results.every(caught)||!stableOutcomes(results))throw new Error('Independent reference did not demonstrate '+defect.id);referenceDemonstrated++;}
    const context=[{file:'src/encode16.js',content:correct}];
    async function role(name,extra){
      const directory=path.join(workspace,name);fs.mkdirSync(directory);
      if(identity&&JSON.stringify(sourceIdentity())!==JSON.stringify(identity))throw new Error('Native proof source identity drift');
      const payload={schemaVersion:1,role:name,requirements:contract,context,budget:{maxTasks:1,instructions:'Use only supplied context. No tools or filesystem reads.'},...extra},start=performance.now();
      const call={role:name,inputBytes:Buffer.byteLength(JSON.stringify(payload))};calls.push(call);
      try{const result=await worker(payload,directory,timeoutMs);call.durationMs=Math.round(performance.now()-start);call.audit=result.audit??null;call.outputBytes=Buffer.byteLength(JSON.stringify(result.value));receipt(name+'.json',{payload,...result});return result.value;}
      catch(error){call.durationMs=Math.round(performance.now()-start);call.error=error.code||'worker-failed';receipt(name+'-failure.json',{error:error.message,code:error.code??null,audit:error.audit??null});throw error;}
    }
    const architecture=await role('architect',{order:{subjects:['src/encode16.js']}});
    if(!Array.isArray(architecture.tasks)||architecture.tasks.length!==1||architecture.tasks[0]?.subject!=='src/encode16.js'||typeof architecture.tasks[0].instructions!=='string'||!architecture.tasks[0].instructions.trim())throw new Error('Expected exactly one bounded task');
    const draft=await role('author',{task:architecture.tasks[0]});const files=generatedFiles(draft);
    const review=await role('reviewer',{files,acceptance:['Independent byte expectations, complete range/type boundary contract, runnable deterministic tests.']});
    if(review.accepted!==true||review.oracle?.independent!==true||!Array.isArray(review.oracle.basis)||!review.oracle.basis.length||review.oracle.basis.some(b=>typeof b!=='string'||!b.trim()))throw new Error('Independent review rejected the candidate');
    const candidate=path.join(workspace,'candidate');project(candidate,files);
    const baselinesGenerated=[collect(candidate),collect(candidate)];receipt('generated-baselines.json',baselinesGenerated);
    if(!baselinesGenerated.every(pass)||!stableOutcomes(baselinesGenerated))throw new Error('Generated baseline incomplete or unstable');
    for(const defect of defects){put(candidate,'src/encode16.js',defect.source);const results=[collect(candidate),collect(candidate)];receipt('generated-'+defect.id+'.json',results);if(results.every(caught)&&stableOutcomes(results))detected++;else throw new Error('Generated tests did not stably detect '+defect.id);}
    if(identity&&JSON.stringify(sourceIdentity())!==JSON.stringify(identity))throw new Error('Native proof source identity drift');
  }catch(failure){error={code:failure.code??'qualification-failed',message:failure.message};}
  finally{
    fs.rmSync(workspace,{recursive:true,force:true});
    summary={schemaVersion:1,evidenceKind,sourceIdentity:identity,complete:!error,roleInvocations:calls.length,calls,referenceDemonstrated,detected:error?0:detected,partiallyObservedDetections:detected,defectOpportunities:defects.length,elapsedMs:Math.round(performance.now()-started),error:error??null,model:{requested:null,verified:null},billingUSD:null,limitations:['One constructed contract and three independently authored conformance faults; no production, competitor or learning-effect claim.','Reference/defect material is excluded from worker payloads and request directories; native event auditing does not establish OS read confinement.','At most three role invocations, no controller retries, fixed per-role deadline. Provider internal retries and token billing are unknown.','Native execution uses the existing Codex login. Full agent-host MCP qualification is a separate gate.','Elapsed time includes reference executions, model roles, repeated generated executions and cleanup; final summary writing and process startup are excluded.']};
    receipt('summary.json',summary);
  }
  return summary;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{const args=process.argv.slice(2),options={};for(let i=0;i<args.length;i++){const key=args[i];if(key==='--execute'){if(options.executeNative)throw new Error('Duplicate --execute');options.executeNative=true;}else if(['--output','--timeout-ms'].includes(key)&&args[i+1]&&!options[key])options[key]=args[++i];else throw new Error('Expected --execute --output NEW_DIR [--timeout-ms 60000]');}
    const result=await qualifyCodexWorker({output:options['--output'],executeNative:options.executeNative,timeoutMs:options['--timeout-ms']===undefined?60000:Number(options['--timeout-ms'])});console.log(JSON.stringify(result,null,2));if(!result.complete)process.exitCode=1;
  }catch(error){console.error(error.message);process.exitCode=2;}
}
