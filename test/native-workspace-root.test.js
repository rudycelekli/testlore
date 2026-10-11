import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {execute,resolveNativeBatch,sharedVitestCommand} from '../src/execution.js';
import {runUnifiedNative,compareSubsetCases} from '../src/runner.js';
import {plan} from '../src/selector.js';
import {captureVitestWorkspaceRoot,assertVitestWorkspaceRoot} from '../src/native-workspace-root.js';
import {openNativeSession} from '../src/native-session.js';
import {fixture,write,commit} from './helpers.js';
const cli=process.env.TDDSWARM_VITEST_BIN||path.join(path.dirname(createRequire(import.meta.url).resolve('vitest/package.json')),'vitest.mjs');
const files=['packages/app/test/a.test.js','packages/app/test/b.test.js'];
function workspace(t,extra={}){
  const root=fs.realpathSync(fixture(t,{'package.json':{type:'module'},'.gitignore':'node_modules/\n.tddswarm/\n',
    'tsconfig.base.json':{compilerOptions:{module:'NodeNext',moduleResolution:'NodeNext',target:'ES2023'}},
    'packages/app/tsconfig.json':{extends:'../../tsconfig.base.json',include:['src/**/*.js','test/**/*.js']},
    'packages/app/package.json':{type:'module'},
    'packages/app/vitest.config.mjs':`console.log('CONFIG_CWD='+process.cwd());export default {test:{pool:'forks',maxWorkers:1,include:['test/*.test.js'],setupFiles:['./setup.js'],globalSetup:['./global.js']}};`,
    'packages/app/setup.js':`globalThis.setupLocation=import.meta.url;globalThis.setupCwd=process.cwd();`,
    'packages/app/global.js':`export default function(context){context.provide('nativeRoot',context.config.root);}`,
    'shared/value.js':'export default 1;',
    'packages/app/src/a.js':`export {default} from '../../../shared/value.js';`,
    'packages/app/src/b.js':'export default 2;',
    'packages/app/test/a.test.js':'',
    'packages/app/test/b.test.js':`import {test,expect} from 'vitest';import value from '../src/b.js';test('independent contract',()=>expect(value).toBe(2));`,...extra}));
  // The oracle uses the actual temporary inventory root, never Vitest's root.
  write(root,'packages/app/test/a.test.js',`import {test,expect,inject} from 'vitest';import value from '../src/a.js';test('sibling contract',()=>expect(value).toBe(1));test('root and cwd contract',()=>{expect(process.cwd()).toBe(${JSON.stringify(root)});expect(globalThis.setupCwd).toBe(${JSON.stringify(root)});expect(globalThis.setupLocation).toBe(${JSON.stringify(pathToFileURL(path.join(root,'packages/app/setup.js')).href)});expect(inject('nativeRoot')).toBe(${JSON.stringify(path.join(root,'packages/app'))});});`);
  const config={adapter:'vitest',discovery:'native',tsconfig:'packages/app/tsconfig.json',runner:[process.execPath,cli,'run','--root','packages/app','--config',path.join(root,'packages/app/vitest.config.mjs'),'--maxWorkers=1','{files}']};
  write(root,'tddswarm.config.json',config);fs.symlinkSync(path.dirname(path.dirname(cli)),path.join(root,'node_modules'),'dir');commit(root);return {root,config};
}

test('nested native root preserves independent CLI and shared API config/setup/cwd parity',async t=>{
  const {root,config}=workspace(t);
  const full=execute(root,files,config,{capture:true});assert.equal(full.complete,true,JSON.stringify(full));assert.equal(full.exitCode,0,full.stdout+full.stderr);
  const batch=resolveNativeBatch(root,[],config,{discover:true,transitive:true,roots:['packages/app/tsconfig.json']});assert.equal(batch.complete,true,JSON.stringify(batch));
  assert.deepEqual(batch.discovery.files,files);assert.equal(batch.workspaceRoot.cwd,root);assert.equal(batch.workspaceRoot.nativeRoot,path.join(root,'packages/app'));
  assert.ok(batch.projectContracts[0].setupFiles.includes('packages/app/setup.js'));assert.ok(batch.configFiles.includes('packages/app/global.js'));
  write(root,'shared/value.js','export default 9;');
  const routed=await runUnifiedNative(root,{selective:true,capture:true});assert.equal(routed.complete,true,routed.error);assert.equal(routed.exitCode,1);
  assert.deepEqual(routed.executedTests,['packages/app/test/a.test.js']);assert.ok(routed.stdout.includes('CONFIG_CWD='+root));
  const changedFull=execute(root,files,config,{capture:true});assert.equal(changedFull.complete,true);
  assert.equal(compareSubsetCases(changedFull,routed,routed.executedTests).complete,true);
  assert.deepEqual(routed.tests.filter(row=>row.status==='failed').map(row=>row.id),changedFull.tests.filter(row=>row.status==='failed').map(row=>row.id));
});

test('tracked inherited compiler inputs remain global and executable config is read afresh',t=>{
  const {root,config}=workspace(t);const first=plan(root,{changed:['packages/app/src/a.js']});assert.equal(first.mode,'affected',JSON.stringify(first));
  assert.ok(first.configurationFiles.includes('tsconfig.base.json'));assert.ok(!first.warnings.some(warning=>warning.reason==='external-resolution-config'));
  const compiler=plan(root,{changed:['tsconfig.base.json']});assert.equal(compiler.mode,'full');assert.ok(compiler.reasons.includes('global-configuration-changed'));
  write(root,'packages/app/vitest.config.mjs',`export default {test:{pool:'forks',include:['test/b.test.js']}};`);
  const next=resolveNativeBatch(root,[],config,{discover:true,transitive:true});assert.equal(next.complete,true,JSON.stringify(next));assert.deepEqual(next.discovery.files,['packages/app/test/b.test.js']);
});

test('workspace native roots require explicit contained regular config and reject unsafe scope',t=>{
  const {root,config}=workspace(t),base=[process.execPath,cli,'run'];
  for(const args of [
    ['--root','../outside'],['--root',path.dirname(root)],['--root','missing'],['--root','shared/value.js'],
    ['--root','node_modules'],['--root','.tddswarm'],['--root','packages/app','--root=packages/app'],
    ['--root','packages/app','-r','packages/app'],['--root'],['-r','packages/app'],['--root','packages/./app'],['--root','packages//app'],
    ['--root','packages/app','--config','../outside.mjs'],['--root','packages/app','--config',path.join(root,'packages/app/vitest.config.mjs'),'--config',path.join(root,'packages/app/vitest.config.mjs')]
  ])assert.equal(sharedVitestCommand(root,{...config,runner:[...base,...args,'{files}']}),null,JSON.stringify(args));
  assert.equal(sharedVitestCommand(root,{...config,runner:[...base,'--root=packages/app','{files}']}),null,'Root without explicit config');
  assert.ok(sharedVitestCommand(root,{...config,runner:[...base,'--root=packages/app','--config='+path.join(root,'packages/app/vitest.config.mjs'),'{files}']}));
  const legacy=resolveNativeBatch(root,[{file:files[0],specifier:'../src/a.js'}],config,{transitive:true,roots:files});assert.equal(legacy.complete,false);assert.match(legacy.error,/requires a fresh shared discovery/);assert.equal(legacy.resolutions[0].unresolved,true);
});

test('inside and outside symlink roots and config links cannot mint native authority',t=>{
  const {root,config}=workspace(t),outside=fixture(t,{'vitest.config.mjs':'export default {}'});
  for(const [name,target]of [['inside',path.join(root,'packages/app')],['outside',outside]]){
    fs.symlinkSync(target,path.join(root,name),'dir');
    assert.equal(sharedVitestCommand(root,{...config,runner:[process.execPath,cli,'run','--root',name,'--config',path.join(root,'packages/app/vitest.config.mjs'),'{files}']}),null);
  }
  fs.symlinkSync(path.join(root,'packages/app/vitest.config.mjs'),path.join(root,'linked-config.mjs'));
  assert.equal(sharedVitestCommand(root,{...config,runner:[process.execPath,cli,'run','--root','packages/app','--config','linked-config.mjs','{files}']}),null);
});

test('directory replacement with identical bytes rejects an already opened native session',async t=>{
  const {root,config}=workspace(t),session=await openNativeSession(root,config);assert.ok(session.token,session.unsupported);
  try{
    const original=path.join(root,'packages/app'),moved=path.join(root,'packages/old-app');fs.renameSync(original,moved);fs.cpSync(moved,original,{recursive:true});
    await assert.rejects(session.execute(files),/binding changed/);
  }finally{await session.close();}
});

test('executable config cannot change native cwd during workspace startup',async t=>{
  const {root}=workspace(t);write(root,'packages/app/vitest.config.mjs',`process.chdir(${JSON.stringify(path.join(root,'packages/app'))});export default {test:{include:['test/*.test.js']}};`);
  const result=await runUnifiedNative(root,{selective:true,capture:true});assert.equal(result.complete,false);assert.match(result.error,/cwd changed/);assert.equal(result.executed,false);
});

test('captured workspace identity cannot survive config mutation',t=>{
  const {root,config}=workspace(t),before=captureVitestWorkspaceRoot(root,config.runner);
  write(root,'packages/app/vitest.config.mjs','export default {};');assert.throws(()=>assertVitestWorkspaceRoot(before,captureVitestWorkspaceRoot(root,config.runner)),/binding changed/);
});

test('inventory replacement cannot reuse retained nested directory and config inodes',t=>{
  const {root,config}=workspace(t),before=captureVitestWorkspaceRoot(root,config.runner),old=root+'-old';
  t.after(()=>fs.rmSync(old,{recursive:true,force:true}));fs.renameSync(root,old);fs.mkdirSync(root);fs.renameSync(path.join(old,'packages'),path.join(root,'packages'));
  const after=captureVitestWorkspaceRoot(root,config.runner);assert.deepEqual(after.rootIdentity,before.rootIdentity);assert.deepEqual(after.configIdentity,before.configIdentity);
  assert.notDeepEqual(after.inventoryIdentity,before.inventoryIdentity);assert.throws(()=>assertVitestWorkspaceRoot(before,after),/binding changed/);
});

test('inventory-root symlink is rejected before workspace admission and actual session startup',async t=>{
  const {root,config}=workspace(t),holder=fixture(t);fs.symlinkSync(root,path.join(holder,'workspace'),'dir');
  assert.throws(()=>captureVitestWorkspaceRoot(path.join(holder,'workspace'),config.runner),/inventory root cannot be a symlink/);
  await assert.rejects(openNativeSession(path.join(holder,'workspace'),config),/inventory root cannot be a symlink/);
  const result=await runUnifiedNative(path.join(holder,'workspace'),{selective:true,capture:true});
  assert.equal(result.complete,false);assert.equal(result.executed,false);assert.equal(result.unifiedNative.used,false);assert.match(result.error,/inventory root cannot be a symlink/);
  fs.symlinkSync(path.dirname(root),path.join(holder,'parent'),'dir');
  const nestedAlias=path.join(holder,'parent',path.basename(root));
  assert.throws(()=>captureVitestWorkspaceRoot(nestedAlias,config.runner),/symlink parents/);
  await assert.rejects(openNativeSession(nestedAlias,config),/symlink parents/);
  const nestedResult=await runUnifiedNative(nestedAlias,{selective:true,capture:true});
  assert.equal(nestedResult.complete,false);assert.equal(nestedResult.executed,false);assert.match(nestedResult.error,/symlink parents/);
});

test('global setup cannot mutate effective native root or config and mint a complete receipt',async t=>{
  for(const mutation of ['context.config.root=original+\'/changed\';','context.vite.config.root=original+\'/changed\';','context.vite.config.configFile=original+\'/other.config.mjs\';']){
    const {root}=workspace(t);
    write(root,'packages/app/global.js',`export default function(context){const original=context.config.root;context.provide('nativeRoot',original);${mutation}}`);
    const result=await runUnifiedNative(root,{selective:true,capture:true});
    assert.equal(result.complete,false,mutation);assert.match(result.error,/effective root\/config differs/,mutation);
    assert.equal(result.unifiedNative.partial,true,'Initialization inside native execution must be reported as partial execution');
  }
});

test('native directory replacement during executable configuration startup is rejected',async t=>{
  const {root}=workspace(t),native=path.join(root,'packages/app'),moved=path.join(root,'packages/replaced-app');
  write(root,'packages/app/vitest.config.mjs',`import fs from 'node:fs';fs.renameSync(${JSON.stringify(native)},${JSON.stringify(moved)});fs.cpSync(${JSON.stringify(moved)},${JSON.stringify(native)},{recursive:true});export default {test:{include:['test/*.test.js']}};`);
  const result=await runUnifiedNative(root,{selective:true,capture:true});assert.equal(result.complete,false);assert.match(result.error,/binding changed/);assert.equal(result.executed,false);
});

test('implicit executable root changes cannot bypass the explicit workspace profile',t=>{
  const {root,config}=workspace(t);write(root,'packages/app/vitest.config.mjs',`export default {root:${JSON.stringify(path.join(root,'packages/app'))},test:{include:['test/*.test.js']}};`);
  const withoutRoot={...config,runner:config.runner.filter((arg,index,args)=>arg!=='--root'&&args[index-1]!=='--root')};
  assert.equal(resolveNativeBatch(root,[],withoutRoot,{discover:true,transitive:true}).complete,false);
});
