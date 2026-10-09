#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';

export const E2E_PIN='0ddea76a7091ac8768e0ced2a9926b37e72e9497';
export const E2E_PARENT='b2a28d4813df9e0c0816cfffbdb51f4cc4e04faa';
export const E2E_LOCK_SHA='8fc2fe6cf6b13b501483f30854e7fe56a957cfce04ac41c8ce2a7cadcd8f4896';
const ORACLE='tests/unit/globs.test.ts',SOURCES=['src/internal/globs.ts','src/internal/regexp.ts'];
const digest=value=>createHash('sha256').update(value).digest('hex');
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
function trackedDigest(root,file){const full=path.join(root,file);return fs.lstatSync(full).isSymbolicLink()?digest('symlink:'+fs.readlinkSync(full)):digest(fs.readFileSync(full));}
function boundedJson(file){const fd=fs.openSync(file,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0));try{const stat=fs.fstatSync(fd);if(!stat.isFile()||stat.size>32*1024**2)throw Error('Native report size bound exceeded');const bytes=Buffer.alloc(stat.size+1);let size=0;for(let n;size<bytes.length&&(n=fs.readSync(fd,bytes,size,bytes.length-size,null));)size+=n;if(size!==stat.size)throw Error('Report changed during read');return JSON.parse(bytes.subarray(0,size));}finally{fs.closeSync(fd);}}
/** Resolve the exact installed package's declared executable; never guess historical layouts. */
export function declaredPnpmExecutable(directory){
 directory=fs.realpathSync(directory);const manifest=boundedJson(path.join(directory,'package.json'));
 const entry=manifest.bin?.pnpm;
 if(manifest.name!=='pnpm'||manifest.version!=='12.3.4'||typeof entry!=='string'||!entry||entry.includes('\\')||entry.includes('\0')||path.isAbsolute(entry)||entry.split('/').includes('..'))throw Error('Pinned pnpm declared executable invalid');
 const target=fs.realpathSync(path.resolve(directory,entry));
 if(!target.startsWith(directory+path.sep)||!fs.statSync(target).isFile())throw Error('Pinned pnpm executable escapes installed package');
 return {executable:target,packageSha256:digest(fs.readFileSync(path.join(directory,'package.json'))),executableSha256:digest(fs.readFileSync(target)),entry};
}
/** Reconstruct exact named outcomes independently of TestLore IDs and aggregate gates. */
export function e2eNativeCases(value,root){
 if(!value||!Array.isArray(value.testResults)||typeof value.success!=='boolean'||value.numRuntimeErrorTestSuites||value.testExecError)throw Error('Native report incomplete');
 const files=[],cases=[],keys=new Set();
 for(const suite of value.testResults){
  const file=path.isAbsolute(suite.name||suite.testFilePath)?path.relative(root,suite.name||suite.testFilePath):suite.name||suite.testFilePath;
  if(typeof file!=='string'||!/^tests\/unit\/.*\.test\.ts$/.test(file)||file.split('/').includes('..')||files.includes(file)||!Array.isArray(suite.assertionResults))throw Error('Native file scope invalid');
  files.push(file);
  for(const assertion of suite.assertionResults){
   const name=assertion.fullName||[...(assertion.ancestorTitles||[]),assertion.title].join(' '),status=['pending','todo','disabled','skipped'].includes(assertion.status)?'skipped':assertion.status;
   const key=JSON.stringify([file,name]);
   if(typeof name!=='string'||!name||name==='<file-load>'||!['passed','failed','skipped'].includes(status)||keys.has(key))throw Error('Ambiguous or malformed native case');
   keys.add(key);cases.push({key,file,name,status});
  }
  if(suite.status==='failed'&&!suite.assertionResults.some(test=>test.status==='failed'))throw Error('File-load error is not an assertion failure');
 }
 if(value.numTotalTests!==cases.length||value.numPassedTests!==cases.filter(test=>test.status==='passed').length||value.numFailedTests!==cases.filter(test=>test.status==='failed').length||value.numPendingTests!==cases.filter(test=>test.status==='skipped').length||value.success!==(value.numFailedTests===0))throw Error('Native named counts or success mismatch');
 return {files:files.sort(),cases:cases.sort((a,b)=>a.key.localeCompare(b.key))};
}
function normalizedTestLore(value){
 if(!value?.complete||!value.executed||!Array.isArray(value.tests)||!Array.isArray(value.executedTests)||!Array.isArray(value.collectionFiles)||!value.plan||!same([...value.executedTests].sort(),[...value.collectionFiles].sort())||!same([...value.plan.selected].sort(),[...value.executedTests].sort())||value.reportErrors?.length||value.error||value.signal||value.tests.some(test=>test.name==='<file-load>'))throw Error('TestLore execution incomplete');
 const keys=new Set(),cases=[];
 for(const test of value.tests){const key=JSON.stringify([test.file,test.name]);if(!value.executedTests.includes(test.file)||typeof test.name!=='string'||!test.name||!['passed','failed','skipped'].includes(test.status)||keys.has(key))throw Error('TestLore named case ambiguous');keys.add(key);cases.push({key,file:test.file,name:test.name,status:test.status});}
 return {files:[...value.executedTests].sort(),cases:cases.sort((a,b)=>a.key.localeCompare(b.key))};
}
/** Qualification never follows from equal counts, self-reported recall or low timings. */
export function assessContributedE2E(baseline,trials,root,{protectedInputsUnchanged,restoredGreen}={}){
 const assessment={schemaVersion:1,repository:'tester-army/e2e',upstreamRevision:E2E_PIN,contribution:'https://github.com/tester-army/e2e/pull/927',scope:'Original e2e unit Vitest project only, following original monorepo install/build',qualified:false,observationCompleted:false,reasons:[],rows:[],claims:{generalSpeedAdvantageEstablished:false,worldClassEstablished:false,independentTestAuthorship:false},limitations:['The regression assertions landed with our own merged contribution. Upstream tests are untouched, but their authorship is not independent of our contribution.','Two source files are restored from the contribution parent while later upstream tests stay fixed; this is not the original historical full tree.','Original pnpm lock/config/package declarations and build order are retained; full means one complete unit project, not integration/browser/provider/application qualification.','Complete test-process timings include CLI imports, planning/execution/reporting and exit. Original build preparation is shared across arms and recorded separately, outside these test timings. OS caches are not reset; ordered repetitions are not certified cold/warm benchmarks.']};
 try{
  const base=e2eNativeCases(baseline,root);if(!base.cases.length||base.cases.some(test=>test.status==='failed')||!baseline.success)throw Error('Original unit baseline is not green');
  if(protectedInputsUnchanged!==true)throw Error('Protected original inputs changed');if(restoredGreen!==true)throw Error('Restored unit baseline rejected');
  if(!Array.isArray(trials)||trials.length!==6||new Set(trials.map(trial=>trial.change+':'+trial.repetition)).size!==6||trials.some(trial=>![0,1].includes(trial.change)||![0,1,2].includes(trial.repetition)))throw Error('Six preregistered trials are required');
  let completed=true;
  for(const trial of trials){
   const row={change:trial.change,repetition:trial.repetition,valid:false,reasons:[]};assessment.rows.push(row);
   try{
    const full=e2eNativeCases(trial.full,root),native=e2eNativeCases(trial.native,root),subset=normalizedTestLore(trial.testLore);
    if(trial.testLore.exitCode!==trial.testLoreEvent?.exitCode)throw Error('TestLore reported/process exit mismatch');
    for(const event of [trial.fullEvent,trial.nativeEvent,trial.testLoreEvent])if(!event||event.signal||event.stoppedReason||![0,1].includes(event.exitCode)||!Number.isFinite(event.durationMs)||event.durationMs<0)throw Error('Native process incomplete');
    if(!same(full.files,base.files)||!same(full.cases.map(test=>test.key),base.cases.map(test=>test.key))||trial.testLore.plan.total!==base.files.length)throw Error('Full original named inventory drift');
    const failures=full.cases.filter(test=>test.status==='failed');
    if(full.cases.some(test=>base.cases.find(old=>old.key===test.key).status==='skipped'?test.status!=='skipped':test.status==='skipped'))throw Error('Original skip inventory drift');
    if(trial.change===0&&failures.length||trial.change===1&&!failures.some(test=>test.file===ORACLE&&test.name==='glob grammar ? matches exactly one non-/ character'))throw Error('Preregistered Unicode regression not independently demonstrated');
    for(const [arm,run,event]of [['native',native,trial.nativeEvent],['TestLore',subset,trial.testLoreEvent],['full',full,trial.fullEvent]]){
     if(!run.files.every(file=>base.files.includes(file))||!same(run.cases,full.cases.filter(test=>run.files.includes(test.file))))throw Error(arm+' lost or changed named cases/statuses');
     const failed=run.cases.filter(test=>test.status==='failed');if(event.exitCode!==(failed.length?1:0))throw Error(arm+' exit/case mismatch');
     if(arm!=='native'&&failures.some(test=>!run.cases.some(other=>other.key===test.key&&other.status==='failed')))throw Error(arm+' missed an actual failure');
    }
    const omitted=base.files.filter(file=>!subset.files.includes(file));
    if(omitted.some(file=>!trial.testLore.plan.decisions?.some(decision=>decision.test===file&&!decision.selected&&Array.isArray(decision.reasons)&&decision.reasons.length)))throw Error('Omission explanation missing');
    Object.assign(row,{valid:true,fullFiles:base.files.length,selectedFiles:subset.files.length,nativeFiles:native.files.length,omittedFiles:omitted.length,failedCases:failures.length,missedFailures:0,nativeMissedFailures:failures.filter(test=>!native.cases.some(other=>other.key===test.key&&other.status==='failed')).length,mode:trial.testLore.plan.mode,fullMs:trial.fullEvent.durationMs,nativeMs:trial.nativeEvent.durationMs,testLoreMs:trial.testLoreEvent.durationMs});
   }catch(error){row.reasons.push(error.message);assessment.reasons.push(`trial-${trial.change}-${trial.repetition}:`+error.message);if(/incomplete|malformed|ambiguous|size bound|File-load|counts or success mismatch|scope invalid/.test(error.message))completed=false;}
  }
  assessment.observationCompleted=completed;assessment.qualified=assessment.rows.every(row=>row.valid);assessment.speedAdvantageObserved=assessment.qualified&&assessment.rows.every(row=>row.testLoreMs<row.nativeMs);
 }catch(error){assessment.reasons.push(error.message);}
 return assessment;
}

export async function contributedE2EPilot({directory,output,candidateRoot}){
 directory=path.resolve(directory);output=path.resolve(output);candidateRoot=fs.realpathSync(candidateRoot);
 if(fs.existsSync(directory)||fs.existsSync(output))throw Error('Workspace and evidence paths must be new');
 fs.mkdirSync(directory,{recursive:true});fs.mkdirSync(output,{recursive:true});
 const home=path.join(directory,'home'),temporary=path.join(directory,'tmp'),upstream=path.join(directory,'upstream'),tools=path.join(directory,'tools');fs.mkdirSync(home);fs.mkdirSync(temporary);fs.mkdirSync(tools);
 const user=path.join(home,'npmrc'),global=path.join(home,'global-npmrc');fs.writeFileSync(user,'registry=https://registry.npmjs.org/\n',{mode:0o600});fs.writeFileSync(global,'',{mode:0o600});
 const env={PATH:process.env.PATH,HOME:home,TMPDIR:temporary,CI:'1',LANG:'en_US.UTF-8',E2E_TELEMETRY_DISABLED:'1',HUSKY:'0',JITI_FS_CACHE:'false',NPM_CONFIG_USERCONFIG:user,NPM_CONFIG_GLOBALCONFIG:global,NPM_CONFIG_CACHE:path.join(home,'npm-cache')};
 const started=performance.now(),events=[],trials=[];let minimumFreeBytes=Infinity,baseline,assessment,protectedHashes,sourceOriginal={};
 const save=(name,value)=>fs.writeFileSync(path.join(output,name+'.json'),JSON.stringify(value,null,2)+'\n');
 async function invoke(label,cwd,command,timeout=180000){
  if(performance.now()-started>25*60*1000)throw Error('Campaign elapsed budget exhausted');
  const sample=()=>{const free=Math.min(...[directory,output,candidateRoot].map(location=>{const stat=fs.statfsSync(location);return Number(stat.bavail)*Number(stat.bsize);}));minimumFreeBytes=Math.min(minimumFreeBytes,free);return free;};if(sample()<2*1024**3)throw Error('2 GiB reserve unavailable');
  const stdout=fs.openSync(path.join(output,label+'.stdout'),'wx'),stderr=fs.openSync(path.join(output,label+'.stderr'),'wx'),begin=performance.now();let stoppedReason;
  try{
   const result=await new Promise((resolve,reject)=>{const child=spawn(command[0],command.slice(1),{cwd,env,stdio:['ignore',stdout,stderr],detached:true});const kill=reason=>{stoppedReason=reason;try{process.kill(-child.pid,'SIGKILL');}catch{}};const deadline=setTimeout(()=>kill('deadline'),Math.min(timeout,Math.max(1,25*60*1000-(performance.now()-started))));const interval=setInterval(()=>{try{if(sample()<2*1024**3)kill('disk-reserve');for(const fd of [stdout,stderr])if(fs.fstatSync(fd).size>64*1024**2)kill('log-budget');}catch{kill('resource-observation-failed');}},250);child.once('error',reject);child.once('close',(exitCode,signal)=>{clearTimeout(deadline);clearInterval(interval);resolve({exitCode,signal});});});
   const event={label,command,...result,stoppedReason:stoppedReason||null,durationMs:Math.round(performance.now()-begin)};events.push(event);save('execution',{events,minimumFreeBytes,elapsedMs:Math.round(performance.now()-started),credentialsInherited:false});return event;
  }finally{fs.closeSync(stdout);fs.closeSync(stderr);}
 }
 const checked=async(label,cwd,command,timeout)=>{const result=await invoke(label,cwd,command,timeout);if(result.exitCode!==0||result.signal||result.stoppedReason)throw Error(label+' failed');return result;};
 const stdout=label=>fs.readFileSync(path.join(output,label+'.stdout'),'utf8').trim();
 const root=path.join(upstream,'packages/e2e');
 try{
  if(process.version!=='v22.22.3')throw Error('Preregistered Node22.22.3 required');
  await checked('clone-init',directory,['git','init',upstream]);await checked('clone-remote',upstream,['git','remote','add','origin','https://github.com/tester-army/e2e.git']);await checked('clone-fetch',upstream,['git','fetch','--depth=1','origin',E2E_PIN,E2E_PARENT]);await checked('clone-checkout',upstream,['git','-c','core.hooksPath=/dev/null','checkout','--detach',E2E_PIN]);
  if(digest(fs.readFileSync(path.join(upstream,'pnpm-lock.yaml')))!==E2E_LOCK_SHA||JSON.parse(fs.readFileSync(path.join(upstream,'package.json'))).packageManager!=='pnpm@12.3.4')throw Error('Original lock/manager mismatch');
  await checked('tracked-files',upstream,['git','ls-files','-z','--','.']);
  const files=fs.readFileSync(path.join(output,'tracked-files.stdout'),'utf8').split('\0').filter(Boolean);
  protectedHashes=Object.fromEntries(files.filter(file=>!SOURCES.map(source=>'packages/e2e/'+source).includes(file)).map(file=>[file,trackedDigest(upstream,file)]));
  for(const file of SOURCES)sourceOriginal[file]=fs.readFileSync(path.join(root,file));
  await checked('install-pnpm',tools,['npm','install','--prefix',tools,'--ignore-scripts','--no-audit','--no-fund','pnpm@12.3.4'],180000);
  const pnpmIdentity=declaredPnpmExecutable(path.join(tools,'node_modules/pnpm')),pnpm=[pnpmIdentity.executable];
  // Original scripts invoke pnpm recursively by name. Expose the verified
  // pinned executable as a normal installed manager, before any ambient one.
  env.PATH=[path.dirname(pnpmIdentity.executable),path.dirname(process.execPath),env.PATH].join(path.delimiter);
  await checked('pnpm-version',upstream,[...pnpm,'--version']);if(stdout('pnpm-version')!=='12.3.4')throw Error('pnpm version mismatch');
  await checked('original-install',upstream,[...pnpm,'install','--frozen-lockfile'],600000);await checked('original-build',upstream,[...pnpm,'run','build'],600000);
  const vitest=path.join(root,'node_modules/vitest/vitest.mjs'),cli=path.join(candidateRoot,'src/cli.js');
  const candidatePackage=JSON.parse(fs.readFileSync(path.join(candidateRoot,'package.json')));if(candidatePackage.name!=='testlore'||candidatePackage.version!=='0.1.0'||!/^[a-f0-9]{40}$/.test(candidatePackage.gitHead||''))throw Error('Sealed installed TestLore candidate provenance missing');
  if(!fs.existsSync(vitest)||!fs.existsSync(cli))throw Error('Original Vitest or candidate CLI unavailable');
  const config={adapter:'vitest',discovery:'native',runner:[process.execPath,vitest,'run','--config','vitest.config.ts','--project','unit','{files}'],analysisCache:{enabled:true}};
  fs.writeFileSync(path.join(root,'tddswarm.config.json'),JSON.stringify(config));
  await checked('overlay-add',root,['git','-c','core.hooksPath=/dev/null','add','--','tddswarm.config.json']);await checked('overlay-commit',root,['git','-c','core.hooksPath=/dev/null','-c','user.name=TestLore Pilot','-c','user.email=pilot@localhost','commit','-m','Controlled quality configuration overlay']);
  const native=async(label,related,changedSources=SOURCES)=>{const report=path.join(output,label+'.json'),command=[process.execPath,vitest,related?'related':'run','--config','vitest.config.ts','--project','unit',...(related?[...changedSources.map(file=>'./'+file),'--run','--passWithNoTests']:[]),'--reporter=json','--outputFile='+report];const event=await invoke(label,root,command);return {value:boundedJson(report),event};};
  const reference=await native('independent-original-unit-baseline',false);baseline=reference.value;const base=e2eNativeCases(baseline,root);if(reference.event.exitCode!==0||!base.cases.length)throw Error('Original unit baseline rejected');
  await checked('old-globs',root,['git','show',E2E_PARENT+':packages/e2e/'+SOURCES[0]]);await checked('old-regexp',root,['git','show',E2E_PARENT+':packages/e2e/'+SOURCES[1]]);const old=Object.fromEntries(SOURCES.map((file,index)=>[file,fs.readFileSync(path.join(output,(index?'old-regexp':'old-globs')+'.stdout'))]));
  if(!sourceOriginal[SOURCES[0]].toString().includes("new RegExp(`${source}$`, 'u')")||old[SOURCES[0]].toString().includes("new RegExp(`${source}$`, 'u')")||digest(fs.readFileSync(path.join(root,ORACLE)))!=='2580f561b298ce270295ad4991c15f6828cdc29428a697b103eb76946ef5a636')throw Error('Unicode regression preregistration mismatch');
  save('preregistered-manifest',{schemaVersion:1,upstreamRevision:E2E_PIN,parentRevision:E2E_PARENT,node:process.version,pnpm:'12.3.4',pnpmExecutable:pnpmIdentity,lockSha256:E2E_LOCK_SHA,scope:'Original e2e unit project',originalConfigurationSha256:digest(fs.readFileSync(path.join(root,'vitest.config.ts'))),oracleSha256:digest(fs.readFileSync(path.join(root,ORACLE))),protectedHashes,sourceHashes:Object.fromEntries(SOURCES.map(file=>[file,{original:digest(sourceOriginal[file]),historical:digest(old[file])}])),candidateCliSha256:digest(fs.readFileSync(cli)),candidatePackageSha256:digest(fs.readFileSync(path.join(candidateRoot,'package.json'))),candidateSourceRevision:JSON.parse(fs.readFileSync(path.join(candidateRoot,'package.json'))).gitHead||null,repetitions:3,changes:['comment-only','exact-parent-Unicode-glob-reversion'],modelBudget:0,modelCostMeasured:false,providerCredentialsInherited:false});
  for(let change=0;change<2;change++){
   for(const file of SOURCES)fs.writeFileSync(path.join(root,file),change?old[file]:sourceOriginal[file]);if(!change)fs.appendFileSync(path.join(root,SOURCES[0]),'\n// Controlled comment-only change.\n');
   await checked('original-build-change-'+change,upstream,[...pnpm,'run','build'],600000);
   for(let repetition=0;repetition<3;repetition++){
    fs.rmSync(path.join(root,'.tddswarm'),{recursive:true,force:true});const trial={change,repetition};
    const arms=['full','native','testLore'];const order=arms.slice(repetition).concat(arms.slice(0,repetition));trial.order=order;
    for(const arm of order){const label=`change-${change}-trial-${repetition}-${arm}`;if(arm==='testLore'){const event=await invoke(label,root,[process.execPath,cli,'run','--root',root,'--selective','--unified-native','--json']);trial.testLore=boundedJson(path.join(output,label+'.stdout'));trial.testLoreEvent=event;}else{const result=await native(label,arm==='native',change?SOURCES:[SOURCES[0]]);trial[arm]=result.value;trial[arm+'Event']=result.event;}}
    trials.push(trial);save(`trial-${change}-${repetition}`,trial);
   }
  }
  for(const file of SOURCES)fs.writeFileSync(path.join(root,file),sourceOriginal[file]);await checked('original-build-restored',upstream,[...pnpm,'run','build'],600000);const restored=await native('restored-original-unit-baseline',false);const restoredCases=e2eNativeCases(restored.value,root);
  const protectedInputsUnchanged=Object.entries(protectedHashes).every(([file,hash])=>trackedDigest(upstream,file)===hash)&&digest(fs.readFileSync(path.join(upstream,'pnpm-lock.yaml')))===E2E_LOCK_SHA;
  assessment=assessContributedE2E(baseline,trials,root,{protectedInputsUnchanged,restoredGreen:restored.event.exitCode===0&&same(base,restoredCases)});
 }catch(error){assessment={schemaVersion:1,repository:'tester-army/e2e',upstreamRevision:E2E_PIN,qualified:false,observationCompleted:false,reasons:[error.message],trialsCollected:trials.length};}
 finally{for(const [file,bytes]of Object.entries(sourceOriginal))fs.writeFileSync(path.join(root,file),bytes);save('assessment',assessment);save('execution',{events,minimumFreeBytes,elapsedMs:Math.round(performance.now()-started),credentialsInherited:false});}
 return assessment;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const args=process.argv.slice(2),values={};for(let i=0;i<args.length;i+=2){if(!['--directory','--output','--candidate-root'].includes(args[i])||values[args[i]]||!args[i+1]||args[i+1].startsWith('--'))throw Error('Use --directory NEW --output NEW --candidate-root INSTALLED_CANDIDATE');values[args[i]]=args[i+1];}
 if(Object.keys(values).length!==3)throw Error('Three explicit paths are required');const result=await contributedE2EPilot({directory:values['--directory'],output:values['--output'],candidateRoot:values['--candidate-root']});console.log(JSON.stringify(result,null,2));process.exit(result.qualified?0:result.observationCompleted?3:1);
}
