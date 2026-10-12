import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {vitestCaseHash,vitestParameterDigest,e2eLocatorRegistrationContract,registerReviewedE2ELocatorEach,createE2ELocatorRegistrationPlugin,E2E_LOCATOR_FILE,E2E_LOCATOR_REVISION,E2E_LOCATOR_SOURCE_SHA256,E2E_LOCATOR_TABLE} from '../src/vitest-case-contracts.js';
import TestLoreVitestCaseReporter,{compareVitestCaseCaptures,validateVitestCaseCapture} from '../src/reporters/vitest-cases.js';
const repository=fileURLToPath(new URL('../',import.meta.url)),reporter=path.join(repository,'src/reporters/vitest-cases.js'),helper=path.join(repository,'src/vitest-case-contracts.js'),cli=path.join(repository,'node_modules/vitest/vitest.mjs');
const original=fs.readFileSync(new URL('./fixtures/e2e-locator-registration/original.test.txt',import.meta.url),'utf8');
function rootFor(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'testlore-native-case-contract-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));fs.mkdirSync(path.join(root,'tests/unit'),{recursive:true});fs.writeFileSync(path.join(root,'package.json'),'{"type":"module"}');fs.symlinkSync(path.join(repository,'node_modules'),path.join(root,'node_modules'),'dir');return root;}
function profile(t){const root=rootFor(t);fs.writeFileSync(path.join(root,E2E_LOCATOR_FILE),original);return {root,contract:e2eLocatorRegistrationContract(root,{upstreamRevision:E2E_LOCATOR_REVISION,vitestVersion:'5.0.2'})};}
function rows(){const banner={ref:{id:'banner',revision:''},role:'alert',name:'Saved',testId:'banner'},hiddenBanner={...banner,states:{hidden:true}};return [['attached',[],[hiddenBanner]],['detached',[hiddenBanner],[]],['visible',[hiddenBanner],[banner]],['hidden',[banner],[hiddenBanner]],['hidden',[banner],[]]];}
function native(root,{files,reportName,contracts=[],extra=[]}){
 const reportFile=path.join(root,reportName+'.capture.json'),requestFile=path.join(root,reportName+'.request.json'),inputs=files.concat(['vitest.config.mjs']).map(file=>({file,sha256:vitestCaseHash(fs.readFileSync(path.join(root,file)))}));
 fs.writeFileSync(requestFile,JSON.stringify({schemaVersion:1,root,expectedFiles:files,inputs,vitestVersion:'5.0.2',reportFile,registrationContracts:contracts}));
 const rawFile=path.join(root,reportName+'.native.json'),started=performance.now();const result=spawnSync(process.execPath,[cli,'run',...files,'--config','vitest.config.mjs','--reporter=json','--reporter='+reporter,'--outputFile='+rawFile,...extra],{cwd:root,env:{PATH:process.env.PATH,HOME:root,TMPDIR:os.tmpdir(),TESTLORE_VITEST_CASE_REQUEST:requestFile},encoding:'utf8',timeout:30000,maxBuffer:4*1024*1024});
 assert.equal(result.error,undefined,result.error?.message);assert.ok(fs.existsSync(reportFile),result.stdout+result.stderr);const capture=JSON.parse(fs.readFileSync(reportFile)),raw=JSON.parse(fs.readFileSync(rawFile));return {process:result,capture,raw,totalMs:performance.now()-started};
}

test('exact reviewed source binds plain actual row inputs while keeping original disk bytes',t=>{
 const {root,contract}=profile(t);assert.equal(vitestCaseHash(original),E2E_LOCATOR_SOURCE_SHA256);assert.equal(contract.rows.length,5);assert.notEqual(contract.rows[3].inputSha256,contract.rows[4].inputSha256);
 const plugin=createE2ELocatorRegistrationPlugin(root,contract),transformed=plugin.transform(original,path.join(root,E2E_LOCATOR_FILE));
 const untouchedTail=original.slice(original.indexOf(")('waits for %s"));assert.ok(transformed.code.includes(E2E_LOCATOR_TABLE));assert.equal(transformed.code.split(untouchedTail).length,2);assert.equal(fs.readFileSync(path.join(root,E2E_LOCATOR_FILE),'utf8'),original);
 assert.throws(()=>plugin.transform(original+'\n',path.join(root,E2E_LOCATOR_FILE)),/source drift/);
 fs.appendFileSync(path.join(root,E2E_LOCATOR_FILE),'\n');assert.throws(()=>e2eLocatorRegistrationContract(root,{upstreamRevision:E2E_LOCATOR_REVISION,vitestVersion:'5.0.2'}),/source.*changed/);
});

test('serializer refuses getters, opaque inputs, cycles and holes without invoking them',()=>{
 let accesses=0;const getter=Object.defineProperty({},'data',{enumerable:true,get(){accesses++;return 'secret';}});assert.throws(()=>vitestParameterDigest(getter),/Accessor/);assert.equal(accesses,0);
 assert.throws(()=>vitestParameterDigest(new Date()),/Nonplain/);const cycle=[];cycle.push(cycle);assert.throws(()=>vitestParameterDigest(cycle),/cyclic/);assert.throws(()=>vitestParameterDigest(Array(2)),/sparse/);
 let traps=0;const proxy=new Proxy({}, {ownKeys(){traps++;return [];},getPrototypeOf(){traps++;return Object.prototype;}});assert.throws(()=>vitestParameterDigest(proxy),/Opaque/);assert.equal(traps,0);
 assert.equal(vitestParameterDigest({b:2,a:1}),vitestParameterDigest({a:1,b:2}));
});

test('reviewed registration preserves row references, callback arguments, names and rejected cases',async t=>{
 const {contract}=profile(t),table=rows(),registrations=[];const it={each:table=>(title,options,callback)=>registrations.push({table,title,options,callback})},calls=[];
 registerReviewedE2ELocatorEach(it,table,contract)(contract.title,(...args)=>calls.push(args));assert.equal(registrations.length,5);
 for(let i=0;i<5;i++){assert.equal(registrations[i].table[0],table[i]);assert.equal(registrations[i].title,contract.title);assert.equal(registrations[i].options.meta.testloreVitestRegistration.valid,true);await registrations[i].callback(...table[i]);assert.deepEqual(calls[i],table[i]);}
 const swapped=rows();[swapped[3],swapped[4]]=[swapped[4],swapped[3]];registrations.length=0;registerReviewedE2ELocatorEach(it,swapped,contract)(contract.title,()=>{});assert.equal(registrations.length,5);assert.equal(registrations[3].options.meta.testloreVitestRegistration.valid,false);await assert.rejects(registrations[3].callback(...swapped[3]),/inputs\/order changed/);
 const changed=rows();changed[4][1][0].name='Changed';registrations.length=0;registerReviewedE2ELocatorEach(it,changed,contract)(contract.title,()=>{});assert.equal(registrations.length,5);await assert.rejects(registrations[4].callback(...changed[4]),/evidence rejected/);
 const opaque=rows();opaque[3][2]=[new Date()];registrations.length=0;registerReviewedE2ELocatorEach(it,opaque,contract)(contract.title,()=>{});assert.equal(registrations.length,5);assert.equal(registrations[3].options.meta.testloreVitestRegistration.inputSha256,null);
});

test('real native full/subset lifecycle preserves an independently failing case without using cross-run task ordinals',t=>{
 const root=rootFor(t);fs.writeFileSync(path.join(root,'vitest.config.mjs'),"export default {test:{includeTaskLocation:true,include:['tests/unit/*.test.js'],maxWorkers:1}};");
 fs.writeFileSync(path.join(root,'tests/unit/a.test.js'),"import {test,expect} from 'vitest';test('actual regression',()=>expect(2).toBe(1));test('healthy sibling',()=>expect(1).toBe(1));test.skip('maintainer intentional skip',()=>expect(2).toBe(1));");fs.writeFileSync(path.join(root,'tests/unit/b.test.js'),"import {test,expect} from 'vitest';test('unrelated case',()=>expect(1).toBe(1));");
 const full=native(root,{files:['tests/unit/a.test.js','tests/unit/b.test.js'],reportName:'full'}),subset=native(root,{files:['tests/unit/a.test.js'],reportName:'subset'});
 assert.equal(full.process.status,1);assert.equal(subset.process.status,1);assert.equal(full.capture.complete,true,JSON.stringify(full.capture.errors));assert.equal(full.capture.identityComplete,true);assert.equal(compareVitestCaseCaptures(full.capture,subset.capture).complete,true);
 assert.equal(full.capture.tests.filter(row=>row.status==='skipped').length,1);assert.equal(subset.capture.tests.filter(row=>row.status==='skipped').length,1);
 const reseal=value=>{delete value.integrity;value.integrity=vitestCaseHash(value);return value;};
 for(const name of ['healthy sibling','maintainer intentional skip']){const lost=structuredClone(subset.capture);lost.tests=lost.tests.filter(row=>row.rawName!==name);lost.inventory=lost.inventory.filter(row=>row.rawName!==name);reseal(lost);assert.equal(validateVitestCaseCapture(lost).valid,true);assert.ok(compareVitestCaseCaptures(full.capture,lost).reasons.includes('Selected native file lost a collected case'));}
 const changedSkip=structuredClone(subset.capture);changedSkip.tests.find(row=>row.status==='skipped').status='passed';reseal(changedSkip);assert.equal(compareVitestCaseCaptures(full.capture,changedSkip).complete,false);
 const configDrift=structuredClone(subset.capture);configDrift.inputs.find(input=>input.file==='vitest.config.mjs').sha256='a'.repeat(64);reseal(configDrift);assert.equal(compareVitestCaseCaptures(full.capture,configDrift).complete,false);
 const sourceDrift=structuredClone(subset.capture);for(const row of [...sourceDrift.tests,...sourceDrift.inventory])row.sourceSha256='a'.repeat(64);reseal(sourceDrift);assert.equal(validateVitestCaseCapture(sourceDrift).valid,false);
 const changedRaw=structuredClone(subset.capture);changedRaw.tests[0].rawName='forged raw name';reseal(changedRaw);assert.equal(validateVitestCaseCapture(changedRaw).valid,false);
 const equalCount=structuredClone(subset.capture);for(const row of [...equalCount.tests,...equalCount.inventory])if(row.rawName==='healthy sibling'){row.titles=['invented sibling'];row.rawName='invented sibling';row.semanticId=vitestCaseHash({project:row.project,file:row.file,titles:row.titles,sourceSha256:row.sourceSha256});}reseal(equalCount);assert.equal(validateVitestCaseCapture(equalCount).valid,true);assert.equal(compareVitestCaseCaptures(full.capture,equalCount).complete,false);
 const wrongScope=structuredClone(subset.capture);wrongScope.actualFiles=['../a.test.js'];reseal(wrongScope);assert.equal(validateVitestCaseCapture(wrongScope).valid,false);
 const omission=native(root,{files:['tests/unit/b.test.js'],reportName:'wrong'});assert.equal(compareVitestCaseCaptures(full.capture,omission.capture).complete,false);assert.ok(compareVitestCaseCaptures(full.capture,omission.capture).reasons.includes('Full native failure omitted'));
});

test('genuine native equal-title dynamic reorder remains ambiguous under unchanged source and case ordinals',t=>{
 const root=rootFor(t);fs.writeFileSync(path.join(root,'vitest.config.mjs'),"export default {test:{includeTaskLocation:true,include:['tests/unit/*.test.js'],maxWorkers:1}};");
 const source="import {test,expect} from 'vitest';const rows=process.env.REORDER==='yes'?[2,1]:[1,2];test.each(rows)('same title',n=>expect(n).toBeGreaterThan(0));";fs.writeFileSync(path.join(root,'tests/unit/dynamic.test.js'),source);
 const first=native(root,{files:['tests/unit/dynamic.test.js'],reportName:'dynamic-first'});assert.equal(first.process.status,0);assert.equal(first.capture.complete,true);assert.equal(first.capture.identityComplete,false);assert.equal(first.capture.inventory.length,2);
 assert.equal(new Set(first.capture.inventory.map(entry=>JSON.stringify(entry.location))).size,1);assert.equal(new Set(first.capture.inventory.map(entry=>entry.nativeId)).size,2);
 // Identical public IDs still cannot acquire semantic identity after reorder.
 const request=path.join(root,'dynamic-second.request.json'),reportFile=path.join(root,'dynamic-second.capture.json');fs.writeFileSync(request,JSON.stringify({schemaVersion:1,root,expectedFiles:['tests/unit/dynamic.test.js'],inputs:['tests/unit/dynamic.test.js','vitest.config.mjs'].map(file=>({file,sha256:vitestCaseHash(fs.readFileSync(path.join(root,file)))})),vitestVersion:'5.0.2',reportFile,registrationContracts:[]}));
 const processResult=spawnSync(process.execPath,[cli,'run','--config','vitest.config.mjs','--reporter='+reporter],{cwd:root,env:{PATH:process.env.PATH,HOME:root,TMPDIR:os.tmpdir(),REORDER:'yes',TESTLORE_VITEST_CASE_REQUEST:request},encoding:'utf8',timeout:30000,maxBuffer:4*1024*1024});assert.equal(processResult.status,0,processResult.stdout+processResult.stderr);
 const second=JSON.parse(fs.readFileSync(reportFile));assert.deepEqual(first.capture.inventory.map(entry=>entry.nativeId),second.inventory.map(entry=>entry.nativeId));assert.equal(second.identityComplete,false);assert.equal(compareVitestCaseCaptures(first.capture,second).complete,false);
});

test('real Vitest retains all original rows when a reviewed transport rejects reorder or changed input',t=>{
 const {root,contract}=profile(t);fs.unlinkSync(path.join(root,E2E_LOCATOR_FILE));fs.writeFileSync(path.join(root,'vitest.config.mjs'),"export default {test:{includeTaskLocation:true,include:['tests/unit/*.test.js'],maxWorkers:1}};");
 const transport=mode=>`import {it,expect} from 'vitest';import {registerReviewedE2ELocatorEach} from ${JSON.stringify(helper)};const rows=${JSON.stringify(rows())};${mode==='reorder'?'[rows[3],rows[4]]=[rows[4],rows[3]];':mode==='changed'?"rows[4][2]=[{wrong:'input'}];":mode==='opaque'?"rows[3][2]=[new Date()];":''}${mode==='unmodified'?'it.each(rows)':`registerReviewedE2ELocatorEach(it,rows,${JSON.stringify(contract)})`}(${JSON.stringify(contract.title)},(state,initial,later)=>expect(typeof state).toBe('string'));`;
 const outcomes=[],rawArms=[];for(const mode of ['unmodified','instrumented','reorder','changed','opaque']){fs.writeFileSync(path.join(root,'tests/unit/transport.test.js'),transport(mode));const result=native(root,{files:['tests/unit/transport.test.js'],reportName:'transport-'+mode});assert.equal(result.raw.numTotalTests,5);assert.equal(result.capture.inventory.length,5);assert.equal(result.capture.identityComplete,false,'Controlled transport is not the exact original e2e profile');assert.ok(result.totalMs>0);outcomes.push({mode,failed:result.raw.numFailedTests,exit:result.process.status});rawArms.push(result.raw.testResults.flatMap(file=>file.assertionResults.map(row=>[row.fullName,row.status])).sort());}
 assert.deepEqual(rawArms[0],rawArms[1],'Original native and metadata instrumentation preserve all named outcome multiplicities');
 assert.deepEqual(outcomes,[{mode:'unmodified',failed:0,exit:0},{mode:'instrumented',failed:0,exit:0},{mode:'reorder',failed:2,exit:1},{mode:'changed',failed:1,exit:1},{mode:'opaque',failed:1,exit:1}]);
});

test('native configuration mutation invalidates the completed reporter capture',t=>{
 const root=rootFor(t);fs.writeFileSync(path.join(root,'vitest.config.mjs'),"export default {test:{includeTaskLocation:true,include:['tests/unit/*.test.js'],maxWorkers:1}};");fs.writeFileSync(path.join(root,'tests/unit/drift.test.js'),"import {test} from 'vitest';import fs from 'node:fs';test('native outcome passes but configuration drift invalidates evidence',()=>fs.appendFileSync('vitest.config.mjs','\\n// changed during test'));" );
 const result=native(root,{files:['tests/unit/drift.test.js'],reportName:'drift'});assert.equal(result.process.status,0);assert.equal(result.capture.identityComplete,false);assert.equal(result.capture.complete,false);assert.ok(result.capture.errors.some(error=>error.includes('configuration source drift')));assert.equal(validateVitestCaseCapture(result.capture).valid,false);
});

test('native API initializes normally and binds one actual selected scope before execution',async t=>{
 const root=rootFor(t),files=['tests/unit/a.test.js','tests/unit/b.test.js'];fs.writeFileSync(path.join(root,'vitest.config.mjs'),"export default {test:{includeTaskLocation:true,include:['tests/unit/*.test.js'],maxWorkers:1}};");
 for(const file of files)fs.writeFileSync(path.join(root,file),`import {test,expect} from 'vitest';test(${JSON.stringify(file)},()=>expect(1).toBe(1));`);
 const request={schemaVersion:1,root,expectedFiles:files,inputs:[...files,'vitest.config.mjs'].map(file=>({file,sha256:vitestCaseHash(fs.readFileSync(path.join(root,file)))})),vitestVersion:'5.0.2',reportFile:null,registrationContracts:[],scope:'deferred'},instance=new TestLoreVitestCaseReporter(request);
 assert.throws(()=>instance.capture(),/terminal lifecycle/);assert.throws(()=>instance.bindExecutionScope(['outside.test.js']),/scope binding/);
 const {createVitest}=await import('vitest/node');const context=await createVitest({root,config:path.join(root,'vitest.config.mjs'),watch:false,reporters:[instance]},{logLevel:'silent'});
 try{const specs=await context.getRelevantTestSpecifications([]);assert.equal(specs.length,2);instance.bindExecutionScope([files[0]]);assert.throws(()=>instance.bindExecutionScope([files[0]]),/repeated/);await context.standalone();assert.equal(instance.report.lifecycle.initialized,true,JSON.stringify(instance.report.errors));await context.runTestSpecifications(specs.filter(spec=>spec.moduleId.endsWith('/a.test.js')),false);const capture=instance.capture();assert.equal(validateVitestCaseCapture(capture).valid,true,JSON.stringify(capture.errors));assert.deepEqual(capture.actualFiles,[files[0]]);assert.equal(capture.scope,'deferred');assert.equal(capture.tests.length,1);}
 finally{await context.close();}
});

test('native related CLI binds actual specs from a larger admissible source inventory',t=>{
 const root=rootFor(t),files=['tests/unit/a.test.js','tests/unit/b.test.js'];fs.mkdirSync(path.join(root,'src'));fs.writeFileSync(path.join(root,'src/subject.js'),'export const value=1;');fs.writeFileSync(path.join(root,'vitest.config.mjs'),"export default {test:{includeTaskLocation:true,include:['tests/unit/*.test.js'],maxWorkers:1}};");
 fs.writeFileSync(path.join(root,files[0]),"import {test,expect} from 'vitest';import {value} from '../../src/subject.js';test('related case',()=>expect(value).toBe(1));");fs.writeFileSync(path.join(root,files[1]),"import {test,expect} from 'vitest';test('unrelated case',()=>expect(1).toBe(1));");
 const reportFile=path.join(root,'related.capture.json'),requestFile=path.join(root,'related.request.json');fs.writeFileSync(requestFile,JSON.stringify({schemaVersion:1,root,expectedFiles:files,inputs:[...files,'vitest.config.mjs','src/subject.js'].map(file=>({file,sha256:vitestCaseHash(fs.readFileSync(path.join(root,file)))})),vitestVersion:'5.0.2',reportFile,registrationContracts:[],scope:'native-related'}));
 const result=spawnSync(process.execPath,[cli,'related','src/subject.js','--run','--config','vitest.config.mjs','--reporter='+reporter],{cwd:root,env:{PATH:process.env.PATH,HOME:root,TMPDIR:os.tmpdir(),TESTLORE_VITEST_CASE_REQUEST:requestFile},encoding:'utf8',timeout:30000,maxBuffer:4*1024*1024});assert.equal(result.status,0,result.stdout+result.stderr);const capture=JSON.parse(fs.readFileSync(reportFile));assert.equal(validateVitestCaseCapture(capture).valid,true,JSON.stringify(capture.errors));assert.deepEqual(capture.actualFiles,[files[0]]);assert.equal(capture.scope,'native-related');assert.equal(capture.tests.length,1);
 const drift=structuredClone(capture);drift.actualFiles.push(files[1]);delete drift.integrity;drift.integrity=vitestCaseHash(drift);assert.equal(validateVitestCaseCapture(drift).valid,false);
});

test('native-related genuine zero selection completes its observed lifecycle and cannot become full evidence',t=>{
 const root=rootFor(t),files=['tests/unit/a.test.js'];fs.mkdirSync(path.join(root,'src'));fs.writeFileSync(path.join(root,'src/unrelated.js'),'export const value=1;');fs.writeFileSync(path.join(root,files[0]),"import {test,expect} from 'vitest';test('existing unrelated assertion',()=>expect(1).toBe(1));");fs.writeFileSync(path.join(root,'vitest.config.mjs'),"export default {test:{includeTaskLocation:true,maxWorkers:1}};");
 const reportFile=path.join(root,'empty.capture.json'),requestFile=path.join(root,'empty.request.json');fs.writeFileSync(requestFile,JSON.stringify({schemaVersion:1,root,expectedFiles:files,inputs:[...files,'vitest.config.mjs'].map(file=>({file,sha256:vitestCaseHash(fs.readFileSync(path.join(root,file)))})),vitestVersion:'5.0.2',reportFile,registrationContracts:[],scope:'native-related'}));
 const result=spawnSync(process.execPath,[cli,'related','src/unrelated.js','--run','--passWithNoTests','--config','vitest.config.mjs','--reporter='+reporter],{cwd:root,env:{PATH:process.env.PATH,HOME:root,TMPDIR:os.tmpdir(),TESTLORE_VITEST_CASE_REQUEST:requestFile},encoding:'utf8',timeout:30000,maxBuffer:4*1024*1024});assert.equal(result.status,0,result.stdout+result.stderr);const capture=JSON.parse(fs.readFileSync(reportFile));assert.equal(validateVitestCaseCapture(capture).valid,true,JSON.stringify(capture.errors));assert.deepEqual(capture.lifecycle,{initialized:true,started:true,ended:true});assert.deepEqual(capture.tests,[]);assert.deepEqual(capture.actualFiles,[]);
 for(const change of [r=>r.scope='full',r=>r.scope='deferred',r=>r.lifecycle.started=false,r=>r.nativeReason='failed',r=>r.errors.push('actual unhandled error'),r=>r.actualFiles.push(files[0])]){const altered=structuredClone(capture);change(altered);delete altered.integrity;altered.integrity=vitestCaseHash(altered);assert.equal(validateVitestCaseCapture(altered).valid,false);}
});
