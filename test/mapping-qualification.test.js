import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fixture,write,twoModules} from './helpers.js';
import {readConfig} from '../src/files.js';
import {snapshot,digest} from '../src/provenance.js';
import {qualifyRoutingMappings} from '../src/mapping-qualification.js';
import {proposeBrowserMappings} from '../src/browser-evidence.js';
import {routingProposals} from '../src/routing-proposals.js';
import {browserMappingProof} from '../scripts/browser-mapping-proof.js';
function declaredProposal(root,dependencies){return {schemaVersion:1,applied:false,stable:true,truncated:false,provenance:snapshot(root,readConfig(root)),proposals:[{authority:'proposal-only',status:'review-required',patch:{dependencies}}]};}
test('independent native full/subset runs preserve named cases and source/configuration bytes',t=>{
  const root=fixture(t,twoModules),proposal=declaredProposal(root,{'test/a.test.js':['src/a.js']}),before=snapshot(root,readConfig(root));
  const report=qualifyRoutingMappings(root,proposal,{changed:['src/a.js'],defects:[{path:'src/a.js',content:'export const a = 999;'}],timeoutMs:5000});
  assert.equal(report.qualified,true,JSON.stringify(report.reasons));assert.equal(report.complete,true);assert.equal(report.full.tests.length,2);assert.equal(report.subset.tests.length,1);assert.deepEqual(report.selection.selected,['test/a.test.js']);assert.equal(report.full.tests.find(test=>test.name==='a').status,'failed');assert.equal(report.subset.tests[0].status,'failed');assert.equal(report.noObservedMisses,true);assert.equal(report.preservation.complete,true);assert.deepEqual(report.missedFailures,[]);assert.equal(report.applied,false);assert.equal(report.closedWorld,false);assert.deepEqual(snapshot(root,readConfig(root)),before);assert.equal(fs.existsSync(path.join(root,'tddswarm.config.json')),false);assert.equal(fs.existsSync(path.join(root,'.tddswarm')),false);
});
test('literal filesystem proposals gain actual native qualification without enabling dependencies',t=>{
  const root=fixture(t,{...twoModules,'input.txt':'correct','test/input.test.js':"import fs from 'node:fs';import test from 'node:test';import assert from 'node:assert/strict';test('input',()=>assert.equal(fs.readFileSync('input.txt','utf8'),'correct'));"});
  const proposal=routingProposals(root);assert.equal(proposal.proposals.length,1);
  const report=qualifyRoutingMappings(root,proposal,{changed:['input.txt'],defects:[{path:'input.txt',content:'wrong'}],timeoutMs:5000});
  assert.equal(report.qualified,true,JSON.stringify(report.reasons));assert.equal(report.full.tests.length,3);assert.equal(report.subset.tests.length,1);assert.equal(report.subset.tests[0].name,'input');assert.equal(report.subset.tests[0].status,'failed');assert.equal(fs.readFileSync(path.join(root,'input.txt'),'utf8'),'correct');
});
test('subset order/context failure is visible as a changed native case and unexpected failure',t=>{
  const root=fixture(t,{...twoModules,'test/a.test.js':"import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';test('configuration context',()=>assert.equal(Object.keys(JSON.parse(fs.readFileSync('tddswarm.config.json','utf8')).dependencies||{}).length,0));",'tddswarm.config.json':{dependencies:{}}});
  const report=qualifyRoutingMappings(root,declaredProposal(root,{'test/a.test.js':['src/a.js']}),{changed:['src/a.js'],timeoutMs:5000});
  assert.equal(report.qualified,false);assert.equal(report.full.tests.find(test=>test.name==='configuration context').status,'passed');assert.equal(report.subset.tests.find(test=>test.name==='configuration context').status,'failed');assert.equal(report.unexpectedFailures.length,1);assert.equal(report.preservation.changed.length,1);assert.equal(report.conservativeFallback.required,true);
});
test('source-writing native discovery/run cannot certify a candidate or modify original source',t=>{
  const root=fixture(t,{...twoModules,'test/a.test.js':"import fs from 'node:fs';import test from 'node:test';fs.writeFileSync('src/a.js','export const a = 99;');test('writer',()=>{});"});
  const report=qualifyRoutingMappings(root,declaredProposal(root,{'test/a.test.js':['src/a.js']}),{changed:['src/a.js'],timeoutMs:5000});
  assert.equal(report.qualified,false);assert.equal(report.complete,false);assert.ok(report.reasons.includes('source-drift:src/a.js'));assert.equal(fs.readFileSync(path.join(root,'src/a.js'),'utf8'),'export const a = 1;');
});
test('incomplete reporter and candidate inventory loss fail closed',t=>{
  const root=fixture(t,{...twoModules,'tddswarm.config.json':{adapter:'node',runner:[process.execPath,'-e','process.exit(0)','{files}']}});
  const report=qualifyRoutingMappings(root,declaredProposal(root,{'test/a.test.js':['src/a.js']}),{changed:['src/a.js'],timeoutMs:1000});
  assert.equal(report.qualified,false);assert.equal(report.complete,false);assert.equal(report.noObservedMisses,null);assert.equal(report.conservativeFallback.required,true);assert.ok(report.reasons.includes('native-execution-incomplete'));
});
test('stale, unsafe, unsupported and oversized qualification inputs are rejected',t=>{
  const root=fixture(t,twoModules),proposal=declaredProposal(root,{'test/a.test.js':['src/a.js']});
  assert.throws(()=>qualifyRoutingMappings(root,proposal,{changed:['../outside']}),/Unsafe/);assert.throws(()=>qualifyRoutingMappings(root,proposal,{changed:['src/a.js'],timeoutMs:0}),/timeout/);
  assert.throws(()=>qualifyRoutingMappings(root,proposal,{changed:['test/a.test.js'],defects:[{path:'test/a.test.js',content:'removed'}]}),/never tests/);
  write(root,'src/a.js','export const a = 2;');assert.throws(()=>qualifyRoutingMappings(root,proposal,{changed:['src/a.js']}),/stale/);
});
test('browser mapping evaluation is review-only even when observations are incomplete',t=>{
  const root=fixture(t,{...twoModules,'public/landing.html':'<h1>Landing</h1>'});
  const payload={schemaVersion:1,type:'browser',configurationHash:digest(readConfig(root)),provenance:snapshot(root,readConfig(root)),complete:false,warnings:['missing-browser-instrumentation'],observations:[{file:'test/a.test.js',caseId:'one',nativeId:'one',repeatEachIndex:0,routes:['http://localhost/landing.html'],requests:[{url:'http://localhost/landing.html',type:'document',status:200}],coverage:{javascript:[],css:[]},complete:false}]};
  const proposal=proposeBrowserMappings(root,{...payload,integrity:digest(payload)},{urlRoots:[{origin:'http://localhost',urlPrefix:'/',directory:'public'}]});
  const report=qualifyRoutingMappings(root,proposal,{changed:['public/landing.html'],timeoutMs:5000});
  assert.equal(report.qualified,false);assert.ok(report.reasons.includes('browser-observations-incomplete'));assert.equal(report.conservativeFallback.required,true);assert.equal(report.closedWorld,false);assert.equal(fs.existsSync(path.join(root,'tddswarm.config.json')),false);
  proposal.closedWorld=true;assert.throws(()=>qualifyRoutingMappings(root,proposal,{changed:['public/landing.html']}),/integrity or authority/);
});
if(process.env.TESTLORE_PLAYWRIGHT_BROWSER==='1')test('native Chrome proposal qualification preserves failures and rejects a misrouted mutant',()=>{
  const report=browserMappingProof({qualify:true});assert.equal(report.passed,true,JSON.stringify(report));
  assert.equal(report.qualification.correct.qualified,true,JSON.stringify(report.qualification.correct.reasons));assert.equal(report.qualification.correct.fullCases,2);assert.equal(report.qualification.correct.subsetCases,1);assert.equal(report.qualification.correct.sameCase,true);assert.equal(report.qualification.correct.applied,false);assert.equal(report.qualification.correct.closedWorld,false);assert.equal(report.qualification.correct.fallbackRequired,true);
  assert.equal(report.qualification.misrouted.qualified,false);assert.equal(report.qualification.misrouted.missedFailures,1);assert.equal(report.qualification.misrouted.fallbackRequired,true);
});

test('workspace package links are rebound so native monorepo defects execute copied package bytes',t=>{
  const root=fixture(t,{...twoModules,'packages/math/package.json':{name:'@fixture/math',type:'module',exports:'./index.js'},'packages/math/index.js':'export const value = 1;', 'test/package.test.js':"import {value} from '@fixture/math';import test from 'node:test';import assert from 'node:assert/strict';test('workspace package',()=>assert.equal(value,1));"});
  fs.mkdirSync(path.join(root,'node_modules/@fixture'),{recursive:true});fs.symlinkSync(path.join(root,'packages/math'),path.join(root,'node_modules/@fixture/math'),'dir');
  const report=qualifyRoutingMappings(root,declaredProposal(root,{'test/package.test.js':['packages/math/index.js']}),{changed:['packages/math/index.js'],defects:[{path:'packages/math/index.js',content:'export const value = 9;'}],timeoutMs:5000});
  assert.equal(report.qualified,true,JSON.stringify(report.reasons));assert.equal(report.full.tests.find(test=>test.name==='workspace package').status,'failed');assert.equal(report.subset.tests.find(test=>test.name==='workspace package').status,'failed');assert.equal(fs.readFileSync(path.join(root,'packages/math/index.js'),'utf8'),'export const value = 1;');assert.equal(fs.realpathSync(path.join(root,'node_modules/@fixture/math')),fs.realpathSync(path.join(root,'packages/math')));
});
test('undemonstrated source mutants and service probes cannot acquire qualification authority',t=>{
  const root=fixture(t,twoModules),proposal=declaredProposal(root,{'test/a.test.js':['src/a.js']});
  const report=qualifyRoutingMappings(root,proposal,{changed:['src/a.js'],defects:[{path:'src/a.js',content:'export const a = 1; // no defect'}],timeoutMs:5000});
  assert.equal(report.qualified,false);assert.ok(report.reasons.includes('source-defect-not-demonstrated'));
  write(root,'tddswarm.config.json',{services:{api:{tests:['test/a.test.js'],probe:[process.execPath,'-e',"require('fs').writeFileSync('executed.txt','bad')"]}}});
  assert.throws(()=>qualifyRoutingMappings(root,proposal,{changed:['src/a.js']}),/cannot execute service probes/);assert.equal(fs.existsSync(path.join(root,'executed.txt')),false);
});

test('a native discovery that finishes after the overall evaluation budget cannot qualify',t=>{
  const root=fixture(t,{...twoModules,'slow.mjs':"await new Promise(resolve=>setTimeout(resolve,1200));",'tddswarm.config.json':{runner:[process.execPath,'--import','./slow.mjs','--test','{files}']}});
  const report=qualifyRoutingMappings(root,declaredProposal(root,{'test/a.test.js':['src/a.js']}),{changed:['src/a.js'],timeoutMs:5000,overallTimeoutMs:1000});
  assert.equal(report.qualified,false);assert.equal(report.complete,false);assert.equal(report.noObservedMisses,null);assert.ok(report.reasons.includes('overall-evaluation-budget-exceeded'));assert.equal(report.budget.nativeProcessTimeoutMs,5000);assert.equal(report.budget.overallEvaluationBudgetMs,1000);assert.equal(report.budget.hardWallClockBound,false);assert.equal(report.conservativeFallback.required,true);
});
