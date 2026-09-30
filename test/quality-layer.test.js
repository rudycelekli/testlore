import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {installQualityLayer} from '../src/quality-layer.js';
import {fixture,write,twoModules} from './helpers.js';
test('quality onboarding creates native config and ongoing affected/full workflow on a project branch',t=>{
 const root=fixture(t,twoModules);const paths=installQualityLayer(root,{actionRef:'abc123'});
 assert.ok(paths.includes('.github/workflows/tddswarm.yml'));assert.equal(JSON.parse(fs.readFileSync(path.join(root,'tddswarm.config.json'))).discovery,'native');
 const workflow=fs.readFileSync(path.join(root,'.github/workflows/tddswarm.yml'),'utf8');assert.match(workflow,/rudycelekli\/tddswarm@abc123/);assert.match(workflow,/pull_request/);assert.match(workflow,/'affected' \|\| 'full'/);assert.match(workflow,/audit: 'true'/);
 assert.deepEqual(installQualityLayer(root,{actionRef:'other'}),[]);
});
test('existing project policy and workflow are preserved during onboarding',t=>{
 const config={runner:['node','--test','{files}'],alwaysRun:['test/a.test.js']};const root=fixture(t,{...twoModules,'tddswarm.config.json':config,'.github/workflows/tddswarm.yml':'maintainer policy\n'});
 assert.deepEqual(installQualityLayer(root),[]);assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root,'tddswarm.config.json'))),config);assert.equal(fs.readFileSync(path.join(root,'.github/workflows/tddswarm.yml'),'utf8'),'maintainer policy\n');
});
test('local onboarding can omit CI and preserve ignore content',t=>{
 const root=fixture(t,{'package.json':{devDependencies:{jest:'30'}},'.gitignore':'custom/'});installQualityLayer(root,{ci:false});
 assert.equal(fs.existsSync(path.join(root,'.github/workflows/tddswarm.yml')),false);assert.equal(JSON.parse(fs.readFileSync(path.join(root,'tddswarm.config.json'))).adapter,'jest');assert.equal(fs.readFileSync(path.join(root,'.gitignore'),'utf8'),'custom/\n.tddswarm/\n');
});
test('workflow references cannot introduce YAML or command interpolation',t=>{
 const root=fixture(t,twoModules);assert.throws(()=>installQualityLayer(root,{actionRef:'main\nanything:'}),/Invalid action reference/);
});
