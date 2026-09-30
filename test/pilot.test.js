import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import { pilot, validatePilotManifest, exportPilot } from '../src/pilot.js';
import { fixture, commit, git, twoModules, write } from './helpers.js';

function manifest(root) { return {schemaVersion:1,repetitions:2,timeoutMs:5000,projects:[{name:'controlled',root,scope:'two native Node cases',config:{adapter:'node',discovery:'native'},changes:[{name:'comment',file:'src/a.js',before:'export const a = 1;',after:'export const a = 1; // edit',expectedFailure:false},{name:'fault',file:'src/a.js',before:'export const a = 1;',after:'export const a = 9;',expectedFailure:true}]}]}; }
test('pilot preflight is read-only and exact-patch guarded',t=>{
  const root=fixture(t,twoModules);commit(root);
  const before=git(root,'status','--porcelain');assert.equal(pilot(root,manifest(root)).executed,false);
  assert.equal(git(root,'status','--porcelain'),before);assert.equal(fs.existsSync(path.join(root,'.tddswarm')),false);
  const bad=manifest(root);bad.projects[0].changes[0].before='absent';assert.throws(()=>pilot(root,bad),/exactly once/);
  write(root,'dirty.txt','dirty');assert.throws(()=>pilot(root,manifest(root)),/clean/);
});
test('actual isolated pilot measures both orders, catches a planted failure, and preserves source checkout',t=>{
  const root=fixture(t,twoModules);commit(root);
  const output=fixture(t,{'.gitignore':'.tddswarm/\n'});
  const revision=git(root,'rev-parse','HEAD'), source=fs.readFileSync(path.join(root,'src/a.js'),'utf8');
  const report=pilot(output,manifest(root),{execute:true,output:'.tddswarm/pilots/first'});
  assert.equal(report.valid,true,JSON.stringify(report));assert.equal(report.projects[0].sourceCheckoutUnchanged,true);
  const changes=report.projects[0].changes;
  assert.deepEqual(changes[0].trials.map(t=>t.order),[['full','subset','native'],['subset','native','full']]);
  assert.ok(changes[1].trials.every(t=>t.fullFailures===1&&t.missedFailures===0&&t.selectedFiles===1));
  assert.equal(git(root,'rev-parse','HEAD'),revision);assert.equal(git(root,'status','--porcelain'),'');assert.equal(fs.readFileSync(path.join(root,'src/a.js'),'utf8'),source);
  assert.throws(()=>pilot(output,manifest(root),{execute:true,output:'.tddswarm/pilots/first'}),/exist/i);
  const aggregate=exportPilot(report);assert.equal(aggregate.validTrials,4);assert.equal(aggregate.observedFailures,2);
  assert.ok(!JSON.stringify(aggregate).includes(root));assert.ok(!JSON.stringify(aggregate).includes('controlled'));assert.ok(!JSON.stringify(aggregate).includes('src/a'));
  const invalid=structuredClone(report);invalid.projects[0].changes[1].trials[0].valid=false;invalid.projects[0].changes[1].trials[0].missedFailures=1;
  assert.equal(exportPilot(invalid).missedFailures,1,'A missed failure must remain visible even when it invalidates a trial');
});
test('pilot rejects credential injection, unsafe patches, unbounded trials and incomplete baselines',t=>{
  const root=fixture(t,{'package.json':{type:'module'},'.gitignore':'.tddswarm/\n','a.js':'export const a=1;','a.test.js':"import test from 'node:test'; test('bad',()=>{throw Error('bad')});"});commit(root);
  const value={schemaVersion:1,repetitions:1,timeoutMs:5000,projects:[{name:'failed',root,scope:'Node',config:{adapter:'node',discovery:'native'},changes:[{name:'comment',file:'a.js',before:'export const a=1;',after:'export const a=1;// edit',expectedFailure:false}]}]};
  assert.throws(()=>validatePilotManifest({...value,repetitions:99}),/repetitions/);
  assert.throws(()=>validatePilotManifest({...value,projects:[{...value.projects[0],config:{...value.projects[0].config,env:{API_KEY:'secret'}}}]}),/credential/);
  assert.throws(()=>validatePilotManifest({...value,projects:[{...value.projects[0],changes:[{...value.projects[0].changes[0],file:'../a.js'}]}]}),/Unsafe/);
  const output=fixture(t,{});const report=pilot(output,value,{execute:true});assert.equal(report.valid,false);assert.match(report.projects[0].error,/Baseline/);
});
test('current native full scope follows a config expansion instead of the baseline inventory',t=>{
  const runner=fileURLToPath(new URL('../node_modules/jest/bin/jest.js',import.meta.url));
  const root=fixture(t,{'.gitignore':'.tddswarm/\n','jest.config.cjs':"module.exports={testMatch:['**/one.test.cjs']};",'one.test.cjs':"test('one',()=>expect(1).toBe(1));",'two.test.cjs':"test('two',()=>expect(2).toBe(2));"});commit(root);
  const m={schemaVersion:1,repetitions:1,timeoutMs:10000,projects:[{name:'scope',root,scope:'Native Jest',config:{adapter:'jest',discovery:'native',runner:[process.execPath,runner,'--runInBand','{files}']},changes:[{name:'expand',file:'jest.config.cjs',before:'one.test.cjs',after:'*.test.cjs',expectedFailure:false}]}]};
  const report=pilot(fixture(t,{}),m,{execute:true});assert.equal(report.valid,true,JSON.stringify(report));assert.equal(report.projects[0].baseline.files,1);const trial=report.projects[0].changes[0].trials[0];assert.equal(trial.totalFiles,2);assert.equal(trial.fullCases,2);assert.equal(trial.subsetCases,2);
});
test('native discovery cannot silently change the baseline source',t=>{
  const root=fixture(t,{...twoModules,'test/a.test.js':"import fs from 'node:fs';fs.writeFileSync('src/b.js','export const b = 2;');import test from 'node:test';test('a',()=>{});",'src/b.js':'export const b = 99;','test/b.test.js':"import test from 'node:test';test('b',()=>{});"});commit(root);
  const report=pilot(fixture(t,{}),manifest(root),{execute:true});assert.equal(report.valid,false);assert.match(report.projects[0].error,/stable/);
});
test('pilot replacements preserve dollar tokens literally',t=>{
  const root=fixture(t,{...twoModules,'src/a.js':"export const a = 'old';",'test/a.test.js':"import {a} from '../src/a.js';import test from 'node:test';import assert from 'node:assert/strict';test('string',()=>assert.ok(['old','$&'].includes(a)));"});commit(root);
  const m=manifest(root);m.repetitions=1;m.projects[0].changes=[{name:'literal',file:'src/a.js',before:"'old'",after:"'$&'",expectedFailure:false}];const report=pilot(fixture(t,{}),m,{execute:true});assert.equal(report.valid,true,JSON.stringify(report));
});
