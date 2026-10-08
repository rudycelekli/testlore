import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { plan } from '../src/selector.js';
import { addSources, buildGraph } from '../src/graph.js';
import { execute } from '../src/execution.js';
import { run } from '../src/runner.js';
import { snapshot, freshness } from '../src/provenance.js';
import { fixture, write, commit, twoModules } from './helpers.js';
const vitest = process.env.TDDSWARM_VITEST_BIN || path.join(path.dirname(createRequire(import.meta.url).resolve('vitest/package.json')),'vitest.mjs');

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

function nativeFixture(t, oldSource, {trackLoads=true}={}) {
  const config={adapter:'vitest',discovery:'native',runner:[process.execPath,vitest,'run','--maxWorkers=1','{files}']};
  const root=fixture(t,{'package.json':{type:'module'},'.gitignore':'.tddswarm/\nnode_modules/\n',
    'tddswarm.config.json':config,
    'vitest.config.mjs':`${trackLoads?"import fs from 'node:fs';fs.mkdirSync('.tddswarm',{recursive:true});fs.appendFileSync('.tddswarm/config-loads','x');":''}export default {test:{include:['test/*.test.js'],maxWorkers:1}};`,
    'src/a.js':oldSource,'src/shared.js':'export const value=1;','src/b.js':'export const value=1;',
    'test/b.test.js':`import {test,expect} from 'vitest';import {value} from '../src/b.js';test('b',()=>expect(value).toBe(1));`,
    'test/a.test.js':`import {test,expect} from 'vitest';import {value} from '../src/a.js';test('a',()=>expect(value).toBe(1));`});
  fs.symlinkSync(path.dirname(path.dirname(vitest)),path.join(root,'node_modules'),'dir');
  commit(root);write(root,'src/a.js','export const value=2;');
  return root;
}
test('empty baseline imports avoid a second resolver while root native config still loads', t => {
  const root=nativeFixture(t,'export const value=1;');
  const selection=plan(root);
  assert.equal(selection.discovery.complete,true);
  assert.equal(fs.readFileSync(path.join(root,'.tddswarm/config-loads'),'utf8'),'x');
  assert.equal(selection.discovery.method,'fresh-shared-native-context');
  assert.ok(selection.configurationFiles.includes('vitest.config.mjs'));
  assertTimings(selection.timings);
});
test('nonempty removed baseline imports still resolve and retain their evidence path', t => {
  const root=nativeFixture(t,"export {value} from './shared.js';");
  write(root,'src/shared.js','export const value=9;');
  const selection=plan(root);
  assert.equal(fs.readFileSync(path.join(root,'.tddswarm/config-loads'),'utf8'),'xx');
  assert.ok(selection.decisions[0].paths.some(chain=>chain.at(-1)==='src/shared.js'));
});
test('unchanged baseline imports avoid a second resolver without removing global uncertainty', t => {
  const root=nativeFixture(t,"export {value} from './shared.js';");
  write(root,'src/a.js',"export {value} from './shared.js'; // edited paragraph\n");
  write(root,'src/shared.js','export const value=9;');
  const selection=plan(root);
  assert.equal(selection.discovery.method,'fresh-shared-native-context');
  // The config-load counter itself uses runtime filesystem access. Keep that
  // uncertainty and its full fallback even though repeated resolution is gone.
  assert.equal(selection.mode,'full');assert.ok(selection.reasons.includes('dependency-graph-incomplete'));
  assert.equal(fs.readFileSync(path.join(root,'.tddswarm/config-loads'),'utf8'),'x');
  assert.ok(selection.decisions[0].paths.some(chain=>chain.at(-1)==='src/shared.js'));
});
test('reused baseline edges preserve independent native failures with a pure configuration', t => {
  const root=nativeFixture(t,"export {value} from './shared.js';",{trackLoads:false});
  write(root,'src/a.js',"export {value} from './shared.js'; // edited paragraph\n");
  write(root,'src/shared.js','export const value=9;');
  const selection=plan(root);
  assert.equal(selection.mode,'affected');assert.deepEqual(selection.selected,['test/a.test.js']);
  assert.equal(selection.omitted,1);assert.deepEqual(selection.decisions.find(row=>!row.selected).reasons,['no-known-dependency-on-change']);
  const config=JSON.parse(fs.readFileSync(path.join(root,'tddswarm.config.json')));
  const subset=execute(root,selection.selected,config,{capture:true}), full=execute(root,selection.decisions.map(row=>row.test),config,{capture:true});
  assert.equal(subset.complete,true);assert.equal(full.complete,true);assert.equal(subset.exitCode,1);assert.equal(full.exitCode,1);
  assert.deepEqual(subset.tests.filter(row=>row.status==='failed').map(row=>row.id),full.tests.filter(row=>row.status==='failed').map(row=>row.id));
});
test('an incomplete native context cannot authorize exact-pair reuse', t => {
  const root=nativeFixture(t,"export {value} from './shared.js';");
  write(root,'src/a.js',"export {value} from './shared.js';");
  const graph=buildGraph(root);
  graph.nativePlanning.complete=false;
  addSources(graph,[['src/a.js',"export {value} from './shared.js';"]]);
  assert.equal(fs.readFileSync(path.join(root,'.tddswarm/config-loads'),'utf8'),'xx');
  assert.deepEqual(graph.edges['src/a.js'],['src/shared.js']);
});
test('the same specifier from another importer still receives fresh native resolution', t => {
  const root=nativeFixture(t,"export {value} from './shared.js';");
  write(root,'src/a.js',"export {value} from './shared.js';");
  write(root,'archive/shared.js','export const value=3;');
  const graph=buildGraph(root);
  assert.ok(graph.nativeResolutions.has(JSON.stringify(['src/a.js','./shared.js'])));
  assert.equal(graph.nativeResolutions.has(JSON.stringify(['archive/a.js','./shared.js'])),false);
  addSources(graph,[['archive/a.js',"export {value} from './shared.js';"]],new Set([...graph.files,'archive/a.js']));
  assert.deepEqual(graph.edges['archive/a.js'],['archive/shared.js']);
  assert.equal(fs.readFileSync(path.join(root,'.tddswarm/config-loads'),'utf8'),'xx');
});
test('baseline reuse cannot persist across fresh configuration executions', t => {
  const root=nativeFixture(t,'export const value=1;');
  write(root,'src/a.js',"export {value} from '@subject';");
  const config=target=>`import fs from 'node:fs';fs.mkdirSync('.tddswarm',{recursive:true});fs.appendFileSync('.tddswarm/config-loads','x');export default {test:{include:['test/*.test.js'],maxWorkers:1,alias:{'@subject':new URL('./src/${target}.js',import.meta.url).pathname}}};`;
  write(root,'vitest.config.mjs',config('shared'));
  const first=buildGraph(root);addSources(first,[['src/a.js',"export {value} from '@subject';"]]);
  assert.deepEqual(first.edges['src/a.js'],['src/shared.js']);
  assert.equal(fs.readFileSync(path.join(root,'.tddswarm/config-loads'),'utf8'),'x');
  write(root,'src/alternate.js','export const value=4;');write(root,'vitest.config.mjs',config('alternate'));
  const next=buildGraph(root);addSources(next,[['src/a.js',"export {value} from '@subject';"]]);
  assert.deepEqual(next.edges['src/a.js'],['src/alternate.js']);
  assert.equal(fs.readFileSync(path.join(root,'.tddswarm/config-loads'),'utf8'),'xx');
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
