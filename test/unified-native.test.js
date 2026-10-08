import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {run,runUnifiedNative,compareSubsetCases} from '../src/runner.js';
import {execute} from '../src/execution.js';
import {fixture,write,commit,git} from './helpers.js';
const vitest=process.env.TDDSWARM_VITEST_BIN||path.join(path.dirname(createRequire(import.meta.url).resolve('vitest/package.json')),'vitest.mjs');
function project(t,extra={}) {
 const config={adapter:'vitest',discovery:'native',runner:[process.execPath,vitest,'run','--maxWorkers=1','{files}']};
 const root=fixture(t,{'package.json':{type:'module'},'.gitignore':'.tddswarm/\nnode_modules/\n', 'tddswarm.config.json':config,
 'vitest.config.mjs':`console.log('TESTLORE_CONFIG_LOADED');export default {test:{include:['checks/*.check.js'],alias:{'@subject':new URL('./src/a.js',import.meta.url).pathname}}};`,
 'src/a.js':'export default 1;','src/b.js':'export default 1;',
 'checks/a.check.js':`import {test,expect} from 'vitest';import value from '@subject';test('independent subject oracle',()=>expect(value).toBe(1));`,
 'checks/b.check.js':`import {test,expect} from 'vitest';import value from '../src/b.js';test('other subject',()=>expect(value).toBe(1));`,...extra});
 fs.symlinkSync(path.dirname(path.dirname(vitest)),path.join(root,'node_modules'),'dir');commit(root);return {root,config};
}
test('unified native executes precise failing subset with one config load and legacy identities',async t=>{
 const {root,config}=project(t);write(root,'src/a.js','export default 2;');
 const report=await runUnifiedNative(root,{selective:true,capture:true});
 assert.equal(report.complete,true,report.error);assert.equal(report.exitCode,1);assert.equal(report.unifiedNative.contexts,1);
 assert.deepEqual(report.plan.selected,['checks/a.check.js']);assert.deepEqual(report.executedTests,['checks/a.check.js']);
 assert.equal(report.stdout.split('TESTLORE_CONFIG_LOADED').length-1,1);
 const full=execute(root,['checks/a.check.js','checks/b.check.js'],config,{capture:true});assert.equal(full.complete,true);
 assert.deepEqual(report.tests.filter(row=>row.status==='failed').map(row=>row.id),full.tests.filter(row=>row.status==='failed').map(row=>row.id));
 assert.equal(compareSubsetCases(full,report,report.executedTests).complete,true);
});
test('shadow executes full native inventory and compares proposed omissions',async t=>{
 const {root}=project(t);write(root,'src/a.js','export default 2;');
 const report=await runUnifiedNative(root,{shadow:true,capture:true});assert.equal(report.complete,true,report.error);
 assert.equal(report.executedTests.length,2);assert.equal(report.plan.selected.length,1);assert.equal(report.comparison.noObservedMisses,true);
 assert.equal(JSON.parse(fs.readFileSync(path.join(root,'.tddswarm/last-run.json'))).tests.length,2);
});
test('cache-disabled unified native preserves independent failures and reloads executable configuration',async t=>{
 const {root,config}=project(t);config.runner.splice(config.runner.length-1,0,'--cache=false');
 write(root,'tddswarm.config.json',config);commit(root);write(root,'src/a.js','export default 2;');
 const report=await runUnifiedNative(root,{selective:true,capture:true});
 assert.equal(report.complete,true,report.error);assert.equal(report.exitCode,1);assert.equal(report.unifiedNative.used,true);
 assert.ok(report.unifiedNative.sourceSummaryReuse.validatedHits>0);assert.equal(report.stdout.split('TESTLORE_CONFIG_LOADED').length-1,1);
 const full=execute(root,['checks/a.check.js','checks/b.check.js'],config,{capture:true});
 assert.equal(full.complete,true);assert.equal(compareSubsetCases(full,report,report.executedTests).complete,true);
 assert.deepEqual(report.tests.filter(row=>row.status==='failed').map(row=>row.id),full.tests.filter(row=>row.status==='failed').map(row=>row.id));
 write(root,'vitest.config.mjs',`export default {test:{include:['checks/a.check.js'],alias:{'@subject':new URL('./src/b.js',import.meta.url).pathname}}};`);
 const changed=await runUnifiedNative(root,{selective:true,capture:true});
 assert.equal(changed.complete,true,changed.error);assert.equal(changed.exitCode,0);assert.equal(changed.plan.total,1);
});
test('removed baseline imports resolve in the same session and retain the affected test',async t=>{
 const {root}=project(t);write(root,'src/a.js','export default 1;');
 write(root,'checks/a.check.js',`import {test,expect} from 'vitest';test('independent subject oracle',()=>expect(1).toBe(1));`);
 const report=await runUnifiedNative(root,{selective:true,capture:true});assert.equal(report.complete,true,report.error);
 assert.ok(report.plan.selected.includes('checks/a.check.js'));
 assert.equal(report.stdout.split('TESTLORE_CONFIG_LOADED').length-1,1);
});
test('declared source roots retain native alias closure beyond discovered static imports',async t=>{
 const {root,config}=project(t,{'src/detached.js':`import value from '@subject';export default value;`});
 config.dependencies={'checks/b.check.js':['src/detached.js']};
 write(root,'tddswarm.config.json',config);commit(root);
 write(root,'src/a.js','export default 2;');
 const report=await runUnifiedNative(root,{selective:true,capture:true});
 assert.equal(report.complete,true,report.error);
 assert.deepEqual(report.plan.selected,['checks/a.check.js','checks/b.check.js']);
 const declared=report.plan.decisions.find(decision=>decision.test==='checks/b.check.js');
 assert.ok(declared.paths.some(chain=>chain.includes('src/detached.js')&&chain.includes('src/a.js')));
 const full=execute(root,['checks/a.check.js','checks/b.check.js'],config,{capture:true});
 assert.equal(full.complete,true);assert.equal(compareSubsetCases(full,report,report.executedTests).complete,true);
});
test('configuration source mutation during startup rejects without a second native load',async t=>{
 const {root}=project(t,{'vitest.config.mjs':`import fs from 'node:fs';fs.mkdirSync('.tddswarm',{recursive:true});fs.appendFileSync('.tddswarm/config-count','1\\n');fs.writeFileSync('src/b.js','export default 7;');export default {test:{include:['checks/*.check.js']}};`});
 const report=await runUnifiedNative(root,{selective:true,capture:true});assert.equal(report.complete,false);assert.equal(report.exitCode,2);assert.match(report.error,/changed during native context startup/);
 assert.equal(fs.readFileSync(path.join(root,'.tddswarm/config-count'),'utf8').trim(),'1');
});
test('initial inventory reuse rejects tests created by executable configuration during startup',async t=>{
 const extra=`import {test,expect} from 'vitest';test('new failing native oracle',()=>expect(9).toBe(1));`;
 const {root}=project(t,{'vitest.config.mjs':`import fs from 'node:fs';console.log('TESTLORE_CONFIG_LOADED');fs.writeFileSync('checks/late.check.js',${JSON.stringify(extra)});export default {test:{include:['checks/*.check.js']}};`});
 const result=await runUnifiedNative(root,{selective:true,capture:true});
 assert.equal(result.complete,false);assert.equal(result.exitCode,2);assert.equal(result.executed,false);
 assert.match(result.error,/changed during native context startup.*checks\/late.check.js/);
 assert.equal(result.stdout.split('TESTLORE_CONFIG_LOADED').length-1,1);
 assert.equal(fs.existsSync(path.join(root,'.tddswarm/last-run.json')),false);
});
test('nonisolated root retains every member without reloading executable config',async t=>{
 const {root}=project(t,{'vitest.config.mjs':`console.log('TESTLORE_CONFIG_LOADED');export default {test:{include:['checks/*.check.js'],isolate:false}};`});
 write(root,'src/a.js','export default 2;');
 const report=await runUnifiedNative(root,{selective:true,capture:true});assert.equal(report.complete,true,report.error);assert.deepEqual(report.plan.selected,['checks/a.check.js','checks/b.check.js']);
 assert.equal(report.stdout.split('TESTLORE_CONFIG_LOADED').length-1,1);
});
test('public options cannot inject fabricated native discovery',async t=>{
 const {root}=project(t);write(root,'src/a.js','export default 2;');
 const report=await runUnifiedNative(root,{selective:true,capture:true,nativeSession:{discovery:{files:[],complete:true}},nativeBatch:{complete:true},startupInventory:{files:[]},startupPhase:{provenance:{files:[]}},sourceSummaries:{used:true,records:{}}});
 assert.equal(report.complete,true,report.error);assert.equal(report.exitCode,1);assert.equal(report.tests.length,1);
});
test('unobserved ignored source uses the fresh canonical parser and retains native case parity',async t=>{
 const {root,config}=project(t,{'src/a.js':`import value from '../.tddswarm/hidden.js';export default value;`});
 fs.mkdirSync(path.join(root,'.tddswarm'),{recursive:true});fs.writeFileSync(path.join(root,'.tddswarm/hidden.js'),'export default 1;');write(root,'src/a.js',`import value from '../.tddswarm/hidden.js';export default value;\n`);
 const result=await runUnifiedNative(root,{selective:true,capture:true});
 assert.equal(result.complete,true,result.error);assert.equal(result.exitCode,0);assert.deepEqual(result.executedTests,['checks/a.check.js']);
 assert.ok(result.unifiedNative.sourceSummaryReuse.validatedHits>0);assert.ok(result.unifiedNative.sourceSummaryReuse.freshParses>0);
 const full=execute(root,['checks/a.check.js','checks/b.check.js'],config,{capture:true});assert.equal(compareSubsetCases(full,result,result.executedTests).complete,true);
});

test('fresh JSON configuration changing after startup snapshot rejects same-phase reuse',async t=>{
 const {root}=project(t,{'vitest.config.mjs':`import fs from 'node:fs';console.log('TESTLORE_CONFIG_LOADED');fs.mkdirSync('.tddswarm',{recursive:true});fs.writeFileSync('.tddswarm/native-started','1');export default {test:{include:['checks/*.check.js']}};`});
 const file=path.join(root,'tddswarm.config.json'),marker=path.join(root,'.tddswarm/native-started'),read=fs.readFileSync;let reads=0,mutated=false;
 fs.readFileSync=function(target,...args){if(String(target)===file&&fs.existsSync(marker)&&++reads===2){const config=JSON.parse(read.call(this,target,'utf8'));config.executionMode='shadow';fs.writeFileSync(file,JSON.stringify(config));mutated=true;}return read.call(this,target,...args);};
 let result;try{result=await runUnifiedNative(root,{selective:true,capture:true});}finally{fs.readFileSync=read;}
 assert.equal(mutated,true);assert.equal(result.complete,false);assert.equal(result.exitCode,2);assert.equal(result.executed,false);
 assert.match(result.error,/fresh configuration does not match/);assert.equal(result.stdout.split('TESTLORE_CONFIG_LOADED').length-1,1);
 assert.equal(fs.existsSync(path.join(root,'.tddswarm/last-run.json')),false);
});

test('new inputs after startup snapshot still reject at independent pre-execution boundary',async t=>{
 const {root}=project(t,{'vitest.config.mjs':`import fs from 'node:fs';fs.mkdirSync('.tddswarm',{recursive:true});fs.writeFileSync('.tddswarm/native-started','1');export default {test:{include:['checks/*.check.js']}};`});
 const file=path.join(root,'tddswarm.config.json'),marker=path.join(root,'.tddswarm/native-started'),read=fs.readFileSync;let reads=0,mutated=false;
 fs.readFileSync=function(target,...args){if(String(target)===file&&fs.existsSync(marker)&&++reads===2){fs.writeFileSync(path.join(root,'src/late.js'),'export default 9;');mutated=true;}return read.call(this,target,...args);};
 let result;try{result=await runUnifiedNative(root,{selective:true,capture:true});}finally{fs.readFileSync=read;}
 assert.equal(mutated,true);assert.equal(result.complete,false);assert.equal(result.exitCode,2);assert.equal(result.executed,false);
 assert.match(result.error,/Inputs changed during selection/);assert.ok(result.decisionDrift.includes('source-drift:src/late.js'));
 assert.equal(fs.existsSync(path.join(root,'.tddswarm/last-run.json')),false);
});
test('deadline bounds hung native configuration and pre-abort starts no project code',async t=>{
 const {root}=project(t,{'vitest.config.mjs':`await new Promise(()=>{});export default {};`});
 const before=Date.now(),report=await runUnifiedNative(root,{timeoutMs:300,capture:true});assert.equal(report.complete,false);assert.match(report.error,/deadline/);assert.ok(Date.now()-before<5000);
 const controller=new AbortController();controller.abort();const cancelled=await runUnifiedNative(root,{signal:controller.signal,capture:true});assert.equal(cancelled.complete,false);assert.match(cancelled.error,/cancelled/);
});
test('each invocation reloads configuration and resolves changed aliases freshly',async t=>{
 const {root}=project(t);write(root,'src/a.js','export default 2;');const first=await runUnifiedNative(root,{selective:true,capture:true});assert.equal(first.exitCode,1,first.error);
 write(root,'vitest.config.mjs',`export default {test:{include:['checks/a.check.js'],alias:{'@subject':new URL('./src/b.js',import.meta.url).pathname}}};`);
 const next=await runUnifiedNative(root,{selective:true,capture:true});assert.equal(next.complete,true,next.error);assert.equal(next.exitCode,0);assert.equal(next.plan.total,1);
});
test('preflight unsupported builtin runner visibly uses legacy synchronous execution',async t=>{
 const root=fixture(t,{'package.json':{type:'module'},'test/a.test.js':`import test from 'node:test';test('works',()=>{});`});commit(root);
 const report=await runUnifiedNative(root,{full:true,capture:true});assert.equal(report.complete,true);assert.equal(report.unifiedNative.used,false);assert.match(report.unifiedNative.fallbackReason,/Canonical/);
});

test('in-flight cancellation retains incomplete receipt and does not erase failure history',async t=>{
 const {root}=project(t,{'checks/a.check.js':`import fs from 'node:fs';import {spawn} from 'node:child_process';import {test} from 'vitest';test('bounded hanging test',async()=>{const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});fs.writeFileSync('.tddswarm/hanging-pid',String(child.pid));await new Promise(()=>{});});`});
 write(root,'src/a.js','export default 2;');
 fs.mkdirSync(path.join(root,'.tddswarm'),{recursive:true});
 const controller=new AbortController();const promise=runUnifiedNative(root,{full:true,capture:true,signal:controller.signal,timeoutMs:15000});
 const marker=path.join(root,'.tddswarm/hanging-pid');const until=Date.now()+8000;
 while(!fs.existsSync(marker)&&Date.now()<until)await new Promise(resolve=>setTimeout(resolve,20));
 assert.ok(fs.existsSync(marker),'Native test must actually start before cancellation');
 const pid=Number(fs.readFileSync(marker,'utf8'));t.after(()=>{try{process.kill(pid,'SIGKILL');}catch{}});controller.abort();
 const report=await promise;
 const reapingDeadline=Date.now()+2000;let alive=true;while(alive&&Date.now()<reapingDeadline){try{process.kill(pid,0);}catch{alive=false;}if(alive)await new Promise(resolve=>setTimeout(resolve,20));}assert.equal(alive,false,'Native descendants must terminate');assert.equal(report.complete,false);assert.equal(report.exitCode,2);assert.match(report.error,/cancelled/);
 assert.equal(report.executed,true);assert.equal(report.actualExecutedFilesUnverified,true);assert.equal(JSON.parse(fs.readFileSync(path.join(root,'.tddswarm/last-run.json'))).complete,false);
 assert.equal(JSON.parse(fs.readFileSync(path.join(root,'.tddswarm/history.json'))).failed.length,2);
});
test('execution source drift invalidates completed native case results',async t=>{
 const {root}=project(t,{'checks/a.check.js':`import fs from 'node:fs';import {test} from 'vitest';test('mutates source during execution',()=>{fs.writeFileSync('src/b.js','export default 8;');});`});
 const report=await runUnifiedNative(root,{full:true,capture:true});assert.equal(report.complete,false);assert.notEqual(report.exitCode,0);assert.match(report.error,/Source changed during execution/);
 assert.equal(report.tests.find(row=>row.name==='mutates source during execution').status,'passed');
});
test('argv-dependent loaded configuration rejects once before execution',async t=>{
 const {root}=project(t,{'vitest.config.mjs':`console.log('TESTLORE_CONFIG_LOADED');export default {test:{include:process.argv.includes('run')?['checks/*.check.js']:[]}};`});
 const report=await runUnifiedNative(root,{full:true,capture:true});assert.equal(report.complete,false);assert.match(report.error,/argv-dependent/);
 assert.equal(report.stdout.split('TESTLORE_CONFIG_LOADED').length-1,1);
});

test('native output is bounded and an oversized partial stream cannot certify results',async t=>{
 const {root}=project(t,{'vitest.config.mjs':`console.log('x'.repeat(6*1024*1024));export default {test:{include:['checks/*.check.js']}};`});
 const report=await runUnifiedNative(root,{full:true,capture:true});assert.equal(report.complete,false);assert.equal(report.exitCode,2);assert.match(report.error,/output exceeded/);
 assert.ok(Buffer.byteLength(report.stdout)<=4*1024*1024+65536);
});

test('native nonzero process status cannot become a fabricated successful verification',async t=>{
 const {root}=project(t,{'vitest.config.mjs':`process.exitCode=2;export default {test:{include:['checks/*.check.js'],alias:{'@subject':new URL('./src/a.js',import.meta.url).pathname}}};`});
 const report=await runUnifiedNative(root,{full:true,capture:true});assert.equal(report.complete,false);assert.equal(report.exitCode,2);assert.equal(report.nativeExitCode,2);
});
test('stateful project resolver that changes native outcomes is conservatively rejected',async t=>{
 const {root,config}=project(t,{'src/b.js':'export default 2;',
 'checks/b.check.js':`import {test,expect} from 'vitest';import value from '../src/b.js';test('other subject',()=>expect(value).toBe(2));`,
 'vitest.config.mjs':`let calls=0;export default {plugins:[{name:'stateful-project-resolver',resolveId(id){if(id==='@subject'){calls++;return new URL(calls>2?'./src/b.js':'./src/a.js',import.meta.url).pathname;}}}],test:{include:['checks/*.check.js']}};`});
 const native=execute(root,['checks/a.check.js','checks/b.check.js'],config,{capture:true});assert.equal(native.complete,true);assert.equal(native.exitCode,0);
 const result=await runUnifiedNative(root,{full:true,capture:true});assert.equal(result.complete,false);assert.equal(result.executed,false);assert.match(result.error,/does not support project plugins/);
});
test('oversized declared receive frame is rejected before parsing native evidence',async t=>{
 const {root}=project(t,{'vitest.config.mjs':`import fs from 'node:fs';const bytes=Buffer.alloc(4);bytes.writeUInt32BE(0xffffffff);fs.writeSync(4,bytes);export default {};`});
 const result=await runUnifiedNative(root,{full:true,capture:true});assert.equal(result.complete,false);assert.match(result.error,/declared byte limit/);
});
test('large native error messages are bounded before crossing the protocol',async t=>{
 const {root}=project(t,{'vitest.config.mjs':`throw new Error('large-error-'+'x'.repeat(1024*1024));`});
 const result=await runUnifiedNative(root,{full:true,capture:true});assert.equal(result.complete,false);assert.ok(result.error.length<600);assert.match(result.error,/large-error/);
});
