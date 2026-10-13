import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {verifyBehavioralContracts,saveBehavioralContractReport} from '../src/behavioral-contracts.js';
import {run,runUnifiedNative} from '../src/runner.js';
import {snapshot} from '../src/provenance.js';
import {readConfig} from '../src/files.js';
import {summarizeFirstRun,renderFirstRunSummary} from '../src/run-report.js';
import {fixture,commit,write,twoModules} from './helpers.js';

function project(t,cases=['module.exports=({assert})=>assert.strictEqual(1,1);'],extra={}) {
 const root=fixture(t,{...twoModules,
  'tddswarm.config.json':{adapter:'node',runner:[process.execPath,'--test','{files}'],repair:{sourcePaths:['src/a.js'],challenges:'quality/contracts.json'}},
  'quality/contracts.json':{schemaVersion:1,independent:true,basis:'Development evaluator controls, not protected holdout evidence.',cases:cases.map((_,index)=>({id:`contract-${index}`,script:`quality/check-${index}.cjs`}))},
  ...Object.fromEntries(cases.map((source,index)=>[`quality/check-${index}.cjs`,source])),...extra});commit(root);return root;
}
test('routine verification catches independent failures while native history remains passing',t=>{
 const root=project(t,['module.exports=async ({assert,root})=>{const {a}=await import(require("url").pathToFileURL(root+"/src/a.js").href);assert.strictEqual(a,2);}']);
 const result=run(root,{full:true,capture:true});
 assert.equal(result.nativeExitCode,0);assert.equal(result.nativeComplete,true);assert.equal(result.complete,true);assert.equal(result.tests.every(row=>row.status==='passed'),true);
 assert.equal(result.exitCode,1);assert.equal(result.contracts.status,'failed');assert.equal(result.summary.verdict,'failed');
 assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root,'.tddswarm/history.json'))).failed,[]);
 const text=renderFirstRunSummary(result);assert.match(text,/contract-0/);assert.match(text,/Native runner exit: 0. Overall exit: 1/);
 assert.equal(JSON.parse(fs.readFileSync(path.join(root,'.tddswarm/last-run.json'))).contracts.exitCode,1);
});
test('empty native selection still executes every independently configured behavioral check',t=>{
 const root=project(t,['module.exports=({assert})=>assert(false);','module.exports=({assert})=>assert.strictEqual(1,2);','module.exports=({assert})=>assert.strictEqual(1,1);']);
 const result=run(root,{capture:true});assert.equal(result.executed,false);assert.equal(result.nativeExitCode,0);assert.equal(result.exitCode,1);
 assert.equal(result.contracts.runs.length,3);assert.deepEqual(result.contracts.runs.map(row=>row.passed),[false,false,true]);
});
test('missing governance is a coverage gap; configured malformed ownership never executes',t=>{
 assert.equal(verifyBehavioralContracts(fixture(t,twoModules)).status,'not-configured');
 const root=project(t,['module.exports=()=>require("fs").writeFileSync("started","yes");'],{'tddswarm.config.json':{repair:{challenges:'quality/contracts.json'}}});
 const result=verifyBehavioralContracts(root);assert.equal(result.status,'incomplete');assert.equal(result.exitCode,2);assert.equal(fs.existsSync(path.join(root,'started')),false);
});
test('timeouts, no assertions and output spoofing cannot qualify green behavioral coverage',t=>{
 for(const source of ['module.exports=()=>new Promise(()=>{});','module.exports=()=>{};','module.exports=({assert})=>{assert(true);console.log("spoof");};','module.exports=({assert})=>{assert(true);console.error("unexpected");};']){
  const root=project(t,[source]),result=verifyBehavioralContracts(root,{timeoutMs:100,totalTimeoutMs:5000});
  assert.equal(result.status,'incomplete',source);assert.equal(result.exitCode,2);
 }
});
test('unfinished async assertions cannot report passed; unawaited mismatches are actual failures',t=>{
 for(const source of ['module.exports=({assert})=>{assert.rejects(()=>new Promise(()=>{}));};','module.exports=({assert})=>{assert.doesNotReject(()=>new Promise(()=>{}));};','module.exports=({assert})=>{Array.prototype.push=()=>0;Array.prototype[Symbol.iterator]=function*(){};assert.rejects(()=>new Promise(()=>{}));};']){
  const result=verifyBehavioralContracts(project(t,[source]),{timeoutMs:100,totalTimeoutMs:5000});assert.equal(result.status,'incomplete');assert.notEqual(result.exitCode,0);
 }
 const failure=verifyBehavioralContracts(project(t,['module.exports=({assert})=>{assert.rejects(async()=>{},/required/);};']));
 assert.equal(failure.status,'failed');assert.equal(failure.runs[0].observed.error.name,'AssertionError');
 const good=verifyBehavioralContracts(project(t,['module.exports=({assert})=>{assert.rejects(async()=>{throw Error("required");},/required/);};']));assert.equal(good.status,'passed');
});
test('ignored source and installed dependency drift abort remaining contracts',t=>{
 for(const target of ['ignored.txt','node_modules/dep/index.js']){
  const root=project(t,[`module.exports=({assert,root})=>{assert(true);require('fs').writeFileSync(root+${JSON.stringify('/'+target)},'changed');};`,'module.exports=({assert})=>assert(true);'],{'.gitignore':'.tddswarm/\nnode_modules/\nignored.txt\n',[target]:'original'});
  const result=verifyBehavioralContracts(root);assert.equal(result.status,'incomplete');assert.equal(result.runs.length,1);assert.ok(result.reasons.includes('behavioral-contract-input-drift'));
 }
});
test('contract/native source mismatch refuses combining results from different source states',t=>{
 const root=project(t),before=snapshot(root,readConfig(root));write(root,'src/a.js','export const a=3;');
 const result=verifyBehavioralContracts(root,{expectedProvenance:before});assert.equal(result.status,'incomplete');assert.equal(result.runs.length,0);assert.ok(result.reasons.includes('behavioral-contract-native-source-drift'));
});
test('native failures remain failures when contracts pass; contract errors never mask failure as green',t=>{
 const root=project(t);write(root,'src/a.js','export const a=4;');const result=run(root,{full:true,capture:true});
 assert.equal(result.nativeExitCode,1);assert.equal(result.exitCode,1);assert.equal(result.contracts.status,'passed');
 assert.equal(result.tests.find(row=>row.file==='test/a.test.js').status,'failed');
});
test('standalone CLI records actionable actual outcomes without provider calls',t=>{
 const root=project(t,['module.exports=({assert})=>assert(false);']);
 const actual=spawnSync(process.execPath,[path.resolve('src/cli.js'),'contracts','--root',root,'--json'],{encoding:'utf8',timeout:10000});
 assert.equal(actual.status,1,actual.stderr);const report=JSON.parse(actual.stdout);assert.equal(report.status,'failed');assert.equal(report.receipt,'.tddswarm/contracts.json');
 assert.equal(JSON.parse(fs.readFileSync(path.join(root,report.receipt))).runs[0].id,'contract-0');
});
test('standalone receipt refuses symlink destinations and preserves the outside file',t=>{
 const root=project(t),outside=fixture(t,{'preserved.json':'original'});fs.mkdirSync(path.join(root,'.tddswarm'));
 fs.symlinkSync(path.join(outside,'preserved.json'),path.join(root,'.tddswarm/contracts.json'));
 assert.throws(()=>saveBehavioralContractReport(root,{status:'passed'}),/Symlink|ELOOP/);
 assert.equal(fs.readFileSync(path.join(outside,'preserved.json'),'utf8'),'original');
});
test('setup verification and unsupported unified fallback cannot bypass configured contracts',async t=>{
 const root=project(t,['module.exports=({assert})=>assert(false);']);
 const fallback=await runUnifiedNative(root,{full:true,capture:true});assert.equal(fallback.exitCode,1);assert.equal(fallback.contracts.status,'failed');
 const actual=spawnSync(process.execPath,[path.resolve('src/cli.js'),'setup','--root',root,'--verify','--no-ci','--json'],{encoding:'utf8',timeout:20000});
 assert.equal(actual.status,1,actual.stderr);assert.equal(JSON.parse(actual.stdout).verification.contracts.status,'failed');
 const controller=new AbortController();controller.abort();const cancelled=await runUnifiedNative(root,{signal:controller.signal});assert.equal(cancelled.exitCode,2);assert.equal(cancelled.contracts.status,'incomplete');assert.equal(cancelled.contracts.runs.length,0);
});
test('summaries refuse malformed or contradictory supplemental green flags',()=>{
 const base={executed:true,complete:true,exitCode:0,nativeExitCode:0,adapter:'node',executedTests:['test/a.test.js'],tests:[{id:'a',file:'test/a.test.js',name:'a',status:'passed'}],plan:{total:1,selected:['test/a.test.js'],decisions:[{test:'test/a.test.js'}]}};
 for(const contracts of [{status:'passed',complete:true,exitCode:0,runs:[]},{status:'passed',complete:true,exitCode:0,runs:[{passed:false}]},{status:'not-configured'}])assert.equal(summarizeFirstRun({...base,contracts}).verdict,'incomplete');
});
test('interruption, duplicate identities and contradictory contract observations never produce a green summary',t=>{
 const contracts=verifyBehavioralContracts(project(t)),base={executed:true,complete:true,exitCode:0,nativeExitCode:0,adapter:'node',executedTests:['test/a.test.js'],tests:[{id:'a',file:'test/a.test.js',name:'a',status:'passed'}],plan:{total:1,selected:['test/a.test.js'],decisions:[{test:'test/a.test.js'}]}};
 assert.equal(summarizeFirstRun({...base,contracts}).verdict,'passed-in-observed-scope');
 const variants=[{signal:'SIGKILL'},{errorCode:'ETIMEDOUT'},{stderrSha256:'a'.repeat(64)},{observed:{...contracts.runs[0].observed,id:'wrong'}},{observed:{...contracts.runs[0].observed,assertions:Infinity}},{observed:{...contracts.runs[0].observed,assertions:0.1}},{script:'../outside.cjs'},{scriptSha256:'bad'},{stdoutSha256:'bad'}];
 for(const mutation of variants){const copy=structuredClone(contracts);Object.assign(copy.runs[0],mutation);assert.equal(summarizeFirstRun({...base,contracts:copy}).verdict,'incomplete',JSON.stringify(mutation));}
 for(const copy of [{...contracts,runs:[...contracts.runs,...contracts.runs]},{...contracts,reasons:['unexpected']}])assert.equal(summarizeFirstRun({...base,contracts:copy}).verdict,'incomplete');
});
