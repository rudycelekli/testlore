import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
/** A deliberately narrow, opt-in filesystem input profile, not a closed world assertion. */
export function validateConfigurationInputs(value){
 if(value===undefined)return [];
 if(!Array.isArray(value)||value.length>16)throw Error('configurationInputs must be an array of at most 16 exact inputs');
 const seen=new Set();
 return value.map(input=>{
  if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(key=>!['file','kind','sourceSha256'].includes(key))||input.kind!=='canonical-temp-directory'||typeof input.file!=='string'||!input.file||path.isAbsolute(input.file)||input.file.includes('\\')||input.file.includes('\0')||input.file.split('/').some(part=>!part||part==='.'||part==='..')||!/^vitest\.config\.[cm]?[jt]s$/.test(input.file)||!/^[a-f0-9]{64}$/.test(input.sourceSha256)||seen.has(input.file))throw Error('Invalid or duplicate configuration filesystem input');
  seen.add(input.file);return {...input};
 });
}
function sourceBytes(root,file){
 const target=path.join(root,file),fd=fs.openSync(target,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0));
 try{const stat=fs.fstatSync(fd);if(!stat.isFile()||stat.size>4*1024*1024)throw Error('Configuration source bound exceeded');const buffer=Buffer.alloc(stat.size+1);let length=0;for(let count;length<buffer.length&&(count=fs.readSync(fd,buffer,length,buffer.length-length,null));)length+=count;if(length!==stat.size)throw Error('Configuration source changed during read');return buffer.subarray(0,length);}finally{fs.closeSync(fd);}
}
/** Re-read this before planning and execution; no source, directory or environment caching. */
export function captureConfigurationInputs(root,config={}){
 const observations=[],warnings=[];
 for(const input of validateConfigurationInputs(config.configurationInputs)){
  try{
   const bytes=sourceBytes(root,input.file);if(sha(bytes)!==input.sourceSha256)throw Error('source-digest-mismatch');
   const env={...process.env,...config.env};
   // Node's POSIX os.tmpdir uses TMPDIR, TMP, TEMP, then /tmp. Windows is
   // intentionally outside this initial profile rather than guessed.
   if(process.platform==='win32')throw Error('unsupported-platform');
   const requested=env.TMPDIR||env.TMP||env.TEMP||'/tmp';
   if(!path.isAbsolute(requested))throw Error('temporary-directory-must-be-absolute');
   const canonicalDirectory=fs.realpathSync(requested),stat=fs.statSync(canonicalDirectory);
   if(!stat.isDirectory())throw Error('temporary-input-is-not-directory');
   observations.push({...input,requestedDirectory:requested,canonicalDirectory,device:String(stat.dev),inode:String(stat.ino),node:process.version,platform:os.platform(),environment:{TMPDIR:env.TMPDIR??null,TMP:env.TMP??null,TEMP:env.TEMP??null}});
  }catch(error){warnings.push({file:input.file,reason:'configuration-input-unavailable',detail:error.message});}
 }
 return {schemaVersion:1,profile:'exact-canonical-temp-directory',observations,warnings};
}
/** The declaration's only filesystem operation must be realpathSync(tmpdir()). */
export function admitsCanonicalTempDirectory(ast,ts){
 let fsImport=null,tmpImport=null,fsCalls=0,valid=!ast.parseDiagnostics.length;
 const imported=new Set(),allowedRealpath=new Set(),allowedTmp=new Set();
 for(const stmt of ast.statements){
  if(!ts.isImportDeclaration(stmt)||!ts.isStringLiteral(stmt.moduleSpecifier))continue;
  const module=stmt.moduleSpecifier.text,bindings=stmt.importClause?.namedBindings;
  if(/^(?:node:)?(?:fs|fs\/promises|vm|child_process|module|worker_threads|http|https|http2|net|tls|dns|dns\/promises|dgram|wasi)$/.test(module)&&module!=='node:fs')valid=false;
  if(module==='node:fs'){
   if(fsImport||stmt.importClause?.name||!bindings||!ts.isNamedImports(bindings)||bindings.elements.length!==1)valid=false;
   else {const item=bindings.elements[0];if(item.propertyName||item.name.text!=='realpathSync'||item.isTypeOnly)valid=false;fsImport=item.name;allowedRealpath.add(item.name);}
  }
  if(module==='node:os'&&bindings&&ts.isNamedImports(bindings))for(const item of bindings.elements)if(item.name.text==='tmpdir'){if(tmpImport||item.propertyName||item.isTypeOnly)valid=false;tmpImport=item.name;allowedTmp.add(item.name);}
  imported.add(module);
 }
 function visit(node){
  if(ts.isCallExpression(node)){
   const name=node.expression.getText(ast);
   if(name==='realpathSync'){
    fsCalls++;allowedRealpath.add(node.expression);
    const arg=node.arguments[0],parent=node.parent;
    if(node.questionDotToken||node.arguments.length!==1||!ts.isCallExpression(arg)||arg.questionDotToken||arg.arguments.length||!ts.isIdentifier(arg.expression)||arg.expression.text!=='tmpdir'||!ts.isVariableDeclaration(parent)||parent.initializer!==node||!ts.isIdentifier(parent.name)||!ts.isVariableDeclarationList(parent.parent)||!(parent.parent.flags&ts.NodeFlags.Const)||!ts.isVariableStatement(parent.parent.parent)||parent.parent.parent.parent!==ast)valid=false;
   }
   if(name==='tmpdir'&&!node.questionDotToken&&!node.arguments.length)allowedTmp.add(node.expression);
   if(['eval','Function','require','require.resolve','import.meta.glob','import.meta.globEager','require.context'].includes(name)||node.expression.kind===ts.SyntaxKind.ImportKeyword||name==='fetch'||name.endsWith('.fetch')||name.endsWith('.register'))valid=false;
  }
  if(ts.isNewExpression(node)&&/(?:^|\.)(?:Function|Worker|SharedWorker|WebSocket|EventSource)$/.test(node.expression.getText(ast)))valid=false;
  if(ts.isIdentifier(node)){
   if(node.text==='realpathSync'&&!allowedRealpath.has(node))valid=false;
   if(node.text==='tmpdir'&&!allowedTmp.has(node))valid=false;
   if(['prototype','defineProperty','defineProperties','Reflect','eval','Function'].includes(node.text))valid=false;
  }
  ts.forEachChild(node,visit);
 }
 visit(ast);return Boolean(valid&&fsImport&&tmpImport&&fsCalls===1);
}

/** Permit only the observed config's TMPDIR canonicalization, never changed inputs. */
export function assertConfigurationInputFreshness(expected,current,{allowCanonicalTmpdir=false}={}){
 if(expected?.schemaVersion!==1||current?.schemaVersion!==1||expected.profile!==current.profile||!Array.isArray(expected.observations)||!Array.isArray(current.observations)||!Array.isArray(expected.warnings)||!Array.isArray(current.warnings)||expected.warnings.length||current.warnings.length||expected.observations.length!==current.observations.length)throw Error('Configuration filesystem inputs unavailable or changed');
 const normalized=current.observations.map((value,index)=>{
  const prior=expected.observations[index];
  if(allowCanonicalTmpdir&&value.requestedDirectory===prior.canonicalDirectory&&value.environment?.TMPDIR===prior.canonicalDirectory)return {...value,requestedDirectory:prior.requestedDirectory,environment:{...value.environment,TMPDIR:prior.environment?.TMPDIR??null}};
  return value;
 });
 if(JSON.stringify(expected.observations)!==JSON.stringify(normalized))throw Error('Configuration filesystem inputs changed');
 return true;
}
