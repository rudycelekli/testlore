import test from 'node:test';
import assert from 'node:assert/strict';
import {packedEvidenceComplete} from '../scripts/packed-evidence.js';
import {oneCommandFixture} from './one-command-evidence-fixture.js';

const identity = 'a'.repeat(40), archive = 'b'.repeat(64), manifest = 'c'.repeat(64), source = 'd'.repeat(64), proof = 'e'.repeat(64);
const repairProof='f'.repeat(64),native=failed=>({complete:true,exitCode:failed?1:0,files:['test/a.test.js','test/b.test.js'],cases:[{file:'test/a.test.js',name:'independent required a value',status:failed?'failed':'passed'},{file:'test/b.test.js',name:'unchanged required b value',status:'passed'}]});
// Synthetic verifier inputs only; actual native installed runs are produced by packed-proof.js.
const installedRepair={qualified:true,mode:'installed-cli-deterministic-worker',productionInstalled:true,realModelProvider:false,liveGitHub:false,modelCost:null,status:'ready-for-review',published:false,merged:false,omitted:0,originalCallerUnchanged:true,originalAssertionsUnchanged:true,exactCommitVerified:true,sourceHead:identity,sha:'2'.repeat(40),branch:'tddswarm/repair-proof',installedManifestSha256:manifest,archiveSha256:archive,proofScriptSha256:repairProof,workers:{completedCalls:3,executionValidated:false},baseline:[native(true),native(true)],candidateRuns:[native(false),native(false)],assertionRuns:2,finalRun:native(false),wrongSource:{rejected:true,sha:null,published:false},oracleEdit:{rejected:true,sha:null,published:false}};
installedRepair.rawEvidence=['oracle-edit.json','oracle-edit.requests.jsonl','successful.json','successful.requests.jsonl','wrong-source.json','wrong-source.requests.jsonl'].map(file=>({file,bytes:3,sha256:source}));
installedRepair.challenges={accepted:true,identity:source,runtimeSha256:proof,preflightRuns:2,baselineRuns:2,candidateRuns:2,finalPassed:true,caseIds:['preserved-b-value']};
const receipt = {schemaVersion: 1, qualified: true, sourceRevision: identity, archiveSha256: archive, packedManifestSha256: manifest, sourceManifestSha256: source, version: '0.1.0', archiveRecipe: 'tracked-source-with-exact-gitHead'};
const evidence = {schemaVersion: 1, sha256: archive, version: '0.1.0', exactInputArchive: true, productionInstall: true, shadowSetupVerified: true, adoptionInspectionVerified: true, mcpStdioVerified: true, mcpShadowVerified: true, briefInspectionVerified: true, evidenceLoopVerified: true, mappingQualificationVerified: true, actionIdentityVerified: true, runtimeCaptureComplete: true, proofScriptSha256: proof, packedManifestSha256: manifest, actionReference: identity, workflowActionReference: identity, nativeShadow: {complete: true, detected: true, selected: ['test/a.test.js'], executed: 2}, improvement: {status: 'ready-for-review', cases: 3, originalBranch: 'main'},installedRepair};
const oneCommandProof='3'.repeat(64);evidence.oneCommand=oneCommandFixture({archive,manifest,producer:oneCommandProof,revision:identity});
evidence.assessmentImports={verified:true,mode:'installed-cli-synthetic-report-import',liveEvaluation:false,providerCalls:0,archiveSha256:archive,installedManifestSha256:manifest,installedCliSha256:'1'.repeat(64),sourceRevision:identity,proofScriptSha256:proof,outcomes:[{id:'guardana',exitCode:0,outcome:'reported-clean'},{id:'ifixai',exitCode:2,outcome:'incomplete'},{id:'unsupported',exitCode:2,outcome:'incomplete'}],rawEvidence:['guardana','ifixai','unsupported'].flatMap(id=>['input.json','stdout.json','stderr.txt','process.json','receipt.json'].map(suffix=>({file:`${id}.${suffix}`,bytes:3,sha256:source})))};
const context = {proofScriptSha256: proof, sourceManifestSha256: source,installedRepairProofSha256:repairProof,oneCommandProofSha256:oneCommandProof,assessmentImportProofSha256:proof};
evidence.installedTypecheck={verified:true,productionInstalled:true,setupEnabled:true,providerCalls:0,archiveSha256:archive,installedCliSha256:'1'.repeat(64),compilerVersion:'6.0.3',outcomes:[
 {id:'setup-fault',exitCode:1,nativeExitCode:0,status:'failed',complete:true,implementationCount:1,errorCodes:[2322],rawSha256:source},
 {id:'healthy-shadow',exitCode:0,nativeExitCode:0,status:'passed',complete:true,implementationCount:1,errorCodes:[],rawSha256:source},
 {id:'unsupported-no-check',exitCode:2,nativeExitCode:0,status:'incomplete',complete:false,implementationCount:0,errorCodes:[],rawSha256:source}
],improvement:{status:'ready-for-review',verified:true,nativeCases:2,sha:'4'.repeat(40),sourceHead:'5'.repeat(40),originalCallerUnchanged:true,originalAssertionsUnchanged:true,physicalDependencies:true,rawSha256:source}};

test('installed qualification requires explicit evidence for persisted shadow and generated Action identity', () => {
  assert.equal(packedEvidenceComplete(receipt, evidence, context), true);
  for (const field of ['exactInputArchive', 'productionInstall', 'shadowSetupVerified', 'adoptionInspectionVerified', 'mcpStdioVerified', 'mcpShadowVerified', 'briefInspectionVerified', 'evidenceLoopVerified', 'mappingQualificationVerified', 'actionIdentityVerified', 'runtimeCaptureComplete']) {
    for (const value of [undefined, false, 'true']) assert.equal(packedEvidenceComplete(receipt, {...evidence, [field]: value}, context), false, field + ':' + value);
  }
  assert.equal(packedEvidenceComplete({...receipt, qualified: 'true'}, evidence, context), false);
  for (const field of ['complete', 'detected']) for (const value of [undefined, false, 'true']) assert.equal(packedEvidenceComplete(receipt, {...evidence, nativeShadow: {...evidence.nativeShadow, [field]: value}}, context), false);
});
test('packed admission requires native-green/type-failed, healthy and incomplete installed controls',()=>{
 for(const mutation of [undefined,{...evidence.installedTypecheck,verified:'true'},{...evidence.installedTypecheck,providerCalls:1},{...evidence.installedTypecheck,outcomes:[]},
  {...evidence.installedTypecheck,outcomes:evidence.installedTypecheck.outcomes.map(row=>({...row,nativeExitCode:1}))},
  {...evidence.installedTypecheck,outcomes:evidence.installedTypecheck.outcomes.map(row=>({...row,exitCode:0}))},
  ...[undefined,{...evidence.installedTypecheck.improvement,verified:'true'},{...evidence.installedTypecheck.improvement,nativeCases:0},{...evidence.installedTypecheck.improvement,originalAssertionsUnchanged:false},{...evidence.installedTypecheck.improvement,sha:evidence.installedTypecheck.improvement.sourceHead}].map(improvement=>({...evidence.installedTypecheck,improvement}))])
  assert.equal(packedEvidenceComplete(receipt,{...evidence,installedTypecheck:mutation},context),false);
});

test('installed qualification rejects lineage, manifest, fixture scope and proof producer drift', () => {
  for (const field of ['sha256', 'packedManifestSha256', 'proofScriptSha256', 'actionReference', 'workflowActionReference']) assert.equal(packedEvidenceComplete(receipt, {...evidence, [field]: '0'.repeat(64)}, context), false, field);
  assert.equal(packedEvidenceComplete({...receipt, packedManifestSha256: undefined}, {...evidence, packedManifestSha256: undefined}, context), false);
  assert.equal(packedEvidenceComplete(receipt, {...evidence, nativeShadow: {...evidence.nativeShadow, executed: 1}}, context), false);
  assert.equal(packedEvidenceComplete(receipt, {...evidence, improvement: {...evidence.improvement, cases: 0}}, context), false);
  assert.equal(packedEvidenceComplete(receipt, evidence, {...context, sourceManifestSha256: 'f'.repeat(64)}), false);
});

test('sealed release requires installed repair evidence bound to exact archive, manifest and producer',()=>{
 for(const value of [undefined,null,true,{}, {...installedRepair,qualified:'true'},{...installedRepair,archiveSha256:'0'.repeat(64)},{...installedRepair,installedManifestSha256:'0'.repeat(64)},{...installedRepair,proofScriptSha256:'0'.repeat(64)},{...installedRepair,productionInstalled:false},{...installedRepair,originalAssertionsUnchanged:false},{...installedRepair,finalRun:{...native(false),complete:false}},{...installedRepair,wrongSource:{rejected:false,sha:null,published:false}}])assert.equal(packedEvidenceComplete(receipt,{...evidence,installedRepair:value},context),false);
 assert.equal(packedEvidenceComplete(receipt,evidence,{...context,installedRepairProofSha256:undefined}),false);
});

test('sealed release requires one-command actual archive identity and complete default shadow evidence',()=>{
 for(const value of [undefined,null,{}, {...evidence.oneCommand,archiveSha256:'0'.repeat(64)},{...evidence.oneCommand,installedManifestSha256:'0'.repeat(64)},{...evidence.oneCommand,sourceRevision:'0'.repeat(40)},{...evidence.oneCommand,proofScriptSha256:'0'.repeat(64)},{...evidence.oneCommand,explicitDisabledPreserved:false}])assert.equal(packedEvidenceComplete(receipt,{...evidence,oneCommand:value},context),false);
 assert.equal(packedEvidenceComplete(receipt,evidence,{...context,oneCommandProofSha256:undefined}),false);
});

test('sealed release also requires bounded installed assessment imports and retained refusal evidence',()=>{
 for(const value of [undefined,null,{}, {...evidence.assessmentImports,verified:'true'},{...evidence.assessmentImports,liveEvaluation:true},{...evidence.assessmentImports,providerCalls:1},{...evidence.assessmentImports,outcomes:[]},{...evidence.assessmentImports,rawEvidence:[]},{...evidence.assessmentImports,archiveSha256:'0'.repeat(64)},{...evidence.assessmentImports,installedManifestSha256:'0'.repeat(64)},{...evidence.assessmentImports,sourceRevision:'0'.repeat(40)},{...evidence.assessmentImports,proofScriptSha256:'0'.repeat(64)},{...evidence.assessmentImports,installedCliSha256:'0'.repeat(64)}])assert.equal(packedEvidenceComplete(receipt,{...evidence,assessmentImports:value},context),false);
});
