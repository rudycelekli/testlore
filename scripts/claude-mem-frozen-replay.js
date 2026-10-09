#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {TextDecoder} from 'node:util';
import {bunResults,bunBaselineAdmission,readBunReport} from '../src/bun-results.js';

const defaultDirectory=fileURLToPath(new URL('../benchmarks/claude-mem-20261009/',import.meta.url));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const INDEX_SHA='107e74b83d0e67fa17a3513bbdafe0b10d262e8f35f6520253aff10915a4f83d';
const GZIP_SHA='83545aa97f9d8b708d0f987fa283d66f5755f2f30c1f0689e11fbbe600217d89';
const ARTIFACT_SHA='d5db031b900d49b8263cc5f3bd612b6b827b533abd9ef7caae73973a4dcfe543';
const REVISION='7532ad0005c81686e7edaa3729b349cd5cb43690';
const UPSTREAM='fa8ab09f06aa05f958c5225cf3756ce52a3ebb96';
const tuples=tests=>tests.map(t=>JSON.stringify([t.file,t.name,t.line,t.column,t.status])).sort();
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);

/** Exact original UTF8 evidence, not a rerun or new native qualification. */
export function replayClaudeMemObservation(directory=defaultDirectory){
 const indexText=readBunReport(path.join(directory,'native-diagnostics.integrity.json'));
 if(sha(indexText)!==INDEX_SHA)throw Error('Frozen claude-mem integrity index changed');
 const index=JSON.parse(indexText),archive=path.join(directory,'native-diagnostics.json.gz');
 const fd=fs.openSync(archive,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0)|(fs.constants.O_NONBLOCK||0));
 let bytes;
 try{const st=fs.fstatSync(fd);if(!st.isFile()||st.size>2*1024*1024)throw Error('Invalid frozen claude-mem archive');bytes=fs.readFileSync(fd);}finally{fs.closeSync(fd);}
 if(sha(bytes)!==GZIP_SHA||index.compressedSha256!==GZIP_SHA||index.artifactZipSha256!==ARTIFACT_SHA||index.runId!==37947220123||index.artifactId!==11625553480||index.sourceRevision!==REVISION||index.upstreamRevision!==UPSTREAM)throw Error('Frozen original claude-mem observation identity changed');
 const data=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(gunzipSync(bytes,{maxOutputLength:32*1024*1024}))),files=data.files;
 if(data.schemaVersion!==1||!files||!same(Object.keys(files).sort(),Object.keys(index.members).sort())||Object.keys(files).length!==56)throw Error('Frozen claude-mem evidence membership changed');
 for(const [name,content]of Object.entries(files)){const binding=index.members[name];if(typeof content!=='string'||Buffer.byteLength(content)!==binding.bytes||sha(content)!==binding.sha256)throw Error('Frozen member changed: '+name);}
 const json=name=>{if(typeof files[name]!=='string')throw Error('Missing frozen report: '+name);return JSON.parse(files[name]);};
 const profile=json('campaign/preregistered-manifest.json'),receipt=json('campaign/assessment.json'),installation=json('upstream-installation.json'),process=json('campaign-process.json');
 if(profile.upstreamRevision!==UPSTREAM||profile.bunVersion!=='1.4.2'||profile.credentialsInherited!==false||profile.isolatedHome!==true||receipt.protectedInputsUnchanged!==true||receipt.qualified!==false||receipt.observationCompleted!==false||receipt.speedAdvantage!==false||installation.dependencyInventoryAccepted!==false||receipt.installationReceiptSha256!==sha(files['upstream-installation.json']))throw Error('Frozen rejected scope/profile/environment claims changed');
 const baselineRows=[];let completeNativeReports=0;
 const reports=Object.keys(files).filter(name=>/^campaign\/(?:baseline-|regression-|restored-oracle)[^/]*\.json$/.test(name)).sort();
 if(reports.length!==10)throw Error('Original native observations missing');
 for(const report of reports){
  const raw=json(report),xml=report.replace(/\.json$/,'.xml');
  if(raw.complete){const replay=bunResults('/frozen-upstream',files[xml],{exitCode:raw.exitCode});if(!same(replay.tests,raw.tests)||!same(replay.collectionFiles,raw.collectionFiles))throw Error('Native JUnit/outcome mismatch: '+report);completeNativeReports++;}
  else if(report!=='campaign/baseline-tests.json'||raw.signal!=='SIGKILL'||raw.exitCode!==null||raw.tests!==undefined||!raw.error?.includes('ETIMEDOUT'))throw Error('Original full-suite timeout changed');
  baselineRows.push({report,complete:raw.complete,exitCode:raw.exitCode,cases:raw.tests?.length||0,files:raw.collectionFiles?.length||0,...(report.includes('/baseline-')?{baselineGreen:bunBaselineAdmission(raw).admitted}:{}),durationMs:raw.durationMs});
 }
 const route=json('campaign/baseline-tests-worker-http-routes.json'),routeFailures=route.tests.filter(t=>t.status==='failed');
 if(completeNativeReports!==9||baselineRows.filter(r=>r.baselineGreen).length!==4||routeFailures.length!==5)throw Error('Original native baseline outcome changed');
 const diagnosticComparisons=[0,1,2].map(repetition=>{
  const full=json('campaign/regression-'+repetition+'.json'),selected=json('campaign/testlore-'+repetition+'.json'),summary=receipt.trials[repetition];
  const target=full.tests.filter(t=>t.file===profile.oracle&&t.title.includes('same millisecond')&&t.status==='failed');
  if(!full.complete||!selected.complete||selected.plan.mode!=='full'||selected.plan.selected.length!==57||selected.plan.total!==57||target.length!==1||full.tests.filter(t=>t.status==='failed').length!==6||!same(tuples(full.tests),tuples(selected.tests))||summary.nativeMs!==full.durationMs)throw Error('Original diagnostic comparison changed');
  return{repetition,nativeComplete:true,testLoreComplete:true,exactCaseStatusPreserved:true,selectedFiles:57,totalFiles:57,nativeMs:full.durationMs,testLoreMs:summary.testLoreMs,testLoreMeasuredTotalMs:selected.timings.totalMs,finalReportSealingExcluded:selected.timings.finalReportSealingExcluded,additionalHistoricalFault:target.map(t=>({file:t.file,name:t.name,line:t.line,status:t.status}))};
 });
 if(process.reason!==null||process.signal!==null||process.exitCode!==3)throw Error('Original bounded collector outcome changed');
 return{schemaVersion:1,independentlyReplayed:true,sourceRevision:REVISION,upstreamRevision:UPSTREAM,verifiedMembers:56,completeNativeReports,baselineRows,originalRouteFailures:routeFailures.map(t=>({file:t.file,name:t.name,line:t.line,status:t.status})),diagnosticComparisons,collectionProcessMs:process.durationMs,qualified:false,reasons:['original-full-suite-timeout','original-route-baseline-not-green','dependency-inventory-rejected','full-fallback-no-speed-advantage']};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){try{console.log(JSON.stringify(replayClaudeMemObservation(process.argv[2]||defaultDirectory),null,2));}catch(error){console.error(error.message);process.exitCode=1;}}
