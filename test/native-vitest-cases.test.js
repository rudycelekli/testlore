import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fixture,write,commit} from './helpers.js';
import {captureNativeVitestCases} from '../src/native-vitest-cases.js';
import {openNativeSession,sessionPlanning} from '../src/native-session.js';
import {execute,normalizeUnifiedExecution} from '../src/execution.js';
import {runUnifiedNative} from '../src/runner.js';
import {validateVitestCaseCapture} from '../src/reporters/vitest-cases.js';
import {E2E_LOCATOR_REVISION} from '../src/vitest-case-contracts.js';
const cli=path.join(path.dirname(createRequire(import.meta.url).resolve('vitest/package.json')),'vitest.mjs');
const original=fs.readFileSync(new URL('./fixtures/e2e-locator-registration/original.test.txt',import.meta.url),'utf8');
function application(t,nested=true,runtimeCLI=cli){
 const root=fs.realpathSync(fixture(t,{'.gitignore':'node_modules/\n.tddswarm/\n','package.json':{type:'module'},'shared-settings.mjs':'export default 1;'}));
 const prefix=nested?'packages/e2e/':'',project=path.resolve(root,prefix);
 write(root,prefix+'package.json',{type:'module'});
 write(root,prefix+'tests/unit/locator-wait-for.test.ts',original);
 for(let index=0;index<173;index++)write(root,prefix+`tests/unit/case-${String(index).padStart(3,'0')}.test.ts`,`import {test,expect} from 'vitest';test('independent case ${index}',()=>expect(${index===0?'2':'1'}).toBe(1));`);
 write(root,prefix+'tests/integration/unrelated.test.ts',`import {test} from 'vitest';test('outside reviewed unit profile',()=>{});`);
 const importPath=nested?'../../shared-settings.mjs':'./shared-settings.mjs';
 write(root,prefix+'vitest.config.ts',`import value from '${importPath}';if(value!==1)throw Error('Shared config changed');export default {test:{projects:[{test:{name:'unit',pool:'forks',maxWorkers:1,include:['tests/unit/**/*.test.ts']}}]}};`);
 fs.symlinkSync(path.dirname(path.dirname(runtimeCLI)),path.join(root,'node_modules'),'dir');
 const config={adapter:'vitest',discovery:'native',runner:[process.execPath,runtimeCLI,'run',...(nested?['--root','packages/e2e']:[]),'--config',path.join(project,'vitest.config.ts'),'--maxWorkers=1','{files}'],vitestCases:{profile:'e2e-locator-runtime-v1',projectRoot:nested?'packages/e2e':'.',upstreamRevision:E2E_LOCATOR_REVISION}};
 write(root,'tddswarm.config.json',config);commit(root);return {root,project,prefix,config};
}

test('optional native observer preserves original CLI config and independently failing selected outcomes',async t=>{
 for(const nested of [true,false]){
  const {root,project,prefix,config}=application(t,nested),file=prefix+'tests/unit/case-000.test.ts',before=fs.readFileSync(path.join(project,'vitest.config.ts'));
  const baseline=execute(root,[file],{...config,vitestCases:undefined},{capture:true});assert.equal(baseline.complete,true,JSON.stringify(baseline));assert.equal(baseline.exitCode,1);
  const unsupported=execute(root,[file],config,{capture:true});assert.equal(unsupported.complete,false);assert.equal(unsupported.exitCode,2);assert.match(unsupported.nativeCaseEvidenceError,/exact reviewed standalone observer/);
  const session=await openNativeSession(root,config);assert.ok(session.token,session.unsupported);
  try{
   const batch=sessionPlanning(session.token,root);assert.equal(batch.discovery.files.length,174);assert.equal(batch.vitestCases.expectedFiles.length,174);
   assert.ok(batch.nativeCaseConfigurationInputs.some(input=>input.file==='shared-settings.mjs'));
   const observed=await session.execute([file]);assert.equal(observed.complete,true,JSON.stringify(observed));assert.equal(observed.exitCode,1);
   assert.equal(validateVitestCaseCapture(observed.nativeCaseEvidence).valid,true);
   assert.equal(observed.nativeCaseEvidence.omissionAuthority,false);
   assert.deepEqual(observed.nativeCaseEvidence.actualFiles,['tests/unit/case-000.test.ts']);
   assert.deepEqual(observed.tests.map(row=>[row.id,row.status]),baseline.tests.map(row=>[row.id,row.status]));
   assert.equal(observed.nativeCaseEvidenceBinding.profile.projectRoot,project);
   assert.deepEqual(fs.readFileSync(path.join(project,'vitest.config.ts')),before);
   const other=prefix+'tests/unit/case-001.test.ts',raw={success:true,numTotalTests:1,testResults:[{name:path.join(root,other),assertionResults:[{fullName:'independent case 1',title:'independent case 1',status:'passed'}]}]};
   const wrongScope=normalizeUnifiedExecution(root,[other],{...raw,nativeCaseEvidence:observed.nativeCaseEvidence,nativeCaseEvidenceBinding:observed.nativeCaseEvidenceBinding},{nativeExitCode:0});
   assert.equal(wrongScope.complete,true);assert.equal(wrongScope.exitCode,0);assert.equal(wrongScope.nativeCaseEvidence,undefined);assert.match(wrongScope.nativeCaseEvidenceError,/scope binding/);
   const differentProducer=structuredClone(observed.nativeCaseEvidenceBinding);differentProducer.profile.producerSha256[0]='0'.repeat(64);
   const correctRaw={...raw,testResults:[{name:path.join(root,file),assertionResults:[{fullName:'independent case 0',title:'independent case 0',status:'failed'}]}]};
   const wrongProducer=normalizeUnifiedExecution(root,[file],{...correctRaw,nativeCaseEvidence:observed.nativeCaseEvidence,nativeCaseEvidenceBinding:differentProducer},{nativeExitCode:1});
   assert.equal(wrongProducer.complete,true);assert.equal(wrongProducer.exitCode,1);assert.equal(wrongProducer.nativeCaseEvidence,undefined);
  }finally{await session.close();}
 }
});

test('native observer verifies omitted extends with its controller-selected runtime',async t=>{
 const supplied=process.env.TESTLORE_PINNED_VITEST_CLI||cli;
 const {root,config,prefix}=application(t,true,supplied),file=prefix+'tests/unit/case-000.test.ts';
 const native=execute(root,[file],{...config,vitestCases:undefined},{capture:true});assert.equal(native.complete,true);assert.equal(native.exitCode,1);
 const session=await openNativeSession(root,config);
 try{const observed=await session.execute([file]);assert.equal(observed.complete,true);assert.equal(observed.exitCode,1);assert.equal(validateVitestCaseCapture(observed.nativeCaseEvidence).valid,true);assert.deepEqual(observed.tests.map(row=>[row.id,row.status]),native.tests.map(row=>[row.id,row.status]));}finally{await session.close();}
});

test('standalone profile refuses an identical manifest at a different CLI installation origin',t=>{
 const {root,config,prefix}=application(t,false),installation=path.join(root,'other/node_modules/vitest');fs.mkdirSync(installation,{recursive:true});
 fs.copyFileSync(path.join(path.dirname(cli),'package.json'),path.join(installation,'package.json'));fs.copyFileSync(cli,path.join(installation,'vitest.mjs'));
 const report=execute(root,[prefix+'tests/unit/case-000.test.ts'],{...config,runner:[process.execPath,path.join(installation,'vitest.mjs'),'run','--config',path.join(root,'vitest.config.ts'),'{files}']},{capture:true});
 assert.equal(report.complete,false);assert.equal(report.exitCode,2);assert.match(report.nativeCaseEvidenceError,/differs from the bound native case runtime/);assert.deepEqual(report.executedFiles,[]);
});

test('reviewed observer rejects changed source, extra profile keys, roots and incorrect unit counts before startup',async t=>{
 const {root,config,prefix}=application(t);
 for(const profile of [{...config.vitestCases,projectRoot:'../outside'},{...config.vitestCases,extra:true},{...config.vitestCases,profile:'automatic'},{...config.vitestCases,upstreamRevision:'0'.repeat(40)}])assert.throws(()=>captureNativeVitestCases(root,{...config,vitestCases:profile},config.runner));
 write(root,prefix+'tests/unit/extra.test.ts',`import {test} from 'vitest';test('extra',()=>{});`);
 const count=await runUnifiedNative(root,{selective:true,capture:true});assert.equal(count.executed,false);assert.match(count.error,/exactly 174/);
 fs.rmSync(path.join(root,prefix+'tests/unit/extra.test.ts'));
 write(root,prefix+'tests/unit/locator-wait-for.test.ts',original+'\n');
 const changed=await runUnifiedNative(root,{selective:true,capture:true});assert.equal(changed.executed,false);assert.match(changed.error,/exact e2e source/);
});

test('live observer refuses actual native discovery outside its reviewed unit inventory',async t=>{
 const {root,config,prefix}=application(t);write(root,prefix+'vitest.config.ts',`export default {test:{name:'unit',pool:'forks',include:['tests/integration/*.test.ts']}};`);
 await assert.rejects(openNativeSession(root,config),/discovered unit inventory differs/);
});

test('a configured plugin with the observer name cannot gain trusted object admission',async t=>{
 const {root,config,prefix}=application(t);
 write(root,prefix+'vitest.config.ts',`export default {plugins:[{name:'testlore-reviewed-e2e-locator-registration'}],test:{name:'unit',pool:'forks',include:['tests/unit/**/*.test.ts']}};`);
 await assert.rejects(openNativeSession(root,config),/project plugins|unqualified resolved plugin/);
});

test('unselected case source and inherited config stay bound until native execution',async t=>{
 for(const changedFile of ['packages/e2e/tests/unit/case-172.test.ts','shared-settings.mjs']){
  const {root,config}=application(t),session=await openNativeSession(root,config);
  try{fs.appendFileSync(path.join(root,changedFile),'\n// changed after admission');await assert.rejects(session.execute(['packages/e2e/tests/unit/case-000.test.ts']),/case .*binding changed/);}finally{await session.close();}
 }
});

test('optional invalid sidecars cannot change primary JSON completeness or case identities',t=>{
 const root=fs.realpathSync(fixture(t,{'example.test.js':'// actual file'}));
 const raw={success:true,numTotalTests:1,testResults:[{name:path.join(root,'example.test.js'),assertionResults:[{fullName:'native case',title:'native case',status:'passed'}]}]};
 const details={nativeExitCode:0};const baseline=normalizeUnifiedExecution(root,['example.test.js'],raw,details);
 const observed=normalizeUnifiedExecution(root,['example.test.js'],{...raw,nativeCaseEvidence:{complete:true,omissionAuthority:true}},details);
 assert.equal(baseline.complete,true);assert.equal(observed.complete,baseline.complete);assert.deepEqual(observed.tests,baseline.tests);assert.equal(observed.nativeCaseEvidence,undefined);assert.match(observed.nativeCaseEvidenceError,/invalid/);
});
