#!/usr/bin/env node
// A narrow experimental registration producer, never a title normalizer or omission authority.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
export const registrationHash=bytes=>createHash('sha256').update(typeof bytes==='string'||Buffer.isBuffer(bytes)?bytes:JSON.stringify(bytes)).digest('hex');
export const REA_CASE_SOURCE_SHA256='6c2de4420b2b36ba34ba6da27e0cd36b269f70a442b34c5b963d1c3977213814';
const expectedSchemaHashes={closeBinaryInputSchema:'fafb38cbc3dab5c72496e1f1e864bb87da8d050106c27e65075afcd812ff2917',exportEvidenceBundleInputSchema:'9afbd4b85a9e1d9d9aa4e1bb8a53fcc00b2e6f52a90a72ec2f7be91583b96e47'};
export const REA_CASE_FILE='src/contracts/sessionPathInputs.test.ts';
export const WINDOWS_DECLARATION=String.raw`it.each([
      [closeBinaryInputSchema, { snapshot_path: "C:\\rea\\analysis.json" }],
      [closeBinaryInputSchema, { snapshot_path: "C:/rea/analysis.json" }],
      [exportEvidenceBundleInputSchema, { path: "C:/rea/bundle.json" }],
    ])("accepts %o", (schema, input) => {
      expect(schema.safeParse(input).success).toBe(true);
    });`;
const declaredRows=[['closeBinaryInputSchema',{snapshot_path:'C:\\rea\\analysis.json'}],['closeBinaryInputSchema',{snapshot_path:'C:/rea/analysis.json'}],['exportEvidenceBundleInputSchema',{path:'C:/rea/bundle.json'}]];
const schemaFiles={closeBinaryInputSchema:'src/contracts/sessionLifecycleInputs.ts',exportEvidenceBundleInputSchema:'src/contracts/sessionToolContracts.ts'};
function boundedFile(root,file){if(typeof file!=='string'||path.isAbsolute(file)||file.split('/').some(part=>!part||part==='..'||part==='.')||file.includes('\\'))throw Error('Invalid source binding path');const filename=path.join(root,file),stat=fs.lstatSync(filename);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>1024*1024)throw Error('Registration source must be bounded regular bytes');return fs.readFileSync(filename,'utf8');}
export function plainParameterDigest(value){
 const seen=new Set();function plain(item,depth=0){if(depth>8)throw Error('Parameter depth unsupported');if(item===null||typeof item==='string'||typeof item==='boolean')return item;if(typeof item==='number'&&Number.isFinite(item)&&!Object.is(item,-0))return item;if(!item||typeof item!=='object'||seen.has(item)||Object.getOwnPropertySymbols(item).length)throw Error('Unsupported parameter object');seen.add(item);if(Array.isArray(item))throw Error('Array parameters unsupported by this narrow profile');if(Object.getPrototypeOf(item)!==Object.prototype&&Object.getPrototypeOf(item)!==null)throw Error('Opaque parameter objects cannot be serialized');const descriptors=Object.getOwnPropertyDescriptors(item),output={};for(const key of Object.keys(descriptors).sort()){const d=descriptors[key];if(!d.enumerable||!Object.hasOwn(d,'value')||['__proto__','constructor','prototype'].includes(key))throw Error('Accessor or unsupported parameter property');output[key]=plain(d.value,depth+1);}return output;}
 const serialized=JSON.stringify(plain(value));if(Buffer.byteLength(serialized)>4096)throw Error('Parameter bytes exceed profile budget');return registrationHash(serialized);
}
export function reaCaseRegistrationManifest(root,{upstreamRevision,node=process.version,platform=process.platform,arch=process.arch}={}){
 if(upstreamRevision!=='3dcb732da33f6ceef597506b14a4536f1c9aff96')throw Error('Explicit upstream revision required');
 const source=boundedFile(root,REA_CASE_FILE),offset=source.indexOf(WINDOWS_DECLARATION);if(offset<0||source.indexOf(WINDOWS_DECLARATION,offset+1)>=0)throw Error('Unique exact Windows declaration required');
 if(!source.includes('describe.runIf(process.platform === "win32")('))throw Error('Original platform gate changed');
 const sourceSha256=registrationHash(source);if(sourceSha256!==REA_CASE_SOURCE_SHA256)throw Error('Original REA case source differs from pinned profile');
 const declarationSha256=registrationHash(WINDOWS_DECLARATION),declarationLine=source.slice(0,offset).split('\n').length;
 const bindings=Object.fromEntries(Object.entries(schemaFiles).map(([name,file])=>[name,{importBinding:name,file,sourceSha256:registrationHash(boundedFile(root,file)),upstreamRevision,kind:'opaque-imported-object-reference-attestation-not-structural-equivalence'}]));
 for(const [name,binding] of Object.entries(bindings))if(binding.sourceSha256!==expectedSchemaHashes[name])throw Error('Original opaque schema binding source differs from pinned profile');
 const dependencyLockSha256=registrationHash(boundedFile(root,'package-lock.json'));
 const rows=declaredRows.map(([binding,input])=>{const inputSha256=plainParameterDigest(input);const declarationRowSha256=registrationHash(WINDOWS_DECLARATION.split('\n')[declaredRows.findIndex(row=>row[0]===binding&&plainParameterDigest(row[1])===inputSha256)+1]);const identity={file:REA_CASE_FILE,sourceSha256,declarationSha256,declarationRowSha256,inputSha256,binding:bindings[binding],dependencyLockSha256,upstreamRevision,node,platform,arch};return{...identity,registrationId:registrationHash(identity)};});
 return {schemaVersion:1,kind:'rea-windows-plain-input-registration-overlay',file:REA_CASE_FILE,sourceSha256,declarationSha256,declarationLine,bindings,dependencyLockSha256,upstreamRevision,node,platform,arch,rows,omissionAuthority:false,scope:'Three actual registrations, plain input digests and opaque original import reference bindings; not schema serialization or equivalent runtime semantics.'};
}
export function registerReaWindowsCases(it,table,title,callback,bindings,manifest){
 if(title!=='accepts %o'||typeof callback!=='function'||!Array.isArray(table)||table.length!==3||manifest?.rows?.length!==3)throw Error('Unsupported registration declaration');
 const unique=new Set();
 for(let index=0;index<table.length;index++){
  const row=table[index],expected=manifest.rows[index],name=expected.binding.importBinding;
  if(!Array.isArray(row)||row.length!==2||row[0]!==bindings[name]||!row[0]||typeof row[0]!=='object'||plainParameterDigest(row[1])!==expected.inputSha256||unique.has(expected.registrationId))throw Error('Actual parameters or imported binding changed');
  unique.add(expected.registrationId);
  // %o has no index placeholder. The actual row/object/callback remain unchanged.
  it.each([row])(title,{meta:{testloreReaRegistration:{...expected,actualBindingReferenceVerified:true,actualPlainInputVerified:true}}},callback);
 }
}
export function transformReaWindowsCases(source,manifest,helperImport='./testlore.rea-case-registration.runtime.mjs'){
 if(registrationHash(source)!==manifest.sourceSha256||source.split(WINDOWS_DECLARATION).length!==2||!/^\.\/[A-Za-z0-9.-]+\.mjs$/.test(helperImport))throw Error('Transform requires exact source and a local helper import');
 const table=WINDOWS_DECLARATION.slice('it.each('.length,WINDOWS_DECLARATION.indexOf('])("accepts')+1);
 const replacement=`__testloreRegisterReaWindowsCases(it, ${table}, "accepts %o", (schema, input) => {\n      expect(schema.safeParse(input).success).toBe(true);\n    }, {closeBinaryInputSchema, exportEvidenceBundleInputSchema}, ${JSON.stringify(manifest)});`;
 return `import {registerReaWindowsCases as __testloreRegisterReaWindowsCases} from ${JSON.stringify(helperImport)};\n`+source.replace(WINDOWS_DECLARATION,replacement);
}
/** Verify actual framework-collected metadata. Raw native names are preserved in evidence. */
export function assessReaRegistrations(manifest,observations,{requireSkipped=true}={}){
 const reasons=[],expected=new Map(manifest.rows.map(row=>[row.registrationId,row]));
 if(!Array.isArray(observations)||observations.length!==expected.size)reasons.push('registration-count-mismatch');
 const seen=new Set(),nativeIds=new Set();for(const observation of observations||[]){const record=observation.registration,row=expected.get(record?.registrationId);if(!row||seen.has(record?.registrationId)||!record.actualBindingReferenceVerified||!record.actualPlainInputVerified||Object.entries(row).some(([key,value])=>JSON.stringify(record[key])!==JSON.stringify(value)))reasons.push('missing-duplicate-or-changed-registration');seen.add(record?.registrationId);if(typeof observation.nativeFile!=='string'||!observation.nativeFile.replaceAll('\\','/').endsWith('/'+manifest.file)||typeof observation.nativeProject!=='string'||typeof observation.rawName!=='string'||!observation.rawName||typeof observation.nativeTaskId!=='string'||!observation.nativeTaskId||nativeIds.has(observation.nativeTaskId)||!Number.isInteger(observation.taskLocation?.line)||observation.taskLocation.line<1)reasons.push('actual-native-task-binding-missing');nativeIds.add(observation.nativeTaskId);if(requireSkipped&&observation.status!=='skipped')reasons.push('registration-is-not-skipped');}
 if(manifest.platform==='win32'&&requireSkipped)reasons.push('Windows execution cannot use skip-only comparison');
 return{schemaVersion:1,complete:reasons.length===0,reasons:[...new Set(reasons)],observations,manifestHash:registrationHash(manifest),omissionAuthority:false,inputEquivalenceClaim:false};
}

export function reaRegistrationReporterSource(manifest){
 return `import {assessReaRegistrations} from './src/contracts/testlore.rea-case-registration.runtime.mjs';\nconst manifest=${JSON.stringify(manifest)};\nconst rows=files=>{const output=[];const visit=(task,parents=[])=>{if(task.type==='test'&&task.meta?.testloreReaRegistration)output.push({rawName:[...parents,task.name].join(' '),nativeTaskId:task.id,nativeFile:task.file?.filepath||'',nativeProject:task.file?.projectName??'',taskLocation:task.location||null,status:task.result?.state==='skip'||task.mode==='skip'?'skipped':task.result?.state==='pass'?'passed':task.result?.state==='fail'?'failed':'unknown',registration:task.meta.testloreReaRegistration});for(const child of task.tasks||[])visit(child,task.type==='suite'?[...parents,task.name]:parents);};for(const file of files||[])for(const child of file.tasks||[])visit(child);return output;};\nexport default class ReaRegistrationReporter{onCollected(files){this.collected=rows(files);}onFinished(files){const observed=rows(files),assessment=assessReaRegistrations(manifest,observed);if(!this.collected||JSON.stringify(this.collected.map(r=>[r.nativeTaskId,r.registration.registrationId]))!==JSON.stringify(observed.map(r=>[r.nativeTaskId,r.registration.registrationId]))){assessment.complete=false;assessment.reasons.push('collection-to-result-registration-mismatch');}console.log('TESTLORE_REA_CASE_REGISTRATION '+JSON.stringify(assessment));}}\n`;
}
export function prepareReaCaseRegistration(root,options={}){
 const manifest=reaCaseRegistrationManifest(root,options);
 const names=['src/contracts/testlore.rea-case-registration.runtime.mjs','testlore.rea-case-registration.plugin.mjs','testlore.rea-case-registration.reporter.mjs'];
 const runtime=reaRegistrationRuntimeSource();
 const plugin=`import {fileURLToPath} from 'node:url';import {transformReaWindowsCases} from './src/contracts/testlore.rea-case-registration.runtime.mjs';\nconst manifest=${JSON.stringify(manifest)},target=fileURLToPath(new URL('./'+manifest.file,import.meta.url)).replaceAll('\\\\','/');\nexport default {name:'testlore-rea-case-registration-experimental',enforce:'pre',transform(code,id){if(id.split('?')[0].replaceAll('\\\\','/')===target)return {code:transformReaWindowsCases(code,manifest),map:null};}};\n`;
 const contents=[runtime,plugin,reaRegistrationReporterSource(manifest)];
 for(const name of names)if(fs.existsSync(path.join(root,name)))throw Error('Preserve existing registration overlay; output already exists');
 for(let index=0;index<names.length;index++)fs.writeFileSync(path.join(root,names[index]),contents[index],{flag:'wx',mode:0o600});
 return {manifest,files:Object.fromEntries(names.map((file,index)=>[file,registrationHash(contents[index])])),plugin:names[1],reporter:names[2],omissionAuthority:false,limitations:['Original source bytes stay unchanged; explicit transform adds per-row metadata via public TestOptions.meta.','Requires actual native collection/finish receipts; mocks cannot qualify this producer.','Opaque binding attestation is not runtime schema structural equivalence. Compare only actual skipped registrations under matching profile identities.','This plugin does not authorize test omissions and may retain conservative fallback.']};
}
export function observeReaCaseRegistrations(stdout,manifest){
 if(!manifest||manifest.kind!=='rea-windows-plain-input-registration-overlay')throw Error('Independent expected registration manifest required');
 if(typeof stdout!=='string'||Buffer.byteLength(stdout)>2*1024*1024)throw Error('Bounded native stdout required');
 const lines=stdout.split('\n').filter(line=>line.startsWith('TESTLORE_REA_CASE_REGISTRATION '));
 if(lines.length!==1)throw Error('Unique actual native registration receipt required');
 const receipt=JSON.parse(lines[0].slice('TESTLORE_REA_CASE_REGISTRATION '.length));
 if(receipt.schemaVersion!==1||receipt.omissionAuthority!==false||receipt.complete!==true)throw Error('Native registration receipt incomplete');
 const checked=assessReaRegistrations(manifest,receipt.observations);if(!checked.complete||checked.manifestHash!==receipt.manifestHash)throw Error('Registration receipt differs from independent expected profile');return {...receipt,independentlyRechecked:true};
}

export function reaRegistrationRuntimeSource(){
 const source=fs.readFileSync(new URL('./rea-case-registration.js',import.meta.url),'utf8');
 const section=(start,end)=>{const from=source.indexOf(start),to=source.indexOf(end,from+start.length);if(from<0||to<0)throw Error('Producer source sections changed');return source.slice(from,to);};
 return "import {createHash} from 'node:crypto';\nexport const registrationHash=bytes=>createHash('sha256').update(typeof bytes==='string'||Buffer.isBuffer(bytes)?bytes:JSON.stringify(bytes)).digest('hex');\nexport const WINDOWS_DECLARATION="+JSON.stringify(WINDOWS_DECLARATION)+";\n"+section('export function plainParameterDigest','export function reaCaseRegistrationManifest')+section('export function registerReaWindowsCases','export function reaRegistrationReporterSource');
}
export function compareReaSkippedRegistrations(manifest,arms){
 if(!Array.isArray(arms)||arms.length<2)throw Error('Two or more independent native arms required');
 const assessed=arms.map(observations=>assessReaRegistrations(manifest,observations));
 const canonical=observations=>observations.map(o=>[o.registration.registrationId,o.nativeProject,o.taskLocation]).sort((a,b)=>a[0].localeCompare(b[0]));
 const aligned=assessed.every(a=>a.complete)&&arms.every(rows=>JSON.stringify(canonical(rows))===JSON.stringify(canonical(arms[0])));
 return{schemaVersion:1,complete:aligned,reasons:aligned?[]:['actual-skipped-registration-profiles-not-aligned'],arms:assessed,omissionAuthority:false,inputEquivalenceClaim:false,scope:'Only these three skipped registrations can be compared by captured plain input/declaration/import binding identity; raw title drift retained.'};
}
