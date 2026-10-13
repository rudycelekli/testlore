import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fixture,commit,write,git} from './helpers.js';
import {run} from '../src/runner.js';
import {improve} from '../src/improvement.js';
import {verifyInstalledTypecheckRawEvidence} from '../scripts/packed-evidence.js';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');

test('native-backed raw compiler evidence rejects contradictory archive result claims',async t=>{
 const root=fixture(t,{'package.json':{type:'module'},'.gitignore':'node_modules/\n.tddswarm/\n',
  'src/value.ts':'export const value: string = 42;\n',
  'tsconfig.json':{compilerOptions:{strict:true,noEmit:true,module:'NodeNext',moduleResolution:'NodeNext',target:'ES2022'},files:['src/value.ts']},
  'test/value.test.mjs':"import test from 'node:test';import assert from 'node:assert/strict';import {value} from '../src/value.ts';test('ordinary value',()=>assert.equal(value,42));",
  'tddswarm.config.json':{adapter:'node',runner:[process.execPath,'--experimental-strip-types','--no-warnings','--test','{files}'],plugins:{typescript:{enabled:true}}}});
 fs.mkdirSync(path.join(root,'node_modules'));fs.cpSync(path.resolve('node_modules/typescript'),path.join(root,'node_modules/typescript'),{recursive:true});commit(root);
 const reports={};reports['setup-fault']=run(root,{full:true,capture:true});
 write(root,'src/value.ts','export const value: number = 42;\n');reports['healthy-shadow']=run(root,{full:true,capture:true});
 commit(root);
 const improved=await improve(root,{patch:{files:[{path:'test/boundary.test.mjs',content:"import test from 'node:test';import assert from 'node:assert/strict';import {value} from '../src/value.ts';test('independent numeric boundary',()=>assert.equal(value+1,43));"}],requirements:'Independent numeric contract: value is42 and addingone yields43.',review:{accepted:true,findings:[],oracle:{independent:true,basis:['Independent public numeric contract.']}}}});
 t.after(()=>{try{git(root,'worktree','remove','--force',improved.worktreeRoot);}catch{}fs.rmSync(improved.worktreeRoot,{recursive:true,force:true});});
 assert.equal(improved.status,'ready-for-review',improved.error);
 write(root,'tsconfig.json',{compilerOptions:{noCheck:true,noEmit:true},files:['src/value.ts']});reports['unsupported-no-check']=run(root,{full:true,capture:true});
 // Synthetic installation envelope only. These real source executions test
 // parser admission; packed-proof independently exercises the installed CLI.
 const directory=path.join(root,'.tddswarm/raw-type-evidence');fs.mkdirSync(directory);
 const envelope={verified:true,productionInstalled:true,setupEnabled:true,providerCalls:0,archiveSha256:'a'.repeat(64),installedCliSha256:'b'.repeat(64),compilerVersion:'6.0.3',outcomes:[]};
 for(const [id,report]of Object.entries(reports)){
  const check=report.typecheck,bytes=JSON.stringify(report);fs.writeFileSync(path.join(directory,id+'.json'),bytes);
  envelope.outcomes.push({id,exitCode:report.exitCode,nativeExitCode:report.nativeExitCode,status:check.status,complete:check.complete,
   implementationCount:check.implementationFiles.length,errorCodes:check.diagnostics.filter(row=>row.category==='error').map(row=>row.code),rawSha256:hash(bytes)});
 }
 const improvedBytes=JSON.stringify(improved);fs.writeFileSync(path.join(directory,'improvement-ready.json'),improvedBytes);
 envelope.improvement={status:improved.status,verified:improved.typecheckVerified,nativeCases:2,sha:improved.sha,sourceHead:improved.sourceHead,originalCallerUnchanged:true,originalAssertionsUnchanged:true,physicalDependencies:true,rawSha256:hash(improvedBytes)};
 assert.equal(verifyInstalledTypecheckRawEvidence(envelope,directory),true);
 const healthy=reports['healthy-shadow'];
 for(const mutate of [r=>{r.typecheck.signal='SIGKILL';},r=>{r.typecheck.errorCode='ETIMEDOUT';},r=>{r.typecheck.exitCode=2;},
  r=>{r.typecheck.binding=null;},r=>{r.complete=false;},r=>{r.nativeComplete=false;},r=>{r.tests=[{status:'passed'}];},r=>{r.typecheck.binding.provenance.fingerprint='0'.repeat(64);}]){
  const changed=structuredClone(healthy);mutate(changed);const bytes=JSON.stringify(changed),receipt=structuredClone(envelope);
  fs.writeFileSync(path.join(directory,'healthy-shadow.json'),bytes);receipt.outcomes[1].rawSha256=hash(bytes);
  assert.equal(verifyInstalledTypecheckRawEvidence(receipt,directory),false);
 }
 fs.writeFileSync(path.join(directory,'healthy-shadow.json'),JSON.stringify(healthy));
 for(const mutate of [r=>{r.fullRun.provenance.revision=r.sourceHead;},r=>{r.fullRun.typecheck.signal='SIGKILL';},r=>{r.typecheckVerified=false;},r=>{r.validation.qualityReady=false;},r=>{r.fullRun.tests.pop();},r=>{r.fullRun.tests[0].status='failed';},r=>{r.typecheckObligation.enabled=false;}]){
  const changed=structuredClone(improved);mutate(changed);const bytes=JSON.stringify(changed),receipt=structuredClone(envelope);
  fs.writeFileSync(path.join(directory,'improvement-ready.json'),bytes);receipt.improvement.rawSha256=hash(bytes);
  assert.equal(verifyInstalledTypecheckRawEvidence(receipt,directory),false);
 }
});
