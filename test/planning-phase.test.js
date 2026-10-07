import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {gitBaseline,gitSources} from '../src/files.js';
import {plan} from '../src/selector.js';
import {run} from '../src/runner.js';
import {fixture,write,commit,git,twoModules} from './helpers.js';

test('fresh combined baseline binds subdirectory prefixes and never retains a moved ref',t=>{
 const root=fixture(t,{'nested/project/a.js':'export const a=1;'});commit(root);
 const sub=path.join(root,'nested/project'),first=gitBaseline(sub);
 assert.equal(first.prefix,'nested/project/');assert.equal(first.baseSha,git(root,'rev-parse','HEAD').trim());
 write(root,'nested/project/a.js','export const a=2;');git(root,'add','.');git(root,'commit','-m','new baseline');
 assert.notEqual(gitBaseline(sub).baseSha,first.baseSha);
 assert.throws(()=>gitBaseline(sub,'not-a-real-ref'));
});

test('one bounded blob batch preserves byte-sized Unicode and newline filenames and skips new paths',t=>{
 const texts={'nested/a.js':'export const a="🧪";\n','nested/b\nc.js':'export const b=2;\n','nested/c.js':'export const c=3;\n'};
 const root=fixture(t,texts);commit(root);const sub=path.join(root,'nested'),scope=gitBaseline(sub);
 const actual=gitSources(sub,scope.baseSha,scope.prefix,['a.js','new\nsource.js','b\nc.js','c.js']);
 assert.deepEqual(actual,[['a.js',texts['nested/a.js']],['b\nc.js',texts['nested/b\nc.js']],['c.js',texts['nested/c.js']]]);
 assert.throws(()=>gitSources(root,scope.baseSha,'',['../outside.js']),/Unsafe/);
 assert.throws(()=>gitSources(root,'HEAD','',['nested/a.js']),/immutable/);
});

test('multiple removed imports retain all historical consumer paths in the batched plan',t=>{
 const files={...twoModules,'src/c.js':'export const c=3;','src/shared.js':'export const x=1;'};
 for(const leaf of ['a','b','c'])files[`src/${leaf}.js`]=`import './shared.js'; export const ${leaf}=1;`;
 files['test/c.test.js']="import '../src/c.js';";const root=fixture(t,files);commit(root);
 for(const leaf of ['a','b','c'])write(root,`src/${leaf}.js`,`export const ${leaf}=1;`);
 write(root,'src/shared.js','export const x=9;');const result=plan(root);
 for(const leaf of ['a','b','c'])assert.ok(result.decisions.find(d=>d.test===`test/${leaf}.test.js`).paths.some(chain=>chain.includes('src/shared.js')));
});

test('unsupported batch Git preserves baseline reads but malformed successful batches reject',t=>{
 const root=fixture(t,{'a.js':'export const a=1;','b.js':'export const b=2;','c.js':'export const c=3;'});commit(root);
 const scope=gitBaseline(root),bin=path.join(root,'.tddswarm/bin');fs.mkdirSync(bin,{recursive:true});
 const shim=path.join(bin,'git');
 const install=behavior=>{fs.writeFileSync(shim,`#!${process.execPath}\nimport {spawnSync} from 'node:child_process';const argv=process.argv.slice(2);if(argv.includes('cat-file')){${behavior}}else{const x=spawnSync('/usr/bin/git',argv,{stdio:'inherit'});process.exit(x.status??2);}`);fs.chmodSync(shim,0o755);};
 const oldPath=process.env.PATH;process.env.PATH=bin+path.delimiter+oldPath;
 try {
  install('process.exit(129);');assert.deepEqual(gitSources(root,scope.baseSha,'',['a.js','b.js','c.js']).map(row=>row[0]),['a.js','b.js','c.js']);
  install("process.stdout.write('forged blob 1\\nx\\n');");assert.throws(()=>gitSources(root,scope.baseSha,'',['a.js','b.js','c.js']),/Invalid Git source batch/);
 } finally {process.env.PATH=oldPath;}
});

test('planning resolution cache discards missing and positive aliases at the next invocation',t=>{
 const root=fixture(t,{...twoModules,'tsconfig.json':{compilerOptions:{baseUrl:'.',paths:{'@subject':['src/missing.js']}}},'test/a.test.js':"import '@subject';"});
 assert.equal(plan(root,{changed:['src/a.js']}).selected.length,2);
 write(root,'src/missing.js','export const value=1;');
 const next=plan(root,{changed:['src/missing.js']});assert.deepEqual(next.selected,['test/a.test.js']);
 write(root,'tsconfig.json',{compilerOptions:{baseUrl:'.',paths:{'@subject':['src/b.js']}}});
 assert.deepEqual(plan(root,{changed:['src/b.js']}).selected,['test/a.test.js','test/b.test.js']);
});

test('inventory reuse cannot authorize omissions after discovery creates an input',t=>{
 const discovery="import fs from 'node:fs';fs.writeFileSync('src/new.js','export const x=1;');console.log(JSON.stringify({files:['test/a.test.js','test/b.test.js'],complete:true}));";
 const root=fixture(t,{...twoModules,'discover.mjs':discovery,'tddswarm.config.json':{discovery:[process.execPath,'discover.mjs']}});commit(root);
 write(root,'src/a.js','export const a=9;');const result=run(root,{capture:true,selective:true});
 assert.equal(result.exitCode,2);assert.equal(result.executed,false);assert.match(result.error,/Inputs changed during selection/);
 assert.ok(result.decisionDrift.includes('source-drift:src/new.js'));
 assert.equal(fs.existsSync(path.join(root,'.tddswarm/last-run.json')),false);
});

test('fabricated inventory options cannot replace independently discovered failing tests',t=>{
 const root=fixture(t,twoModules);commit(root);write(root,'src/a.js','export const a=9;');
 const result=run(root,{capture:true,selective:true,planningInputs:{files:[],config:{}},files:[]});
 assert.equal(result.exitCode,1);assert.equal(result.complete,true);assert.deepEqual(result.executedTests,['test/a.test.js']);
 assert.equal(result.tests.filter(row=>row.status==='failed').length,1);
});
