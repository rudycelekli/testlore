import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {plan} from '../src/selector.js';
import {buildGraph} from '../src/graph.js';
import {runUnifiedNative,compareSubsetCases} from '../src/runner.js';
import {execute,sharedVitestCommand,resolveNativeBatch} from '../src/execution.js';
import {normalizeNativeProjects} from '../src/native-project-contracts.js';
import {openNativeSession} from '../src/native-session.js';
import {fixture,write,commit} from './helpers.js';
const cli=process.env.TDDSWARM_VITEST_BIN||path.join(path.dirname(createRequire(import.meta.url).resolve('vitest/package.json')),'vitest.mjs');
const check=value=>`import {test,expect} from 'vitest';import subject from '@subject';test('native ${value} oracle',()=>expect(subject).toBe(${value}));`;
function projects(t,extra={},options={}) {
 const config={adapter:'vitest',discovery:'native',runner:[process.execPath,cli,'run','--maxWorkers=1',...(options.args||[]),'{files}']};
 const root=fixture(t,{'package.json':{type:'module'},'.gitignore':'.tddswarm/\nnode_modules/\n','tddswarm.config.json':config,
 'vitest.config.mjs':`console.log('ONE_PROJECT_CONTEXT');export default {test:{projects:[{test:{name:'alpha',include:['alpha/*.test.js'],${options.shared?'isolate:false,':''}alias:{'@subject':new URL('./src/a.js',import.meta.url).pathname},setupFiles:['./alpha/bootstrap.js']}},{test:{name:'beta',include:['beta/*.test.js'],alias:{'@subject':new URL('./src/b.js',import.meta.url).pathname},setupFiles:['./beta/bootstrap.js']}}]}};`,
 'src/a.js':'export default 1;','src/b.js':'export default 2;',
 'alpha/bootstrap.js':`import '../src/alpha-input.js';`,'beta/bootstrap.js':`import input from '../src/beta-input.js';globalThis.projectInput=input;`,
 'src/alpha-input.js':'export default 1;','src/beta-input.js':'export default 2;',
 'alpha/a.test.js':check(1),'alpha/peer.test.js':`import {test,expect} from 'vitest';test('peer',()=>expect(1).toBe(1));`,
 'beta/b.test.js':check(2)+`test('setup input oracle',()=>expect(globalThis.projectInput).toBe(2));`,...extra});
 fs.symlinkSync(path.dirname(path.dirname(cli)),path.join(root,'node_modules'),'dir');commit(root);return {root,config};
}
test('project contract validation rejects overlap, missing membership and unknown isolation',()=>{
 const local=(_root,file)=>path.relative('/repo',file);
 const base={name:'a',files:['/repo/a.test.js'],isolate:true,setupFiles:[]};
 assert.throws(()=>normalizeNativeProjects('/repo',[base,{...base,name:'b'}],['a.test.js'],local),/Overlapping/);
 assert.throws(()=>normalizeNativeProjects('/repo',[],['a.test.js'],local),/Incomplete/);
 assert.throws(()=>normalizeNativeProjects('/repo',[{...base,isolate:undefined}],['a.test.js'],local),/Invalid/);
 assert.throws(()=>normalizeNativeProjects('/repo',[base],['a.test.js','b.test.js'],local),/Incomplete/);
});
test('canonical project scopes admit repeated exact, glob and exclusion arguments without positional filters',t=>{
 const {root,config}=projects(t);
 for(const args of [['--project','alpha'],['--project=alpha','--project=!beta'],['--project=alp*']])assert.ok(sharedVitestCommand(root,{...config,runner:[process.execPath,cli,'run',...args,'{files}']}));
 assert.equal(sharedVitestCommand(root,{...config,runner:[process.execPath,cli,'run','--project','{files}']}),null);
});
test('fresh selected projects preserve aliases, setup closures and isolation groups',t=>{
 const {root,config}=projects(t,{}, {shared:true});
 const graph=buildGraph(root);assert.equal(graph.nativePlanning?.complete,true,JSON.stringify(graph.discovery.sharedContextAttempt));
 // The same alias resolves differently in two projects; retain both paths.
 assert.ok(graph.edges['alpha/a.test.js'].includes('src/a.js'));assert.ok(graph.edges['alpha/a.test.js'].includes('src/b.js'));
 assert.ok(!graph.edges['alpha/a.test.js'].includes('alpha/peer.test.js'));
 const alpha=plan(root,{changed:['src/alpha-input.js']});assert.deepEqual(alpha.selected,['alpha/a.test.js','alpha/peer.test.js']);
 const ownTest=plan(root,{changed:['alpha/a.test.js']});assert.deepEqual(ownTest.selected,['alpha/a.test.js','alpha/peer.test.js']);
 assert.ok(ownTest.decisions.find(row=>row.test==='alpha/peer.test.js').reasons.includes('shared-project-isolation'));
 const beta=plan(root,{changed:['src/beta-input.js']});assert.deepEqual(beta.selected,['beta/b.test.js']);
 assert.equal(beta.discovery.method,'fresh-shared-native-context');
 assert.equal(resolveNativeBatch(root,[],config,{discover:true,transitive:true}).projectContracts.length,2);
});
test('native execution independently rejects a partial shared-isolation project',async t=>{
 const {root,config}=projects(t,{}, {shared:true}),session=await openNativeSession(root,config);
 try{assert.ok(session.token);await assert.rejects(session.execute(['alpha/a.test.js']),/shared-isolation project member/);}finally{await session.close();}
});
test('one fresh context preserves native failures and omits an unaffected project',async t=>{
 const {root,config}=projects(t,{}, {shared:true});write(root,'src/beta-input.js','export default 7;');
 const subset=await runUnifiedNative(root,{selective:true,capture:true});assert.equal(subset.complete,true,subset.error);
 assert.deepEqual(subset.plan.selected,['beta/b.test.js']);assert.equal(subset.exitCode,1);assert.equal(subset.unifiedNative.contexts,1);
 const full=execute(root,['alpha/a.test.js','alpha/peer.test.js','beta/b.test.js'],config,{capture:true});assert.equal(full.complete,true);
 const nativeEvaluations=full.stdout.split('ONE_PROJECT_CONTEXT').length-1;assert.ok(nativeEvaluations>0);
 assert.equal(subset.stdout.split('ONE_PROJECT_CONTEXT').length-1,nativeEvaluations,'A single fresh context preserves native per-project config evaluation parity');
 assert.equal(compareSubsetCases(full,subset,subset.executedTests).complete,true);
 assert.deepEqual(subset.tests.filter(row=>row.status==='failed').map(row=>row.id),full.tests.filter(row=>row.status==='failed').map(row=>row.id));
});
for(const args of [['--project=alpha'],['--project=alp*','--project=!beta']])test(`project scope matches original native execution: ${args.join(' ')}`,async t=>{
 const {root,config}=projects(t,{}, {args});write(root,'src/a.js','export default 7;');
 const subset=await runUnifiedNative(root,{selective:true,capture:true});assert.equal(subset.complete,true,subset.error);
 assert.deepEqual(subset.plan.selected,['alpha/a.test.js']);assert.equal(subset.plan.total,2);assert.equal(subset.tests.length,1);assert.equal(subset.exitCode,1);
 const full=execute(root,['alpha/a.test.js','alpha/peer.test.js'],config,{capture:true});assert.equal(full.complete,true);
 assert.equal(compareSubsetCases(full,subset,subset.executedTests).complete,true);
});
test('overlapping project files reject ambiguous native case identities before any omission',async t=>{
 const {root}=projects(t,{'vitest.config.mjs':`export default {test:{projects:[{test:{name:'a',include:['alpha/*.test.js']}},{test:{name:'b',include:['alpha/*.test.js']}}]}};`});
 const result=await runUnifiedNative(root,{selective:true,capture:true});assert.equal(result.complete,false);assert.equal(result.exitCode,2);assert.match(result.error,/Overlapping/);
});
test('a project-local executable config update invalidates its old alias resolution',t=>{
 const {root}=projects(t);buildGraph(root);
 write(root,'vitest.config.mjs',`export default {test:{projects:[{test:{name:'alpha',include:['alpha/*.test.js'],alias:{'@subject':new URL('./src/b.js',import.meta.url).pathname}}}]}};`);
 const fresh=buildGraph(root);assert.equal(fresh.nativePlanning.complete,true);assert.deepEqual(fresh.tests,['alpha/a.test.js','alpha/peer.test.js']);
 assert.ok(fresh.edges['alpha/a.test.js'].includes('src/b.js'));assert.ok(!fresh.edges['alpha/a.test.js'].includes('src/a.js'));
});
test('argv-dependent multi-project discovery is rejected rather than certified by selected project flags',async t=>{
 const {root}=projects(t,{'vitest.config.mjs':`export default {test:{projects:process.argv.includes('--project=alpha')?[{test:{name:'alpha',include:['alpha/*.test.js']}}]:[]}};`},{args:['--project=alpha']});
 const result=await runUnifiedNative(root,{selective:true,capture:true});assert.equal(result.complete,false);assert.match(result.error,/argv-dependent/);
});
test('ordinary multi-project planning rejects stateful project plugins without execution-parity evidence',t=>{
 const {root}=projects(t,{'vitest.config.mjs':`let calls=0;export default {plugins:[{name:'stateful-project-resolver',resolveId(id){calls++;if(id==='@subject')return new URL(calls%2?'./src/a.js':'./src/b.js',import.meta.url).pathname;}}],test:{projects:[{extends:true,test:{name:'alpha',include:['alpha/*.test.js']}},{extends:true,test:{name:'beta',include:['beta/*.test.js']}}]}};`});
 const selection=plan(root,{changed:['src/a.js']});assert.equal(selection.mode,'full');assert.equal(selection.discovery.sharedContextAttempt.complete,false);assert.match(selection.discovery.sharedContextAttempt.error,/plugin/);
});
test('ordinary single-root planning also rejects stateful resolver plugins',t=>{
 const {root}=projects(t,{'vitest.config.mjs':`let calls=0;export default {plugins:[{name:'stateful-root-resolver',resolveId(id){calls++;if(id==='@subject')return new URL(calls%2?'./src/a.js':'./src/b.js',import.meta.url).pathname;}}],test:{include:['alpha/*.test.js']}};`});
 const selection=plan(root,{changed:['src/a.js']});assert.equal(selection.mode,'full');assert.equal(selection.discovery.sharedContextAttempt.complete,false);assert.match(selection.discovery.sharedContextAttempt.error,/plugin/);
});
test('REA coverage and shard Boolean prefixes remain false under native and unified project invocations',async t=>{
 const {root,config}=projects(t,{'vitest.config.mjs':`const coverage=process.argv.some(arg=>arg.startsWith('--coverage'));const shard=process.argv.some(arg=>arg.startsWith('--shard='));const marker=process.env.TEST+'-'+process.pid;console.log('ONE_PROJECT_CONTEXT');export default {test:{projects:[{test:{name:'alpha',include:coverage||shard?[]:['alpha/*.test.js'],setupFiles:['./alpha/bootstrap.js'],alias:{'@subject':new URL('./src/a.js',import.meta.url).pathname}}}],env:{TESTLORE_FLAG_MARKER:marker}}};`},{args:['--project=alpha']});
 write(root,'src/a.js','export default 9;');
 const subset=await runUnifiedNative(root,{selective:true,capture:true});assert.equal(subset.complete,true,subset.error);assert.deepEqual(subset.plan.selected,['alpha/a.test.js']);assert.equal(subset.exitCode,1);
 const full=execute(root,['alpha/a.test.js','alpha/peer.test.js'],config,{capture:true});assert.equal(full.complete,true);assert.equal(compareSubsetCases(full,subset,subset.executedTests).complete,true);
 const nativeEvaluations=full.stdout.split('ONE_PROJECT_CONTEXT').length-1;assert.ok(nativeEvaluations>0);
 assert.equal(subset.stdout.split('ONE_PROJECT_CONTEXT').length-1,nativeEvaluations);
});
for(const mutation of [
 `const original=Array.prototype.some;Array.prototype.some=function(){return true};const coverage=process.argv.some(arg=>arg.startsWith('--coverage'));Array.prototype.some=original;`,
 `const original=String.prototype.startsWith;String.prototype.startsWith=function(){return true};const coverage=process.argv.some(arg=>arg.startsWith('--coverage'));String.prototype.startsWith=original;`
])test('restored argv intrinsic mutation cannot certify a recognized Boolean flag query',async t=>{
 const {root}=projects(t,{'vitest.config.mjs':`${mutation}export default {test:{projects:[{test:{name:'alpha',include:coverage?['alpha/*.test.js']:[]}}]}};`},{args:['--project=alpha']});
 const result=await runUnifiedNative(root,{selective:true,capture:true});assert.equal(result.complete,false);assert.equal(result.exitCode,2);assert.match(result.error,/argv-dependent/);
});
