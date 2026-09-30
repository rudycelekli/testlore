import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {adapterFor,discover,execute} from '../src/execution.js';
import {fixture,write} from './helpers.js';
import {playwrightProof} from '../scripts/playwright-proof.js';

const require=createRequire(path.join(process.env.TESTLORE_PLAYWRIGHT_MODULE_ROOT||process.cwd(),'package.json'));
let dependencyRoot;
try{dependencyRoot=path.dirname(path.dirname(path.dirname(require.resolve('@playwright/test/package.json'))));}catch{}
const config={adapter:'playwright',discovery:'native'};
function project(t,files={}){
  const root=fixture(t,{'package.json':{type:'module'},'playwright.config.mjs':`export default {testDir:'./browser',workers:1};`,...files});
  fs.symlinkSync(dependencyRoot,path.join(root,'node_modules'),'dir');return root;
}
test('Playwright adapter detection supports executable and installed CLI argv',()=>{
  assert.equal(adapterFor({runner:['node','/tools/@playwright/test/cli.js','test','{files}']}),'playwright');
  assert.equal(adapterFor({runner:['playwright','test','{files}']}),'playwright');
});
test('native Playwright discovers real configured files and distinct project/repeat cases',{skip:!dependencyRoot},t=>{
  const root=project(t,{'playwright.config.mjs':`export default {testDir:'./browser',testMatch:'check-*.js',workers:1,repeatEach:2,projects:[{name:'first'},{name:'second'}]};`,'browser/check-[one].js':`import {test,expect} from '@playwright/test';test('same title',()=>expect(1).toBe(1));`,'browser/check-two.js':`import {test,expect} from '@playwright/test';test('second title',()=>expect(2).toBe(2));`,'outside.spec.js':`throw Error('outside configured scope');`});
  const found=discover(root,config);assert.equal(found.complete,true,JSON.stringify(found));assert.deepEqual(found.files,['browser/check-[one].js','browser/check-two.js']);
  const selected=execute(root,['browser/check-[one].js'],config,{capture:true});assert.equal(selected.complete,true,JSON.stringify(selected));assert.equal(selected.exitCode,0);assert.equal(selected.tests.length,4);assert.equal(new Set(selected.tests.map(t=>t.id)).size,4);assert.equal(new Set(selected.tests.map(t=>t.name)).size,4);assert.ok(selected.tests.every(t=>t.status==='passed'));
});
test('actual Playwright retry flakes and expected failures never become green evidence',{skip:!dependencyRoot},t=>{
  const root=project(t,{'playwright.config.mjs':`export default {testDir:'./browser',workers:1,retries:1};`,'browser/outcomes.spec.js':`import {test,expect} from '@playwright/test';test('flaky',({},info)=>expect(info.retry).toBe(1));test('expected failure',()=>{test.fail();expect(1).toBe(2);});test.skip('skip',()=>{});`});
  const report=execute(root,['browser/outcomes.spec.js'],config,{capture:true});assert.equal(report.complete,true,JSON.stringify(report));assert.equal(report.exitCode,1);assert.equal(report.nativeExitCode,0);assert.deepEqual(report.tests.map(t=>[t.title,t.status]),[['flaky','failed'],['expected failure','failed'],['skip','skipped']]);assert.equal(report.tests[0].outcome,'flaky');assert.equal(report.tests[0].attempts.length,2);
});
test('real Playwright handles typed tests and explicitly configured project/repeat argv',{skip:!dependencyRoot},t=>{
  const root=project(t,{'playwright.config.mjs':`export default {testDir:'./browser',workers:1,projects:[{name:'first'},{name:'second'}]};`,'browser/typed.spec.ts':`import {test,expect} from '@playwright/test';const value:number=7;test('typed',()=>expect(value).toBe(7));`});
  const scoped={...config,runner:[process.execPath,require.resolve('@playwright/test/cli'),'test','--project','second','--repeat-each=2','--workers','1','{files}']};
  const found=discover(root,scoped);assert.equal(found.complete,true,JSON.stringify(found));assert.deepEqual(found.files,['browser/typed.spec.ts']);
  const report=execute(root,found.files,scoped,{capture:true});assert.equal(report.complete,true,JSON.stringify(report));assert.equal(report.exitCode,0);assert.equal(report.tests.length,2);assert.ok(report.tests.every(t=>t.project==='second'&&t.status==='passed'));
});
test('native Playwright includes and reports dependency setup projects',{skip:!dependencyRoot},t=>{
  const root=project(t,{'playwright.config.mjs':`export default {testDir:'./browser',workers:1,projects:[{name:'setup',testMatch:'setup.js'},{name:'chromium',testMatch:'main.js',dependencies:['setup']}]};`,'browser/setup.js':`import {test} from '@playwright/test';test('setup',()=>{});`,'browser/main.js':`import {test} from '@playwright/test';test('main',()=>{});`});
  const report=execute(root,['browser/main.js'],config,{capture:true});assert.equal(report.complete,true,JSON.stringify(report));assert.equal(report.exitCode,0);assert.deepEqual(report.executedFiles,['browser/main.js','browser/setup.js']);assert.deepEqual(report.dependencyFiles,['browser/setup.js']);assert.deepEqual(report.tests.map(t=>t.project),['setup','chromium']);
});
test('Playwright native collection rejects empty, focused and config-filtered scopes',{skip:!dependencyRoot},t=>{
  const root=project(t);assert.equal(discover(root,config).complete,false);
  write(root,'browser/focused.spec.js',`import {test} from '@playwright/test';test.only('focused',()=>{});test('unfocused',()=>{});`);
  assert.equal(discover(root,config).complete,false);
  write(root,'browser/focused.spec.js',`import {test} from '@playwright/test';test('focused',()=>{});test('unfocused',()=>{});`);
  write(root,'playwright.config.mjs',`export default {testDir:'./browser',workers:1,grep:/^focused$/};`);
  assert.equal(discover(root,config).complete,false);
});
test('Playwright empty, loader, reporter, filtered and interrupted runs cannot certify completeness',{skip:!dependencyRoot},t=>{
  const root=project(t,{'browser/bad.spec.js':`throw Error('deliberate load failure');`});
  assert.equal(discover(root,config).complete,false);assert.equal(execute(root,['browser/bad.spec.js'],config,{capture:true}).complete,false);
  write(root,'browser/bad.spec.js',`import {test} from '@playwright/test';test('wait',()=>new Promise(()=>{}));`);
  const interrupted=execute(root,['browser/bad.spec.js'],config,{capture:true,timeoutMs:500});assert.equal(interrupted.complete,false);assert.notEqual(interrupted.exitCode,0);
  assert.equal(execute(root,[],config,{capture:true}).complete,false);
  for(const option of ['--shard=1/2','--grep=wait','--no-deps','--update-snapshots','browser/bad.spec.js']){
    const filtered={...config,runner:[process.execPath,require.resolve('@playwright/test/cli'),'test',option,'{files}']};
    assert.equal(discover(root,filtered).complete,false);assert.equal(execute(root,['browser/bad.spec.js'],filtered,{capture:true}).complete,false);
  }
  const fake=fixture(t,{'browser/fake.spec.js':'','fake.cjs':`process.exit(0);`});
  assert.equal(execute(fake,['browser/fake.spec.js'],{...config,runner:[process.execPath,'fake.cjs','{files}']},{capture:true}).complete,false);
});

test('real Chromium validates declared route selection, full/subset fault identity and candidate copies',{skip:!dependencyRoot||process.env.TESTLORE_PLAYWRIGHT_BROWSER!=='1',timeout:180000},()=>{
  const report=playwrightProof({moduleRoot:process.env.TESTLORE_PLAYWRIGHT_MODULE_ROOT||process.cwd()});
  assert.equal(report.passed,true,JSON.stringify(report));assert.equal(report.candidate.accepted,true);
  assert.equal(report.routing.omitted,1);assert.equal(report.fault.sameNamedCase,true);
});
