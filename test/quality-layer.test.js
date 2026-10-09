import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {installQualityLayer,defaultNativeRunner} from '../src/quality-layer.js';
import {fixture,write,twoModules} from './helpers.js';
import {run} from '../src/runner.js';
test('quality onboarding creates native config and ongoing shadow/full workflow on a project branch',t=>{
 const root=fixture(t,twoModules);const paths=installQualityLayer(root,{actionRef:'abc123'});
 assert.ok(paths.includes('.github/workflows/tddswarm.yml'));assert.equal(JSON.parse(fs.readFileSync(path.join(root,'tddswarm.config.json'))).discovery,'native');
 const workflow=fs.readFileSync(path.join(root,'.github/workflows/tddswarm.yml'),'utf8');assert.match(workflow,/rudycelekli\/testlore@abc123/);assert.match(workflow,/pull_request/);assert.match(workflow,/'shadow' \|\| 'full'/);assert.match(workflow,/audit: 'true'/);
 assert.deepEqual(installQualityLayer(root,{actionRef:'other'}),[]);
});
test('existing project policy and workflow are preserved during onboarding',t=>{
 const config={runner:['node','--test','{files}'],alwaysRun:['test/a.test.js']};const root=fixture(t,{...twoModules,'tddswarm.config.json':config,'.github/workflows/tddswarm.yml':'maintainer policy\n'});
 assert.deepEqual(installQualityLayer(root),['.gitignore']);assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root,'tddswarm.config.json'))),config);assert.equal(fs.readFileSync(path.join(root,'.github/workflows/tddswarm.yml'),'utf8'),'maintainer policy\n');
});
test('local onboarding can omit CI and preserve ignore content',t=>{
 const root=fixture(t,{'package.json':{devDependencies:{jest:'30'}},'.gitignore':'custom/'});installQualityLayer(root,{ci:false});
 assert.equal(fs.existsSync(path.join(root,'.github/workflows/tddswarm.yml')),false);assert.equal(JSON.parse(fs.readFileSync(path.join(root,'tddswarm.config.json'))).adapter,'jest');assert.equal(fs.readFileSync(path.join(root,'.gitignore'),'utf8'),'custom/\n.tddswarm/\nnode_modules/\n');
});
test('workflow references cannot introduce YAML or command interpolation',t=>{
 const root=fixture(t,twoModules);assert.throws(()=>installQualityLayer(root,{actionRef:'main\nanything:'}),/Invalid action reference/);
});

test('Git installations pin the recorded TestLore commit and retain the former repository alias',async t=>{
 const root=fixture(t,{'node_modules/testlore/package.json':{type:'module'}});const pkg=path.join(root,'node_modules/testlore');fs.mkdirSync(path.join(pkg,'src'));
 for(const file of ['quality-layer.js','files.js','plugin-config.js','provenance.js','inputs.js','configuration-inputs.js'])fs.copyFileSync(new URL('../src/'+file,import.meta.url),path.join(pkg,'src',file));
 const {installedActionReference}=await import(new URL('file://'+path.join(pkg,'src/quality-layer.js')));
 const sha='a'.repeat(40);
 for(const repository of ['testlore','tddswarm']){write(root,'node_modules/.package-lock.json',{packages:{'node_modules/testlore':{resolved:`git+ssh://git@github.com/rudycelekli/${repository}.git#${sha}`}}});assert.equal(installedActionReference(),sha);}
});
test('new Vitest setup uses a portable installed CLI and preserves ancestor-only resolution',t=>{
 const root=fixture(t,{'package.json':{devDependencies:{vitest:'5.0.2'}}});
 assert.deepEqual(defaultNativeRunner(root,'vitest'),['npx','--no-install','vitest','run','{files}']);
 write(root,'node_modules/vitest/vitest.mjs','// installed CLI\n');
 installQualityLayer(root,{ci:false});
 const config=JSON.parse(fs.readFileSync(path.join(root,'tddswarm.config.json')));
 assert.deepEqual(config.runner,['node','node_modules/vitest/vitest.mjs','run','{files}']);
 assert.equal(config.executionMode,'shadow');
 fs.mkdirSync(path.join(root,'packages/child'),{recursive:true});
 assert.deepEqual(defaultNativeRunner(path.join(root,'packages/child'),'vitest'),['npx','--no-install','vitest','run','{files}']);
 assert.deepEqual(installQualityLayer(root,{ci:false}),[]);
 assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root,'tddswarm.config.json'))).runner,config.runner);
});
test('explicit Node test scripts win over SDK dependencies and produce usable shadow evidence',t=>{
 const root=fixture(t,{...twoModules,'package.json':{type:'module',scripts:{test:'node --test --test-concurrency=2 test/*.test.js'},devDependencies:{vitest:'5.0.2',jest:'30.2.0'}}});
 installQualityLayer(root,{ci:false});
 const config=JSON.parse(fs.readFileSync(path.join(root,'tddswarm.config.json')));
 assert.equal(config.adapter,'node');assert.deepEqual(config.runner,['node','--test','{files}']);
 const report=run(root,{capture:true});assert.equal(report.complete,true);assert.equal(report.shadow,true);assert.equal(report.exitCode,0);assert.equal(report.tests.length,2);
});
