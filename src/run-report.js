// Render bounded, escaped decision evidence; test output is retained only in JSON.
const escape = value => String(value ?? '').replace(/[\\`*_{}[\]<>|]/g, '\\$&').replace(/[\r\n]+/g, ' ').slice(0, 1000);
export function renderRunReport(report = {}) {
 const selection = report.plan || {}, decisions = selection.decisions || [];
 if(report.delegated || selection.targets !== undefined){
   const targets=selection.targets,rows=['## TestLore native engine evidence','',`Adapter: **${escape(report.adapter||selection.adapter)}**. Mode: **${report.shadow?'shadow/full native scope':escape(selection.mode||'native')}**. Exit: **${report.exitCode??'unknown'}**.`, '', `Native targets: ${Array.isArray(targets)?targets.length:'selected during execution'}. Native result: ${report.complete===true?'reported':'incomplete'}. Individual case inventory and independent subset recall are not established.`, '', `Why: ${escape((selection.reasons||[]).join('; ')||selection.evidence||'Selection delegated to the configured native engine')}.`];
   if(Array.isArray(targets))rows.push('');
   if(Array.isArray(targets))for(const target of targets.slice(0,200))rows.push(`- ${escape(target)}`);
   if(report.error)rows.push('',`Execution issue: ${escape(report.error)}`);
   rows.push('','Omitted targets and their dependency decisions are owned by the native engine; inspect the JSON command and native report. This report makes no individual-case safety claim.');return rows.join('\n')+'\n';
 }
 const ran = new Set(report.executedTests || report.executedFiles || []);
 const proposed = new Set(selection.selected || []);
 const omitted = decisions.filter(d => !ran.has(d.test));
 const tests = report.tests || [];
 const warnings = selection.warnings || [];
 const text = ['## TestLore execution evidence', '',
  `Mode: **${report.shadow ? 'shadow (full suite)' : selection.mode || report.mode || 'unavailable'}**. Reporting: **${report.complete === true ? 'complete' : 'incomplete'}**. Exit: **${report.exitCode ?? 'unknown'}**.`, '',
  `Executed ${ran.size} files: ${tests.filter(t=>t.status==='passed').length} passed, ${tests.filter(t=>t.status==='failed').length} failed, ${tests.filter(t=>t.status==='skipped').length} skipped cases. Proposed selection: ${proposed.size}/${selection.total ?? '?'} files. Actually omitted: ${omitted.length}.`, '',
  'Observed passing cases and dependency traces do not establish all possible behavior.'];
 if(report.error)text.push('', `Execution issue: ${escape(report.error)}`);
 if(report.timings)text.push('', `Measured work ${report.timings.totalMs} ms; planning (including discovery) ${report.timings.planningMs} ms; execution ${report.timings.executionMs} ms; other checks and history retention ${report.timings.otherMs} ms. Final report sealing is excluded here; pilot total spans include it.`);
 if(report.comparison)text.push('',`Shadow evidence: ${report.comparison.complete ? report.comparison.omittedFailures.length+' observed omitted failing cases' : 'incomplete; no certification'}. This compares file membership in one full run; independent subset runs can reveal order effects.`);
 if(decisions.length){text.push('', '| Test file | Executed | Proposed | Why |', '| --- | --- | --- | --- |');for(const d of decisions.slice(0,200))text.push(`| ${escape(d.test)} | ${ran.has(d.test)?'yes':'no'} | ${proposed.has(d.test)?'run':'omit'} | ${escape((d.reasons||[]).join('; ') || 'no changed dependency found')} |`);if(decisions.length>200)text.push('',`Showing 200/${decisions.length} decisions; full paths are in the JSON receipt.`);}
 text.push('', 'Uncertainty:');
 if(!warnings.length)text.push('', '- No unresolved analyzer warnings were reported for this scope. Undeclared runtime inputs and unexercised browser paths remain limitations.');
 else for(const w of warnings.slice(0,100))text.push(`- ${escape(typeof w==='string'?w:[w.file,w.reason,w.scope].filter(Boolean).join(': '))}`);
 if(warnings.length>100)text.push('- Remaining warnings are retained in the JSON receipt.');
 return text.join('\n')+'\n';
}
