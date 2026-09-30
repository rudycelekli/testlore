import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {coverageMetrics,mutationMetrics,ingestQuality,qualityEvidence,captureRuntime,measureStability} from '../src/evidence.js';
import {snapshot} from '../src/provenance.js';
import {plan,audit,run} from '../src/index.js';
import {fixture,write,commit,twoModules} from './helpers.js';

test('Istanbul counters aggregate actual lines, branches, statements and functions',()=>{
  const report={'a.js':{statementMap:{0:{start:{line:1}},1:{start:{line:1}},2:{start:{line:2}}},s:{0:0,1:1,2:0},b:{0:[1,0]},f:{0:1}}};
  const metrics=coverageMetrics(report);assert.equal(metrics.lines.percentage,50);assert.equal(metrics.statements.covered,1);assert.equal(metrics.branches.total,2);
});
test('mutation score excludes invalid/ignored mutants and marks unfinished reports incomplete',()=>{
  const report={files:{'a.js':{mutants:['Killed','Timeout','Survived','NoCoverage','CompileError','Ignored','Pending'].map(status=>({status}))}}};
  const metrics=mutationMetrics(report);assert.equal(metrics.score,50);assert.equal(metrics.valid,4);assert.equal(metrics.complete,false);assert.throws(()=>mutationMetrics({files:{a:{mutants:[{status:'toString'}]}}}),/Unknown/);
});
test('imported evidence requires pre-run provenance and becomes stale after source drift',t=>{
  const root=fixture(t,twoModules);const before=snapshot(root);
  write(root,'.tddswarm/report.json',{total:Object.fromEntries(['lines','branches','functions','statements'].map(k=>[k,{covered:1,total:2}]))});
  assert.throws(()=>ingestQuality(root,'coverage','.tddswarm/report.json'),/pre-run/);
  ingestQuality(root,'coverage','.tddswarm/report.json',{provenance:before});
  assert.equal(qualityEvidence(root).coverage.measured,true);assert.equal(audit(root).measured.coverage,true);
  write(root,'src/a.js','export const a=4;');assert.equal(qualityEvidence(root).coverage.measured,false);
});
test('provenance cannot silently bind a stale mutation artifact to current source',t=>{
  const root=fixture(t,twoModules);const before=snapshot(root);write(root,'src/a.js','export const a=3;');
  write(root,'.tddswarm/report.json',{files:{a:{mutants:[{status:'Killed'}]}}});
  assert.throws(()=>ingestQuality(root,'mutation','.tddswarm/report.json',{provenance:before}),/source changed/);
});
test('real runtime capture maps computed imports and rejects corrupt/stale observations',async t=>{
  const root=fixture(t,{...twoModules,'src/a.js':"export const a=1;",'test/a.test.js':"import test from 'node:test';import assert from 'node:assert/strict';test('a',async()=>{const target='../src/a.js';const {a}=await import(target);assert.equal(a,1);});",'tddswarm.config.json':{runtime:{enabled:true,closedWorld:true}}});commit(root);
  const capture=await captureRuntime(root);assert.equal(capture.complete,true,JSON.stringify(capture.results.map(r=>({complete:r.complete,error:r.error}))));
  assert.ok(capture.observations['test/a.test.js'].dependencies.includes('src/a.js'));
  write(root,'src/a.js','export const a=3;');const p=plan(root);assert.equal(p.mode,'affected');assert.deepEqual(p.selected,['test/a.test.js']);
  write(root,'test/b.test.js',twoModules['test/b.test.js']+' // also changed');
  const result=run(root,{capture:true});assert.equal(result.exitCode,1);
  write(root,'.tddswarm/evidence/runtime.json',{complete:true});assert.equal(plan(root).mode,'full');
});
test('filesystem input tracing observes JSON copy consumed by only one test',async t=>{
  const root=fixture(t,{...twoModules,'public/copy.json':'{"headline":"Hello"}','test/a.test.js':"import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';test('copy',()=>assert.equal(JSON.parse(readFileSync('public/copy.json','utf8')).headline,'Hello'));",'tddswarm.config.json':{runtime:{enabled:true,closedWorld:true}}});commit(root);
  const capture=await captureRuntime(root);assert.equal(capture.complete,true);
  assert.ok(capture.observations['test/a.test.js'].dependencies.includes('public/copy.json'));
  write(root,'public/copy.json','{"headline":"Changed"}');assert.deepEqual(plan(root).selected,['test/a.test.js']);
});
test('runtime capture is supplemental unless user declares a closed-world policy',async t=>{
  const root=fixture(t,{...twoModules,'test/a.test.js':"import test from 'node:test';import assert from 'node:assert/strict';test('a',async()=>{const target='../src/a.js';const {a}=await import(target);assert.equal(a,1);});",'tddswarm.config.json':{runtime:{enabled:true}}});commit(root);
  await captureRuntime(root);write(root,'src/a.js','export const a=3;');assert.equal(plan(root).mode,'full');
});
test('repeated actual execution detects an observed alternating failure without calling sleeps flaky',async t=>{
  const root=fixture(t,{'package.json':{type:'module'},'test/a.test.js':"import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';fs.mkdirSync('.tddswarm',{recursive:true});let n=0;try{n=+fs.readFileSync('.tddswarm/counter','utf8')}catch{};fs.writeFileSync('.tddswarm/counter',String(n+1));test('alternates',()=>assert.equal(n%2,0));"});
  const result=await measureStability(root,{repeat:4});assert.equal(result.complete,true);assert.equal(result.metrics.unstable,1);assert.equal(audit(root).measured.flakiness,true);
});
test('a failed capture is incomplete and cannot authorize omissions',async t=>{
  const root=fixture(t,{...twoModules,'src/a.js':'export const a=9;','tddswarm.config.json':{runtime:{enabled:true,closedWorld:true}}});
  assert.equal((await captureRuntime(root)).complete,false);assert.equal(plan(root,{changed:['src/b.js']}).mode,'full');
});


test('zero eligible mutation/coverage counters and all-skipped repeats are not measured quality',async t=>{
 const root=fixture(t,{'package.json':{type:'module'},'test/a.test.js':"import test from 'node:test';test.skip('never executes',()=>{});"});
 const before=snapshot(root);write(root,'.tddswarm/mutation.json',{files:{a:{mutants:[]}}});ingestQuality(root,'mutation','.tddswarm/mutation.json',{provenance:before});assert.equal(qualityEvidence(root).mutation.measured,false);
 write(root,'.tddswarm/coverage.json',{total:Object.fromEntries(['lines','branches','functions','statements'].map(k=>[k,{covered:0,total:0}]))});ingestQuality(root,'coverage','.tddswarm/coverage.json',{provenance:before});assert.equal(qualityEvidence(root).coverage.measured,false);
 assert.equal((await measureStability(root,{repeat:2})).complete,false);
});
