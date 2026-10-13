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
const canonical=file=>typeof file==='string'&&file.length>0&&!file.includes('\\')&&!file.includes('\0')&&!path.isAbsolute(file)&&file.split('/').every(x=>x&&x!=='.'&&x!=='..');
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
      const file=prefix+name,target=path.join(directory,name),stat=fs.lstatSync(target);
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
function producers(deadline){return [fileURLToPath(import.meta.url),worker].map(file=>({file:path.basename(file),sha256:fileHash(file,deadline)}));}
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
export function verifyTypecheck(projectRoot,{project='tsconfig.json',timeoutMs=30000,expectedProvenance}={}){
  const started=performance.now(),base={schemaVersion:1,kind:'native-typecheck',project,status:'incomplete',complete:false,exitCode:2,files:[],diagnostics:[],programFiles:[],implementationFiles:[],suppressions:[],compiler:null,binding:null,signal:null,errorCode:null,reasons:[],durationMs:0,nextAction:'Resolve the incomplete compiler check and run verification again.',scope:'Project-local unreferenced TypeScript implementation scope',limitations:['Trusted compiler execution is not an OS sandbox.','This type oracle grants no test-routing or publication authority.']};
  let home;
  const finish=extra=>({...base,...extra,durationMs:Math.round(performance.now()-started)});
  try{
    if(!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>300000)failure('typecheck-invalid-timeout');
    const deadline=started+timeoutMs,root=fs.realpathSync(projectRoot);
    if(!canonical(project))failure('typecheck-invalid-project');
    const configFile=path.join(root,project);
    if(!fs.existsSync(configFile))return finish({status:'not-configured',errorCode:'typecheck-config-missing',reasons:['typecheck-config-missing'],nextAction:`Add ${project}, or configure the path to an existing TypeScript project.`});
    if(!inside(root,fs.realpathSync(configFile))||!fs.statSync(configFile).isFile())failure('typecheck-external-config');
    const before=inventory(root,deadline);
    const beforeProvenance=snapshot(root,readConfig(root));checkDeadline(deadline);
    if(expectedProvenance){const check=freshness(expectedProvenance,beforeProvenance);if(!check.fresh||expectedProvenance.revision!==beforeProvenance.revision)failure('typecheck-provenance-mismatch');}
    const nodeBefore=runtime(deadline),producerBefore=producers(deadline);
    base.binding={source:before.source,dependencies:before.dependencies,provenance:beforeProvenance,node:nodeBefore,producers:producerBefore};
    const sdk=path.join(root,'node_modules/typescript/lib/typescript.js'),manifest=path.join(root,'node_modules/typescript/package.json');
    if(!fs.existsSync(sdk)||!fs.existsSync(manifest))failure('typecheck-sdk-missing');
    if(!inside(root,fs.realpathSync(sdk))||!inside(root,fs.realpathSync(manifest)))failure('typecheck-external-sdk');
    const packageData=JSON.parse(fs.readFileSync(manifest,'utf8'));
    if(packageData.name!=='typescript'||typeof packageData.version!=='string')failure('typecheck-sdk-invalid');
    const compiler={version:packageData.version,file:path.relative(root,fs.realpathSync(sdk)),sha256:fileHash(sdk,deadline),manifestSha256:fileHash(manifest,deadline)};
    base.compiler=compiler;
    home=fs.mkdtempSync(path.join(os.tmpdir(),'testlore-typecheck-'));fs.chmodSync(home,0o700);
    const remaining=Math.floor(deadline-performance.now());if(remaining<1)failure('typecheck-timeout');
    const child=spawnSync(nodeBefore.executable,['--unhandled-rejections=strict',worker],{cwd:root,input:JSON.stringify({root,project,sdk,version:compiler.version}),encoding:'utf8',timeout:remaining,maxBuffer:4*1024*1024,killSignal:'SIGKILL',env:{HOME:home,USERPROFILE:home,TMPDIR:home,TMP:home,TEMP:home,PATH:path.dirname(nodeBefore.executable)+path.delimiter+'/usr/bin:/bin',LANG:'C',LC_ALL:'C',TZ:'UTC'}});
    base.signal=child.signal||null;
    if(child.error){failure(child.error.code==='ETIMEDOUT'?'typecheck-timeout':'typecheck-worker-error');}
    if(child.signal||child.status!==0||child.stderr)failure('typecheck-worker-error');
    let parsed;try{parsed=JSON.parse(child.stdout);}catch{failure('typecheck-malformed-output');}
    const result=verifyProtocol(parsed,root,before);
    if(result.compiler.version!==compiler.version)failure('typecheck-sdk-drift');
    const after=inventory(root,deadline),nodeAfter=runtime(deadline),producerAfter=producers(deadline),afterProvenance=snapshot(root,readConfig(root));checkDeadline(deadline);
    if(before.source.sha256!==after.source.sha256)failure('typecheck-source-drift');
    if(before.dependencies.sha256!==after.dependencies.sha256)failure('typecheck-dependency-drift');
    if(hash(nodeBefore)!==hash(nodeAfter)||hash(producerBefore)!==hash(producerAfter))failure('typecheck-runtime-drift');
    if(!freshness(beforeProvenance,afterProvenance).fresh||beforeProvenance.revision!==afterProvenance.revision)failure('typecheck-provenance-drift');
    return finish({status:result.status,complete:result.complete,exitCode:result.complete?(result.status==='failed'?1:0):2,files:result.files,diagnostics:result.diagnostics,programFiles:result.programFiles,implementationFiles:result.implementationFiles,suppressions:result.suppressions,compiler,binding:{source:before.source,dependencies:before.dependencies,provenance:beforeProvenance,node:nodeBefore,producers:producerBefore,projectSha256:fileHash(configFile,deadline)},errorCode:result.errorCode||null,reasons:result.errorCode?[result.errorCode]:[],limitations:[...base.limitations,...result.limitations],nextAction:result.status==='passed'?'Type checking passed; continue with independent runtime tests.':result.status==='failed'?'Repair the reported type diagnostics, then rerun type checking and runtime tests.':'Resolve unsupported compiler configuration or incomplete scope, then rerun.'});
  }catch(error){const errorCode=error.code?.startsWith('typecheck-')?error.code:'typecheck-input-unavailable';return finish({errorCode,reasons:[errorCode]});}
  finally{if(home)fs.rmSync(home,{recursive:true,force:true});}
}
