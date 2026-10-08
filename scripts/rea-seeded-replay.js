#!/usr/bin/env node
// Reassess frozen measurements; this command never runs upstream code.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {fileURLToPath} from 'node:url';
import {assessReaPilot,assessNodeOracle,REA_REVISION,REPLAY_SEEDS} from './rea-public-pilot.js';
const hash=value=>createHash('sha256').update(value).digest('hex');
const sha=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
function readBounded(file,limit){
 const fd=fs.openSync(file,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0)|(fs.constants.O_NONBLOCK||0));
 try{
  const before=fs.fstatSync(fd);if(!before.isFile()||before.size>limit)throw Error('Unbounded or nonregular frozen input');
  const bytes=Buffer.alloc(before.size);let offset=0;
  while(offset<bytes.length){const count=fs.readSync(fd,bytes,offset,bytes.length-offset,null);if(!count)throw Error('Frozen input truncated during read');offset+=count;}
  const after=fs.fstatSync(fd);if(before.size!==after.size||before.mtimeMs!==after.mtimeMs||before.ctimeMs!==after.ctimeMs)throw Error('Frozen input changed during read');return bytes;
 }finally{fs.closeSync(fd);}
}
export function verifySeededArchive(directory,seed){
 if(!REPLAY_SEEDS.includes(seed))throw Error('Unknown preregistered seed');
 const integrity=JSON.parse(readBounded(path.join(directory,`seed-${seed}.integrity.json`),1024**2));
 if(integrity.schemaVersion!==1||integrity.seed!==seed||!Number.isSafeInteger(integrity.runId)||integrity.runId<1||!Number.isSafeInteger(integrity.artifactId)||integrity.artifactId<1||typeof integrity.campaignSourceRevision!=='string'||!/^[a-f0-9]{40}$/.test(integrity.campaignSourceRevision)||!Number.isSafeInteger(integrity.archiveBytes)||integrity.archiveBytes<1||!sha(integrity.archiveSha256)||!integrity.members||typeof integrity.members!=='object'||Array.isArray(integrity.members)||Object.keys(integrity.members).length>256||Object.entries(integrity.members).some(([name,digest])=>!name||name.length>240||name.startsWith('/')||name.split('/').includes('..')||!sha(digest)))throw Error('Invalid seed integrity binding');
 const compressed=readBounded(path.join(directory,`seed-${seed}.json.gz`),16*1024**2);
 if(compressed.length>16*1024**2||compressed.length!==integrity.archiveBytes||hash(compressed)!==integrity.archiveSha256)throw Error('Seed archive digest mismatch');
 const archive=JSON.parse(gunzipSync(compressed,{maxOutputLength:64*1024**2}));
 if(archive.schemaVersion!==1||!archive.files||typeof archive.files!=='object'||Array.isArray(archive.files)||JSON.stringify(Object.keys(archive.files).sort())!==JSON.stringify(Object.keys(integrity.members).sort()))throw Error('Seed member inventory mismatch');
 for(const [name,sha]of Object.entries(integrity.members))if(typeof archive.files[name]!=='string'||hash(archive.files[name])!==sha)throw Error('Seed member digest mismatch');
 const load=name=>JSON.parse(archive.files[name]);
 const manifest=load('preregistered-manifest.json'),original=load('assessment.json'),binding=load('candidate-install-binding.json'),source=load('source-binding.json');
 if(manifest.projects?.length!==1||manifest.projects[0].propertyReplay?.seed!==seed||manifest.projects[0].propertyReplay?.schemaVersion!==1||source.revision!==REA_REVISION||typeof original.qualified!=='boolean'||binding.kind!=='explicit-source-candidate-not-registry-release'||!sha(binding.sha256)||typeof binding.version!=='string'||!/^\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?$/.test(binding.version)||binding.sourceRevision!==integrity.campaignSourceRevision||binding.sha256!==original.candidateProvenance?.sha256||binding.version!==original.candidateProvenance?.version||original.candidateProvenance?.kind!==binding.kind||original.candidateProvenance.sourceRevision!==binding.sourceRevision)throw Error('Seed source/profile binding mismatch');
 const raw=[];
 for(let c=0;c<2;c++)for(let r=0;r<3;r++){
  const row={change:c,repetition:r};for(const arm of ['full','subset','native','plan'])row[arm]=load(`raw-pilot/change-${c}-trial-${r}-${arm}.json`);raw.push(row);
 }
 const root=path.dirname(manifest.projects[0].root),assessment=assessReaPilot(load('pilot-summary.json'),load('independent-baseline.json'),raw,path.join(root,'independent-replay-baseline'),{seed,candidate:original.candidateProvenance});
 const events=load('execution.json').events;
 const nodeRuns=['node-oracle-fixed-baseline','node-oracle-source-reversion-0','node-oracle-source-reversion-1','node-oracle-source-reversion-2','node-oracle-fixed-restored'].map(label=>{
  const matching=events.filter(event=>event.label===label);if(matching.length!==1)throw Error('Node event missing or duplicated');return {label,event:matching[0],result:load(label+'.json')};
 });
 const node=assessNodeOracle(nodeRuns,path.join(root,'node-oracle'),load('node-oracle-assessment.json').testsUnchanged);
 const pilot=events.filter(event=>event.label==='pilot-execution');
 if(!node.qualified||original.protectedSourceUnchanged!==true||pilot.length!==1||![0,1].includes(pilot[0].exitCode)||pilot[0].signal||pilot[0].stoppedReason)assessment.observationCompleted=false;
 if(pilot.length!==1||pilot[0].exitCode!==0){assessment.qualified=false;assessment.reasons.push('pilot-comparison-rejected');}
 if(original.qualified===false&&assessment.qualified)throw Error('Frozen negative qualification cannot be promoted by replay');
 return {kind:'frozen-assessment-replay-no-native-execution',seed,runId:integrity.runId,artifactId:integrity.artifactId,sourceRevision:binding.sourceRevision,candidateArchiveSha256:binding.sha256,candidateVersion:binding.version,archiveSha256:integrity.archiveSha256,originalQualified:original.qualified,assessment,nodeOracleQualified:node.qualified,integrityLimitation:'Hashes check retained bytes and declared bindings; they do not authenticate GitHub run origin or establish semantic truth.'};
}
export function verifySeededMatrix(directory){
 const results=REPLAY_SEEDS.map(seed=>verifySeededArchive(directory,seed));
 const matrixBound=new Set(results.map(result=>JSON.stringify([result.sourceRevision,result.runId,result.candidateArchiveSha256,result.candidateVersion]))).size===1&&new Set(results.map(result=>result.artifactId)).size===REPLAY_SEEDS.length;
 if(!matrixBound)throw Error('Mixed source/run/candidate or duplicated artifact in seed matrix');
 return {schemaVersion:1,kind:'frozen-seeded-matrix-assessment-replay',completed:results.every(result=>result.assessment.observationCompleted),qualified:results.every(result=>result.assessment.qualified),results,claims:{worldClassEstablished:false,superiorityEstablished:false,generalSpeedAdvantageEstablished:false,exactGeneratedInputsCertified:false,learningImprovementEstablished:false}};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{if(process.argv.length!==3)throw Error('Use rea-seeded-replay.js FROZEN_DIRECTORY');const result=verifySeededMatrix(path.resolve(process.argv[2]));console.log(JSON.stringify(result,null,2));process.exitCode=result.completed?0:1;}catch(error){console.error(error.message);process.exitCode=1;}
}
