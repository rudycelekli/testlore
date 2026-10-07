import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fixture,write,twoModules} from './helpers.js';
import {plan} from '../src/selector.js';
import {digest} from '../src/provenance.js';
import {diagnoseFallbackSelection,fallbackDiagnostics,validateFallbackDiagnostics,qualifyFallbackHypotheses} from '../src/fallback-diagnostics.js';
import {fallbackCampaign} from '../scripts/fallback-campaign.js';
const reseal=value=>{const {integrity,...payload}=value;return {...payload,integrity:digest(payload)};};

test('retained diagnostics distinguish global policy, unmapped scope and closure warnings without asserting omissions safe',t=>{
  const root=fixture(t,{...twoModules,'unverified.html':'page','src/a.js':"import fs from 'node:fs';export const a=1;"});
  const selection=plan(root,{changed:['.gitignore','unverified.html']}),report=diagnoseFallbackSelection(selection);
  assert.deepEqual(report.causes.map(entry=>entry.kind),['configuration','unmapped-input']);assert.equal(report.changes.find(entry=>entry.input==='unverified.html').category,'browser-or-asset');
  assert.ok(report.warnings.some(entry=>entry.effect==='retain-uncertain-consumers'));assert.equal(report.omitted,0);assert.equal(report.freshnessVerified,false);assert.equal(report.closedWorld,false);
  const selective=diagnoseFallbackSelection(plan(root,{changed:['src/a.js']}));assert.equal(selective.omissions[0].test,'test/b.test.js');assert.match(selective.omissions[0].explanation,/not an independent safety proof/);
});

test('native inventory or inconsistent decisions cannot silently manufacture omission explanations',t=>{
  const root=fixture(t,twoModules),selection=plan(root,{changed:['src/a.js']});
  assert.throws(()=>diagnoseFallbackSelection({...selection,selected:[]}),/scope/);
  const bad=structuredClone(selection);bad.decisions[0].paths=[['test/b.test.js','src/a.js']];assert.throws(()=>diagnoseFallbackSelection(bad),/origin/);
  assert.throws(()=>diagnoseFallbackSelection({...selection,warnings:[{file:'../outside',reason:'runtime-dependency',scope:'global'}]}),/Unsafe|Invalid/);
  assert.throws(()=>diagnoseFallbackSelection({...selection,changed:Array(10001).fill('a')}),/over-bound/);
  assert.throws(()=>diagnoseFallbackSelection({...selection,mode:'full'}),/cannot omit/);
  assert.throws(()=>diagnoseFallbackSelection({...selection,ignored:['not-changed']}),/outside changed/);
});

test('current diagnosis binds source, configuration and producer and never executes configured service probes',t=>{
  const root=fixture(t,{...twoModules,'data.json':'{}'}),selection=plan(root,{changed:['data.json']}),report=fallbackDiagnostics(root,selection);
  assert.equal(validateFallbackDiagnostics(root,report).valid,true);assert.equal(report.summary.freshnessVerified,true);assert.equal(report.applied,false);
  const changed=structuredClone(report);changed.producer.sha256='0'.repeat(64);assert.throws(()=>validateFallbackDiagnostics(root,reseal(changed)),/integrity/);
  const unsupported=structuredClone(report);unsupported.summary.changes[0].mapped=true;assert.throws(()=>validateFallbackDiagnostics(root,reseal(unsupported)),/summary/);
  const authority=structuredClone(report);authority.closedWorld=true;assert.throws(()=>validateFallbackDiagnostics(root,reseal(authority)),/authority/);
  write(root,'data.json','{"drift":true}');assert.throws(()=>validateFallbackDiagnostics(root,report),/stale/);assert.throws(()=>fallbackDiagnostics(root,selection),/stale/);
  write(root,'tddswarm.config.json',{services:{api:{tests:['test/a.test.js'],probe:[process.execPath,'-e',"require('fs').writeFileSync('probe-ran','bad')"]}}});
  assert.throws(()=>fallbackDiagnostics(root,selection),/cannot execute service probes/);assert.equal(fs.existsSync(path.join(root,'probe-ran')),false);
});

test('literal test references propose an exact reviewed input and independently preserve an asset assertion failure',t=>{
  const root=fixture(t,{...twoModules,'banner.txt':'healthy','test/a.test.js':"import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';test('asset health',()=>assert.equal(fs.readFileSync('banner.txt','utf8'),'healthy'));"});
  const selection=plan(root,{changed:['banner.txt']}),report=fallbackDiagnostics(root,selection),entry=report.literalHypotheses.find(entry=>entry.input==='banner.txt');
  assert.equal(selection.mode,'full');assert.deepEqual(entry.tests,['test/a.test.js']);assert.equal(entry.closedWorld,false);assert.equal(entry.evidence.sourceHash,digest(fs.readFileSync(path.join(root,'test/a.test.js'))));
  const qualified=qualifyFallbackHypotheses(root,report,{hypothesisIds:[entry.id],changed:['banner.txt'],defects:[{path:'banner.txt',content:'broken'}],timeoutMs:5000});
  assert.equal(qualified.qualified,true,JSON.stringify(qualified.reasons));assert.equal(qualified.full.tests.length,2);assert.equal(qualified.subset.tests.length,1);assert.equal(qualified.full.tests.find(entry=>entry.name==='asset health').status,'failed');assert.equal(qualified.subset.tests[0].status,'failed');
  assert.equal(qualified.proposalEvidence.completenessVerified,false);assert.equal(qualified.proposalEvidence.legacyManual,true);assert.equal(qualified.closedWorld,false);assert.equal(qualified.applied,false);assert.equal(qualified.fallbackDiagnosticIntegrity,report.integrity);
  assert.equal(fs.readFileSync(path.join(root,'banner.txt'),'utf8'),'healthy');assert.equal(fs.existsSync(path.join(root,'tddswarm.config.json')),false);
  const forged=structuredClone(report);forged.literalHypotheses[0].patch.dependencies['test/b.test.js']=['banner.txt'];assert.throws(()=>qualifyFallbackHypotheses(root,reseal(forged),{hypothesisIds:[entry.id],changed:['banner.txt']}),/literal evidence/);
});

test('a literal without an effective assertion is rejected by an independent defect challenge',t=>{
  const root=fixture(t,{...twoModules,'banner.txt':'healthy','test/a.test.js':"import test from 'node:test';test('decorative literal',()=>{const name='banner.txt';});"});
  const report=fallbackDiagnostics(root,plan(root,{changed:['banner.txt']})),entry=report.literalHypotheses[0];
  const challenge=qualifyFallbackHypotheses(root,report,{hypothesisIds:[entry.id],changed:['banner.txt'],defects:[{path:'banner.txt',content:'broken'}],timeoutMs:5000});
  assert.equal(challenge.qualified,false);assert.ok(challenge.reasons.includes('source-defect-not-demonstrated'));assert.equal(challenge.closedWorld,false);assert.equal(challenge.conservativeFallback.required,true);
  assert.throws(()=>qualifyFallbackHypotheses(root,report,{hypothesisIds:['fabricated'],changed:['banner.txt']}),/Unknown/);
});

test('missing test prerequisites stay incomplete and required full fallback is retained',t=>{
  const root=fixture(t,{...twoModules,'banner.txt':'healthy','test/a.test.js':"import test from 'node:test';test('asset',()=>{const input='banner.txt';throw new Error('assertion');});"});
  write(root,'tddswarm.config.json',{runner:['missing-native-runner','{files}'],adapter:'node'});
  const report=fallbackDiagnostics(root,plan(root,{changed:['banner.txt']}));
  const result=qualifyFallbackHypotheses(root,report,{hypothesisIds:[report.literalHypotheses[0].id],changed:['banner.txt'],timeoutMs:1000});
  assert.equal(result.complete,false);assert.equal(result.noObservedMisses,null);assert.equal(result.qualified,false);assert.ok(result.reasons.includes('native-execution-incomplete'));assert.equal(result.conservativeFallback.required,true);
});

test('receipt campaign validates all retained inputs, preserves earlier output and exports no private labels',t=>{
  const root=fixture(t,twoModules),selection=plan(root,{changed:['README.md']}),receipts=path.join(root,'receipts'),output=path.join(root,'out');
  write(root,'receipts/private-repo/change-0-trial-0-plan.json',selection);
  const summary=fallbackCampaign(receipts,output);assert.equal(summary.plans,1);assert.equal(summary.fullFallbackPlans,1);assert.equal(summary.causeOccurrences['unmapped-input'],1);assert.equal(summary.freshnessVerified,false);assert.equal(summary.nativeExecution,false);assert.equal(JSON.stringify(summary).includes('private-repo'),false);
  assert.throws(()=>fallbackCampaign(receipts,output),/EEXIST/);assert.equal(JSON.parse(fs.readFileSync(path.join(output,'summary.json'))).plans,1);
  write(root,'receipts/private-repo/change-1-trial-0-plan.json',{...selection,selected:[]});const next=path.join(root,'next');assert.throws(()=>fallbackCampaign(receipts,next),/scope/);assert.equal(fs.existsSync(next),false);
});
