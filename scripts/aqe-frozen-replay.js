#!/usr/bin/env node
import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';
import {readBoundedJson} from './evaluation-commitment.js';import {sha256,loadAqeComparison,summarizeAqePair} from './aqe-comparison.js';
const archiveSha='75dd4ed3ed09d229a3a42742ddd59f50218dba6f2201602a9f6478a411552e71';
const defaultDirectory=fileURLToPath(new URL('../benchmarks/aqe-comparison/unsupported-node-20261009/',import.meta.url));
export function verifyUnsupportedAqeObservation(directory=defaultDirectory){
 const integrity=readBoundedJson(path.join(directory,'integrity.json')),archive=path.join(directory,'original-artifact.zip'),stat=fs.lstatSync(archive);
 if(!stat.isFile()||stat.isSymbolicLink()||stat.size>4*1024*1024||stat.size!==integrity.artifactBytes||integrity.artifactSha256!==archiveSha||sha256(fs.readFileSync(archive))!==archiveSha||integrity.runId!==37947219864||integrity.artifactId!==11623848022||integrity.sourceRevision!=='7532ad0005c81686e7edaa3729b349cd5cb43690')throw Error('Frozen original hosted AQE artifact identity changed');
 const read=file=>{const binding=integrity.members[file],full=path.join(directory,file),st=fs.lstatSync(full);if(!binding||!st.isFile()||st.isSymbolicLink()||st.size>2*1024*1024||st.size!==binding.bytes||sha256(fs.readFileSync(full))!==binding.sha256)throw Error('Frozen original AQE member changed');return readBoundedJson(full);};
 const summary=read('comparison/summary.json'),profile=read('comparison/preregistration.json'),wall=read('installation-to-result.json'),oldManifest=fileURLToPath(new URL('../benchmarks/aqe-comparison/is-number-whitespace-v1/manifest.json',import.meta.url)),loaded=loadAqeComparison(oldManifest);
 if(profile.manifestHash!==loaded.manifestHash||summary.manifestHash!==loaded.manifestHash||profile.installation?.aqe?.version!=='3.14.8'||profile.installation.aqe.integrity!==loaded.manifest.upstream.npmIntegrity||wall.revision!==integrity.sourceRevision)throw Error('Frozen installed tool/profile/source differs from original manifest');
 const repetitions=[0,1].map(index=>{
  const raw=read('comparison/repeat-'+index+'.json'),assessment=summarizeAqePair(raw.generation,raw.runs,raw.validation);
  if(raw.repeat!==index||raw.sourceHash!==sha256(loaded.source)||raw.candidateHash!==null||raw.candidateFiles.length||raw.validation!==null||raw.generation.exitCode!==1||!/Unsupported test framework: node/.test(raw.generation.stderr||'')||assessment.generationComplete||!assessment.independentFaultDemonstrated||assessment.candidateCaughtHistoricalFault||assessment.comparisonExecuted||raw.runs.fixed.length||raw.runs.fault.length)throw Error('Unsupported observation no longer matches raw measured outcomes');
  for(const group of ['oracleFixed','oracleFault'])for(const run of raw.runs[group])if(run.tests.length!==2||run.tests.some(t=>t.name==='<file-load>'||t.status!==(group==='oracleFixed'?'passed':'failed')))throw Error('Frozen independent maintainer assertion outcome changed');
  return{repeat:index,...assessment,generationMs:raw.generationMs,validationMs:raw.validationMs};
 });
 if(summary.completed!==true||wall.completed!==true||summary.qualifiedAdvantage!==false||wall.qualifiedAdvantage!==false||wall.cost.providerCurrency!==null||wall.cost.tokens!==null)throw Error('Frozen negative observation claims changed');
 return{schemaVersion:1,observationReplayed:true,artifactSha256:archiveSha,sourceRevision:integrity.sourceRevision,runId:integrity.runId,repetitions,installationToResultMs:wall.durationMs,comparisonExecuted:false,qualifiedAdvantage:false,scope:'Actual CLI unsupported-node rejections and separately demonstrated maintainer fault; no generated candidates, no composition validation and no superiority. Selected raw members and original API-digest-bound archive are retained.'};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){try{console.log(JSON.stringify(verifyUnsupportedAqeObservation(process.argv[2]||defaultDirectory),null,2));}catch(error){console.error(error.message);process.exitCode=1;}}
