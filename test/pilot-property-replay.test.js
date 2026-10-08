import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawnSync} from 'node:child_process';
import {preparePropertyReplay,validatePropertyReplay,observePropertyReplay,PROPERTY_REPLAY_FILES} from '../src/pilot-property-replay.js';
function fixture(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'property-replay-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));fs.writeFileSync(path.join(root,'vitest.config.js'),'export default {test:{projects:[{extends:true,test:{name:"domain",isolate:false}}]}};');return root;}
const replay={schemaVersion:1,seed:104729,originalConfig:'vitest.config.js'};
const runner=['node','node_modules/vitest/vitest.mjs','run','--config','vitest.config.js','--project','domain','{files}'];
test('explicit profile preserves original bytes and binds exact wrapper/setup bytes',t=>{
 const root=fixture(t),before=fs.readFileSync(path.join(root,'vitest.config.js'));const result=preparePropertyReplay(root,replay,runner);
 assert.deepEqual(fs.readFileSync(path.join(root,'vitest.config.js')),before);assert.equal(result.runner[4],PROPERTY_REPLAY_FILES[0]);assert.equal(runner[4],'vitest.config.js');assert.equal(result.metadata.inputReplayCertified,false);assert.equal(Object.keys(result.metadata.files).length,2);
 assert.deepEqual(preparePropertyReplay(root,replay,runner),result);
});
test('replay is optional and rejects malformed policies, path escapes and duplicate config',t=>{
 assert.deepEqual(preparePropertyReplay('/unused',undefined,runner),{runner,files:[],metadata:null});
 for(const value of [null,{...replay,seed:1.5},{...replay,seed:2147483648},{...replay,seed:'104729'},{...replay,originalConfig:'../vitest.config.js'},{...replay,numRuns:1},{...replay,schemaVersion:2}])assert.throws(()=>validatePropertyReplay(value));
 const root=fixture(t);for(const args of [runner.filter(x=>x!=='--config'),[...runner,'--config=vitest.config.js'],runner.map(x=>x==='vitest.config.js'?'other.config.js':x)])assert.throws(()=>preparePropertyReplay(root,replay,args));
});
test('refuses upstream config symlinks and overlay collisions',t=>{
 const root=fixture(t);fs.writeFileSync(path.join(root,PROPERTY_REPLAY_FILES[1]),'upstream owned');assert.throws(()=>preparePropertyReplay(root,replay,runner),/collision/);
 fs.rmSync(path.join(root,'vitest.config.js'));fs.writeFileSync(path.join(root,'other.js'),'{}');fs.symlinkSync('other.js',path.join(root,'vitest.config.js'));assert.throws(()=>preparePropertyReplay(root,replay,runner),/ordinary/);
});
test('generated setup preserves prior budgets, rejects conflicting defaults and emits actual globals',t=>{
 const root=fixture(t);preparePropertyReplay(root,replay,runner);
 const fc=path.join(root,'node_modules','fast-check');fs.mkdirSync(fc,{recursive:true});fs.writeFileSync(path.join(fc,'package.json'),JSON.stringify({name:'fast-check',type:'module',exports:'./index.js'}));
 fs.writeFileSync(path.join(fc,'index.js'),`let config={numRuns:73,interruptAfterTimeLimit:999};export default {readConfigureGlobal:()=>config,configureGlobal:value=>config=value};`);
 const run=spawnSync(process.execPath,[PROPERTY_REPLAY_FILES[1]],{cwd:root,encoding:'utf8'});assert.equal(run.status,0,run.stderr);
 const observation=JSON.parse(run.stdout.trim().replace('TESTLORE_PROPERTY_REPLAY ',''));assert.equal(observation.seed,104729);assert.equal(observation.numRuns,73);
 fs.writeFileSync(path.join(fc,'index.js'),`let config={seed:42};export default {readConfigureGlobal:()=>config,configureGlobal:value=>config=value};`);
 const conflict=spawnSync(process.execPath,[PROPERTY_REPLAY_FILES[1]],{cwd:root,encoding:'utf8'});assert.notEqual(conflict.status,0);assert.match(conflict.stderr,/conflicts/);
});
test('seed observation rejects explicit overrides and missing metadata, retains raw names',()=>{
 const name='contract (with seed=104729)',rows=[{file:'case.test.ts',name,status:'passed'}];const result=observePropertyReplay(rows,104729);assert.equal(result.complete,true);assert.equal(result.cases[0].name,name);assert.equal(result.inputReplayCertified,false);
 assert.equal(observePropertyReplay([{...rows[0],name:'contract (with seed=42)'}],104729).complete,false);assert.equal(observePropertyReplay([{...rows[0],name:'contract'}],104729).complete,false);
 assert.equal(observePropertyReplay([{...rows[0],name:'contract (with seed=104729) suffix'}],104729).complete,false);
});
test('wrapper rejects inherited parallel setup and preserves project isolation',async t=>{
 const root=fixture(t),vitest=path.join(root,'node_modules/vitest');fs.mkdirSync(vitest,{recursive:true});fs.writeFileSync(path.join(vitest,'package.json'),JSON.stringify({name:'vitest',type:'module',exports:{'./config':'./config.js'}}));fs.writeFileSync(path.join(vitest,'config.js'),'export const defineConfig=value=>value;');
 fs.writeFileSync(path.join(root,'package.json'),'{"type":"module"}');preparePropertyReplay(root,replay,runner);
 let run=spawnSync(process.execPath,['--input-type=module','-e',`const {default:config}=await import('./${PROPERTY_REPLAY_FILES[0]}');console.log(JSON.stringify(await config({})));`],{cwd:root,encoding:'utf8'});assert.equal(run.status,0,run.stderr);const config=JSON.parse(run.stdout);assert.equal(config.test.projects[0].test.isolate,false);assert.equal(config.test.sequence.setupFiles,'list');assert.equal(config.test.setupFiles.at(-1),'./'+PROPERTY_REPLAY_FILES[1]);
 fs.writeFileSync(path.join(root,'vitest.config.js'),'export default {test:{projects:[{extends:true,test:{name:"domain",sequence:{setupFiles:"parallel"}}}]}};');
 run=spawnSync(process.execPath,['--input-type=module','-e',`const {default:config}=await import('./${PROPERTY_REPLAY_FILES[0]}');await config({});`],{cwd:root,encoding:'utf8'});assert.notEqual(run.status,0);assert.match(run.stderr,/only supports inline projects/);
});
