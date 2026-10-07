import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {safePath,SOURCE} from './files.js';
const require=createRequire(import.meta.url);
const parser=fileURLToPath(new URL('./syntax-engine.cjs',import.meta.url));
const {inspectEngine,assertEngineUnchanged}=require('./syntax-engine-identity.cjs');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');


/** Pure, bounded syntax observations generated only by the live controller. */
export function prepareNativeSourceSummaries(root,files){
 const sources=files.filter(file=>SOURCE.test(file));
 if(sources.length>10000)return {used:false,reason:'source-count-budget'};
 const records={};let sourceBytes=0,recordBytes=0,imports=0;
 const {analyze,configurationFlags,loadedIdentity,assertCurrentEngine,optimizationAvailable}=require(parser);
 if(!optimizationAvailable)return {used:false,reason:'unbound-cached-syntax-engine'};
 assertCurrentEngine();
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
 assertCurrentEngine();return {used:true,identity:loadedIdentity,records};
}

/** Every consumer re-reads source bytes; misses load the canonical parser fresh. */
export function nativeSourceSummaryReader(root,provided,{requireBoundEngine=true}={}){
 const binding=inspectEngine();
 const stats={supplied:provided?.used===true,identityMatched:false,validatedHits:0,freshParses:0,mismatches:0,unboundLegacyParses:0};
 if(stats.supplied){try{stats.identityMatched=JSON.stringify(provided.identity)===JSON.stringify(binding.identity);}catch{}}
 function read(file,bytes){
  assertEngineUnchanged(binding);
  const record=stats.identityMatched&&provided.records&&Object.hasOwn(provided.records,file)?provided.records[file]:undefined;
  if(record && /^[a-f0-9]{64}$/.test(record.sourceSha256) && Array.isArray(record.imports) && record.imports.length<=50000 && record.imports.every(value=>typeof value==='string') && typeof record.argvDependent==='boolean' && typeof record.projectPlugins==='boolean'){
   if(record.sourceSha256===hash(bytes)){assertEngineUnchanged(binding);stats.validatedHits++;return {...record,imports:[...record.imports]};}
   stats.mismatches++;
  }
  const {analyze,configurationFlags,assertCurrentEngine,optimizationAvailable}=require(parser);
  if(!optimizationAvailable&&requireBoundEngine)throw new Error('Canonical syntax engine is unbound for fresh native parsing');
  if(!optimizationAvailable)stats.unboundLegacyParses++;
  assertCurrentEngine();const parsed=analyze(file,bytes.toString('utf8'));
  assertEngineUnchanged(binding);
  stats.freshParses++;return {imports:parsed.imports,...configurationFlags(parsed.ast)};
 }
 return {read,stats};
}
