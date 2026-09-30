#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {stagePatch,validateCandidates} from '../src/candidates.js';
import {discover,execute} from '../src/execution.js';
import {snapshot,freshness,digest} from '../src/provenance.js';
import {buildGraph,evidencePath} from '../src/graph.js';
import {plan} from '../src/selector.js';

const VERSION='4.10.2',SEED=424242,TRIALS=500,PROPERTY='finite clamp preserves fractions and exact boundaries';
const CONFIG={adapter:'node',discovery:'native',runner:[process.execPath,'--test','{files}']};
const SPEC='For every finite number x, clamp(x) returns 0 when x<=0, 10 when x>=10, and exactly x otherwise. Fractions must not be rounded.';
const SOURCE="export function clamp(value){if(!Number.isFinite(value))throw new TypeError('finite number required');return Math.min(10,Math.max(0,value));}\n";
const EXAMPLES=[[-5,0],[1,1],[5,5],[9,9],[20,10]];
const ORIGINAL=`import test from 'node:test';import assert from 'node:assert/strict';import {clamp} from '../src/clamp.js';\ntest('five original clamp examples',()=>{for(const [input,expected] of ${JSON.stringify(EXAMPLES)})assert.equal(clamp(input),expected);});\n`;
// Parameters and defect corpus are fixed before any measurement. Shrinking has a separate time bound.
const PROPERTY_CODE=`import test from 'node:test';import assert from 'node:assert/strict';import fc from 'fast-check';import {clamp} from '../src/clamp.js';
const expected=x=>x<=0?0:x>=10?10:x;
const inputs=fc.oneof(fc.constantFrom(-0.5,0,0.5,10,10.5),fc.double({min:-20,max:30,noNaN:true,noDefaultInfinity:true}));
const contract=fc.property(inputs,x=>assert.equal(clamp(x),expected(x)));
test(${JSON.stringify(PROPERTY)},()=>{
 const replay=process.env.TESTLORE_PROPERTY_REPLAY_PATH;
 const result=fc.check(contract,{seed:${SEED},numRuns:${TRIALS},endOnFailure:false,plugins:[fc.interruptAfterTimeLimit(5000,{failOnInterrupt:true})],...(replay?{path:replay}:{})});
 const error=result.errorInstance;
 console.log('@testlore-property:'+JSON.stringify({failed:result.failed,interrupted:result.interrupted,numRuns:result.numRuns,numShrinks:result.numShrinks,numSkips:result.numSkips,seed:result.seed,counterexample:result.counterexample,counterexamplePath:result.counterexamplePath,error:error?{name:error.name,code:error.code,message:error.message,actual:error.actual,expected:error.expected,operator:error.operator}:null}));
 if(result.failed)throw error||new Error('Property failed without an assertion exception');
});\n`;
const DEFECTS=[
 {name:'exact lower boundary off by one',condition:'value===0',replacement:'1'},
 {name:'exact upper boundary off by one',condition:'value===10',replacement:'9'},
 {name:'round interior fractions down',condition:'value>0&&value<10&&!Number.isInteger(value)',replacement:'Math.floor(value)'},
 {name:'negative fractional passthrough',condition:'value<0&&value>-1',replacement:'value'}
].map(defect=>({...defect,path:'src/clamp.js',content:SOURCE.replace('return Math.min',`if(${defect.condition})return ${defect.replacement};return Math.min`)}));
const expected=input=>input<=0?0:input>=10?10:input;
const write=(root,file,value)=>{const target=path.join(root,file);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,typeof value==='string'?value:JSON.stringify(value,null,2)+'\n');};
function installed(moduleRoot){
 const require=createRequire(path.join(path.resolve(moduleRoot),'package.json'));let manifest;
 try{manifest=require.resolve('fast-check/package.json');}catch{throw new Error('Install fast-check@4.10.2 in the project, or supply --module-root pointing to a project that already has it. This proof never installs dependencies.');}
 const metadata=JSON.parse(fs.readFileSync(manifest,'utf8'));
 if(metadata.version!==VERSION)throw new Error(`This reproducible proof requires fast-check@${VERSION}; found ${metadata.version}`);
 const entry=require.resolve('fast-check');
 return {dependencyRoot:path.dirname(path.dirname(manifest)),manifest,entry,version:metadata.version,packageHash:digest(fs.readFileSync(manifest)),entryHash:digest(fs.readFileSync(entry))};
}
function propertyDetails(report){
 const records=(report.stdout||'').split('\n').filter(line=>line.startsWith('@testlore-property:')).map(line=>JSON.parse(line.slice('@testlore-property:'.length)));
 return records.length===1?records[0]:null;
}
function measured(root,config=CONFIG){
 const before=snapshot(root,config),discovery=discover(root,config),report=execute(root,discovery.files,config,{capture:true,timeoutMs:15000});
 const stable=freshness(before,snapshot(root,config));
 return {...report,discovery,provenance:before,stable,complete:report.complete&&discovery.complete&&stable.fresh};
}
function caught(report,details){
 const failures=report.tests.filter(test=>test.status==='failed');const input=details?.counterexample?.[0];
 const original=report.tests.find(test=>test.file==='test/original.test.js'&&test.name==='five original clamp examples');
 const knownScope=report.discovery.files.length===2&&report.discovery.files.includes('test/original.test.js')&&report.discovery.files.includes('test/property.test.js');
 return report.complete&&knownScope&&report.tests.length===2&&original?.status==='passed'&&report.exitCode!==0&&failures.length===1&&failures[0].file==='test/property.test.js'&&failures[0].name===PROPERTY&&details?.failed===true&&details.interrupted===false&&details.error?.code==='ERR_ASSERTION'&&Number.isFinite(input)&&input>=-20&&input<=30&&details.error.expected===expected(input)&&details.error.actual!==expected(input);
}
function sanitized(value,roots){
 if(Array.isArray(value))return value.map(item=>sanitized(item,roots));
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,sanitized(item,roots)]));
 if(typeof value!=='string')return value;
 let text=value;for(const [root,label]of roots)if(root)text=text.split(root).join(label);
 return text.replace(/\/(?:private\/)?var\/folders\/[^\s:'"\n]+\/T\/(?:tddswarm|testlore)-[^/\s:'"\n]+/g,'<scratch>').replace(/\/tmp\/(?:tddswarm|testlore)-[^/\s:'"\n]+/g,'<scratch>');
}

/** Real fast-check library compatibility, not a generation plugin or model-quality comparison. */
export function propertyProof({moduleRoot=process.cwd(),rawDirectory}={}){
 const sdk=installed(moduleRoot),root=fs.mkdtempSync(path.join(os.tmpdir(),'testlore-property-proof-'));
 const repository=fileURLToPath(new URL('../',import.meta.url)).replace(/\/$/,'');
 const roots=[[process.execPath,'<node>'],[fs.realpathSync(root),'<fixture>'],[root,'<fixture>'],[fs.realpathSync(moduleRoot),'<module-root>'],[path.resolve(moduleRoot),'<module-root>'],[repository,'<testlore>']];
 const copies=[];
 const make=(property=false,implementation=SOURCE)=>{
  const workspace=fs.mkdtempSync(path.join(os.tmpdir(),'testlore-property-case-'));copies.push(workspace);
  for(const file of ['package.json','tddswarm.config.json','tddswarm.requirements.md','test/original.test.js'])write(workspace,file,fs.readFileSync(path.join(root,file),'utf8'));
  write(workspace,'src/clamp.js',implementation);if(property)write(workspace,'test/property.test.js',PROPERTY_CODE);fs.symlinkSync(sdk.dependencyRoot,path.join(workspace,'node_modules'),'dir');return workspace;
 };
 try{
  write(root,'package.json',{name:'testlore-property-fixture',private:true,type:'module',dependencies:{'fast-check':VERSION}});write(root,'tddswarm.config.json',CONFIG);write(root,'tddswarm.requirements.md',SPEC);write(root,'src/clamp.js',SOURCE);write(root,'test/original.test.js',ORIGINAL);fs.symlinkSync(sdk.dependencyRoot,path.join(root,'node_modules'),'dir');
  const originalHash=digest(ORIGINAL),staged=stagePatch(root,{files:[{path:'test/property.test.js',content:PROPERTY_CODE}],requirements:SPEC,review:{accepted:true,findings:['Manually authored synthetic fixture and independent piecewise oracle; no AI author/reviewer invoked.'],oracle:{independent:true,basis:[SPEC,'Original five-example suite is preserved, and expected values use a separate mathematical piecewise checker.']}}});
  const validation=validateCandidates(root,staged.id,{timeoutMs:15000});
  const base=make(true),baseReport=measured(base),baseDetails=propertyDetails(baseReport);
  const graph=buildGraph(base),routing=plan(base,{changed:['src/clamp.js']});
  const observations=DEFECTS.map(defect=>{
   const old=measured(make(false,defect.content)),candidateRoot=make(true,defect.content),candidate=measured(candidateRoot),details=propertyDetails(candidate);
   const replay=details?.counterexamplePath?measured(candidateRoot,{...CONFIG,env:{TESTLORE_PROPERTY_REPLAY_PATH:details.counterexamplePath}}):null;
   const replayDetails=replay?propertyDetails(replay):null;
   const originalGreen=old.complete&&old.exitCode===0&&old.tests.length===1&&old.tests[0].status==='passed';
   const propertyCaught=caught(candidate,details),reproduced=Boolean(replay&&caught(replay,replayDetails)&&JSON.stringify(details.counterexample)===JSON.stringify(replayDetails.counterexample));
   return {name:defect.name,sourceHash:digest(defect.content),originalGreen,propertyCaught,reproduced,details,replayDetails,original:old,candidate,replay};
  });
  const unapplied=!fs.existsSync(path.join(root,'test/property.test.js'))&&digest(fs.readFileSync(path.join(root,'test/original.test.js')))===originalHash&&fs.readFileSync(path.join(root,'src/clamp.js'),'utf8')===SOURCE;
  const passed=validation.accepted&&validation.original.complete&&validation.candidate.complete&&validation.original.exitCode===0&&validation.candidate.exitCode===0&&baseReport.complete&&baseReport.exitCode===0&&baseDetails?.failed===false&&baseDetails.numRuns===TRIALS&&observations.length===4&&observations.every(o=>o.originalGreen&&o.propertyCaught&&o.reproduced)&&unapplied;
  const raw={fixture:{spec:SPEC,source:SOURCE,original:ORIGINAL,candidate:PROPERTY_CODE,examples:EXAMPLES,defects:DEFECTS},validation,baseReport,observations,routing};
  const cleanRaw=sanitized(raw,roots);
  const rawArtifacts={};
  if(rawDirectory){fs.mkdirSync(path.resolve(rawDirectory),{recursive:true});for(const [name,data]of Object.entries(cleanRaw)){const file=`${name}.json`,content=JSON.stringify(data,null,2)+'\n';fs.writeFileSync(path.join(rawDirectory,file),content);rawArtifacts[file]={sha256:digest(content)};}}
  return {schemaVersion:1,scope:'Manually authored fast-check compatibility and four fixed synthetic hold-out defects; not AI generation quality or general performance certification',generatedAt:new Date().toISOString(),node:process.version,passed,applied:false,unapplied,library:{name:'fast-check',version:sdk.version,packageHash:sdk.packageHash,entryHash:sdk.entryHash,repository:'https://github.com/dubzzz/fast-check'},budget:{seed:SEED,numRuns:TRIALS,domain:'finite doubles [-20,30] plus fixed boundary/fraction samples',propertyTimeLimitMs:5000,runnerTimeoutMs:15000},fixtureHash:digest(cleanRaw.fixture),coreValidation:{accepted:validation.accepted,originalComplete:validation.original?.complete,candidateComplete:validation.candidate?.complete,originalCases:validation.original?.tests?.length,candidateCases:validation.candidate?.tests?.length,embeddedHeldOutDefects:0,reasons:validation.reasons,provenance:sanitized(validation.provenance,roots)},supplementaryHoldouts:{count:observations.length,caught:observations.filter(o=>o.propertyCaught).length,replayed:observations.filter(o=>o.reproduced).length,recall:observations.length?observations.filter(o=>o.propertyCaught).length/observations.length:null,method:'Separate full normalized Node executions: original examples must pass and candidate must fail its named assertion, with independently checked counterexample and seed/path replay.',cases:observations.map(({name,sourceHash,originalGreen,propertyCaught,reproduced,details,replayDetails})=>({name,sourceHash,originalGreen,propertyCaught,reproduced,details,replayDetails}))},routing:{mode:routing.mode,selected:routing.selected,reasons:routing.reasons,warnings:routing.warnings,propertyDependencyPath:evidencePath(graph,'test/property.test.js','src/clamp.js'),claim:'Native dependency participation only; both known consumers selected, no unrelated-test omission or speed claim.'},rawArtifacts,limitations:['The property and independent review are manually authored synthetic fixtures; no model or provider API was invoked.','Four deliberately weak-example blind spots do not establish broad defect recall or a best-tool ranking.','Core held-out validation requires an original failing case; these original-green defects are a separately gated compatibility experiment.','Trials stop at the first failure; shrinking has its own bounded work and replay requires the pinned library/generator/seed/path.']};
 }finally{for(const workspace of copies)fs.rmSync(workspace,{recursive:true,force:true});fs.rmSync(root,{recursive:true,force:true});}
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===path.resolve(process.argv[1])){
 try{const options={};for(let i=2;i<process.argv.length;i+=2){const key=process.argv[i];if(!['--module-root','--output','--raw-directory'].includes(key)||!process.argv[i+1])throw new Error('Usage: node scripts/property-proof.js [--module-root PATH] [--output FILE] [--raw-directory DIR]');options[key.slice(2)]=process.argv[i+1];}
 const report=propertyProof({moduleRoot:options['module-root']||process.cwd(),rawDirectory:options['raw-directory']});const text=JSON.stringify(report,null,2)+'\n';if(options.output){fs.mkdirSync(path.dirname(path.resolve(options.output)),{recursive:true});fs.writeFileSync(options.output,text);}process.stdout.write(text);process.exitCode=report.passed?0:1;
 }catch(error){process.stderr.write(error.message+'\n');process.exitCode=1;}
}
