import test from 'node:test';
import assert from 'node:assert/strict';
import {renderRunReport,nextVerificationAction} from '../src/run-report.js';
import {summarizeRun,boundedSummary} from '../src/mcp-worker.js';

function interrupted(){
 return {executed:true,complete:false,shadow:true,exitCode:2,error:'Native runner stopped before a complete report',actualExecutedFilesUnverified:true,
   requestedFiles:['test/a.test.js','test/b.test.js'],executedTests:['test/a.test.js','test/b.test.js'],executedFiles:['test/a.test.js','test/b.test.js'],tests:[],
   plan:{mode:'affected',selected:['test/a.test.js'],total:2,decisions:[{test:'test/a.test.js',selected:true,reasons:['dependency-path']},{test:'test/b.test.js',selected:false,reasons:['no-known-dependency-on-change']}],warnings:[]}};
}
test('interrupted native receipt never relabels requested failed-history files as confirmed human execution',()=>{
 const report=interrupted(),markdown=renderRunReport(report);
 assert.match(markdown,/Requested 2 files/);assert.match(markdown,/omissions cannot be confirmed/);assert.match(markdown,/shadow \(full suite requested\)/);
 assert.match(markdown,/test\/a\.test\.js \| unverified \| run/);assert.match(markdown,/test\/b\.test\.js \| unverified \| omit/);
 assert.doesNotMatch(markdown,/Executed \d+ files|Actually omitted/);assert.match(markdown,/repair the prerequisites/);
 assert.deepEqual(report.executedTests,['test/a.test.js','test/b.test.js']);
});
test('agent receipt distinguishes attempted scope and confirms only independently reported named case files',()=>{
 const report=interrupted();report.tests=[
  {id:'real-failure',file:'test/a.test.js',name:'independent contract',status:'failed'},
  {id:'load-error',file:'test/b.test.js',name:'<file-load>',status:'failed'},
  {id:'skipped',file:'test/never-run.test.js',name:'skip only',status:'skipped'},
  {id:'',file:'test/identity-missing.test.js',name:'no identity',status:'passed'}
 ];
 const summary=summarizeRun(report,'shadow',{json:'.tddswarm/last-run.json',markdown:'.tddswarm/last-run.md'});
 assert.equal(summary.actualExecutedFilesUnverified,true);assert.deepEqual(summary.requestedFiles,['test/a.test.js','test/b.test.js']);assert.equal(summary.requestedFileCount,2);
 assert.deepEqual(summary.executedFiles,['test/a.test.js']);assert.equal(summary.complete,false);assert.equal(summary.verdict,'incomplete');
 assert.equal(summary.failedCases[0].id,'real-failure');assert.equal(summary.failedCases[1].id,'load-error');assert.match(summary.scopeLimitation,/omissions/);
 const markdown=renderRunReport(report);assert.match(markdown,/test\/a\.test\.js \| observed case/);assert.match(markdown,/test\/b\.test\.js \| unverified/);
 const fileLoadOnly=interrupted();fileLoadOnly.tests=[report.tests[1]];const withoutNamedCase=summarizeRun(fileLoadOnly,'shadow',null);assert.equal(withoutNamedCase.observedScopeEstablished,false);assert.deepEqual(withoutNamedCase.executedFiles,[]);
});
test('an unverified scope cannot become a passing verdict or complete shadow recall through contradictory metadata',()=>{
 const report=interrupted();report.complete=true;report.exitCode=0;report.tests=[{id:'pass',file:'test/a.test.js',name:'pass',status:'passed'}];report.comparison={complete:true,noObservedMisses:true,decisionRecall:1,omittedFailures:[]};
 const summary=summarizeRun(report,'shadow',null);assert.equal(summary.verdict,'incomplete');assert.equal(summary.complete,false);
 assert.equal(summary.comparison.complete,false);assert.equal(summary.comparison.noObservedMisses,null);assert.equal(summary.comparison.decisionRecall,null);
 assert.match(nextVerificationAction(report),/repair the prerequisites/);
 const markdown=renderRunReport(report);assert.match(markdown,/Reporting: \*\*incomplete\*\*/);assert.match(markdown,/requested execution is unverified; no certification/);assert.doesNotMatch(markdown,/Actually omitted|0 observed omitted failing cases/);
});
test('unverified file reporting and failure identities survive strict UTF-8 agent output bounds',()=>{
 const report=interrupted();report.requestedFiles=Array.from({length:300},(_,i)=>`test/case-${i}.test.js`);report.executedTests=report.requestedFiles;report.tests=[{id:'exact-failure',file:report.requestedFiles[0],name:'independent expected behavior',status:'failed'}];
 report.error='界'.repeat(20000);report.plan.warnings=Array.from({length:300},()=>({file:'x',reason:'界'.repeat(2000)}));
 const summary=boundedSummary(summarizeRun(report,'shadow',{json:'.tddswarm/last-run.json',markdown:'.tddswarm/last-run.md'}),4096);
 assert.ok(Buffer.byteLength(JSON.stringify(summary))<=4096);assert.equal(summary.actualExecutedFilesUnverified,true);assert.equal(summary.requestedFileCount,300);
 assert.equal(summary.executedFileCount,1);assert.deepEqual(summary.executedFiles,['test/case-0.test.js']);assert.equal(summary.failedCases[0].id,'exact-failure');assert.equal(summary.complete,false);assert.match(summary.nextAction,/repair the prerequisites/);
 const again=boundedSummary({...summary,error:'界'.repeat(20000)},4096);assert.equal(again.requestedFileCount,300);assert.equal(again.executedFileCount,1);assert.equal(again.actualExecutedFilesUnverified,true);
});
test('regular verified human and agent receipts preserve confirmed file and omission reporting',()=>{
 const report=interrupted();delete report.actualExecutedFilesUnverified;report.complete=true;report.exitCode=0;report.shadow=false;report.executedTests=['test/a.test.js'];report.tests=[{id:'pass',file:'test/a.test.js',name:'pass',status:'passed'}];
 const markdown=renderRunReport(report),summary=summarizeRun(report,'full',null);
 assert.match(markdown,/Executed 1 files/);assert.match(markdown,/Actually omitted: 1/);assert.match(markdown,/test\/a\.test\.js \| yes/);
 assert.equal(summary.verdict,'passed-in-observed-scope');assert.equal(summary.complete,true);assert.deepEqual(summary.executedFiles,['test/a.test.js']);assert.equal(Object.hasOwn(summary,'actualExecutedFilesUnverified'),false);assert.equal(Object.hasOwn(summary,'requestedFiles'),false);
});
