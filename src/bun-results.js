import fs from 'node:fs';
import path from 'node:path';
import {TextDecoder} from 'node:util';
import {safePath,normalize} from './files.js';

const LIMIT=32*1024*1024;
const utf8=new TextDecoder('utf-8',{fatal:true});
/** Bun's terminal JUnit file, never a console log, is the outcome transport. */
export function readBunReport(file) {
 const fd=fs.openSync(file,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0)|(fs.constants.O_NONBLOCK||0));
 try {
  const before=fs.fstatSync(fd);
  if(!before.isFile()||before.size<1||before.size>LIMIT)throw new Error('Nonregular or oversized Bun report');
  const bytes=Buffer.alloc(before.size);let offset=0;
  while(offset<bytes.length){const count=fs.readSync(fd,bytes,offset,bytes.length-offset,null);if(!count)throw new Error('Truncated Bun report');offset+=count;}
  const after=fs.fstatSync(fd),named=fs.lstatSync(file);
  if(!named.isFile()||before.ino!==named.ino||before.dev!==named.dev||before.size!==after.size||before.mtimeMs!==after.mtimeMs||before.ctimeMs!==after.ctimeMs)throw new Error('Bun report changed during read');
  return utf8.decode(bytes);
 }finally{fs.closeSync(fd);}
}
function decode(value) {
 if(/&(?![^&;]+;)/.test(value))throw new Error('Unescaped XML entity');
 return value.replace(/&([^;]+);/g,(_,entity)=>{
  const known={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"};if(Object.hasOwn(known,entity))return known[entity];
  const match=/^#(x[0-9a-fA-F]+|\d+)$/.exec(entity);if(!match)throw new Error('Unsupported XML entity');
  const n=match[1][0]==='x'?parseInt(match[1].slice(1),16):Number(match[1]);
  if(!Number.isInteger(n)||n<1||n>0x10ffff||(n>=0xd800&&n<=0xdfff))throw new Error('Invalid XML code point');return String.fromCodePoint(n);
 });
}
/** Strict, bounded subset of XML emitted by Bun 1.4.2, including nested suites. */
export function bunResults(root,text,{exitCode}={}) {
 if(typeof text!=='string'||Buffer.byteLength(text)>LIMIT||/<!|<\?(?!xml\s)/.test(text))throw new Error('Unsupported Bun XML document');
 const stack=[],tests=[],collection=new Set(),seen=new Set();let document=null,offset=0,nodes=0;
 const token=/<\?xml[^?]*\?>|<[^>]*>/g;
 for(const match of text.matchAll(token)) {
  if(text.slice(offset,match.index).trim()&& !['failure','error'].includes(stack.at(-1)?.tag))throw new Error('Unexpected Bun XML text');
  offset=match.index+match[0].length;
  if(match[0].startsWith('<?')){if(document||stack.length)throw new Error('Misplaced XML declaration');continue;}
  if(++nodes>200000||stack.length>128)throw new Error('Bun XML exceeds structural bounds');
  const end=/^<\/([a-zA-Z]+)\s*>$/.exec(match[0]);
  if(end){const node=stack.pop();if(!node||node.tag!==end[1])throw new Error('Mismatched Bun XML closing tag');finish(node);continue;}
  const start=/^<([a-zA-Z]+)([\s\S]*?)(\/?)>$/.exec(match[0]);if(!start)throw new Error('Malformed Bun XML tag');
  const attrs={};let rest=start[2];
  while(rest.trim()) {const attr=/^\s+([a-zA-Z][\w:-]*)="([^"<]*)"/.exec(rest);if(!attr||Object.hasOwn(attrs,attr[1]))throw new Error('Malformed or duplicate XML attribute');attrs[attr[1]]=decode(attr[2]);rest=rest.slice(attr[0].length);}
  const tag=start[1],parent=stack.at(-1);
  const allowed={testsuites:[],testsuite:['testsuites','testsuite'],testcase:['testsuite'],failure:['testcase'],error:['testcase'],skipped:['testcase'],properties:['testsuites','testsuite'],property:['properties']};
  if(!Object.hasOwn(allowed,tag)|| (tag==='testsuites'?(document||parent):!allowed[tag].includes(parent?.tag)))throw new Error('Unsupported Bun XML nesting');
  const node={tag,attrs,counts:{tests:0,failures:0,skipped:0},parent,outcomes:[]};
  if(tag==='testsuites'){document=node;if(attrs.name!=='bun test')throw new Error('Report is not a Bun test document');}
  if(tag==='testsuite'){const file=local(attrs.file);collection.add(file);node.file=file;}
  if(tag==='testcase'){
   if(typeof attrs.name!=='string'||!attrs.name||typeof attrs.classname!=='string')throw new Error('Missing Bun case identity');
   node.file=local(attrs.file);if(node.file!==parent.file)throw new Error('Bun case file differs from parent suite');
   if(!/^\d+$/.test(attrs.line||'')||Number(attrs.line)<1)throw new Error('Missing Bun source line');
   node.name=JSON.stringify({classname:attrs.classname,title:attrs.name});
   const key=JSON.stringify([node.file,node.name,Number(attrs.line)]);if(seen.has(key))throw new Error('Ambiguous duplicate Bun case identity');seen.add(key);
  }
  if(start[3])finish(node);else stack.push(node);
 }
 if(stack.length||!document||text.slice(offset).trim())throw new Error('Truncated or missing terminal Bun report');
 if(!tests.length)throw new Error('Empty Bun case inventory');
 const failed=tests.some(t=>t.status==='failed');
 if(exitCode!==undefined&&(![0,1].includes(exitCode)||(exitCode===0&&failed)||(exitCode===1&&!failed)))throw new Error('Bun process status contradicts named outcomes');
 return {tests,collectionFiles:[...collection].sort(),valid:true,errors:[],nativeStatus:failed?'failed':'passed'};
 function local(file){if(typeof file!=='string'||!file)throw new Error('Missing Bun file identity');const relative=normalize(path.isAbsolute(file)?path.relative(root,file):file);safePath(root,relative);return relative;}
 function finish(node){
  if(['failure','error','skipped'].includes(node.tag)){node.parent.outcomes.push(node.tag);return;}
  if(node.tag==='testcase'){
   if(node.outcomes.length>1)throw new Error('Conflicting Bun case outcomes');
   const status=node.outcomes[0]==='skipped'?'skipped':node.outcomes.length?'failed':'passed';
   const seconds=node.attrs.time===undefined?0:Number(node.attrs.time);if(!Number.isFinite(seconds)||seconds<0)throw new Error('Invalid Bun duration');
   tests.push({file:node.file,name:node.name,title:node.attrs.name,classname:node.attrs.classname,line:Number(node.attrs.line),column:0,status,durationMs:seconds*1000});
   node.parent.counts.tests++;if(status==='failed')node.parent.counts.failures++;if(status==='skipped')node.parent.counts.skipped++;return;
  }
  if(['testsuite','testsuites'].includes(node.tag)){
   for(const key of ['tests','failures','skipped'])if(!/^\d+$/.test(node.attrs[key]||'')||Number(node.attrs[key])!==node.counts[key])throw new Error(`Bun ${key} count does not match named outcomes`);
   if(node.parent)for(const key of ['tests','failures','skipped'])node.parent.counts[key]+=node.counts[key];
  }
 }
}

export function bunCommand(base,reportFile,files,{scope=[]}={}) {
 if(!Array.isArray(files)||!Array.isArray(scope)||scope.length>128)throw new Error('Bun scope must be a bounded array');
 if(!Array.isArray(base)||base.length<2||!/(?:^|[/\\])bun(?:\.exe)?$/.test(base[0])||base[1]!=='test')throw new Error('Bun adapter requires direct bun test invocation');
 const command=base.slice(0,2);
 for(let i=2;i<base.length;i++){
  const arg=base[i];if(arg==='{files}')continue;
  if(arg==='--timeout'){const value=base[++i];if(!/^\d+$/.test(value||''))throw new Error('Invalid Bun timeout');command.push(arg,value);}
  else if(/^--timeout=\d+$/.test(arg)||arg==='--smol')command.push(arg);
  else throw new Error(`Unqualified Bun scope/execution option: ${arg}`);
 }
 command.push('--reporter=junit',`--reporter-outfile=${reportFile}`);
 for(const file of files.length?files:scope){if(typeof file!=='string'||!file||file.startsWith('-')||path.isAbsolute(file)||file.split(/[\\/]/).includes('..'))throw new Error('Invalid Bun test path');command.push('./'+file.replace(/^\.\//,''));}
 return command;
}

/** A fault campaign must start from a genuinely green original oracle scope. */
export function bunBaselineAdmission(value,{requiredFile,requiredTitleContains}={}) {
 const reasons=[];
 if(value?.complete!==true)reasons.push('native-baseline-incomplete');
 if(value?.exitCode!==0)reasons.push('native-baseline-not-green');
 if(value?.signal||value?.error)reasons.push('native-baseline-process-or-report-error');
 const tests=Array.isArray(value?.tests)?value.tests:[];
 if(!tests.length)reasons.push('native-baseline-empty');
 if(!tests.some(test=>test?.status==='passed'))reasons.push('native-baseline-no-passing-cases');
 if(tests.some(test=>!test||typeof test.file!=='string'||typeof test.name!=='string'||!test.name||!Number.isInteger(test.line)||test.line<1||!['passed','skipped'].includes(test.status)))reasons.push('native-baseline-case-invalid-or-failed');
 if(requiredFile){
  const target=tests.filter(test=>test?.file===requiredFile&&typeof test.title==='string'&&test.title.includes(requiredTitleContains));
  if(target.length!==1||target[0].status!=='passed')reasons.push('original-oracle-not-independently-passed');
 }
 return {admitted:reasons.length===0,reasons};
}

/** Reserve the entire worst-case trial plus restoration before changing source. */
export function bunTrialBudget(elapsedMs,{deadlineMs=36*60*1000,armTimeoutMs=180000,reportingReserveMs=60000}={}) {
 for(const n of [elapsedMs,deadlineMs,armTimeoutMs,reportingReserveMs])if(!Number.isFinite(n)||n<0)throw new Error('Invalid Bun campaign time budget');
 const remainingMs=Math.max(0,deadlineMs-elapsedMs),requiredMs=4*armTimeoutMs+reportingReserveMs;
 return {admitted:remainingMs>=requiredMs,remainingMs,requiredMs,reason:remainingMs>=requiredMs?null:'insufficient-complete-trial-and-restoration-budget'};
}
