// Explicit original-REA observation only; never a plugin allowlist or omission authority.
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {safePath} from './files.js';
import {reaCaseRegistrationManifest,transformReaWindowsCases,assessReaRegistrations,registrationHash,REA_CASE_FILE} from './rea-case-registration.js';
const upstreamRevision='3dcb732da33f6ceef597506b14a4536f1c9aff96';
const lockSha256='7296c105b0ee331d613edd79639cea1493568cfdad7ed8077866f7451f920dac';
const producers=['./rea-case-registration.js','./rea-observation.js'].map(file=>fileURLToPath(new URL(file,import.meta.url)));
export function captureReaObservation(root,config,command){
 if(config.reaObservation===undefined)return null;
 const value=config.reaObservation;
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join(',')!=='profile,upstreamRevision'||value.profile!=='rea-skipped-registration-shadow-v1'||value.upstreamRevision!==upstreamRevision||config.executionMode!=='shadow'||config.vitestCases!==undefined)throw Error('REA observation requires the exact reviewed shadow-only profile');
 const requested=path.resolve(root);if(fs.realpathSync(requested)!==requested||fs.lstatSync(requested).isSymbolicLink())throw Error('REA observation root must be canonical');
 const manifest=reaCaseRegistrationManifest(requested,{upstreamRevision});
 if(manifest.platform==='win32'||manifest.dependencyLockSha256!==lockSha256)throw Error('REA observation requires original lock and non-Windows skip profile');
 const cli=(command||[]).find(arg=>typeof arg==='string'&&/(?:^|[/\\])vitest(?:\.mjs)?$/.test(arg));
 if(!cli||!cli.includes(path.sep))throw Error('REA observation requires an explicit installed native CLI');
 const metadata=createRequire(path.resolve(requested,cli)).resolve('vitest/package.json'),runtimeBytes=fs.readFileSync(metadata);
 if(JSON.parse(runtimeBytes).version!=='5.0.3')throw Error('REA observation requires original Vitest 5.0.3');
 return {schemaVersion:1,profile:structuredClone(value),root:requested,manifest,vitestVersion:'5.0.3',runtimeManifestSha256:registrationHash(runtimeBytes),producerHashes:producers.map(file=>registrationHash(fs.readFileSync(file))),shadowOnly:true,omissionAuthority:false,inputEquivalenceClaim:false};
}
export function assertReaObservation(expected,current){if(JSON.stringify(expected)!==JSON.stringify(current))throw Error('REA observation source/runtime/producer binding changed');}
export function createReaObservationPlugin(binding){
 const target=safePath(binding.root,REA_CASE_FILE).replaceAll('\\','/'),helper=fileURLToPath(new URL('./rea-case-registration.js',import.meta.url)).replaceAll('\\','/');
 // The instance is constructed internally after source/runtime admission. Its
 // name or hash supplied by a project grants no trusted-plugin authority.
 return {name:'testlore-reviewed-rea-shadow-observation',enforce:'pre',transform(source,id){
  if(id.split('?')[0].replaceAll('\\','/')!==target)return;
  // Preserve the original transform, actual table inputs, formatter and callback.
  const local=transformReaWindowsCases(source,binding.manifest);
  return {code:local.replace('"./testlore.rea-case-registration.runtime.mjs"',JSON.stringify(helper)),map:null};
 }};
}
export function createReaObservationReporter(binding){
 const rows=modules=>{const output=[];for(const module of modules||[])for(const task of module.children.allTests()){
  const registration=task.meta().testloreReaRegistration;if(!registration)continue;
  const parents=[];let parent=task.parent;while(parent?.type==='suite'){parents.unshift(parent.name);parent=parent.parent;}
  output.push({rawName:[...parents,task.name].join(' '),rawReportedFullName:task.fullName,nativeTaskId:task.id,nativeFile:task.module.moduleId,nativeProject:task.project.name,taskLocation:task.location||null,status:task.result().state,registration});
 }return output;};
 const linkage=observations=>observations.map(row=>[row.nativeFile,row.nativeProject,row.nativeTaskId,row.registration.registrationId]).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
 return new class {
  constructor(){this.collected=new Map();this.duplicateCollection=false;this.receipt=null;}
  onTestModuleCollected(module){const key=JSON.stringify([module.moduleId,module.project.name]);if(this.collected.has(key))this.duplicateCollection=true;this.collected.set(key,rows([module]));}
  onTestRunEnd(modules,errors,reason){
   const observed=rows(modules),assessment=assessReaRegistrations(binding.manifest,observed),collected=[...this.collected.values()].flat();
   if(!['passed','failed'].includes(reason)||!Array.isArray(errors)||errors.length||this.duplicateCollection||this.collected.size===0||JSON.stringify(linkage(collected))!==JSON.stringify(linkage(observed))){assessment.complete=false;assessment.reasons.push('collection-to-result-registration-mismatch');}
   this.receipt=assessment;console.log('TESTLORE_REA_CASE_REGISTRATION '+JSON.stringify(assessment));
  }
 };
}
/** Optional sidecar only. Native outcomes and legacy named IDs remain authoritative. */
export function validateReaObservationEvidence(binding,receipt,report){
 const assessed=assessReaRegistrations(binding.manifest,receipt?.observations);
 if(receipt?.complete!==true||receipt.omissionAuthority!==false||!assessed.complete||receipt.manifestHash!==registrationHash(binding.manifest))throw Error('REA native registration lifecycle is incomplete');
 const matches=(report?.testResults||[]).filter(suite=>path.resolve(suite.name||suite.testFilePath)===path.join(binding.root,REA_CASE_FILE));
 if(matches.length!==1||matches[0].assertionResults?.length!==17)throw Error('REA original native registration file is incomplete');
 const seen=new Set();for(const row of matches[0].assertionResults){
  const registration=row.meta?.testloreReaRegistration;if(registration===undefined)continue;
  const observation=receipt.observations.find(item=>item.registration.registrationId===registration.registrationId);
  if(!observation||seen.has(registration.registrationId)||row.status!=='skipped'||row.fullName!==observation.rawName||JSON.stringify(row.location)!==JSON.stringify(observation.taskLocation)||JSON.stringify(registration)!==JSON.stringify(observation.registration))throw Error('REA original native outcomes differ from actual registration receipt');
  seen.add(registration.registrationId);
 }
 if(seen.size!==3)throw Error('REA skipped runtime registrations missing');
 return {schemaVersion:1,complete:true,binding,receipt,nativeFile:matches[0],omissionAuthority:false,inputEquivalenceClaim:false,scope:'Actual original-file skipped registrations observed during a full native shadow run; no cross-run, selection or performance qualification.'};
}
