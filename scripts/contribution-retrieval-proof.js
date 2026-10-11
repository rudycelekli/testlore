// Offline hypothesis retrieval qualification. Queries and relevance labels
// are authored evaluation inputs; neither fixes nor model quality are tested.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {digest} from '../src/provenance.js';
import {safePath} from '../src/files.js';
import {recallContributionKnowledge} from '../src/contribution-knowledge.js';

const INDEX='.tddswarm/learning/contributions/index.json',MAX_INDEX=8*1024*1024;
const families=['filesystem-boundary','unicode-boundary','async-lifecycle','configuration-resolution','protocol-validation','resource-bounds','test-evidence','authorization-boundary'];
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const repository=value=>typeof value==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9-]{0,38}\/[a-zA-Z0-9_.-]{1,100}$/.test(value);
const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
function boundedRead(root,name,max){
 const file=safePath(root,name),fd=fs.openSync(file,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0)|(fs.constants.O_NONBLOCK||0));
 try{const before=fs.fstatSync(fd);assert.ok(before.isFile()&&before.size<=max,'Bounded regular evidence file required');const buffer=Buffer.alloc(before.size+1);let size=0;for(let count;size<buffer.length&&(count=fs.readSync(fd,buffer,size,buffer.length-size,null));)size+=count;const after=fs.fstatSync(fd),named=fs.lstatSync(safePath(root,name));assert.ok(size===before.size&&after.size===before.size&&after.mtimeMs===before.mtimeMs&&after.ctimeMs===before.ctimeMs&&!named.isSymbolicLink()&&named.ino===before.ino&&named.dev===before.dev,'Evidence changed while reading');return buffer.subarray(0,size);}finally{fs.closeSync(fd);}
}
function validateCases(cases){
 assert.ok(Array.isArray(cases)&&cases.length>=3&&cases.length<=100,'Expected 3–100 bounded held-out queries');
 const ids=new Set();
 for(const item of cases){
  assert.ok(plain(item)&&Object.keys(item).every(key=>['id','repository','query','contract','expectedPatternIds','novelPatternFamilies'].includes(key)),'Only independent contract/query labels are allowed; no target PR, patch or specification payload');
  assert.ok(typeof item.id==='string'&&/^[a-zA-Z0-9_-]{1,100}$/.test(item.id)&&!ids.has(item.id));ids.add(item.id);
  assert.ok(repository(item.repository));
  for(const [key,max] of [['query',4096],['contract',16000]])assert.ok(typeof item[key]==='string'&&item[key].trim()&&Buffer.byteLength(item[key])<=max);
  for(const key of ['expectedPatternIds','novelPatternFamilies'])assert.ok(Array.isArray(item[key]??[])&&(item[key]??[]).every(id=>families.includes(id))&&new Set(item[key]??[]).size===(item[key]??[]).length);
  assert.ok(Array.isArray(item.expectedPatternIds));assert.ok(!(item.novelPatternFamilies??[]).some(id=>item.expectedPatternIds.includes(id)),'Held-out families have no positive training label');
 }
 assert.ok(cases.some(item=>item.expectedPatternIds.length),'Need a positive relevance query');assert.ok(cases.some(item=>!item.expectedPatternIds.length),'Need an abstention counterexample');
 assert.ok(cases.some(item=>(item.novelPatternFamilies??[]).length),'Need a novel family counterexample');
 return [...new Set(cases.map(item=>item.repository.toLowerCase()))].sort();
}
function metrics(cases,rows){
 let returned=0,relevant=0,returnedRecords=0,relevantRecords=0,usefulCases=0,abstentions=0,correctAbstentions=0,falsePositiveCases=0,totalPayloadBytes=0,totalLookupMs=0;
 for(let index=0;index<cases.length;index++){
  const item=cases[index],row=rows[index],patterns=row.returnedPatternIds;
  returned+=patterns.length;const matches=patterns.filter(id=>item.expectedPatternIds.includes(id)).length;relevant+=matches;
  const records=row.returnedRecordCount??0,recordMatches=row.relevantRecordCount??0;returnedRecords+=records;relevantRecords+=recordMatches;
  if(matches)usefulCases++;if(!records){abstentions++;if(!item.expectedPatternIds.length)correctAbstentions++;}
  if(records>recordMatches||patterns.some(id=>!item.expectedPatternIds.includes(id)))falsePositiveCases++;
  totalPayloadBytes+=row.payloadBytes;totalLookupMs+=row.lookupMs;
 }
 return {cases:cases.length,positiveCases:cases.filter(item=>item.expectedPatternIds.length).length,negativeCases:cases.filter(item=>!item.expectedPatternIds.length).length,returnedPatterns:returned,relevantPatterns:relevant,returnedRecords,relevantRecords,recordPrecision:returnedRecords?relevantRecords/returnedRecords:null,usefulCases,precision:returned?relevant/returned:null,abstentions,correctAbstentions,falsePositiveCases,totalPayloadBytes,totalLookupMs:Math.round(totalLookupMs*1000)/1000};
}
function evaluate(cases,results,excluded){
 assert.equal(results.length,cases.length);const rows=[];
 for(let index=0;index<cases.length;index++){
  const item=cases[index],raw=results[index];assert.equal(raw.id,item.id);assert.ok(plain(raw.output)&&raw.output.advisoryOnly===true&&raw.output.authority==='none');
  assert.ok(Array.isArray(raw.output.records)&&raw.output.records.length<=3);assert.ok(Array.isArray(raw.output.patterns));
  assert.ok(Number.isFinite(raw.lookupMs)&&raw.lookupMs>=0);assert.equal(raw.payloadBytes,Buffer.byteLength(JSON.stringify(raw.output)));assert.ok(raw.payloadBytes<=6000);
  assert.ok(raw.output.records.every(record=>repository(record.repository)&&!excluded.includes(record.repository.toLowerCase())&&record.verifiedDefectFix==='unknown'&&typeof record.url==='string'&&record.url.startsWith(`https://github.com/${record.repository}/pull/`)),'Held-out target repository leaked into retrieval');
  const returnedPatternIds=raw.output.patterns.map(pattern=>pattern.id);assert.ok(returnedPatternIds.every(id=>families.includes(id))&&new Set(returnedPatternIds).size===returnedPatternIds.length);
  assert.ok(!(item.novelPatternFamilies??[]).some(id=>returnedPatternIds.includes(id)),'Held-out family leaked into retrieval');
  rows.push({id:item.id,returnedPatternIds,returnedRecordCount:raw.output.records.length,relevantRecordCount:raw.output.records.filter(record=>record.patternIds?.some(id=>item.expectedPatternIds.includes(id))).length,payloadBytes:raw.payloadBytes,lookupMs:raw.lookupMs});
 }
 return rows;
}

export function contributionRetrievalProof({root,cases,evidenceDirectory}){
 const excludedRepositories=validateCases(cases),rawIndex=boundedRead(root,INDEX,MAX_INDEX),corpus=JSON.parse(rawIndex);
 assert.ok(Array.isArray(corpus.records));
 const withheldFamilies=[...new Set(cases.flatMap(item=>item.novelPatternFamilies??[]))].sort();
 assert.ok(!corpus.records.some(record=>record.patternIds.some(id=>withheldFamilies.includes(id))),'Novel pattern families must be absent from the frozen corpus');
 const results=cases.map(item=>{
  const started=performance.now(),output=recallContributionKnowledge(root,item.query,{contract:item.contract,limit:3,maxChars:6000,excludeRepositories:excludedRepositories}),lookupMs=Math.round((performance.now()-started)*1000)/1000;
  return {id:item.id,output,lookupMs,payloadBytes:Buffer.byteLength(JSON.stringify(output))};
 });
 assert.equal(digest(boundedRead(root,INDEX,MAX_INDEX)),digest(rawIndex),'Corpus changed during evaluation');
 const rows=evaluate(cases,results,excludedRepositories),emptyRows=cases.map(item=>({id:item.id,returnedPatternIds:[],payloadBytes:0,lookupMs:0}));
 const rawFiles={'index.json':rawIndex,'cases.json':Buffer.from(JSON.stringify(cases)),'results.json':Buffer.from(JSON.stringify(results))};
 fs.mkdirSync(evidenceDirectory,{recursive:true,mode:0o700});
 const rawEvidence=Object.entries(rawFiles).map(([file,bytes])=>{fs.writeFileSync(path.join(evidenceDirectory,file),bytes,{flag:'wx',mode:0o600});return {file,bytes:bytes.length,sha256:digest(bytes)};});
 const proof={schemaVersion:1,kind:'offline-public-contribution-retrieval',queriesOrigin:'newly-authored-contract-queries-and-relevance-labels',sourceIndexSha256:digest(rawIndex),proofScriptSha256:digest(fs.readFileSync(fileURLToPath(import.meta.url))),retrievalModuleSha256:digest(fs.readFileSync(new URL('../src/contribution-knowledge.js',import.meta.url))),environment:{node:process.version,platform:process.platform,architecture:process.arch},
  corpusRecords:corpus.records.length,excludedRepositories,withheldFamilies,budget:{lookupsPerQuery:1,maxRecords:3,maxPayloadBytes:6000,maxQueryBytes:4096,maxContractBytes:16000,providerCalls:0,networkRequests:0},
  noMemory:metrics(cases,emptyRows),retrieval:metrics(cases,rows),rawEvidence,advisoryOnly:true,fixQualityMeasured:false,learningPromoted:false,
  limitations:['Constructed contract queries and human-authored relevance labels measure metadata lookup usefulness only.','No target PR body, patch or exact fix is supplied to retrieval. All evaluation repositories are withheld before ranking.','Novel pattern families are absent from the frozen corpus and tested only for abstention.','No generated repair, bug detection, model tokens or provider cost is evaluated. Empty no-memory lookup is a descriptive baseline, not evidence of improved agent outcomes.','Public PR metadata and merge outcomes do not establish genuine fixes or causal transfer.']};
 verifyContributionRetrievalEvidence(evidenceDirectory,proof);return proof;
}

export function verifyContributionRetrievalEvidence(directory,proof){
 assert.ok(plain(proof)&&proof.schemaVersion===1&&proof.kind==='offline-public-contribution-retrieval'&&proof.advisoryOnly===true&&proof.fixQualityMeasured===false&&proof.learningPromoted===false);
 assert.ok(hash(proof.sourceIndexSha256)&&hash(proof.proofScriptSha256));assert.equal(proof.proofScriptSha256,digest(fs.readFileSync(fileURLToPath(import.meta.url))));
 assert.ok(hash(proof.retrievalModuleSha256));assert.equal(proof.retrievalModuleSha256,digest(fs.readFileSync(new URL('../src/contribution-knowledge.js',import.meta.url))));
 assert.ok(plain(proof.environment)&&['node','platform','architecture'].every(key=>typeof proof.environment[key]==='string'&&proof.environment[key].length>0&&proof.environment[key].length<=64));
 assert.deepEqual(proof.budget,{lookupsPerQuery:1,maxRecords:3,maxPayloadBytes:6000,maxQueryBytes:4096,maxContractBytes:16000,providerCalls:0,networkRequests:0});
 assert.ok(Array.isArray(proof.rawEvidence)&&proof.rawEvidence.length===3&&new Set(proof.rawEvidence.map(item=>item.file)).size===3);
 const bytes={};for(const item of proof.rawEvidence){assert.ok(['index.json','cases.json','results.json'].includes(item.file)&&hash(item.sha256)&&Number.isSafeInteger(item.bytes)&&item.bytes>=0&&item.bytes<=MAX_INDEX);const raw=boundedRead(directory,item.file,MAX_INDEX);assert.equal(raw.length,item.bytes);assert.equal(digest(raw),item.sha256);bytes[item.file]=raw;}
 assert.equal(digest(bytes['index.json']),proof.sourceIndexSha256);const corpus=JSON.parse(bytes['index.json']),cases=JSON.parse(bytes['cases.json']),results=JSON.parse(bytes['results.json']);
 const excluded=validateCases(cases);assert.deepEqual(proof.excludedRepositories,excluded);assert.equal(proof.corpusRecords,corpus.records.length);
 const withheld=[...new Set(cases.flatMap(item=>item.novelPatternFamilies??[]))].sort();assert.deepEqual(proof.withheldFamilies,withheld);assert.ok(!corpus.records.some(record=>record.patternIds.some(id=>withheld.includes(id))));
 const rows=evaluate(cases,results,excluded);assert.deepEqual(proof.retrieval,metrics(cases,rows));assert.deepEqual(proof.noMemory,metrics(cases,cases.map(item=>({id:item.id,returnedPatternIds:[],payloadBytes:0,lookupMs:0}))));
 const replayRoot=fs.mkdtempSync(path.join(os.tmpdir(),'testlore-contribution-replay-'));
 try{
  const destination=path.join(replayRoot,INDEX);fs.mkdirSync(path.dirname(destination),{recursive:true});fs.writeFileSync(destination,bytes['index.json'],{mode:0o600});
  for(let index=0;index<cases.length;index++){
   const item=cases[index],replayed=recallContributionKnowledge(replayRoot,item.query,{contract:item.contract,limit:3,maxChars:6000,excludeRepositories:excluded});
   assert.deepEqual(results[index].output,replayed,'Recorded retrieval does not match the frozen corpus and held-out contract');
  }
 }finally{fs.rmSync(replayRoot,{recursive:true,force:true});}
 return true;
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{const [root,casesFile,directory]=process.argv.slice(2);assert.ok(root&&casesFile&&directory,'Usage: node scripts/contribution-retrieval-proof.js ROOT CASES_JSON EVIDENCE_DIRECTORY');const cases=JSON.parse(fs.readFileSync(casesFile,'utf8'));const proof=contributionRetrievalProof({root:path.resolve(root),cases,evidenceDirectory:path.resolve(directory)});fs.writeFileSync(path.join(directory,'proof.json'),JSON.stringify(proof,null,2),{flag:'wx',mode:0o600});process.stdout.write(JSON.stringify(proof,null,2)+'\n');}catch(error){process.stderr.write(error.message+'\n');process.exitCode=1;}
}
