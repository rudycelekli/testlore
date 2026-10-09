import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {runInNewContext} from 'node:vm';
import {loadAqeComparison,summarizeAqePair} from '../scripts/aqe-comparison.js';

const passed={complete:true,exitCode:0,tests:[{file:'candidate.test.js',name:'whitespace',status:'passed'}]};
const failed={complete:true,exitCode:1,tests:[{file:'candidate.test.js',name:'whitespace',status:'failed'}]};
const runs=()=>({fixed:[passed,passed],fault:[failed,failed],oracleFixed:[passed,passed],oracleFault:[failed,failed]});
test('new upstream contract and historical parent are immutable and bound before generation',()=>{
 const {manifest,source,fault,reference}=loadAqeComparison();
 assert.notEqual(source,fault);assert.match(reference,/assert\.equal\(isNumber\(num\), false\)/);
 assert.equal(manifest.budgets.modelCalls,0);assert.equal(manifest.upstream.version,'3.14.8');
 assert.equal(manifest.promotionAuthorized,false);assert.match(source,/num\.trim\(\)/);
});
test('shared candidates cannot establish improved defect detection through filtering alone',()=>{
 const result=summarizeAqePair({complete:true,upstream:{qualityGates:[{passed:true,score:100}]}},runs(),{accepted:true,reasons:[]});
 assert.equal(result.aqeAlone.measuredCaught,true);assert.equal(result.aqePlusTestLore.measuredCaught,true);
 assert.equal(result.detectionImprovementClaim,false);assert.equal(result.cost.tokens,null);assert.equal(result.learningImprovementClaim,false);
});
test('an upstream passing score cannot substitute for execution, stability or independent defects',()=>{
 const unstable=runs();unstable.fixed[1]={...passed,tests:[{file:'candidate.test.js',name:'other',status:'passed'}]};
 const result=summarizeAqePair({complete:true,upstream:{qualityGates:[{passed:true,score:100}]}},unstable,{accepted:false,reasons:['candidate-suite-failed']});
 assert.equal(result.candidateStable,false);assert.equal(result.candidateCaughtHistoricalFault,false);assert.equal(result.aqePlusTestLore.accepted,false);
 const load=runs();load.fault=[{complete:true,exitCode:1,tests:[{file:'candidate.test.js',name:'<file-load>',status:'failed'}]},failed];
 assert.equal(summarizeAqePair({complete:true},load,{accepted:false}).candidateCaughtHistoricalFault,false);
 const missing=runs();missing.oracleFault=[{...failed,complete:false},failed];assert.equal(summarizeAqePair({complete:true},missing,{accepted:true}).independentFaultDemonstrated,false);
});
test('timeouts and generation rejections stay visible without creating zero-cost quality wins',()=>{
 const r=summarizeAqePair({complete:false,error:'spawn ETIMEDOUT'},{fixed:[],fault:[],oracleFixed:[passed,passed],oracleFault:[failed,failed]},null);
 assert.equal(r.timedOut,true);assert.equal(r.generationRejected,true);assert.equal(r.aqeAlone.returnedDraft,false);assert.equal(r.aqePlusTestLore.accepted,false);assert.equal(r.cost.providerCurrency,null);
});
test('committed upstream files are checked rather than trusting declared provenance',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'testlore-aqe-binding-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const source=new URL('../benchmarks/aqe-comparison/is-number-whitespace-v1/',import.meta.url);fs.cpSync(source,root,{recursive:true});
 fs.appendFileSync(path.join(root,'upstream/204c885659b8ee1946534c61db91603b9a16d661/index.js'),'\n');
 assert.throws(()=>loadAqeComparison(path.join(root,'manifest.json')),/identity changed/);
});

test('missing independent oracle repetitions and rejected generation cannot demonstrate a defect win',()=>{
 const empty=runs();empty.oracleFixed=[];empty.oracleFault=[];
 assert.equal(summarizeAqePair({complete:true},empty,{accepted:true}).independentFaultDemonstrated,false);
 assert.equal(summarizeAqePair({complete:false},runs(),{accepted:true}).candidateCaughtHistoricalFault,false);
});

test('supported Vitest profile preserves Node oracle and genuine whitespace bytes without rewriting old manifest',()=>{
 const original=loadAqeComparison(new URL('../benchmarks/aqe-comparison/is-number-whitespace-v1/manifest.json',import.meta.url).pathname),supported=loadAqeComparison();
 assert.equal(original.framework,'node');assert.equal(supported.framework,'vitest');assert.equal(supported.manifest.nativeRunner.version,'5.0.2');
 assert.equal(original.source,supported.source);assert.equal(original.fault,supported.fault);assert.match(supported.reference,/assert.equal\(isNumber\(num\), false\);/);
 assert.match(supported.reference,/createRequire/);assert.doesNotMatch(supported.reference,/node:test/);
 for(const reference of [original.reference,supported.reference]){const values=runInNewContext(reference.match(/const shouldFail=(.+);\ndescribe/)[1]);assert.deepEqual(Array.from(values[1],c=>c.charCodeAt(0)),[13,10,9]);}
 assert.deepEqual(original.manifest.budgets,supported.manifest.budgets);
});

test('retained actual CLI rejection replays as unsupported, not a successful combination',async()=>{
 const {verifyUnsupportedAqeObservation}=await import('../scripts/aqe-frozen-replay.js');
 const report=verifyUnsupportedAqeObservation();assert.equal(report.observationReplayed,true);assert.equal(report.comparisonExecuted,false);assert.equal(report.qualifiedAdvantage,false);
 for(const repeat of report.repetitions){assert.equal(repeat.rejectionCategory,'unsupported-framework');assert.equal(repeat.independentFaultDemonstrated,true);assert.equal(repeat.candidateCaughtHistoricalFault,false);assert.equal(repeat.aqePlusTestLore.accepted,false);assert.equal(repeat.cost.tokens,null);}
});
