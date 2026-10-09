#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {isDeepStrictEqual} from 'node:util';
import {fileURLToPath} from 'node:url';
const sha=value=>createHash('sha256').update(value).digest('hex');
const SOURCE='6cea38950813e8ccfde6a7b8ea2d7c44ddbd7026',UPSTREAM='0ddea76a7091ac8768e0ced2a9926b37e72e9497';
const ARCHIVE='1884ed7d3503a0275aac8201dd896c2cfcda0193f860fd5e5026d8f74e26fe10',GZIP='5be7cbe376fb2762ab8fdd0454cfbca46f62d77b01b935a2e0ca0910dec7ba7c',RAW='b085ad055dcc269411ae1cbd7c677c7d12472eabc2570501f119c1336da063e7';
function requireThat(value,message){if(!value)throw Error(message);}
function bounded(file,max){const fd=fs.openSync(file,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0));try{const stat=fs.fstatSync(fd);requireThat(stat.isFile()&&stat.size<=max,'Frozen file exceeds regular byte bound');return fs.readFileSync(fd);}finally{fs.closeSync(fd);}}
export function readContributedE2EFrozen(directory){
 const integrity=JSON.parse(bounded(path.join(directory,'original-outcomes.integrity.json'),65536));
 requireThat(integrity.schemaVersion===1&&integrity.file==='original-outcomes.json.gz'&&integrity.sha256===GZIP&&integrity.uncompressedSha256===RAW,'Frozen integrity anchor differs');
 const compressed=bounded(path.join(directory,integrity.file),16*1024*1024);requireThat(compressed.length===integrity.compressedBytes&&sha(compressed)===GZIP,'Frozen compressed bytes changed');
 const bytes=gunzipSync(compressed,{maxOutputLength:64*1024*1024});requireThat(bytes.length===integrity.uncompressedBytes&&sha(bytes)===RAW,'Frozen uncompressed bytes changed');
 const value=JSON.parse(bytes);requireThat(value.schemaVersion===1&&value.artifact?.runId===37953327771&&value.artifact.artifactId===11626598863&&value.artifact.archiveSha256===ARCHIVE&&value.source?.revision===SOURCE&&value.source.controllerSha256==='471b593017a8f06e55d7cec2afde9607663d60574a05f3fb97cec9873fb3fe21'&&isDeepStrictEqual(value.artifact,integrity.artifact)&&isDeepStrictEqual(value.source,integrity.source),'Original artifact/source bindings differ');
 requireThat(Object.keys(value.files).length===98&&integrity.utf8OutcomeFiles===98,'Original artifact member inventory changed');
 for(const [name,item]of Object.entries(value.files)){
  requireThat(path.basename(name)===name&&typeof item.text==='string'&&item.bytes<=32*1024*1024,'Frozen outcome member malformed');
  const text=Buffer.from(item.text,'utf8');requireThat(text.length===item.bytes&&sha(text)===item.sha256,'Original UTF-8 outcome bytes changed: '+name);
 }
 return value;
}
function nativeCases(value,root){
 requireThat(value&&Array.isArray(value.testResults)&&typeof value.success==='boolean'&&!value.testExecError&&!value.numRuntimeErrorTestSuites,'Native report incomplete');
 const files=[],cases=new Map(),identities=new Map();let passed=0,failed=0,skipped=0;
 for(const suite of value.testResults){
  requireThat(typeof suite.name==='string'&&suite.name.startsWith(root+'/tests/unit/')&&Array.isArray(suite.assertionResults),'Native unit scope invalid');
  const file=suite.name.slice(root.length+1);requireThat(/^tests\/unit\/.*\.test\.ts$/.test(file)&&!file.includes('\\')&&!file.split('/').includes('..')&&!files.includes(file),'Native file scope ambiguous');files.push(file);
  for(const item of suite.assertionResults){
   const status=['pending','todo','disabled','skipped'].includes(item.status)?'skipped':item.status;
   requireThat(typeof item.fullName==='string'&&item.fullName&&item.fullName!=='<file-load>'&&['passed','failed','skipped'].includes(status),'Native named outcome malformed');
   const key=JSON.stringify([file,item.fullName,status]),identity=JSON.stringify([file,item.fullName]);cases.set(key,(cases.get(key)||0)+1);identities.set(identity,(identities.get(identity)||0)+1);
   if(status==='passed')passed++;else if(status==='failed')failed++;else skipped++;
  }
  requireThat(suite.status!=='failed'||suite.assertionResults.some(item=>item.status==='failed'),'Native file-load failure is not an assertion bug');
 }
 requireThat(value.numTotalTests===passed+failed+skipped&&value.numPassedTests===passed&&value.numFailedTests===failed&&value.numPendingTests===skipped&&value.success===(failed===0),'Native counts contradict exact named outcomes');
 return {files:files.sort(),cases,identities,passed,failed,skipped};
}
const entries=map=>[...map].sort(([a],[b])=>a.localeCompare(b));
const sameMap=(a,b)=>isDeepStrictEqual(entries(a),entries(b));
const median=values=>{const sorted=[...values].sort((a,b)=>a-b);return (sorted[Math.floor((sorted.length-1)/2)]+sorted[Math.ceil((sorted.length-1)/2)])/2;};
/** Independently compare raw native JSON and actual CLI stdout; no product case IDs or grades. */
export function replayContributedE2EOutcomes(packet){
 const read=name=>{requireThat(typeof packet.files?.[name]?.text==='string','Missing original outcome '+name);return JSON.parse(packet.files[name].text);};
 const baseline=read('independent-original-unit-baseline.json');requireThat(baseline.testResults?.length>0,'Missing native baseline');
 const root=baseline.testResults[0].name.split('/tests/unit/')[0],base=nativeCases(baseline,root),restored=nativeCases(read('restored-original-unit-baseline.json'),root);
 requireThat(base.failed===0&&base.passed>0&&sameMap(base.cases,restored.cases)&&isDeepStrictEqual(base.files,restored.files),'Original restored baseline changed');
 const manifest=read('preregistered-manifest.json'),original=read('original-input-bindings.json'),binding=read('candidate-install-binding.json'),execution=read('execution.json'),producer=read('assessment.json');
 requireThat(manifest.upstreamRevision===UPSTREAM&&original.upstreamRevision===UPSTREAM&&manifest.candidateSourceRevision===SOURCE&&binding.revision===SOURCE&&isDeepStrictEqual(manifest.protectedHashes,original.protectedHashes),'Preregistered original/source input bindings drifted');
 for(const [file,label]of [['src/internal/globs.ts','old-globs.stdout'],['src/internal/regexp.ts','old-regexp.stdout']])requireThat(sha(packet.files[label].text)===manifest.sourceHashes[file].historical&&original.sourceHashes[file]===manifest.sourceHashes[file].original,'Historical source bytes differ');
 const rows=[],diagnostics=[],inScopeChecks=[];
 for(let change=0;change<2;change++)for(let repetition=0;repetition<3;repetition++){
  const trial=read(`trial-${change}-${repetition}.json`),fullRaw=read(`change-${change}-trial-${repetition}-full.json`),nativeRaw=read(`change-${change}-trial-${repetition}-native.json`),cli=read(`change-${change}-trial-${repetition}-testLore.stdout`);
  requireThat(trial.change===change&&trial.repetition===repetition&&isDeepStrictEqual(trial.full,fullRaw)&&isDeepStrictEqual(trial.native,nativeRaw)&&isDeepStrictEqual(trial.testLore,cli),'Embedded trials differ from original reports/stdout');
  const full=nativeCases(fullRaw,root),native=nativeCases(nativeRaw,root);
  requireThat(isDeepStrictEqual(full.files,base.files)&&sameMap(full.identities,base.identities),'Original full named inventory drifted');
  const counts=new Map();for(const item of cli.tests||[]){requireThat(['passed','failed','skipped'].includes(item.status)&&typeof item.name==='string'&&item.name&&cli.executedTests.includes(item.file),'TestLore named outcome malformed');const key=JSON.stringify([item.file,item.name,item.status]);counts.set(key,(counts.get(key)||0)+1);}
  const files=[...(cli.executedTests||[])].sort();requireThat(cli.complete===true&&cli.executed===true&&!cli.signal&&!cli.reportErrors?.length&&!cli.error&&isDeepStrictEqual(files,full.files)&&isDeepStrictEqual([...cli.collectionFiles].sort(),files)&&isDeepStrictEqual([...cli.plan.selected].sort(),files)&&cli.plan.total===base.files.length&&sameMap(counts,full.cases),'TestLore lost raw named outcomes or complete full scope');
  const nativeExpected=new Map([...full.cases].filter(([key])=>native.files.includes(JSON.parse(key)[0])));requireThat(sameMap(native.cases,nativeExpected),'Native selector changed named outcomes in executed files');
  const oracle=JSON.stringify(['tests/unit/globs.test.ts','glob grammar ? matches exactly one non-/ character','failed']);requireThat((full.cases.get(oracle)||0)===change&&full.failed===change&&(native.cases.get(oracle)||0)===change&&(counts.get(oracle)||0)===change,'Actual Unicode regression was lost or changed');
  if(change)for(const report of [fullRaw,nativeRaw]){
   const assertion=report.testResults.flatMap(suite=>suite.assertionResults).find(item=>item.fullName==='glob grammar ? matches exactly one non-/ character'&&item.status==='failed');
   requireThat(assertion?.failureMessages?.some(message=>typeof message==='string'&&message.startsWith('AssertionError:')),'Unicode failure is not actual native assertion evidence');
  }
  const failedKeys=[...full.cases].filter(([key])=>JSON.parse(key)[2]==='failed');requireThat(failedKeys.every(([key,count])=>counts.get(key)===count),'TestLore missed an observed named failure');
  for(const arm of ['full','native','testLore']){
   const event=trial[arm+'Event'],label=`change-${change}-trial-${repetition}-${arm}`;requireThat(event?.label===label&&!event.signal&&!event.stoppedReason&&event.exitCode===change&&Number.isFinite(event.durationMs)&&event.durationMs>=0&&isDeepStrictEqual(execution.events.find(item=>item.label===label),event),'Original process event incomplete or drifted');
  }
  requireThat(cli.exitCode===change,'TestLore self-report exit contradicts actual process');
  let matched=0;
  for(const [file,hash]of Object.entries(manifest.protectedHashes))if(file.startsWith('packages/e2e/')){const relative=file.slice('packages/e2e/'.length),current=cli.provenance?.files?.[relative];if(current!==undefined){requireThat(hash===current,'Protected in-scope bytes changed: '+relative);matched++;}}
  inScopeChecks.push(matched);
  if(change)for(const file of ['src/internal/globs.ts','src/internal/regexp.ts'])requireThat(cli.provenance.files[file]===manifest.sourceHashes[file].historical,'Fault execution was not bound to historical source');
  const observed=cli.unifiedNative?.resolutionDiagnostics;requireThat(observed?.schemaVersion===2&&observed.crossRequestCache===false&&observed.requestedPairs===observed.uniquePairs&&observed.callCount===observed.uniquePairs&&observed.avoidedPairCalls===0,'Actual resolver diagnostic evidence changed');diagnostics.push(observed);
  rows.push({change,repetition,fullFiles:full.files.length,nativeFiles:native.files.length,testLoreFiles:files.length,omittedFiles:base.files.length-files.length,rawNamedOracleFailures:change,rawNamedMissedFailures:0,fullMs:trial.fullEvent.durationMs,nativeMs:trial.nativeEvent.durationMs,testLoreMs:trial.testLoreEvent.durationMs,mode:cli.plan.mode});
 }
 const ambiguousNames=[...base.identities].filter(([,count])=>count>1).map(([key,multiplicity])=>({file:JSON.parse(key)[0],rawName:JSON.parse(key)[1],multiplicity}));
 requireThat(ambiguousNames.length>0&&producer.qualified===false&&producer.observationCompleted===true,'Original rejected qualification changed');
 return {schemaVersion:1,repository:'tester-army/e2e',sourceRevision:SOURCE,upstreamRevision:UPSTREAM,runId:37953327771,artifactArchiveSha256:ARCHIVE,observationCompleted:true,qualified:false,caseIdentitiesComplete:false,scope:'Exact file/title/status multiplicities in original e2e unit project; duplicate titles remain ambiguous',baseline:{files:base.files.length,cases:base.passed+base.skipped,passed:base.passed,skipped:base.skipped},restoredRawNamedBaselineExact:true,ambiguousNames,rows,completeProcessMedians:Object.fromEntries(['fullMs','nativeMs','testLoreMs'].map(metric=>[metric,median(rows.map(row=>row[metric]))])),mediansByChange:Object.fromEntries([0,1].map(change=>[change,Object.fromEntries(['fullMs','nativeMs','testLoreMs'].map(metric=>[metric,median(rows.filter(row=>row.change===change).map(row=>row[metric]))]))])),controllerElapsedMs:execution.elapsedMs,protectedInScopeHashesMatchedPerTrial:inScopeChecks,resolutionDiagnostics:diagnostics,avoidedPairCallsTotal:diagnostics.reduce((sum,item)=>sum+item.avoidedPairCalls,0),claims:{generalSpeedAdvantageEstablished:false,safeSelectiveOmissionsDemonstrated:false,individualCasePreservationQualified:false,independentTestAuthorship:false},limitations:['Protected in-scope hashes are independently matched; final external monorepo workspace bytes are unavailable. Whole-monorepo freshness depends on the original controller admission.','All six TestLore runs use full fallback and preserve named outcome multiplicities. Duplicate titles prevent individual case qualification.','Original assertions landed with our own contribution; their authorship is not independent.','Complete test-process timings include planning and reporting; shared original builds and pre-controller installation are separate. OS caches were not reset.']};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 if(process.argv.length>3)throw Error('Usage: node scripts/contributed-e2e-frozen-replay.js [frozen-directory]');
 const directory=path.resolve(process.argv[2]||'benchmarks/contributed-e2e/observed-20261009');console.log(JSON.stringify(replayContributedE2EOutcomes(readContributedE2EFrozen(directory)),null,2));
}
