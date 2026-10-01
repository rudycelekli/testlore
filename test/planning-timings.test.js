import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { plan } from '../src/selector.js';
import { addSources } from '../src/graph.js';
import { run } from '../src/runner.js';
import { snapshot, freshness } from '../src/provenance.js';
import { fixture, write, commit, twoModules } from './helpers.js';
const vitest = path.join(path.dirname(createRequire(import.meta.url).resolve('vitest/package.json')),'vitest.mjs');

function assertTimings(value) {
  assert.ok(Number.isFinite(value.totalMs) && value.totalMs >= 0);
  assert.ok(Object.keys(value.phases).length > 0);
  assert.ok(Object.values(value.phases).every(ms => Number.isFinite(ms) && ms >= 0));
  assert.ok(Object.values(value.phases).reduce((n,ms)=>n+ms,0) <= value.totalMs);
}
test('phase diagnostics do not change selection/provenance identities or certify drift', t => {
  const root = fixture(t,twoModules);
  const first = plan(root,{changed:['src/a.js']}), second = plan(root,{changed:['src/a.js']});
  assertTimings(first.timings); assertTimings(first.timings.graph);
  assert.equal(first.fingerprint,second.fingerprint);
  assert.deepEqual(first.provenance,second.provenance);
  write(root,'src/a.js','export const a=99;');
  assert.ok(freshness(first.provenance,snapshot(root)).reasons.includes('source-drift:src/a.js'));
  assert.equal(plan(root,{changed:['unknown.json']}).mode,'full');
  write(root,'tddswarm.config.json',{runtime:{enabled:true,closedWorld:true}});
  const runtime = plan(root,{changed:['src/a.js']});
  assert.equal(runtime.mode,'full'); assert.equal(runtime.runtime.usable,false);
  assert.equal(freshness(first.provenance,snapshot(root,{env:{CONTEXT:'changed'}})).fresh,false);
});

function nativeFixture(t, oldSource) {
  const config={adapter:'vitest',discovery:'native',runner:[process.execPath,vitest,'run','--maxWorkers=1','{files}']};
  const root=fixture(t,{'package.json':{type:'module'},'.gitignore':'.tddswarm/\nnode_modules/\n',
    'tddswarm.config.json':config,
    'vitest.config.mjs':`import fs from 'node:fs';fs.mkdirSync('.tddswarm',{recursive:true});fs.appendFileSync('.tddswarm/config-loads','x');export default {test:{include:['test/*.test.js'],maxWorkers:1}};`,
    'src/a.js':oldSource,'src/shared.js':'export const value=1;',
    'test/a.test.js':`import {test,expect} from 'vitest';import {value} from '../src/a.js';test('a',()=>expect(value).toBe(1));`});
  fs.symlinkSync(path.dirname(path.dirname(vitest)),path.join(root,'node_modules'),'dir');
  commit(root);write(root,'src/a.js','export const value=2;');
  return root;
}
test('empty baseline imports avoid a second resolver while root native config still loads', t => {
  const root=nativeFixture(t,'export const value=1;');
  const selection=plan(root);
  assert.equal(selection.discovery.complete,true);
  assert.equal(fs.readFileSync(path.join(root,'.tddswarm/config-loads'),'utf8'),'xx');
  assert.ok(selection.configurationFiles.includes('vitest.config.mjs'));
  assertTimings(selection.timings);
});
test('nonempty removed baseline imports still resolve and retain their evidence path', t => {
  const root=nativeFixture(t,"export {value} from './shared.js';");
  write(root,'src/shared.js','export const value=9;');
  const selection=plan(root);
  assert.equal(fs.readFileSync(path.join(root,'.tddswarm/config-loads'),'utf8'),'xxx');
  assert.ok(selection.decisions[0].paths.some(chain=>chain.at(-1)==='src/shared.js'));
});
test('source mutation in native config is still rejected before execution', t => {
  const root=nativeFixture(t,'export const value=1;');
  write(root,'vitest.config.mjs',`import fs from 'node:fs';fs.writeFileSync('src/shared.js','export const value=99;');export default {test:{include:['test/*.test.js'],maxWorkers:1}};`);
  const result=run(root,{capture:true});
  assert.equal(result.executed,false);assert.equal(result.exitCode,2);
  assert.ok(result.decisionDrift.includes('source-drift:src/shared.js'));
});

test('an explicitly empty root pass still loads native configuration', t => {
  const root=nativeFixture(t,'export const value=1;');
  const config=JSON.parse(fs.readFileSync(path.join(root,'tddswarm.config.json')));
  const graph={root,config,files:[],tests:[],edges:{},sources:{},warnings:[],configFiles:new Set()};
  addSources(graph,[],new Set(),{roots:[]});
  assert.equal(fs.readFileSync(path.join(root,'.tddswarm/config-loads'),'utf8'),'x');
  assert.ok(graph.configFiles.has('vitest.config.mjs'));
});
