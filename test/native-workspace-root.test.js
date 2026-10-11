import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
import {execute,executeNativeRelated,discover,resolveNativeBatch,sharedVitestCommand,normalizeUnifiedExecution} from '../src/execution.js';
import {runUnifiedNative,compareSubsetCases} from '../src/runner.js';
import {plan} from '../src/selector.js';
import {captureVitestWorkspaceRoot,assertVitestWorkspaceRoot} from '../src/native-workspace-root.js';
import {openNativeSession,sessionPlanning} from '../src/native-session.js';
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

function packageContext(t){
 const {root,config}=workspace(t),native=path.join(root,'packages/app');
 config.nativeCwd='packages/app';config.runner[config.runner.indexOf('--root')+1]=native;
 write(root,'packages/app/relative-input.json',{value:'package input'});write(root,'relative-input.json',{value:'wrong workspace input'});
 write(root,files[0],`import {test,expect,inject} from 'vitest';import fs from 'node:fs';import value from '../src/a.js';test('independent sibling defect',()=>expect(value).toBe(1));test('original package cwd, setup and relative-file contract',()=>{expect(process.cwd()).toBe(${JSON.stringify(native)});expect(globalThis.setupCwd).toBe(${JSON.stringify(native)});expect(globalThis.setupLocation).toBe(${JSON.stringify(pathToFileURL(path.join(native,'setup.js')).href)});expect(inject('nativeRoot')).toBe(${JSON.stringify(native)});expect(JSON.parse(fs.readFileSync('relative-input.json','utf8')).value).toBe('package input');});`);
 write(root,'tddswarm.config.json',config);commit(root);return {root,native,config};
}
function independentNative(root,cwd,config){
 const report=path.join(root,'.tddswarm','cwd-independent.json');fs.mkdirSync(path.dirname(report),{recursive:true});
 const env={...process.env};delete env.NODE_TEST_CONTEXT;
 const command=[...config.runner.slice(2).filter(arg=>arg!=='{files}'),'--reporter=json',`--outputFile=${report}`,...files.map(file=>path.join(root,file))];
 const result=spawnSync(config.runner[0],[config.runner[1],...command],{cwd,env,encoding:'utf8',timeout:30000,maxBuffer:4*1024*1024});
 assert.equal(result.error,undefined,result.error?.message);const raw=JSON.parse(fs.readFileSync(report));
 return normalizeUnifiedExecution(root,files,raw,{nativeExitCode:result.status,stdout:result.stdout,stderr:result.stderr});
}

test('explicit package cwd preserves original CLI configuration/setup/relative inputs and genuine failures',async t=>{
 const {root,native,config}=packageContext(t),original=independentNative(root,native,config);assert.equal(original.complete,true);assert.equal(original.exitCode,0,original.stdout+original.stderr);
 const wrong=independentNative(root,root,config);assert.equal(wrong.exitCode,1);assert.ok(wrong.tests.some(row=>row.status==='failed'),'Workspace cwd must actually challenge the original package contract');
 const batch=resolveNativeBatch(root,[],config,{discover:true,transitive:true,roots:['packages/app/tsconfig.json']});assert.equal(batch.complete,true,JSON.stringify(batch));
 assert.deepEqual(batch.discovery.files,files);assert.equal(batch.workspaceRoot.cwd,native);assert.ok(batch.configFiles.includes('packages/app/setup.js'));
 assert.ok(batch.additionalResolutions.some(row=>row.file==='packages/app/src/a.js'&&row.resolution.paths.includes('shared/value.js')),'Native imports retain inventory-root prefixes');
 const unified=await runUnifiedNative(root,{full:true,capture:true});assert.equal(unified.complete,true,unified.error);assert.equal(unified.exitCode,0,unified.stdout+unified.stderr);assert.equal(compareSubsetCases(original,unified,files).complete,true);
 write(root,'shared/value.js','export default 9;');const changedNative=independentNative(root,native,config),changedUnified=await runUnifiedNative(root,{full:true,capture:true});
 assert.equal(changedNative.exitCode,1);assert.equal(changedUnified.complete,true,changedUnified.error);assert.equal(changedUnified.exitCode,1);assert.equal(compareSubsetCases(changedNative,changedUnified,files).complete,true);
 assert.equal(execute(root,files,config).complete,false);assert.equal(executeNativeRelated(root,['shared/value.js'],config).complete,false);assert.equal(discover(root,config).complete,false);
});

test('native cwd rejects outside, symlink, missing, ambiguous and conflicting package contexts',async t=>{
 const {root,config}=packageContext(t);fs.symlinkSync(path.join(root,'packages/app'),path.join(root,'linked-app'),'dir');
 for(const nativeCwd of ['../outside','missing','shared/value.js','linked-app','packages/./app','packages//app','node_modules',path.join(root,'packages/app'),null]){
  const invalid={...config,nativeCwd};assert.equal(sharedVitestCommand(root,invalid),null,JSON.stringify(nativeCwd));await assert.rejects(openNativeSession(root,invalid));
 }
 for(const runner of [config.runner.filter((arg,index,args)=>arg!=='--root'&&args[index-1]!=='--root'),config.runner.map((arg,index,args)=>args[index-1]==='--root'?'packages/app':arg),config.runner.map((arg,index,args)=>args[index-1]==='--config'?'packages/app/vitest.config.mjs':arg),config.runner.map((arg,index,args)=>args[index-1]==='--root'?root:arg)])assert.equal(sharedVitestCommand(root,{...config,runner}),null);
 assert.equal(resolveNativeBatch(root,[],config,{discover:false}).complete,false);
 write(root,'tddswarm.config.json',{...config,runner:[...config.runner.slice(0,-1),'--coverage','{files}']});
 const unsupported=await runUnifiedNative(root,{full:true,capture:true});assert.equal(unsupported.executed,false);assert.equal(unsupported.complete,false);assert.match(unsupported.error,/cannot use legacy fallback/);
});

test('native package cwd directory and executable configuration stay fresh across planning and execution',async t=>{
 for(const changed of ['directory','configuration']){
  const {root,native,config}=packageContext(t),session=await openNativeSession(root,config);
  try{
   assert.ok(sessionPlanning(session.token,root).workspaceRoot.cwdIdentity.ino);
   if(changed==='directory'){const old=path.join(root,'packages/old-app');fs.renameSync(native,old);fs.cpSync(old,native,{recursive:true});}
   else fs.appendFileSync(path.join(native,'vitest.config.mjs'),'\n// changed configuration');
   await assert.rejects(session.execute(files),/binding changed/);
  }finally{await session.close();}
 }
});

test('direct argv-dependent setup remains rejected before execution',async t=>{
 const {root}=packageContext(t);write(root,'packages/app/global.js',`export default function(context){context.provide('nativeRoot',context.config.root);process.argv.push('--changed-after-admission');}`);
 const result=await runUnifiedNative(root,{full:true,capture:true});assert.equal(result.complete,false);assert.equal(result.executed,false);assert.match(result.error,/runtime-argv-dependent-native-configuration/);assert.notEqual(result.unifiedNative.partial,true);
});

for(const [kind,code] of [['argv','Reflect.get(process,String.fromCharCode(97,114,103,118)).push("--changed-after-admission");'],['cwd',`process.chdir(${JSON.stringify('/tmp')});`]]){
 test(`global setup cannot mutate the explicitly reflected ${kind}`,async t=>{
  const {root}=packageContext(t);write(root,'packages/app/global.js',`export default function(context){context.provide('nativeRoot',context.config.root);${code}}`);
  const result=await runUnifiedNative(root,{full:true,capture:true});assert.equal(result.complete,false);assert.match(result.error,/Native workspace (argv|cwd) changed/);assert.equal(result.unifiedNative.partial,true);
 });
}
