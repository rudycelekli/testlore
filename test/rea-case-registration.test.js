import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {runInNewContext} from 'node:vm';
import {REA_CASE_FILE,REA_CASE_SOURCE_SHA256,WINDOWS_DECLARATION,registrationHash,plainParameterDigest,registerReaWindowsCases,transformReaWindowsCases,assessReaRegistrations,observeReaCaseRegistrations,reaRegistrationReporterSource,reaRegistrationRuntimeSource} from '../scripts/rea-case-registration.js';
const original=fs.readFileSync(new URL('./fixtures/rea-case-registration/sessionPathInputs.test.ts.txt',import.meta.url),'utf8');
function fixture(){
 const close={},exported={};const table=[[close,{snapshot_path:'C:\\rea\\analysis.json'}],[close,{snapshot_path:'C:/rea/analysis.json'}],[exported,{path:'C:/rea/bundle.json'}]];
 const rows=table.map((row,index)=>{const binding={importBinding:index<2?'closeBinaryInputSchema':'exportEvidenceBundleInputSchema',file:index<2?'src/contracts/sessionLifecycleInputs.ts':'src/contracts/sessionToolContracts.ts',sourceSha256:'c'.repeat(64)};const value={file:REA_CASE_FILE,sourceSha256:REA_CASE_SOURCE_SHA256,declarationSha256:registrationHash(WINDOWS_DECLARATION),declarationRowSha256:registrationHash(WINDOWS_DECLARATION.split('\n')[index+1]),inputSha256:plainParameterDigest(row[1]),binding};return {...value,registrationId:registrationHash(value)};});
 const manifest={kind:'rea-windows-plain-input-registration-overlay',sourceSha256:REA_CASE_SOURCE_SHA256,rows,file:REA_CASE_FILE,platform:'linux'};
 const observations=rows.map((row,index)=>({rawName:'Windows absolute path forms accepts ZodObject { …(16) }',nativeTaskId:`native-${index}`,nativeFile:'/isolated/'+REA_CASE_FILE,nativeProject:'adapters',taskLocation:{line:160+index,column:5},status:'skipped',registration:{...row,actualBindingReferenceVerified:true,actualPlainInputVerified:true}}));
 return {manifest,observations,table,bindings:{closeBinaryInputSchema:close,exportEvidenceBundleInputSchema:exported}};
}
test('source-bound transform retains original callback assertions and raw formatter',()=>{
 assert.equal(registrationHash(original),REA_CASE_SOURCE_SHA256);const {manifest}=fixture();const transformed=transformReaWindowsCases(original,manifest);
 assert.match(transformed,/__testloreRegisterReaWindowsCases\(it,/);assert.match(transformed,/"accepts %o"/);
 assert.equal(transformed.split('expect(schema.safeParse(input).success).toBe(true);').length,2);
 assert.equal(registrationHash(original),REA_CASE_SOURCE_SHA256);assert.throws(()=>transformReaWindowsCases('// changed\n'+original,manifest),/exact source/);
});
test('actual table rows carry their plain inputs and original opaque reference attestation',()=>{
 const {manifest,table,bindings}=fixture(),calls=[];const callback=()=>{};
 const it={each:rows=>(title,options,fn)=>calls.push({rows,title,options,fn})};registerReaWindowsCases(it,table,'accepts %o',callback,bindings,manifest);
 assert.equal(calls.length,3);for(let i=0;i<3;i++){assert.equal(calls[i].rows[0],table[i]);assert.equal(calls[i].fn,callback);assert.equal(calls[i].title,'accepts %o');assert.equal(calls[i].options.meta.testloreReaRegistration.registrationId,manifest.rows[i].registrationId);}
 const changed=fixture();changed.table[2][0]={};assert.throws(()=>registerReaWindowsCases(it,changed.table,'accepts %o',callback,changed.bindings,changed.manifest),/binding changed/);
 const parameter=fixture();parameter.table[0][1]={snapshot_path:'other'};assert.throws(()=>registerReaWindowsCases(it,parameter.table,'accepts %o',callback,parameter.bindings,parameter.manifest),/parameters/);
 assert.throws(()=>registerReaWindowsCases(it,table,'accepts %#',callback,bindings,manifest),/Unsupported/);
});
test('opaque objects, accessors, cycles, arrays and unsupported numbers cannot pose as plain inputs',()=>{
 for(const value of [new Date(),{get path(){throw Error('must not run');}},[1],{path:undefined},{path:Infinity},{path:-0},{[Symbol('path')]:1}])assert.throws(()=>plainParameterDigest(value),/unsupported|Unsupported|Opaque|Accessor|Array/);
 const cycle={};cycle.path=cycle;assert.throws(()=>plainParameterDigest(cycle),/Unsupported/);
 assert.equal(plainParameterDigest({b:'y',a:'x'}),plainParameterDigest({a:'x',b:'y'}));
});
test('rendered title drift can coexist with independently bound skipped registrations',()=>{
 const {manifest,observations}=fixture(),first=assessReaRegistrations(manifest,observations);assert.equal(first.complete,true);
 const second=assessReaRegistrations(manifest,observations.map(row=>({...row,rawName:row.rawName.replace('(16)','(18)')})));assert.equal(second.complete,true);
 assert.equal(first.omissionAuthority,false);assert.equal(second.inputEquivalenceClaim,false);assert.notEqual(first.observations[0].rawName,second.observations[0].rawName);
 assert.equal(second.observations[0].registration.registrationId,first.observations[0].registration.registrationId);
});
test('missing, duplicated, changed or executed registrations fail skip-only qualification',()=>{
 const {manifest,observations}=fixture();
 const corruptions=[observations.slice(0,2),[observations[0],observations[0],observations[2]],observations.map((o,i)=>i===0?{...o,status:'passed'}:o),observations.map((o,i)=>i===0?{...o,taskLocation:null}:o),observations.map((o,i)=>i===0?{...o,nativeFile:'/other.test.ts'}:o),observations.map((o,i)=>i===1?{...o,nativeTaskId:observations[0].nativeTaskId}:o),observations.map((o,i)=>i===0?{...o,registration:{...o.registration,inputSha256:'d'.repeat(64)}}:o)];
 for(const rows of corruptions)assert.equal(assessReaRegistrations(manifest,rows).complete,false);
 assert.equal(assessReaRegistrations({...manifest,platform:'win32'},observations).complete,false);
});
test('receipt collection requires exactly one native output and independently rechecks profile',()=>{
 const {manifest,observations}=fixture(),receipt=assessReaRegistrations(manifest,observations),line='TESTLORE_REA_CASE_REGISTRATION '+JSON.stringify(receipt);
 assert.equal(observeReaCaseRegistrations(line,manifest).independentlyRechecked,true);
 assert.throws(()=>observeReaCaseRegistrations(line+'\n'+line,manifest),/Unique/);
 assert.throws(()=>observeReaCaseRegistrations(line),/expected/);
 const forged={...receipt,observations:observations.slice(0,2)};assert.throws(()=>observeReaCaseRegistrations('TESTLORE_REA_CASE_REGISTRATION '+JSON.stringify(forged),manifest),/differs/);
 assert.match(reaRegistrationReporterSource(manifest),/onTestModuleCollected/);assert.match(reaRegistrationReporterSource(manifest),/collection-to-result-registration-mismatch/);
});


test('Vitest 5 reported-task hooks bind collection to outcomes and reject changed native linkage',()=>{
 const {manifest,observations}=fixture(),logs=[];
 const source=reaRegistrationReporterSource(manifest).replace(/^import[^\n]*\n/,'').replace('export default class ReaRegistrationReporter','class ReaRegistrationReporter')+'\nthis.Reporter=ReaRegistrationReporter;';
 const sandbox={assessReaRegistrations,console:{log:line=>logs.push(line)}};runInNewContext(source,sandbox);
 const module={moduleId:'/isolated/'+REA_CASE_FILE,project:{name:'domain'}};let state='pending';
 const tasks=observations.map(o=>({meta:()=>({testloreReaRegistration:o.registration}),parent:{type:'suite',name:'Windows absolute path forms',parent:{type:'module'}},name:'accepts ZodObject { …(16) }',fullName:'Windows absolute path forms > accepts ZodObject { …(16) }',id:o.nativeTaskId,module,project:module.project,location:o.taskLocation,result:()=>({state})}));module.children={allTests:function*(){yield* tasks;}};
 const reporter=new sandbox.Reporter();reporter.onTestModuleCollected(module);state='skipped';reporter.onTestRunEnd([module]);
 const receipt=observeReaCaseRegistrations(logs[0],manifest);assert.equal(receipt.observations[0].rawReportedFullName,tasks[0].fullName);assert.equal(receipt.observations[0].rawName,observations[0].rawName);
 logs.length=0;const changed=new sandbox.Reporter();changed.onTestModuleCollected(module);tasks[0].id='changed';changed.onTestRunEnd([module]);assert.throws(()=>observeReaCaseRegistrations(logs[0],manifest),/incomplete/);
 logs.length=0;const absent=new sandbox.Reporter();absent.onTestRunEnd([module]);assert.throws(()=>observeReaCaseRegistrations(logs[0],manifest),/incomplete/);
});

test('native Vitest carries actual row metadata from collection through skipped outcomes in a controlled transport fixture',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'testlore-rea-registration-native-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const repo=fileURLToPath(new URL('../',import.meta.url)),cli=path.join(repo,'node_modules/vitest/vitest.mjs');
 assert.equal(fs.existsSync(cli),true,'Required native Vitest dependency is missing; this check cannot be skipped.');
 assert.equal(JSON.parse(fs.readFileSync(path.join(repo,'node_modules/vitest/package.json'),'utf8')).version,'5.0.2','The controlled native producer transport contract is pinned to root Vitest 5.0.2.');
 fs.symlinkSync(path.join(repo,'node_modules'),path.join(root,'node_modules'),'dir');
 fs.writeFileSync(path.join(root,'package.json'),JSON.stringify({type:'module'}));fs.mkdirSync(path.join(root,'src/contracts'),{recursive:true});
 const {manifest}=fixture();manifest.platform=process.platform;
 fs.writeFileSync(path.join(root,'src/contracts/testlore.rea-case-registration.runtime.mjs'),reaRegistrationRuntimeSource());
 const tableSource=WINDOWS_DECLARATION.slice('it.each('.length,WINDOWS_DECLARATION.indexOf('])("accepts')+1);
 const source=`import {describe,it} from 'vitest';import {z} from 'zod';
import {registerReaWindowsCases} from './testlore.rea-case-registration.runtime.mjs';
const closeBinaryInputSchema=z.strictObject({snapshot_path:z.string().optional()});
const exportEvidenceBundleInputSchema=z.strictObject({path:z.string()});
describe.skip('controlled metadata transport only',()=>{
registerReaWindowsCases(it,${tableSource},'accepts %o',()=>{}, {closeBinaryInputSchema,exportEvidenceBundleInputSchema},${JSON.stringify(manifest)});
});`;
 fs.writeFileSync(path.join(root,REA_CASE_FILE),source);
 fs.writeFileSync(path.join(root,'registration-reporter.mjs'),reaRegistrationReporterSource(manifest));
 fs.writeFileSync(path.join(root,'vitest.config.mjs'),"export default {test:{includeTaskLocation:true,include:['src/contracts/sessionPathInputs.test.ts'],maxWorkers:1,reporters:['default','./registration-reporter.mjs']}};");
 const env={PATH:process.env.PATH,HOME:root,TMPDIR:os.tmpdir()};
 const result=spawnSync(process.execPath,[cli,'run','--config','vitest.config.mjs'],{cwd:root,env,encoding:'utf8',timeout:30000,maxBuffer:2*1024*1024});
 assert.equal(result.error,undefined,result.error?.message);assert.equal(result.status,0,result.stdout+result.stderr);
 const receipt=observeReaCaseRegistrations(result.stdout,manifest);assert.equal(receipt.observations.length,3);assert.equal(receipt.independentlyRechecked,true);assert.equal(receipt.omissionAuthority,false);
 // This exercises real transport, not the pinned REA source or its dependency environment.
});

test('frozen raw table literal and metadata digest preserve the actual single Windows path separators',()=>{
 const {manifest}=fixture();const tableSource=WINDOWS_DECLARATION.slice('it.each('.length,WINDOWS_DECLARATION.indexOf('])("accepts')+1);
 const actual=runInNewContext('('+tableSource+')',{closeBinaryInputSchema:{},exportEvidenceBundleInputSchema:{}});
 const input=JSON.parse(JSON.stringify(actual[0][1]));
 assert.equal(input.snapshot_path,'C:'+String.fromCharCode(92)+'rea'+String.fromCharCode(92)+'analysis.json');
 assert.equal(plainParameterDigest(input),manifest.rows[0].inputSha256);
});

test('actual original native receipt archive replays only its captured skipped scope',async t=>{
 const {verifyCapturedReaRegistrations}=await import('../scripts/rea-registration-replay.js');const report=verifyCapturedReaRegistrations();assert.equal(report.complete,true);assert.equal(report.arms,2);assert.equal(report.actualSkippedRegistrationsPerArm,3);assert.equal(report.omissionAuthority,false);assert.equal(report.inputEquivalenceClaim,false);
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'testlore-rea-native-replay-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));fs.cpSync(fileURLToPath(new URL('../benchmarks/rea-case-registration/native-pass-20261009/',import.meta.url)),root,{recursive:true});
 fs.appendFileSync(path.join(root,'native-0/stdout.log'),'changed');assert.throws(()=>verifyCapturedReaRegistrations(root),/member changed/);
});
