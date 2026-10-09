import test from 'node:test';
import assert from 'node:assert/strict';
import {plan} from '../src/selector.js';
import {fixture} from './helpers.js';

for(const explicit of [true,false])test(`Bun zero-import scopes retain global fallback with ${explicit?'explicit':'inferred'} adapter`,t=>{
 const root=fixture(t,{'package.json':{type:'module'},'src/a.js':'export const value=1;',
  'test/a.test.js':'globalThis.testState=1;', 'test/b.test.js':'globalThis.testState=2;',
  'tddswarm.config.json':{...(explicit?{adapter:'bun'}:{}),runner:['bun','test','{files}'],discovery:'static'}});
 const selection=plan(root,{changed:['src/a.js']});
 assert.equal(selection.mode,'full');assert.equal(selection.omitted,0);
 assert.equal(selection.total,2);assert.ok(selection.warnings.some(w=>w.reason==='incomplete-native-resolution'));
});
