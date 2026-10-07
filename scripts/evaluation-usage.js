// Native event counters are optional worker evidence, never verified billing.
export function summarizeNativeUsage(trials){
 const calls=trials.flatMap(trial=>trial.calls||[]),keys=['input_tokens','cached_input_tokens','output_tokens'];
 let auditedCalls=0;const sums=Object.fromEntries(keys.map(key=>[key,0]));
 for(const call of calls){
  const audit=call.output?._testloreNativeAudit,usage=audit?.usage;
  if(call.identityChecks?.after!=='verified'||audit?.protocol!=='codex-exec-jsonl-v1'||audit.complete!==true||audit.toolAttempts!==0||!usage||keys.some(key=>!Number.isSafeInteger(usage[key])||usage[key]<0)||usage.cached_input_tokens>usage.input_tokens||keys.some(key=>!Number.isSafeInteger(sums[key]+usage[key])))continue;
  auditedCalls++;for(const key of keys)sums[key]+=usage[key];
 }
 return {attemptedCalls:calls.length,auditedCompletedCalls:auditedCalls,callsWithoutUsage:calls.length-auditedCalls,usageCoverageComplete:calls.length>0&&auditedCalls===calls.length,
  reportedTokenTotals:auditedCalls?sums:null,billingUSD:null,verifiedProviderModel:null,
  limitation:'Worker-reported counters from audited native completion events, with locally checked worker identities. Provider counters are not externally attested. Failed, timed-out or rejected calls can consume unreported tokens; totals cover only the reported calls. Cached input is a subset of input. No token pricing or dollar estimate is inferred.'};
}
