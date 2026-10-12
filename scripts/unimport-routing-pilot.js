#!/usr/bin/env node
/** Explicit hosted, original-suite fixture challenge; importing never executes upstream code. */
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {unimportFactoryObserverConfigSource} from '../src/vitest-case-contracts.js';
import {captureNativeVitestCases} from '../src/native-vitest-cases.js';
import {validateVitestCaseCapture} from '../src/reporters/vitest-cases.js';
import {boundedInstallProcess} from './public-corpus-upstream.js';

export const UNIMPORT_PIN='bbd07768ddb4919205bcb5a3cbc06c3a2791981a';
export const ASSET='playground/composables/comma-separated.ts';
const ORACLE='test/scan-dirs.test.ts';
const DTS_ORACLE='test/dts.test.ts';
const h=value=>createHash('sha256').update(typeof value==='string'||Buffer.isBuffer(value)?value:JSON.stringify(value)).digest('hex');
const eq=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const hashValue=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
function boundedArm(event){
 const resource=event?.finalResources,cleanup=event?.descendantCleanup;
 return Number.isFinite(event?.durationMs)&&event.durationMs>=0&&event.durationMs<=120000&&resource&&Number.isSafeInteger(resource.availableBytes)&&resource.availableBytes>=2*1024**3&&Number.isSafeInteger(resource.growthBytes)&&resource.growthBytes<=128*1024**2&&['stdoutBytes','stderrBytes'].every(key=>Number.isSafeInteger(resource[key])&&resource[key]>=0)&&resource.stdoutBytes+resource.stderrBytes<=4*1024**2&&cleanup&&Number.isSafeInteger(cleanup.observed)&&cleanup.observed>=0&&cleanup.survivingAtClose===0&&cleanup.observationFailed===false&&cleanup.requested===false&&cleanup.scope==='Observed process-tree/start identity best effort; unobserved/reparented children and arbitrary subprocesses are not contained';
}
const save=(file,value)=>fs.writeFileSync(file,JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600});
const git=(root,...args)=>execFileSync('git',['-C',root,...args],{encoding:'utf8',timeout:15000,maxBuffer:8*1024**2}).trim();
const safe=file=>typeof file==='string'&&file.length>0&&!path.isAbsolute(file)&&!/[\\\0]/.test(file)&&file.split('/').every(part=>part&&part!=='.'&&part!=='..');
/** Positive reviewed filesystem edges, not a claim that other consumers are absent. */
export function unimportFilesystemContracts(paths,sourceBindings){
 const consumers=[DTS_ORACLE,ORACLE],scanner='src/node/scan-dirs.ts';
 if(!Array.isArray(paths)||new Set(paths).size!==paths.length||paths.some(file=>!safe(file)||!hashValue(sourceBindings[file]))||[...consumers,scanner].some(file=>!paths.includes(file)))throw Error('Original filesystem source bindings incomplete');
 const domains=[{directory:'playground/composables',consumers},{directory:'playground/composables-override',consumers:[ORACLE]}].map(domain=>({...domain,members:paths.filter(file=>file.startsWith(domain.directory+'/')).sort().map(file=>({file,sha256:sourceBindings[file]}))}));
 if(domains.some(domain=>!domain.members.length)||!domains[0].members.some(member=>member.file===ASSET))throw Error('Reviewed filesystem domain membership incomplete');
 const dependencies=Object.fromEntries(consumers.map(consumer=>[consumer,domains.filter(domain=>domain.consumers.includes(consumer)).flatMap(domain=>domain.members.map(member=>member.file)).sort()]));
 return {schemaVersion:1,upstreamRevision:UNIMPORT_PIN,domains,consumerInputs:[...consumers,scanner].map(file=>({file,sha256:sourceBindings[file]})),dependencies,scope:'Positive fixture scanner edges only. Current membership and original consumer/scanner bytes must remain bound; no cleared uncertainty or completeness claim for other filesystem/runtime consumers.'};
}
/** The pnpm12 archive declares a native package-root launcher, not pnpm.cjs. */
export function selectPnpmManager(records){
 if(!Array.isArray(records)||records.length!==1)throw Error('Pinned package manager ambiguous');
 const record=records[0],manifest=record?.manifest;
 if(typeof record?.cacheEntry!=='string'||!/^[a-f0-9]{1,128}$/.test(record.cacheEntry)||manifest?.name!=='pnpm'||manifest.version!=='12.3.4'||manifest.bin?.pnpm!=='pnpm')throw Error('Pinned package manager manifest/entrypoint differs');
 return {cacheEntry:record.cacheEntry,entrypoint:'pnpm'};
}
// This profile admits only the native JSON forms understood by both captures.
// Todo/disabled/alternate skip spellings are rejected, never silently collapsed.
const statuses=new Map([['passed','passed'],['failed','failed'],['pending','skipped']]);
// Vitest5 JSON deliberately omits unhandledErrors. Observe that actual callback
// separately; do not convert an absent reporter field to an invented zero.
export const NATIVE_ERROR_OBSERVER_SOURCE=`import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const hash=value=>createHash('sha256').update(value).digest('hex');
const error=value=>({name:String(value?.name??'').slice(0,512),message:String(value?.message??'').slice(0,512)});
export default class NativeErrorObserver {
 onTestRunEnd(modules,errors,reason){
  if(!Array.isArray(modules)||modules.length>4096||!Array.isArray(errors)||errors.length>512)throw Error('Native error observer callback unavailable');
  let nodes=0,errorCount=errors.length;
  const captureErrors=value=>{if(!Array.isArray(value??[]))throw Error('Native module errors unavailable');errorCount+=(value??[]).length;if(errorCount>512)throw Error('Native error count exceeds bound');return (value??[]).map(error);};
  const files=modules.map(module=>{const task=module.task,result=task?.result;if(!task||!result)throw Error('Native module result unavailable');const suiteErrors=[];const walk=value=>{if(++nodes>20000)throw Error('Native module work exceeds bound');if(value!==task&&value.type==='suite'){const found=captureErrors(value.result?.errors);if(found.length)suiteErrors.push({name:String(value.name??'').slice(0,512),errors:found});}if(value.tasks!==undefined){if(!Array.isArray(value.tasks)||value.tasks.length>20000)throw Error('Native module children unavailable');for(const child of value.tasks)walk(child);}};walk(task);return {name:task.filepath,state:result.state,errors:captureErrors(result.errors),suiteErrors};});
  const record={schemaVersion:1,observerPath:fileURLToPath(import.meta.url),sourceSha256:hash(fs.readFileSync(fileURLToPath(import.meta.url))),reason,errors:errors.map(error),files};
  const text=JSON.stringify(record);if(Buffer.byteLength(text)>65536)throw Error('Native error observer output exceeds bound');
  fs.writeFileSync(new URL('native-errors.json',import.meta.url),text,{flag:'wx',mode:0o600});
 }
}
`;
export const NATIVE_ERROR_OBSERVER_SHA256=h(NATIVE_ERROR_OBSERVER_SOURCE);

function observedNativeErrors(raw,observation,observerPath){
 if(!path.isAbsolute(observerPath||'')||!observation||observation.schemaVersion!==1||observation.observerPath!==observerPath||observation.sourceSha256!==NATIVE_ERROR_OBSERVER_SHA256||observation.reason!==(raw.success?'passed':'failed')||!Array.isArray(observation.errors)||observation.errors.length||!Array.isArray(observation.files)||observation.files.length!==raw.testResults.length||Buffer.byteLength(JSON.stringify(observation))>65536)throw Error('Native observed runtime errors unavailable');
 const seen=new Set();for(const file of observation.files){const suite=raw.testResults.find(suite=>suite.name===file.name);if(!suite||seen.has(file.name)||file.state!==(suite.status==='passed'?'pass':'fail')||!Array.isArray(file.errors)||file.errors.length||!Array.isArray(file.suiteErrors)||file.suiteErrors.length)throw Error('Native observed module errors/status differ');seen.add(file.name);}
}

/** Strict native names; ambiguous duplicates are refused rather than assigned ordinals. */
export function nativeCases(raw,root,observation,observerPath,caseCapture){
 if(!raw||!Array.isArray(raw.testResults)||(raw.numRuntimeErrorTestSuites!==undefined&&raw.numRuntimeErrorTestSuites!==0)||raw.numTodoTests!==0||raw.numPendingTests!==0)throw Error('Native report runtime/error inventory unavailable');
 observedNativeErrors(raw,observation,observerPath);
 const files=[],cases=[],keys=new Set();
 for(const suite of raw.testResults){
  const file=path.isAbsolute(suite.name||'')?path.relative(root,suite.name):suite.name;
  if(!safe(file)||files.includes(file)||!Array.isArray(suite.assertionResults)||suite.assertionResults.length===0||!['passed','failed'].includes(suite.status)||suite.message!==''||suite.status!==(suite.assertionResults.some(test=>test.status==='failed')?'failed':'passed'))throw Error('Native file inventory invalid');
  files.push(file);
  for(const test of suite.assertionResults){
   if(typeof test.fullName!=='string'||!test.fullName||!statuses.has(test.status))throw Error('Native named case unavailable');
   const id=JSON.stringify([file,test.fullName]);if(keys.has(id)&&!caseCapture)throw Error('Ambiguous native named case');keys.add(id);
   cases.push({id,file,name:test.fullName,status:statuses.get(test.status)});
  }
 }
 for(const [field,status]of [['numPassedTests','passed'],['numFailedTests','failed'],['numPendingTests','skipped']])if(raw[field]!==cases.filter(test=>test.status===status).length)throw Error('Native summary differs from raw outcomes');
 if(raw.numTotalTests!==cases.length||raw.success!==(cases.every(test=>test.status!=='failed')))throw Error('Native total/success differs from raw outcomes');
 return caseCapture?semanticCases(cases,files,caseCapture):{files:files.sort(),cases:cases.sort((a,b)=>a.id.localeCompare(b.id))};
}
function semanticCases(cases,files,capture){
 if(!validateVitestCaseCapture(capture).valid||!eq([...capture.actualFiles].sort(),[...files].sort()))throw Error('Native semantic case capture incomplete');
 const named=value=>JSON.stringify([value.file,value.name??value.rawName,value.status]);
 if(!eq(cases.map(named).sort(),capture.tests.map(named).sort()))throw Error('Native raw/semantic case multiplicities or outcomes differ');
 return {files:[...files].sort(),cases:capture.tests.map(test=>({id:JSON.stringify([test.file,test.semanticId]),file:test.file,name:test.rawName,status:test.status})).sort((a,b)=>a.id.localeCompare(b.id))};
}
export function testLoreCases(raw){
 if(raw?.complete!==true||!Array.isArray(raw.tests)||!Array.isArray(raw.executedFiles)||!Array.isArray(raw.collectionFiles)||!eq([...raw.executedFiles].sort(),[...raw.collectionFiles].sort())||raw.reportErrors?.length||raw.missingFiles?.length||raw.unknownFiles?.length||raw.signal||raw.error)throw Error('TestLore complete execution unavailable');
 const files=[...raw.executedFiles].sort(),cases=[],keys=new Set();
 if(new Set(files).size!==files.length||files.some(file=>!safe(file)))throw Error('TestLore file inventory invalid');
 for(const test of raw.tests){
  if(!files.includes(test.file)||typeof test.name!=='string'||!test.name||test.name==='<file-load>'||!['passed','failed','skipped'].includes(test.status))throw Error('TestLore named case unavailable');
  const id=JSON.stringify([test.file,test.name]);if(keys.has(id)&&!raw.nativeCaseEvidence)throw Error('Ambiguous TestLore named case');keys.add(id);cases.push({id,file:test.file,name:test.name,status:test.status});
 }
 if(files.some(file=>!cases.some(test=>test.file===file)))throw Error('TestLore named file outcomes unavailable');
 return raw.nativeCaseEvidence?semanticCases(cases,files,raw.nativeCaseEvidence):{files,cases:cases.sort((a,b)=>a.id.localeCompare(b.id))};
}
/** Replay raw per-arm reports; aggregate claims cannot substitute for complete cases. */
export function assessUnimportRuns(runs,root,expectedFiles,{requireUnified=false,requiredFailureFiles=[ORACLE]}={}){
 const reasons=[],rows=[];let baseline=null,baselineStatuses=null,expectedFailures=null;
 for(const phase of ['clean','fault','restored'])for(let repeat=0;repeat<2;repeat++){
  const batch=runs.filter(run=>run.phase===phase&&run.repeat===repeat);
  try{
   if(batch.length!==3||!eq(batch.map(run=>run.arm).sort(),['full','native','testlore']))throw Error('Missing/duplicate/unknown arm');
   const normalized=new Map(batch.map(run=>[run.arm,run.arm==='testlore'?testLoreCases(run.raw):nativeCases(run.raw,root,run.nativeErrors,run.nativeObserverPath,run.nativeCaseEvidence)]));
   const full=normalized.get('full');if(!full||!eq(full.files,[...expectedFiles].sort()))throw Error('Original full native scope differs');
   const inventory=full.cases.map(({status,...test})=>test);
   if(!baseline){baseline=inventory;baselineStatuses=full.cases;}else if(!eq(inventory,baseline))throw Error('Full case identity drift');
   const failures=full.cases.filter(test=>test.status==='failed').map(test=>test.id);
   if(phase==='fault'){
    if(!failures.length||requiredFailureFiles.some(file=>!full.cases.some(test=>test.status==='failed'&&test.file===file)))throw Error('Original oracle did not demonstrate every required fixture regression');
    if(expectedFailures&&!eq(failures,expectedFailures))throw Error('Independent regression outcomes unstable');expectedFailures=failures;
    if(full.cases.some(test=>(test.status==='skipped')!==(baselineStatuses.find(original=>original.id===test.id).status==='skipped')))throw Error('Original skipped outcomes drift');
   }else if(failures.length||!full.cases.some(test=>test.status==='passed')||!eq(full.cases,baselineStatuses))throw Error('Original healthy full suite not green/stable');
   const row={phase,repeat,fullFiles:full.files.length,fullFailures:failures.length};
   for(const run of batch){
    const current=normalized.get(run.arm);
    if(!current||current.files.some(file=>!full.files.includes(file))||!eq(current.cases,full.cases.filter(test=>current.files.includes(test.file))))throw Error(run.arm+' named outcomes differ');
    if(!boundedArm(run.event)||run.event.reason||run.event.signal||run.event.exitCode!==(current.cases.some(test=>test.status==='failed')?1:0)||(run.arm==='testlore'&&run.raw.exitCode!==run.event.exitCode)||!hashValue(run.event.stdoutSha256)||!hashValue(run.event.stderrSha256)||!Number.isFinite(run.outerMs)||run.outerMs<0||run.outerMs<run.event.durationMs)throw Error(run.arm+' lifecycle/resource/timing unavailable');
    row[run.arm]={files:current.files.length,outerMs:run.outerMs,missedFailures:failures.filter(id=>!current.cases.some(test=>test.id===id&&test.status==='failed')).length};
    if(run.arm==='testlore'){
     if(requireUnified&&(run.raw.unifiedNative?.used!==true||run.raw.unifiedNative.contexts!==1||run.raw.unifiedNative.partial))throw Error('Requested single fresh unified context unavailable');
     const plan=run.raw.plan;if(!plan||plan.total!==full.files.length||!eq([...plan.selected].sort(),current.files)||!Array.isArray(plan.decisions)||plan.decisions.length!==full.files.length)throw Error('Selected execution/decision inventory differs');
     if(new Set(plan.decisions.map(decision=>decision.test)).size!==full.files.length||plan.decisions.some(decision=>!full.files.includes(decision.test)||decision.selected!==current.files.includes(decision.test)||!Array.isArray(decision.reasons)||!decision.reasons.length))throw Error('Unexplained selected/omitted case');
     row.omitted=full.files.length-current.files.length;row.mode=plan.mode;row.omissionReasons=plan.decisions.filter(decision=>!decision.selected).map(decision=>({test:decision.test,reasons:decision.reasons}));
     if(row[run.arm].missedFailures)throw Error('TestLore omitted demonstrated failure');
    }
   }
   rows.push(row);
  }catch(error){reasons.push({phase,repeat,reason:error.message});}
 }
 if(runs.length!==18)reasons.push({reason:'Expected exactly18 independent arm invocations'});
 const complete=reasons.length===0&&rows.length===6;
 const routingValue=complete&&rows.filter(row=>row.phase==='fault').every(row=>row.omitted>0&&row.testlore.missedFailures===0&&row.native.missedFailures>0&&['test/dedupe.test.ts','test/to-imports.test.ts'].every(file=>row.omissionReasons.some(decision=>decision.test===file)));
 return {kind:'unimport-seeded-fixture-routing-assessment',complete,routingValue,qualified:routingValue,rows,reasons,historicalUpstreamBug:false,speedAdvantageClaim:false,requiredFailureFiles,requireUnified,scope:'Original upstream Vitest runtime suite and required original build in one Node22 environment; lint, typecheck, coverage and other CI environments unqualified.',timingScope:'Each arm from fresh outer CLI startup through raw/capture report writes and postflight revalidation; exact CLI/raw span and revalidation separately retained. Total controller span through assessment/restoration separately retained. Final timing metadata writes excluded; native caches disabled equally, OS caches uncontrolled. Repetitions are fresh processes with uncontrolled OS warmth, not cold/warm cache qualification.'};
}
export function assessUnimportWrongSubset(full,wrong,root){
 const baseline=nativeCases(full.raw,root,full.nativeErrors,full.nativeObserverPath,full.nativeCaseEvidence),subset=nativeCases(wrong.raw,root,wrong.nativeErrors,wrong.nativeObserverPath,wrong.nativeCaseEvidence);
 if([full,wrong].some(run=>!boundedArm(run.event)||run.event.reason||run.event.signal||run.event.exitCode!==1||!hashValue(run.event.stdoutSha256)||!hashValue(run.event.stderrSha256))||!eq(subset.files,[ORACLE])||!eq(subset.cases,baseline.cases.filter(test=>subset.files.includes(test.file))))throw Error('Independent wrong-subset lifecycle/outcomes incomplete');
 const failures=baseline.cases.filter(test=>test.status==='failed'),missed=failures.filter(test=>!subset.cases.some(current=>current.id===test.id&&current.status==='failed'));
 if(!failures.some(test=>test.file===ORACLE)||!failures.some(test=>test.file===DTS_ORACLE)||!missed.some(test=>test.file===DTS_ORACLE)||missed.some(test=>test.file!==DTS_ORACLE))throw Error('Wrong-subset did not independently demonstrate omitted dts failure');
 return {kind:'independent-wrong-subset-control',complete:true,accepted:false,rejection:'Subset omitted independently demonstrated dts failure',executedFiles:subset.files,fullFailures:failures.length,missedFailures:missed.map(test=>({id:test.id,file:test.file,name:test.name})),seededFixtureOnly:true,omissionAuthority:false};
}

function installed(root){
 const rows=[];let bytes=0;const start=performance.now();
 function walk(directory){for(const entry of fs.readdirSync(directory,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){
  if(performance.now()-start>30000||rows.length>=100000)throw Error('Installed inventory work unavailable');
  const file=path.join(directory,entry.name),relative=path.relative(root,file),stat=fs.lstatSync(file);
  if(stat.isSymbolicLink()){
   const target=fs.readlinkSync(file),resolved=path.resolve(path.dirname(file),target);if(resolved!==root&&!resolved.startsWith(root+path.sep))throw Error('Installed workspace link escapes pinned checkout');rows.push([relative,'link',target]);
  }else if(stat.isDirectory())walk(file);
  else if(stat.isFile()){
   bytes+=stat.size;if(bytes>1536*1024**2||stat.size>64*1024**2)throw Error('Installed inventory bytes unavailable');
   const content=fs.readFileSync(file),after=fs.lstatSync(file);if(stat.size!==after.size||stat.ino!==after.ino||stat.mtimeMs!==after.mtimeMs||content.length!==stat.size)throw Error('Installed inventory changed during capture');rows.push([relative,'file',stat.mode&0o777,stat.size,h(content)]);
  }else throw Error('Unsupported installed workspace entry');
 }}
 for(const directory of ['node_modules','playground/node_modules','dist','playground/dist']){const file=path.join(root,directory);if(fs.existsSync(file))walk(file);}
 if(!rows.length||Buffer.byteLength(JSON.stringify(rows))>32*1024**2)throw Error('Installed inventory incomplete');return {sha256:h(rows),bytes,entries:rows};
}
export async function unimportRoutingPilot({upstream,output,sourceSha}){
 upstream=fs.realpathSync(upstream);output=path.resolve(output);const producer=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
 if(!/^[a-f0-9]{40}$/.test(sourceSha)||git(producer,'rev-parse','HEAD')!==sourceSha||git(producer,'status','--porcelain')||git(upstream,'rev-parse','HEAD')!==UNIMPORT_PIN||git(upstream,'status','--porcelain'))throw Error('Require clean exact producer/upstream revisions');
 if(fs.existsSync(output))throw Error('Require new immutable output directory');fs.mkdirSync(output,{recursive:true});
 const started=performance.now(),paths=execFileSync('git',['-C',upstream,'ls-files','-z'],{encoding:'utf8',maxBuffer:8*1024**2}).split('\0').filter(Boolean);
 const deadline=()=>{const remaining=17*60*1000-(performance.now()-started);if(remaining<=0)throw Error('Overall hosted pilot deadline');return remaining;};
 if(paths.length>4096||paths.some(file=>!safe(file)))throw Error('Original source inventory unavailable');
 const sourceBindings=Object.fromEntries(paths.map(file=>[file,h(fs.readFileSync(path.join(upstream,file)))]));
 const expectedFiles=paths.filter(file=>/^test\/.*\.test\.ts$/.test(file)).sort();if(expectedFiles.length!==28)throw Error('Original28-file scope changed');
 const manifest=JSON.parse(fs.readFileSync(path.join(upstream,'package.json'))),original=fs.readFileSync(path.join(upstream,ASSET),'utf8');
 if(manifest.packageManager!=='pnpm@12.3.4'||manifest.engines?.node!=='>=18.12.0'||process.version!=='v22.19.0'||original!=="export const FOO='foo',BAR='bar'\n")throw Error('Pinned source/runtime profile changed');
 const fault=original.replace("BAR='bar'","BAZ='bar'"),inert=original+'// TestLore setup baseline only; original bytes restored before all arms.\n';
 save(path.join(output,'manifest.json'),{sourceSha,upstreamRevision:UNIMPORT_PIN,sourceBindings,expectedFiles,nativeErrorObserver:{sourceSha256:NATIVE_ERROR_OBSERVER_SHA256,scope:'Same additional passive onTestRunEnd observer in every native full/related arm; original JSON reporter/config/assertions retained. Native baseline includes observer overhead.'},seed:{kind:'declared-seeded-asset-regression-not-historical-bug',asset:ASSET,originalSha256:h(original),faultSha256:h(fault),setupBaselineSha256:h(inert)},runtime:{node:process.version,platform:process.platform,arch:process.arch,executableSha256:h(fs.readFileSync(process.execPath))}});
 const isolated=path.join(output,'isolated');fs.mkdirSync(isolated);for(const name of ['home','tmp','cache'])fs.mkdirSync(path.join(isolated,name));
 const env={PATH:path.dirname(process.execPath)+':/usr/local/bin:/usr/bin:/bin',HOME:path.join(isolated,'home'),TMPDIR:path.join(isolated,'tmp'),CI:'true',LANG:'C.UTF-8',npm_config_cache:path.join(isolated,'cache')};
 for(const name of ['npm-user','npm-global'])fs.writeFileSync(path.join(isolated,name),'',{flag:'wx',mode:0o600});
 env.npm_config_userconfig=path.join(isolated,'npm-user');env.npm_config_globalconfig=path.join(isolated,'npm-global');
 const execute=async(name,command,args,cwd,{timeoutMs=120000,maxGrowthBytes=128*1024**2,nativeObserver=false,nativeCaseRequest=null}={})=>{
  const remaining=deadline(),directory=path.join(output,name);fs.mkdirSync(directory);const begin=performance.now();
  if(nativeObserver)fs.writeFileSync(path.join(directory,'native-error-observer.mjs'),NATIVE_ERROR_OBSERVER_SOURCE,{flag:'wx',mode:0o600});
  let armEnv=env;if(nativeCaseRequest){const requestFile=path.join(directory,'case-request.json');save(requestFile,{...nativeCaseRequest,reportFile:path.join(directory,'cases.json')});armEnv={...env,TESTLORE_VITEST_CASE_REQUEST:requestFile};}
  const event=await boundedInstallProcess(command,args,{cwd,directory,env:armEnv,timeoutMs:Math.max(1,Math.min(timeoutMs,Math.floor(remaining))),maxGrowthBytes,reserveBytes:2*1024**3,maxLogBytes:4*1024**2,terminateDescendants:true});save(path.join(directory,'process.json'),{command,args,event});deadline();return {directory,event,begin};
 };
 const npm=path.resolve(path.dirname(process.execPath),'../lib/node_modules/npm/bin/npm-cli.js');
 const bootstrap=await execute('manager-bootstrap',process.execPath,[npm,'exec','--yes','--package=pnpm@12.3.4','--','pnpm','--version'],producer,{timeoutMs:120000,maxGrowthBytes:128*1024**2});
 if(bootstrap.event.exitCode!==0||bootstrap.event.reason||fs.readFileSync(path.join(bootstrap.directory,'stdout.log'),'utf8').trim()!=='12.3.4')throw Error('Original package-manager bootstrap unavailable');
 const managerCache=path.join(isolated,'cache/_npx'),cacheEntries=fs.readdirSync(managerCache);if(cacheEntries.length>64)throw Error('Pinned package manager inventory exceeds bound');
 const records=cacheEntries.map(cacheEntry=>{const metadata=path.join(managerCache,cacheEntry,'node_modules/pnpm/package.json'),stat=fs.lstatSync(metadata);if(!stat.isFile()||stat.size>65536)throw Error('Pinned package manager manifest exceeds bound');return {cacheEntry,manifest:JSON.parse(fs.readFileSync(metadata,'utf8'))};});
 const selected=selectPnpmManager(records),managerRoot=fs.realpathSync(path.join(managerCache,selected.cacheEntry,'node_modules/pnpm')),manager=path.join(managerRoot,selected.entrypoint),managerStat=fs.lstatSync(manager);
 if(!managerRoot.startsWith(fs.realpathSync(managerCache)+path.sep)||!managerStat.isFile()||!(managerStat.mode&0o111)||managerStat.size<1||managerStat.size>128*1024**2)throw Error('Pinned package manager launcher unavailable');
 save(path.join(output,'manager-binding.json'),{name:'pnpm',version:'12.3.4',declaredBin:selected.entrypoint,manifestSha256:h(fs.readFileSync(path.join(managerRoot,'package.json'))),launcherBytes:managerStat.size,launcherSha256:h(fs.readFileSync(manager)),invocation:'Direct installed declared executable; no assumed Node interpreter.'});
 const managerIdentity=await execute('manager-identity',manager,['--version'],producer);if(managerIdentity.event.exitCode!==0||managerIdentity.event.reason||fs.readFileSync(path.join(managerIdentity.directory,'stdout.log'),'utf8').trim()!=='12.3.4')throw Error('Declared package manager executable version differs');
 const installation=await execute('original-install',manager,['install','--frozen-lockfile','--package-import-method=copy'],upstream,{timeoutMs:240000,maxGrowthBytes:1536*1024**2});
 if(installation.event.exitCode!==0||installation.event.reason)throw Error('Original full workspace installation unavailable');
 const build=await execute('original-build',manager,['run','build'],upstream,{timeoutMs:120000,maxGrowthBytes:256*1024**2});
 if(build.event.exitCode!==0||build.event.reason)throw Error('Original upstream build unavailable');
 const cli=path.join(upstream,'node_modules/vitest/vitest.mjs');if(JSON.parse(fs.readFileSync(path.join(upstream,'node_modules/vitest/package.json'))).version!=='5.0.0')throw Error('Original frozen Vitest version differs');
 const dependencyInventory=installed(upstream);save(path.join(output,'installed-inventory.json'),dependencyInventory);
 const observerConfig='testlore.observation.config.mjs',observerSource=unimportFactoryObserverConfigSource(upstream);
 const filesystemContracts=unimportFilesystemContracts(paths,sourceBindings);
 const config={adapter:'vitest',discovery:'native',executionMode:'selective',runner:[process.execPath,cli,'run','--config',observerConfig,'--cache=false','--passWithNoTests','{files}'],vitestCases:{profile:'unimport-detect-factory-runtime-v1',projectRoot:'.',upstreamRevision:UNIMPORT_PIN},runnerTimeoutMs:120000,dependencies:filesystemContracts.dependencies};
 const sourceCheck=phase=>{for(const file of paths){const current=h(fs.readFileSync(path.join(upstream,file))),expected=file===ASSET?h(phase==='fault'?fault:original):sourceBindings[file];if(current!==expected)throw Error('Original source/lock/assertion bytes changed: '+file);}if(h(fs.readFileSync(path.join(upstream,observerConfig)))!==h(observerSource))throw Error('Native observer overlay changed');if(h(fs.readFileSync(path.join(upstream,'tddswarm.config.json')))!==h(JSON.stringify(config)))throw Error('Pilot configuration changed');};
 const runs=[];let base=null,wrongSubsetControl=null;
 try{
 fs.writeFileSync(path.join(upstream,observerConfig),observerSource,{flag:'wx',mode:0o600});fs.writeFileSync(path.join(upstream,'tddswarm.config.json'),JSON.stringify(config),{flag:'wx',mode:0o600});fs.writeFileSync(path.join(upstream,ASSET),inert);
 git(upstream,'add','--','tddswarm.config.json',observerConfig,ASSET);git(upstream,'-c','user.name=TestLore bounded pilot','-c','user.email=testlore-pilot@users.noreply.github.com','commit','-m','Isolated original-suite pilot setup (not upstream publication)');
 base=git(upstream,'rev-parse','HEAD');const nativeProfile=captureNativeVitestCases(upstream,config,config.runner);save(path.join(output,'native-case-profile.json'),nativeProfile);save(path.join(output,'setup.json'),{base,configuration:config,configurationSha256:h(fs.readFileSync(path.join(upstream,'tddswarm.config.json'))),inertAssetSha256:h(inert),upstreamRevision:UNIMPORT_PIN,filesystemContracts,primaryTestLorePath:'single fresh unified native context, required by assessment'});
  for(const phase of ['clean','fault','restored']){
   fs.writeFileSync(path.join(upstream,ASSET),phase==='fault'?fault:original);
   for(let repeat=0;repeat<2;repeat++)for(const arm of repeat===0?['full','testlore','native']:['native','full','testlore']){
    const preflight=performance.now();sourceCheck(phase);if(installed(upstream).sha256!==dependencyInventory.sha256)throw Error('Installed dependency bytes/links changed');
    const preflightMs=performance.now()-preflight,name=`${phase}-${repeat}-${arm}`,rawPath=path.join(output,name,'native.json');
    const args=arm==='testlore'?[path.join(producer,'src/cli.js'),'run','--root',upstream,'--base',base,'--selective','--unified-native','--json']:[cli,...(arm==='native'?['related',ASSET]:['run']),'--config',observerConfig,'--includeTaskLocation','--cache=false','--reporter=json','--reporter',path.join(producer,'src/reporters/vitest-cases.js'),'--reporter',path.join(output,name,'native-error-observer.mjs'),'--outputFile',rawPath,'--passWithNoTests'];
    const executed=await execute(name,process.execPath,args,upstream,{nativeObserver:arm!=='testlore',nativeCaseRequest:arm==='testlore'?null:{schemaVersion:1,root:upstream,expectedFiles:nativeProfile.expectedFiles,inputs:nativeProfile.inputs,vitestVersion:nativeProfile.vitestVersion,registrationContracts:nativeProfile.registrationContracts,scope:arm==='native'?'native-related':'full'}}),{event,directory,begin}=executed;
    if(event.reason||event.signal||![0,1].includes(event.exitCode))throw Error('Fresh arm execution incomplete: '+name);
    const text=fs.readFileSync(arm==='testlore'?path.join(directory,'stdout.log'):rawPath,'utf8');if(Buffer.byteLength(text)>4*1024**2)throw Error('Raw report exceeds bound');
    const raw=JSON.parse(text);save(path.join(directory,'raw.json'),raw);let nativeErrors=null;if(arm!=='testlore'){const file=path.join(directory,'native-errors.json');if(fs.statSync(file).size>65536||h(fs.readFileSync(path.join(directory,'native-error-observer.mjs')))!==NATIVE_ERROR_OBSERVER_SHA256)throw Error('Native observer bytes/output differ');nativeErrors=JSON.parse(fs.readFileSync(file,'utf8'));}const nativeCaseEvidence=arm==='testlore'?null:JSON.parse(fs.readFileSync(path.join(directory,'cases.json'),'utf8'));const cliAndRawReportMs=performance.now()-begin;
    const validationStart=performance.now();sourceCheck(phase);if(installed(upstream).sha256!==dependencyInventory.sha256)throw Error('Installed dependency bytes/links changed after arm');
    const record={phase,repeat,arm,event,cliAndRawReportMs,preflightMs,postflightMs:performance.now()-validationStart,raw,...(nativeErrors?{nativeErrors,nativeObserverPath:path.join(directory,'native-error-observer.mjs'),nativeCaseEvidence}:{})};save(path.join(directory,'capture.json'),record);
    record.outerMs=performance.now()-begin;save(path.join(directory,'timing.json'),{outerMs:record.outerMs,cliAndRawReportMs,preflightMs,postflightMs:record.postflightMs,scope:'Through capture.json and raw.json writes; this final timing metadata write excluded.'});runs.push(record);deadline();
    if(phase==='fault'&&repeat===0&&arm==='full'){
     const wrongName='fault-wrong-subset',wrongPath=path.join(output,wrongName,'native.json'),wrongArgs=[cli,'run',ORACLE,'--config',observerConfig,'--includeTaskLocation','--cache=false','--reporter=json','--reporter',path.join(producer,'src/reporters/vitest-cases.js'),'--reporter',path.join(output,wrongName,'native-error-observer.mjs'),'--outputFile',wrongPath,'--passWithNoTests'];
     sourceCheck(phase);const executedWrong=await execute(wrongName,process.execPath,wrongArgs,upstream,{nativeObserver:true,nativeCaseRequest:{schemaVersion:1,root:upstream,expectedFiles:nativeProfile.expectedFiles,inputs:nativeProfile.inputs,vitestVersion:nativeProfile.vitestVersion,registrationContracts:nativeProfile.registrationContracts,scope:'deferred',executionFiles:[ORACLE]}});
     const wrong={raw:JSON.parse(fs.readFileSync(wrongPath,'utf8')),event:executedWrong.event,nativeErrors:JSON.parse(fs.readFileSync(path.join(executedWrong.directory,'native-errors.json'),'utf8')),nativeObserverPath:path.join(executedWrong.directory,'native-error-observer.mjs'),nativeCaseEvidence:JSON.parse(fs.readFileSync(path.join(executedWrong.directory,'cases.json'),'utf8'))};
     sourceCheck(phase);if(installed(upstream).sha256!==dependencyInventory.sha256)throw Error('Installed inputs changed during wrong-subset challenge');save(path.join(executedWrong.directory,'capture.json'),wrong);wrongSubsetControl=assessUnimportWrongSubset(record,wrong,upstream);save(path.join(output,'wrong-subset-assessment.json'),wrongSubsetControl);
    }
   }
  }
  deadline();const assessment=assessUnimportRuns(runs,upstream,expectedFiles,{requireUnified:true,requiredFailureFiles:[DTS_ORACLE,ORACLE]});assessment.wrongSubsetControl=wrongSubsetControl;if(!wrongSubsetControl?.complete){assessment.complete=false;assessment.qualified=false;assessment.routingValue=false;assessment.reasons.push({reason:'Independent wrong-subset rejection control unavailable'});}save(path.join(output,'assessment.json'),assessment);deadline();return assessment;
 }finally{fs.writeFileSync(path.join(upstream,ASSET),original);sourceCheck('restored');save(path.join(output,'restoration.json'),{originalFixtureSha256:h(original),allProtectedOriginalSourcesRestored:true,setupCommit:base,upstreamRevision:UNIMPORT_PIN,partialArmCount:runs.length});save(path.join(output,'pipeline-timing.json'),{controllerThroughAssessmentAndRestorationMs:performance.now()-started,scope:'Includes source capture, install/build, setup, all arm invocations, revalidation, retained raw/capture/assessment and restoration writes. Final timing metadata write excluded.'});deadline();}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const args=process.argv.slice(2),outputPreexisted=args.length===6&&args[2]==='--output'&&fs.existsSync(path.resolve(args[3]));try{if(args.length!==6||args[0]!=='--upstream'||args[2]!=='--output'||args[4]!=='--source-sha')throw Error('Use --upstream PINNED --output NEW --source-sha REVIEWED');const result=await unimportRoutingPilot({upstream:args[1],output:args[3],sourceSha:args[5]});console.log(JSON.stringify(result));process.exitCode=result.qualified?0:2;}catch(error){if(!outputPreexisted&&args.length===6&&args[2]==='--output'&&fs.existsSync(path.resolve(args[3])))save(path.join(path.resolve(args[3]),'rejection.json'),{status:'rejected',qualified:false,reason:String(error.message).slice(0,1024),noRoutingOrSpeedClaim:true});console.error(error.message);process.exitCode=1;}
}
