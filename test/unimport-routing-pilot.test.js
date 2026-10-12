import test from 'node:test';
import assert from 'node:assert/strict';
import {nativeCases,testLoreCases,assessUnimportRuns,selectPnpmManager} from '../scripts/unimport-routing-pilot.js';
test('manager selection follows exact native pnpm12 manifest and refuses ambiguity or unsafe bins',()=>{
 const row={cacheEntry:'a1b2c3',manifest:{name:'pnpm',version:'12.3.4',bin:{pnpm:'pnpm'}}};
 assert.deepEqual(selectPnpmManager([row]),{cacheEntry:'a1b2c3',entrypoint:'pnpm'});
 for(const records of [[],[row,row],null])assert.throws(()=>selectPnpmManager(records));
 for(const change of [r=>r.cacheEntry='../escape',r=>r.manifest.name='fake',r=>r.manifest.version='12.3.5',r=>r.manifest.bin.pnpm='bin/pnpm.cjs',r=>r.manifest.bin.pnpm='../escape',r=>r.manifest.bin.pnpm='/bin/pnpm',r=>delete r.manifest.bin]){const altered=structuredClone(row);change(altered);assert.throws(()=>selectPnpmManager([altered]));}
});
const native=(failed=false)=>({numRuntimeErrorTestSuites:0,numPassedTests:failed?0:1,numFailedTests:failed?1:0,numPendingTests:0,numTotalTests:1,success:!failed,testResults:[{name:'/up/test/scan-dirs.test.ts',assertionResults:[{fullName:'scan-dirs scanDirExports',status:failed?'failed':'passed'}]}]});
test('native inventories reject duplicates, malformed summaries, errors and unknown statuses',()=>{
 assert.equal(nativeCases(native(),'/up').cases.length,1);
 for(const change of [r=>r.numTotalTests=2,r=>r.numRuntimeErrorTestSuites=1,...['unknown','todo','disabled','skipped'].map(status=>r=>r.testResults[0].assertionResults[0].status=status),r=>r.testResults[0].assertionResults.push(r.testResults[0].assertionResults[0]),r=>r.testResults[0].name='/outside/test.ts']){const raw=native();change(raw);assert.throws(()=>nativeCases(raw,'/up'));}
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
  const raw=arm==='testlore'?{complete:true,exitCode:tests.some(t=>t.status==='failed')?1:0,executedFiles:selected,collectionFiles:selected,tests,plan:{total:3,selected,mode:'affected',decisions:files.map(file=>({test:file,selected:selected.includes(file),reasons:[selected.includes(file)?'mapped-dependency':'unchanged-unrelated']}))}}:{numRuntimeErrorTestSuites:0,numPassedTests:tests.filter(t=>t.status==='passed').length,numFailedTests:tests.filter(t=>t.status==='failed').length,numPendingTests:0,numTotalTests:tests.length,success:!tests.some(t=>t.status==='failed'),testResults:selected.map(file=>({name:'/up/'+file,assertionResults:tests.filter(t=>t.file===file).map(t=>({fullName:t.name,status:t.status}))}))};
  runs.push({phase,repeat,arm,raw,event:{exitCode:tests.some(t=>t.status==='failed')?1:0,reason:null,signal:null,stdoutSha256:'a'.repeat(64),stderrSha256:'b'.repeat(64),durationMs:1,finalResources:{availableBytes:2*1024**3,growthBytes:0,stdoutBytes:128,stderrBytes:0},descendantCleanup:{scope:'Observed process-tree/start identity best effort; unobserved/reparented children and arbitrary subprocesses are not contained',observed:1,survivingAtClose:0,observationFailed:false,requested:false}},outerMs:2});
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
