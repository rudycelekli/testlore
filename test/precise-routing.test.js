import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { plan } from '../src/selector.js';
import { execute, resolveNativeBatch } from '../src/execution.js';
import { snapshot, freshness } from '../src/provenance.js';
import { routingProposals } from '../src/routing-proposals.js';
import { fixture,write,commit,twoModules } from './helpers.js';
const here=createRequire(import.meta.url);
const vitest=path.join(path.dirname(here.resolve('vitest/package.json')),'vitest.mjs');

test('unreachable tooling uncertainty is informational for an independently mapped change',t=>{
 const root=fixture(t,{...twoModules,'scripts/tool.js':`import fs from 'node:fs';import './missing.js';const name=process.env.M;import(name);`});
 const p=plan(root,{changed:['src/a.js']});assert.equal(p.mode,'affected');assert.deepEqual(p.selected,['test/a.test.js']);assert.ok(p.warnings.every(w=>w.scope==='unreachable-source'));
 assert.equal(plan(root,{changed:['scripts/tool.js']}).mode,'full');
});
test('computed hidden import defect is caught by retaining its uncertain consumer on an unrelated change',t=>{
 const root=fixture(t,{...twoModules,'src/hidden.js':'export const value=1;','test/hidden.test.js':`import test from 'node:test';import assert from 'node:assert/strict';const name='../src/hidden.js';test('hidden contract',async()=>assert.equal((await import(name)).value,1));`});
 write(root,'src/hidden.js','export const value=2;');
 const p=plan(root,{changed:['src/a.js','src/hidden.js']});assert.equal(p.mode,'full'); // The hidden target itself is unmapped.
 const unrelated=plan(root,{changed:['src/a.js']});assert.equal(unrelated.mode,'affected');assert.deepEqual(unrelated.selected,['test/a.test.js','test/hidden.test.js']);
 assert.ok(unrelated.decisions.find(d=>d.test==='test/hidden.test.js').reasons.includes('uncertain-dependency-closure'));
 const result=execute(root,unrelated.selected,{},{capture:true});assert.equal(result.complete,true);assert.ok(result.tests.some(c=>c.status==='failed' && c.name==='hidden contract'));
});
test('unknown source edges propagate through multiple consumers, while independent tests remain omittable',t=>{
 const root=fixture(t,{...twoModules,'src/shared.js':`import fs from 'node:fs';export const value=1;`,'src/a.js':`export {value as a} from './shared.js';`,'test/extra.test.js':`import {value} from '../src/shared.js';`});
 const p=plan(root,{changed:['src/b.js']});assert.deepEqual(p.selected,['test/a.test.js','test/b.test.js','test/extra.test.js']);assert.deepEqual(p.uncertainty.retainedTests,['test/a.test.js','test/extra.test.js']);
});
test('registration, implicit global config imports, package scopes and altered compiler inputs retain full fallback',t=>{
 const root=fixture(t,{...twoModules,'scripts/register.js':`module.register('./hook.js');`});assert.equal(plan(root,{changed:['src/a.js']}).mode,'full');
 const global=fixture(t,{...twoModules,'vitest.config.js':`import './helpers.js';export default {};`,'helpers.js':`import fs from 'node:fs';`});assert.equal(plan(global,{changed:['src/a.js']}).mode,'full');
 for(const file of ['packages/a/package.json','packages/a/tsconfig.json'])assert.equal(plan(global,{changed:[file]}).mode,'full');
});
test('baseline uncertainty and removed imports remain conservatively linked after edits',t=>{
 const root=fixture(t,{...twoModules,'src/a.js':`import fs from 'node:fs';import './b.js';export const a=1;`});commit(root);
 write(root,'src/a.js','export const a=1;');write(root,'src/b.js','export const b=3;');const p=plan(root);
 assert.ok(p.decisions.find(d=>d.test==='test/a.test.js').paths.some(chain=>chain.includes('src/b.js')));assert.ok(p.uncertainty.retainedTests.includes('test/a.test.js'));
});
test('literal runtime input proposals carry source provenance without applying or clearing uncertainty',t=>{
 const root=fixture(t,{...twoModules,'data.json':'{}','src/a.js':`import fs from 'node:fs';fs.readFileSync('data.json');`,'secret-link.json':'{}'});
 fs.symlinkSync(path.join(root,'data.json'),path.join(root,'link.json'));write(root,'src/b.js',`import fs from 'node:fs';fs.readFileSync('link.json');fs.readFileSync('../outside.json');`);
 const result=routingProposals(root);assert.equal(result.applied,false);assert.equal(result.stable,true);assert.equal(result.proposals.length,1);assert.equal(result.proposals[0].input,'data.json');assert.deepEqual(result.proposals[0].tests,['test/a.test.js']);assert.equal(result.proposals[0].authority,'proposal-only');assert.equal(fs.existsSync(path.join(root,'tddswarm.config.json')),false);assert.equal(plan(root,{changed:['data.json']}).mode,'full');
});
test('native graph follows aliased consumer closure and jsdom resolver excludes unrelated tooling',t=>{
 const config={discovery:'native',runner:[process.execPath,vitest,'run','{files}']};
 const root=fixture(t,{'package.json':{type:'module'},'vitest.config.mjs':`export default {resolve:{alias:{'@unit':new URL('./src/',import.meta.url).pathname}},test:{environment:'node',include:['test/*.test.js']}};`,'src/a.js':`export {value} from '@unit/shared.js';`,'src/shared.js':'export const value=1;','src/b.js':'export const value=2;','eslint.config.js':`import missing from '@eslint/missing';`,'test/a.test.js':`import {test,expect} from 'vitest';import {value} from '@unit/a.js';test('a',()=>expect(value).toBe(1));`,'test/b.test.js':`import {test,expect} from 'vitest';import {value} from '../src/b.js';test('b',()=>expect(value).toBe(2));`,'tddswarm.config.json':config});
 fs.symlinkSync(path.dirname(path.dirname(vitest)),path.join(root,'node_modules'),'dir');const p=plan(root,{changed:['src/shared.js']});assert.equal(p.discovery.complete,true,JSON.stringify(p.discovery));assert.equal(p.mode,'affected',JSON.stringify(p));assert.deepEqual(p.selected,['test/a.test.js']);
 write(root,'vitest.config.mjs',fs.readFileSync(path.join(root,'vitest.config.mjs'),'utf8').replace("environment:'node'","environment:'jsdom'"));
 const resolved=resolveNativeBatch(root,[{file:'test/a.test.js',specifier:'@unit/a.js'}],config,{transitive:true,roots:['test/a.test.js']});assert.equal(resolved.complete,true,JSON.stringify(resolved));assert.ok(resolved.additionalResolutions.some(r=>r.resolution.paths.includes('src/shared.js')));
});
test('native implicit setup files and imported setup helpers become global inputs',t=>{
 const config={discovery:'native',runner:[process.execPath,vitest,'run','{files}']};
 const root=fixture(t,{...twoModules,'vitest.config.mjs':`export default {test:{include:['test/*.test.js'],setupFiles:['./fixtures/bootstrap.js']}};`,'fixtures/bootstrap.js':`import './context.js';`,'fixtures/context.js':'globalThis.context=1;','tddswarm.config.json':config});
 fs.symlinkSync(path.dirname(path.dirname(vitest)),path.join(root,'node_modules'),'dir');const p=plan(root,{changed:['fixtures/context.js']});assert.equal(p.mode,'full');assert.ok(p.configurationFiles.includes('fixtures/context.js'));assert.ok(p.reasons.includes('global-configuration-changed'));
});

test('effective NODE_OPTIONS preloads remain global and cannot hide a failing independent consumer',t=>{
 const root=fixture(t,{...twoModules,'bootstrap.js':`import {readFileSync} from 'node:fs';globalThis.injected=Number(readFileSync(new URL('./src/a.js',import.meta.url),'utf8').match(/a = (\\d+)/)[1]);`,'test/a.test.js':`import {a} from '../src/a.js';import test from 'node:test';import assert from 'node:assert/strict';test('a positive',()=>assert.ok(a>0));`,'test/b.test.js':`import {b} from '../src/b.js';import test from 'node:test';import assert from 'node:assert/strict';test('preloaded contract',()=>{assert.equal(b,2);assert.equal(globalThis.injected,1);});`});
 const config={adapter:'node',discovery:'native',env:{NODE_OPTIONS:'--import='+path.join(root,'bootstrap.js')}};write(root,'tddswarm.config.json',config);
 const baseline=execute(root,['test/a.test.js','test/b.test.js'],config,{capture:true});assert.equal(baseline.complete,true,JSON.stringify(baseline));assert.equal(baseline.exitCode,0);
 write(root,'src/a.js','export const a = 9;');const selection=plan(root,{changed:['src/a.js']});assert.equal(selection.mode,'full');assert.deepEqual(selection.selected,['test/a.test.js','test/b.test.js']);assert.ok(selection.warnings.some(w=>w.reason==='unmodeled-node-options-runtime-context'&&w.scope==='global'));
 const routed=execute(root,selection.selected,config,{capture:true});assert.equal(routed.complete,true);assert.equal(routed.exitCode,1);assert.ok(routed.tests.some(c=>c.name==='preloaded contract'&&c.status==='failed'));
});
test('inherited NODE_OPTIONS affect routing/provenance while an explicit empty override takes precedence',t=>{
 const root=fixture(t,twoModules),previous=process.env.NODE_OPTIONS;t.after(()=>{if(previous===undefined)delete process.env.NODE_OPTIONS;else process.env.NODE_OPTIONS=previous;});
 delete process.env.NODE_OPTIONS;const original=snapshot(root);process.env.NODE_OPTIONS='--require unmodeled-loader';
 const inherited=plan(root,{changed:['src/a.js']});assert.equal(inherited.mode,'full');assert.equal(freshness(original,snapshot(root)).fresh,false);
 write(root,'tddswarm.config.json',{env:{NODE_OPTIONS:''}});const config={env:{NODE_OPTIONS:''}},override=snapshot(root,config);assert.equal(plan(root,{changed:['src/a.js']}).mode,'affected');process.env.NODE_OPTIONS='--import another-loader';assert.equal(freshness(override,snapshot(root,config)).fresh,true);
 write(root,'tddswarm.config.json',{env:{NODE_OPTIONS:'--import "unterminated'}});assert.equal(plan(root,{changed:['src/a.js']}).mode,'full');
});
test('Vitest CLI isolation overrides cannot bypass the conservative shared-runtime guard',t=>{
 const root=fixture(t,{'package.json':{type:'module'},'src/a.js':'export const a=1;','test/a.test.js':`import {a} from '../src/a.js';`});
 const result=resolveNativeBatch(root,[{file:'test/a.test.js',specifier:'../src/a.js'}],{runner:[process.execPath,vitest,'run','--no-isolate','{files}']});assert.equal(result.complete,false);assert.equal(result.resolutions[0].unresolved,true);
});

test('worker thread inputs retain their uncertain consumer and catch a hidden independent contract defect',t=>{
 const root=fixture(t,{...twoModules,'src/a.js':`import {parentPort} from 'node:worker_threads';export const a=1;parentPort?.postMessage(a);`,'src/c.js':'export const c=1;','test/a.test.js':`import {a} from '../src/a.js';import test from 'node:test';import assert from 'node:assert/strict';test('a positive',()=>assert.ok(a>0));`,'test/b.test.js':`import {b} from '../src/b.js';import {Worker} from 'node:worker_threads';import {once} from 'node:events';import test from 'node:test';import assert from 'node:assert/strict';test('worker contract',async()=>{assert.equal(b,2);const worker=new Worker(new URL('../src/a.js',import.meta.url));try{assert.equal((await once(worker,'message'))[0],1);}finally{await worker.terminate();}});`,'test/c.test.js':`import {c} from '../src/c.js';import test from 'node:test';import assert from 'node:assert/strict';test('unrelated',()=>assert.equal(c,1));`});
 const config={adapter:'node',discovery:'native'};write(root,'tddswarm.config.json',config);const baseline=execute(root,['test/a.test.js','test/b.test.js','test/c.test.js'],config,{capture:true});assert.equal(baseline.complete,true,JSON.stringify(baseline));assert.equal(baseline.exitCode,0);
 write(root,'src/a.js',fs.readFileSync(path.join(root,'src/a.js'),'utf8').replace('a=1','a=9'));const selection=plan(root,{changed:['src/a.js']});assert.deepEqual(selection.selected,['test/a.test.js','test/b.test.js']);assert.ok(selection.uncertainty.retainedTests.includes('test/b.test.js'));
 const routed=execute(root,selection.selected,config,{capture:true});assert.equal(routed.complete,true);assert.ok(routed.tests.some(c=>c.name==='worker contract'&&c.status==='failed'));
});
test('global fetch observes a real local server input and keeps its hidden failing consumer',async t=>{
 const root=fixture(t,{...twoModules,'src/c.js':'export const c=1;','server.js':`import http from 'node:http';import fs from 'node:fs';const server=http.createServer((req,res)=>{res.end(fs.readFileSync(new URL('./src/a.js',import.meta.url),'utf8').match(/a = (\\d+)/)[1]);});server.listen(0,'127.0.0.1',()=>console.log(server.address().port));`,'test/a.test.js':`import {a} from '../src/a.js';import test from 'node:test';import assert from 'node:assert/strict';test('a positive',()=>assert.ok(a>0));`,'test/c.test.js':`import {c} from '../src/c.js';import test from 'node:test';import assert from 'node:assert/strict';test('unrelated',()=>assert.equal(c,1));`});
 const server=spawn(process.execPath,['server.js'],{cwd:root,env:{...process.env,NODE_OPTIONS:''},stdio:['ignore','pipe','pipe']});t.after(()=>server.kill('SIGKILL'));
 const timeout=setTimeout(()=>server.kill('SIGKILL'),60000);t.after(()=>clearTimeout(timeout));
 let readyTimeout;const output=await Promise.race([once(server.stdout,'data'),once(server,'exit').then(()=>{throw Error('Local server exited before readiness');}),new Promise((_,reject)=>{readyTimeout=setTimeout(()=>reject(Error('Local server readiness timed out')),5000);})]).finally(()=>clearTimeout(readyTimeout));const port=Number(String(output[0]).trim());assert.ok(port>0);
 write(root,'test/b.test.js',`import {b} from '../src/b.js';import test from 'node:test';import assert from 'node:assert/strict';test('server contract',async()=>{assert.equal(b,2);assert.equal(await (await fetch('http://127.0.0.1:${port}')).text(),'1');});`);
 const config={adapter:'node',discovery:'native'};write(root,'tddswarm.config.json',config);const baseline=execute(root,['test/a.test.js','test/b.test.js','test/c.test.js'],config,{capture:true});assert.equal(baseline.complete,true,JSON.stringify(baseline));assert.equal(baseline.exitCode,0);
 write(root,'src/a.js','export const a = 9;');const selection=plan(root,{changed:['src/a.js']});assert.deepEqual(selection.selected,['test/a.test.js','test/b.test.js']);assert.ok(selection.warnings.some(w=>w.file==='test/b.test.js'&&w.reason==='runtime-dependency'&&w.scope==='test-closure'));
 const routed=execute(root,selection.selected,config,{capture:true});assert.equal(routed.complete,true);assert.ok(routed.tests.some(c=>c.name==='server contract'&&c.status==='failed'));
});
