import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {plan} from '../src/selector.js';
import {buildGraph} from '../src/graph.js';
import {execute,combinedNativePlanningSupported,resolveNativeBatch} from '../src/execution.js';
import {fixture,write} from './helpers.js';
const vitest=process.env.TDDSWARM_VITEST_BIN||path.join(path.dirname(createRequire(import.meta.url).resolve('vitest/package.json')),'vitest.mjs');
function project(t,extra={}) {
  const config={adapter:'vitest',discovery:'native',analysisCache:{enabled:true},runner:[process.execPath,vitest,'run','--maxWorkers=1','{files}']};
  const root=fixture(t,{'package.json':{type:'module'},'tddswarm.config.json':config,
    'vitest.config.mjs':`export default {test:{include:['checks/*.check.js'],maxWorkers:1,alias:{'@subject':new URL('./src/a.js',import.meta.url).pathname}}};`,
    'src/a.js':'export default 1;','src/b.js':'export default 1;',
    'checks/subject.check.js':`import {test,expect} from 'vitest';import value from '@subject';test('subject',()=>expect(value).toBe(1));`,
    'checks/other.check.js':`import {test,expect} from 'vitest';import value from '../src/b.js';test('other',()=>expect(value).toBe(1));`,...extra});
  fs.symlinkSync(path.dirname(path.dirname(vitest)),path.join(root,'node_modules'),'dir');return {root,config};
}
test('fresh shared Vitest context discovers nonconventional files and native test aliases',t=>{
  const {root,config}=project(t);write(root,'src/a.js','export default 2;');
  const selection=plan(root,{changed:['src/a.js']});
  assert.equal(selection.discovery.method,'fresh-shared-native-context');assert.equal(selection.mode,'affected');
  assert.deepEqual(selection.selected,['checks/subject.check.js']);
  const selected=execute(root,selection.selected,config,{capture:true});
  const full=execute(root,['checks/subject.check.js','checks/other.check.js'],config,{capture:true});
  assert.equal(selected.complete,true);assert.equal(full.complete,true);assert.equal(selected.exitCode,1);
  assert.deepEqual(selected.tests.filter(row=>row.status==='failed').map(row=>row.id),full.tests.filter(row=>row.status==='failed').map(row=>row.id));
});
test('warm pure summaries never reuse config execution, alias resolution or discovery',t=>{
  const {root}=project(t);const first=buildGraph(root);assert.deepEqual(first.edges['checks/subject.check.js'],['src/a.js']);
  write(root,'vitest.config.mjs',`export default {test:{include:['checks/subject.check.js'],alias:{'@subject':new URL('./src/b.js',import.meta.url).pathname}}};`);
  const next=buildGraph(root);assert.ok(next.analysisCache.diskHits>0);
  assert.deepEqual(next.tests,['checks/subject.check.js']);assert.deepEqual(next.edges['checks/subject.check.js'],['src/b.js']);
  write(root,'src/b.js','export default 2;');assert.deepEqual(plan(root,{changed:['src/b.js']}).selected,['checks/subject.check.js']);
});
test('native imported config and setup inputs remain global after shared startup',t=>{
  const {root}=project(t,{'settings.mjs':`export default {test:{include:['checks/*.check.js'],setupFiles:['./setup.js']}};`,
    'setup.js':`import './src/a.js';`,'vitest.config.mjs':`import config from './settings.mjs';export default config;`});
  for(const changed of ['settings.mjs','setup.js']) {
    const selection=plan(root,{changed:[changed]});assert.ok(selection.configurationFiles.includes(changed));
    assert.equal(selection.mode,'full');assert.ok(selection.reasons.includes('global-configuration-changed'));
  }
});
test('unsupported CLI contexts retain the existing conservative resolver path',t=>{
  const {root,config}=project(t);
  for(const args of [['--project=other'],['--root=elsewhere'],['--environment=custom'],['checks/subject.check.js'],['--maxWorkers']]) {
    assert.equal(combinedNativePlanningSupported(root,{...config,runner:[process.execPath,vitest,'run',...args,'{files}']}),false);
  }
  assert.equal(combinedNativePlanningSupported(root,{...config,discovery:[process.execPath,'custom.js']}),false);
});
test('failed shared context contributes no resolution authority and remains visible',t=>{
  const {root}=project(t,{'vitest.config.mjs':`export default {test:{include:['checks/*.check.js'],isolate:false}};`});
  const selection=plan(root,{changed:['src/b.js']});assert.equal(selection.mode,'full');
  assert.equal(selection.discovery.sharedContextAttempt.complete,false);
  assert.match(selection.discovery.sharedContextAttempt.error,/isolation/);
  assert.ok(selection.warnings.some(row=>row.reason==='incomplete-native-resolution'));
});
test('combined empty root request still loads config and expands native-discovered roots',t=>{
  const {root,config}=project(t);const batch=resolveNativeBatch(root,[],config,{discover:true,transitive:true,roots:[]});
  assert.equal(batch.complete,true);assert.ok(batch.configFiles.includes('vitest.config.mjs'));
  assert.equal(batch.discovery.files.length,2);
  assert.ok(batch.additionalResolutions.some(row=>row.file==='checks/subject.check.js'&&row.specifier==='@subject'&&row.resolution.paths.includes('src/a.js')));
});
