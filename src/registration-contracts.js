import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
const {analyze}=createRequire(import.meta.url)('./source-analysis.cjs');
const hash=value=>createHash('sha256').update(value).digest('hex');
const sourceHash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const exactPath=value=>typeof value==='string'&&value.length<=4096&&value.length>0&&!value.includes('\\')&&!value.startsWith('/')&&!value.split('/').some(part=>!part||part==='.'||part==='..'||['.git','node_modules','.tddswarm'].includes(part))&&!/[\x00-\x1f\x7f:*?]/.test(value);
const onlyKeys=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).every(key=>keys.includes(key));

/** Review records are bounded evidence inputs, never an omission permission. */
export function validateRegistrationContracts(value=[]) {
 if(!Array.isArray(value)||value.length>32)throw new Error('Invalid registration contract list');
 const ids=new Set();
 for(const record of value){
  if(!onlyKeys(record,['id','calls','stateOwners','consumers','consumerSourceHashes','review','closedWorld'])||typeof record.id!=='string'||!/^[-A-Za-z0-9_]{1,128}$/.test(record.id)||ids.has(record.id)||record.closedWorld!==false)throw new Error('Invalid registration contract record');
  ids.add(record.id);
  for(const key of ['calls','stateOwners']){
   if(!Array.isArray(record[key])||record[key].length<1||record[key].length>256)throw new Error(`Invalid registration ${key}`);
   const seen=new Set();
   for(const source of record[key]){
    if(!onlyKeys(source,['file','sourceSha256'])||!exactPath(source.file)||!sourceHash(source.sourceSha256)||seen.has(source.file))throw new Error(`Invalid registration ${key} binding`);
    seen.add(source.file);
   }
  }
  if(!Array.isArray(record.consumers)||record.consumers.length<1||record.consumers.length>10000||record.consumers.some(file=>!exactPath(file))||new Set(record.consumers).size!==record.consumers.length||!onlyKeys(record.consumerSourceHashes,record.consumers)||Object.keys(record.consumerSourceHashes).length!==record.consumers.length||record.consumers.some(file=>!sourceHash(record.consumerSourceHashes[file])))throw new Error('Invalid registration consumer bindings');
  if(!onlyKeys(record.review,['status','rationale'])||!['pending','approved'].includes(record.review.status)||typeof record.review.rationale!=='string'||record.review.rationale.trim().length<1||record.review.rationale.length>4096)throw new Error('Invalid registration review');
 }
 return {records:value,omissionAuthority:false,requiresIndependentQualification:true};
}

/** Known import consumers are a starting point; shared state can escape them. */
export function proposeRegistrationContracts(graph) {
 const files=[...new Set((graph.warnings||[]).filter(warning=>warning.reason==='runtime-registration').map(warning=>warning.file))].sort();
 if(files.length>32)return {proposals:[],omissionAuthority:false,reason:'registration-proposal-budget'};
 const proposals=[];
 for(const file of files){
  const source=graph.sources?.[file];
  if(!exactPath(file)||typeof source!=='string'){proposals.push({file,status:'source-unavailable',omissionAuthority:false});continue;}
  const parsed=analyze(file,source),calls=parsed.registrationCalls;
  if(calls.length>256){proposals.push({file,status:'registration-call-budget',omissionAuthority:false});continue;}
  const knownConsumers=[];
  for(const test of graph.tests||[]){
   const seen=new Set(),queue=[test];
   for(let index=0;index<queue.length;index++){
    const item=queue[index];if(seen.has(item))continue;seen.add(item);
    for(const dependency of graph.edges?.[item]||[])if(!seen.has(dependency))queue.push(dependency);
   }
   if(seen.has(file))knownConsumers.push(test);
  }
  proposals.push({file,sourceSha256:hash(source),calls,knownConsumers:knownConsumers.sort(),status:'needs-state-owner-and-consumer-review',requiredEvidence:['implementation-and-state-owner-source-bindings','complete-shared-state-consumer-contract','independent-full-and-subset-regression-challenges','fresh-contract-and-producer-binding'],omissionAuthority:false});
 }
 return {proposals,omissionAuthority:false,reason:'review-and-independent-qualification-required'};
}
