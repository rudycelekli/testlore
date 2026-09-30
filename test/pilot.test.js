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
  assert.ok(changes.every(change=>change.trials.every(trial=>trial.nativeScopeComplete&&trial.nativeCasePreservation.complete)));
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
function historical(root, baseRevision, headRevision, config = {}) {
  return {schemaVersion:1,repetitions:1,timeoutMs:10000,projects:[{name:'history',root,scope:'Native Node history scope',config:{adapter:'node',discovery:'native',...config},changes:[{name:'real-commit',kind:'history',baseRevision,headRevision,expectedFailure:false}]}]};
}
function revisionCommit(root) { git(root,'add','.');git(root,'commit','-m','historical change');return git(root,'rev-parse','HEAD').trim(); }
test('historical replay uses actual rename/delete/assets/multi-file trees and leaves originals unchanged',t=>{
  const root=fixture(t,{...twoModules,'unused.js':'export const unused=1;','public/style.css':'body { color: red; }'});commit(root);
  const base=git(root,'rev-parse','HEAD').trim();
  git(root,'mv','src/a.js','src/renamed.js');write(root,'test/a.test.js',twoModules['test/a.test.js'].replace('../src/a.js','../src/renamed.js'));
  fs.rmSync(path.join(root,'unused.js'));write(root,'public/style.css','body { color: blue; }');
  const head=revisionCommit(root), output=fixture(t,{}), m=historical(root,base,head);
  const preview=pilot(output,m);const info=preview.projects[0].historicalChanges[0];
  assert.equal(info.dependencyCompatible,true);assert.ok(info.entries.some(e=>e.status.startsWith('R')));assert.ok(info.entries.some(e=>e.status==='D'));
  const report=pilot(output,m,{execute:true});assert.equal(report.valid,true,JSON.stringify(report));
  assert.equal(report.projects[0].changes[0].history.headRevision,head);
  assert.ok(report.projects[0].changes[0].changedPaths.includes('src/a.js'));assert.ok(report.projects[0].changes[0].changedPaths.includes('src/renamed.js'));
  assert.equal(git(root,'rev-parse','HEAD').trim(),head);assert.equal(git(root,'status','--porcelain'),'');
  assert.equal(exportPilot(report).historicalChanges,1);
});
test('history rejects mutable refs and retains dependency/runtime drift as invalid evidence',t=>{
  const root=fixture(t,twoModules);commit(root);const base=git(root,'rev-parse','HEAD').trim();
  write(root,'package.json',{type:'module',engines:{node:'>=24'}});const head=revisionCommit(root),m=historical(root,base,head),output=fixture(t,{});
  const bad=structuredClone(m);bad.projects[0].changes[0].baseRevision='HEAD~1';assert.throws(()=>validatePilotManifest(bad),/immutable/);
  assert.equal(pilot(output,m).projects[0].historicalChanges[0].dependencyCompatible,false);
  const report=pilot(output,m,{execute:true});assert.equal(report.valid,false);assert.match(report.projects[0].changes[0].error,/dependency-or-runtime-drift/);
  const aggregate=exportPilot(report);assert.equal(aggregate.requestedTrials,1);assert.equal(aggregate.uncompletedTrials,1);assert.equal(aggregate.changeErrors,1);assert.equal(aggregate.sourceCheckoutsVerifiedUnchanged,1);
});
test('a native failing case omitted by a deliberately unsound input policy remains a miss in aggregates',t=>{
  const root=fixture(t,{...twoModules,'input.txt':'1','test/a.test.js':"import {a} from '../src/a.js';import fs from 'node:fs';import test from 'node:test';import assert from 'node:assert/strict';test('a',()=>assert.equal(Number(fs.readFileSync(process.cwd()+'/input.txt','utf8')),a));"});commit(root);
  const base=git(root,'rev-parse','HEAD').trim();write(root,'input.txt','9');const head=revisionCommit(root),m=historical(root,base,head,{ignoreChanges:['input.txt']});m.projects[0].changes[0].expectedFailure=true;
  const report=pilot(fixture(t,{}),m,{execute:true});assert.equal(report.valid,false,JSON.stringify(report));
  const trial=report.projects[0].changes[0].trials[0];assert.equal(trial.fullFailures,1);assert.equal(trial.missedFailures,1);assert.equal(trial.valid,false);
  assert.equal(exportPilot(report).missedFailures,1);
});
test('historical workspace dependencies load the isolated revision rather than the original checkout',t=>{
  const root=fixture(t,{'package.json':{type:'module',workspaces:['packages/local']},'.gitignore':'.tddswarm/\nnode_modules/\n','packages/local/package.json':{name:'local-pilot-package',type:'module',exports:'./index.js'},'packages/local/index.js':'export const value=1;','test/local.test.js':"import {value} from 'local-pilot-package';import test from 'node:test';import assert from 'node:assert/strict';test('workspace source',()=>assert.equal(value,1));"});commit(root);
  const base=git(root,'rev-parse','HEAD').trim();write(root,'packages/local/index.js','export const value=9;');const head=revisionCommit(root);
  fs.mkdirSync(path.join(root,'node_modules'));fs.symlinkSync(path.join(root,'packages/local'),path.join(root,'node_modules/local-pilot-package'),'dir');
  const m=historical(root,base,head);m.projects[0].changes[0].expectedFailure=true;
  const report=pilot(fixture(t,{}),m,{execute:true});assert.equal(report.valid,true,JSON.stringify(report));assert.equal(report.projects[0].dependencies.isolatedWorkspaceLinks,1);assert.equal(report.projects[0].changes[0].trials[0].fullFailures,1);
});
test('aggregate preserves missing worker trials and unknown source/native verification',()=>{
  const report={schemaVersion:1,executed:true,repetitions:2,projects:[{valid:false,requestedChanges:3,error:'Worker did not finish',changes:[]}]};
  const aggregate=exportPilot(report);assert.equal(aggregate.trials,0);assert.equal(aggregate.requestedTrials,6);assert.equal(aggregate.uncompletedTrials,6);assert.equal(aggregate.validProjects,0);assert.equal(aggregate.sourceCheckoutsUnverified,1);
  const old={schemaVersion:1,executed:true,repetitions:1,projects:[{changes:[{trials:[{nativeValid:true}]}]}]};
  assert.equal(exportPilot(old).nativeValidTrials,0);assert.equal(exportPilot(old).nativeUnverifiedTrials,1);
  assert.equal(exportPilot({schemaVersion:1,executed:true,projects:[{}]}).uncompletedTrials,null);
});
