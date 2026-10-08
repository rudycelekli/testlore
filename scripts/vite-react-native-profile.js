#!/usr/bin/env node
// Opt-in reproduction of original native baselines; no TestLore routing authority.
import fs from 'node:fs';
import path from 'node:path';
import {spawn,spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const manifestFile=fileURLToPath(new URL('../benchmarks/framework-profiles/vite-react-4.7.0-resume.json',import.meta.url));
const manifestHash='0d2a5ffe015175a55bb99e0d520cc1cbbc684a72db228ff1aa85cee12b5dcc08';
const sha=value=>createHash('sha256').update(value).digest('hex');
export function profileManifest(){
  const stat=fs.lstatSync(manifestFile);if(!stat.isFile()||stat.size>256*1024)throw Error('Bounded original profile manifest required');
  const text=fs.readFileSync(manifestFile);if(sha(text)!==manifestHash)throw Error('Pinned original profile manifest changed');
  return JSON.parse(text);
}
export function parseProfileArguments(argv){
  const options={run:false,authorizeSystemDeps:false};const seen=new Set();
  for(let index=0;index<argv.length;index++){
    const flag=argv[index];if(seen.has(flag))throw Error('Duplicate profile option');seen.add(flag);
    if(flag==='--run')options.run=true;
    else if(flag==='--authorize-system-deps')options.authorizeSystemDeps=true;
    else if(flag==='--output'||flag==='--project'){
      const value=argv[++index];if(!value||value.startsWith('--')||!path.isAbsolute(value))throw Error('Absolute fresh profile path required');
      options[flag.slice(2)]=path.resolve(value);
    }else throw Error('Unknown profile option');
  }
  if(options.run&&!options.output)throw Error('--run requires a fresh --output directory');
  if(options.authorizeSystemDeps&&!options.run)throw Error('System dependency opt-in requires --run');
  if(options.project&&(!options.output||options.project!==path.join(options.output,'upstream')))throw Error('Project must be the fresh output/upstream child');
  return options;
}
export function profileEnvironment(output,input=process.env){
  const privateRoot=path.join(output,'private'),env={};
  for(const key of ['LANG','LC_ALL','SSL_CERT_FILE','SSL_CERT_DIR'])if(typeof input[key]==='string')env[key]=input[key];
  Object.assign(env,{PATH:path.dirname(process.execPath)+':/usr/local/bin:/usr/bin:/bin',HOME:path.join(privateRoot,'home'),USER:'testlore-fixture',LOGNAME:'testlore-fixture',
    TMPDIR:path.join(privateRoot,'tmp')+'/',XDG_CACHE_HOME:path.join(privateRoot,'cache'),XDG_DATA_HOME:path.join(privateRoot,'data'),XDG_STATE_HOME:path.join(privateRoot,'state'),
    NPM_CONFIG_USERCONFIG:path.join(privateRoot,'npm-user-config'),NPM_CONFIG_GLOBALCONFIG:path.join(privateRoot,'npm-global-config'),NPM_CONFIG_CACHE:path.join(privateRoot,'npm-cache'),PLAYWRIGHT_BROWSERS_PATH:path.join(privateRoot,'browser'),
    GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_SYSTEM:'/dev/null',GIT_TERMINAL_PROMPT:'0',CI:'1'});
  return env;
}
export function headlessShellExecutable(browserRoot,build,platform=process.platform){
  if(!['linux','darwin'].includes(platform)||!/^\d+$/.test(String(build)))throw Error('Pinned supported headless shell platform/build required');
  return path.join(browserRoot,'chromium_headless_shell-'+build,platform==='darwin'?'chrome-mac':'chrome-linux','headless_shell');
}
export function resourceDecision(manifest,availableBytes,allocatedBytes){
  if(!Number.isFinite(availableBytes)||!Number.isFinite(allocatedBytes)||availableBytes<0||allocatedBytes<0)return 'resource-measurement-incomplete';
  if(availableBytes<manifest.resources.stopFreeBytes)return 'free-space-reserve-stop';
  if(allocatedBytes>manifest.resources.maximumWorkspaceBytes)return 'workspace-allocation-stop';
  return null;
}
function nativeCases(value,project){
  if(!value||!Array.isArray(value.testResults))throw Error('Original native report is incomplete');
  const rows=[],files=[];
  for(const suite of value.testResults){
    if(typeof suite.name!=='string'||!Array.isArray(suite.assertionResults)||!suite.assertionResults.length)throw Error('Original native file inventory is incomplete');
    const file=path.relative(project,path.resolve(suite.name)).split(path.sep).join('/');
    if(file.startsWith('../')||path.isAbsolute(file))throw Error('Native case outside the public project');files.push(file);
    for(const item of suite.assertionResults){
      if(typeof item.fullName!=='string'||!item.fullName||!['passed','failed','pending','skipped','todo'].includes(item.status))throw Error('Original native case is incomplete');
      rows.push({file,name:item.fullName,status:item.status});
    }
  }
  if(new Set(files).size!==files.length||new Set(rows.map(row=>row.file+'\0'+row.name)).size!==rows.length)throw Error('Ambiguous original native inventory');
  return {rows,files:files.sort()};
}
export function assessOriginalNative(value,project,mode,manifest=profileManifest()){
  let observed={};
  try{
    const {rows,files}=nativeCases(value,project),passed=rows.filter(row=>row.status==='passed').length,failed=rows.filter(row=>row.status==='failed').length,pending=rows.length-passed-failed;
    observed={files,cases:rows,counts:{passed,failed,pending},pendingCases:rows.filter(row=>row.status!=='passed'&&row.status!=='failed')};
    if(passed===0)throw Error('Original native run executed no passing assertions');
    if(value.success!==true||value.numTotalTests!==rows.length||value.numPassedTests!==passed||value.numFailedTests!==failed||value.numPendingTests!==pending||failed!==0||value.numRuntimeErrorTestSuites>0)throw Error('Original native terminal outcome mismatch');
    const expected=mode==='unit'?manifest.unitCases:mode==='serve'?manifest.serveCases:null;
    const expectedFiles=mode==='unit'?[...new Set(manifest.unitCases.map(row=>row.file))].sort():manifest.buildScope.files;
    if(!['unit','serve','build'].includes(mode)||JSON.stringify(files)!==JSON.stringify(expectedFiles))throw Error('Original native file scope mismatch');
    const tuples=list=>JSON.stringify(list.map(({file,name,status})=>[file,name,status]).sort());
    if(expected&&tuples(rows)!==tuples(expected))throw Error('Original native case/pending inventory changed');
    return {complete:true,mode,files,cases:rows,counts:{passed,failed,pending},pendingCases:rows.filter(row=>row.status!=='passed'&&row.status!=='failed'),limitation:mode==='build'?'Conditional build inventory comes from this fresh original native run; no serve-case inventory reuse.':'Only this original native baseline scope is established.'};
  }catch(error){return {complete:false,mode,...observed,reasons:[error.message]};}
}
function atomicJson(filename,value){
  const temporary=filename+'.writing';if(fs.existsSync(temporary))throw Error('Stale receipt write found');
  const descriptor=fs.openSync(temporary,'wx',0o600);try{fs.writeFileSync(descriptor,JSON.stringify(value,null,2)+'\n');fs.fsyncSync(descriptor);}finally{fs.closeSync(descriptor);}
  fs.renameSync(temporary,filename);
}
function measure(output,manifest){
  let du;const attempts=[];
  for(let attempt=0;attempt<3;attempt++){
    du=spawnSync('du',['-sk',output],{encoding:'utf8',timeout:3000,env:{PATH:'/usr/bin:/bin'}});
    attempts.push({status:du.status,error:du.error?.code||null,stderr:(du.stderr||'').slice(0,2048)});
    if(du.status===0||!du.stderr?.split('\n').filter(Boolean).every(line=>line.endsWith('No such file or directory')))break;
  }
  const stat=fs.statfsSync(output),allocatedBytes=Number(du.stdout?.trim().split(/\s+/)[0])*1024,availableBytes=stat.bavail*stat.bsize;
  return {availableBytes,allocatedBytes,allocationObservations:attempts,reason:du.status===0?resourceDecision(manifest,availableBytes,allocatedBytes):'resource-measurement-incomplete'};
}
function bytesIdentity(file){const real=fs.realpathSync(file),stat=fs.statSync(real);if(!stat.isFile())throw Error('Runtime identity must be a regular file');return {file:real,bytes:stat.size,sha256:sha(fs.readFileSync(real))};}
function originalSnapshot(project,env){
  const git=spawnSync('git',['ls-files','-z'],{cwd:project,env,encoding:'utf8',timeout:10000});if(git.status!==0)throw Error('Original tracked inventory unavailable');
  const files=git.stdout.split('\0').filter(Boolean);if(files.length>2000)throw Error('Original tracked inventory exceeded');
  return Object.fromEntries(files.sort().map(file=>{const target=path.join(project,file),stat=fs.lstatSync(target);if(stat.isSymbolicLink())return [file,{symlink:fs.readlinkSync(target)}];if(!stat.isFile()||stat.size>4*1024*1024)throw Error('Original source entry exceeded');return [file,sha(fs.readFileSync(target))];}));
}
function checkBindings(project,manifest){
  for(const [file,expected]of Object.entries({...manifest.sourceBindings,...manifest.assertionBindings}))if(sha(fs.readFileSync(path.join(project,file)))!==expected)throw Error('Pinned original source binding changed: '+file);
}
export async function phase(context,name,command,timeoutMs=context.manifest.resources.phaseTimeoutMs,extraEnv={}){
  const {output,manifest}=context,record={name,command,requestedAt:Date.now(),status:'not-started',samples:[]};
  const persist=()=>{atomicJson(path.join(output,name+'.phase.json'),record);context.report.phases.push(record);atomicJson(path.join(output,'report.json'),context.report);};
  const sample=()=>{const value=measure(context.resourceRoot||output,manifest);record.samples.push({...value,at:Date.now()});for(const mode of ['unit','serve','build']){const file=path.join(output,mode+'.native.json');if(fs.existsSync(file)&&fs.statSync(file).size>manifest.resources.maximumNativeReportBytes)value.reason ||= 'native-report-output-limit';}return value.reason;};
  const startReason=sample();if(startReason){record.reason=startReason;persist();throw Error(startReason);}
  const stdoutFile=path.join(output,name+'.stdout'),stderrFile=path.join(output,name+'.stderr');
  const out=fs.openSync(stdoutFile,'wx',0o600),err=fs.openSync(stderrFile,'wx',0o600),start=performance.now();
  const child=spawn(command[0],command.slice(1),{cwd:context.project||output,env:{...context.env,...extraEnv},detached:true,stdio:['ignore',out,err]});fs.closeSync(out);fs.closeSync(err);
  let reason=null,observationFailed=false;const descendants=new Map();
  const processRows=()=>{const result=spawnSync('ps',['-axo','pid=,ppid=,lstart=,stat='],{encoding:'utf8',timeout:1000,maxBuffer:2*1024*1024,env:context.env});if(result.status!==0)throw Error('Process observation unavailable');return result.stdout.trim().split('\n').map(line=>{const fields=line.trim().split(/\s+/);if(fields.length<8)throw Error('Process observation incomplete');return {pid:Number(fields[0]),parent:Number(fields[1]),start:fields.slice(2,7).join(' '),state:fields[7]};});};
  const observeDescendants=()=>{try{const rows=processRows(),live=new Set([child.pid]);let added=true;while(added){added=false;for(const row of rows)if(live.has(row.parent)&&!live.has(row.pid)){live.add(row.pid);descendants.set(row.pid,row.start);added=true;}}}catch{observationFailed=true;}};
  const surviving=()=>{try{return processRows().filter(row=>descendants.get(row.pid)===row.start&&!row.state.includes('Z'));}catch{observationFailed=true;return [];}};
  const stop=value=>{reason ||= value;observeDescendants();for(const row of surviving().reverse()){try{process.kill(-row.pid,'SIGKILL');}catch{}try{process.kill(row.pid,'SIGKILL');}catch{}}try{process.kill(-child.pid,'SIGTERM');}catch{}setTimeout(()=>{try{process.kill(-child.pid,'SIGKILL');}catch{}},250).unref();};
  const check=()=>{const resourceReason=sample(),bytes=fs.statSync(stdoutFile).size+fs.statSync(stderrFile).size;return performance.now()-start>timeoutMs?'phase-deadline':resourceReason|| (bytes>manifest.resources.maximumPhaseOutputBytes?'phase-output-limit':null);};
  const interval=setInterval(()=>{try{observeDescendants();const state=check();if(state)stop(state);}catch(error){stop('resource-check:'+error.message);}},Math.min(100,manifest.resources.resourcePollMs));
  const signals=['SIGTERM','SIGINT'],onSignal=()=>stop('controller-cancelled');for(const signal of signals)process.once(signal,onSignal);
  let exitCode=null,signal=null,spawnError=null;
  await new Promise(resolve=>{child.once('error',error=>{spawnError=error.code||error.message;resolve();});child.once('close',(code,value)=>{exitCode=code;signal=value;resolve();});});
  clearInterval(interval);for(const value of signals)process.removeListener(value,onSignal);
  const survivingAtClose=surviving().length;if(survivingAtClose)stop('surviving-descendants');if(observationFailed)stop('descendant-observation-failed');
  record.descendantCleanup={scope:'Observed PID/start process tree best effort; unobserved/reparented children are not contained',observed:descendants.size,survivingAtClose,observationFailed,requested:!!reason};
  record.closedAt=Date.now();record.elapsedMs=performance.now()-start;record.exitCode=exitCode;record.signal=signal;record.outputBytes=fs.statSync(stdoutFile).size+fs.statSync(stderrFile).size;
  try{const closeReason=check();if(closeReason)reason ||= closeReason;}catch(error){reason ||= 'resource-close:'+error.message;}
  if(context.original){try{if(JSON.stringify(originalSnapshot(context.project,context.env))!==JSON.stringify(context.original))reason ||= 'original-tracked-source-changed';}catch(error){reason ||= 'original-snapshot:'+error.message;}}
  record.elapsedMs=performance.now()-start;record.closedAt=Date.now();if(record.elapsedMs>timeoutMs)reason ||= 'phase-deadline';
  record.reason=reason||spawnError;record.status=!record.reason&&exitCode===0?'passed':'failed';persist();
  if(record.status!=='passed')throw Error('Native phase rejected: '+name+': '+(record.reason||exitCode));
  return record;
}
async function bootstrap(context){
  const {manifest,output}=context,start=measure(output,manifest);if(start.reason)throw Error(start.reason);
  const record={phase:'pinned-pnpm-download',requestedAt:Date.now(),samples:[start]},abort=new AbortController();let reason;
  const poll=setInterval(()=>{try{const sample=measure(output,manifest);record.samples.push(sample);if(sample.reason){reason=sample.reason;abort.abort();}}catch(error){reason=error.message;abort.abort();}},manifest.resources.resourcePollMs);
  const timer=setTimeout(()=>{reason='pnpm-download-deadline';abort.abort();},30000);
  try{
    const response=await fetch(manifest.pnpm.source,{signal:abort.signal,redirect:'error'});if(!response.ok)throw Error('Pinned pnpm archive HTTP status '+response.status);
    const chunks=[];let size=0;for await(const chunk of response.body){size+=chunk.length;if(size>manifest.pnpm.archiveBytes)throw Error('Pinned pnpm archive exceeded');chunks.push(chunk);}
    const bytes=Buffer.concat(chunks),[algorithm,expected]=manifest.pnpm.integrity.split('-');
    if(bytes.length!==manifest.pnpm.archiveBytes||sha(bytes)!==manifest.pnpm.archiveSha256||createHash(algorithm).update(bytes).digest('base64')!==expected)throw Error('Pinned pnpm archive integrity rejected');
    const close=measure(output,manifest);record.samples.push(close);if(close.reason)throw Error(close.reason);
    fs.writeFileSync(path.join(output,'pnpm.tgz'),bytes,{flag:'wx',mode:0o600});const written=measure(output,manifest);record.samples.push(written);if(written.reason)throw Error(written.reason);record.complete=true;record.sha256=sha(bytes);
  }catch(error){record.complete=false;record.reason=reason||error.message;throw error;}finally{clearInterval(poll);clearTimeout(timer);atomicJson(path.join(output,'pnpm-download.json'),record);}
}
export function profilePlan(options={},manifest=profileManifest()){
  return {profile:manifest.profile,mode:options.run?'explicit-native-baseline-replay':'plan-only',revision:manifest.revision,nodeVersion:manifest.nodeVersion,scope:manifest.scope,
    project:options.project||'<fresh output>/upstream',browserPath:'<fresh output>/private/browser',fullFrozenInstallation:true,originalAssertionsUnchanged:true,routingAuthority:'none',
    phases:['public pinned checkout','verified original source bindings','pinned pnpm bootstrap','full frozen original install','private pinned Chromium install','original recursive build','original unit baseline','original whole-playground serve baseline','original whole-playground build baseline'],
    resources:manifest.resources,pendingServeCases:manifest.pendingServeCases,notQualified:manifest.notQualified,resumePolicy:manifest.resumePolicy};
}
export async function runProfile(options){
  const manifest=profileManifest();if(!options.run)return profilePlan(options,manifest);
  if(process.versions.node!==manifest.nodeVersion)throw Error('Pinned Node '+manifest.nodeVersion+' required');
  if(!['linux','darwin'].includes(process.platform))throw Error('Only Linux/macOS profile controller supported');
  if(options.authorizeSystemDeps&&process.platform!=='linux')throw Error('System dependency opt-in is Linux-only');
  const output=path.resolve(options.output);if(fs.existsSync(output))throw Error('Fresh nonexisting output required');
  const parent=fs.realpathSync(path.dirname(output));if(path.join(parent,path.basename(output))!==output)throw Error('Output parent cannot be a symlink');
  const stat=fs.statfsSync(parent);if(stat.bavail*stat.bsize<manifest.resources.stopFreeBytes)throw Error('Free-space reserve unavailable before output creation');
  fs.mkdirSync(output,{mode:0o700});for(const name of ['home','tmp','cache','data','state','npm-cache','browser','store'])fs.mkdirSync(path.join(output,'private',name),{recursive:true,mode:0o700});
  for(const name of ['npm-user-config','npm-global-config'])fs.writeFileSync(path.join(output,'private',name),'',{flag:'wx',mode:0o600});
  fs.mkdirSync(path.join(output,'runtime'));const project=path.join(output,'upstream');fs.mkdirSync(project);
  const report={schemaVersion:1,kind:'original-native-profile-replay',profile:manifest.profile,manifestSha256:manifestHash,repository:manifest.repository,revision:manifest.revision,completeNativeBaselines:false,completeApplicationProfile:false,routingAuthority:'none',phases:[],nativeSuites:[],notQualified:manifest.notQualified,node:bytesIdentity(process.execPath),controller:bytesIdentity(fileURLToPath(import.meta.url))};
  const context={output,project,env:profileEnvironment(output),manifest,report};
  atomicJson(path.join(output,'report.json'),report);
  try{
    await phase(context,'git-init',['git','init','-b','main']);await phase(context,'git-fetch',['git','fetch','--depth=1',manifest.repository,manifest.revision]);await phase(context,'git-checkout',['git','checkout','--detach','FETCH_HEAD']);
    const revision=spawnSync('git',['rev-parse','HEAD'],{cwd:project,env:context.env,encoding:'utf8',timeout:10000});if(revision.status!==0||revision.stdout.trim()!==manifest.revision)throw Error('Original public revision mismatch');
    checkBindings(project,manifest);context.original=originalSnapshot(project,context.env);atomicJson(path.join(output,'original-source.json'),{revision:manifest.revision,files:context.original});
    await bootstrap(context);await phase(context,'pnpm-extract',['tar','-xzf',path.join(output,'pnpm.tgz'),'-C',path.join(output,'runtime')]);
    const pnpm=path.join(output,'runtime/package/bin/pnpm.cjs'),node=process.execPath;report.pnpm=bytesIdentity(pnpm);
    await phase(context,'pnpm-version',[node,pnpm,'--version']);if(fs.readFileSync(path.join(output,'pnpm-version.stdout'),'utf8').trim()!==manifest.pnpm.version)throw Error('Original pnpm version mismatch');
    await phase(context,'original-install',[node,pnpm,'install','--frozen-lockfile','--store-dir',path.join(output,'private/store'),'--reporter=append-only'],manifest.resources.installTimeoutMs);
    const versions={},runtime={};
    for(const [name,local,expected]of [['vitest','vitest','3.2.4'],['playwrightChromium','playwright-chromium','1.54.1']]){
      const packageFile=path.join(project,'node_modules',local,'package.json');versions[name]=JSON.parse(fs.readFileSync(packageFile,'utf8')).version;if(versions[name]!==expected)throw Error('Original runtime version mismatch');runtime[name]=bytesIdentity(packageFile);
    }
    const playwright=path.join(project,'node_modules/playwright-chromium/cli.js'),core=path.join(path.dirname(fs.realpathSync(playwright)),'../playwright-core'),registry=JSON.parse(fs.readFileSync(path.join(core,'browsers.json'),'utf8'));
    if(JSON.parse(fs.readFileSync(path.join(core,'package.json'),'utf8')).version!==manifest.runtimeVersions.playwrightCore||!registry.browsers.some(row=>row.name==='chromium-headless-shell'&&row.revision===manifest.runtimeVersions.playwrightBuild&&row.browserVersion===manifest.runtimeVersions.chromium))throw Error('Original Chromium registry mismatch');
    report.runtime={versions,identities:runtime,registry:bytesIdentity(path.join(core,'browsers.json'))};atomicJson(path.join(output,'report.json'),report);
    await phase(context,'original-browser-install',[node,playwright,'install',...(options.authorizeSystemDeps?['--with-deps']:[]),'chromium']);
    report.runtime.installedHeadlessShell=bytesIdentity(headlessShellExecutable(context.env.PLAYWRIGHT_BROWSERS_PATH,manifest.runtimeVersions.playwrightBuild));atomicJson(path.join(output,'report.json'),report);
    await phase(context,'original-build',[node,pnpm,'run','build']);
    for(const [mode,script]of [['unit','test-unit'],['serve','test-serve'],['build','test-build']]){
      const nativeFile=path.join(output,mode+'.native.json');await phase(context,'original-'+mode,[node,pnpm,'run',script,'--reporter=json','--outputFile='+nativeFile]);
      const stat=fs.lstatSync(nativeFile);if(!stat.isFile()||stat.size>manifest.resources.maximumNativeReportBytes)throw Error('Bounded original native report required');
      const bytes=fs.readFileSync(nativeFile),assessment=assessOriginalNative(JSON.parse(bytes),project,mode,manifest);report.nativeSuites.push({...assessment,nativeReportSha256:sha(bytes)});
      atomicJson(path.join(output,'report.json'),report);if(!assessment.complete)throw Error('Original '+mode+' inventory not qualified');
    }
    checkBindings(project,manifest);report.completeNativeBaselines=true;report.status='passed-original-native-baselines-only';report.remainingQualification=['TestLore planning/execution','reviewed fixture-root proposals','independent full/subset faults and omission explanations','asset defect detection','SWC/RSC/full upstream scope'];
  }catch(error){report.status='incomplete';report.reason=error.message;}finally{atomicJson(path.join(output,'report.json'),report);}
  return report;
}
export async function main(argv=process.argv.slice(2)){const options=parseProfileArguments(argv),report=await runProfile(options);console.log(JSON.stringify(report,null,2));return options.run&&!report.completeNativeBaselines?1:0;}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().then(code=>{process.exitCode=code;}).catch(error=>{console.error(error.message);process.exitCode=1;});
