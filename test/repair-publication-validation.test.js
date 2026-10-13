import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fixture,write,commit,git,twoModules} from './helpers.js';
import {challengeFiles} from './repair-challenge-fixtures.js';
import {stageRepair,validateRepair,applyRepair,verifyAppliedRepairValidation} from '../src/repair-candidates.js';
import {repair} from '../src/repair.js';
import {publishImprovement} from '../src/pull-request.js';
import {captureNativeRepairRuntime} from '../src/repair-challenges.js';
const requirements='a is one; preserve b as two.';
const review={accepted:true,findings:[],oracle:{independent:true,basis:[requirements]}};
function project(t,challenges=true){const root=fixture(t,{...twoModules,...(challenges?challengeFiles:{}),'.gitignore':'.tddswarm/\nnode_modules/\n','src/a.js':'export const a=9;','node_modules/retained/index.cjs':'module.exports=1;','tddswarm.requirements.md':requirements,'tddswarm.config.json':challenges?{repair:{challenges:'quality/challenges.json'}}:{}});commit(root);return root;}
function qualified(root){const candidate=stageRepair(root,{files:[{path:'src/a.js',content:'export const a=1;'}],sourcePaths:['src/a.js'],requirements,review});const result=validateRepair(root,candidate.candidatePath,{timeoutMs:3000,totalTimeoutMs:30000});assert.equal(result.accepted,true,result.reasons.join(','));applyRepair(root,candidate.candidatePath);return {candidate,result};}
test('post-apply validation authenticates original evidence across a new fix commit',t=>{
 const root=project(t),{candidate,result}=qualified(root);git(root,'add','src/a.js');git(root,'commit','-m','Applied source fix');const verified=verifyAppliedRepairValidation(root,candidate.candidatePath);assert.deepEqual(verified.receipt,JSON.parse(JSON.stringify(result)));assert.equal(verified.manifest.files[0].path,'src/a.js');
});
test('changed installed dependencies, ignored oracles, file modes and applied source reject publication freshness',t=>{
 const root=project(t),{candidate}=qualified(root),dependency=path.join(root,'node_modules/retained/index.cjs'),original=fs.readFileSync(dependency);
 fs.writeFileSync(dependency,'module.exports=999;');assert.throws(()=>verifyAppliedRepairValidation(root,candidate.candidatePath),/installed dependencies changed/);fs.writeFileSync(dependency,original);
 write(root,'ignored-oracle.txt','new protected input');assert.throws(()=>verifyAppliedRepairValidation(root,candidate.candidatePath),/protected project inputs/);fs.unlinkSync(path.join(root,'ignored-oracle.txt'));
 const source=path.join(root,'src/a.js'),mode=fs.statSync(source).mode&0o777;fs.chmodSync(source,mode^0o100);assert.throws(()=>verifyAppliedRepairValidation(root,candidate.candidatePath),/protected project inputs/);fs.chmodSync(source,mode);
 fs.writeFileSync(source,'export const a=999;');assert.throws(()=>verifyAppliedRepairValidation(root,candidate.candidatePath),/source bindings|protected project inputs/);
});
test('altered validation bodies and replayed applied records cannot substitute authenticated evidence',t=>{
 const root=project(t),{candidate}=qualified(root),validation=path.join(candidate.directory,'validation.json'),original=fs.readFileSync(validation),changed=JSON.parse(original);
 changed.challenges.candidate[0].runs[0].observed.assertions=999;fs.writeFileSync(validation,JSON.stringify(changed));assert.throws(()=>verifyAppliedRepairValidation(root,candidate.candidatePath),/Authenticated accepted/);fs.writeFileSync(validation,original);
 const applied=path.join(candidate.directory,'applied.json'),record=JSON.parse(fs.readFileSync(applied));record.validationIntegrity='a'.repeat(64);fs.writeFileSync(applied,JSON.stringify(record));assert.throws(()=>verifyAppliedRepairValidation(root,candidate.candidatePath),/Applied repair record/);
});
test('legacy direct suite-only validation cannot qualify applied production publication',t=>{
 const root=project(t,false),{candidate,result}=qualified(root);assert.equal(result.qualification,'original-suite-only');assert.throws(()=>verifyAppliedRepairValidation(root,candidate.candidatePath),/independent repair challenges/);
 const supplied={kind:'source-repair',status:'ready-for-review',candidate,validation:result,fullRun:{complete:true,exitCode:0,tests:[{status:'passed'}]},sha:git(root,'rev-parse','HEAD').trim(),branch:'tddswarm/repair-forged',worktree:root};assert.throws(()=>publishImprovement(root,supplied),/repair challenges|regression challenges|protected project/);
});
test('a forged public validation object never reaches remote authentication or branch push',async t=>{
 // This positive setup qualifies publication authentication, not campaign
 // timeout behavior. Keep its budget bounded while allowing full-suite load.
 const root=project(t),result=await repair(root,{patch:{files:[{path:'src/a.js',content:'export const a=1;'}],review},sourcePaths:['src/a.js'],deadlineMs:60000});t.after(()=>fs.rmSync(result.worktreeRoot,{recursive:true,force:true}));assert.equal(result.status,'ready-for-review',JSON.stringify(result));
 const fake=structuredClone(result);fake.validation.challenges.candidate[0].runs[0].observed.assertions++;
 assert.throws(()=>publishImprovement(root,fake),/authenticated|Authenticated|validation.*differ|receipt.*differ/);
});
test('foreign node wrappers cannot qualify and replacing an admitted native alias vetoes publication',t=>{
 const tools=fixture(t),runner=path.join(tools,'node'),root=project(t);
 fs.writeFileSync(runner,'#!/bin/sh\nexec '+JSON.stringify(process.execPath)+' "$@"\n',{mode:0o700});
 write(root,'tddswarm.config.json',{runner:[runner,'--test','{files}'],repair:{challenges:'quality/challenges.json'}});
 assert.equal(captureNativeRepairRuntime(root).status,'unsupported');
 const rejected=stageRepair(root,{files:[{path:'src/a.js',content:'export const a=1;'}],sourcePaths:['src/a.js'],requirements,review});
 const rejectedValidation=validateRepair(root,rejected.candidatePath,{timeoutMs:3000,totalTimeoutMs:30000});
 assert.equal(rejectedValidation.accepted,false);assert.match(rejectedValidation.reasons.join(','),/current-node|required|assertion-evidence-unsupported/);assert.equal(rejectedValidation.baseline.length,0);
 fs.unlinkSync(runner);fs.symlinkSync(process.execPath,runner);
 assert.equal(captureNativeRepairRuntime(root).status,'qualified');
 const {candidate}=qualified(root);
 assert.doesNotThrow(()=>verifyAppliedRepairValidation(root,candidate.candidatePath));
 fs.unlinkSync(runner);fs.writeFileSync(runner,'#!/bin/sh\nexit 99\n',{mode:0o700});
 assert.throws(()=>verifyAppliedRepairValidation(root,candidate.candidatePath),/native runtime changed/);
});
test('external preloads, runtime injection and unbounded flags remain unsupported',t=>{
 const root=project(t);
 for(const config of [{runner:[process.execPath,'--test','--require=/tmp/unbound.cjs','{files}']},{runner:[process.execPath,'--test','--test-concurrency=999','{files}']},{runner:[process.execPath,'--test','--test-timeout=120001','{files}']},{runner:[process.execPath,'--test','{files}'],env:{NODE_OPTIONS:'--require=/tmp/unbound.cjs'}},{runner:[process.execPath,'--test','{files}'],env:{NODE_PATH:'/tmp/unbound'}}])assert.equal(captureNativeRepairRuntime(root,config).status,'unsupported');
 for(const name of ['LD_PRELOAD','LD_AUDIT','LD_LIBRARY_PATH','DYLD_INSERT_LIBRARIES','DYLD_LIBRARY_PATH'])assert.equal(captureNativeRepairRuntime(root,{runner:[process.execPath,'--test','{files}'],env:{[name]:'/tmp/unbound'}}).status,'unsupported');
 assert.equal(captureNativeRepairRuntime(root,{runner:[process.execPath,'--test','--test-concurrency=2','--test-timeout=3000','--unhandled-rejections=strict','{files}']}).status,'qualified');
});
