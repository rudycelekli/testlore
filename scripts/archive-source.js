import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {spawnSync} from 'node:child_process';import {createHash} from 'node:crypto';
const digest=value=>createHash('sha256').update(value).digest('hex');
function invoke(cwd,argv){const r=spawnSync(argv[0],argv.slice(1),{cwd,encoding:'utf8',shell:false,timeout:120000,killSignal:'SIGKILL',maxBuffer:16*1024*1024});if(r.error||r.status!==0)throw new Error(r.error?.message||r.stderr);return r.stdout;}
/** Copy committed inputs; add only the exact Git action identity to package metadata. */
export function sealSourceArchive(root,revision,output){
 if(!/^[a-f0-9]{40}$/.test(revision)||invoke(root,['git','rev-parse','HEAD']).trim()!==revision||invoke(root,['git','status','--porcelain']).trim())throw new Error('Archive requires a clean exact revision');
 const entries=invoke(root,['git','ls-tree','-r','-z',revision]).split('\0').filter(Boolean).map(entry=>{const match=entry.match(/^(100644|100755) blob ([a-f0-9]{40})\t([\s\S]+)$/);if(!match)throw new Error('Archive requires regular committed blobs');return {file:match[3],mode:match[1],hash:match[2]};}),files=entries.map(entry=>entry.file),temporary=fs.mkdtempSync(path.join(os.tmpdir(),'testlore-archive-source-'));let bytes=0;
 try{
  for(const entry of entries){const {file}=entry;if(file.split('/').some(part=>!part||part==='.'||part==='..')||path.isAbsolute(file))throw new Error('Unsafe archive source');const source=path.join(root,file),stat=fs.lstatSync(source);if(!stat.isFile()||stat.isSymbolicLink())throw new Error('Archive source must be regular tracked files');bytes+=stat.size;if(bytes>64*1024*1024)throw new Error('Archive source exceeds 64 MB');const target=path.join(temporary,file);fs.mkdirSync(path.dirname(target),{recursive:true});const content=fs.readFileSync(source),blob=createHash('sha1').update(Buffer.from('blob '+content.length+'\0')).update(content).digest('hex');if(blob!==entry.hash)throw new Error('Source bytes differ from committed blob: '+file);fs.writeFileSync(target,content);fs.chmodSync(target,entry.mode==='100755'?0o755:0o644);}
  const original=fs.readFileSync(path.join(temporary,'package.json')),manifest={...JSON.parse(original),gitHead:revision};fs.writeFileSync(path.join(temporary,'package.json'),JSON.stringify(manifest,null,2)+'\n');
  const pack=JSON.parse(invoke(temporary,['npm','pack','--ignore-scripts','--json','--pack-destination',path.resolve(output)]))[0],tracked=new Set(files);
  if(!Array.isArray(pack.files)||pack.files.some(file=>!tracked.has(file.path)))throw new Error('Archive contains files outside tracked source');
  if(invoke(root,['git','rev-parse','HEAD']).trim()!==revision||invoke(root,['git','status','--porcelain']).trim())throw new Error('Archive source drifted');
  return {...pack,recipe:'tracked-source-with-exact-gitHead',sourceManifestSha256:digest(original),packedManifestSha256:digest(fs.readFileSync(path.join(temporary,'package.json'))),actionReference:revision};
 }finally{fs.rmSync(temporary,{recursive:true,force:true});}
}
