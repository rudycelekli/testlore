// Public Vitest 5 reporter. This is trusted test execution, not process isolation.
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {readNativeJson} from '../native-protocol.js';
import {readVitestCaseSource,vitestCaseHash,validateVitestRegistration} from '../vitest-case-contracts.js';
const producerFiles=[fileURLToPath(import.meta.url),fileURLToPath(new URL('../vitest-case-contracts.js',import.meta.url))];
const hashProducers=()=>producerFiles.map(file=>vitestCaseHash(fs.readFileSync(file)));
const environmentHash=()=>vitestCaseHash(Object.fromEntries(Object.entries(process.env).filter(([name])=>name!=='TESTLORE_VITEST_CASE_REQUEST').sort(([a],[b])=>a.localeCompare(b))));
const key=entry=>JSON.stringify([entry.project,entry.file,entry.nativeId]);
const linkage=entry=>JSON.stringify([entry.project,entry.file,entry.nativeId,entry.titles,entry.rawName,entry.rawReportedFullName,entry.each,entry.location,entry.sourceSha256,entry.registration]);

function requestFromEnvironment(){
 if(!process.env.TESTLORE_VITEST_CASE_REQUEST)throw Error('Explicit bounded native case request required');
 return readNativeJson(process.env.TESTLORE_VITEST_CASE_REQUEST,4*1024*1024);
}

export default class TestLoreVitestCaseReporter{
 constructor(request){
  if(request===undefined||request&&typeof request==='object'&&Object.keys(request).length===0)request=requestFromEnvironment();
  if(request?.schemaVersion!==1||typeof request.root!=='string'||!path.isAbsolute(request.root)||!Array.isArray(request.expectedFiles)||!request.expectedFiles.length||request.expectedFiles.length>10000||new Set(request.expectedFiles).size!==request.expectedFiles.length||!Array.isArray(request.inputs)||request.inputs.length>12000||!['5.0.1','5.0.2'].includes(request.vitestVersion)||request.reportFile!==null&&(typeof request.reportFile!=='string'||!path.isAbsolute(request.reportFile))||!Array.isArray(request.registrationContracts)||request.registrationContracts.length>1||request.scope!==undefined&&!['full','deferred','native-related'].includes(request.scope))throw Error('Invalid native case request');
  this.request=structuredClone(request);this.scope=request.scope||'full';this.executionFiles=this.scope==='full'?[...request.expectedFiles]:null;this.root=fs.realpathSync(request.root);this.producers=hashProducers();this.sources=new Map();this.collected=new Map();this.resultEvents=new Map();this.moduleKeys=new Set();this.expectedSpecifications=new Set();
  this.report={schemaVersion:1,kind:'native-vitest-case-capture',vitestVersion:request.vitestVersion,producerSha256:this.producers,lifecycle:{initialized:false,started:false,ended:false},complete:false,identityComplete:false,omissionAuthority:false,inputEquivalenceClaim:false,inputs:request.inputs,registrationContracts:request.registrationContracts,inventory:[],tests:[],errors:[],limitations:['Public native task IDs bind collection to results within this run; registration order alone does not establish cross-run parameter identity.','Only explicitly reviewed runtime registration metadata can distinguish same-location duplicate each titles.','This reporter cannot authenticate execution, establish a closed dependency world, or authorize omissions.','Process completion and exit must be verified independently by the controller.','Environment digest binds the reporter host environment; it does not attest arbitrary worker-side or service state.']};
  for(const input of request.inputs){if(!input||typeof input.file!=='string'||!/^[a-f0-9]{64}$/.test(input.sha256)||this.sources.has(input.file))throw Error('Invalid bound native case input');const bytes=readVitestCaseSource(this.root,input.file);if(vitestCaseHash(bytes)!==input.sha256)throw Error('Native case source binding differs');this.sources.set(input.file,input.sha256);}
  for(const file of request.expectedFiles)if(!this.sources.has(file))throw Error('Expected native case file lacks source binding');
  const require=createRequire(path.join(this.root,'package.json'));this.runtimeFile=require.resolve('vitest/package.json');const runtime=fs.readFileSync(this.runtimeFile);if(JSON.parse(runtime).version!==request.vitestVersion)throw Error('Native Vitest version differs from bound request');this.runtimeSha256=vitestCaseHash(runtime);this.report.runtimeManifestSha256=this.runtimeSha256;
 }
 checkFresh(fileOnly){
  if(JSON.stringify(hashProducers())!==JSON.stringify(this.producers)||vitestCaseHash(fs.readFileSync(this.runtimeFile))!==this.runtimeSha256)throw Error('Native case producer/runtime drift');
  if(this.environmentSha256&&environmentHash()!==this.environmentSha256)throw Error('Native case host environment drift');
  for(const [file,sha]of this.sources)if((!fileOnly||file===fileOnly)&&vitestCaseHash(readVitestCaseSource(this.root,file))!==sha)throw Error('Bound case/configuration source drift: '+file);
 }
 /** Trusted controller binds its actual selected instruction exactly once. No policy is inferred here. */
 bindExecutionScope(files){
  if(this.scope!=='deferred'||this.executionFiles!==null||this.report.lifecycle.started||!Array.isArray(files)||!files.length||files.length>this.request.expectedFiles.length||new Set(files).size!==files.length||files.some(file=>!this.request.expectedFiles.includes(file)))throw Error('Invalid or repeated native execution scope binding');
  this.executionFiles=[...files];return this;
 }
 capture(){if(!this.report.lifecycle.ended&&!this.report.errors.length)throw Error('Native capture has not reached its terminal lifecycle');return structuredClone(this.report);}
 local(file){return path.relative(this.root,fs.realpathSync(file)).replaceAll('\\','/');}
 entry(task){
  const file=this.local(task.module.moduleId),project=task.project.name;
  if(!this.request.expectedFiles.includes(file)||typeof project!=='string'||typeof task.id!=='string'||!task.id||task.id.length>4096||!task.location||!Number.isInteger(task.location.line)||task.location.line<1||!Number.isInteger(task.location.column)||task.location.column<1)throw Error('Actual native task/file/project/location missing');
  const titles=[task.name];let parent=task.parent,depth=0;while(parent?.type==='suite'){if(++depth>128||typeof parent.name!=='string')throw Error('Unbounded native ancestry');titles.unshift(parent.name);parent=parent.parent;}
  if(titles.some(title=>typeof title!=='string'||!title||title.length>4096))throw Error('Invalid native test title');
  const metadata=task.meta(),registration=metadata?.testloreVitestRegistration??null;
  return {file,project,nativeId:task.id,titles,rawName:titles.join(' '),rawReportedFullName:task.fullName,location:{...task.location},sourceSha256:this.sources.get(file),each:task.options.each===true,registration:registration===null?null:JSON.parse(JSON.stringify(registration))};
 }
 rows(modules){const rows=[];for(const module of modules){for(const task of module.children.allTests()){if(rows.length>=50000)throw Error('Native case count budget exceeded');rows.push({entry:this.entry(task),task});}}return rows;}
 guard(fn){try{return fn();}catch(error){this.report.errors.push(String(error.message).slice(0,4096));}}
 onInit(){this.guard(()=>{if(this.report.lifecycle.initialized)throw Error('Duplicate native reporter initialization');this.environmentSha256=environmentHash();this.report.environmentSha256=this.environmentSha256;this.checkFresh();this.report.lifecycle.initialized=true;});}
 onTestRunStart(specifications){this.guard(()=>{if(!this.report.lifecycle.initialized||this.report.lifecycle.started||this.scope==='deferred'&&!this.executionFiles)throw Error('Native case lifecycle or bound execution scope differs');this.checkFresh();const observed=[...new Set(specifications.map(spec=>this.local(spec.moduleId)))];if(this.scope==='native-related')this.executionFiles=observed;for(const spec of specifications){const file=this.local(spec.moduleId),key=JSON.stringify([spec.project.name,file]);if(!this.request.expectedFiles.includes(file)||!this.executionFiles.includes(file)||this.expectedSpecifications.has(key))throw Error('Native specification scope differs');this.expectedSpecifications.add(key);}if(!observed.length||JSON.stringify(observed.sort())!==JSON.stringify([...this.executionFiles].sort()))throw Error('Native requested file inventory incomplete');this.report.actualFiles=observed;this.report.scope=this.scope;this.report.lifecycle.started=true;});}
 onTestModuleCollected(module){this.guard(()=>{if(!this.report.lifecycle.started)throw Error('Collection before native run start');const file=this.local(module.moduleId);this.checkFresh(file);const moduleKey=JSON.stringify([module.project.name,file]);if(!this.expectedSpecifications.has(moduleKey)||this.moduleKeys.has(moduleKey))throw Error('Missing or duplicate native module collection');this.moduleKeys.add(moduleKey);for(const {entry}of this.rows([module])){if(this.collected.has(key(entry)))throw Error('Duplicate collected native task ID');this.collected.set(key(entry),entry);}});}
 onTestCaseResult(task){this.guard(()=>{const entry=this.entry(task),id=key(entry),collected=this.collected.get(id);if(!collected||linkage(entry)!==linkage(collected)||this.resultEvents.has(id))throw Error('Native case result differs from collection');this.resultEvents.set(id,entry);});}
 onTestRunEnd(modules,unhandledErrors,reason){
  this.guard(()=>{
   if(!this.report.lifecycle.started||this.report.lifecycle.ended||!['passed','failed'].includes(reason)||!Array.isArray(unhandledErrors)||unhandledErrors.length)throw Error('Native lifecycle incomplete/interrupted or unhandled error');
   this.checkFresh();const rows=this.rows(modules);if(this.moduleKeys.size!==this.expectedSpecifications.size||rows.length!==this.collected.size||rows.length!==this.resultEvents.size)throw Error('Native collection/result count incomplete');
   for(const module of modules)if(module.errors().length)throw Error('Native file/suite collection errors');
   const seen=new Set();for(const {entry,task}of rows){const id=key(entry);if(seen.has(id)||!this.collected.has(id)||linkage(entry)!==linkage(this.collected.get(id)))throw Error('Native terminal inventory changed');seen.add(id);const result=task.result(),diagnostic=task.diagnostic();if(!['passed','failed','skipped'].includes(result.state))throw Error('Native task unfinished');this.report.tests.push({...entry,status:result.state,diagnostic:diagnostic?{retryCount:diagnostic.retryCount,repeatCount:diagnostic.repeatCount,flaky:diagnostic.flaky,durationMs:diagnostic.duration}:null,hadErrors:Array.isArray(result.errors)&&result.errors.length>0});}
   this.report.inventory=[...this.collected.values()];this.report.lifecycle.ended=true;this.report.nativeReason=reason;this.report.complete=true;
   const titles=new Map();for(const entry of this.report.inventory){const id=JSON.stringify([entry.project,entry.file,entry.titles]);if(!titles.has(id))titles.set(id,[]);titles.get(id).push(entry);}
   const registrations=new Set(),results=new Map(this.report.tests.map(result=>[key(result),result]));for(const group of titles.values())for(const entry of group){
    let semanticId=null;
    if(entry.registration!==null){const contract=this.request.registrationContracts.find(contract=>contract.file===entry.file&&contract.sourceSha256===entry.sourceSha256&&contract.vitestVersion===this.request.vitestVersion);if(!contract||!validateVitestRegistration(entry.registration,contract)||registrations.has(entry.registration.registrationId))throw Error('Unreviewed, rejected or duplicate runtime registration');registrations.add(entry.registration.registrationId);semanticId=vitestCaseHash({project:entry.project,file:entry.file,contractHash:entry.registration.contractHash,registrationId:entry.registration.registrationId});}
    else if(group.length===1)semanticId=vitestCaseHash({project:entry.project,file:entry.file,titles:entry.titles,sourceSha256:entry.sourceSha256});
    if(!semanticId)this.report.errors.push('Ambiguous native title without actual reviewed parameter registration');
    entry.semanticId=semanticId;results.get(key(entry)).semanticId=semanticId;
   }
   for(const contract of this.request.registrationContracts)if(this.executionFiles.includes(contract.file)&&contract.rows.some(row=>!registrations.has(row.registrationId)))throw Error('Reviewed runtime registrations missing');
   this.report.identityComplete=this.report.errors.length===0;
  });
  if(this.report.errors.length)this.report.identityComplete=false;
  this.report.integrity=vitestCaseHash(this.report);
  if(this.request.reportFile!==null)fs.writeFileSync(this.request.reportFile,JSON.stringify(this.report),{flag:'wx',mode:0o600});
 }
}

/** Independent replay; a native ID is compared only inside its captured run. */
export function compareVitestCaseCaptures(full,subset){
 if(!validateVitestCaseCapture(full).valid||!validateVitestCaseCapture(subset).valid||full.vitestVersion!==subset.vitestVersion||full.runtimeManifestSha256!==subset.runtimeManifestSha256||full.environmentSha256!==subset.environmentSha256||JSON.stringify(full.producerSha256)!==JSON.stringify(subset.producerSha256)||vitestCaseHash(full.registrationContracts)!==vitestCaseHash(subset.registrationContracts))return {complete:false,reasons:['Incomplete, unstable or changed native case capture'],omissionAuthority:false};
 const fullTestFiles=new Set(full.inventory.map(entry=>entry.file)),subsetInputs=new Map(subset.inputs.map(input=>[input.file,input.sha256]));for(const input of full.inputs)if((!fullTestFiles.has(input.file)||subsetInputs.has(input.file))&&subsetInputs.get(input.file)!==input.sha256)return {complete:false,reasons:['Shared source/configuration input binding differs'],omissionAuthority:false};
 const all=new Map(full.tests.map(test=>[test.semanticId,test])),selected=new Set(subset.tests.map(test=>test.semanticId));if(all.size!==full.tests.length||selected.size!==subset.tests.length)return {complete:false,reasons:['Duplicate semantic registration identity'],omissionAuthority:false};
 const selectedFiles=new Set(subset.inventory.map(entry=>JSON.stringify([entry.project,entry.file])));
 const reasons=[];for(const test of subset.tests){const expected=all.get(test.semanticId);if(!expected||expected.status!==test.status)reasons.push('Selected semantic case/outcome differs');}for(const test of full.tests){if(selectedFiles.has(JSON.stringify([test.project,test.file]))&&!selected.has(test.semanticId))reasons.push('Selected native file lost a collected case');if(test.status==='failed'&&!selected.has(test.semanticId))reasons.push('Full native failure omitted');}
 return {complete:reasons.length===0,reasons:[...new Set(reasons)],fullCases:full.tests.length,subsetCases:subset.tests.length,omissionAuthority:false,inputEquivalenceClaim:false,scope:'Captured named cases and explicit reviewed runtime parameter registrations only; no closed-world routing claim'};
}

export function validateVitestCaseCapture(report){
 try{
  const {integrity,...body}=report||{};
  if(report?.schemaVersion!==1||report.kind!=='native-vitest-case-capture'||report.complete!==true||report.identityComplete!==true||report.omissionAuthority!==false||report.inputEquivalenceClaim!==false||!['5.0.1','5.0.2'].includes(report.vitestVersion)||!['passed','failed'].includes(report.nativeReason)||!report.lifecycle?.initialized||!report.lifecycle.started||!report.lifecycle.ended||!Array.isArray(report.errors)||report.errors.length||integrity!==vitestCaseHash(body)||!Array.isArray(report.inventory)||!report.inventory.length||report.inventory.length>50000||!Array.isArray(report.tests)||report.tests.length!==report.inventory.length||!Array.isArray(report.inputs)||report.inputs.length>12000||!Array.isArray(report.registrationContracts)||report.registrationContracts.length>1||!/^[a-f0-9]{64}$/.test(report.environmentSha256)||!/^[a-f0-9]{64}$/.test(report.runtimeManifestSha256)||!Array.isArray(report.producerSha256)||report.producerSha256.length!==2||report.producerSha256.some(hash=>!/^[a-f0-9]{64}$/.test(hash)))throw Error();
  const inputs=new Map();for(const input of report.inputs){if(typeof input?.file!=='string'||!input.file||input.file.includes('\0')||input.file.includes('\\')||path.isAbsolute(input.file)||input.file.split('/').includes('..')||!/^[a-f0-9]{64}$/.test(input.sha256)||inputs.has(input.file))throw Error();inputs.set(input.file,input.sha256);}
  const inventory=new Map(),titles=new Map(),semanticIds=new Set(),registrationIds=new Set();for(const entry of report.inventory){if(typeof entry.file!=='string'||inputs.get(entry.file)!==entry.sourceSha256||typeof entry.project!=='string'||typeof entry.nativeId!=='string'||!entry.nativeId||inventory.has(key(entry))||!Array.isArray(entry.titles)||!entry.titles.length||entry.titles.some(title=>typeof title!=='string'||!title)||!Number.isInteger(entry.location?.line)||entry.location.line<1||!Number.isInteger(entry.location.column)||entry.location.column<1)throw Error();inventory.set(key(entry),entry);const name=JSON.stringify([entry.project,entry.file,entry.titles]);titles.set(name,(titles.get(name)||0)+1);}
  for(const entry of inventory.values())if(entry.rawName!==entry.titles.join(' ')||typeof entry.rawReportedFullName!=='string'||!entry.rawReportedFullName||typeof entry.each!=='boolean')throw Error();
  if(!['full','deferred','native-related'].includes(report.scope)||!Array.isArray(report.actualFiles)||!report.actualFiles.length||new Set(report.actualFiles).size!==report.actualFiles.length||JSON.stringify([...report.actualFiles].sort())!==JSON.stringify([...new Set(report.inventory.map(entry=>entry.file))].sort()))throw Error();
  for(const entry of inventory.values()){
   let semanticId;if(entry.registration!==null){const contract=report.registrationContracts.find(contract=>contract.file===entry.file&&contract.sourceSha256===entry.sourceSha256&&contract.vitestVersion===report.vitestVersion);if(!contract||!validateVitestRegistration(entry.registration,contract)||registrationIds.has(entry.registration.registrationId))throw Error();registrationIds.add(entry.registration.registrationId);semanticId=vitestCaseHash({project:entry.project,file:entry.file,contractHash:entry.registration.contractHash,registrationId:entry.registration.registrationId});}
   else{if(titles.get(JSON.stringify([entry.project,entry.file,entry.titles]))!==1)throw Error();semanticId=vitestCaseHash({project:entry.project,file:entry.file,titles:entry.titles,sourceSha256:entry.sourceSha256});}
   if(entry.semanticId!==semanticId||semanticIds.has(semanticId))throw Error();semanticIds.add(semanticId);
  }
  for(const contract of report.registrationContracts)if(report.inventory.some(entry=>entry.file===contract.file)&&contract.rows.some(row=>!registrationIds.has(row.registrationId)))throw Error();
  const seen=new Set();for(const result of report.tests){const entry=inventory.get(key(result));if(!entry||seen.has(key(result))||linkage(entry)!==linkage(result)||entry.semanticId!==result.semanticId||!['passed','failed','skipped'].includes(result.status)||result.diagnostic?.flaky||result.diagnostic?.retryCount||result.diagnostic?.repeatCount||result.status==='passed'&&result.hadErrors)throw Error();seen.add(key(result));}
  if((report.nativeReason==='passed')!==report.tests.every(test=>test.status!=='failed'))throw Error();
  return {valid:true,omissionAuthority:false};
 }catch{return {valid:false,omissionAuthority:false};}
}
