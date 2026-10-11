import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {execFileSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
import {fixture,write} from './helpers.js';
import {captureReaObservation,assertReaObservation,createReaObservationPlugin,createReaObservationReporter,validateReaObservationEvidence} from '../src/rea-observation.js';
import {REA_CASE_FILE,registrationHash} from '../src/rea-case-registration.js';
import {run,runUnifiedNative} from '../src/runner.js';import {openNativeSession} from '../src/native-session.js';
const upstreamRevision='3dcb732da33f6ceef597506b14a4536f1c9aff96',profile={profile:'rea-skipped-registration-shadow-v1',upstreamRevision};
const original=fs.readFileSync(new URL('./fixtures/rea-case-registration/sessionPathInputs.test.ts.txt',import.meta.url),'utf8');
function application(t){
 const root=fs.realpathSync(fixture(t,{'package.json':{type:'module'},'node_modules/vitest/package.json':{name:'vitest',version:'5.0.3'},'node_modules/vitest/vitest.mjs':'throw Error("constructed runtime admission only; never execute");'}));
 for(const name of ['sessionPathInputs','sessionLifecycleInputs','sessionToolContracts'])write(root,`src/contracts/${name}.ts`,fs.readFileSync(new URL(`./fixtures/rea-case-registration/${name}${name==='sessionPathInputs'?'.test':''}.ts.txt`,import.meta.url),'utf8'));
 fs.renameSync(path.join(root,'src/contracts/sessionPathInputs.ts'),path.join(root,REA_CASE_FILE));
 const archive=fileURLToPath(new URL('../benchmarks/rea-case-registration/native-pass-20261009/original-artifact.zip',import.meta.url));
 write(root,'package-lock.json',execFileSync('unzip',['-p',archive,'package-lock.json'],{maxBuffer:1024*1024}).toString());
 const config={adapter:'vitest',discovery:'native',executionMode:'shadow',reaObservation:profile,runner:[process.execPath,path.join(root,'node_modules/vitest/vitest.mjs'),'run','{files}']};write(root,'tddswarm.config.json',config);return {root,config};
}
test('reviewed REA profile binds exact source, original lock and runtime; constructed admission is not native qualification',t=>{
 const {root,config}=application(t),binding=captureReaObservation(root,config,config.runner);
 assert.equal(binding.shadowOnly,true);assert.equal(binding.omissionAuthority,false);assert.equal(binding.vitestVersion,'5.0.3');assert.equal(binding.manifest.rows.length,3);
 assertReaObservation(binding,captureReaObservation(root,config,config.runner));
 for(const change of [{executionMode:'selective'},{reaObservation:{...profile,extra:true}},{reaObservation:{...profile,upstreamRevision:'a'.repeat(40)}},{vitestCases:{}}])assert.throws(()=>captureReaObservation(root,{...config,...change},config.runner),/exact reviewed shadow/);
 fs.appendFileSync(path.join(root,'package-lock.json'),' ');assert.throws(()=>captureReaObservation(root,config,config.runner),/original lock/);
});
test('fresh REA source/runtime binding rejects stale captures and unsupported runtime',t=>{
 const {root,config}=application(t),binding=captureReaObservation(root,config,config.runner);
 write(root,'node_modules/vitest/package.json',{name:'vitest',version:'5.0.2'});assert.throws(()=>captureReaObservation(root,config,config.runner),/5.0.3/);
 write(root,'node_modules/vitest/package.json',{name:'vitest',version:'5.0.3',changed:true});assert.throws(()=>assertReaObservation(binding,captureReaObservation(root,config,config.runner)),/binding changed/);
 fs.appendFileSync(path.join(root,REA_CASE_FILE),'\n// source drift');assert.throws(()=>captureReaObservation(root,config,config.runner),/pinned profile/);
});
test('REA profile cannot silently use legacy execution or request selective execution',async t=>{
 const {root,config}=application(t);const legacy=run(root,{capture:true});assert.equal(legacy.executed,false);assert.equal(legacy.exitCode,2);assert.match(legacy.error,/legacy execution/);
 const selective=await runUnifiedNative(root,{capture:true,selective:true});assert.equal(selective.executed,false);assert.match(selective.error,/shadow-only/);
 await assert.rejects(openNativeSession(root,config,{selective:true}),/shadow-only/);
});
test('internal REA observer preserves assertion body and exact original metadata while rejecting source drift',t=>{
 const {root,config}=application(t),binding=captureReaObservation(root,config,config.runner),plugin=createReaObservationPlugin(binding);
 const transformed=plugin.transform(original,path.join(root,REA_CASE_FILE));assert.match(transformed.code,/__testloreRegisterReaWindowsCases/);assert.match(transformed.code,/src\/rea-case-registration.js/);
 assert.equal(transformed.code.split('expect(schema.safeParse(input).success).toBe(true);').length,2);assert.equal(plugin.transform(original,path.join(root,'other.test.ts')),undefined);
 assert.throws(()=>plugin.transform(original+'\n',path.join(root,REA_CASE_FILE)),/exact source/);assert.notEqual(plugin,createReaObservationPlugin(binding),'A same-name plugin is a different instance and cannot obtain trusted identity.');
});
test('REA reporter retains actual raw metadata and optional sidecar rejects tampered native outcome binding',()=>{
 const directory=fileURLToPath(new URL('../benchmarks/rea-case-registration/native-pass-20261009/',import.meta.url));const manifest=JSON.parse(fs.readFileSync(path.join(directory,'profile.json'))).manifest,receipt=JSON.parse(fs.readFileSync(path.join(directory,'registration-0.json'))),native=JSON.parse(fs.readFileSync(path.join(directory,'native-0/native.json')));
 const root=path.dirname(path.dirname(path.dirname(native.testResults[0].name))),binding={root,manifest};const logs=[],prior=console.log;console.log=line=>logs.push(line);
 try{const reporter=createReaObservationReporter(binding),module={moduleId:path.join(root,REA_CASE_FILE),project:{name:'domain'}};let status='pending';const tasks=receipt.observations.map(row=>({meta:()=>({testloreReaRegistration:row.registration}),parent:{type:'suite',name:'Windows absolute path forms',parent:{type:'module'}},name:row.rawName.replace('Windows absolute path forms ',''),fullName:row.rawReportedFullName,id:row.nativeTaskId,module,project:module.project,location:row.taskLocation,result:()=>({state:status})}));module.children={allTests:function*(){yield* tasks;}};
 reporter.onTestModuleCollected(module);status='skipped';reporter.onTestRunEnd([module],[],'passed');assert.equal(reporter.receipt.complete,true);assert.deepEqual(reporter.receipt.observations,receipt.observations);
 const sidecar=validateReaObservationEvidence(binding,reporter.receipt,native);assert.equal(sidecar.complete,true);assert.equal(sidecar.omissionAuthority,false);assert.equal(sidecar.nativeFile.assertionResults.length,17);
 const changed=structuredClone(native);changed.testResults[0].assertionResults.find(row=>row.status==='skipped').meta.testloreReaRegistration.inputSha256='d'.repeat(64);assert.throws(()=>validateReaObservationEvidence(binding,reporter.receipt,changed),/differ/);
 const incomplete=createReaObservationReporter(binding);incomplete.onTestRunEnd([module],[],'passed');assert.equal(incomplete.receipt.complete,false);
 }finally{console.log=prior;}
 assert.equal(logs.length,2);assert.equal(registrationHash(manifest),'3bc453acdf66eb07d8848efb7f7c013d36dedb96a2366341daab5a1ceeccb08b');
});
