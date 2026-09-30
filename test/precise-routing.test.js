import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { plan } from '../src/selector.js';
import { execute, resolveNativeBatch } from '../src/execution.js';
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
