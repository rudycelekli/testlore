import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {fixture} from './helpers.js';
import {routingProposals,validateRoutingProposals} from '../src/routing-proposals.js';
import {digest} from '../src/provenance.js';

const cli=fileURLToPath(new URL('../src/cli.js',import.meta.url));
const sources={
  'package.json':{type:'module'},
  'src/fixture.mjs':`import {McpServer} from 'example-sdk';const server=new McpServer({});const register=(name,handler)=>server.registerTool(name,{},handler);register('status',()=>0);`,
  'src/bridge.js':`import {fileURLToPath} from 'node:url';import {launch} from './process.js';const fixture=fileURLToPath(new URL('./fixture.mjs',import.meta.url));export const start=()=>launch({command:process.execPath,arguments:[fixture],env:{...process.env}});`,
  'src/process.js':`throw Error('project code must not execute during static inspection');export const launch=options=>options;`,
  'test/actual.test.js':`import {start} from '../src/bridge.js';throw Error('tests must not execute during inspection');`,
  'test/fake.test.js':`const options={command:'fake',arguments:[]};`
};

test('mappings CLI exposes process gaps without executing project code or claiming actual consumers',t=>{
  const root=fixture(t,sources);
  const report=JSON.parse(execFileSync(process.execPath,[cli,'mappings','--root',root,'--json'],{encoding:'utf8'}));
  const row=report.processRegistrations.proposals.find(row=>row.fixture==='src/fixture.mjs');
  assert.ok(row);assert.equal(row.omissionAuthority,false);assert.deepEqual(row.consumers,[]);
  assert.deepEqual(row.discoveredConsumerCandidates.map(row=>row.file),['test/actual.test.js']);
  assert.equal(row.discoveredConsumerCandidates.some(row=>row.file==='test/fake.test.js'),false);
  assert.ok(report.warnings.some(row=>row.reason==='runtime-registration'&&row.scope==='global'));
  const human=execFileSync(process.execPath,[cli,'mappings','--root',root],{encoding:'utf8'});
  assert.match(human,/src\/fixture\.mjs/);assert.match(human,/Next:/);assert.match(human,/No omissions authorized/);
  assert.equal(validateRoutingProposals(root,report).valid,true);
});

test('outer mapping validation rejects a resealed nested authority claim without native execution',t=>{
  const root=fixture(t,sources),report=routingProposals(root);
  const nested=report.processRegistrations;nested.omissionAuthority=true;
  const {integrity:nestedIntegrity,...nestedPayload}=nested;nested.integrity=digest(nestedPayload);
  const {integrity,...payload}=report;report.integrity=digest(payload);
  assert.throws(()=>validateRoutingProposals(root,report),/process|authority/i);
});

test('exhausted advisory inventory budget preserves ordinary mappings and fallback policy',t=>{
  const files={'package.json':{type:'module'},'settings.json':'{}','src/a.js':`import fs from 'node:fs';fs.readFileSync('settings.json');`,'test/a.test.js':`import '../src/a.js';`};
  for(let index=0;index<1000;index++)files[`test/unrelated-${index}.test.js`]='export {};';
  const root=fixture(t,files);
  const report=routingProposals(root);
  assert.ok(report.proposals.some(row=>row.input==='settings.json'));
  assert.equal(report.processRegistrations,null);
  assert.equal(report.processRegistrationDiagnostic.status,'unavailable');
  assert.equal(report.processRegistrationDiagnostic.omissionAuthority,false);
  assert.equal(report.unmappedChangesPolicy,'full-suite');
  assert.equal(validateRoutingProposals(root,report).valid,true);
});
