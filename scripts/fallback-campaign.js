#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {readBoundedJson} from './evaluation-commitment.js';
import {diagnoseFallbackSelection} from '../src/fallback-diagnostics.js';
import {digest} from '../src/provenance.js';

/** Read retained receipts, never project configuration or test runners. Raw paths remain in the private output. */
export function fallbackCampaign(receipts,output){
  receipts=path.resolve(receipts);output=path.resolve(output);
  if(!fs.lstatSync(receipts).isDirectory()||fs.lstatSync(receipts).isSymbolicLink())throw new Error('Receipt root must be a regular directory');
  if(output===receipts||output.startsWith(receipts+path.sep))throw new Error('Campaign output must be outside retained receipts');
  const files=[];let entries=0;
  function walk(directory,depth=0){if(depth>5)throw new Error('Receipt directory depth exceeded');for(const entry of fs.readdirSync(directory,{withFileTypes:true})){
    if(++entries>10000)throw new Error('Receipt directory entry bound exceeded');const filename=path.join(directory,entry.name);
    if(entry.isSymbolicLink())throw new Error('Receipt symlinks are unsupported');if(entry.isDirectory()){if(entry.name==='workspace'||entry.name==='node_modules'||entry.name.startsWith('.'))continue;walk(filename,depth+1);}else if(entry.isFile()&&/-plan\.json$/.test(entry.name)){files.push(filename);if(files.length>1000)throw new Error('Receipt plan count exceeded');}
  }}walk(receipts);files.sort();if(!files.length)throw new Error('No retained plan receipts');
  // Validate every input before reserving the output directory. Never overwrite older attempts.
  const results=files.map(filename=>{const plan=readBoundedJson(filename,8*1024*1024);return {receipt:path.relative(receipts,filename).split(path.sep).join('/'),receiptHash:digest(plan),receiptHashScope:'parsed-json-content',diagnosis:diagnoseFallbackSelection(plan)};});
  fs.mkdirSync(output,{mode:0o700});
  const causes={},warnings={},categories={};let unmapped=0,omitted=0;
  for(let index=0;index<results.length;index++){
    const result=results[index];fs.writeFileSync(path.join(output,`diagnosis-${index}.json`),JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});
    for(const cause of result.diagnosis.causes){const key=['configuration','unmapped-input','deleted-or-untracked-input','global-uncertainty','discovery','service','policy','baseline'].includes(cause.kind)?cause.kind:'other-conservative-gate';causes[key]=(causes[key]||0)+1;}
    for(const warning of result.diagnosis.warnings){warnings[warning.scope]=(warnings[warning.scope]||0)+1;}
    for(const change of result.diagnosis.changes.filter(entry=>!entry.mapped)){unmapped++;categories[change.category]=(categories[change.category]||0)+1;}
    omitted+=result.diagnosis.omitted;
  }
  const summary={schemaVersion:1,type:'fallback-campaign-summary',plans:results.length,fullFallbackPlans:results.filter(entry=>entry.diagnosis.mode==='full').length,causeOccurrences:causes,warningOccurrences:warnings,unmappedChangeOccurrences:unmapped,unmappedCategories:categories,omittedTestOccurrences:omitted,freshnessVerified:false,sourceMutation:false,nativeExecution:false,reviewRequired:true,closedWorld:false,scope:'Retained plan explanations only; repeated plans count separately. No source freshness, failure recall, speed improvement, or contract completeness is inferred.'};
  fs.writeFileSync(path.join(output,'summary.json'),JSON.stringify(summary,null,2)+'\n',{flag:'wx',mode:0o600});return summary;
}
export function main(argv=process.argv.slice(2)){
  if(argv.length!==4||argv[0]!=='--receipts'||argv[2]!=='--output')throw new Error('Use --receipts retained-private-campaign --output new-private-directory');
  return fallbackCampaign(argv[1],argv[3]);
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){try{console.log(JSON.stringify(main(),null,2));}catch(error){console.error(error.message);process.exitCode=1;}}
