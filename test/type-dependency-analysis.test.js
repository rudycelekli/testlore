import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {analyze,buildGraph,addSource,classifyWarnings,dependencies} from '../src/graph.js';
import {createAnalysisCache} from '../src/graph-cache.js';
import {plan} from '../src/selector.js';
import {fixture,write} from './helpers.js';

test('runtime import hints distinguish declarations from inline, mixed and dynamic occurrences',()=>{
 const info=analyze('src/consumer.ts',`import type {A} from './declaration'; export type {B} from './export'; import type C = require('./equals'); import {type D} from './inline'; export {type E} from './inline-export'; import type {F} from './mixed'; import './mixed'; import('./dynamic'); require('./required');`);
 assert.deepEqual(info.imports,['./declaration','./export','./equals','./inline','./inline-export','./mixed','./dynamic','./required']);
 assert.deepEqual(info.runtimeImports,['./inline','./inline-export','./mixed','./dynamic','./required']);
 const broken=analyze('broken.ts',"import type {A} from './a'; export const =");assert.ok(broken.warnings.includes('parse-error'));assert.deepEqual(broken.runtimeImports,[]);
 const builtin=analyze('types.ts',"import type {Stats} from 'node:fs'; export type {Stats} from 'node:fs';");assert.deepEqual(builtin.runtimeImports,[]);assert.ok(builtin.warnings.includes('runtime-dependency'));
});

const files={
 'src/uncertain.ts':"import fs from 'node:fs'; export interface A {}; export const value=fs.readFileSync('input','utf8');",
 'src/consumer.ts':"import type {A} from './uncertain'; export const value=1;",
 'src/other.ts':'export const other=1;',
 'test/consumer.test.ts':"import {value} from '../src/consumer';",
 'test/other.test.ts':"import {other} from '../src/other';"
};
test('syntax runtime edges cannot suppress type consumers or uncertainty with unknown configuration',t=>{
 const root=fixture(t,files),graph=buildGraph(root);
 assert.deepEqual(graph.edges['src/consumer.ts'],['src/uncertain.ts']);assert.deepEqual(graph.runtimeEdges['src/consumer.ts'],[]);
 assert.ok(dependencies(graph,'test/consumer.test.ts').includes('src/uncertain.ts'));
 const uncertainty=graph.warnings.find(item=>item.file==='src/uncertain.ts'&&item.reason==='runtime-dependency');
 assert.equal(uncertainty.scope,'test-closure');assert.deepEqual(uncertainty.tests,['test/consumer.test.ts']);
 for(const changed of ['src/uncertain.ts','src/other.ts'])assert.ok(plan(root,{changed:[changed]}).selected.includes('test/consumer.test.ts'));
 // Caller-supplied hints are not an admission mechanism, even if they contain
 // a purported exact version, standard plugin name or successful canary.
 graph.runtimeEdges={};graph.typeErasure={qualified:true,vitest:'5.0.2',plugins:['vite:oxc'],canary:true};classifyWarnings(graph);
 assert.equal(uncertainty.scope,'test-closure');assert.deepEqual(uncertainty.tests,['test/consumer.test.ts']);
});

test('runtime hints preserve old value edges and alternative runtime paths',t=>{
 const root=fixture(t,files),graph=buildGraph(root),set=new Set(graph.files);
 addSource(graph,'src/consumer.ts',"import {value} from './uncertain';",set);
 addSource(graph,'src/consumer.ts',"import type {A} from './uncertain';",set);
 assert.deepEqual(graph.runtimeEdges['src/consumer.ts'],['src/uncertain.ts']);
 addSource(graph,'src/other.ts',"export {value} from './uncertain';",set);
 assert.deepEqual(graph.runtimeEdges['src/other.ts'],['src/uncertain.ts']);
 const legacy={...graph,edges:{'src/consumer.ts':['src/uncertain.ts']}};delete legacy.runtimeEdges;
 addSource(legacy,'src/consumer.ts',"import type {A} from './uncertain';",set);
 assert.deepEqual(legacy.runtimeEdges['src/consumer.ts'],['src/uncertain.ts']);
});

test('declared dependency edges retain runtime status even when syntax sees a type declaration',t=>{
 const root=fixture(t,{...files,'tddswarm.config.json':{dependencies:{'test/consumer.test.ts':['src/uncertain.ts']}}});
 const graph=buildGraph(root);assert.ok(graph.runtimeEdges['test/consumer.test.ts'].includes('src/uncertain.ts'));
});

test('cache binds type hints, rejects missing or non-subset metadata, and preserves cold/warm fallback',t=>{
 const root=fixture(t,{...files,'tddswarm.config.json':{analysisCache:{enabled:true}}});
 const cold=buildGraph(root),warm=buildGraph(root);assert.deepEqual(warm.edges,cold.edges);assert.deepEqual(warm.runtimeEdges,cold.runtimeEdges);assert.deepEqual(warm.warnings,cold.warnings);assert.ok(warm.analysisCache.diskHits>0);
 const directory=path.join(root,'.tddswarm/analysis-cache/v2');
 for(const variant of ['missing','outside']){
  for(const name of fs.readdirSync(directory).filter(file=>file.endsWith('.json'))){
   const file=path.join(directory,name),record=JSON.parse(fs.readFileSync(file));
   if(variant==='missing')delete record.result.runtimeImports;else record.result.runtimeImports=['invented/runtime-authority'];
   const {integrity,...payload}=record;record.integrity=createHash('sha256').update(JSON.stringify(payload)).digest('hex');fs.writeFileSync(file,JSON.stringify(record));
  }
  const corrupt=buildGraph(root);assert.equal(corrupt.analysisCache.diskHits,0);assert.ok(corrupt.analysisCache.corruptions>0);assert.deepEqual(corrupt.runtimeEdges,cold.runtimeEdges);assert.deepEqual(corrupt.warnings,cold.warnings);
 }
 const cache=createAnalysisCache(null,{},'a'.repeat(64));
 assert.deepEqual(cache.analyze('old.ts','old',()=>({imports:['./runtime'],warnings:[]})),{imports:['./runtime'],runtimeImports:['./runtime'],warnings:[]});
});

test('fresh native Vitest canaries expose import/export erasure differences, plugin rewrites and value regressions',t=>{
 const repository=fileURLToPath(new URL('../',import.meta.url)),cli=path.join(repository,'node_modules/vitest/vitest.mjs');
 const root=fixture(t,{
  'package.json':{type:'module'},'tsconfig.json':{compilerOptions:{verbatimModuleSyntax:true}},
  'src/effect.ts':"throw new Error('type-canary-side-effect'); export interface Marker {};",
  'src/declaration.ts':"import type {Marker} from './effect'; export type {Marker} from './effect'; export const value=1;",
  'src/inline.ts':"import {type Marker} from './effect'; export const value=1;",
  'src/inline-export.ts':"export {type Marker} from './effect'; export const value=1;",
  'test/native.test.ts':"import {test,expect} from 'vitest'; import {value} from '../src/declaration'; test('declaration type is erased',()=>expect(value).toBe(1)); test('inline type import retains side effects',async()=>expect(import('../src/inline')).rejects.toThrow('type-canary-side-effect')); test('native inline type export is erased',async()=>expect((await import('../src/inline-export')).value).toBe(1));"
 });
 fs.symlinkSync(path.join(repository,'node_modules'),path.join(root,'node_modules'),'dir');
 const config="export default {test:{include:['test/*.test.ts'],maxWorkers:1,watch:false,typecheck:{enabled:false}}};";write(root,'vitest.config.mjs',config);
 function native(label){
  const report=path.join(root,label+'.json'),result=spawnSync(process.execPath,[cli,'run','--config','vitest.config.mjs','--reporter=json','--outputFile='+report],{cwd:root,env:{PATH:process.env.PATH,HOME:root,TMPDIR:process.env.TMPDIR},encoding:'utf8',timeout:30000,maxBuffer:4*1024*1024});
  assert.equal(result.error,undefined,result.error?.message);assert.equal(result.signal,null);assert.ok(fs.existsSync(report),result.stdout+result.stderr);return {result,report:JSON.parse(fs.readFileSync(report))};
 }
 const clean=native('clean');assert.equal(clean.result.status,0,clean.result.stdout+clean.result.stderr+JSON.stringify(clean.report));assert.equal(clean.report.numPassedTests,3);assert.equal(clean.report.numFailedTests,0);assert.equal(clean.report.testResults[0].assertionResults.length,3);
 write(root,'src/declaration.ts',"import type {Marker} from './effect'; export const value=2;");const mutation=native('value-regression');assert.equal(mutation.result.status,1);assert.equal(mutation.report.numFailedTests,1);assert.equal(mutation.report.testResults[0].assertionResults.find(item=>item.status==='failed').title,'declaration type is erased');
 write(root,'src/declaration.ts',"import type {Marker} from './effect'; export const value=1;");
 write(root,'vitest.config.mjs',"export default {plugins:[{name:'vite:oxc',enforce:'pre',transform(code,id){if(id.endsWith('/src/declaration.ts'))return code.replace(\"import type {Marker} from './effect';\",\"import './effect';\");}}],test:{include:['test/*.test.ts'],maxWorkers:1,watch:false,typecheck:{enabled:false}}};");
 const rewrite=native('impersonated-plugin');assert.equal(rewrite.result.status,1);assert.match(JSON.stringify(rewrite.report),/type-canary-side-effect/);assert.equal(rewrite.report.testResults[0].status,'failed');
});
