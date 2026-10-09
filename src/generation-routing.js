import fs from 'node:fs';
import path from 'node:path';
import {adapterFor} from './execution.js';
import {digest} from './provenance.js';
import {safePath,SOURCE,TEST,git} from './files.js';

export function workerAvailable(root,command) {
  if(!Array.isArray(command)||!command.length||command.some(v=>typeof v!=='string'||!v))return false;
  const executable=path.isAbsolute(command[0])?command[0]:command[0].includes('/')?path.resolve(root,command[0]):(process.env.PATH||'').split(path.delimiter).map(dir=>path.resolve(dir,command[0])).find(file=>{try{fs.accessSync(file,fs.constants.X_OK);return fs.statSync(file).isFile();}catch{return false;}});
  try{fs.accessSync(executable,fs.constants.X_OK);if(!fs.statSync(executable).isFile())return false;
    if(/^node(?:\.exe)?$/.test(path.basename(fs.realpathSync(executable))) && command[1] && !command[1].startsWith('-'))return fs.statSync(path.resolve(root,command[1])).isFile();
    return true;
  }catch{return false;}
}
// Filesystem inspection only: planning never downloads, imports or probes AQE.
export function localAqe(root,{dependencyMetadata}={}) {
  try {
    let dependencyRoot=root;
    const modulePath=path.join(root,'node_modules');
    if(fs.lstatSync(modulePath).isSymbolicLink()){
      if(!dependencyMetadata||typeof dependencyMetadata.root!=='string'||typeof dependencyMetadata.nodeModules!=='string'||typeof dependencyMetadata.sourceHead!=='string'||!/^[a-f0-9]{40,64}$/.test(dependencyMetadata.sourceHead))return null;
      dependencyRoot=fs.realpathSync(dependencyMetadata.root);
      if(git(dependencyRoot,['rev-parse','HEAD']).trim()!==dependencyMetadata.sourceHead||git(root,['rev-parse','HEAD']).trim()!==dependencyMetadata.sourceHead)return null;
      const original=safePath(dependencyRoot,'node_modules');
      if(!fs.lstatSync(original).isDirectory()||fs.realpathSync(original)!==dependencyMetadata.nodeModules||fs.realpathSync(modulePath)!==dependencyMetadata.nodeModules)return null;
    }
    const packageFile=safePath(dependencyRoot,'node_modules/agentic-qe/package.json'),stat=fs.statSync(packageFile);
    if(!stat.isFile()||stat.size>65536)return null;
    const content=fs.readFileSync(packageFile,'utf8'),pkg=JSON.parse(content);
    if(pkg.name!=='agentic-qe'||pkg.version!=='3.14.8')return null;
    const bin=typeof pkg.bin==='string'?pkg.bin:pkg.bin?.aqe;
    if(typeof bin!=='string'||path.isAbsolute(bin)||bin.includes('\\')||bin.split('/').includes('..'))return null;
    const packageRoot=path.dirname(packageFile),relative=path.relative(dependencyRoot,path.resolve(packageRoot,bin));
    const script=safePath(dependencyRoot,relative),binary=fs.statSync(script);
    if(!binary.isFile()||binary.size>2*1024*1024)return null;
    // Reject a .bin alias pointing elsewhere; an absent alias is fine for exact Node argv.
    const alias=path.join(root,'node_modules/.bin/aqe');
    try{fs.lstatSync(alias);if(fs.realpathSync(alias)!==fs.realpathSync(script))return null;}catch(error){if(error.code!=='ENOENT')return null;try{fs.lstatSync(alias);return null;}catch{}}
    return {version:pkg.version,command:[process.execPath,script],binding:{dependencyRoot:fs.realpathSync(path.join(dependencyRoot,'node_modules')),packagePath:'node_modules/agentic-qe/package.json',packageHash:digest(content),scriptPath:relative.split(path.sep).join('/'),scriptHash:digest(fs.readFileSync(script))}};
  }catch{return null;}
}
export function planGeneration(root,{config={},agent=config.agent,requirements='',tasks,provider,kind='test-generation',dependencyMetadata}={}) {
  if(provider!==undefined&&!['auto','json-worker','agentic-qe'].includes(provider))throw new Error('Unsupported generation provider');
  const setting=config.plugins?.['agentic-qe'],explicit=provider==='agentic-qe'||(provider!== 'json-worker'&&setting?.enabled===true);
  if(provider==='agentic-qe'&&setting?.enabled!==true)throw new Error('Enable the agentic-qe plugin before selecting it');
  const plan={schemaVersion:1,mode:explicit?'explicit':'auto',provider:'json-worker',maxParallelAuthors:3,reasons:[],cost:{tokens:null,currency:null},limitations:['A compatible distribution is not a quality qualification; no AQE advantage is proven.','Learning and upstream quality estimates remain advisory.','Bound package/bin identity and a reviewed shared installation are not whole-dependency or OS sandbox certification.'],ready:false};
  if(explicit){plan.provider='agentic-qe';plan.maxParallelAuthors=2;plan.plugin={...setting};plan.reasons.push('Explicit enabled AQE author; failures remain closed.');plan.ready=true;return plan;}
  if(provider==='json-worker'){plan.mode='explicit';plan.reasons.push('Explicit JSON author selection.');return plan;}
  if(setting && setting.enabled!==true){plan.reasons.push('Explicit AQE configuration does not enable generation.');return plan;}
  if(Object.values(config.plugins||{}).some(p=>p?.enabled===true&&p.kind==='worker')){plan.reasons.push('Preserve explicitly configured custom worker.');return plan;}
  if(kind!=='test-generation'){plan.reasons.push('AQE auto routing is limited to test generation, never source repair.');return plan;}
  const framework=adapterFor(config);
  if(!['vitest','jest'].includes(framework)){plan.reasons.push('Auto AQE requires a supported Vitest or Jest project; Node generation is unsupported by AQE 3.14.8.');return plan;}
  if(!workerAvailable(root,agent)){plan.reasons.push('Available architect and independent reviewer worker required.');return plan;}
  if(typeof requirements!=='string'||requirements.trim().length<20||requirements.trim().split(/\s+/).length<4||/^\s*(?:TODO|TBD)\b/i.test(requirements)){plan.reasons.push('Meaningful independent written behavior requirements required.');return plan;}
  const installed=localAqe(root,{dependencyMetadata});
  if(!installed){plan.reasons.push('Safely bound project-local AQE 3.14.8 is unavailable; no installation attempted.');return plan;}
  if(!Array.isArray(tasks)||!tasks.length){plan.reasons.push('Await eligible independent architect tasks.');return plan;}
  const subjects=new Set();
  for(const task of tasks){try{if(typeof task?.subject!=='string'||!SOURCE.test(task.subject)||TEST.test(task.subject)||subjects.has(task.subject)||!fs.statSync(safePath(root,task.subject)).isFile())throw new Error();subjects.add(task.subject);}catch{plan.reasons.push('Distinct existing production source tasks required for AQE.');return plan;}}
  plan.provider='agentic-qe';plan.maxParallelAuthors=2;plan.ready=true;plan.plugin={command:installed.command,framework,timeoutMs:120000};plan.binding=installed.binding;plan.reasons.push('Compatible local author distribution with independent requirements, distinct source tasks, and review worker.','Auto failures may use one bounded JSON fallback for each failed task after its batch settles.');return plan;
}
export function generationBindingFresh(root,plan,options={}){if(!plan.binding)return true;const current=localAqe(root,options);return !!current&&JSON.stringify(current.binding)===JSON.stringify(plan.binding);}
