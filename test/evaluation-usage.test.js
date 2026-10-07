import test from 'node:test';
import assert from 'node:assert/strict';
import {summarizeNativeUsage} from '../scripts/evaluation-usage.js';
const call=usage=>({identityChecks:{after:'verified'},output:{_testloreNativeAudit:{protocol:'codex-exec-jsonl-v1',complete:true,toolAttempts:0,usage}}});
test('usage accounting retains unknown failed-call cost and never invents billing',()=>{
 const known=call({input_tokens:100,cached_input_tokens:30,output_tokens:20});
 const report=summarizeNativeUsage([{calls:[known,{error:'timeout'}]}]);
 assert.equal(report.auditedCompletedCalls,1);assert.equal(report.callsWithoutUsage,1);assert.equal(report.usageCoverageComplete,false);
 assert.deepEqual(report.reportedTokenTotals,{input_tokens:100,cached_input_tokens:30,output_tokens:20});assert.equal(report.billingUSD,null);
 assert.equal(summarizeNativeUsage([{calls:[{error:'timeout'}]}]).reportedTokenTotals,null);
});
test('invalid, drifting and tool-bearing audit claims do not establish usage',()=>{
 const good=()=>call({input_tokens:10,cached_input_tokens:5,output_tokens:2});
 const drift=good();drift.identityChecks.after='rejected';
 const tools=good();tools.output._testloreNativeAudit.toolAttempts=1;
 const excessive=call({input_tokens:10,cached_input_tokens:11,output_tokens:2});
 const report=summarizeNativeUsage([{calls:[drift,tools,excessive,call({input_tokens:NaN,cached_input_tokens:0,output_tokens:0})]}]);
 assert.equal(report.auditedCompletedCalls,0);assert.equal(report.reportedTokenTotals,null);assert.equal(report.usageCoverageComplete,false);
});
