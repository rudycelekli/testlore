import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';

// Metadata is never permission to follow a link into verified source. This is
// an atomic local writer, not an OS sandbox against concurrent hostile actors.
function ancestors(root,target,{create=false}={}){
 const rows=[];let current=root;
 const rootStat=fs.lstatSync(root);
 if(!rootStat.isDirectory()||rootStat.isSymbolicLink())throw Error('Receipt root must be a real directory');
 rows.push([root,rootStat.dev,rootStat.ino]);
 for(const part of path.relative(root,path.dirname(target)).split(path.sep).filter(Boolean)){
  current=path.join(current,part);
  let stat;try{stat=fs.lstatSync(current);}catch(error){if(error.code!=='ENOENT'||!create)throw error;fs.mkdirSync(current,{mode:0o700});stat=fs.lstatSync(current);}
  if(!stat.isDirectory()||stat.isSymbolicLink())throw Error('Receipt ancestors must be real directories');
  rows.push([current,stat.dev,stat.ino]);
 }
 return rows;
}
function leaf(target){
 try{const stat=fs.lstatSync(target);if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1)throw Error('Receipt must be an unlinked regular file');return [stat.dev,stat.ino,stat.size,stat.mtimeMs,stat.ctimeMs];}
 catch(error){if(error.code==='ENOENT')return null;throw error;}
}
function identical(left,right){return JSON.stringify(left)===JSON.stringify(right);}
export function writeResultReceipt(root,result,relative){
 const declaredRoot=path.resolve(root);root=fs.realpathSync(declaredRoot);
 const lexical=relative??path.relative(declaredRoot,path.resolve(result.receipt||''));
 const declared=relative??(lexical.startsWith('.tddswarm/')?lexical:path.relative(root,path.resolve(result.receipt||'')));
 if(typeof declared!=='string'||/[\x00-\x1f\x7f\\]/.test(declared)||!declared.startsWith('.tddswarm/')||declared.split('/').some(part=>!part||part==='.'||part==='..')||!declared.endsWith('.json')||declared.length>1024)throw Error('Receipt must identify a bounded local metadata JSON path');
 const target=path.join(root,declared),chain=ancestors(root,target,{create:true}),previous=leaf(target);
 const bytes=JSON.stringify({...result,receipt:target},null,2)+'\n';
 if(Buffer.byteLength(bytes)>32*1024*1024)throw Error('Receipt exceeds the 32 MiB bound');
 const temporary=path.join(path.dirname(target),`.result-${randomUUID()}.tmp`);let fd;
 try{
  fd=fs.openSync(temporary,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);
  const stat=fs.fstatSync(fd);if(!stat.isFile()||stat.nlink!==1)throw Error('Receipt temporary must be an unlinked regular file');
  fs.writeFileSync(fd,bytes);fs.closeSync(fd);fd=undefined;
  if(!identical(chain,ancestors(root,target))||!identical(previous,leaf(target)))throw Error('Receipt path changed during storage');
  const named=fs.lstatSync(temporary);if(!named.isFile()||named.nlink!==1||named.dev!==stat.dev||named.ino!==stat.ino)throw Error('Receipt temporary changed during storage');
  fs.renameSync(temporary,target);result.receipt=target;return result;
 }finally{if(fd!==undefined)fs.closeSync(fd);fs.rmSync(temporary,{force:true});}
}
export function persistResultReceipt(root,result,relative){
 try{return writeResultReceipt(root,result,relative);}
 catch{
  // Keep actual publication facts: storage failure does not undo a created PR.
  result.status='receipt-failed';result.receipt=null;result.receiptError='Result receipt could not be stored safely; inspect metadata links and retain the returned result before retrying.';
  result.error=result.receiptError;result.nextAction=result.receiptError;result.exitCode=2;result.qualityReady=false;result.typecheckVerified=false;return result;
 }
}
