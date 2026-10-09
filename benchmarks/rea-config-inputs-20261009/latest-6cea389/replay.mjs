// Offline evidence check: never installs dependencies or executes upstream code.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const directory=path.dirname(fileURLToPath(import.meta.url));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const json=file=>JSON.parse(fs.readFileSync(file,'utf8'));
function bundle(folder,name){
 const compressed=fs.readFileSync(path.join(folder,name+'.json.gz')),binding=json(path.join(folder,name+'.integrity.json'));
 assert.equal(sha(compressed),binding.gzipSha256);const bytes=gunzipSync(compressed);assert.equal(sha(bytes),binding.uncompressedSha256);
 const {members}=JSON.parse(bytes);assert.deepEqual(Object.keys(members).sort(),Object.keys(binding.members).sort());
 for(const [member,text] of Object.entries(members)){assert.equal(sha(Buffer.from(text)),binding.members[member].sha256);assert.equal(Buffer.byteLength(text),binding.members[member].bytes);}
 return member=>JSON.parse(members[member]);
}
function count(tests,{status=false}={}){const result=new Map();for(const test of tests){const key=JSON.stringify([test.file,test.name,...(status?[test.status]:[])]);result.set(key,(result.get(key)||0)+1);}return result;}
function difference(left,right){return [...left].flatMap(([key,n])=>Array.from({length:Math.max(0,n-(right.get(key)||0))},()=>JSON.parse(key)));}
const rea=json(path.join(directory,'independent-assessment.json'));let trials=0,comparable=0,missed=0,nativeMissed=0,fallback=0,omitted=0;
assert.equal(json(path.join(directory,'workflow-api.json')).headSha,rea.sourceRevision);
for(const seed of rea.seeds){
 const artifact=json(path.join(directory,`artifact-${seed.seed}.json`));assert.equal(artifact.id,seed.artifactId);assert.equal(artifact.digest,'sha256:'+seed.archiveSha256);assert.equal(artifact.size_in_bytes,seed.archiveBytes);assert.equal(artifact.workflow_run.head_sha,rea.sourceRevision);
 const read=bundle(directory,'seed-'+seed.seed),baseline=read('raw-pilot/patch-baseline.json');
 assert.equal(read('assessment.json').qualified,false);assert.equal(read('assessment.json').candidateProvenance.sourceRevision,rea.sourceRevision);
 for(const row of seed.trials){
  const full=read(row.rawMembers.full),subset=read(row.rawMembers.subset),native=read(row.rawMembers.native),selected=new Set(subset.executedFiles);
  assert.equal(full.complete,true);assert.equal(subset.complete,true);assert.equal(native.complete,true);
  assert.equal(full.tests.length,row.fullCases);assert.equal(subset.tests.length,row.subsetCases);assert.equal(native.tests.length,row.nativeCases);
  assert.equal(selected.size,row.selectedFiles);assert.equal(full.executedFiles.length,row.fullFiles);assert.equal(native.executedFiles.length,row.nativeFiles);
  const expected=count(full.tests.filter(test=>selected.has(test.file)),{status:true}),actual=count(subset.tests,{status:true});
  const differences={subsetMissing:difference(expected,actual),subsetExtra:difference(actual,expected),baselineMissing:difference(count(baseline.tests),count(full.tests)),baselineExtra:difference(count(full.tests),count(baseline.tests))};
  assert.deepEqual(differences,row.caseDifferences);assert.equal(!Object.values(differences).some(value=>value.length),row.caseComparisonComparable);
  const failures=count(full.tests.filter(test=>test.status==='failed'));
  assert.deepEqual(difference(failures,count(subset.tests.filter(test=>test.status==='failed'))),row.missedFailures);
  assert.deepEqual(difference(failures,count(native.tests.filter(test=>test.status==='failed'))),row.nativeMissedFailures);
  assert.deepEqual(subset.unifiedNative.resolutionDiagnostics,row.resolutionDiagnostics);assert.deepEqual(subset.unifiedNative.sourceSummaryReuse,row.sourceSummaryReuse);
  const d=row.resolutionDiagnostics;assert.equal(d.requestedPairs-d.uniquePairs,d.avoidedPairCalls);assert.equal(d.uniquePairs,d.callCount);assert.equal(d.crossRequestCache,false);
  trials++;comparable+=Number(row.caseComparisonComparable);missed+=row.missedFailures.length;nativeMissed+=row.nativeMissedFailures.length;fallback+=Number(subset.plan.mode==='full');omitted+=full.executedFiles.length-selected.size;
 }
}
assert.equal(trials,rea.totals.trials);assert.equal(comparable,rea.totals.independentlyComparableTrials);assert.equal(missed,rea.totals.missedFailureObservations);assert.equal(nativeMissed,rea.totals.nativeMissedFailureObservations);assert.equal(fallback,rea.totals.fullFallbackTrials);assert.equal(omitted,rea.totals.omittedFileObservations);assert.equal(rea.qualified,false);
const bunFolder=path.resolve(directory,'../../claude-mem-20261009/gated-6cea389'),bun=json(path.join(bunFolder,'independent-assessment.json')),read=bundle(bunFolder,'native-gated'),raw=read('campaign/assessment.json');
const bunArtifact=json(path.join(bunFolder,'artifact-api.json'));assert.equal(bunArtifact.id,bun.artifactId);assert.equal(bunArtifact.digest,'sha256:'+bun.archiveSha256);assert.equal(bunArtifact.size_in_bytes,bun.archiveBytes);assert.equal(bunArtifact.workflow_run.head_sha,bun.sourceRevision);assert.equal(json(path.join(bunFolder,'workflow-api.json')).headSha,bun.sourceRevision);
assert.equal(raw.qualified,false);assert.equal(raw.protectedInputsUnchanged,true);assert.equal(raw.trials.length,0);assert.equal(raw.regressionAdmission.admitted,false);assert.equal(bun.sourceFaultApplicationsObserved,0);assert.equal(bun.testLoreRegressionTrials,0);
for(const scope of bun.baselines){const report=read(scope.rawMember);assert.equal(report.complete,scope.complete);assert.equal(report.exitCode,scope.exitCode);assert.equal(report.durationMs,scope.durationMs);const counts={};for(const test of report.tests||[])counts[test.status]=(counts[test.status]||0)+1;assert.deepEqual(counts,scope.counts);assert.deepEqual((report.tests||[]).filter(test=>test.status==='failed'),scope.failedCases);}
assert.deepEqual(raw.notRun,bun.notRun);assert.equal(read('upstream-installation.json').dependencyInventoryAccepted,false);
console.log(JSON.stringify({integrityVerified:true,rea:{trials,comparable,qualifiedSeedProfiles:0,missed,nativeMissed,fallback,omitted},bun:{faultApplications:0,comparisonTrials:0,qualified:false},qualification:false}));
