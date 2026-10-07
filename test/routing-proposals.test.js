import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {routingProposals,validateRoutingProposals} from '../src/routing-proposals.js';
import {qualifyRoutingMappings} from '../src/mapping-qualification.js';
import {plan} from '../src/selector.js';
import {digest} from '../src/provenance.js';
import {fixture,write,twoModules} from './helpers.js';
const reseal=proposal=>{const {integrity,...payload}=proposal;return {...payload,integrity:digest(payload)};};

test('module URLs and dirname literals suggest safe local assets/config with exact consumer paths',t=>{
  const root=fixture(t,{...twoModules,'src/a.js':`import fs from 'node:fs';import path from 'node:path';export const a=1;const local=new URL('../data/feature.json',import.meta.url);fs.readFileSync(path.join(import.meta.dirname,'../data/banner.svg'));new URL('../../escape.txt',import.meta.url);new URL('https://example.invalid/private',import.meta.url);new URL('../data/link.svg',import.meta.url);new URL('../data/a%20b.svg',import.meta.url);`,'data/feature.json':'{}','data/banner.svg':'<svg/>','data/a%20b.svg':'encoded filename'});
  fs.symlinkSync(path.join(root,'data/banner.svg'),path.join(root,'data/link.svg'));
  const report=routingProposals(root);assert.equal(report.stable,true);assert.equal(report.closedWorld,false);assert.equal(report.applied,false);
  assert.deepEqual(report.proposals.map(entry=>entry.input).sort(),['data/banner.svg','data/feature.json']);
  for(const entry of report.proposals){assert.deepEqual(entry.tests,['test/a.test.js']);assert.deepEqual(entry.evidence.consumerPaths['test/a.test.js'],['test/a.test.js','src/a.js']);assert.equal(entry.evidence.sourceHash,digest(fs.readFileSync(path.join(root,'src/a.js'))));assert.ok(entry.explanation.includes('Review'));}
  assert.ok(report.unresolved.length>=4);assert.equal(validateRoutingProposals(root,report).valid,true);
  assert.equal(plan(root,{changed:['data/feature.json']}).mode,'full');assert.equal(fs.existsSync(path.join(root,'tddswarm.config.json')),false);
});

test('styles retain all independently reachable consumers through suggested nested resources',t=>{
  const root=fixture(t,{...twoModules,'src/a.js':`import '../styles/a.css';export const a=1;`,'src/b.js':`import '../styles/b.css';export const b=2;`,'styles/a.css':'@import "shared.css";body{background:url(../assets/a.svg)}','styles/b.css':'@import "shared.css";','styles/shared.css':'@import "a.css";body{background:url(../assets/shared.svg)}','assets/a.svg':'<svg/>','assets/shared.svg':'<svg/>','styles/unrelated.css':'url(../assets/unused.svg)','assets/unused.svg':'unused'});
  const report=routingProposals(root),shared=report.proposals.find(entry=>entry.input==='assets/shared.svg');
  assert.deepEqual(shared.tests,['test/a.test.js','test/b.test.js']);
  assert.deepEqual(shared.evidence.consumerPaths['test/b.test.js'],['test/b.test.js','src/b.js','styles/b.css','styles/shared.css']);
  assert.equal(report.proposals.some(entry=>entry.input==='assets/unused.svg'),false);
  assert.ok(shared.limitations.some(value=>value.includes('suggested CSS edges')));assert.equal(validateRoutingProposals(root,report).valid,true);
});

test('declared workspace imports suggest bounded package source/assets while keeping metadata global',t=>{
  const root=fixture(t,{...twoModules,'package.json':{type:'module',workspaces:['packages/*']},'src/a.js':`import {value} from '@fixture/widget/subpath';export const a=value;`,'packages/widget/package.json':{name:'@fixture/widget',type:'module',exports:{'./subpath':'./index.js'}},'packages/widget/index.js':'export const value=1;','packages/widget/style.css':'body{}','packages/widget/logo.svg':'<svg/>','packages/widget/internal.test.js':'','packages/unrelated/package.json':{name:'unrelated'},'packages/unrelated/index.js':'export const ignored=1;'});
  const report=routingProposals(root),entry=report.proposals.find(entry=>entry.kind==='workspace-package-input-group');
  assert.deepEqual(entry.inputs,['packages/widget/index.js','packages/widget/logo.svg','packages/widget/package.json','packages/widget/style.css']);
  assert.deepEqual(entry.tests,['test/a.test.js']);assert.equal(entry.evidence.specifier,'@fixture/widget/subpath');assert.equal(entry.configurationPolicy,'retain-global-configuration-fallback');assert.deepEqual(entry.configurationInputs,['packages/widget/package.json']);
  assert.equal(plan(root,{changed:['packages/widget/package.json']}).mode,'full');assert.equal(validateRoutingProposals(root,report).valid,true);
});

test('ambiguous or unsupported workspace declarations never fabricate local package bindings',t=>{
  const root=fixture(t,{...twoModules,'package.json':{type:'module',workspaces:['packages/*']},'src/a.js':`import 'duplicate';export const a=1;`,'packages/a/package.json':{name:'duplicate'},'packages/a/index.js':'','packages/b/package.json':{name:'duplicate'},'packages/b/index.js':''});
  const report=routingProposals(root);assert.equal(report.proposals.length,0);assert.ok(report.warnings.some(entry=>entry.reason==='ambiguous-workspace-package-name'));
  write(root,'package.json',{type:'module',workspaces:['!packages/a']});const unsupported=routingProposals(root);assert.equal(unsupported.proposals.length,0);assert.ok(unsupported.warnings.some(entry=>entry.reason==='unsupported-workspace-declarations'));
});

test('pnpm literal workspace declarations retain exclusions and fresh declaration evidence',t=>{
  const root=fixture(t,{...twoModules,'pnpm-workspace.yaml':'packages:\n  - packages/** # actual pnpm glob form\n  - "!packages/excluded/**"\ncatalog:\n  vite: ^7.0.0\n','src/a.js':`import 'widget';export const a=1;`,'src/b.js':`import 'excluded';export const b=2;`,'packages/widget/package.json':{name:'widget'},'packages/widget/index.js':'export const value=1;','packages/excluded/nested/package.json':{name:'excluded'},'packages/excluded/nested/index.js':'export const value=2;'});
  const report=routingProposals(root),entry=report.proposals.find(entry=>entry.kind==='workspace-package-input-group');
  assert.equal(report.proposals.length,1);assert.equal(entry.evidence.packageName,'widget');assert.equal(entry.evidence.workspaceDeclaration,'pnpm-workspace.yaml');assert.equal(entry.evidence.workspaceDeclarationHash,digest(fs.readFileSync(path.join(root,'pnpm-workspace.yaml'))));assert.equal(validateRoutingProposals(root,report).valid,true);
  const forged=structuredClone(report);forged.proposals[0].evidence.workspaceDeclarationHash='0'.repeat(64);assert.throws(()=>validateRoutingProposals(root,reseal(forged)),/Workspace declaration evidence/);
  write(root,'pnpm-workspace.yaml','packages:\n  - packages/*\n');assert.throws(()=>validateRoutingProposals(root,report),/stale/);
});

test('unsupported YAML cannot be interpreted as a pnpm package binding',t=>{
  for(const declaration of ['packages: [packages/*]\n','packages:\n  - *aliases\n','packages:\n  - !packages/excluded\n','packages:\n  - packages/*\n  - >\n    packages/more\n','packages:\n  - packages/*\npackages:\n  - packages/more\n']){
    const root=fixture(t,{...twoModules,'pnpm-workspace.yaml':declaration,'src/a.js':`import 'widget';export const a=1;`,'packages/widget/package.json':{name:'widget'},'packages/widget/index.js':'export const value=1;'});
    const report=routingProposals(root);assert.equal(report.proposals.length,0,declaration);assert.ok(report.warnings.some(entry=>entry.reason==='unsupported-workspace-declarations'),declaration);
  }
});

test('conflicting workspace declaration formats stay unresolved',t=>{
  const root=fixture(t,{...twoModules,'package.json':{type:'module',workspaces:['packages/*']},'pnpm-workspace.yaml':'packages:\n  - packages/*\n','src/a.js':`import 'widget';export const a=1;`,'packages/widget/package.json':{name:'widget'},'packages/widget/index.js':'export const value=1;'});
  const report=routingProposals(root);assert.equal(report.proposals.length,0);assert.ok(report.warnings.some(entry=>entry.reason==='ambiguous-workspace-declarations'));
});

test('pnpm workspace configuration cannot be ignored to authorize omissions',t=>{
  const root=fixture(t,{...twoModules,'pnpm-workspace.yaml':'packages:\n  - packages/*\n','tddswarm.config.json':{ignoreChanges:['pnpm-workspace.yaml']}});
  const result=plan(root,{changed:['pnpm-workspace.yaml']});assert.equal(result.mode,'full');assert.equal(result.ignored.length,0);assert.ok(result.reasons.includes('global-configuration-changed'));
});

test('sealed generated proposals reject tampering, producer replacement and current source drift before native qualification',t=>{
  const root=fixture(t,{...twoModules,'data.json':'{}','src/a.js':`import fs from 'node:fs';fs.readFileSync('data.json');export const a=1;`}),report=routingProposals(root);
  const tampered=structuredClone(report);tampered.proposals[0].patch.dependencies['test/b.test.js']=['data.json'];assert.throws(()=>validateRoutingProposals(root,tampered),/integrity/);assert.throws(()=>qualifyRoutingMappings(root,tampered,{changed:['data.json']}),/integrity/);
  const producer=structuredClone(report);producer.producer.sha256='0'.repeat(64);assert.throws(()=>validateRoutingProposals(root,reseal(producer)),/producer/);
  const authority=structuredClone(report);authority.closedWorld=true;assert.throws(()=>validateRoutingProposals(root,reseal(authority)),/authority/);
  write(root,'data.json','{"changed":true}');assert.throws(()=>validateRoutingProposals(root,report),/stale/);
});

test('service suggestions expose variable names without reading credentials or inventing a revision patch',t=>{
  const original=process.env.TESTLORE_API_URL;process.env.TESTLORE_API_URL='https://user:never-expose-this@example.invalid/private';t.after(()=>{if(original===undefined)delete process.env.TESTLORE_API_URL;else process.env.TESTLORE_API_URL=original;});
  const root=fixture(t,{...twoModules,'src/a.js':`export const a=1;export const endpoint=process.env.TESTLORE_API_URL;export const version=process.env.SERVICE_VERSION;export const token=process.env.API_TOKEN;`});
  const report=routingProposals(root);assert.deepEqual(report.serviceSuggestions.map(entry=>entry.environmentVariable).sort(),['SERVICE_VERSION','TESTLORE_API_URL']);
  for(const entry of report.serviceSuggestions){assert.deepEqual(entry.tests,['test/a.test.js']);assert.equal(entry.patch,null);assert.equal(entry.closedWorld,false);assert.ok(entry.requirements.some(value=>value.includes('trustworthy service revision')));}
  assert.equal(JSON.stringify(report).includes('never-expose-this'),false);assert.equal(report.proposals.length,0);
});

test('proposal and validation APIs reject configured executable service probes before snapshots',t=>{
  const root=fixture(t,{...twoModules,'tddswarm.config.json':{services:{api:{tests:['test/a.test.js'],probe:[process.execPath,'-e',"require('fs').writeFileSync('probe-executed','bad')"]}}}});
  assert.throws(()=>routingProposals(root),/cannot execute service probes/);assert.throws(()=>validateRoutingProposals(root,{}),/cannot execute service probes/);assert.equal(fs.existsSync(path.join(root,'probe-executed')),false);
});

test('oversized workspace groups and tampered aggregate edge counts are visibly bounded',t=>{
  const root=fixture(t,{...twoModules,'package.json':{type:'module',workspaces:['packages/*']},'src/a.js':`import 'large';export const a=1;`,'packages/large/package.json':{name:'large'}});
  for(let i=0;i<1001;i++)write(root,`packages/large/item-${i}.json`,'{}');
  const report=routingProposals(root);assert.equal(report.truncated,true);assert.equal(report.proposals.length,0);assert.ok(report.warnings.some(entry=>entry.reason==='proposal-input-group-over-bound'));
  const small=fixture(t,{...twoModules,'data.json':'{}','src/a.js':`import fs from 'node:fs';fs.readFileSync('data.json');export const a=1;`}),valid=routingProposals(small),forged=structuredClone(valid);
  forged.proposals[0].patch.dependencies['test/a.test.js']=Array.from({length:1001},()=> 'data.json');assert.throws(()=>validateRoutingProposals(small,reseal(forged)),/Invalid routing mapping paths/);
});

test('generated module input mapping catches an independent defect in full and selected native runs without enabling it',t=>{
  const root=fixture(t,{...twoModules,'data/feature.json':'{"enabled":1}','src/a.js':`import fs from 'node:fs';export const a=JSON.parse(fs.readFileSync(new URL('../data/feature.json',import.meta.url),'utf8')).enabled;`}),proposal=routingProposals(root);
  const report=qualifyRoutingMappings(root,proposal,{changed:['data/feature.json'],defects:[{path:'data/feature.json',content:'{"enabled":0}'}],timeoutMs:5000});
  assert.equal(report.qualified,true,JSON.stringify(report.reasons));assert.equal(report.full.tests.length,2);assert.equal(report.subset.tests.length,1);assert.equal(report.full.tests.find(entry=>entry.name==='a').status,'failed');assert.equal(report.subset.tests[0].status,'failed');
  assert.equal(report.proposalEvidence.integrityVerified,true);assert.equal(report.proposalEvidence.producerVerified,true);assert.equal(report.proposalEvidence.completenessVerified,false);assert.equal(report.closedWorld,false);assert.equal(report.applied,false);assert.equal(fs.readFileSync(path.join(root,'data/feature.json'),'utf8'),'{"enabled":1}');assert.equal(fs.existsSync(path.join(root,'tddswarm.config.json')),false);
});

test('generated workspace group preserves a package asset defect in independently rebound native copies',t=>{
  const root=fixture(t,{...twoModules,'package.json':{type:'module',workspaces:['packages/*']},'src/a.js':`export {value as a} from '@fixture/widget';`,'packages/widget/package.json':{name:'@fixture/widget',type:'module',exports:'./index.js'},'packages/widget/index.js':`import fs from 'node:fs';export const value=JSON.parse(fs.readFileSync(new URL('./data.json',import.meta.url),'utf8')).value;`,'packages/widget/data.json':'{"value":1}'});
  fs.mkdirSync(path.join(root,'node_modules/@fixture'),{recursive:true});fs.symlinkSync(path.join(root,'packages/widget'),path.join(root,'node_modules/@fixture/widget'),'dir');
  const proposal=routingProposals(root);assert.ok(proposal.proposals.some(entry=>entry.kind==='workspace-package-input-group'));
  const result=qualifyRoutingMappings(root,proposal,{changed:['packages/widget/data.json'],defects:[{path:'packages/widget/data.json',content:'{"value":9}'}],timeoutMs:5000});
  assert.equal(result.qualified,true,JSON.stringify(result.reasons));assert.deepEqual(result.selection.selected,['test/a.test.js']);assert.equal(result.full.tests.find(entry=>entry.name==='a').status,'failed');assert.equal(result.subset.tests[0].status,'failed');assert.equal(result.closedWorld,false);assert.equal(fs.readFileSync(path.join(root,'packages/widget/data.json'),'utf8'),'{"value":1}');assert.equal(fs.realpathSync(path.join(root,'node_modules/@fixture/widget')),fs.realpathSync(path.join(root,'packages/widget')));
});

test('pnpm workspace asset mapping preserves a native failure and leaves unknown inputs conservative',t=>{
  const root=fixture(t,{...twoModules,'pnpm-workspace.yaml':'packages:\n  - packages/*\n  - "!packages/excluded"\n','src/a.js':`export {value as a} from '@fixture/widget';`,'packages/widget/package.json':{name:'@fixture/widget',type:'module',exports:'./index.js'},'packages/widget/index.js':`import fs from 'node:fs';export const value=JSON.parse(fs.readFileSync(new URL('./data.json',import.meta.url),'utf8')).value;`,'packages/widget/data.json':'{"value":1}','unknown/server-input.txt':'unmodeled'});
  fs.mkdirSync(path.join(root,'node_modules/@fixture'),{recursive:true});fs.symlinkSync(path.join(root,'packages/widget'),path.join(root,'node_modules/@fixture/widget'),'dir');
  const proposal=routingProposals(root),result=qualifyRoutingMappings(root,proposal,{changed:['packages/widget/data.json'],defects:[{path:'packages/widget/data.json',content:'{"value":9}'}],timeoutMs:5000});
  assert.equal(result.qualified,true,JSON.stringify(result.reasons));assert.deepEqual(result.selection.selected,['test/a.test.js']);assert.equal(result.full.tests.find(entry=>entry.name==='a').status,'failed');assert.equal(result.subset.tests[0].status,'failed');assert.equal(result.missedFailures.length,0);assert.equal(result.applied,false);assert.equal(result.closedWorld,false);
  assert.equal(plan(root,{changed:['unknown/server-input.txt']}).mode,'full');assert.equal(fs.readFileSync(path.join(root,'packages/widget/data.json'),'utf8'),'{"value":1}');
});

test('declared service revision drift invalidates a retained generated proposal',t=>{
  const previous=process.env.TESTLORE_SERVICE_REVISION;process.env.TESTLORE_SERVICE_REVISION='revision-one';t.after(()=>{if(previous===undefined)delete process.env.TESTLORE_SERVICE_REVISION;else process.env.TESTLORE_SERVICE_REVISION=previous;});
  const root=fixture(t,{...twoModules,'data.json':'{}','src/a.js':`import fs from 'node:fs';fs.readFileSync('data.json');export const a=1;`,'tddswarm.config.json':{services:{api:{tests:['test/a.test.js'],env:'TESTLORE_SERVICE_REVISION'}}}});
  const proposal=routingProposals(root);assert.equal(validateRoutingProposals(root,proposal).valid,true);process.env.TESTLORE_SERVICE_REVISION='revision-two';assert.throws(()=>validateRoutingProposals(root,proposal),/service-versions-changed/);
  delete process.env.TESTLORE_SERVICE_REVISION;assert.equal(routingProposals(root).stable,false);
});
