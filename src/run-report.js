// Render bounded, escaped decision evidence; test output is retained only in JSON.
const escape = value => String(value ?? '').replace(/[\\`*_{}[\]<>|]/g, '\\$&').replace(/[\r\n]+/g, ' ').slice(0, 1000);
const array = value => Array.isArray(value) ? value : [];
const object = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const strings = value => [...new Set(array(value).filter(item => typeof item === 'string' && item.length > 0))];
const label = value => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 512) : '';
const count = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
const nativeAdapters = new Set(['node', 'vitest', 'jest', 'playwright', 'bun']);
// Canonical analyzer codes only. Arbitrary warning text can contain test output,
// credentials or instructions; the summary never echoes it or executes it.
const causeProfiles = [
 {key:'runtime-inputs',label:'Runtime inputs are not fully mapped',action:'Declare and review filesystem, network and service inputs; retain fallback until independent full/subset challenges pass.',codes:['runtime-dependency','dynamic-dependency','runtime-registration','unmodeled-node-options-runtime-context']},
 {key:'browser-inputs',label:'Browser dependencies are incomplete',action:'Propose route, style, asset and server-input mappings, then challenge them in shadow mode before permitting omissions.',codes:['unmodeled-browser-runtime-inputs']},
 {key:'resolution',label:'Discovery or dependency resolution needs review',action:'Run testlore doctor --json and the native full-suite command; repair workspace roots, setup files and unresolved imports.',codes:['incomplete-native-resolution','incomplete-native-discovery','discovery-incomplete','discovered-file-outside-graph','external-resolution-config','resolution-config-outside-graph','invalid-tsconfig','invalid-tsconfig-resolution','invalid-package-json','parse-error','unresolved-import']},
 {key:'mappings',label:'Changed inputs have no complete test mapping',action:'Review affected inputs and propose explicit test mappings; verify them with independent full/subset runs in shadow mode.',codes:['unknown-mapped-test','missing-mapped-dependency','unmapped-or-deleted-input','change-without-test-evidence','uncertain-dependency-closure','test-without-local-dependencies','unknown-always-run-test']},
 {key:'services',label:'Service versions or probes are unavailable',action:'Repair the declared service probe and version evidence before rerunning full verification.',codes:['service-probe-failed','service-version-unavailable','invalid-service-history','external-service-evidence-unavailable']},
 {key:'freshness',label:'Configuration or retained evidence requires fresh verification',action:'Inspect configuration and provenance, repair invalid evidence, and rerun full native verification before reusing a selection.',codes:['global-configuration-changed','configuration-input-profile-rejected','configuration-input-unavailable','git-baseline-unavailable','runner-or-environment-history-changed','invalid-run-history','failed-history-scope-changed','runtime-evidence-missing','invalid-runtime-evidence','incomplete-runtime-evidence','stale-runtime-evidence','runtime-scope-changed']},
 {key:'isolation',label:'Tests share a native process or project context',action:'Keep the shared project together; qualify process and external-effect isolation before splitting it.',codes:['shared-project-isolation']},
 {key:'policy',label:'A configured policy requires a full run',action:'Review the full-run policy; its presence is not a discovery failure or a measured optimization opportunity.',codes:['explicit-full-run','periodic-full-run']},
 {key:'dependency-fallback',label:'Dependency uncertainty requires conservative execution',action:'Inspect the detailed dependency decisions and validate narrower mappings in shadow mode.',codes:['dependency-graph-incomplete']}
];
function fallbackCauses(selection) {
 const groups = new Map(), seen = new Set();
 const add = (reason, file, scope) => {
   const canonical = typeof reason === 'string' ? reason.startsWith('unresolved-import:') ? 'unresolved-import' : reason : 'invalid-warning-record';
   file=typeof file==='string'?file:undefined;scope=typeof scope==='string'?scope:undefined;
   const profile = causeProfiles.find(item => item.codes.includes(canonical));
   const key = profile?.key || 'other-uncertainty';
   const identity = JSON.stringify([canonical, file, scope]);
   if(seen.has(identity))return;seen.add(identity);
   const group = groups.get(key) || {key,label:profile?.label || 'Additional analyzer uncertainty needs review',action:profile?.action || 'Inspect the bounded decision details and JSON receipt; retain conservative verification until the uncertainty is explained.',count:0,reasons:[],files:[],scopes:[]};
   group.count++;
   if(profile && !group.reasons.includes(canonical))group.reasons.push(canonical);
   if(typeof file==='string' && file.length && !group.files.includes(file))group.files.push(file);
   if(['global','test-closure','unreachable-source'].includes(scope) && !group.scopes.includes(scope))group.scopes.push(scope);
   groups.set(key,group);
 };
 // These classifications come from the analyzer, not an independent safety
 // proof. Out-of-closure observations stay in raw/detail evidence but are not
 // presented as active fallback causes. Prioritize global blocker examples.
 const priority=item=>object(item).scope==='global'?0:object(item).scope==='test-closure'?1:2;
 const activeWarnings=array(selection.warnings).filter(item=>object(item).scope!=='unreachable-source').sort((a,b)=>priority(a)-priority(b));
 for(const warning of activeWarnings) {
   if(typeof warning==='string')add(warning);
   else {const item=object(warning);add(item.reason,item.file,item.scope);}
 }
 for(const reason of strings(selection.reasons))add(reason);
 // Per-file retention rules can matter without appearing in global reasons.
 for(const decision of array(selection.decisions))for(const reason of strings(object(decision).reasons))
   if(causeProfiles.some(profile=>profile.codes.includes(reason)))add(reason,decision.test);
 return [...groups.values()].map(group=>({...group,files:group.files.slice(0,5).map(label),fileCount:group.files.length,filesTruncated:group.files.length>5}));
}
/** Advisory first-run evidence. It grants no selection or deployment authority. */
export function summarizeFirstRun(input = {}) {
 const report=object(input),selection=object(report.plan),delegated=report.delegated===true || selection.targets!==undefined;
 const fileEvidence=executionFileEvidence(report),ran=new Set(fileEvidence.executedFiles),requested=fileEvidence.requestedFiles;
 const decisions=new Map();let invalidDecisions=false;
 for(const item of array(selection.decisions)) {
   const decision=object(item);
   if(typeof decision.test!=='string' || !decision.test.length){invalidDecisions=true;continue;}
   const decisionIdentity=value=>JSON.stringify([value.selected,strings(value.reasons)]);
   if(decisions.has(decision.test) && decisionIdentity(decisions.get(decision.test))!==decisionIdentity(decision))invalidDecisions=true;
   else decisions.set(decision.test,decision);
 }
 const proposed=strings(selection.selected),knownFiles=[...new Set([...decisions.keys(),...proposed])];
 const declaredTotal=count(selection.total),inventoryConsistent=!invalidDecisions && (selection.total===undefined || declaredTotal!==null) && (declaredTotal===null || declaredTotal>=knownFiles.length);
 const cases=new Map(),duplicateIds=new Set();let invalidCases=false,conflictingCases=false,duplicateCases=0,rejectedCaseRecords=0;
 for(const item of array(report.tests)) {
   const entry=object(item);
   if(typeof entry.id!=='string'||!entry.id.length||typeof entry.file!=='string'||!entry.file.length||typeof entry.name!=='string'||!entry.name.length||!['passed','failed','skipped'].includes(entry.status)){invalidCases=true;rejectedCaseRecords++;continue;}
   const previous=cases.get(entry.id);
   if(previous){duplicateIds.add(entry.id);duplicateCases++;}
   if(previous && (previous.file!==entry.file||previous.name!==entry.name||previous.status!==entry.status)){conflictingCases=true;if(entry.status==='failed')cases.set(entry.id,entry);continue;}
   if(!previous)cases.set(entry.id,entry);
 }
 const records=[...cases.values()],failures=records.filter(entry=>entry.status==='failed');
 const observedNamedCases=records.filter(entry=>entry.name!=='<file-load>'&&['passed','failed'].includes(entry.status));
 const namedFiles=new Set(observedNamedCases.map(entry=>entry.file));
 const filesWithoutNamedOutcomes=[...ran].filter(file=>!namedFiles.has(file));
 const caseFilesOutsideExecuted=[...namedFiles].filter(file=>!ran.has(file));
 const rawOmittedFailures=array(report.comparison?.omittedFailures),omittedById=new Map();
 for(const item of rawOmittedFailures){const entry=object(item);if(typeof entry.id==='string'&&entry.id.length&&!omittedById.has(entry.id))omittedById.set(entry.id,entry);}
 const omittedFailures=[...omittedById.values()];
 const missingRequested=requested.filter(file=>!ran.has(file));
 const malformedCaseArray=report.tests!==undefined && !Array.isArray(report.tests) && !(delegated && report.tests===null);
 const malformedComparison=report.comparison?.omittedFailures!==undefined && (!Array.isArray(report.comparison.omittedFailures) || rawOmittedFailures.some(item=>typeof item?.id!=='string'||!item.id.length));
 const malformedScopeArrays=['requestedFiles','executedTests','executedFiles'].some(key=>report[key]!==undefined && (!Array.isArray(report[key]) || report[key].some(file=>typeof file!=='string'||!file.length)));
 const planMalformed=['selected','decisions'].some(key=>selection[key]!==undefined && !Array.isArray(selection[key])) ||
   array(selection.selected).some(file=>typeof file!=='string'||!file.length);
 const incomplete=report.executed!==true || report.complete!==true || fileEvidence.unverified || !Number.isInteger(report.exitCode) ||
   malformedCaseArray || malformedComparison || malformedScopeArrays || planMalformed || invalidCases || conflictingCases || duplicateCases>0 || !inventoryConsistent ||
   Boolean(report.signal) || Boolean(report.error) || (report.reportErrors!==undefined && (!Array.isArray(report.reportErrors)||report.reportErrors.length>0)) ||
   (!delegated && (filesWithoutNamedOutcomes.length>0 || caseFilesOutsideExecuted.length>0)) ||
   (!delegated && missingRequested.length>0) || (!delegated && observedNamedCases.length===0);
 const contracts=object(report.contracts),contractsRequested=report.contracts!==undefined;
 const contractRows=array(contracts.runs),emptyHash='e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
 const contractShape=Array.isArray(contracts.runs)&&contractRows.length>0&&contractRows.length<=32&&new Set(contractRows.map(row=>row?.id)).size===contractRows.length&&
  new Set(contractRows.map(row=>row?.script)).size===contractRows.length&&contractRows.every(row=>
   typeof row?.id==='string'&&/^[-a-zA-Z0-9_.]{1,100}$/.test(row.id)&&typeof row.script==='string'&&row.script.endsWith('.cjs')&&!row.script.includes('\\')&&row.script.split('/').every(part=>part&&part!=='.'&&part!=='..'&&!part.startsWith('.'))&&
   row.signal===null&&row.errorCode===null&&row.stderrSha256===emptyHash&&/^[a-f0-9]{64}$/.test(row.scriptSha256||'')&&/^[a-f0-9]{64}$/.test(row.stdoutSha256||'')&&
   row.observed?.id===row.id&&Number.isSafeInteger(row.observed.assertions)&&row.observed.assertions>0&&row.observed.assertions<=100000&&
   ((row.passed===true&&row.exitCode===0&&row.observed.status==='passed')||(row.passed===false&&row.exitCode===1&&row.observed.status==='failed')));
 const contractPassed=contractShape&&contracts.status==='passed'&&contracts.complete===true&&contracts.exitCode===0&&Array.isArray(contracts.reasons)&&contracts.reasons.length===0&&contractRows.every(row=>row.passed);
 const contractFailed=contractShape&&contracts.status==='failed'&&contracts.complete===true&&contracts.exitCode===1&&Array.isArray(contracts.reasons)&&contracts.reasons.length>0&&contracts.reasons.every(reason=>typeof reason==='string'&&contractRows.some(row=>!row.passed&&reason===`repair-challenge-failed:${row.id}`))&&contractRows.some(row=>!row.passed);
 const contractIncomplete=contractsRequested&&!contractPassed&&!contractFailed;
 const verdict=incomplete||contractIncomplete?'incomplete':omittedFailures.length?'omitted-failures-observed':(report.exitCode!==0||failures.length||contractFailed)?'failed':delegated?'native-result-reported':'passed-in-observed-scope';
 const nextAction=contractIncomplete?'Inspect incomplete behavioral contract evidence, preserve its independent assertions, and rerun verification. Native case outcomes remain separate.':
   contractFailed?'Inspect the named behavioral challenge failures, even when native tests passed. Repair independently established defects and preserve the challenge assertions.':
   verdict==='incomplete'&&report.executed!==true&&!delegated&&declaredTotal===0&&selection.discovery?.complete!==false?
   'No native test files were discovered. Run testlore doctor --json to confirm your runner; if the project has no tests, add independent behavioral requirements in tddswarm.requirements.md before requesting generation.':
   verdict==='incomplete'?nextVerificationAction({executed:false}):
   verdict==='omitted-failures-observed'?nextVerificationAction({...report,comparison:{omittedFailures}}):
   verdict==='failed'?nextVerificationAction({...report,exitCode:1}):nextVerificationAction({...report,delegated});
 const failedCases=failures.slice(0,10).map(entry=>({id:label(entry.id),file:label(entry.file),name:label(entry.name),status:'failed'}));
 const omittedCaseIdentities=omittedFailures.slice(0,10).map(item=>{const entry=object(item);return {id:label(entry.id),file:label(entry.file),name:label(entry.name)};});
 // Parsers may use zero for missing native duration. Only positive finite
 // numeric durations are useful here; they are per-case reports, not savings.
 const timed=report.executed===true && nativeAdapters.has(report.adapter)?records.filter(entry=>
   ['passed','failed'].includes(entry.status) && entry.name!=='<file-load>' &&
   !duplicateIds.has(entry.id) && typeof entry.durationMs==='number' && Number.isFinite(entry.durationMs) && entry.durationMs>0):[];
 const slowCases=[...timed].sort((a,b)=>b.durationMs-a.durationMs||a.id.localeCompare(b.id)).slice(0,5)
   .map(entry=>({id:label(entry.id),file:label(entry.file),name:label(entry.name),durationMs:entry.durationMs}));
 const fallback=fallbackCauses(selection);
 const timing=object(report.timings),validTiming=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0?value:null;
 return {
   schemaVersion:1,advisory:true,verdict,complete:!incomplete&&!contractIncomplete,delegated,
   behavioralContracts:{requested:contractsRequested,status:contractsRequested?contractPassed?'passed':contractFailed?'failed':'incomplete':'not-configured',
    nativeExitCode:contractsRequested?(Number.isInteger(report.nativeExitCode)?report.nativeExitCode:null):report.exitCode,
    observed:array(contracts.runs).length,failed:array(contracts.runs).filter(row=>row?.passed===false).slice(0,32).map(row=>({id:label(row.id),script:label(row.script)})),
    durationMs:typeof contracts.durationMs==='number'&&Number.isFinite(contracts.durationMs)?contracts.durationMs:null,
    scope:'Declared Node behavioral oracles only; unconfigured fuzzing, security, type, browser and service checks are not established.'},
   nativeExecution:delegated?{adapter:label(report.adapter||selection.adapter),mode:label(selection.mode||'native'),targetCount:Array.isArray(selection.targets)?selection.targets.length:null}:null,
   displayLimits:{maxLabelCharacters:512,maxFailures:10,maxOmittedFailures:10,maxSlowCases:5,maxCauseFileExamples:5},
   labelsTruncated:[...failures,...omittedFailures,...timed].some(entry=>[entry.id,entry.file,entry.name].some(value=>typeof value==='string'&&value.length>512)),
   authority:{selection:'unchanged',deploymentSafety:'not-established',measuredSavings:'not-established'},
   scope:delegated?'Native target result only; individual case inventory and omission safety remain unverified.':
     incomplete?'Execution or identity evidence is incomplete; reported outcomes cannot establish the requested scope or omitted-test safety.':
     'Named outcomes in this execution only; no deployment safety or independent subset recall is established.',
   files:{requested:requested.length,observed:ran.size,missingRequested:missingRequested.length,withoutNamedOutcomes:filesWithoutNamedOutcomes.length,caseFilesOutsideExecuted:caseFilesOutsideExecuted.length,inventory:declaredTotal,
     proposed:proposed.length,proposedOmissions:inventoryConsistent&&declaredTotal!==null?declaredTotal-proposed.length:null,
     actualOmissions:!incomplete&&!delegated&&declaredTotal!==null&&decisions.size===declaredTotal?[...decisions.keys()].filter(file=>!ran.has(file)).length:null,
     actualScopeVerified:!incomplete&&!delegated},
   cases:delegated?null:{reported:records.length,observedNamed:observedNamedCases.length,fileLoadFailures:failures.filter(entry=>entry.name==='<file-load>').length,passed:records.filter(entry=>entry.status==='passed').length,failed:failures.length,skipped:records.filter(entry=>entry.status==='skipped').length,
     identityComplete:!invalidCases&&!conflictingCases&&!malformedCaseArray&&duplicateCases===0,duplicates:duplicateCases,rejectedRecords:rejectedCaseRecords,conflictingIdentities:conflictingCases},
   failedCases,failedCaseCount:failures.length,failedCasesTruncated:failures.length>failedCases.length,
   omittedFailures:omittedCaseIdentities,omittedFailureCount:omittedFailures.length,omittedFailureDuplicates:rawOmittedFailures.length-omittedFailures.length,omittedFailuresTruncated:omittedFailures.length>omittedCaseIdentities.length,
   fallbackCauses:fallback,
   analyzerObservations:{outsideKnownTestClosureRecords:array(selection.warnings).filter(item=>object(item).scope==='unreachable-source').length,
     scope:'Analyzer classifications only; excluded from active fallback advice and retained in detailed evidence. They do not prove dependency completeness.'},
   slowCases,slowCaseCount:timed.length,slowCasesTruncated:timed.length>slowCases.length,
   caseTimingScope:'Positive finite durations reported by the native adapter for named cases only. Parallelism, setup and startup are not attributed; these are not suite savings.',
   casesWithoutUsableTiming:delegated?null:records.filter(entry=>entry.name!=='<file-load>').length-timed.length,
   timings:{totalMs:validTiming(timing.totalMs),planningMs:validTiming(timing.planningMs),executionMs:validTiming(timing.executionMs),scope:'Reported run spans; final report sealing may be excluded. No native baseline comparison or savings is inferred.'},
   nextAction
 };
}
export function renderFirstRunSummary(report = {}) {
 const summary=summarizeFirstRun(report),text=['## TestLore first-run summary','',`Result: **${escape(summary.verdict)}**. ${escape(summary.scope)}`,'',`Next action: ${escape(summary.nextAction)}`,''];
 if(summary.delegated){
   text.push(`${escape(summary.nativeExecution.adapter||'unknown engine')} · ${escape(summary.nativeExecution.mode)} · ${summary.nativeExecution.targetCount===null?'target selection delegated to native execution':summary.nativeExecution.targetCount+' native targets'}. Runner exited ${Number.isInteger(report.exitCode)?report.exitCode:'unknown'}; evidence ${summary.complete?'complete':'incomplete'}.`);
   text.push('Case outcomes and actual omissions: unknown; inspect the native engine report. Native scope is preserved; no individual-case comparison is implied.');
 }
 else {
   text.push(`Requested files: ${summary.files.requested}. Reported file scope: ${summary.files.observed}${summary.files.actualScopeVerified?'':' (unverified as a complete execution)'}. Reported native outcomes: ${summary.cases.passed} passed, ${summary.cases.failed} failed, ${summary.cases.skipped} skipped${summary.cases.fileLoadFailures?' (includes '+summary.cases.fileLoadFailures+' file-load failures)':''}.`);
   text.push(`Proposed omissions: ${summary.files.proposedOmissions??'unknown'}. Actual omissions: ${summary.files.actualOmissions??'unverified'}. A proposed omission is not an executed subset or a speed measurement.`);
   if(summary.files.missingRequested||summary.files.withoutNamedOutcomes||summary.files.caseFilesOutsideExecuted)text.push(`Execution gaps: ${summary.files.missingRequested} requested files absent from the reported scope; ${summary.files.withoutNamedOutcomes} reported files without named execution outcomes; ${summary.files.caseFilesOutsideExecuted} named outcome files outside that scope.`);
 }
 if(summary.failedCases.length)text.push('');
 for(const failure of summary.failedCases)text.push(`- Failed: ${escape(failure.file)} — ${escape(failure.name)} (identity: ${escape(failure.id)}).`);
 const behavioral=summary.behavioralContracts;
 text.push('',`Additional behavioral challenges: ${escape(behavioral.status)}; ${behavioral.observed} observed. ${escape(behavioral.scope)}`);
 if(behavioral.requested)text.push(`Native runner exit: ${behavioral.nativeExitCode??'unknown'}. Overall exit: ${Number.isInteger(report.exitCode)?report.exitCode:'unknown'}. Contract span: ${behavioral.durationMs===null?'unknown':behavioral.durationMs+' ms'}.`);
 for(const failure of behavioral.failed)text.push(`- Behavioral check did not pass: ${escape(failure.id)} (${escape(failure.script)}). Preserve its assertions; inspect the JSON receipt.`);
 if(summary.failedCasesTruncated)text.push(`Showing ${summary.failedCases.length}/${summary.failedCaseCount} failures; remaining identities are in the JSON receipt.`);
 if(summary.omittedFailureCount)text.push('',`Shadow detected ${summary.omittedFailureCount} failing case records that the proposed selection would omit. Keep shadow mode enabled.`,'');
 for(const failure of summary.omittedFailures)text.push(`- Proposed omission failure: ${escape(failure.file||'file unavailable')} — ${escape(failure.name||'name unavailable')} (identity: ${escape(failure.id||'unavailable')}).`);
 if(summary.omittedFailuresTruncated)text.push(`Showing ${summary.omittedFailures.length}/${summary.omittedFailureCount} proposed-omission failures; see the JSON receipt.`);
 if(summary.fallbackCauses.length)text.push('','Fallback and retention causes (advisory):','');
 for(const cause of summary.fallbackCauses)text.push(`- ${escape(cause.label)} (${cause.count} distinct evidence records). ${escape(cause.action)}${cause.files.length?' Examples: '+cause.files.map(escape).join(', ')+'.':''}${cause.filesTruncated?' More paths are in the JSON receipt.':''}`);
 if(summary.analyzerObservations.outsideKnownTestClosureRecords)text.push('',`${summary.analyzerObservations.outsideKnownTestClosureRecords} analyzer warning records are classified outside known test closures; they are retained in detailed evidence and are not active fallback advice. This classification does not prove complete dependencies.`);
 if(summary.slowCases.length){text.push('','Largest reported case durations:','');for(const entry of summary.slowCases)text.push(`- ${escape(entry.file)} — ${escape(entry.name)}: ${entry.durationMs} ms.`);text.push('',escape(summary.caseTimingScope));}
 else text.push('','Named-case timing: unknown or unavailable; no slow-case ranking or savings is inferred.');
 text.push(`Cases without usable positive native duration: ${summary.casesWithoutUsableTiming??'unknown'}. Total reported run span: ${summary.timings.totalMs===null?'unknown':summary.timings.totalMs+' ms'}; no savings comparison is established.`);
 return text.join('\n')+'\n';
}
// Interrupted native execution can retain its requested scope for failed-run
// history. That scope is not evidence that any particular file executed.
export function executionFileEvidence(report={}){
 report=object(report);
 const unverified=report.actualExecutedFilesUnverified===true;
 const files=value=>Array.isArray(value)?[...new Set(value.filter(file=>typeof file==='string'&&file.length>0))]:[];
 const requestedFiles=files(report.requestedFiles||report.executedTests||report.executedFiles||[]);
 const executedFiles=unverified?files((Array.isArray(report.tests)?report.tests:[]).filter(test=>
   test&&['passed','failed'].includes(test.status)&&typeof test.id==='string'&&test.id.length>0&&
   typeof test.name==='string'&&test.name.length>0&&test.name!=='<file-load>').map(test=>test.file)):
   files(report.executedTests||report.executedFiles||[]);
 return {unverified,requestedFiles,executedFiles};
}
export function nextVerificationAction(report={}){
 report=object(report);
 if(report.executed!==true||report.complete!==true||report.actualExecutedFilesUnverified===true)return 'Inspect the execution or discovery issue and run testlore doctor --json; repair the prerequisites and rerun full native verification after changes.';
 if(report.comparison?.omittedFailures?.length)return 'Keep shadow mode enabled. Investigate the omitted failing case identities and revise dependency mappings before considering selective execution.';
 if(report.exitCode!==0)return 'Inspect the failed case identities and durable receipts, repair the independently established defect, then rerun the full suite.';
 if(report.delegated)return 'Inspect the native engine report and target decisions; individual case preservation and omitted-test safety remain unverified.';
 return 'Review remaining dependency uncertainty and independent defect obligations. Keep shadow mode until representative full/subset comparisons support selective execution; rerun verification after changes.';
}
export function renderRunReport(input = {}) {
 const report=object(input),rawSelection=object(report.plan);
 const firstSummary=summarizeFirstRun(report);
 const selection={...rawSelection,reasons:strings(rawSelection.reasons)},decisions=array(selection.decisions).filter(d=>d&&typeof d==='object'&&typeof d.test==='string');
 if(report.delegated || selection.targets !== undefined){
   const targets=selection.targets,rows=['## TestLore native engine evidence','',`Adapter: **${escape(report.adapter||selection.adapter)}**. Mode: **${report.shadow?'shadow/full native scope':escape(selection.mode||'native')}**. Exit: **${escape(report.exitCode??'unknown')}**.`, '', `Native targets: ${Array.isArray(targets)?targets.length:'selected during execution'}. Native result: ${firstSummary.complete?'reported':'incomplete'}. Individual case inventory and independent subset recall are not established.`, '', `Why: ${escape((selection.reasons||[]).join('; ')||selection.evidence||'Selection delegated to the configured native engine')}.`];
   if(Array.isArray(targets))rows.push('');
   if(Array.isArray(targets))for(const target of targets.slice(0,200))rows.push(`- ${escape(target)}`);
   if(report.error)rows.push('',`Execution issue: ${escape(report.error)}`);
   rows.push('','Omitted targets and their dependency decisions are owned by the native engine; inspect the JSON command and native report. This report makes no individual-case safety claim.','',`Next action: ${firstSummary.nextAction}`);return renderFirstRunSummary(report)+'\n'+rows.join('\n')+'\n';
 }
 const nativeSummary=report.contracts===undefined?firstSummary:summarizeFirstRun({...report,exitCode:report.nativeExitCode,contracts:undefined});
 const unverified=report.actualExecutedFilesUnverified===true||!nativeSummary.complete;
 const fileEvidence=executionFileEvidence(unverified?{...report,actualExecutedFilesUnverified:true}:report);
 const ran = new Set(fileEvidence.executedFiles),requested=new Set(fileEvidence.requestedFiles);
 const proposed = new Set(strings(selection.selected));
 const tests = array(report.tests).filter(t=>t&&typeof t==='object');
 const warnings = array(selection.warnings);
 const text = ['## TestLore execution evidence', '',
  `Mode: **${report.shadow ? unverified?'shadow (full suite requested)':'shadow (full suite)' : escape(selection.mode || report.mode || 'unavailable')}**. Reporting: **${report.complete === true&&!unverified ? 'complete' : 'incomplete'}**. Exit: **${escape(report.exitCode ?? 'unknown')}**.`, '',
  unverified?`Requested ${requested.size} files. Execution of the requested file scope is unverified; omissions cannot be confirmed. ${ran.size} files have independently reported named case outcomes. Reported cases: ${tests.filter(t=>t.status==='passed').length} passed, ${tests.filter(t=>t.status==='failed').length} failed, ${tests.filter(t=>t.status==='skipped').length} skipped. Proposed selection: ${proposed.size}/${selection.total ?? '?'} files.`:
    `Executed ${ran.size} files: ${tests.filter(t=>t.status==='passed').length} passed, ${tests.filter(t=>t.status==='failed').length} failed, ${tests.filter(t=>t.status==='skipped').length} skipped cases. Proposed selection: ${proposed.size}/${selection.total ?? '?'} files. Actually omitted: ${firstSummary.files.actualOmissions??'unverified (decision inventory incomplete)'}.`, '',
  'Observed passing cases and dependency traces do not establish all possible behavior.'];
 if(report.error)text.push('', `Execution issue: ${escape(report.error)}`);
 if(report.timings){const other=report.timings.otherMs;text.push('', `Measured work ${firstSummary.timings.totalMs??'unknown'} ms; planning (including discovery) ${firstSummary.timings.planningMs??'unknown'} ms; execution ${firstSummary.timings.executionMs??'unknown'} ms; other checks and history retention ${typeof other==='number'&&Number.isFinite(other)&&other>=0?other:'unknown'} ms. Final report sealing is excluded here; pilot total spans include it.`);}
 if(report.comparison)text.push('',`Shadow evidence: ${unverified?'incomplete; requested execution is unverified; no certification':report.comparison.complete && Array.isArray(report.comparison.omittedFailures) ? report.comparison.omittedFailures.length+' observed omitted failing cases' : 'incomplete; no certification'}. This compares file membership in one full run; independent subset runs can reveal order effects.`);
 if(decisions.length){text.push('', `| Test file | ${unverified?'Execution':'Executed'} | Proposed | Why |`, '| --- | --- | --- | --- |');for(const d of decisions.slice(0,200))text.push(`| ${escape(d.test)} | ${unverified?ran.has(d.test)?'observed case':'unverified':ran.has(d.test)?'yes':'no'} | ${proposed.has(d.test)?'run':'omit'} | ${escape(strings(d.reasons).join('; ') || 'no changed dependency found')} |`);if(decisions.length>200)text.push('',`Showing 200/${decisions.length} decisions; full paths are in the JSON receipt.`);}
 text.push('', 'Uncertainty:');
 if(!warnings.length)text.push('', '- No unresolved analyzer warnings were reported for this scope. Undeclared runtime inputs and unexercised browser paths remain limitations.');
 else for(const w of warnings.slice(0,100))text.push(`- ${escape(typeof w==='string'?w:[object(w).file,object(w).reason,object(w).scope].filter(Boolean).join(': '))}`);
 if(warnings.length>100)text.push('- Remaining warnings are retained in the JSON receipt.');
 text.push('',`Next action: ${firstSummary.nextAction}`);
 return renderFirstRunSummary(report)+'\n'+text.join('\n')+'\n';
}
