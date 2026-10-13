import {installedRepairEvidenceComplete} from './installed-repair-proof.js';
import {oneCommandEvidenceComplete} from './one-command-proof.js';
import {assessmentImportEvidenceComplete} from './assessment-import-proof.js';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {summarizeTypecheck} from '../src/typecheck-report.js';
const typePhases=[['setup-fault',1,'failed',true,1,[2322]],['healthy-shadow',0,'passed',true,1,[]],['unsupported-no-check',2,'incomplete',false,0,[]]];
export function installedTypecheckEvidenceComplete(value){
 const hex=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
 return value?.verified===true&&value.productionInstalled===true&&value.setupEnabled===true&&value.providerCalls===0&&hex(value.archiveSha256)&&hex(value.installedCliSha256)&&
  typeof value.compilerVersion==='string'&&/^\d+\.\d+\.\d+/.test(value.compilerVersion)&&Array.isArray(value.outcomes)&&value.outcomes.length===3&&
  typePhases.every(([id,exit,status,complete,count,codes],index)=>{
   const row=value.outcomes[index];return row?.id===id&&row.exitCode===exit&&row.nativeExitCode===0&&row.status===status&&row.complete===complete&&row.implementationCount===count&&JSON.stringify(row.errorCodes)===JSON.stringify(codes)&&hex(row.rawSha256);
  })&&value.improvement?.status==='ready-for-review'&&value.improvement.verified===true&&value.improvement.nativeCases===2&&
  typeof value.improvement.sha==='string'&&/^[a-f0-9]{40}$/.test(value.improvement.sha)&&typeof value.improvement.sourceHead==='string'&&/^[a-f0-9]{40}$/.test(value.improvement.sourceHead)&&value.improvement.sha!==value.improvement.sourceHead&&
  value.improvement.originalCallerUnchanged===true&&value.improvement.originalAssertionsUnchanged===true&&value.improvement.physicalDependencies===true&&hex(value.improvement.rawSha256);
}
function verifyInstalledTypedImprovement(value,directory){
 const row=value.improvement,file=path.join(directory,'improvement-ready.json'),stat=fs.lstatSync(file);
 if(!stat.isFile()||stat.isSymbolicLink()||stat.size>16*1024*1024)return false;
 const bytes=fs.readFileSync(file);if(createHash('sha256').update(bytes).digest('hex')!==row.rawSha256)return false;
 const result=JSON.parse(bytes),report=result.fullRun,check=report?.typecheck,typed=summarizeTypecheck(check,{expectedProvenance:report?.provenance});
 const expected=[['test/boundary.test.mjs','independent numeric boundary'],['test/value.test.mjs','ordinary value']];
 const files=expected.map(([file])=>file),exactFiles=value=>Array.isArray(value)&&JSON.stringify([...value].sort())===JSON.stringify(files);
 const cases=report?.tests?.map(test=>[test.file,test.name]).sort((a,b)=>a[0].localeCompare(b[0]));
 return result.status==='ready-for-review'&&result.typecheckVerified===true&&result.sha===row.sha&&result.sourceHead===row.sourceHead&&result.base===row.sourceHead&&result.merged===false&&
  result.typecheckObligation?.enabled===true&&result.typecheckObligation.project==='tsconfig.json'&&result.typecheckObligation.timeoutMs===30000&&result.validation?.accepted===true&&result.validation.qualityReady===true&&
  report?.provenance?.revision===row.sha&&report.complete===true&&report.nativeComplete===true&&report.exitCode===0&&report.nativeExitCode===0&&!report.signal&&!report.error&&!report.reportErrors?.length&&!report.missingFiles?.length&&!report.unknownFiles?.length&&
  typed.complete&&typed.status==='passed'&&check.exitCode===0&&check.compiler?.version===value.compilerVersion&&check.implementationFiles?.length===1&&JSON.stringify(result.typecheck)===JSON.stringify(check)&&
  JSON.stringify(cases)===JSON.stringify(expected)&&report.tests.every(test=>typeof test.id==='string'&&test.id&&test.status==='passed')&&new Set(report.tests.map(test=>test.id)).size===2&&
  !report.actualExecutedFilesUnverified&&exactFiles(report.collectionFiles)&&exactFiles(report.requestedFiles)&&exactFiles(report.executedFiles)&&
  Array.isArray(result.missingCases)&&result.missingCases.length===0&&report.discovery?.complete===true&&exactFiles(report.discovery.files);
}
export function verifyInstalledTypecheckRawEvidence(value,directory){
 if(!installedTypecheckEvidenceComplete(value))return false;
 try{return value.outcomes.every(row=>{
  const file=path.join(directory,row.id+'.json'),stat=fs.lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>16*1024*1024)return false;
  const bytes=fs.readFileSync(file);if(createHash('sha256').update(bytes).digest('hex')!==row.rawSha256)return false;
  const envelope=JSON.parse(bytes),report=envelope.verification||envelope,check=report.typecheck;
  const native=report.tests?.[0],typed=summarizeTypecheck(check,{expectedProvenance:report.provenance||report.plan?.provenance});
  if(report.complete!==true||report.nativeComplete!==true||report.signal||report.error||report.reportErrors?.length||
    report.missingFiles?.length||report.unknownFiles?.length||report.tests?.length!==1||
    typeof native?.id!=='string'||!native.id||native.file!=='test/value.test.mjs'||native.name!=='ordinary value'||native.status!=='passed'||
    JSON.stringify(report.collectionFiles)!==JSON.stringify(['test/value.test.mjs']))return false;
  if(row.id==='unsupported-no-check'){
    if(check?.exitCode!==2||check.signal!==null||check.errorCode!=='typecheck-no-check'||JSON.stringify(check.reasons)!==JSON.stringify(['typecheck-no-check']))return false;
  }else if(!typed.complete||typed.status!==row.status||check.exitCode!==row.exitCode)return false;
  return report.exitCode===row.exitCode&&report.nativeExitCode===0&&check?.status===row.status&&check.complete===row.complete&&
    check.implementationFiles?.length===row.implementationCount&&JSON.stringify(check.diagnostics.filter(d=>d.category==='error').map(d=>d.code))===JSON.stringify(row.errorCodes)&&
    report.tests?.length===1&&report.tests[0].status==='passed';
 })&&verifyInstalledTypedImprovement(value,directory);}catch{return false;}
}
/** Validate the independently produced installed-archive proof, without truthy attestations. */
export function packedEvidenceComplete(receipt, evidence, {proofScriptSha256, sourceManifestSha256, installedRepairProofSha256,oneCommandProofSha256,assessmentImportProofSha256}) {
  const hex = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
  return receipt.schemaVersion === 1 && receipt.qualified === true && evidence.schemaVersion === 1 &&
    typeof receipt.sourceRevision === 'string' && /^[a-f0-9]{40}$/.test(receipt.sourceRevision) &&
    [receipt.archiveSha256, receipt.packedManifestSha256, proofScriptSha256, sourceManifestSha256].every(hex) &&
    evidence.sha256 === receipt.archiveSha256 && evidence.version === receipt.version &&
    evidence.exactInputArchive === true && evidence.productionInstall === true && evidence.shadowSetupVerified === true && evidence.adoptionInspectionVerified === true &&
    evidence.mcpStdioVerified === true && evidence.mcpShadowVerified === true && evidence.briefInspectionVerified === true &&
    evidence.evidenceLoopVerified === true && evidence.mappingQualificationVerified === true && evidence.actionIdentityVerified === true && evidence.runtimeCaptureComplete === true &&
    evidence.proofScriptSha256 === proofScriptSha256 && receipt.sourceManifestSha256 === sourceManifestSha256 &&
    evidence.packedManifestSha256 === receipt.packedManifestSha256 && receipt.archiveRecipe === 'tracked-source-with-exact-gitHead' &&
    evidence.actionReference === receipt.sourceRevision && evidence.workflowActionReference === receipt.sourceRevision &&
    evidence.nativeShadow?.complete === true && evidence.nativeShadow?.detected === true &&
    Array.isArray(evidence.nativeShadow.selected) && evidence.nativeShadow.selected.length > 0 &&
    Number.isSafeInteger(evidence.nativeShadow.executed) && evidence.nativeShadow.executed > evidence.nativeShadow.selected.length &&
    evidence.improvement?.status === 'ready-for-review' && Number.isSafeInteger(evidence.improvement.cases) &&
    evidence.improvement.cases >= 3 && evidence.improvement.originalBranch === 'main' &&
    installedRepairEvidenceComplete(evidence.installedRepair) && hex(installedRepairProofSha256) &&
    evidence.installedRepair.proofScriptSha256 === installedRepairProofSha256 &&
    evidence.installedRepair.archiveSha256 === receipt.archiveSha256 &&
    evidence.installedRepair.installedManifestSha256 === receipt.packedManifestSha256 &&
    oneCommandEvidenceComplete(evidence.oneCommand) && hex(oneCommandProofSha256) &&
    evidence.oneCommand.proofScriptSha256 === oneCommandProofSha256 &&
    evidence.oneCommand.archiveSha256 === receipt.archiveSha256 &&
    evidence.oneCommand.installedManifestSha256 === receipt.packedManifestSha256 &&
    evidence.oneCommand.sourceRevision === receipt.sourceRevision && assessmentImportEvidenceComplete(evidence.assessmentImports) &&
    hex(assessmentImportProofSha256) && evidence.assessmentImports.proofScriptSha256 === assessmentImportProofSha256 &&
    evidence.assessmentImports.archiveSha256 === receipt.archiveSha256 && evidence.assessmentImports.installedManifestSha256 === receipt.packedManifestSha256 &&
    evidence.assessmentImports.sourceRevision === receipt.sourceRevision && evidence.assessmentImports.installedCliSha256 === evidence.oneCommand.installedCliSha256&&
    installedTypecheckEvidenceComplete(evidence.installedTypecheck)&&evidence.installedTypecheck.archiveSha256===receipt.archiveSha256&&
    evidence.installedTypecheck.installedCliSha256===evidence.oneCommand.installedCliSha256;
}
