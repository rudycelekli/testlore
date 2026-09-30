import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { discover, execute, resolveNative } from '../src/execution.js';
import { fixture, write } from './helpers.js';

test('native Node discovery reconciles documented test-directory names and test-name patterns',t=>{
  const root=fixture(t,{'package.json':{type:'module'},'test/foo.js':`import test from 'node:test';test('foo',()=>{});`,'lib/test-bar.cjs':`require('node:test').test('bar',()=>{});`,'outside.spec.js':'','outside.js':''});
  const report=discover(root,{discovery:'native'});
  assert.equal(report.complete,true,JSON.stringify(report));
  assert.deepEqual(report.files,['lib/test-bar.cjs','test/foo.js']);
  assert.equal(execute(root,report.files,{}, {capture:true}).complete,true);
});

test('custom discovery argv must explicitly report completeness and safe files',t=>{
  const root=fixture(t,{'suite/custom.js':'', 'list.cjs':`console.log(JSON.stringify({files:['suite/custom.js'],complete:true}));`});
  const report=discover(root,{discovery:['node','list.cjs']});
  assert.deepEqual(report.files,['suite/custom.js']);assert.equal(report.complete,true);
  write(root,'list.cjs',`console.log(JSON.stringify({files:['../outside.js'],complete:true}));`);
  assert.equal(discover(root,{discovery:['node','list.cjs']}).complete,false);
});

test('failed native discovery preserves fallback tests and declares incomplete scope',t=>{
  const root=fixture(t,{'good.test.js':'', 'list.cjs':'process.exit(4);'});
  const report=discover(root,{discovery:['node','list.cjs']});
  assert.equal(report.complete,false);assert.deepEqual(report.files,['good.test.js']);assert.match(report.warnings[0],/failed/);
});

const requireHere=createRequire(import.meta.url);
function tool(name, explicit) { try{return explicit || requireHere.resolve(name);} catch{return undefined;} }
const jest=tool('jest/bin/jest',process.env.TDDSWARM_JEST_BIN);
const vitest=tool('vitest/vitest.mjs',process.env.TDDSWARM_VITEST_BIN);

if(jest) test('real Jest native discovery, exact file execution, outcomes and moduleNameMapper resolution',t=>{
  const root=fixture(t,{'package.json':{type:'commonjs'},'jest.config.cjs':`module.exports={testMatch:['**/suite/check-*.cjs'],moduleNameMapper:{'^@domain/(.*)$':'<rootDir>/src/$1.js'},testEnvironment:'node'};`,'src/value.js':'module.exports=7;','suite/check-one.cjs':`const value=require('@domain/value');describe('group',()=>{test('pass',()=>expect(value).toBe(7));test.skip('skip',()=>{});});`,'suite/check-two.cjs':`test('fail',()=>expect(1).toBe(2));`,'outside.test.js':`throw new Error('out of config scope');`});
  const config={runner:[process.execPath,jest,'--runInBand','{files}'],discovery:'native'};
  const found=discover(root,config);
  assert.equal(found.complete,true,JSON.stringify(found));assert.deepEqual(found.files,['suite/check-one.cjs','suite/check-two.cjs']);
  const one=execute(root,['suite/check-one.cjs'],config,{capture:true});
  assert.equal(one.exitCode,0,JSON.stringify(one));assert.equal(one.complete,true);
  assert.deepEqual(one.tests.map(x=>[x.name,x.status]),[['group pass','passed'],['group skip','skipped']]);
  const full=execute(root,found.files,config,{capture:true});
  assert.equal(full.exitCode,1);assert.equal(full.complete,true);assert.equal(full.tests.filter(t=>t.status==='failed').length,1);
  assert.equal(resolveNative(root,'suite/check-one.cjs','@domain/value',config),'src/value.js');
  write(root,'src/other.js','module.exports=9;');
  write(root,'jest.config.cjs',`module.exports={testMatch:['**/suite/check-*.cjs'],moduleNameMapper:{'^@domain/value$':'<rootDir>/src/other.js'},testEnvironment:'node'};`);
  assert.equal(resolveNative(root,'suite/check-one.cjs','@domain/value',config),'src/other.js');
});

if(vitest) test('real Vitest native discovery, filtered execution, outcomes and Vite aliases',t=>{
  // Link only tooling for imports; it is never treated as source evidence.
  const root=fixture(t,{'package.json':{type:'module'},'vitest.config.mjs':`import {defineConfig} from 'vitest/config';import {fileURLToPath} from 'node:url';export default defineConfig({resolve:{alias:{'@domain':fileURLToPath(new URL('./src',import.meta.url))}},test:{include:['suite/check-*.js'],maxWorkers:1,minWorkers:1}});`,'src/value.js':'export const value=7;','suite/check-one.js':`import {test,expect,describe} from 'vitest';import {value} from '@domain/value';describe('group',()=>{test('pass',()=>expect(value).toBe(7));test.skip('skip',()=>{});});`,'suite/check-two.js':`import {test,expect} from 'vitest';test('fail',()=>expect(1).toBe(2));`,'outside.test.js':`throw new Error('outside configured scope');`});
  const dependencyRoot=path.dirname(path.dirname(vitest));
  fs.symlinkSync(dependencyRoot,path.join(root,'node_modules'),'dir');
  const config={runner:[process.execPath,vitest,'run','{files}'],discovery:'native'};
  const found=discover(root,config);
  assert.equal(found.complete,true,JSON.stringify(found));assert.deepEqual(found.files,['suite/check-one.js','suite/check-two.js']);
  const one=execute(root,['suite/check-one.js'],config,{capture:true});
  assert.equal(one.exitCode,0,JSON.stringify(one));assert.equal(one.complete,true);
  assert.deepEqual(one.tests.map(x=>[x.name.trim(),x.status]),[['group pass','passed'],['group skip','skipped']]);
  const full=execute(root,found.files,config,{capture:true});
  assert.equal(full.exitCode,1,JSON.stringify(full));assert.equal(full.complete,true);assert.equal(full.tests.filter(t=>t.status==='failed').length,1);
  assert.equal(resolveNative(root,'suite/check-one.js','@domain/value',config),'src/value.js');
});
