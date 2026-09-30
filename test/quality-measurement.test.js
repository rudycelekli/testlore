import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { measureTestEffectiveness } from '../src/quality-measurement.js';
import { fixture } from './helpers.js';
const source='export const clamp=x=>Math.max(0,Math.min(10,x));';
const original="import test from 'node:test';import assert from 'node:assert/strict';import {clamp} from '../src/clamp.js';test('upper bound from specification',()=>assert.equal(clamp(20),10));";
const setup=t=>fixture(t,{'package.json':{type:'module'},'src/clamp.js':source,'test/clamp.test.js':original});
const defects=[{id:'upper_removed',requirement:'The clamp function saturates above ten.',files:[{path:'src/clamp.js',content:'export const clamp=x=>Math.max(0,x);'}]},{id:'lower_removed',requirement:'The clamp function saturates below zero.',files:[{path:'src/clamp.js',content:'export const clamp=x=>Math.min(10,x);'}]}];
test('quality dimensions retain independently named bugs, preserve original cases and measure real repeated execution',t=>{
 const root=setup(t), result=measureTestEffectiveness(root,{defects,repetitions:2,candidateFiles:[{path:'test/boundary.test.js',content:original.replace("upper bound from specification","lower bound from specification").replace('clamp(20),10','clamp(-20),0')}]});
 assert.equal(result.complete,true);assert.equal(result.dimensions.defectDetection.demonstrated,1);assert.equal(result.dimensions.defectDetection.caught,1);assert.equal(result.dimensions.defectDetection.additionalCandidateDetections,1);assert.equal(result.dimensions.preservedPassingCases,1);assert.equal(result.dimensions.stability.passingCandidateRuns,2);assert.equal(result.dimensions.cost.providerDollars,null);assert.equal(fs.readFileSync(path.join(root,'src/clamp.js'),'utf8'),source);
});
test('quality reports expose lost original behavior and reject test-code defects',t=>{
 const root=setup(t), result=measureTestEffectiveness(root,{defects: defects.slice(0,1),repetitions:2,candidateFiles:[{path:'test/clamp.test.js',content:"import test from 'node:test';test('weak',()=>{});"}]});assert.equal(result.complete,false);assert.equal(result.missingOriginalCases.length,1);assert.equal(result.dimensions.defectDetection.caught,0);
 assert.throws(()=>measureTestEffectiveness(root,{defects:[{...defects[0],files:[{path:'test/clamp.test.js',content:'nothing'}]}]}),/cannot replace tests/);
});
test('duplicate named cases and skipped suites cannot masquerade as preserved passing coverage',t=>{
 const root=setup(t);fs.writeFileSync(path.join(root,'test/clamp.test.js'),original+"\ntest('upper bound from specification',()=>assert.equal(clamp(20),10));");
 const result=measureTestEffectiveness(root,{defects:defects.slice(0,1),repetitions:2,candidateFiles:[{path:'test/clamp.test.js',content:original}]});assert.equal(result.complete,false);assert.equal(result.dimensions.originalPassingCases,2);assert.equal(result.missingOriginalCases.length,1);
 const skipped=setup(t);fs.writeFileSync(path.join(skipped,'test/clamp.test.js'),"import test from 'node:test';test.skip('no execution',()=>{});");const evidence=measureTestEffectiveness(skipped,{defects:defects.slice(0,1),repetitions:2});assert.equal(evidence.complete,false);assert.equal(evidence.dimensions.stability.passingOriginalRuns,0);
});
test('test side effects in the measurement copy cannot qualify as unchanged source evidence',t=>{
 const root=setup(t);fs.writeFileSync(path.join(root,'test/clamp.test.js'),original+"\nimport fs from 'node:fs';fs.writeFileSync('src/clamp.js','export const clamp=x=>0;');");
 const result=measureTestEffectiveness(root,{defects:defects.slice(0,1),repetitions:2});assert.equal(result.complete,false);assert.equal(result.baseline[0].complete,false);assert.ok(result.baseline[0].provenanceReasons.some(reason=>reason.startsWith('source-drift:src/clamp.js')));assert.equal(fs.readFileSync(path.join(root,'src/clamp.js'),'utf8'),source);
 assert.throws(()=>measureTestEffectiveness(setup(t),{defects:defects.slice(0,1),candidateFiles:[{content:'test'}]}),/Only bounded candidate/);
});
