import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fixture,commit,write,twoModules} from './helpers.js';
import {installQualityLayer} from '../src/quality-layer.js';
import {run,compareSubsetCases} from '../src/runner.js';
import {renderRunReport} from '../src/run-report.js';
import {readConfig} from '../src/files.js';
test('new onboarding shadows a planted failure in an omitted file; explicit selection override is observable',t=>{
 const root=fixture(t,twoModules);installQualityLayer(root,{ci:false});commit(root);
 write(root,'src/a.js','export const a = 1; // edit');
 const shadow=run(root,{capture:true});assert.equal(shadow.shadow,true);assert.equal(shadow.plan.selected.length,1);assert.equal(shadow.tests.length,2);assert.equal(shadow.exitCode,0);
 assert.equal(shadow.timings.totalMs>=shadow.timings.planningMs+shadow.timings.executionMs,true);
 assert.match(fs.readFileSync(path.join(root,'.tddswarm/last-run.md'),'utf8'),/Actually omitted: 0/);
 const selected=run(root,{capture:true,selective:true});assert.equal(selected.shadow,false);assert.equal(selected.tests.length,1);assert.match(renderRunReport(selected),/Actually omitted: 1/);
 assert.throws(()=>run(root,{shadow:true,selective:true}),/Choose/);
 write(root,'tddswarm.config.json',{executionMode:'silent'});assert.throws(()=>readConfig(root),/executionMode/);
});
test('decision reports escape untrusted file/warning text and retain incomplete status',()=>{
 const output=renderRunReport({exitCode:2,complete:false,error:'<script>\nboom',plan:{mode:'full',selected:[],decisions:[{test:'<img>|x',reasons:['danger|reason']}],warnings:[{file:'bad.md',reason:'<script>'}]}});
 assert.match(output,/Reporting: \*\*incomplete/);assert.equal(output.includes('<script>'),false);assert.equal(output.includes('<img>'),false);assert.match(output,/bad.md/);
});

test('independent subset qualification rejects missing cases, changed skips and injected cases',()=>{
 const full={complete:true,tests:[{file:'a.test.js',id:'a',status:'passed'},{file:'a.test.js',id:'b',status:'passed'},{file:'other.test.js',id:'c',status:'passed'}]};
 const selected={complete:true,tests:full.tests.slice(0,2)};
 assert.equal(compareSubsetCases(full,selected,['a.test.js']).complete,true);
 assert.deepEqual(compareSubsetCases(full,{...selected,tests:selected.tests.slice(0,1)},['a.test.js']).missing,['b']);
 assert.deepEqual(compareSubsetCases(full,{...selected,tests:[selected.tests[0],{...selected.tests[1],status:'skipped'}]},['a.test.js']).changed,['b']);
 assert.deepEqual(compareSubsetCases(full,{...selected,tests:[...selected.tests,{file:'a.test.js',id:'invented',status:'passed'}]},['a.test.js']).extra,['invented']);
});
test('Playwright helper imports cannot silently close undeclared browser inputs',async t=>{
 const {plan}=await import('../src/selector.js');
 const root=fixture(t,{'package.json':{type:'module'},'src/landing.js':'export const value=1;','src/pricing.js':'export const value=2;', 'public/landing.html':'hello',
 'browser/landing.spec.js':"import {value} from '../src/landing.js';export const helper=value;",'browser/pricing.spec.js':"import {value} from '../src/pricing.js';export const helper=value;",
 'tddswarm.config.json':{adapter:'playwright',testMatch:['browser/*.spec.js'],browser:{routes:{'/landing':{tests:['browser/landing.spec.js'],inputs:['public/landing.html']}}}}});
 const conservative=plan(root,{changed:['src/landing.js']});assert.equal(conservative.selected.length,2);assert.ok(conservative.decisions.find(d=>d.test==='browser/pricing.spec.js').reasons.includes('uncertain-dependency-closure'));
 const config=readConfig(root);config.browser.closedWorld=true;config.browser.routes['/pricing']={tests:['browser/pricing.spec.js'],inputs:['src/pricing.js']};write(root,'tddswarm.config.json',config);
 const reviewed=plan(root,{changed:['src/landing.js']});assert.deepEqual(reviewed.selected,['browser/landing.spec.js']);
 delete config.browser.routes['/pricing'];write(root,'tddswarm.config.json',config);assert.equal(plan(root,{changed:['src/landing.js']}).selected.length,2);
});

test('delegated native reports describe targets without inventing individual case evidence',()=>{
 const text=renderRunReport({delegated:true,adapter:'nx',complete:true,exitCode:0,plan:{mode:'affected',targets:['web','api'],evidence:'nx-project-graph'}});
 assert.match(text,/Native targets: 2/);assert.match(text,/Individual case inventory and independent subset recall are not established/);assert.equal(text.includes('0 passed'),false);
});
