import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fixture,commit,twoModules} from './helpers.js';
import {digest} from '../src/provenance.js';
import {validateCorpus,runCorpus,assessCorpus} from '../scripts/regression-corpus.js';

function corpus(root){return {schemaVersion:1,pilot:{schemaVersion:1,repetitions:2,timeoutMs:10000,projects:[{name:'assertions',root,scope:'Two exact native Node assertion cases',config:{adapter:'node',discovery:'native'},changes:[{name:'fault',file:'src/a.js',before:'export const a = 1;',after:'export const a = 9;',expectedFailure:true}]}]},labels:[{project:'assertions',change:'fault',expectedFailureNames:['a'],oracleFiles:[{path:'test/a.test.js',sha256:digest(fs.readFileSync(path.join(root,'test/a.test.js')))}],origin:{kind:'authored',maintainer:'Test fixture',independenceNotes:'Explicit a=1 expectation, separately executed. Constructed test, no external independence claim.'}}]};}
test('regression corpus preserves named independent failures, omits unrelated files and retains bad evidence',t=>{
  const source=fixture(t,twoModules);commit(source);const root=fixture(t,{}),manifest=corpus(source);
  const aggregate=runCorpus(root,manifest,'.tddswarm/pilots/native');
  assert.equal(aggregate.qualified,true,JSON.stringify(aggregate));assert.equal(aggregate.faultOpportunities,2);assert.equal(aggregate.preservedFaultTrials,2);assert.equal(aggregate.stableScenarios,1);assert.equal(aggregate.selectiveTrials,2);assert.equal(aggregate.pilot.caseObservations.testLore,2);assert.equal(aggregate.pilot.caseObservations.full,4);
  assert.throws(()=>runCorpus(root,manifest,'.tddswarm/pilots/native'),/exist/i);assert.ok(!JSON.stringify(aggregate).includes(source));
  const report=JSON.parse(fs.readFileSync(path.join(root,'.tddswarm/pilots/native/pilot/summary.json')));
  const evidence=path.join(report.output,'assertions/change-0-trial-1-full.json'),run=JSON.parse(fs.readFileSync(evidence));
  run.tests.find(test=>test.name==='a').name='different assertion';fs.writeFileSync(evidence,JSON.stringify(run));
  const unstable=assessCorpus(report,manifest.labels);assert.equal(unstable.qualified,false);assert.equal(unstable.stableScenarios,0);assert.equal(unstable.independentlyDemonstratedFaultTrials,1);
  run.tests[0].name='<file-load>';fs.writeFileSync(evidence,JSON.stringify(run));assert.equal(assessCorpus(report,manifest.labels).qualified,false);
  report.projects[0].changes[0].trials.pop();const incomplete=assessCorpus(report,manifest.labels);assert.equal(incomplete.uncompletedTrials,1);assert.equal(incomplete.qualified,false);
});
test('regression labels reject changed test oracles, false public-history claims and unnamed failures',t=>{
  const root=fixture(t,twoModules);commit(root);const original=corpus(root);assert.equal(validateCorpus(original),original);
  const mutated=structuredClone(original);mutated.labels[0].oracleFiles[0].sha256='0'.repeat(64);assert.throws(()=>validateCorpus(mutated),/oracle/);
  const load=structuredClone(original);load.labels[0].expectedFailureNames=['<file-load>'];assert.throws(()=>validateCorpus(load),/named/);
  const source=structuredClone(original);source.pilot.projects[0].changes[0].file='test/a.test.js';assert.throws(()=>validateCorpus(source),/test oracle/);
  const fake=structuredClone(original);fake.labels[0].origin.kind='public-bugfix-inversion';assert.throws(()=>validateCorpus(fake),/pinned/);
  const historic=structuredClone(original);historic.labels[0].origin.kind='repository-history';assert.throws(()=>validateCorpus(historic),/immutable/);
});
test('post-pilot controller failures recover completed evidence instead of resetting counts',t=>{
  const source=fixture(t,twoModules);commit(source);const root=fixture(t,{}),manifest=corpus(source),original=fs.writeFileSync;let failed=false;
  fs.writeFileSync=function(file,...args){const result=original.call(this,file,...args);if(!failed&&String(file).endsWith('/pilot/summary.json')){failed=true;throw new Error('deliberate private controller failure');}return result;};
  let result;try{result=runCorpus(root,manifest,'.tddswarm/pilots/recovery');}finally{fs.writeFileSync=original;}
  assert.equal(failed,true);assert.equal(result.qualified,false);assert.equal(result.completedTrials,2);assert.equal(result.preservedFaultTrials,2);assert.equal(result.uncompletedTrials,0);assert.equal(result.implementationUnchanged,true);assert.match(result.implementationIdentity.sourceRevision,/^[a-f0-9]{40}$/);assert.ok(result.implementationIdentity.implementationHashes['src/pilot-worker.js']);assert.ok(result.implementationIdentity.implementationHashes['scripts/evaluation-commitment.js']);assert.equal(JSON.stringify(result).includes('deliberate private'),false);
});
