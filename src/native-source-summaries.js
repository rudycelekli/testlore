import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {safePath,SOURCE} from './files.js';
const require=createRequire(import.meta.url);
const parser=fileURLToPath(new URL('./source-analysis.cjs',import.meta.url));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
function identity(){return {node:process.version,parserSha256:hash(fs.readFileSync(parser)),typescriptPackageSha256:hash(fs.readFileSync(require.resolve('typescript/package.json'))),typescriptImplementationSha256:hash(fs.readFileSync(require.resolve('typescript')))};}

/** Pure, bounded syntax observations generated only by the live controller. */
export function prepareNativeSourceSummaries(root,files){
 const sources=files.filter(file=>SOURCE.test(file));
 if(sources.length>10000)return {used:false,reason:'source-count-budget'};
 const records={};let sourceBytes=0,recordBytes=0,imports=0;
 const {analyze,configurationFlags}=require(parser);
 for(const file of sources){
  const full=safePath(root,file),size=fs.statSync(full).size;
  if(size>8*1024*1024||sourceBytes+size>32*1024*1024)return {used:false,reason:'source-byte-budget'};
  const bytes=fs.readFileSync(full);sourceBytes+=bytes.length;
  if(bytes.length>8*1024*1024||sourceBytes>32*1024*1024)return {used:false,reason:'source-byte-budget'};
  const result=analyze(file,bytes.toString('utf8'));
  const record={sourceSha256:hash(bytes),imports:result.imports,...configurationFlags(result.ast)};
  imports+=result.imports.length;recordBytes+=Buffer.byteLength(JSON.stringify(record))+Buffer.byteLength(file)+8;
  if(imports>50000||recordBytes>8*1024*1024)return {used:false,reason:'syntax-summary-budget'};
  records[file]=record;
 }
 return {used:true,identity:identity(),records};
}

/** Every consumer re-reads source bytes; misses load the canonical parser fresh. */
export function nativeSourceSummaryReader(root,provided){
 const stats={supplied:provided?.used===true,identityMatched:false,validatedHits:0,freshParses:0,mismatches:0};
 if(stats.supplied){try{stats.identityMatched=JSON.stringify(provided.identity)===JSON.stringify(identity());}catch{}}
 function read(file,bytes){
  const record=stats.identityMatched&&provided.records&&Object.hasOwn(provided.records,file)?provided.records[file]:undefined;
  if(record && /^[a-f0-9]{64}$/.test(record.sourceSha256) && Array.isArray(record.imports) && record.imports.length<=50000 && record.imports.every(value=>typeof value==='string') && typeof record.argvDependent==='boolean' && typeof record.projectPlugins==='boolean'){
   if(record.sourceSha256===hash(bytes)){stats.validatedHits++;return {...record,imports:[...record.imports]};}
   stats.mismatches++;
  }
  const {analyze,configurationFlags}=require(parser),parsed=analyze(file,bytes.toString('utf8'));
  stats.freshParses++;return {imports:parsed.imports,...configurationFlags(parsed.ast)};
 }
 return {read,stats};
}
