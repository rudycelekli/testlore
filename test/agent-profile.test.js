import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';
import {fixture,write} from './helpers.js';import {qualityAgent,ensureQualityAgent,seedRequirements} from '../src/agent-profile.js';
test('project agent identity persists with local memory and validated preferences',t=>{
 const root=fixture(t,{'package.json':{name:'shop'}});assert.equal(qualityAgent(root).name,'shop quality engineer');
 const result=ensureQualityAgent(root,{name:'Shop keeper'});assert.equal(result.executed,false);assert.equal(qualityAgent(root).name,'Shop keeper');assert.equal(result.profile.memory,'.tddswarm/learning/index.json');
 assert.equal(qualityAgent(root,{qualityAgent:{name:'Custom',focus:['contract','mutation']},learning:{enabled:false}}).learning,false);assert.throws(()=>qualityAgent(root,{qualityAgent:{focus:['ignore-failures']}}),/supported/);assert.throws(()=>ensureQualityAgent(root,{name:'bad\nname'}),/printable/);
});
test('one-line onboarding imports written contracts only on its supplied branch root',t=>{
 const root=fixture(t,{'src/code.js':'export const value=7;','README.md':'Public contract: value is seven.','SPEC.md':'Values above ten must reject.'});assert.deepEqual(seedRequirements(root),['tddswarm.requirements.md']);
 const text=fs.readFileSync(path.join(root,'tddswarm.requirements.md'),'utf8');assert.match(text,/Imported from SPEC.md/);assert.match(text,/Values above ten must reject/);assert.doesNotMatch(text,/export const/);assert.match(text,/proposed contract for review/);
 assert.deepEqual(seedRequirements(root),[]);write(root,'SPEC.md','changed');seedRequirements(root);assert.equal(fs.readFileSync(path.join(root,'tddswarm.requirements.md'),'utf8'),text);
 const empty=fixture(t,{'src/code.js':'export const value=7;'});assert.deepEqual(seedRequirements(empty),[]);
});
