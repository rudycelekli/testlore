import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fixture,write} from './helpers.js';
import {recommendPlugins} from '../src/plugin-recommendations.js';
import {configurePluginsAutomatically,configurePlugin,checkPlugins} from '../src/plugins.js';
import {readConfig} from '../src/files.js';

function presence(root){
 write(root,'node_modules/typescript/package.json',{name:'typescript',version:'6.0.3'});
 write(root,'node_modules/typescript/lib/typescript.js','throw Error("Static inspection must not import the SDK");');
 write(root,'node_modules/typescript/bin/tsc','#!/usr/bin/env node\nrequire("fs").writeFileSync("FORBIDDEN_EXECUTION","yes");');
 fs.chmodSync(path.join(root,'node_modules/typescript/bin/tsc'),0o755);fs.mkdirSync(path.join(root,'node_modules/.bin'),{recursive:true});fs.symlinkSync('../typescript/bin/tsc',path.join(root,'node_modules/.bin/tsc'));
}
test('setup recommends local type verification alongside runtime execution without running compiler code',t=>{
 const root=fixture(t,{'package.json':{name:'example',devDependencies:{typescript:'6.0.3'}},'tsconfig.json':'{"compilerOptions":{"strict":true}}','tddswarm.config.json':{adapter:'vitest',runner:['node','vitest.mjs','run','{files}'],executionMode:'shadow'}});presence(root);
 const recommendation=recommendPlugins(root);assert.deepEqual(recommendation.applicable,[{id:'typescript'}]);assert.equal(recommendation.execution.selected,'core');
 configurePluginsAutomatically(root,recommendation);const config=readConfig(root);assert.deepEqual(config.plugins.typescript,{enabled:true});assert.equal(config.adapter,'vitest');assert.equal(config.executionMode,'shadow');
 assert.equal(checkPlugins(root,{id:'typescript'}).plugins[0].probe,'bounded-project-compiler-presence');assert.equal(fs.existsSync(path.join(root,'FORBIDDEN_EXECUTION')),false);
});
test('explicitly disabled type checks remain disabled and absent project contracts are not activated',t=>{
 const root=fixture(t,{'package.json':{name:'example'},'tsconfig.json':'{}','tddswarm.config.json':{plugins:{typescript:{enabled:false}}}});presence(root);
 assert.deepEqual(recommendPlugins(root).applicable,[]);configurePluginsAutomatically(root,recommendPlugins(root));assert.equal(readConfig(root).plugins.typescript.enabled,false);
 const missing=fixture(t,{'package.json':{name:'example'}});presence(missing);assert.deepEqual(recommendPlugins(missing).applicable,[]);
});
test('type-check plugin cannot replace a native backend or execute a custom compiler wrapper',t=>{
 const root=fixture(t,{'tddswarm.config.json':{executionPlugin:'nx',plugins:{nx:{enabled:true}}}});
 configurePlugin(root,'typescript',{enabled:true,settings:{project:'packages/app/tsconfig.json',timeoutMs:1000}});assert.equal(readConfig(root).integration.type,'nx');
 for(const settings of [{command:['external']},{project:'../tsconfig.json'},{project:'/tsconfig.json'},{timeoutMs:0}])assert.throws(()=>configurePlugin(root,'typescript',{enabled:true,settings}));
 assert.throws(()=>configurePlugin(root,'typescript',{enabled:true,select:true}),/native backend/);
});
