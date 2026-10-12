import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createHash} from 'node:crypto';
import {nativeCases,testLoreCases,assessUnimportRuns,selectPnpmManager,NATIVE_ERROR_OBSERVER_SOURCE,NATIVE_ERROR_OBSERVER_SHA256} from '../scripts/unimport-routing-pilot.js';
test('manager selection follows exact native pnpm12 manifest and refuses ambiguity or unsafe bins',()=>{
 const row={cacheEntry:'a1b2c3',manifest:{name:'pnpm',version:'12.3.4',bin:{pnpm:'pnpm'}}};
 assert.deepEqual(selectPnpmManager([row]),{cacheEntry:'a1b2c3',entrypoint:'pnpm'});
 for(const records of [[],[row,row],null])assert.throws(()=>selectPnpmManager(records));
 for(const change of [r=>r.cacheEntry='../escape',r=>r.manifest.name='fake',r=>r.manifest.version='12.3.5',r=>r.manifest.bin.pnpm='bin/pnpm.cjs',r=>r.manifest.bin.pnpm='../escape',r=>r.manifest.bin.pnpm='/bin/pnpm',r=>delete r.manifest.bin]){const altered=structuredClone(row);change(altered);assert.throws(()=>selectPnpmManager([altered]));}
});
const native=(failed=false)=>({numPassedTests:failed?0:1,numFailedTests:failed?1:0,numPendingTests:0,numTodoTests:0,numTotalTests:1,success:!failed,testResults:[{name:'/up/test/scan-dirs.test.ts',status:failed?'failed':'passed',message:'',assertionResults:[{fullName:'scan-dirs scanDirExports',status:failed?'failed':'passed'}]}]});
const observerPath='/capture/native-error-observer.mjs';
const observation=raw=>({schemaVersion:1,observerPath,sourceSha256:NATIVE_ERROR_OBSERVER_SHA256,reason:raw.success?'passed':'failed',errors:[],files:raw.testResults.map(suite=>({name:suite.name,state:suite.status==='passed'?'pass':'fail',errors:[],suiteErrors:[]}))});
test('native inventories reject duplicates, malformed summaries, errors and unknown statuses',()=>{
 const raw=native();assert.equal(nativeCases(raw,'/up',observation(raw),observerPath).cases.length,1);
 for(const change of [r=>r.numTotalTests=2,r=>r.numRuntimeErrorTestSuites=1,r=>r.numTodoTests=1,r=>r.testResults[0].message='beforeAll failed',r=>r.testResults[0].status='failed',...['unknown','todo','disabled','skipped'].map(status=>r=>r.testResults[0].assertionResults[0].status=status),r=>r.testResults[0].assertionResults.push(r.testResults[0].assertionResults[0]),r=>r.testResults[0].name='/outside/test.ts']){const raw=native();change(raw);assert.throws(()=>nativeCases(raw,'/up',observation(raw),observerPath));}
});
test('native missing runtime field needs actual sealed error observer, never a fabricated zero',()=>{
 const raw=native();assert.throws(()=>nativeCases(raw,'/up'));assert.equal(nativeCases(raw,'/up',observation(raw),observerPath).cases.length,1);
 for(const change of [o=>o.observerPath='/old/native-error-observer.mjs',o=>o.sourceSha256='a'.repeat(64),o=>o.reason='interrupted',o=>o.errors=[{message:'unhandled'}],o=>o.files=[],o=>o.files[0].name='/up/other.test.ts',o=>o.files[0].state='fail',o=>o.files[0].errors=[{message:'load failed'}],o=>o.files[0].suiteErrors=[{name:'hook',errors:[{message:'failed'}]}],o=>delete o.files[0].errors]){const altered=observation(raw);change(altered);assert.throws(()=>nativeCases(raw,'/up',altered,observerPath));}
});
test('actual passive observer callback retains global/module/hook errors and fails closed under bounds',()=>{
 let written=null;
 const context={Buffer,URL,createHash,fileURLToPath:()=>observerPath,fs:{readFileSync:()=>NATIVE_ERROR_OBSERVER_SOURCE,writeFileSync:(_file,text)=>{if(written!==null)throw Error('stale output');written=JSON.parse(text);}}};
 vm.createContext(context);vm.runInContext(NATIVE_ERROR_OBSERVER_SOURCE.replace(/^import .*;\n/gm,'').replace('export default class NativeErrorObserver','globalThis.NativeErrorObserver=class NativeErrorObserver').replaceAll('import.meta.url',"'file:///capture/native-error-observer.mjs'"),context);
 const instance=new context.NativeErrorObserver(),task={filepath:'/up/test/scan-dirs.test.ts',type:'suite',result:{state:'pass'},tasks:[]};
 instance.onTestRunEnd([{task}],[],'passed');assert.equal(nativeCases(native(),'/up',written,observerPath).cases.length,1);
 assert.throws(()=>instance.onTestRunEnd([{task}],[],'passed'));written=null;
 instance.onTestRunEnd([{task}],[{name:'Error',message:'unhandled'}],'passed');assert.equal(written.errors[0].message,'unhandled');assert.throws(()=>nativeCases(native(),'/up',written,observerPath));written=null;
 const broken=structuredClone(task);broken.result.errors=[{message:'load failed'}];broken.tasks=[{type:'suite',name:'beforeAll',result:{errors:[{message:'hook failed'}]},tasks:[]}];
 instance.onTestRunEnd([{task:broken}],[],'passed');assert.equal(written.files[0].errors.length,1);assert.equal(written.files[0].suiteErrors.length,1);assert.throws(()=>nativeCases(native(),'/up',written,observerPath));written=null;
 assert.throws(()=>instance.onTestRunEnd([{task}],undefined,'passed'));
 assert.throws(()=>instance.onTestRunEnd([{task}],Array(513).fill({message:'x'}),'passed'));
 assert.throws(()=>instance.onTestRunEnd([{task:{...task,tasks:Array(20001).fill({type:'test',result:{state:'pass'}})}}],[],'passed'));assert.equal(written,null);
});
test('TestLore inventories refuse incomplete execution, scope drift and duplicates',()=>{
 const raw={complete:true,executedFiles:['test/scan-dirs.test.ts'],collectionFiles:['test/scan-dirs.test.ts'],tests:[{file:'test/scan-dirs.test.ts',name:'scan-dirs scanDirExports',status:'passed'}]};assert.equal(testLoreCases(raw).cases.length,1);
 for(const change of [r=>r.complete=false,r=>r.collectionFiles=[],r=>r.tests.push(r.tests[0]),r=>r.tests[0].name='<file-load>']){const altered=structuredClone(raw);change(altered);assert.throws(()=>testLoreCases(altered));}
});
test('missing or invalid independent arms cannot manufacture routing qualification',()=>{
 assert.equal(assessUnimportRuns([], '/up',['test/scan-dirs.test.ts']).qualified,false);
 const runs=[];for(const phase of ['clean','fault','restored'])for(let repeat=0;repeat<2;repeat++)for(const arm of ['full','native','testlore'])runs.push({phase,repeat,arm,raw:native(phase==='fault'),event:{exitCode:phase==='fault'?1:0,reason:null,signal:null,stdoutSha256:'x',stderrSha256:'y'},outerMs:1});
 assert.equal(assessUnimportRuns(runs,'/up',['test/scan-dirs.test.ts']).complete,false);
});
function captures(){
 const files=['test/scan-dirs.test.ts','test/dedupe.test.ts','test/to-imports.test.ts'],runs=[];
 for(const phase of ['clean','fault','restored'])for(let repeat=0;repeat<2;repeat++)for(const arm of ['full','native','testlore']){
  const fail=phase==='fault',selected=arm==='native'?[]:arm==='full'?files:[files[0]];
  const tests=selected.map(file=>({file,name:file==='test/scan-dirs.test.ts'?'scan-dirs scanDirExports':'unchanged original case',status:fail&&file===files[0]?'failed':'passed'}));
  const raw=arm==='testlore'?{complete:true,exitCode:tests.some(t=>t.status==='failed')?1:0,executedFiles:selected,collectionFiles:selected,tests,plan:{total:3,selected,mode:'affected',decisions:files.map(file=>({test:file,selected:selected.includes(file),reasons:[selected.includes(file)?'mapped-dependency':'unchanged-unrelated']}))}}:{numPassedTests:tests.filter(t=>t.status==='passed').length,numFailedTests:tests.filter(t=>t.status==='failed').length,numPendingTests:0,numTodoTests:0,numTotalTests:tests.length,success:!tests.some(t=>t.status==='failed'),testResults:selected.map(file=>({name:'/up/'+file,status:tests.some(t=>t.file===file&&t.status==='failed')?'failed':'passed',message:'',assertionResults:tests.filter(t=>t.file===file).map(t=>({fullName:t.name,status:t.status}))}))};
  runs.push({phase,repeat,arm,raw,...(arm==='testlore'?{}:{nativeErrors:observation(raw),nativeObserverPath:observerPath}),event:{exitCode:tests.some(t=>t.status==='failed')?1:0,reason:null,signal:null,stdoutSha256:'a'.repeat(64),stderrSha256:'b'.repeat(64),durationMs:1,finalResources:{availableBytes:2*1024**3,growthBytes:0,stdoutBytes:128,stderrBytes:0},descendantCleanup:{scope:'Observed process-tree/start identity best effort; unobserved/reparented children and arbitrary subprocesses are not contained',observed:1,survivingAtClose:0,observationFailed:false,requested:false}},outerMs:2});
 }
 return {files,runs};
}
test('complete three-arm evaluator distinguishes seeded routing value from speed or historical fixes',()=>{
 const {files,runs}=captures(),result=assessUnimportRuns(runs,'/up',files);
 assert.equal(result.qualified,true);assert.equal(result.historicalUpstreamBug,false);assert.equal(result.speedAdvantageClaim,false);
 assert.equal(result.rows.length,6);assert.ok(result.rows.filter(r=>r.phase==='fault').every(r=>r.native.missedFailures===1&&r.testlore.missedFailures===0&&r.omitted===2));
});
test('absent, nonfinite and over-limit resource or cleanup receipts cannot qualify',()=>{
 for(const change of [e=>delete e.finalResources,e=>e.durationMs=NaN,e=>e.durationMs=120001,e=>e.finalResources.availableBytes=2*1024**3-1,e=>e.finalResources.growthBytes=128*1024**2+1,e=>e.finalResources.stdoutBytes=4*1024**2+1,e=>e.finalResources.stderrBytes=-1,e=>delete e.descendantCleanup,e=>e.descendantCleanup.survivingAtClose=1,e=>e.descendantCleanup.observationFailed=true,e=>e.descendantCleanup.requested=true]){
  const {files,runs}=captures();change(runs[0].event);assert.equal(assessUnimportRuns(runs,'/up',files).qualified,false);
 }
});
test('missed failures, incomplete native startup, omitted identities and duplicated decisions reject',()=>{
 for(const change of [runs=>runs.find(r=>r.phase==='fault'&&r.arm==='testlore').raw.tests[0].status='passed',runs=>runs.find(r=>r.arm==='native').event.exitCode=1,runs=>runs.find(r=>r.arm==='native').arm='unknown',runs=>runs.find(r=>r.arm==='testlore').raw.exitCode=2,runs=>runs.find(r=>r.phase==='restored'&&r.arm==='full').raw.testResults.pop(),runs=>{const p=runs.find(r=>r.arm==='testlore').raw.plan;p.decisions[2]=p.decisions[1];},runs=>runs.find(r=>r.arm==='full').event.stdoutSha256='x']){
  const {files,runs}=captures();change(runs);assert.equal(assessUnimportRuns(runs,'/up',files).qualified,false);
 }
});
