import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fixture,commit,write} from './helpers.js';
import {run,runUnifiedNative} from '../src/runner.js';
import {verifyTypecheck} from '../src/typecheck.js';
import {summarizeFirstRun,renderFirstRunSummary,renderRunReport} from '../src/run-report.js';
import {summarizeTypecheck} from '../src/typecheck-report.js';

function project(t,extra={}) {
 const root=fixture(t,{'package.json':{type:'module',name:'type-contract'},'.gitignore':'.tddswarm/\nnode_modules/\n',
  'tsconfig.json':{compilerOptions:{strict:true,noEmit:true,target:'ES2022',module:'NodeNext',moduleResolution:'NodeNext',skipLibCheck:true},include:['src/**/*.ts']},
  'tddswarm.config.json':{adapter:'node',runner:[process.execPath,'--experimental-strip-types','--no-warnings','--test','{files}'],plugins:{typescript:{enabled:true}}},
  'src/value.ts':'export const value: string = 42;\n',
  'test/runtime.test.mjs':"import test from 'node:test';import assert from 'node:assert/strict';import {value} from '../src/value.ts';test('ordinary runtime value',()=>assert.equal(value,42));",...extra});
 fs.mkdirSync(path.join(root,'node_modules'));fs.cpSync(path.resolve('node_modules/typescript'),path.join(root,'node_modules/typescript'),{recursive:true});
 fs.mkdirSync(path.join(root,'node_modules/.bin'));fs.symlinkSync('../typescript/bin/tsc',path.join(root,'node_modules/.bin/tsc'));commit(root);return root;
}
test('runtime green plus compiler failure blocks overall green and preserves native outcomes/history',t=>{
 const root=project(t),result=run(root,{full:true,capture:true});assert.equal(result.nativeExitCode,0);assert.equal(result.exitCode,1);assert.equal(result.nativeComplete,true);assert.equal(result.typecheck.status,'failed');
 assert.equal(result.tests[0].status,'passed');assert.equal(result.summary.verdict,'failed');assert.equal(result.summary.typecheck.errorCount,1);assert.equal(result.timings.typecheckMs,result.typecheck.durationMs);
 assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root,'.tddswarm/history.json'))).failed,[]);
 assert.match(renderFirstRunSummary(result),/TS2322: src\/value.ts:1:14/);assert.match(renderRunReport(result),/Native runner exit: 0. Overall exit: 1/);
 const saved=JSON.parse(fs.readFileSync(path.join(root,'.tddswarm/last-run.json')));assert.equal(saved.typecheck.exitCode,1);assert.equal(saved.summary.verdict,'failed');
});
test('zero native selection and unsupported unified fallback still run enabled type checks',async t=>{
 const root=project(t),empty=run(root,{capture:true});assert.equal(empty.executed,false);assert.equal(empty.exitCode,1);assert.equal(empty.typecheck.status,'failed');
 const fallback=await runUnifiedNative(root,{full:true,capture:true});assert.equal(fallback.exitCode,1);assert.equal(fallback.nativeExitCode,0);assert.equal(fallback.typecheck.status,'failed');
 const controller=new AbortController();controller.abort();const cancelled=await runUnifiedNative(root,{signal:controller.signal});assert.equal(cancelled.exitCode,2);assert.equal(cancelled.typecheck.status,'incomplete');
});
test('healthy type evidence cannot hide a native failure, and disabled checks remain inert',t=>{
 const root=project(t,{'src/value.ts':'export const value: number = 99;\n'}),result=run(root,{full:true,capture:true});assert.equal(result.nativeExitCode,1);assert.equal(result.typecheck.exitCode,0);assert.equal(result.exitCode,1);
 write(root,'src/value.ts','export const value: string = 42;\n');write(root,'tddswarm.config.json',{adapter:'node',runner:[process.execPath,'--experimental-strip-types','--no-warnings','--test','{files}'],plugins:{typescript:{enabled:false}}});
 const disabled=run(root,{full:true,capture:true});assert.equal(disabled.exitCode,0);assert.equal(disabled.typecheck,undefined);
});
test('missing scope, suppressed implementations and corrupt config remain incomplete despite native green',t=>{
 const root=project(t,{'src/value.ts':'// @ts-nocheck\nexport const value: string = 42;\n'}),result=run(root,{full:true,capture:true});assert.equal(result.nativeExitCode,0);assert.equal(result.exitCode,2);assert.equal(result.summary.verdict,'incomplete');
 const text=renderRunReport(result);assert.match(text,/TypeScript checking: incomplete/);assert.match(text,/Executed 1 files/);
 write(root,'tsconfig.json','{"compilerOptions":{"noCheck":true},"files":["src/value.ts"]}');assert.equal(run(root,{full:true,capture:true}).exitCode,2);
});
test('one-command setup enables available complementary TypeScript and reports its actual failure',t=>{
 const root=project(t);write(root,'tddswarm.config.json',{adapter:'node',runner:[process.execPath,'--experimental-strip-types','--no-warnings','--test','{files}'],executionMode:'shadow'});
 const native=spawnSync(process.execPath,[path.resolve('src/cli.js'),'setup','--root',root,'--verify','--no-ci','--json'],{encoding:'utf8',timeout:30000,maxBuffer:8*1024*1024});assert.equal(native.status,1,native.stderr);
 const result=JSON.parse(native.stdout);assert.equal(result.verification.nativeExitCode,0);assert.equal(result.verification.typecheck.status,'failed');assert.equal(JSON.parse(fs.readFileSync(path.join(root,'tddswarm.config.json'))).plugins.typescript.enabled,true);
 const standalone=spawnSync(process.execPath,[path.resolve('src/cli.js'),'typecheck','--root',root,'--json'],{encoding:'utf8',timeout:30000,maxBuffer:8*1024*1024});assert.equal(standalone.status,1);assert.equal(JSON.parse(standalone.stdout).diagnostics[0].code,2322);
});
test('contradictory persisted type reports cannot create a passing advisory headline or leak raw diagnostic prose',t=>{
 const root=project(t,{'src/value.ts':'export const value: number = 42;\n'}),actual=verifyTypecheck(root),base={executed:true,complete:true,exitCode:0,nativeExitCode:0,adapter:'node',executedTests:['test/runtime.test.mjs'],tests:[{id:'ordinary',name:'ordinary',file:'test/runtime.test.mjs',status:'passed'}],plan:{total:1,selected:['test/runtime.test.mjs'],decisions:[{test:'test/runtime.test.mjs'}]}};
 assert.equal(summarizeFirstRun({...base,typecheck:actual}).verdict,'passed-in-observed-scope');
 for(const mutation of [{signal:'SIGKILL'},{errorCode:'ETIMEDOUT'},{files:[]},{implementationFiles:[]},{compiler:{version:'made-up'}},{reasons:['drift']},{programFiles:[]},{complete:false},{exitCode:1},{diagnostics:[{code:2322,category:'error',file:'src/value.ts',line:1,column:1,message:'SECRET_DO_NOT_DISPLAY'}]}]){
  const corrupt={...structuredClone(actual),...mutation};assert.equal(summarizeFirstRun({...base,typecheck:corrupt}).verdict,'incomplete',JSON.stringify(mutation));assert.doesNotMatch(renderFirstRunSummary({...base,typecheck:corrupt}),/SECRET_DO_NOT_DISPLAY/);
 }
 assert.equal(summarizeTypecheck(undefined).status,'not-configured');assert.equal(summarizeTypecheck(null).status,'incomplete');
 const wrong=structuredClone(actual);wrong.binding.provenance.fingerprint='0'.repeat(64);
 assert.equal(summarizeFirstRun({...base,provenance:actual.binding.provenance,typecheck:wrong}).verdict,'incomplete');
 assert.equal(summarizeFirstRun({...base,provenance:actual.binding.provenance,typecheck:actual}).verdict,'passed-in-observed-scope');
});
test('ignored source changed by a passing runtime test cannot mix with fresh compiler evidence',t=>{
 const root=project(t,{
  '.gitignore':'.tddswarm/\nnode_modules/\nignored/\n',
  'tsconfig.json':{compilerOptions:{strict:true,noEmit:true,target:'ES2022',module:'NodeNext',moduleResolution:'NodeNext',allowImportingTsExtensions:true},files:['ignored/subject.ts']},
  'ignored/subject.ts':'export const value: number = 42;\n',
  'test/runtime.test.mjs':"import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import {value} from '../ignored/subject.ts';test('original ignored runtime value',()=>{assert.equal(value,42);fs.writeFileSync('ignored/subject.ts','export const value: number = 99;\\n');});"});
 const result=run(root,{full:true,capture:true});assert.equal(result.nativeExitCode,0);assert.equal(result.tests[0].status,'passed');assert.equal(result.exitCode,2);assert.equal(result.typecheck.status,'incomplete');assert.notEqual(result.summary.verdict,'passed-in-observed-scope');
 const native=spawnSync(process.execPath,['--experimental-strip-types','--no-warnings','--test','--test-reporter=tap','test/runtime.test.mjs'],{cwd:root,encoding:'utf8',env:{PATH:process.env.PATH,HOME:root}});assert.equal(native.status,1);assert.match(native.stdout,/# fail 1/);
});
test('native execution cannot erase the requested checker by disabling ignored configuration',t=>{
 const root=project(t,{
  '.gitignore':'.tddswarm/\nnode_modules/\nignored/\ntddswarm.config.json\n',
  'tsconfig.json':{compilerOptions:{strict:true,noEmit:true,target:'ES2022',module:'NodeNext',moduleResolution:'NodeNext'},files:['ignored/subject.ts']},
  'ignored/subject.ts':'export const value: number = 42;\n',
  'test/runtime.test.mjs':"import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import {value} from '../ignored/subject.ts';test('original value before disabling checker',()=>{assert.equal(value,42);fs.writeFileSync('ignored/subject.ts','export const value: number = 99;\\n');const config=JSON.parse(fs.readFileSync('tddswarm.config.json'));config.plugins.typescript.enabled=false;fs.writeFileSync('tddswarm.config.json',JSON.stringify(config));});"});
 const result=run(root,{full:true,capture:true});assert.equal(result.nativeExitCode,0);assert.equal(result.exitCode,2);assert.equal(result.typecheck.status,'incomplete');assert.notEqual(result.summary.verdict,'passed-in-observed-scope');
});
test('post-check report receipts cannot overwrite checked source through symbolic or hard links',t=>{
 const root=project(t,{'src/value.ts':'export const value: number = 42;\n'});
 fs.mkdirSync(path.join(root,'.tddswarm'));const source=path.join(root,'src/value.ts'),original=fs.readFileSync(source);
 for(const [receipt,link]of [['last-run.json','symbolic'],['last-run.md','hard'],['history.json','symbolic']]){
  const destination=path.join(root,'.tddswarm',receipt);fs.rmSync(destination,{force:true});
  if(link==='symbolic')fs.symlinkSync('../src/value.ts',destination);else fs.linkSync(source,destination);
  assert.throws(()=>run(root,{full:true,capture:true}),/Symlink path is unsupported|Receipt must be an unlinked regular file/);
  assert.deepEqual(fs.readFileSync(source),original);fs.rmSync(destination);
 }
});
