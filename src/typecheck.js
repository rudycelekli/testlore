import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {snapshot, freshness} from './provenance.js';
import {readConfig} from './files.js';

const worker=fileURLToPath(new URL('./reporters/typecheck-worker.cjs',import.meta.url));
const hash=value=>createHash('sha256').update(typeof value==='string'||Buffer.isBuffer(value)?value:JSON.stringify(value)).digest('hex');
const canonical=file=>typeof file==='string'&&file.length>0&&!file.includes('\\')&&!/[\x00-\x1f\x7f]/.test(file)&&!path.isAbsolute(file)&&file.split('/').every(x=>x&&x!=='.'&&x!=='..');
const inside=(root,file)=>file.startsWith(root+path.sep);
function failure(code){throw Object.assign(new Error(code),{code});}
function checkDeadline(deadline){if(performance.now()>=deadline)failure('typecheck-timeout');}
function fileHash(file,deadline){const digest=createHash('sha256'),buffer=Buffer.alloc(65536),fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);try{let n;while((n=fs.readSync(fd,buffer,0,buffer.length,null))){checkDeadline(deadline);digest.update(buffer.subarray(0,n));}}finally{fs.closeSync(fd);}return digest.digest('hex');}
// Include ignored source and directory membership. A public checksum is evidence,
// never admission: each verification captures fresh bytes both before and after.
function inventory(root,deadline){
  const source=[],dependencies=[];let bytes=0,count=0;
  function walk(directory,prefix=''){
    for(const name of fs.readdirSync(directory).sort()){
      checkDeadline(deadline);if(!prefix&&['.git','.tddswarm'].includes(name))continue;
      const file=prefix+name;if(!canonical(file))failure('typecheck-invalid-input-path');
      const target=path.join(directory,name),stat=fs.lstatSync(target);
      if(++count>100000)failure('typecheck-inventory-bound');
      const rows=file==='node_modules'||file.startsWith('node_modules/')?dependencies:source;
      if(stat.isSymbolicLink()){
        const real=fs.realpathSync(target);if(!inside(root,real))failure('typecheck-external-symlink');
        rows.push({file,kind:'symlink',target:fs.readlinkSync(target),real:path.relative(root,real)});
      }else if(stat.isDirectory()){
        if(prefix&&name==='.git')failure('typecheck-nested-repository');
        rows.push({file,kind:'directory',mode:stat.mode&0o777});walk(target,file+'/');
      }else if(stat.isFile()){
        bytes+=stat.size;if(bytes>1024*1024*1024)failure('typecheck-inventory-bound');
        rows.push({file,kind:'file',size:stat.size,mode:stat.mode&0o777,sha256:fileHash(target,deadline)});
      }else failure('typecheck-unsupported-file');
    }
  }
  walk(root);
  return {source:{sha256:hash(source),files:source},dependencies:{sha256:hash(dependencies),files:dependencies},bytes,count};
}
function runtime(deadline){const executable=fs.realpathSync(process.execPath);return {executable,version:process.version,platform:process.platform,arch:process.arch,sha256:fileHash(executable,deadline)};}
const producerFiles=['./typecheck.js','./reporters/typecheck-worker.cjs','./provenance.js','./files.js','./inputs.js','./configuration-inputs.js','./plugin-config.js'].map(file=>fileURLToPath(new URL(file,import.meta.url)));
function producers(deadline){return producerFiles.map(file=>({file:path.relative(path.dirname(fileURLToPath(import.meta.url)),file).split(path.sep).join('/'),sha256:fileHash(file,deadline)}));}
const openingTokens=new WeakMap();
function environment(home){return {HOME:home,USERPROFILE:home,TMPDIR:home,TMP:home,TEMP:home,PATH:path.dirname(process.execPath)+path.delimiter+'/usr/bin:/bin',LANG:'C',LC_ALL:'C',TZ:'UTC'};}
function captureProvenance(root,deadline,home){
  checkDeadline(deadline);const config=readConfig(root),services={...config.services};
  if(Object.keys(services).length>32)failure('typecheck-service-bound');
  for(const [name,service] of Object.entries(services)){
    if(service?.probe===undefined)continue;
    if(!Array.isArray(service.probe)||!service.probe.length||service.probe.length>128||service.probe.some(arg=>typeof arg!=='string'||arg.length>65536))failure('typecheck-invalid-service-probe');
    checkDeadline(deadline);const remaining=Math.floor(deadline-performance.now());if(remaining<1)failure('typecheck-timeout');
    const result=spawnSync(service.probe[0],service.probe.slice(1),{cwd:root,encoding:'utf8',timeout:remaining,maxBuffer:1024*1024,killSignal:'SIGKILL',shell:false,env:environment(home)});
    if(result.error?.code==='ETIMEDOUT')failure('typecheck-timeout');
    if(result.error||result.signal||result.status!==0)failure('typecheck-service-probe-failed');
    services[name]={...service,probe:undefined,version:result.stdout.trim()};
  }
  const result=snapshot(root,{...config,services});checkDeadline(deadline);return result;
}
function captureState(root,deadline,home){
  // Bound paths and bytes before executing a configured probe. Its output is
  // advisory provenance; final byte capture always follows all probe callbacks.
  inventory(root,deadline);
  const provenance=captureProvenance(root,deadline,home),inputs=inventory(root,deadline),node=runtime(deadline),producer=producers(deadline);
  checkDeadline(deadline);return {root,inputs,provenance,node,producer};
}
function assertState(expected,current,prefix='typecheck'){
  if(expected.root!==current.root)failure(prefix+'-root-mismatch');
  if(expected.inputs.source.sha256!==current.inputs.source.sha256)failure(prefix+'-source-drift');
  if(expected.inputs.dependencies.sha256!==current.inputs.dependencies.sha256)failure(prefix+'-dependency-drift');
  if(hash(expected.node)!==hash(current.node)||hash(expected.producer)!==hash(current.producer))failure(prefix+'-runtime-drift');
  if(!freshness(expected.provenance,current.provenance).fresh||expected.provenance.revision!==current.provenance.revision)failure(prefix+'-provenance-drift');
}
/** Opening evidence must be captured before any native config or test executes.
 * The exact locally minted object is required; copied/serialized receipts cannot
 * carry this freshness binding. It does not authorize routing or publication. */
export function captureTypecheckInputs(projectRoot,{timeoutMs=30000}={}){
  const started=performance.now();let home;
  try{
    if(!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>300000)failure('typecheck-invalid-timeout');
    const deadline=started+timeoutMs,root=fs.realpathSync(projectRoot);home=fs.mkdtempSync(path.join(os.tmpdir(),'testlore-typecheck-opening-'));fs.chmodSync(home,0o700);
    const state=captureState(root,deadline,home),token=Object.freeze({schemaVersion:1,kind:'native-typecheck-inputs',status:'captured',complete:true,errorCode:null,exitCode:0,durationMs:Math.round(performance.now()-started),sourceSha256:state.inputs.source.sha256,dependencySha256:state.inputs.dependencies.sha256,provenanceFingerprint:state.provenance.fingerprint,revision:state.provenance.revision});
    openingTokens.set(token,state);return token;
  }catch(error){return Object.freeze({schemaVersion:1,kind:'native-typecheck-inputs',status:'incomplete',complete:false,errorCode:error.code?.startsWith('typecheck-')?error.code:'typecheck-input-unavailable',exitCode:2,durationMs:Math.round(performance.now()-started)});}
  finally{if(home)fs.rmSync(home,{recursive:true,force:true});}
}
function verifyProtocol(result,root,inventoryBefore){
  if(!result||result.schemaVersion!==1||!['passed','failed','incomplete'].includes(result.status)||!Array.isArray(result.files)||!Array.isArray(result.diagnostics)||!Array.isArray(result.limitations)||typeof result.compiler?.version!=='string'||typeof result.complete!=='boolean')failure('typecheck-malformed-output');
  if(result.files.length>10000||new Set(result.files).size!==result.files.length||result.files.some(file=>!canonical(file)))failure('typecheck-malformed-output');
  if(!Array.isArray(result.implementationFiles)||JSON.stringify(result.implementationFiles)!==JSON.stringify(result.files))failure('typecheck-malformed-output');
  if(!Array.isArray(result.programFiles)||!Array.isArray(result.suppressions)||result.programFiles.length>10000||new Set(result.programFiles).size!==result.programFiles.length)failure('typecheck-malformed-output');
  const known=new Map([...inventoryBefore.source.files,...inventoryBefore.dependencies.files].map(row=>[row.file,row]));
  if(result.programFiles.some(file=>!canonical(file)||!known.has(file))||result.files.some(file=>!result.programFiles.includes(file)))failure('typecheck-malformed-output');
  if(result.suppressions.length>10000||result.suppressions.some(item=>!item||!canonical(item.file)||!known.has(item.file)||!['ts-nocheck','ts-ignore','ts-expect-error'].includes(item.directive)||!Number.isSafeInteger(item.line)||item.line<1||!Number.isSafeInteger(item.column)||item.column<1))failure('typecheck-malformed-output');
  if(result.files.some(file=>!known.has(file)))failure('typecheck-external-scope');
  const seen=new Set();
  for(const diagnostic of result.diagnostics){
    if(!Number.isSafeInteger(diagnostic.code)||diagnostic.code<0||!['error','warning','message','suggestion'].includes(diagnostic.category)||typeof diagnostic.message!=='string'||diagnostic.message.length>4096||!(diagnostic.file===null||canonical(diagnostic.file))||!(diagnostic.line===null||Number.isSafeInteger(diagnostic.line)&&diagnostic.line>0)||!(diagnostic.column===null||Number.isSafeInteger(diagnostic.column)&&diagnostic.column>0))failure('typecheck-malformed-output');
    if(diagnostic.file!==null&&!result.files.includes(diagnostic.file)&&!known.has(diagnostic.file))failure('typecheck-external-scope');
    const identity=hash(diagnostic);if(seen.has(identity))failure('typecheck-malformed-output');seen.add(identity);
  }
  const errors=result.diagnostics.some(x=>x.category==='error');
  if(result.complete&&(!result.files.length||result.status==='incomplete'||(result.status==='passed'&&errors)||(result.status==='failed'&&!errors)))failure('typecheck-malformed-output');
  if(!result.complete&&result.status!=='incomplete')failure('typecheck-malformed-output');
  if(result.status==='incomplete'&&(typeof result.errorCode!=='string'||!result.errorCode))failure('typecheck-malformed-output');
  return result;
}

/** Complementary type oracle. Trusted native execution, not an OS sandbox. */
export function verifyTypecheck(projectRoot,{project='tsconfig.json',timeoutMs=30000,expectedProvenance,openingInputs}={}){
  const started=performance.now(),base={schemaVersion:1,kind:'native-typecheck',project:canonical(project)?project:null,status:'incomplete',complete:false,exitCode:2,files:[],diagnostics:[],programFiles:[],implementationFiles:[],suppressions:[],compiler:null,binding:null,signal:null,errorCode:null,reasons:[],durationMs:0,nextAction:'Resolve the incomplete compiler check and run verification again.',scope:'Project-local unreferenced TypeScript implementation scope',limitations:['Trusted compiler execution is not an OS sandbox.','This type oracle grants no test-routing or publication authority.']};
  let home;
  const finish=extra=>({...base,...extra,durationMs:Math.round(performance.now()-started)});
  try{
    if(!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>300000)failure('typecheck-invalid-timeout');
    const deadline=started+timeoutMs,root=fs.realpathSync(projectRoot);
    if(!canonical(project))failure('typecheck-invalid-project');
    if(['.git','.tddswarm'].includes(project.split('/')[0]))failure('typecheck-reserved-input');
    const configFile=path.join(root,project);
    if(!fs.existsSync(configFile))return finish({status:'not-configured',errorCode:'typecheck-config-missing',reasons:['typecheck-config-missing'],nextAction:`Add ${project}, or configure the path to an existing TypeScript project.`});
    const realConfig=fs.realpathSync(configFile);
    if(!inside(root,realConfig)||!fs.statSync(configFile).isFile())failure('typecheck-external-config');
    if(['.git','.tddswarm'].includes(path.relative(root,realConfig).split(path.sep)[0]))failure('typecheck-reserved-input');
    if(openingInputs!==undefined&&!openingTokens.has(openingInputs))failure('typecheck-invalid-opening-inputs');
    home=fs.mkdtempSync(path.join(os.tmpdir(),'testlore-typecheck-'));fs.chmodSync(home,0o700);
    const beforeState=captureState(root,deadline,home),before=beforeState.inputs,beforeProvenance=beforeState.provenance;
    if(openingInputs!==undefined)assertState(openingTokens.get(openingInputs),beforeState,'typecheck-opening');
    if(expectedProvenance){const check=freshness(expectedProvenance,beforeProvenance);if(!check.fresh||expectedProvenance.revision!==beforeProvenance.revision)failure('typecheck-provenance-mismatch');}
    const nodeBefore=beforeState.node,producerBefore=beforeState.producer;
    base.binding={source:before.source,dependencies:before.dependencies,provenance:beforeProvenance,node:nodeBefore,producers:producerBefore};
    const sdk=path.join(root,'node_modules/typescript/lib/typescript.js'),manifest=path.join(root,'node_modules/typescript/package.json');
    if(!fs.existsSync(sdk)||!fs.existsSync(manifest))failure('typecheck-sdk-missing');
    if(!inside(root,fs.realpathSync(sdk))||!inside(root,fs.realpathSync(manifest)))failure('typecheck-external-sdk');
    const packageData=JSON.parse(fs.readFileSync(manifest,'utf8'));
    if(packageData.name!=='typescript'||typeof packageData.version!=='string')failure('typecheck-sdk-invalid');
    const compiler={version:packageData.version,file:path.relative(root,fs.realpathSync(sdk)),sha256:fileHash(sdk,deadline),manifestSha256:fileHash(manifest,deadline)};
    base.compiler=compiler;
    const remaining=Math.floor(deadline-performance.now());if(remaining<1)failure('typecheck-timeout');
    const child=spawnSync(nodeBefore.executable,['--unhandled-rejections=strict',worker],{cwd:root,input:JSON.stringify({root,project,sdk,version:compiler.version}),encoding:'utf8',timeout:remaining,maxBuffer:4*1024*1024,killSignal:'SIGKILL',env:environment(home)});
    base.signal=child.signal||null;
    if(child.error){failure(child.error.code==='ETIMEDOUT'?'typecheck-timeout':'typecheck-worker-error');}
    if(child.signal||child.status!==0||child.stderr)failure('typecheck-worker-error');
    let parsed;try{parsed=JSON.parse(child.stdout);}catch{failure('typecheck-malformed-output');}
    const result=verifyProtocol(parsed,root,before);
    if(result.compiler.version!==compiler.version)failure('typecheck-sdk-drift');
    const afterState=captureState(root,deadline,home);assertState(beforeState,afterState);
    if(openingInputs!==undefined)assertState(openingTokens.get(openingInputs),afterState,'typecheck-opening');
    return finish({status:result.status,complete:result.complete,exitCode:result.complete?(result.status==='failed'?1:0):2,files:result.files,diagnostics:result.diagnostics,programFiles:result.programFiles,implementationFiles:result.implementationFiles,suppressions:result.suppressions,compiler,binding:{source:before.source,dependencies:before.dependencies,provenance:beforeProvenance,node:nodeBefore,producers:producerBefore,projectSha256:fileHash(configFile,deadline)},errorCode:result.errorCode||null,reasons:result.errorCode?[result.errorCode]:[],limitations:[...base.limitations,...result.limitations],nextAction:result.status==='passed'?'Type checking passed; continue with independent runtime tests.':result.status==='failed'?'Repair the reported type diagnostics, then rerun type checking and runtime tests.':'Resolve unsupported compiler configuration or incomplete scope, then rerun.'});
  }catch(error){const errorCode=error.code?.startsWith('typecheck-')?error.code:'typecheck-input-unavailable';return finish({errorCode,reasons:[errorCode]});}
  finally{if(home)fs.rmSync(home,{recursive:true,force:true});}
}
