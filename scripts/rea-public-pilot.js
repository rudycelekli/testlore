#!/usr/bin/env node
// Test the immutable npm release against untouched REA maintainer tests.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawn, spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

export const REA_REVISION='3dcb732da33f6ceef597506b14a4536f1c9aff96';
export const RELEASE_REVISION='1f12728e325f13527b63f4023376debcb9270f8c';
export const RELEASE_ARCHIVE_SHA='4fa6b36c17aeae3bf1e56f6100ce1ad73d69d6e498f9deb82f8001c32569806a';
const hash=value=>createHash('sha256').update(value).digest('hex');
const scope='Original REA domain/services/adapters projects only; compiled CLI/MCP and other projects/provider lanes excluded.';
const projects=['--project','domain','--project','services','--project','adapters'];
const failures=run=>(run?.tests||[]).filter(t=>t.status==='failed').map(t=>t.id).sort();
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);

// Native case identities are recomputed independently from file/name/ordinal.
function inventory(tests, files, status=true) {
 const counts=new Map(), ids=new Set(), rows=[];
 for(const test of tests||[]){
  if(!files.includes(test.file)||!test.name||test.name==='<file-load>'||!['passed','failed','skipped'].includes(test.status))throw new Error('Malformed named case');
  const key=`${test.file}\0${test.name}\0${test.line||''}\0${test.column||''}`,ordinal=counts.get(key)||0;counts.set(key,ordinal+1);
  const id=hash(key+'\0'+ordinal);
  if(test.id&&test.id!==id)throw new Error('Case identity mismatch');
  if(ids.has(id))throw new Error('Duplicate case identity');ids.add(id);
  rows.push([id,test.file,test.name,...(status?[test.status]:[])]);
 }
 return rows.sort((a,b)=>a[0].localeCompare(b[0]));
}
function nativeBaseline(baseline, root){
 const tests=[],files=[];
 for(const suite of baseline.testResults||[]){
  const name=suite.name||suite.testFilePath;
  if(typeof name!=='string')throw new Error('Missing baseline file');
  const file=path.isAbsolute(name)?path.relative(root,name):name;
  if(file.startsWith('../')||path.isAbsolute(file)||files.includes(file)||!Array.isArray(suite.assertionResults))throw new Error('Invalid baseline scope');
  files.push(file);
  for(const test of suite.assertionResults)tests.push({file,name:test.fullName||[...(test.ancestorTitles||[]),test.title].join(' '),status:['pending','todo','disabled','skipped'].includes(test.status)?'skipped':test.status});
 }
 return {files:files.sort(),tests};
}
export function assessNodeOracle(runs,root,testsUnchanged){
 const expected=[
  'matches the native Node loader when import uses main before bundler module',
  'matches the native Node loader when import ignores a module-only entry',
  'matches the native Node loader when require ignores a module-only entry',
 ].sort(),assessment={qualified:false,testsUnchanged,runs:[]};
 try{
  const reference=nativeBaseline(runs[0].result,root),baselineRows=inventory(reference.tests,reference.files);
  if(reference.tests.length===0||reference.tests.some(t=>t.status!=='passed'))throw new Error('Non-green Node baseline');
  assessment.runs=runs.map(({label,event,result},i)=>{
   const current=nativeBaseline(result,root),failed=current.tests.filter(t=>t.status==='failed').map(t=>t.name).sort(),green=i===0||i===4;
   const complete=same(reference.files,current.files)&&same(inventory(reference.tests,reference.files,false),inventory(current.tests,current.files,false))&&!result.numRuntimeErrorTestSuites&&!event.signal&&!event.stoppedReason;
   const statuses=green?same(baselineRows,inventory(current.tests,current.files)):current.tests.every(t=>t.status===(expected.includes(t.name)?'failed':'passed'));
   return {label,event,complete:complete&&statuses,passed:result.numPassedTests,skipped:result.numPendingTests,failed};
  });
  assessment.qualified=testsUnchanged&&assessment.runs.length===5&&assessment.runs.every((run,i)=>run.complete&&(i===0||i===4?run.event.exitCode===0&&!run.failed.length:run.event.exitCode===1&&same(run.failed,expected)));
 }catch(error){assessment.error=error.message;}
 return assessment;
}
export function preservePilotReceipts(source, destination){
 if(!fs.existsSync(source))return [];
 fs.mkdirSync(destination,{recursive:true});const copied=[];
 for(const entry of fs.readdirSync(source,{withFileTypes:true})){
  const from=path.join(source,entry.name),to=path.join(destination,entry.name);
  if(entry.isFile()&&/\.(json|jsonl|log)$/.test(entry.name)){fs.copyFileSync(from,to);copied.push(entry.name);}
  else if(entry.isDirectory()&&entry.name!=='workspace')for(const child of preservePilotReceipts(from,to))copied.push(entry.name+'/'+child);
 }
 return copied;
}
/** Recheck raw executions and exact baseline scope, not aggregate booleans. */
export function assessReaPilot(report, baseline, rawTrials, upstreamRoot='/') {
 const reasons=[];let independent,observationCompleted=true;
 try{independent=nativeBaseline(baseline,upstreamRoot);inventory(independent.tests,independent.files);if(baseline.numPassedTests!==independent.tests.filter(t=>t.status==='passed').length||baseline.numFailedTests!==independent.tests.filter(t=>t.status==='failed').length)throw new Error('Baseline count mismatch');}catch{reasons.push('independent-baseline-scope-invalid');}
 if(report?.valid!==true||report.projects?.length!==1)reasons.push('pilot-incomplete-or-invalid');
 if(baseline?.success!==true||!(baseline.numPassedTests>0)||baseline.numFailedTests!==0)reasons.push('independent-baseline-not-green');
 const project=report?.projects?.[0],changes=project?.changes||[];
 if(project?.revision!==REA_REVISION||project?.sourceCheckoutUnchanged!==true)reasons.push('upstream-source-binding-unverified');
 if(changes.length!==2||report.repetitions!==3||rawTrials?.length!==6)reasons.push('requested-trials-incomplete');
 observationCompleted=reasons.every(reason=>reason==='pilot-incomplete-or-invalid')&&report?.projects?.length===1;
 let missed=0,nativeMissed=0,omitted=0,fallbacks=0;
 const rows=[];
 for(let c=0;c<changes.length;c++){
  const change=changes[c];
  if(change.error||change.trials?.length!==3){reasons.push('change-incomplete:'+c);observationCompleted=false;}
  for(let r=0;r<(change.trials||[]).length;r++){
   const trial=change.trials[r],matches=rawTrials?.filter(x=>x.change===c&&x.repetition===r)||[],raw=matches[0];
   if(matches.length!==1){reasons.push('raw-trial-missing-or-duplicate:'+c+':'+r);observationCompleted=false;continue;}
   const {full,subset,native,plan}=raw;
   const fullFailures=failures(full),subsetFailures=failures(subset),nativeFailures=failures(native);
   const missedIds=fullFailures.filter(id=>!subsetFailures.includes(id)),nativeMissedIds=fullFailures.filter(id=>!nativeFailures.includes(id));
   missed+=missedIds.length;nativeMissed+=nativeMissedIds.length;
   if(!trial.valid||!trial.stable||!full?.complete||!subset?.complete||!native?.complete)reasons.push('raw-execution-incomplete:'+c+':'+r);
   const fullFiles=[...(full?.executedFiles||[])].sort(),selected=[...(plan?.selected||[])].sort();
   if(new Set(fullFiles).size!==fullFiles.length||new Set(selected).size!==selected.length||!same(fullFiles,independent?.files)||plan?.total!==fullFiles.length||!same(selected,[...(subset?.executedFiles||[])].sort())||!selected.every(f=>fullFiles.includes(f)))reasons.push('file-execution-binding-mismatch:'+c+':'+r);
   try{
    const fullRows=inventory(full.tests,fullFiles);
    if(!same(inventory(full.tests,fullFiles,false),inventory(independent.tests,independent.files,false)))throw new Error('Baseline named inventory drift');
    const baselineRows=inventory(independent.tests,independent.files),byId=new Map(fullRows.map(row=>[row[0],row]));
    if(baselineRows.some(row=>{const status=byId.get(row[0])?.[3];return change.expectedFailure?(row[3]==='skipped'?status!=='skipped':!['passed','failed'].includes(status)):status!==row[3];}))throw new Error('Baseline skipped/status inventory drift');
    for(const [arm,run]of [['full',full],['subset',subset],['native',native]]){
     const files=run.executedFiles||[];
     if(new Set(files).size!==files.length||!files.every(f=>fullFiles.includes(f))||!same([...files].sort(),[...(run.collectionFiles||[])].sort()))throw new Error(arm+' file scope');
     if(!same(inventory(run.tests,files),fullRows.filter(row=>files.includes(row[1]))))throw new Error(arm+' named case/status preservation');
     const n=failures(run).length;
     if(run.signal||run.error||!Number.isInteger(run.exitCode)||(n?run.exitCode!==1:run.exitCode!==0))throw new Error(arm+' exit status');
    }
   }catch(error){reasons.push('raw-case-preservation-mismatch:'+c+':'+r+':'+error.message);}
   if(!same(fullFailures,subsetFailures)||trial.missedFailures!==missedIds.length||trial.fullFailures!==fullFailures.length)reasons.push('failure-preservation-mismatch:'+c+':'+r);
   if(change.expectedFailure!==Boolean(fullFailures.length))reasons.push('independent-defect-not-demonstrated:'+c+':'+r);
   // Completion certifies collection, not cross-arm identity or product quality.
   try{
    if(!trial.stable||!same(fullFiles,independent.files)||plan.total!==fullFiles.length||!same(selected,[...(subset.executedFiles||[])].sort())||!selected.every(f=>fullFiles.includes(f)))throw new Error('Observation scope/freshness');
    const expectedCounts=new Map(fullFiles.map(file=>[file,independent.tests.filter(t=>t.file===file).length]));
    for(const run of [full,subset,native]){
     const files=run.executedFiles||[];inventory(run.tests,files);
     if(!run.complete||run.signal||run.error||new Set(files).size!==files.length||!files.every(f=>fullFiles.includes(f))||!same([...files].sort(),[...(run.collectionFiles||[])].sort())||run.exitCode!==(failures(run).length?1:0)||files.some(f=>run.tests.filter(t=>t.file===f).length!==expectedCounts.get(f)))throw new Error('Observation report incomplete');
    }
   }catch{observationCompleted=false;}
   const actualOmitted=fullFiles.filter(file=>!selected.includes(file));omitted+=actualOmitted.length;
   if(plan?.mode==='full')fallbacks++;
   if(![trial.testLoreMs,trial.nativeMs,trial.fullMs,trial.verificationDiscoveryMs].every(n=>Number.isFinite(n)&&n>=0)){reasons.push('timing-incomplete:'+c+':'+r);observationCompleted=false;}
   rows.push({change:change.name,repetition:r,valid:trial.valid,fullFiles:fullFiles.length,selectedFiles:selected.length,nativeFiles:(native?.executedFiles||[]).length,omittedFiles:actualOmitted.length,fullFailures:fullFailures.length,missedFailures:missedIds.length,nativeMissedFailures:nativeMissedIds.length,upstreamSkippedCases:(full.tests||[]).filter(t=>t.status==='skipped').length,testLoreOuterMs:trial.testLoreMs,nativeSelectionMs:trial.nativeMs,fullExecutionMs:trial.fullMs,independentDiscoveryMs:trial.verificationDiscoveryMs,mode:plan?.mode,decisionReasons:[...new Set((plan?.decisions||[]).flatMap(d=>d.reasons||[]))]});
  }
 }
 return {schemaVersion:1,qualified:reasons.length===0,observationCompleted,reasons,repo:'morluto/rea',upstreamRevision:REA_REVISION,testLoreVersion:'0.1.0',releasedSourceRevision:RELEASE_REVISION,scope,trialCount:rows.length,missedFailures:missed,nativeMissedFailures:nativeMissed,omittedFileObservations:omitted,fullFallbackTrials:fallbacks,rows,claims:{worldClassEstablished:false,generalSpeedAdvantageEstablished:false,learningImprovementEstablished:false,originalHistoricalBugTreesReplayed:false},limitations:['One historical source file is reverted while untouched later upstream maintainer tests are retained; this is a historical source-reversion experiment, not an original historical environment.','Original lockfile installation on supported Node 22.19; upstream .nvmrc recommends Node 24.18.','Full means the three declared original Vitest projects, not every REA project or real provider. Upstream skips remain visible.','TestLore timing includes discovery, planning, execution and evidence/report retention inside the pilot; it excludes a fresh outer CLI startup. Native/full timings exclude independent oracle discovery.','Framework/OS caches are not reset; JITI filesystem cache is disabled; analysis cache can warm across repetitions.','Dependencies are shared by isolated source copies; this is not an OS sandbox or frozen dependency-byte guarantee.']};
}

export async function main(args=process.argv.slice(2)) {
 if(args.length!==4||args[0]!=='--directory'||args[2]!=='--output')throw new Error('Use --directory NEW_WORKSPACE --output NEW_OUTPUT');
 const directory=path.resolve(args[1]),output=path.resolve(args[3]);
 if(fs.existsSync(directory)||fs.existsSync(output))throw new Error('Preserve evidence: workspace/output must be new');
 fs.mkdirSync(directory,{recursive:true});fs.mkdirSync(output,{recursive:true});
 const repository=fileURLToPath(new URL('../',import.meta.url)),upstream=path.join(directory,'upstream'),tools=path.join(directory,'tools');
 const home=path.join(directory,'home'),temporary=path.join(directory,'tmp');fs.mkdirSync(home);fs.mkdirSync(temporary);
 const user=path.join(home,'user.npmrc'),global=path.join(home,'global.npmrc');fs.writeFileSync(user,'registry=https://registry.npmjs.org/\n',{mode:0o600});fs.writeFileSync(global,'',{mode:0o600});
 const env={PATH:process.env.PATH,HOME:home,TMPDIR:temporary,LANG:'en_US.UTF-8',CI:'1',HUSKY:'0',JITI_FS_CACHE:'false',NPM_CONFIG_USERCONFIG:user,NPM_CONFIG_GLOBALCONFIG:global,NPM_CONFIG_CACHE:path.join(home,'npm-cache')};
 if(process.version!=='v22.19.0')throw new Error('Campaign requires supported Node v22.19.0');
 const pilotOutput='.tddswarm/pilots/rea-public-'+process.pid;
 const started=performance.now(),events=[];let minimumFreeBytes=Infinity;
 async function invoke(label,cwd,command){
  const stdout=fs.openSync(path.join(output,label+'.stdout'),'wx'),stderr=fs.openSync(path.join(output,label+'.stderr'),'wx');
  const begin=performance.now();let stoppedReason=null;
  const sample=()=>{const stat=fs.statfsSync(directory);const other=fs.statfsSync(repository),free=Math.min(Number(stat.bavail)*Number(stat.bsize),Number(other.bavail)*Number(other.bsize));minimumFreeBytes=Math.min(minimumFreeBytes,free);return free;};
  if(sample()<2*1024**3)throw new Error('2 GiB disk reserve unavailable');
  try{
   const result=await new Promise((resolve,reject)=>{
    const child=spawn(command[0],command.slice(1),{cwd,env,shell:false,detached:process.platform!=='win32',stdio:['ignore',stdout,stderr]});
    const kill=()=>{try{process.platform==='win32'?child.kill('SIGKILL'):process.kill(-child.pid,'SIGKILL');}catch{}};
    const timer=setInterval(()=>{if(sample()<2*1024**3||performance.now()-started>1500000){stoppedReason=minimumFreeBytes<2*1024**3?'disk-reserve':'campaign-deadline';kill();}},500);
    child.once('error',error=>{clearInterval(timer);kill();reject(error);});child.once('close',(code,signal)=>{clearInterval(timer);resolve({code,signal});});
   });
   const event={label,command,exitCode:result.code,signal:result.signal,stoppedReason,durationMs:Math.round(performance.now()-begin)};events.push(event);fs.writeFileSync(path.join(output,'execution.json'),JSON.stringify({node:process.version,events,minimumFreeBytes,environment:'isolated HOME/npm config; ambient credential variables omitted; no OS sandbox'},null,2)+'\n');
   return event;
  }finally{fs.closeSync(stdout);fs.closeSync(stderr);}
 }
 const required=async(label,cwd,command)=>{const result=await invoke(label,cwd,command);if(result.exitCode!==0)throw new Error('Required phase failed: '+label);};
 const git=(...args)=>{const r=spawnSync('git',['-C',upstream,...args],{env,encoding:'utf8',timeout:30000,maxBuffer:8*1024*1024});if(r.status!==0)throw new Error('Read-only Git binding failed');return r.stdout;};
 try{
  fs.mkdirSync(upstream);await required('git-init',upstream,['git','init']);await required('git-remote',upstream,['git','remote','add','origin','https://github.com/morluto/rea.git']);await required('git-fetch',upstream,['git','fetch','--depth','4','origin',REA_REVISION]);await required('git-checkout',upstream,['git','checkout','--detach',REA_REVISION]);
  if(git('rev-parse','HEAD').trim()!==REA_REVISION)throw new Error('Upstream revision mismatch');
  const entries=git('ls-files','--stage','-z').split('\0').filter(Boolean).map(value=>{const tab=value.indexOf('\t'),[mode,object]=value.slice(0,tab).split(' ');return {mode,object,file:value.slice(tab+1)};});
  const trackedBytes=entry=>entry.mode==='160000'?Buffer.from(entry.object):entry.mode==='120000'?Buffer.from(fs.readlinkSync(path.join(upstream,entry.file))):fs.readFileSync(path.join(upstream,entry.file));
  const protectedHashes=Object.fromEntries(entries.map(entry=>[entry.file,hash(trackedBytes(entry))]));
  const declarationFiles=['package.json','package-lock.json','.npmrc','.nvmrc','vitest.config.ts'];
  fs.writeFileSync(path.join(output,'source-binding.json'),JSON.stringify({repo:'https://github.com/morluto/rea',revision:REA_REVISION,protectedHashes,declarations:Object.fromEntries(declarationFiles.map(file=>[file,protectedHashes[file]]))},null,2));
  await required('upstream-install',upstream,['npm','ci','--ignore-scripts','--no-audit','--no-fund']);
  fs.copyFileSync(path.join(upstream,'node_modules/.package-lock.json'),path.join(output,'upstream-installed-lock.json'));
  await required('independent-baseline',upstream,[process.execPath,'node_modules/vitest/vitest.mjs','run','--config','vitest.config.ts',...projects,'--reporter','json','--outputFile',path.join(output,'independent-baseline.json')]);
  const baseline=JSON.parse(fs.readFileSync(path.join(output,'independent-baseline.json')));
  if(!baseline.success||!baseline.numPassedTests||baseline.numFailedTests)throw new Error('Independent original baseline did not pass');
  const url='https://registry.npmjs.org/testlore/-/testlore-0.1.0.tgz';const response=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(30000)});if(!response.ok)throw new Error('Release download failed');const chunks=[];let size=0;for await(const chunk of response.body){size+=chunk.length;if(size>16*1024*1024)throw new Error('Release archive size bound');chunks.push(chunk);}const bytes=Buffer.concat(chunks);if(hash(bytes)!==RELEASE_ARCHIVE_SHA)throw new Error('Released archive drift');
  const archive=path.join(directory,'testlore-0.1.0.tgz');fs.writeFileSync(archive,bytes);fs.writeFileSync(path.join(output,'release-download.json'),JSON.stringify({url,sha256:hash(bytes),bytes:size,sourceRevision:RELEASE_REVISION}));fs.mkdirSync(tools);fs.writeFileSync(path.join(tools,'package.json'),JSON.stringify({name:'rea-public-pilot-tools',version:'1.0.0',private:true}));await required('release-install',tools,['npm','install','--ignore-scripts','--no-audit','--no-fund',archive]);
  const installed=JSON.parse(fs.readFileSync(path.join(tools,'node_modules/testlore/package.json')));if(installed.version!=='0.1.0'||installed.gitHead!==RELEASE_REVISION)throw new Error('Installed release identity mismatch');
  const blank='src/cliJsonInput.ts';
  const changes=[{name:'path-normalization-comment',file:blank,before:'export const resolveCliJsonPaths = (',after:'// Qualification: unchanged path normalization.\nexport const resolveCliJsonPaths = (',expectedFailure:false},{name:'blank-path-historical-source-reversion',file:blank,before:fs.readFileSync(path.join(upstream,blank),'utf8'),after:git('show','6a7650e93cba9169baad95d2c52b11351ae39d0e:'+blank),expectedFailure:true}];
  const manifest={schemaVersion:1,repetitions:3,timeoutMs:180000,cachePolicy:{jitiFilesystem:false},projects:[{name:'rea-source-projects',root:upstream,scope,config:{adapter:'vitest',discovery:'native',runner:[process.execPath,'node_modules/vitest/vitest.mjs','run','--config','vitest.config.ts',...projects,'{files}'],analysisCache:{enabled:true}},changes}]};
  fs.writeFileSync(path.join(output,'preregistered-manifest.json'),JSON.stringify(manifest,null,2));
  fs.copyFileSync(path.join(tools,'package-lock.json'),path.join(output,'tools-installed-lock.json'));
  const cli=path.join(tools,'node_modules/testlore/src/cli.js');
  await required('pilot-inspection',repository,[process.execPath,cli,'pilot','--manifest',path.join(output,'preregistered-manifest.json'),'--json']);
  const pilotEvent=await invoke('pilot-execution',repository,[process.execPath,cli,'pilot','--manifest',path.join(output,'preregistered-manifest.json'),'--execute','--output',pilotOutput,'--json']);
  const summary=path.join(repository,pilotOutput,'summary.json');if(!fs.existsSync(summary))throw new Error('Pilot did not retain a complete summary');
  const report=JSON.parse(fs.readFileSync(summary));fs.copyFileSync(summary,path.join(output,'pilot-summary.json'));const rawDirectory=path.join(repository,pilotOutput,'rea-source-projects');
  const rawTrials=[];fs.mkdirSync(path.join(output,'raw-pilot'));
  for(const file of fs.readdirSync(rawDirectory).filter(file=>file.endsWith('.json')))fs.copyFileSync(path.join(rawDirectory,file),path.join(output,'raw-pilot',file));
  for(let c=0;c<2;c++)for(let r=0;r<3;r++){const names=['full','subset','native','plan'];const row={change:c,repetition:r};let complete=true;for(const name of names){const file=path.join(rawDirectory,`change-${c}-trial-${r}-${name}.json`);if(!fs.existsSync(file)){complete=false;break;}row[name]=JSON.parse(fs.readFileSync(file));}if(complete)rawTrials.push(row);}
  // This native boundary oracle is separate from the source-project selector comparison.
  // Later upstream tests remain untouched; only the historical resolver source is reverted.
  const oracle=path.join(directory,'node-oracle');
  await required('node-oracle-clone',directory,['git','-c','core.hooksPath=/dev/null','clone','--local','--no-hardlinks',upstream,oracle]);
  fs.symlinkSync(path.join(upstream,'node_modules'),path.join(oracle,'node_modules'),'dir');
  const nodeFile='src/application/javascript/JavaScriptArtifactPathResolution.ts',testFile='tests/boundary/filesystem/javascriptPackagePrecedence.test.ts';
  const fixed=fs.readFileSync(path.join(oracle,nodeFile)),testHash=hash(fs.readFileSync(path.join(oracle,testFile)));
  const nodeRuns=[];
  async function nodeRun(label){
   const event=await invoke(label,oracle,[process.execPath,'node_modules/vitest/vitest.mjs','run','--config','vitest.config.ts','--project','boundary',testFile,'--reporter','json','--outputFile',path.join(output,label+'.json')]);
   const file=path.join(output,label+'.json');const result=fs.existsSync(file)?JSON.parse(fs.readFileSync(file)):null;
   nodeRuns.push({label,event,result});
  }
  await nodeRun('node-oracle-fixed-baseline');
  try{
   if(nodeRuns[0].event.exitCode===0&&nodeRuns[0].result?.success){
    fs.writeFileSync(path.join(oracle,nodeFile),git('show','68b9fa489b0c07f580633785ec61c17fa20b5083:'+nodeFile));
    for(let r=0;r<3;r++)await nodeRun('node-oracle-source-reversion-'+r);
   }
  }finally{fs.writeFileSync(path.join(oracle,nodeFile),fixed);}
  await nodeRun('node-oracle-fixed-restored');
  const nodeAssessment={schemaVersion:1,scope:'Only the original Node package-precedence boundary file; independent native execution, no TestLore selection comparison.',upstreamRevision:REA_REVISION,sourceBeforeRevision:'68b9fa489b0c07f580633785ec61c17fa20b5083',testFile,testSha256:testHash,...assessNodeOracle(nodeRuns,oracle,hash(fs.readFileSync(path.join(oracle,testFile)))===testHash)};
  fs.writeFileSync(path.join(output,'node-oracle-assessment.json'),JSON.stringify(nodeAssessment,null,2)+'\n');
  const assessment=assessReaPilot(report,baseline,rawTrials,upstream);assessment.pilotExitCode=pilotEvent.exitCode;assessment.nodeOracleQualified=nodeAssessment.qualified;
  if(!nodeAssessment.qualified){assessment.observationCompleted=false;assessment.qualified=false;assessment.reasons.push('separate-node-oracle-incomplete');}
  if(pilotEvent.exitCode!==0||pilotEvent.signal||pilotEvent.stoppedReason){assessment.qualified=false;assessment.reasons.push('pilot-process-incomplete');}
  if(![0,1].includes(pilotEvent.exitCode)||pilotEvent.signal||pilotEvent.stoppedReason)assessment.observationCompleted=false;
  assessment.protectedSourceUnchanged=entries.every(entry=>hash(trackedBytes(entry))===protectedHashes[entry.file])&&!git('status','--porcelain').trim();
  if(!assessment.protectedSourceUnchanged){assessment.observationCompleted=false;assessment.qualified=false;assessment.reasons.push('protected-upstream-source-changed');}
  fs.writeFileSync(path.join(output,'assessment.json'),JSON.stringify(assessment,null,2)+'\n');console.log(JSON.stringify(assessment,null,2));return assessment.qualified?0:assessment.observationCompleted?3:1;
 }catch(error){fs.writeFileSync(path.join(output,'rejection.json'),JSON.stringify({qualified:false,reason:error.message,events,minimumFreeBytes,upstreamRevision:REA_REVISION,releaseRevision:RELEASE_REVISION},null,2)+'\n');throw error;}finally{preservePilotReceipts(path.join(repository,pilotOutput),path.join(output,'pilot-receipts'));}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){try{process.exitCode=await main();}catch(error){console.error(error.message);process.exitCode=1;}}
