import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
import {vitestCaseHash} from '../src/vitest-case-contracts.js';
import {assessContributedE2E,assessContributedE2EWithCases,reconcileE2ECaseCapture,declaredPnpmExecutable,e2eNativeFlags,e2eNativeCases,compareE2EWorkspaceBaseline,verifyE2ECandidateManifest} from '../scripts/contributed-e2e-pilot.js';
const root='/upstream/packages/e2e',oracle='tests/unit/globs.test.ts',other='tests/unit/regexp.test.ts';
const name='glob grammar ? matches exactly one non-/ character';
const raw=(failed=false,files=[oracle,other])=>({success:!failed,numTotalTests:files.length,numPassedTests:files.length-(failed?1:0),numFailedTests:failed?1:0,numPendingTests:0,numRuntimeErrorTestSuites:0,testResults:files.map(file=>({name:root+'/'+file,status:failed&&file===oracle?'failed':'passed',assertionResults:[{fullName:file===oracle?name:'regexp escapes literal symbols',status:failed&&file===oracle?'failed':'passed'}]}))});
const event=failed=>({exitCode:failed?1:0,signal:null,stoppedReason:null,durationMs:20});
function fixture(){
 const trials=[];for(let change=0;change<2;change++)for(let repetition=0;repetition<3;repetition++){
  const failed=change===1,full=raw(failed),files=[oracle],testLore={complete:true,executed:true,exitCode:failed?1:0,executedTests:files,collectionFiles:files,tests:[{file:oracle,name,status:failed?'failed':'passed'}],plan:{selected:files,total:2,mode:'affected',decisions:[{test:other,selected:false,reasons:['no-known-dependency-on-change']}]}};
  trials.push({change,repetition,full,native:raw(failed,files),testLore,fullEvent:event(failed),nativeEvent:event(failed),testLoreEvent:{...event(failed),durationMs:30}});
 }
 return {baseline:raw(),trials};
}
const assess=x=>assessContributedE2E(x.baseline,x.trials,root,{protectedInputsUnchanged:true,restoredGreen:true});
test('candidate campaigns require the actual declared source version and retained revision evidence',()=>{
 const sourceVersion=JSON.parse(fs.readFileSync(new URL('../package.json',import.meta.url),'utf8')).version;
 const installed={name:'testlore',version:sourceVersion,gitHead:'a'.repeat(40)};
 assert.deepEqual(verifyE2ECandidateManifest(installed,sourceVersion),{version:sourceVersion,sourceRevision:installed.gitHead});
 for(const candidate of [{...installed,version:'0.0.0'},{...installed,name:'other'},{...installed,gitHead:undefined},{...installed,gitHead:'not-a-revision'},null])assert.throws(()=>verifyE2ECandidateManifest(candidate,sourceVersion),/provenance/);
 assert.throws(()=>verifyE2ECandidateManifest(installed,undefined),/provenance/);
 // Historical manifests retain their own version; they do not impersonate a
 // fresh source candidate merely because their previous campaign passed.
 assert.deepEqual(verifyE2ECandidateManifest({...installed,version:'0.1.0'},'0.1.0').version,'0.1.0');
 if(sourceVersion!=='0.1.0')assert.throws(()=>verifyE2ECandidateManifest({...installed,version:'0.1.0'},sourceVersion),/provenance/);
});
test('workspace flags bind the original absolute config without duplicating the native root',()=>{
 assert.deepEqual(e2eNativeFlags(root,'workspace'),['--config',root+'/vitest.config.ts','--root',root]);
 assert.deepEqual(e2eNativeFlags(root,'package'),['--config','vitest.config.ts']);
 assert.throws(()=>e2eNativeFlags('relative','workspace'),/Invalid/);
});
test('campaign bootstrap loads before checkout dependencies are installed',t=>{
 const isolated=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'testlore-e2e-bootstrap-')));
 t.after(()=>fs.rmSync(isolated,{recursive:true,force:true}));
 const controller=path.join(isolated,'controller.mjs');
 fs.copyFileSync(fileURLToPath(new URL('../scripts/contributed-e2e-pilot.js',import.meta.url)),controller);
 const script=`const m=await import(${JSON.stringify(pathToFileURL(controller).href)});if(typeof m.contributedE2EPilot!=="function")throw Error("Controller unavailable");`;
 const result=spawnSync(process.execPath,['--input-type=module','-e',script],{cwd:isolated,env:{PATH:path.dirname(process.execPath)},encoding:'utf8',timeout:5000,maxBuffer:1024*1024});
 assert.equal(result.status,0,result.stderr);assert.equal(result.signal,null);assert.equal(result.error,undefined);
});
test('qualifies genuine exact case preservation while retaining a native performance loss',()=>{const result=assess(fixture());assert.equal(result.qualified,true);assert.equal(result.observationCompleted,true);assert.equal(result.rows[0].omittedFiles,1);assert.equal(result.speedAdvantageObserved,false);assert.equal(result.claims.independentTestAuthorship,false);});
test('aggregate claims cannot hide a missed actual Unicode failure',()=>{const x=fixture();x.trials[3].testLore.tests[0].status='passed';x.trials[3].testLore.exitCode=0;x.trials[3].testLoreEvent.exitCode=0;assert.equal(assess(x).qualified,false);});
test('a source reversion requires the exact upstream Unicode assertion failure',()=>{const x=fixture();for(const trial of x.trials.filter(t=>t.change===1)){trial.full.testResults[0].assertionResults[0].fullName='unrelated failure';}assert.equal(assess(x).qualified,false);});
test('equal counts cannot substitute, rename or duplicate named cases',()=>{for(const mutate of [x=>x.trials[0].testLore.tests[0].name='substitute',x=>x.baseline.testResults[0].assertionResults.push(x.baseline.testResults[0].assertionResults[0]),x=>x.trials[0].native.testResults[0].name=root+'/../escape.test.ts']){const x=fixture();mutate(x);assert.equal(assess(x).qualified,false);}});
test('retains upstream skips and rejects interrupted processes despite positive aggregates',()=>{const x=fixture();x.trials[0].testLoreEvent.signal='SIGKILL';const result=assess(x);assert.equal(result.qualified,false);assert.equal(result.observationCompleted,false);});
test('every omission needs a source file explanation and all six repetitions must exist',()=>{const x=fixture();x.trials[0].testLore.plan.decisions=[];assert.equal(assess(x).qualified,false);x.trials.pop();assert.equal(assess(x).observationCompleted,false);});
test('changed protected sources and failed restoration cannot qualify',()=>{for(const opts of [{protectedInputsUnchanged:false,restoredGreen:true},{protectedInputsUnchanged:true,restoredGreen:false}]){const x=fixture();assert.equal(assessContributedE2E(x.baseline,x.trials,root,opts).qualified,false);}});
test('file load failures cannot be misrepresented as an independently detected assertion bug',()=>{const x=fixture();x.trials[3].full.testResults[0].assertionResults[0].status='passed';assert.equal(assess(x).observationCompleted,false);});
test('contradictory exit metadata and native count tampering cannot qualify',()=>{
 const x=fixture();x.trials[3].testLore.exitCode=0;assert.equal(assess(x).qualified,false);
 const y=fixture();y.trials[0].native.numTotalTests=999;assert.equal(assess(y).observationCompleted,false);
});
test('native selection misses remain measured while preserved TestLore failures can qualify',()=>{
 const x=fixture();for(const trial of x.trials.filter(row=>row.change===1)){trial.native=raw(false,[]);trial.nativeEvent=event(false);}
 const result=assess(x);assert.equal(result.qualified,true);assert.equal(result.rows[3].nativeMissedFailures,1);assert.equal(result.rows[3].missedFailures,0);
});
test('duplicate original titles permit complete negative observations but never qualified case identities',()=>{
 const x=fixture();for(const report of [x.baseline,...x.trials.map(trial=>trial.full)]){
  report.testResults[1].assertionResults.push(structuredClone(report.testResults[1].assertionResults[0]));report.numTotalTests++;report.numPassedTests++;
 }
 const result=assess(x);assert.equal(result.observationCompleted,true);assert.equal(result.qualified,false);assert.equal(result.caseIdentitiesComplete,false);assert.equal(result.ambiguousNames.length,1);
 assert.equal(result.rows.length,6);assert.equal(result.rows[3].failedCases,1);assert.equal(result.rows[3].missedFailures,0);assert.equal(result.rows[3].testLoreMs,30);assert.equal(result.speedAdvantageObserved,false);
 assert.ok(result.rows.every(row=>!row.valid&&row.reasons.includes('Original duplicate titles have no proven parameter identity')));
});
test('observed duplicate names retain exact outcome multiplicities without ordinal equivalence',()=>{
 const report=raw();report.testResults[1].assertionResults.push({...report.testResults[1].assertionResults[0],status:'skipped'});report.numTotalTests++;report.numPendingTests++;
 assert.throws(()=>e2eNativeCases(report,root),/Ambiguous/);
 const observed=e2eNativeCases(report,root,{allowAmbiguousNames:true});assert.equal(observed.ambiguousNames.length,1);assert.equal(observed.cases.filter(row=>row.file===other).length,2);
 report.testResults[1].assertionResults.reverse();assert.deepEqual(e2eNativeCases(report,root,{allowAmbiguousNames:true}),observed);
 report.testResults[1].assertionResults.pop();assert.throws(()=>e2eNativeCases(report,root,{allowAmbiguousNames:true}),/counts/);
});

test('semantic sidecars must reconcile with every separately observed native JSON outcome',()=>{
 const report=raw();report.testResults[1].assertionResults.push({...report.testResults[1].assertionResults[0],status:'skipped'});report.numTotalTests++;report.numPendingTests++;
 const named=e2eNativeCases(report,root,{allowAmbiguousNames:true}),capture={actualFiles:named.files,tests:named.cases.map(({file,name,status})=>({project:'unit',file,rawName:name,status}))};
 assert.equal(reconcileE2ECaseCapture(capture,named).cases,3);
 for(const mutate of [c=>c.tests[0].rawName='renamed',c=>c.tests[0].project='integration',c=>c.tests.pop(),c=>c.tests.find(t=>t.status==='skipped').status='passed',c=>c.actualFiles.pop()]){const changed=structuredClone(capture);mutate(changed);assert.throws(()=>reconcileE2ECaseCapture(changed,named),/differs/);}
});
test('asserted semantic success cannot qualify missing native case artifacts',async()=>{
 const x=fixture(),candidateRoot=fileURLToPath(new URL('../',import.meta.url));
 const result=await assessContributedE2EWithCases(x.baseline,x.trials,root,{candidateRoot,baselineCapture:{complete:true,identityComplete:true,omissionAuthority:false},observerParity:{outcomesEqual:true},protectedInputsUnchanged:true,restoredGreen:true});
 assert.equal(result.qualified,false);assert.equal(result.caseIdentitiesComplete,false);assert.equal(result.speedAdvantageObserved,false);assert.ok(result.reasons.includes('Incomplete or changed native case producer evidence'));
});
test('constructed evaluator data distinguishes case qualification from application acceptance',async()=>{
 // Pure evaluator fixture, not a native execution receipt or application measurement.
 const candidateRoot=fileURLToPath(new URL('../',import.meta.url)),producers=['src/reporters/vitest-cases.js','src/vitest-case-contracts.js'].map(file=>vitestCaseHash(fs.readFileSync(path.join(candidateRoot,file)))),x=fixture();
 const capture=(report,scope)=>{
  const named=e2eNativeCases(report,root),inputs=[oracle,other,'vitest.config.ts'].map(file=>({file,sha256:vitestCaseHash('constructed source '+file)}));
  const inventory=named.cases.map(({file,name},index)=>{const entry={file,project:'unit',nativeId:'fixture-'+index,titles:[name],rawName:name,rawReportedFullName:name,location:{line:1,column:1},sourceSha256:inputs.find(input=>input.file===file).sha256,each:false,registration:null};entry.semanticId=vitestCaseHash({project:entry.project,file,titles:entry.titles,sourceSha256:entry.sourceSha256});return entry;});
  const value={schemaVersion:1,kind:'native-vitest-case-capture',vitestVersion:'5.0.1',producerSha256:producers,runtimeManifestSha256:'a'.repeat(64),environmentSha256:'b'.repeat(64),lifecycle:{initialized:true,started:true,ended:true},complete:true,identityComplete:true,omissionAuthority:false,inputEquivalenceClaim:false,inputs,registrationContracts:[],inventory,tests:inventory.map((entry,index)=>({...entry,status:named.cases[index].status,diagnostic:{retryCount:0,repeatCount:0,flaky:false},hadErrors:named.cases[index].status==='failed'})),errors:[],actualFiles:named.files,scope,nativeReason:report.success?'passed':'failed'};value.integrity=vitestCaseHash(value);return value;
 };
 for(const trial of x.trials){trial.fullCapture=capture(trial.full,'full');trial.nativeCapture=capture(trial.native,'native-related');trial.testLore.nativeCaseEvidence=capture(trial.native,'deferred');for(const arm of ['full','native']){trial[arm+'Observed']=structuredClone(trial[arm]);trial[arm+'ObserverEvent']={...trial[arm+'Event']};}}
 const options={candidateRoot,baselineCapture:capture(x.baseline,'full'),observerParity:{original:x.baseline,instrumented:x.baseline,originalEvent:event(false),instrumentedEvent:event(false)},protectedInputsUnchanged:true,restoredGreen:true};
 const slower=await assessContributedE2EWithCases(x.baseline,x.trials,root,options);
 assert.equal(slower.caseComparisonQualified,true,JSON.stringify(slower.reasons));assert.equal(slower.applicationSuccess,false);assert.equal(slower.applicationAcceptance.nativeTimingAdvantage,false);
 for(const trial of x.trials)trial.testLoreEvent.durationMs=1;
 const faster=await assessContributedE2EWithCases(x.baseline,x.trials,root,options);assert.equal(faster.applicationSuccess,true);
 for(const trial of x.trials){trial.testLore.plan.selected=[oracle,other];trial.testLore.plan.decisions=[];trial.testLore.executedTests=[oracle,other];trial.testLore.collectionFiles=[oracle,other];trial.testLore.tests=e2eNativeCases(trial.full,root).cases.map(({file,name,status})=>({file,name,status}));trial.testLore.nativeCaseEvidence=capture(trial.full,'deferred');}
 const noOmissions=await assessContributedE2EWithCases(x.baseline,x.trials,root,options);assert.equal(noOmissions.caseComparisonQualified,true,JSON.stringify(noOmissions.reasons));assert.equal(noOmissions.applicationSuccess,false);assert.equal(noOmissions.applicationAcceptance.safeOmissionsObserved,false);
});

test('workspace comparison independently binds original and workspace native baseline outcomes and cwd',()=>{
 const options={originalEvent:{...event(false),cwd:root},workspaceEvent:{...event(false),cwd:root}};
 const a=raw(),b=raw();assert.equal(compareE2EWorkspaceBaseline(a,b,root,options).outcomesEqual,true);
 b.testResults[0].assertionResults[0].fullName='same count, different contract';assert.equal(compareE2EWorkspaceBaseline(a,b,root,options).outcomesEqual,false);
 assert.throws(()=>compareE2EWorkspaceBaseline(a,raw(),root,{...options,workspaceEvent:{...options.workspaceEvent,cwd:'/upstream'}}),/cwd/);
 assert.throws(()=>compareE2EWorkspaceBaseline(a,raw(),root,{...options,workspaceEvent:{...options.workspaceEvent,signal:'SIGKILL'}}),/incomplete/);
});
test('workspace evaluator rejects asserted parity and preserves exact in-project names and omission explanations',()=>{
 const x=fixture(),workspaceParity={original:x.baseline,workspace:x.baseline,originalEvent:{...event(false),cwd:root},workspaceEvent:{...event(false),cwd:root}};
 for(const t of x.trials){const r=t.testLore;r.executedTests=r.executedTests.map(f=>'packages/e2e/'+f);r.collectionFiles=r.collectionFiles.map(f=>'packages/e2e/'+f);r.tests=r.tests.map(t=>({...t,file:'packages/e2e/'+t.file}));r.plan.selected=[...r.executedTests];r.plan.decisions=r.plan.decisions.map(d=>({...d,test:'packages/e2e/'+d.test}));}
 const options={protectedInputsUnchanged:true,restoredGreen:true,profile:'workspace',workspaceParity};
 assert.equal(assessContributedE2E(x.baseline,x.trials,root,options).qualified,true);
 assert.equal(assessContributedE2E(x.baseline,x.trials,root,{...options,workspaceParity:{outcomesEqual:true,omissionAuthority:false}}).qualified,false);
 x.trials[0].testLore.plan.decisions[0].test=other;assert.equal(assessContributedE2E(x.baseline,x.trials,root,options).qualified,false);
 x.trials[0].testLore.tests[0].file='packages/another/'+oracle;assert.equal(assessContributedE2E(x.baseline,x.trials,root,options).qualified,false);
});

test('pnpm executable follows exact installed metadata instead of guessed v11 layout',()=>{
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'testlore-pnpm-bin-')));
 try{
  const manifest={name:'pnpm',version:'12.3.4',bin:{pnpm:'pnpm'}};
  fs.writeFileSync(path.join(root,'package.json'),JSON.stringify(manifest));fs.writeFileSync(path.join(root,'pnpm'),'#!/bin/sh\nexit 0\n',{mode:0o755});
  const result=declaredPnpmExecutable(root);assert.equal(result.executable,path.join(root,'pnpm'));assert.equal(result.entry,'pnpm');assert.match(result.executableSha256,/^[a-f0-9]{64}$/);
  for(const bin of ['../outside','/absolute','missing']){fs.writeFileSync(path.join(root,'package.json'),JSON.stringify({...manifest,bin:{pnpm:bin}}));assert.throws(()=>declaredPnpmExecutable(root));}
  fs.writeFileSync(path.join(root,'package.json'),JSON.stringify({...manifest,version:'11.0.0'}));assert.throws(()=>declaredPnpmExecutable(root));
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('recursive original build scripts find the verified pinned package manager by name',()=>{
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'testlore-pnpm-path-')));
 try{
  fs.writeFileSync(path.join(root,'package.json'),JSON.stringify({name:'pnpm',version:'12.3.4',bin:{pnpm:'pnpm'}}));
  fs.writeFileSync(path.join(root,'pnpm'),"#!/bin/sh\nprintf '12.3.4\\n'\n",{mode:0o755});
  const pinned=declaredPnpmExecutable(root),env={PATH:[path.dirname(pinned.executable),path.dirname(process.execPath)].join(path.delimiter)};
  const result=spawnSync('/bin/sh',['-c','pnpm --version'],{encoding:'utf8',env});assert.equal(result.status,0,result.stderr);assert.equal(result.stdout.trim(),'12.3.4');
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
