import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {test,before,after} from 'node:test';
import {loadBugTransfer,runBugTransferProof,verifyBugTransferEvidence,evaluateBugTransfer} from '../scripts/bug-transfer-proof.js';

const dataset=fileURLToPath(new URL('../benchmarks/bug-transfer/correctness-20261011',import.meta.url));
const hash=value=>crypto.createHash('sha256').update(typeof value==='string'||Buffer.isBuffer(value)?value:JSON.stringify(value)).digest('hex');
const clone=value=>structuredClone(value);
let directory,proof,loaded,rows;
before(async()=>{directory=fs.mkdtempSync(path.join(os.tmpdir(),'testlore-transfer-test-'));loaded=loadBugTransfer();proof=await runBugTransferProof({evidenceDirectory:path.join(directory,'proof')});rows=JSON.parse(fs.readFileSync(path.join(directory,'proof/results.json')));});
after(()=>fs.rmSync(directory,{recursive:true,force:true}));
function mutateData(change){const root=fs.mkdtempSync(path.join(os.tmpdir(),'testlore-transfer-data-'));fs.cpSync(dataset,root,{recursive:true});const manifestFile=path.join(root,'manifest.json'),manifest=JSON.parse(fs.readFileSync(manifestFile));change(manifest,root);const bytes=Buffer.from(JSON.stringify(manifest,null,2)+'\n');fs.writeFileSync(manifestFile,bytes);const freeze=JSON.parse(fs.readFileSync(path.join(root,'freeze.json')));freeze.manifestSha256=hash(bytes);fs.writeFileSync(path.join(root,'freeze.json'),JSON.stringify(freeze));return {root,manifestFile};}
function seal(receipt){delete receipt.integrity;receipt.integrity=hash(receipt);}
function mutateCase(receipt,change){for(const raw of receipt.rawRuns){change(raw.result.cases);raw.stdout=JSON.stringify(raw.result);raw.stdoutSha256=hash(raw.stdout);}receipt.cases=clone(receipt.rawRuns[0].result.cases);seal(receipt);}

test('three pinned historical correctness failures resolve; unrelated targets produce clean negatives',async()=>{
 assert.equal(proof.summary.historicalQualified,3);assert.equal(proof.summary.eligibleIndependentTargets,2);assert.equal(proof.summary.excludedTargets,1);assert.equal(proof.summary.guidedCandidateMismatches,0);assert.equal(proof.summary.unguidedCandidateMismatches,0);assert.equal(proof.summary.newUpstreamDefectsConfirmed,0);assert.equal(proof.summary.inconclusiveProbes,0);assert.equal(proof.agentEffectivenessMeasured,false);assert.equal(proof.learningPromoted,false);assert.equal(proof.providerCalls,0);assert.equal(proof.networkRequests,0);
 assert.equal(await verifyBugTransferEvidence({evidenceDirectory:path.join(directory,'proof'),proof}),true);
});
test('frozen prospective cases and exact public byte commitments are enforced',()=>{
 const {root,manifestFile}=mutateData((_manifest,copy)=>{const file=path.join(copy,'specifications.json');fs.appendFileSync(file,' ');});try{assert.throws(()=>loadBugTransfer(manifestFile),/Pinned source bytes changed|Expected values/);}finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('replay reads no arbitrary outside file or symlink source',()=>{
 const {root,manifestFile}=mutateData((manifest,copy)=>{const item=manifest.sources[0],file=path.join(copy,item.file),bytes=fs.readFileSync(file);fs.unlinkSync(file);const elsewhere=path.join(copy,'outside-file');fs.writeFileSync(elsewhere,bytes);fs.symlinkSync(elsewhere,file);});try{assert.throws(()=>loadBugTransfer(manifestFile),/Symlink/);}finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('a rehashed import adapter cannot silently change implementation',()=>{
 const {root,manifestFile}=mutateData((manifest,copy)=>{const item=manifest.sources.find(source=>source.transformation?.startsWith('exact-import-rewrite:')),file=path.join(copy,item.file),bytes=Buffer.concat([fs.readFileSync(file),Buffer.from('\n// undeclared change\n')]);fs.writeFileSync(file,bytes);item.bytes=bytes.length;item.sha256=hash(bytes);});try{assert.throws(()=>loadBugTransfer(manifestFile),/Import adapter changed code/);}finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('extra comparator cases or a larger execution budget are rejected before execution',()=>{
 const {root,manifestFile}=mutateData(manifest=>{manifest.budgets.casesPerArm=4;});try{assert.throws(()=>loadBugTransfer(manifestFile),/Comparison budgets changed/);}finally{fs.rmSync(root,{recursive:true,force:true});}
 const altered=clone(rows);altered[0].unguided.timeoutMs=4000;seal(altered[0].unguided);assert.throws(()=>evaluateBugTransfer(loaded,altered));
});
test('historical target repository leakage is excluded before transfer',()=>{
 const {root,manifestFile}=mutateData(manifest=>{manifest.recipes[0].target.repository='jonschlinkert/is-number';});try{assert.throws(()=>loadBugTransfer(manifestFile));}finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('a different repository name does not make a documented source fork independent',()=>{
 const {root,manifestFile}=mutateData(manifest=>{manifest.recipes[2].target.eligibleIndependentTransfer=true;});try{assert.throws(()=>loadBugTransfer(manifestFile),/fork ancestry/);}finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('duplicate JSON keys cannot silently replace a frozen declaration',()=>{
 const {root,manifestFile}=mutateData(()=>{});try{const bytes=Buffer.from(fs.readFileSync(manifestFile,'utf8').replace('"schemaVersion": 1','"schemaVersion": 1, "schemaVersion": 1'));fs.writeFileSync(manifestFile,bytes);const freeze=JSON.parse(fs.readFileSync(path.join(root,'freeze.json')));freeze.manifestSha256=hash(bytes);fs.writeFileSync(path.join(root,'freeze.json'),JSON.stringify(freeze));assert.throws(()=>loadBugTransfer(manifestFile),/Duplicate/);}finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('missing named outcomes cannot be reported as a passed probe',()=>{
 const altered=clone(rows);mutateCase(altered[0].guided,cases=>cases.pop());assert.throws(()=>evaluateBugTransfer(loaded,altered));
});
test('resealed factual throws cannot be falsely reported as passing equal-value assertions',()=>{
 const altered=clone(rows);mutateCase(altered[0].guided,cases=>{cases[0].observed={kind:'throw',name:'TypeError'};cases[0].observedSha256=hash(cases[0].observed);cases[0].status='passed';});assert.throws(()=>evaluateBugTransfer(loaded,altered),/Factual observation/);
});
test('factual case values must support reported outcomes even after all hashes are recomputed',()=>{
 const altered=clone(rows);mutateCase(altered[0].guided,cases=>{cases[0].observed={kind:'value',value:true};cases[0].observedSha256=hash(cases[0].observed);cases[0].status='passed';});assert.throws(()=>evaluateBugTransfer(loaded,altered),/Factual observation/);
});
test('a timeout is retained as inconclusive and cannot become a discovered defect',()=>{
 const altered=clone(rows),receipt=altered[0].guided;receipt.rawRuns.forEach(raw=>{raw.reason='deadline';raw.exitCode=null;raw.signal='SIGKILL';raw.result=null;raw.stdout='';raw.stdoutSha256=hash('');});receipt.cases=[];receipt.reason='deadline';receipt.outcome='inconclusive';seal(receipt);const summary=evaluateBugTransfer(loaded,altered);assert.equal(summary.inconclusiveProbes,1);assert.equal(summary.guidedCandidateMismatches,0);assert.equal(summary.newUpstreamDefectsConfirmed,0);
 receipt.outcome='reproduced';seal(receipt);assert.throws(()=>evaluateBugTransfer(loaded,altered));
});
test('a historical recipe that no longer reproduces is retained as blocked, never transferred',()=>{
 const altered=clone(rows),receipt=altered[0].original;mutateCase(receipt,cases=>{for(const row of cases){row.observed={kind:'value',value:false};row.observedSha256=hash(row.observed);row.status='passed';}});receipt.outcome='passed';seal(receipt);altered[0].historicalQualified=false;altered[0].guided=null;altered[0].abstentionReason='historical-recipe-not-qualified';const summary=evaluateBugTransfer(loaded,altered);assert.equal(summary.historicalQualified,2);assert.equal(summary.blockedTransfers,1);assert.equal(summary.eligibleIndependentTargets,1);assert.equal(summary.newUpstreamDefectsConfirmed,0);
});
test('contract-incompatible direct-fork target abstains rather than acquiring guided authority',()=>{
 const altered=clone(rows);altered[2].guided=clone(rows[2].unguided);assert.throws(()=>evaluateBugTransfer(loaded,altered),/must abstain/);assert.equal(rows[2].guided,null);assert.match(rows[2].abstentionReason,/fork ancestry/);
});
test('source, worker and evaluator identities bind evidence to the exact current implementation',async()=>{
 for(const key of ['manifestSha256','specificationsSha256','evaluatorSha256','recipeModuleSha256','workerSha256']){const changed=clone(proof);changed[key]='0'.repeat(64);await assert.rejects(verifyBugTransferEvidence({evidenceDirectory:path.join(directory,'proof'),proof:changed,replay:false}));}
});
test('raw replay evidence cannot be silently replaced or promoted into an AI quality claim',async()=>{
 const changed=clone(proof);changed.agentEffectivenessMeasured=true;await assert.rejects(verifyBugTransferEvidence({evidenceDirectory:path.join(directory,'proof'),proof:changed,replay:false}));
 const raw=path.join(directory,'proof/results.json'),original=fs.readFileSync(raw);fs.appendFileSync(raw,' ');try{await assert.rejects(verifyBugTransferEvidence({evidenceDirectory:path.join(directory,'proof'),proof,replay:false}));}finally{fs.writeFileSync(raw,original);}
});
