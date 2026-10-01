import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { plan } from '../src/selector.js';
import { run } from '../src/runner.js';
import { execute, resolveNativeBatch } from '../src/execution.js';
import { digest } from '../src/provenance.js';
import { fixture,write,commit,twoModules } from './helpers.js';
const requireHere=createRequire(import.meta.url);
function tool(packageName, executable, explicit) {
 try { return explicit || path.join(path.dirname(requireHere.resolve(`${packageName}/package.json`)),executable); }
 catch { return undefined; }
}
const jest=tool('jest','bin/jest.js',process.env.TDDSWARM_JEST_BIN);
const vitest=tool('vitest','vitest.mjs',process.env.TDDSWARM_VITEST_BIN);
function jestFixture(t,mapper,specifier='@subject',extra={}) {
 const config={discovery:'native',runner:[process.execPath,jest,'--config=settings.cjs','--runInBand','{files}']};
 const root=fixture(t,{'package.json':{type:'commonjs'},'settings.cjs':`module.exports={testEnvironment:'node',testMatch:['**/test/*.test.cjs'],moduleNameMapper:${JSON.stringify(mapper)}};`,'tsconfig.json':{compilerOptions:{baseUrl:'.',paths:{'@subject':['src/a.js']}}},'src/a.js':'module.exports=1;','src/b.js':'module.exports=1;','test/a.test.cjs':`const value=require(${JSON.stringify(specifier)});test('subject',()=>expect(value).toBe(1));`,'test/b.test.cjs':`const value=require('../src/b.js');test('b',()=>expect(value).toBe(1));`,'tddswarm.config.json':config,...extra});
 return {root,config};
}
if(jest) {
 for(const [name,mapper,spec] of [['TypeScript alias',{'^@subject$':'<rootDir>/src/b.js'},'@subject'],['relative import',{'^\\.\\./src/a\\.js$':'<rootDir>/src/b.js'},'../src/a.js']]) test(`real Jest native mapper overrides ${name} without omitting its consumer`,t=>{
  const {root,config}=jestFixture(t,mapper,spec);write(root,'src/b.js','module.exports=2;');
  const selection=plan(root,{changed:['src/b.js']});assert.deepEqual(selection.selected,['test/a.test.cjs','test/b.test.cjs'],JSON.stringify(selection));
  const full=execute(root,selection.selected,config,{capture:true});assert.equal(full.complete,true);assert.equal(full.tests.filter(t=>t.status==='failed').length,2);
 });
 test('real Jest arbitrary --config path and imported settings are global inputs despite explicit test mapping',t=>{
  const {root,config}=jestFixture(t,{},'@subject',{'settings.cjs':`const aliases=require('./aliases.cjs');module.exports={testEnvironment:'node',moduleNameMapper:aliases,testMatch:['**/test/*.test.cjs']};`,'aliases.cjs':`module.exports={'^@subject$':'<rootDir>/src/a.js'};`});
  config.dependencies={'test/b.test.cjs':['settings.cjs','aliases.cjs']};write(root,'tddswarm.config.json',config);
  for(const changed of ['settings.cjs','aliases.cjs']){const p=plan(root,{changed:[changed]});assert.equal(p.mode,'full');assert.ok(p.reasons.includes('global-configuration-changed'),JSON.stringify(p));}
 });
 test('one native batch resolves 1000 imports with one framework configuration load',t=>{
  const {root,config}=jestFixture(t,{'^@subject$':'<rootDir>/src/b.js'},'@subject',{'settings.cjs':`const fs=require('fs');const p='.tddswarm/config-loads';fs.mkdirSync('.tddswarm',{recursive:true});fs.appendFileSync(p,'x');module.exports={testEnvironment:'node',moduleNameMapper:{'^@subject$':'<rootDir>/src/b.js'}};`});
  const result=resolveNativeBatch(root,Array.from({length:1000},()=>({file:'test/a.test.cjs',specifier:'@subject'})),config);
  assert.equal(result.complete,true,JSON.stringify(result));assert.equal(result.resolutions.length,1000);assert.ok(result.resolutions.every(r=>r.paths.includes('src/b.js')));assert.equal(fs.readFileSync(path.join(root,'.tddswarm/config-loads'),'utf8'),'x');
 });
}
if(vitest) for(const [label,argv,env,expression] of [
 ['split mode',['--mode','production'],{},`mode==='production'`],['equal mode',['--mode=production'],{},`mode==='production'`],
 ['effective NODE_ENV and VITEST',[],{},`process.env.NODE_ENV==='test' && process.env.VITEST==='true'`],
 ['explicit NODE_ENV',[],{NODE_ENV:'production'},`process.env.NODE_ENV==='production' && process.env.VITEST==='true'`],
 ['native serve config flags',[],{},`isSsrBuild===false && isPreview===false`]
])test(`real Vitest ${label} config resolves the actual consumer`,t=>{
 const config={discovery:'native',env,runner:[process.execPath,vitest,'run',...argv,'{files}']};
 const root=fixture(t,{'package.json':{type:'module'},'vitest.config.mjs':`export default ({mode,isSsrBuild,isPreview})=>({resolve:{alias:{'@subject':new URL(${expression}? './src/b.js':'./src/a.js',import.meta.url).pathname}},test:{include:['test/*.test.js'],maxWorkers:1}});`,'src/a.js':'export default 1;','src/b.js':'export default 1;','test/a.test.js':`import {test,expect} from 'vitest';import value from '@subject';test('subject',()=>expect(value).toBe(1));`,'test/b.test.js':`import {test,expect} from 'vitest';import value from '../src/b.js';test('b',()=>expect(value).toBe(1));`,'tddswarm.config.json':config});
 fs.symlinkSync(path.dirname(path.dirname(vitest)),path.join(root,'node_modules'),'dir');
 write(root,'src/b.js','export default 2;');const selection=plan(root,{changed:['src/b.js']});assert.deepEqual(selection.selected,['test/a.test.js','test/b.test.js'],JSON.stringify(selection));
 if(label==='native serve config flags'){assert.equal(selection.mode,'affected');assert.ok(selection.decisions[0].paths.some(chain=>chain.at(-1)==='src/b.js'));}
 const full=execute(root,selection.selected,config,{capture:true});assert.equal(full.complete,true,JSON.stringify(full));assert.equal(full.tests.filter(t=>t.status==='failed').length,2);
});
test('custom tsconfig and its arbitrarily named extends file invalidate globally',t=>{
 const root=fixture(t,{...twoModules,'settings.json':{extends:'./compiler-base.json'},'compiler-base.json':{compilerOptions:{allowJs:true}},'tddswarm.config.json':{tsconfig:'settings.json',dependencies:{'test/b.test.js':['settings.json','compiler-base.json']},ignoreChanges:['settings.json']}});
 for(const changed of ['settings.json','compiler-base.json']){const p=plan(root,{changed:[changed]});assert.ok(p.reasons.includes('global-configuration-changed'),JSON.stringify(p));}
});
function probeFixture(t,body){
 const config={services:{catalog:{tests:['test/a.test.js'],probe:[process.execPath,'.tddswarm/probe.cjs']}}};
 const root=fixture(t,{...twoModules,'tddswarm.config.json':config,'.tddswarm/probe.cjs':`const fs=require('fs');const file='.tddswarm/count';let n=0;try{n=Number(fs.readFileSync(file,'utf8'))}catch{}fs.writeFileSync(file,String(++n));${body}`});
 fs.mkdirSync(path.join(root,'.tddswarm'),{recursive:true});write(root,'.tddswarm/services.json',{'service:catalog':digest('1')});commit(root);write(root,'src/b.js','export const b=2;');return root;
}
test('service version changes between plan and execution reject before running or remembering',t=>{
 const root=probeFixture(t,`console.log(n<=2?'1':'2');`);const result=run(root,{capture:true});assert.equal(result.exitCode,2);assert.equal(result.executed,false);assert.deepEqual(result.plan.selected,['test/b.test.js']);assert.equal(fs.existsSync(path.join(root,'.tddswarm/last-run.json')),false);
});
test('source mutation during plan after Git change collection rejects its obsolete selection',t=>{
 const root=probeFixture(t,`if(n===2)fs.writeFileSync('src/a.js','export const a=2;');console.log('1');`);const result=run(root,{capture:true});assert.equal(result.exitCode,2);assert.equal(result.executed,false);assert.deepEqual(result.plan.selected,['test/b.test.js']);assert.ok(result.decisionDrift.includes('source-drift:src/a.js'));
});
test('Node package self imports resolved only through type declarations cannot authorize omission',t=>{
 const root=fixture(t,{'package.json':{type:'module',name:'subject',exports:{types:'./types/index.d.ts',import:'./src/a.js'}},'types/index.d.ts':'export const a:number;','src/a.js':'export const a=1;','test/alias.test.js':`import test from 'node:test';import {a} from 'subject';test('alias',()=>{});`,'test/direct.test.js':`import test from 'node:test';import {a} from '../src/a.js';test('direct',()=>{});`});
 const selection=plan(root,{changed:['src/a.js']});assert.equal(selection.mode,'affected');assert.deepEqual(selection.selected,['test/alias.test.js','test/direct.test.js']);
});
if(vitest)test('unsupported Vitest project resolution refuses to certify a static alias',t=>{
 const root=fixture(t,{'package.json':{type:'module'},'src/a.js':'export default 1;','test/a.test.js':`import value from '../src/a.js';`});
 const result=resolveNativeBatch(root,[{file:'test/a.test.js',specifier:'../src/a.js'}],{runner:[process.execPath,vitest,'run','--project=unknown','{files}']});
 assert.equal(result.complete,false);assert.equal(result.resolutions[0].unresolved,true);
});
