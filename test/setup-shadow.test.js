import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {fixture,commit,twoModules,write} from './helpers.js';
import {digest} from '../src/provenance.js';
const cli=fileURLToPath(new URL('../src/cli.js',import.meta.url));
function setup(root,extra=[],environment={}){const env={...process.env,...environment};delete env.NODE_TEST_CONTEXT;return spawnSync(process.execPath,[cli,'setup','--root',root,'--no-ci','--json',...extra],{env,encoding:'utf8',timeout:120000});}
function installed(root,name,bin){
 write(root,`node_modules/${name}/package.json`,{name,version:'1.0.0',main:'index.js'});
 write(root,`node_modules/${name}/index.js`,'throw new Error("Setup must not import installed add-ons");');
 if(bin){write(root,`node_modules/${name}/bin/tool.js`,'#!/usr/bin/env node\nrequire("node:fs").writeFileSync("FORBIDDEN_ADDON_EXECUTION","yes");');fs.chmodSync(path.join(root,`node_modules/${name}/bin/tool.js`),0o755);fs.mkdirSync(path.join(root,'node_modules/.bin'),{recursive:true});fs.symlinkSync(path.relative(path.join(root,'node_modules/.bin'),path.join(root,`node_modules/${name}/bin/tool.js`)),path.join(root,'node_modules/.bin',bin));}
}
function memory(root){
 // Intact synthetic episode for setup admission only; no measured learning gain.
 const manifestHash=digest('setup-fixture'),payload={schemaVersion:1,id:digest({manifestHash,outcome:'accepted'}),candidateId:'setup-fixture',createdAt:'2026-09-01T00:00:00.000Z',manifestHash,validationHash:digest('validation'),provenance:Object.fromEntries(['fingerprint','runner','servicesHash','sourceHash'].map(key=>[key,digest(key)])),framework:'node',outcome:'accepted',tags:[],warnings:[],context:{language:'javascript',changedTests:1,deletedFiles:0,purpose:'candidate-tests'},evidence:{originalCases:1,candidateCases:2,passedCases:2,failedCases:0,missingCases:0,demonstratedDefects:0,caughtDefects:0,complete:true},patterns:[]};
 const value={schemaVersion:1,records:[{...payload,integrity:digest(payload)}]};write(root,'.tddswarm/learning/index.json',{...value,integrity:digest(value)});
}
test('one-command verification immediately records real full shadow evidence and preserves failure exits',t=>{
 const root=fixture(t,twoModules);commit(root);
 fs.writeFileSync(path.join(root,'src/a.js'),'export const a = 999;');
 const attempt=setup(root,['--verify']);assert.equal(attempt.status,1,attempt.stderr);
 const result=JSON.parse(attempt.stdout),report=JSON.parse(fs.readFileSync(path.join(root,'.tddswarm/last-run.json')));
 assert.equal(result.verification.complete,true);assert.equal(result.verification.shadow,true);assert.equal(result.verification.tests.length,2);
 assert.equal(result.verification.tests.filter(t=>t.status==='failed').length,1);assert.equal(result.verification.tests.filter(t=>t.status==='passed').length,1);
 assert.equal(report.exitCode,1);assert.equal(report.shadow,true);assert.equal(result.verification.plan.decisions.length,2);
 assert.ok(result.next.includes('testlore report'));assert.equal(JSON.parse(fs.readFileSync(path.join(root,'tddswarm.config.json'))).executionMode,'shadow');
});
test('default one-command setup enables only complementary installed add-ons without probes or provider disclosure',t=>{
 const root=fixture(t,{'package.json':{name:'installed-fit',devDependencies:{c8:'1','@stryker-mutator/core':'1',nx:'1'},scripts:{postinstall:'touch FORBIDDEN_ADDON_EXECUTION'}},'nx.json':{}});
 for(const [name,bin] of [['c8','c8'],['@stryker-mutator/core','stryker'],['nx','nx'],['agentic-qe','aqe'],['@ruvector/core']])installed(root,name,bin);memory(root);
 const providerFixture='synthetic-provider-value-not-for-disclosure',attempt=setup(root,[],{OPENAI_API_KEY:providerFixture});assert.equal(attempt.status,0,attempt.stderr);
 const result=JSON.parse(attempt.stdout),config=JSON.parse(fs.readFileSync(path.join(root,'tddswarm.config.json')));
 assert.deepEqual(result.plugins.applied,['c8','stryker','ruvector']);assert.equal(result.plugins.execution.selected,'core');
 for(const id of result.plugins.applied)assert.deepEqual(config.plugins[id],{enabled:true});
 assert.equal(config.plugins.nx,undefined);assert.equal(config.plugins['agentic-qe'],undefined);assert.equal(config.executionMode,'shadow');assert.equal(result.executionMode,'shadow');
 assert.equal(result.verification,undefined);assert.equal(fs.existsSync(path.join(root,'FORBIDDEN_ADDON_EXECUTION')),false);assert.equal((attempt.stdout+attempt.stderr).includes(providerFixture),false);
 assert.ok(result.plugins.decisions.find(item=>item.id==='nx').reasons.some(reason=>reason.includes('preserves the existing execution profile')));
 const again=setup(root);assert.equal(again.status,0,again.stderr);assert.deepEqual(JSON.parse(again.stdout).plugins.applied,[]);
});
test('setup retains explicit disabled add-ons and records missing installations without downloading',t=>{
 const root=fixture(t,{'package.json':{name:'partial-fit',devDependencies:{c8:'1','@stryker-mutator/core':'1'}},'tddswarm.config.json':{adapter:'node',executionMode:'shadow',plugins:{c8:{enabled:false},'agentic-qe':{enabled:false}}}});installed(root,'c8','c8');
 const attempt=setup(root);assert.equal(attempt.status,0,attempt.stderr);const result=JSON.parse(attempt.stdout),config=JSON.parse(fs.readFileSync(path.join(root,'tddswarm.config.json')));
 assert.deepEqual(result.plugins.applied,[]);assert.deepEqual(config.plugins.c8,{enabled:false});assert.deepEqual(config.plugins['agentic-qe'],{enabled:false});
 assert.equal(result.plugins.decisions.find(item=>item.id==='c8').action,'retain');assert.equal(result.plugins.decisions.find(item=>item.id==='stryker').action,'skip');
 assert.ok(result.plugins.decisions.find(item=>item.id==='stryker').reasons.some(reason=>reason.includes('installation is missing')));
 assert.equal(fs.existsSync(path.join(root,'node_modules/@stryker-mutator/core')),false);assert.equal(fs.existsSync(path.join(root,'package-lock.json')),false);assert.equal(fs.existsSync(path.join(root,'FORBIDDEN_ADDON_EXECUTION')),false);
});
test('automatic add-on configuration followed by verify preserves full shadow outcomes and the failing exit',t=>{
 const root=fixture(t,{...twoModules,'package.json':{type:'module',devDependencies:{c8:'1','@stryker-mutator/core':'1'}}});installed(root,'c8','c8');installed(root,'@stryker-mutator/core','stryker');commit(root);write(root,'src/a.js','export const a = 999;');
 const attempt=setup(root,['--verify']);assert.equal(attempt.status,1,attempt.stderr);const result=JSON.parse(attempt.stdout);
 assert.deepEqual(result.plugins.applied,['c8','stryker']);assert.equal(result.verification.complete,true);assert.equal(result.verification.shadow,true);assert.equal(result.verification.tests.length,2);
 assert.equal(result.verification.tests.filter(item=>item.status==='failed').length,1);assert.equal(result.verification.tests.filter(item=>item.status==='passed').length,1);
 assert.equal(JSON.parse(fs.readFileSync(path.join(root,'tddswarm.config.json'))).executionMode,'shadow');assert.equal(fs.existsSync(path.join(root,'FORBIDDEN_ADDON_EXECUTION')),false);
});
test('ordinary setup remains runner-free and verification cannot silently mean selective execution',t=>{
 const root=fixture(t,{...twoModules,'tddswarm.config.json':{adapter:'node',runner:[process.execPath,'-e',"require('node:fs').writeFileSync('runner-started','yes')",'{files}']}});commit(root);
 const attempt=setup(root);assert.equal(attempt.status,0,attempt.stderr);assert.equal(JSON.parse(attempt.stdout).verification,undefined);assert.equal(fs.existsSync(path.join(root,'runner-started')),false);
 const invalid=setup(root,['--verify','--selective']);assert.equal(invalid.status,2);assert.match(invalid.stderr,/full shadow/);assert.equal(fs.existsSync(path.join(root,'runner-started')),false);
 const misuse=spawnSync(process.execPath,[cli,'plan','--verify','--root',root],{encoding:'utf8'});assert.equal(misuse.status,2);assert.match(misuse.stderr,/only to setup/);
});
