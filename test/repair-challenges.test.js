import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fixture,write,commit} from './helpers.js';
import {captureRepairChallenges,captureChallengeRuntime,runRepairChallenges,assessRepairChallenges} from '../src/repair-challenges.js';
import {stageRepair,validateRepair,applyRepair,captureRepairState} from '../src/repair-candidates.js';
import {repair} from '../src/repair.js';
const baseline="export class Value {constructor(){Object.defineProperty(this,'value',{value:1,enumerable:true,writable:false});}} export const repair=()=>false; export const copy=x=>new Value();";
const good=baseline.replace('()=>false','()=>true');
const bad=good.replace('x=>new Value()',"x=>{const out=new Value();for(const key in x)out[key]=x[key];return out;}");
const manifest={schemaVersion:1,independent:true,basis:'Maintainer development control: readonly constructor property remains clonable; not a holdout.',cases:[{id:'readonly-constructor',script:'quality/readonly.cjs'}]};
const challenge="module.exports=async ({assert,root})=>{const {pathToFileURL}=require('url');const {Value,copy}=await import(pathToFileURL(require('path').join(root,'src/value.js')).href);const input=new Value(),out=copy(input);assert.notStrictEqual(input,out);assert.deepStrictEqual(Object.getOwnPropertyDescriptor(out,'value'),Object.getOwnPropertyDescriptor(input,'value'));};";
function project(t,extra={}){const root=fixture(t,{'package.json':{type:'module'},'tddswarm.config.json':{runner:[process.execPath,'--test','{files}'],repair:{challenges:'quality/challenges.json'}},'tddswarm.requirements.md':'Repair returns true. Preserve readonly constructor behavior.','src/value.js':baseline,'quality/challenges.json':manifest,'quality/readonly.cjs':challenge,'test/value.test.js':"import test from 'node:test';import assert from 'node:assert/strict';import {repair,copy} from '../src/value.js';test('repair',()=>assert.strictEqual(repair(),true));test('copy exists',()=>assert.ok(copy({})));",...extra});commit(root);return root;}
function stage(root,content){return stageRepair(root,{files:[{path:'src/value.js',content}],sourcePaths:['src/value.js'],requirements:fs.readFileSync(path.join(root,'tddswarm.requirements.md'),'utf8'),review:{accepted:true,findings:[],oracle:{independent:true,basis:['Independent requirements']}}});}
test('unchanged original assertions can pass while an independent readonly regression vetoes apply',t=>{
 const root=project(t),item=stage(root,bad),result=validateRepair(root,item.candidatePath,{timeoutMs:3000,totalTimeoutMs:30000});
 assert.equal(result.candidateRuns[0].exitCode,0);assert.equal(result.accepted,false);assert.equal(result.challenges.baseline.length,2);assert.equal(result.challenges.candidate[0].runs[0].observed.error.name,'TypeError');assert.ok(result.reasons.includes('independent-challenge-candidate-regression'));assert.throws(()=>applyRepair(root,item.candidatePath),/Accepted intact/);assert.equal(fs.readFileSync(path.join(root,'src/value.js'),'utf8'),baseline);
});
test('genuine source repair must pass two baseline and candidate challenges without assertion mutation',t=>{
 const root=project(t),item=stage(root,good),before=fs.readFileSync(path.join(root,'quality/readonly.cjs')),result=validateRepair(root,item.candidatePath,{timeoutMs:3000,totalTimeoutMs:30000});
 assert.equal(result.accepted,true,result.reasons.join(','));assert.equal(result.qualification,'suite-and-independent-challenges');assert.equal(result.challenges.candidate.length,2);assert.equal(applyRepair(root,item.candidatePath).applied,true);assert.deepEqual(fs.readFileSync(path.join(root,'quality/readonly.cjs')),before);
});
test('missing challenge governance abstains before a configured worker can run',async t=>{
 const root=project(t,{'tddswarm.config.json':{runner:[process.execPath,'--test','{files}'],agent:[process.execPath,'does-not-exist.cjs']}}),result=await repair(root,{sourcePaths:['src/value.js']});
 assert.equal(result.status,'awaiting-challenges');assert.equal(result.workers,undefined);assert.equal(result.published,false);
});
test('baseline challenge failure rejects before source proposal and unchanged tests cannot be weakened',async t=>{
 const root=project(t,{'quality/readonly.cjs':"module.exports=({assert})=>assert.strictEqual(1,2);"}),result=await repair(root,{sourcePaths:['src/value.js'],deadlineMs:10000});
 assert.equal(result.status,'challenge-baseline-rejected');assert.equal(result.workers,undefined);assert.equal(result.sha,null);
 t.after(()=>{fs.rmSync(result.worktreeRoot,{recursive:true,force:true});});
});
test('oracle drift, empty assertions, output spoofing, skips and timeout remain rejected',t=>{
 for(const source of ["module.exports=()=>{};","module.exports=()=>console.log(JSON.stringify({id:'readonly-constructor',status:'passed',assertions:1}));","module.exports=()=>new Promise(()=>{});","module.exports=({assert})=>{assert.strictEqual(1,1);process.stderr.write('unhandled warning');};","module.exports=({assert})=>{require('assert').strictEqual=()=>{};assert.strictEqual(1,2);};"]){
  const root=project(t,{'quality/readonly.cjs':source}),definition=captureRepairChallenges(root),result=runRepairChallenges(root,definition,{sourcePaths:['src/value.js'],timeoutMs:100,deadline:performance.now()+2000});assert.equal(result.accepted,false);assert.equal(result.runs.length,1);
 }
 const root=project(t),definition=captureRepairChallenges(root);write(root,'quality/readonly.cjs','module.exports=()=>{};');const result=runRepairChallenges(root,definition,{sourcePaths:['src/value.js']});assert.equal(result.accepted,false);assert.match(result.reasons[0],/oracle-drift/);
});
test('runtime and installed oracle inputs must remain exact; repeated source identities are required',t=>{
 const root=project(t),definition=captureRepairChallenges(root),runtime=captureChallengeRuntime();runtime.sha256='a'.repeat(64);assert.equal(runRepairChallenges(root,definition,{sourcePaths:['src/value.js'],runtime}).accepted,false);
 const before=captureRepairState(root),result=runRepairChallenges(root,definition,{sourcePaths:['src/value.js'],assertFresh:()=>assert.equal(captureRepairState(root).scope.fingerprint,before.scope.fingerprint)});assert.equal(result.accepted,true);assert.equal(assessRepairChallenges([result,result],[result,result]).accepted,true);assert.equal(assessRepairChallenges([result],[result,result]).accepted,false);
 const drift={...result,source:[{file:'src/value.js',sha256:'a'.repeat(64),bytes:1}]};assert.equal(assessRepairChallenges([result,result],[result,drift]).accepted,false);
 const spoof={...result,runs:[result.runs[0],result.runs[0]]};assert.equal(assessRepairChallenges([result,result],[spoof,spoof]).accepted,false);assert.equal(assessRepairChallenges(undefined,[]).accepted,false);
});

test('captured assertion intrinsics survive imported source changing Reflect and Map dispatch',t=>{
 for(const source of ["Reflect.apply=()=>{};export const value=1;","Map.prototype.get=()=>()=>{};export const value=1;"]){
  const root=project(t,{'src/value.js':source,'quality/readonly.cjs':"module.exports=async ({assert,root})=>{await import(require('url').pathToFileURL(root+'/src/value.js').href);assert(false);};"});
  const result=runRepairChallenges(root,captureRepairChallenges(root),{sourcePaths:['src/value.js'],timeoutMs:2000});assert.equal(result.accepted,false);assert.equal(result.runs[0].observed?.error?.name,'AssertionError');
 }
});
