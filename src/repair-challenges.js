import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {digest} from './provenance.js';
import {safePath, readConfig} from './files.js';
import {withRepairEnvironment} from './repair-environment.js';

const harness=fileURLToPath(new URL('./repair-challenge-runner.cjs',import.meta.url));
const nativeProducers=['./execution.js','./native-protocol.js','./reporters/node.js'].map(file=>fileURLToPath(new URL(file,import.meta.url)));
const canonical=value=>typeof value==='string'&&!path.isAbsolute(value)&&!value.includes('\\')&&value.split('/').every(part=>part&&part!=='.'&&part!=='..'&&!part.startsWith('.'));
function binding(target,max=1024*1024) {
 const stat=fs.lstatSync(target);if(!stat.isFile()||stat.size>max)throw Error('repair-challenge-file-unbounded-or-not-regular');
 return {sha256:digest(fs.readFileSync(target)),bytes:stat.size};
}
/** Capture owner-authored challenge bytes before workers run. Attestation is
 * a governance input; execution cannot establish who authored the assertions. */
export function captureRepairChallenges(root,config=readConfig(root)) {
 const file=config.repair?.challenges;
 if(file===undefined)return {status:'not-configured',next:['Commit independently maintained behavioral challenges and set repair.challenges to their JSON manifest.']};
 if(!canonical(file)||!file.endsWith('.json'))throw Error('repair-challenge-manifest-path-invalid');
 const target=safePath(root,file),manifestBinding=binding(target,65536),manifest=JSON.parse(fs.readFileSync(target,'utf8'));
 if(manifest.schemaVersion!==1||manifest.independent!==true||typeof manifest.basis!=='string'||!manifest.basis.trim()||manifest.basis.length>4096||!Array.isArray(manifest.cases)||!manifest.cases.length||manifest.cases.length>32)throw Error('repair-challenge-independent-manifest-required');
 const ids=new Set(),scripts=new Set();
 const cases=manifest.cases.map(item=>{
  if(!item||typeof item.id!=='string'||!/^[-a-zA-Z0-9_.]{1,100}$/.test(item.id)||ids.has(item.id)||!canonical(item.script)||!item.script.endsWith('.cjs')||scripts.has(item.script))throw Error('repair-challenge-identity-invalid');
  ids.add(item.id);scripts.add(item.script);return {id:item.id,script:item.script,...binding(safePath(root,item.script),65536)};
 });
 return {status:'configured',file,manifestBinding,basis:manifest.basis,cases,identity:digest({manifestBinding,cases}),independence:'maintainer-attestation-not-inferred-from-agent-review'};
}
/** Runtime paths are trusted controller inputs; production uses process.execPath.
 * A separate replay may bind a historical Node executable and installed loader. */
export function captureChallengeRuntime({executable=process.execPath,preloads=[]}={}) {
 if(!path.isAbsolute(executable)||!Array.isArray(preloads)||preloads.length>4||preloads.some(file=>!path.isAbsolute(file)))throw Error('repair-challenge-runtime-invalid');
 return {executable,...binding(executable,512*1024*1024),preloads:preloads.map(file=>({file,...binding(file,8*1024*1024)})),harness:binding(harness,65536),flags:['--unhandled-rejections=strict']};
}
/** The production repair profile deliberately admits the current Node only.
 * Foreign executables, external preloads and uncontrolled flags cannot earn
 * native assertion qualification merely by having a filename of "node". */
export function captureNativeRepairRuntime(root,config=readConfig(root)) {
 const argv=config.runner||['node','--test','{files}'],env={...process.env,...config.env};
 const unsupported=reason=>({status:'unsupported',reason});
 if(!Array.isArray(argv)||argv.length<3||argv.some(value=>typeof value!=='string'||!value)||argv.filter(value=>value==='--test').length!==1||argv.filter(value=>value==='{files}').length!==1)return unsupported('repair-native-runner-shape-unsupported');
 if(['NODE_OPTIONS','NODE_PATH','LD_PRELOAD','LD_AUDIT','LD_LIBRARY_PATH','DYLD_INSERT_LIBRARIES','DYLD_LIBRARY_PATH'].some(name=>env[name]!==undefined&&env[name]!==''))return unsupported('repair-native-external-runtime-inputs-unsupported');
 const seen=new Set();
 for(const arg of argv.slice(1)) {
  const match=/^--test-(concurrency|timeout)=([1-9]\d*)$/.exec(arg);
  const key=match?match[1]:arg;
  if(seen.has(key))return unsupported('repair-native-runner-flags-unsupported');seen.add(key);
  if(arg==='--test'||arg==='{files}'||arg==='--unhandled-rejections=strict')continue;
  if(!match||!Number.isSafeInteger(Number(match[2]))||Number(match[2])>(match[1]==='concurrency'?128:120000))return unsupported('repair-native-runner-flags-unsupported');
 }
 const candidates=path.isAbsolute(argv[0])||argv[0].includes(path.sep)?[path.resolve(root,argv[0])]:typeof env.PATH==='string'?env.PATH.split(path.delimiter).map(directory=>path.resolve(root,directory||'.',argv[0])):[];
 let executable=null;
 for(const candidate of candidates){try{fs.accessSync(candidate,fs.constants.X_OK);if(fs.statSync(candidate).isFile()){executable=fs.realpathSync(candidate);break;}}catch{}}
 if(executable!==fs.realpathSync(process.execPath))return unsupported('repair-native-current-node-required');
 return {status:'qualified',argv:[...argv],executable,...binding(executable,512*1024*1024),producers:nativeProducers.map(file=>({file,...binding(file,2*1024*1024)}))};
}
/** One fresh native execution per case. Caller binds the complete project and
 * installed dependency tree before/after; this runner also binds scripts,
 * source files and actual executable/preload bytes at every invocation. */
export function runRepairChallenges(root,definition,{sourcePaths,runtime=captureChallengeRuntime(),timeoutMs=20000,deadline=performance.now()+120000,assertFresh=()=>{}}={}) {
 const started=performance.now(),runs=[],reasons=[];
 const result=()=>({schemaVersion:1,status:reasons.length?'rejected':'passed',accepted:!reasons.length&&runs.length===definition.cases.length,identity:definition.identity,runtime,source:sourcePaths.map(file=>({file,...binding(safePath(root,file),65536)})),runs,reasons,durationMs:Math.round(performance.now()-started)});
 if(definition.status!=='configured'||!Array.isArray(sourcePaths)||!sourcePaths.length)throw Error('repair-challenge-configured-source-required');
 if(!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>120000||!Number.isFinite(deadline)||typeof assertFresh!=='function')throw Error('repair-challenge-budget-invalid');
 const expectedSources=sourcePaths.map(file=>({file,...binding(safePath(root,file),65536)}));
 const fresh=()=>{
  if(digest(captureRepairChallenges(root))!==digest(definition))throw Error('repair-challenge-oracle-drift');
  if(digest(captureChallengeRuntime({executable:runtime.executable,preloads:runtime.preloads.map(item=>item.file)}))!==digest(runtime))throw Error('repair-challenge-runtime-drift');
  if(digest(sourcePaths.map(file=>({file,...binding(safePath(root,file),65536)})))!==digest(expectedSources))throw Error('repair-challenge-source-drift');
  assertFresh();if(performance.now()>deadline)throw Error('repair-challenge-total-timeout');
 };
 try {
  for(const item of definition.cases) {
   fresh();const remaining=Math.floor(Math.min(timeoutMs,deadline-performance.now()));if(remaining<1)throw Error('repair-challenge-total-timeout');
   const argv=['--unhandled-rejections=strict',...runtime.preloads.flatMap(item=>['-r',item.file]),harness,safePath(root,item.script),item.id];
   const native=withRepairEnvironment({env:{}},config=>{
    // Bare environment: no inherited Node preload/options or provider profiles.
    const names=['HOME','USERPROFILE','TMPDIR','TMP','TEMP','XDG_CONFIG_HOME','XDG_DATA_HOME','XDG_CACHE_HOME','XDG_STATE_HOME','XDG_RUNTIME_DIR','NPM_CONFIG_USERCONFIG','NPM_CONFIG_GLOBALCONFIG','NPM_CONFIG_CACHE','GIT_CONFIG_GLOBAL','GIT_CONFIG_SYSTEM','GIT_CONFIG_NOSYSTEM'];
    const env=Object.fromEntries(names.map(name=>[name,config.env[name]]));Object.assign(env,{PATH:path.dirname(runtime.executable)+path.delimiter+'/usr/bin:/bin',LANG:'C.UTF-8',ESM_DISABLE_CACHE:'1'});
    return spawnSync(runtime.executable,argv,{cwd:root,env,shell:false,timeout:remaining,killSignal:'SIGKILL',maxBuffer:65536,encoding:'utf8'});
   });
   let observed=null;try{const value=JSON.parse(native.stdout.trim());if(value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).every(key=>['id','status','assertions','error'].includes(key))&&typeof value.id==='string'&&value.id.length<=100&&['passed','failed'].includes(value.status)&&Number.isSafeInteger(value.assertions)&&value.assertions>=0&&value.assertions<=100000&&(!value.error||typeof value.error.name==='string'&&value.error.name.length<=80&&Object.keys(value.error).length===1))observed=value;}catch{}
   const passed=!native.error&&!native.signal&&native.status===0&&!native.stderr&&observed?.id===item.id&&observed.status==='passed'&&Number.isSafeInteger(observed.assertions)&&observed.assertions>0&&observed.assertions<=100000;
   runs.push({id:item.id,script:item.script,scriptSha256:item.sha256,exitCode:native.status,signal:native.signal||null,errorCode:native.error?.code||null,observed,stdoutSha256:digest(native.stdout||''),stderrSha256:digest(native.stderr||''),outputBytes:Buffer.byteLength(native.stdout||'')+Buffer.byteLength(native.stderr||''),passed});
   fresh();if(!passed)throw Error(`repair-challenge-failed:${item.id}`);
  }
 }catch(error){reasons.push(String(error.message).slice(0,500));}
 return result();
}
export function assessRepairChallenges(baseline,candidate) {
 if(!Array.isArray(baseline)||!Array.isArray(candidate)||baseline.length>2||candidate.length>2)return {status:'rejected',accepted:false,reasons:['independent-challenge-run-shape-invalid'],baseline:[],candidate:[],next:['Supply exactly two actual baseline and candidate repetitions.']};
 const all=[...baseline,...candidate],reasons=[];
 const valid=run=>run?.accepted===true&&run.status==='passed'&&/^[a-f0-9]{64}$/.test(run.identity||'')&&/^[a-f0-9]{64}$/.test(run.runtime?.sha256||'')&&Array.isArray(run.source)&&run.source.length>0&&run.source.every(item=>canonical(item.file)&&/^[a-f0-9]{64}$/.test(item.sha256)&&Number.isSafeInteger(item.bytes)&&item.bytes>0)&&Array.isArray(run.runs)&&run.runs.length>0&&run.runs.length<=32&&new Set(run.runs.map(item=>item?.id)).size===run.runs.length&&run.runs.every(item=>item?.passed===true&&item.exitCode===0&&item.signal===null&&item.errorCode===null&&/^[a-f0-9]{64}$/.test(item.scriptSha256||'')&&item.observed?.id===item.id&&item.observed.status==='passed'&&Number.isSafeInteger(item.observed.assertions)&&item.observed.assertions>0&&item.observed.assertions<=100000);
 if(all.some(run=>!valid(run)))return {status:'rejected',accepted:false,reasons:[...(baseline.some(run=>run?.accepted!==true)?['independent-challenge-baseline-not-repeatably-passing']:[]),...(candidate.some(run=>run?.accepted!==true)?['independent-challenge-candidate-regression-or-incomplete']:[]),'independent-challenge-actual-outcomes-invalid'],baseline,candidate,next:['Inspect the named failing challenge and retained actual process outcomes; preserve its assertions. Flags alone cannot qualify a repair.']};
 if(baseline.length!==2||baseline.some(run=>run.accepted!==true))reasons.push('independent-challenge-baseline-not-repeatably-passing');
 if(candidate.length!==2||candidate.some(run=>run.accepted!==true))reasons.push('independent-challenge-candidate-regression-or-incomplete');
 if(all.length&&all.some(run=>run.identity!==all[0].identity||digest(run.runtime)!==digest(all[0].runtime)||digest(run.runs.map(item=>[item.id,item.scriptSha256]))!==digest(all[0].runs.map(item=>[item.id,item.scriptSha256]))))reasons.push('independent-challenge-input-or-runtime-drift');
 if(baseline.length===2&&digest(baseline[0].source)!==digest(baseline[1].source)||candidate.length===2&&digest(candidate[0].source)!==digest(candidate[1].source))reasons.push('independent-challenge-source-not-repeatable');
 return {status:reasons.length?'rejected':'passed',accepted:!reasons.length,baseline,candidate,reasons,next:reasons.length?['Inspect the named failing challenge. Preserve its original assertions; repair the source or correct independently invalid baseline evidence before retrying.']:[]};
}
