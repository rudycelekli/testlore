import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {listFiles,safePath} from './files.js';

const excluded=new Set(['.git','node_modules','.tddswarm','dist','build','.next','coverage']);
function argument(command,names){
  const values=[];
  for(let index=0;index<command.length;index++)for(const name of names){
    if(command[index]===name){const value=command[++index];if(typeof value!=='string'||!value||value.startsWith('-'))throw Error('Missing native workspace root/config value');values.push(value);break;}
    if(command[index].startsWith(name+'=')){const value=command[index].slice(name.length+1);if(!value)throw Error('Missing native workspace root/config value');values.push(value);break;}
  }
  return values;
}
function contained(root,value,{directory=false}={}){
  if(typeof value!=='string'||!value||value.length>4096||/[\\\0\r\n]/.test(value))throw Error('Invalid native workspace path');
  if(value!=='.'&&value.split('/').some((part,index)=>part==='.'||!part&&index!==0))throw Error('Native workspace path spelling is noncanonical');
  const absolute=path.resolve(root,value),relative=path.relative(root,absolute).split(path.sep).join('/');
  if(relative.startsWith('../')||path.isAbsolute(relative)||relative.split('/').some(part=>excluded.has(part))||value.split('/').includes('..'))throw Error('Native workspace path is outside the observed inventory');
  if(relative)safePath(root,relative);
  const physical=fs.realpathSync(absolute),stat=fs.lstatSync(absolute);
  if(physical!==absolute||stat.isSymbolicLink()||(directory?!stat.isDirectory():!stat.isFile()))throw Error('Native workspace path is noncanonical or not a regular input');
  return {absolute,relative,dev:String(stat.dev),ino:String(stat.ino)};
}
function configIdentity(root,value){
  const file=contained(root,value),fd=fs.openSync(file.absolute,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0)|(fs.constants.O_NONBLOCK||0));
  try{
    const before=fs.fstatSync(fd);if(!before.isFile()||before.size>4*1024*1024||String(before.dev)!==file.dev||String(before.ino)!==file.ino)throw Error('Native workspace config changed or exceeds bound');
    const data=Buffer.alloc(before.size+1);let offset=0;for(let count;offset<data.length&&(count=fs.readSync(fd,data,offset,data.length-offset,null));)offset+=count;
    const after=fs.fstatSync(fd);if(offset!==before.size||after.size!==before.size||after.mtimeMs!==before.mtimeMs||after.ctimeMs!==before.ctimeMs)throw Error('Native workspace config changed during capture');
    return {...file,sha256:createHash('sha256').update(data.subarray(0,offset)).digest('hex')};
  }finally{fs.closeSync(fd);}
}
/** Internal, fresh directory/config binding. A CLI root never changes native cwd. */
export function captureVitestWorkspaceRoot(root,command){
  const roots=argument(command,['--root']);
  if(!roots.length)return null;
  if(roots.length!==1||argument(command,['-r']).length)throw Error('Duplicate or conflicting native workspace root');
  const configs=argument(command,['--config','-c']);
  if(configs.length!==1)throw Error('Native workspace root requires one explicit config');
  const requestedRoot=path.resolve(root);
  if(fs.lstatSync(requestedRoot).isSymbolicLink())throw Error('Native inventory root cannot be a symlink');
  root=fs.realpathSync(requestedRoot);
  if(root!==requestedRoot)throw Error('Native inventory root must be canonical without symlink parents');
  const inventory=fs.lstatSync(root);
  const native=contained(root,roots[0],{directory:true}),config=configIdentity(root,configs[0]);
  const files=listFiles(root);
  if(!files.includes(config.relative)||!files.some(file=>!native.relative||file.startsWith(native.relative+'/')))throw Error('Native workspace root/config is outside the observed inventory');
  return {schemaVersion:1,inventoryRoot:root,inventoryIdentity:{dev:String(inventory.dev),ino:String(inventory.ino)},cwd:root,nativeRoot:native.absolute,rootIdentity:{dev:native.dev,ino:native.ino},configFile:config.absolute,configIdentity:{dev:config.dev,ino:config.ino,sha256:config.sha256}};
}
export function assertVitestWorkspaceRoot(expected,current){
  if(JSON.stringify(expected)!==JSON.stringify(current))throw Error('Native workspace root/config binding changed');
}
