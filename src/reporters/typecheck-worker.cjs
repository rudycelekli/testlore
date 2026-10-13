'use strict';
const fs=require('node:fs'),path=require('node:path');
let output={schemaVersion:1,status:'incomplete',complete:false,files:[],diagnostics:[],compiler:{version:'unknown'},programFiles:[],implementationFiles:[],suppressions:[],limitations:[],errorCode:'typecheck-worker-incomplete'};
let deniedInput=null;
const fail=code=>{if(['typecheck-reserved-input','typecheck-external-closure'].includes(code))deniedInput=code;throw Object.assign(new Error(code),{code});};
try{
  const request=JSON.parse(fs.readFileSync(0,'utf8'));
  if(!request||typeof request.root!=='string'||typeof request.project!=='string'||typeof request.sdk!=='string')fail('typecheck-invalid-request');
  const root=fs.realpathSync(request.root),relative=file=>path.relative(root,fs.realpathSync(file)).split(path.sep).join('/');
  const local=file=>{const lexical=path.relative(root,path.resolve(file)).split(path.sep)[0];if(['.git','.tddswarm'].includes(lexical))fail('typecheck-reserved-input');const real=fs.realpathSync(file);if(real!==root&&!real.startsWith(root+path.sep))fail('typecheck-external-closure');if(['.git','.tddswarm'].includes(path.relative(root,real).split(path.sep)[0]))fail('typecheck-reserved-input');return real;};
  local(request.sdk);const ts=require(request.sdk);output.compiler.version=ts.version;
  if(ts.version!==request.version||typeof ts.createProgram!=='function'||typeof ts.getPreEmitDiagnostics!=='function')fail('typecheck-sdk-invalid');
  const readFile=file=>{if(!fs.existsSync(file))return undefined;return ts.sys.readFile(local(file));};
  const host={...ts.sys,readFile,readDirectory:(directory,...args)=>{local(directory);return ts.sys.readDirectory(directory,...args);}};
  const configFile=local(path.join(root,request.project)),read=ts.readConfigFile(configFile,readFile);
  if(deniedInput)fail(deniedInput);
  const diagnostic=d=>{if(!d||!Number.isSafeInteger(d.category)||d.category<0||d.category>3||!Number.isSafeInteger(d.code)||d.code<0)fail('typecheck-malformed-diagnostic');if(d.start!==undefined&&(!Number.isSafeInteger(d.start)||d.start<0||!d.file||d.start>d.file.text.length))fail('typecheck-malformed-diagnostic');let file=null,line=null,column=null;if(d.file){file=relative(d.file.fileName);if(d.start!==undefined){const pos=d.file.getLineAndCharacterOfPosition(d.start);line=pos.line+1;column=pos.character+1;}}return {code:d.code,category:['warning','error','suggestion','message'][d.category],file,line,column,message:ts.flattenDiagnosticMessageText(d.messageText,'\n').slice(0,4096)};};
  if(read.error){output.diagnostics=[diagnostic(read.error)];fail('typecheck-config-invalid');}
  const parsed=ts.parseJsonConfigFileContent(read.config,host,path.dirname(configFile),undefined,configFile);
  if(deniedInput)fail(deniedInput);
  if(parsed.errors.length){output.diagnostics=parsed.errors.map(diagnostic);fail('typecheck-config-invalid');}
  if(parsed.projectReferences?.length)fail('typecheck-project-references-unsupported');
  if(parsed.options.noCheck)fail('typecheck-no-check');
  if(parsed.options.composite)fail('typecheck-composite-unsupported');
  if(parsed.options.plugins?.length)fail('typecheck-plugins-unsupported');
  // Declaration-only/unchecked-JS scopes cannot establish implementation checking.
  const implementations=parsed.fileNames.filter(file=>! /\.d\.[cm]?ts$/i.test(file)&&(/\.[cm]?tsx?$/i.test(file)||(parsed.options.allowJs&&parsed.options.checkJs&&/\.[cm]?jsx?$/i.test(file))));
  if(!implementations.length)fail('typecheck-no-checked-inputs');
  parsed.fileNames.forEach(local);
  if(parsed.options.skipLibCheck)output.limitations.push('skipLibCheck preserves the owner setting: declaration diagnostics may be omitted.');
  if(parsed.options.skipDefaultLibCheck)output.limitations.push('skipDefaultLibCheck preserves the owner setting: default library diagnostics may be omitted.');
  if(parsed.options.allowJs&&!parsed.options.checkJs)output.limitations.push('JavaScript inputs are not type checked because checkJs is disabled.');
  output.limitations.push('Files excluded by the TypeScript project are outside this check.');
  const options={...parsed.options,noEmit:true,incremental:false,tsBuildInfoFile:undefined};
  const compilerHost=ts.createCompilerHost(options);compilerHost.readFile=readFile;compilerHost.writeFile=()=>fail('typecheck-unexpected-write');
  const program=ts.createProgram({rootNames:parsed.fileNames,options,host:compilerHost});
  if(deniedInput)fail(deniedInput);
  const sourceFiles=program.getSourceFiles();
  output.programFiles=sourceFiles.map(file=>relative(file.fileName)).sort();
  const implementationFiles=sourceFiles.filter(file=>!file.isDeclarationFile&&(file.scriptKind===ts.ScriptKind.TS||file.scriptKind===ts.ScriptKind.TSX||options.allowJs&&(options.checkJs||file.checkJsDirective?.enabled)&&[ts.ScriptKind.JS,ts.ScriptKind.JSX].includes(file.scriptKind)));
  for(const file of sourceFiles){
    const suppression=(kind,pos)=>{const location=file.getLineAndCharacterOfPosition(pos);output.suppressions.push({file:relative(file.fileName),directive:kind,line:location.line+1,column:location.character+1});};
    if(file.checkJsDirective?.enabled===false)suppression('ts-nocheck',file.checkJsDirective.pos);
    for(const comment of file.commentDirectives||[])suppression(comment.type===ts.CommentDirectiveType.ExpectError?'ts-expect-error':'ts-ignore',comment.range.pos);
  }
  output.files=implementationFiles.filter(file=>file.checkJsDirective?.enabled!==false).map(file=>relative(file.fileName)).sort();
  output.implementationFiles=[...output.files];
  if(!output.files.length)fail('typecheck-no-checked-inputs');
  if(implementationFiles.some(file=>file.checkJsDirective?.enabled===false))fail('typecheck-source-no-check');
  if(output.suppressions.length)output.limitations.push('Native source suppression directives are present; suppressed diagnostics are outside the reported type-error evidence.');
  const seen=new Set();output.diagnostics=ts.getPreEmitDiagnostics(program).map(diagnostic).filter(d=>{const key=JSON.stringify(d);if(seen.has(key))return false;seen.add(key);return true;});
  // Missing inputs/modules or config/global errors mean the declared closure is incomplete.
  if(output.diagnostics.some(d=>d.category==='error'&&(d.file===null||[2307,2688,6053,5083].includes(d.code))))fail('typecheck-input-closure-incomplete');
  output.complete=true;output.status=output.diagnostics.some(d=>d.category==='error')?'failed':'passed';delete output.errorCode;
}catch(error){output.status='incomplete';output.complete=false;output.errorCode=typeof error.code==='string'&&error.code.startsWith('typecheck-')?error.code:'typecheck-worker-incomplete';}
process.stdout.write(JSON.stringify(output));
