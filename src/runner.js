import fs from 'node:fs';
import path from 'node:path';
import { plan, planWithinStartupPhase } from './selector.js';
import { readConfig, safePath } from './files.js';
import { execute, adapterFor } from './execution.js';
import { rememberServices, serviceInputs } from './inputs.js';
import { runnerIdentity, snapshot, freshness, digest } from './provenance.js';
import { renderRunReport } from './run-report.js';
import { openNativeSession, unifiedNativeEligibility } from './native-session.js';
import { externalRun } from './integrations.js';

export function compareShadow(selection, execution) {
  const proposed = new Set(selection.selected);
  const failures = execution.tests.filter(t => t.status === 'failed');
  const omittedFailures = failures.filter(t => !proposed.has(t.file));
  const complete = execution.complete && !selection.warnings?.some(w => /discovery/.test(typeof w === 'string' ? w : w.reason || ''));
  return { complete, certified: complete, proposedFiles: [...proposed],
    failures: failures.map(t => t.id), omittedFailures,
    decisionRecall: complete && failures.length ? (failures.length - omittedFailures.length) / failures.length : null,
    noObservedMisses: complete ? omittedFailures.length === 0 : null,
    limitation: 'Full-suite case outcomes are compared against proposed file membership; separate subset runs can expose order-dependent failures.' };
}

/** Independently executed subsets must preserve every case/status in their file scope. */
export function compareSubsetCases(full, subset, files) {
 const scope=new Set(files),expected=(full.tests||[]).filter(test=>scope.has(test.file)),observed=subset.tests||[];
 const ids=new Map(observed.map(test=>[test.id,test]));
 const missing=expected.filter(test=>!ids.has(test.id)).map(test=>test.id);
 const changed=expected.filter(test=>ids.has(test.id)&&ids.get(test.id).status!==test.status).map(test=>test.id);
 const expectedIds=new Set(expected.map(test=>test.id)),extra=observed.filter(test=>!expectedIds.has(test.id)).map(test=>test.id);
 return {complete:full.complete===true&&subset.complete===true&&!missing.length&&!changed.length&&!extra.length,missing,changed,extra};
}

export function run(root,options={}) {
 const prepared=prepareRun(root,options);
 if(prepared.terminal)return prepared.terminal;
 return finishRun(prepared,execute(root,prepared.executedTests,prepared.config,prepared.options));
}

/** Opt-in single fresh context; unsupported preflight retains the synchronous path. */
export async function runUnifiedNative(root,options={}) {
 root=path.resolve(root);const started=performance.now(),config=readConfig(root);
 if(options.changed)throw new Error('--changed is diagnostic only. Unified execution requires Git change discovery.');
 if(options.shadow&&options.selective)throw new Error('Choose shadow or selective execution');
 if(options.signal?.aborted)return {exitCode:2,executed:false,complete:false,error:'Unified execution cancelled'};
 const unsupported=unifiedNativeEligibility(root,config);
 if(unsupported){const result=run(root,options);return {...result,unifiedNative:{prototype:true,used:false,fallbackReason:unsupported}};}
 const initial=snapshot(root,config);let session,prepared,executionAttempted=false;
 try {
  session=await openNativeSession(root,config,options,{root,configurationDigest:digest(config),files:Object.keys(initial.files)});
  if(session.unsupported)throw new Error('Native command eligibility changed before startup; rerun after inputs stabilize');
  const startupCurrent=snapshot(root,config);
  const startupCheck=freshness(initial,startupCurrent);
  if(!startupCheck.fresh)throw new Error('Inputs changed during native context startup: '+startupCheck.reasons.join(', '));
  prepared=prepareRun(root,options,session.token,started,{root,configurationDigest:digest(config),provenance:startupCurrent});
  if(prepared.terminal)return {...prepared.terminal,unifiedNative:{prototype:true,used:true,contexts:1}};
  executionAttempted=true;
  const execution=await session.execute(prepared.executedTests);
  if(!options.capture){if(execution.stdout)process.stdout.write(execution.stdout);if(execution.stderr)process.stderr.write(execution.stderr);}
  return finishRun(prepared,execution);
 } catch(error) {
  if(prepared&&executionAttempted)return finishRun(prepared,{adapter:'vitest',exitCode:2,complete:false,tests:[],collectionFiles:[],requestedFiles:prepared.executedTests,executedFiles:prepared.executedTests,actualExecutedFilesUnverified:true,durationMs:Math.round(performance.now()-started-prepared.planningMs),...session?.failureEvidence?.(),error:error.message,unifiedNative:{prototype:true,used:true,contexts:1,partial:true}});
  return {exitCode:2,executed:executionAttempted,complete:false,tests:[],requestedFiles:prepared?.executedTests||[],...(prepared?{plan:prepared.selection}:{}),...session?.failureEvidence?.(),...error.nativeFailureEvidence,error:error.message,unifiedNative:{prototype:true,used:true,reason:'Unified context rejected; no automatic replan after configuration execution'}};
 } finally {await session?.close?.();}
}

function prepareRun(root, options = {}, nativeSession, started = performance.now(), startupPhase) {
  const config = readConfig(root);
  if(options.shadow && options.selective)throw new Error('Choose shadow or selective execution');
  options = {...options, shadow: Boolean(options.shadow || (config.executionMode === 'shadow' && !options.selective && !options.full))};
  if (config.integration) {
    if (options.changed) throw new Error('--changed is diagnostic only. run uses the native engine to discover changes.');
    return {terminal:externalRun(root, config, options)};
  }
  const planningStart=performance.now();
  const selection = startupPhase ? planWithinStartupPhase(root, options,nativeSession,startupPhase) : plan(root, options,nativeSession);
  const planningMs=Math.round(performance.now()-(nativeSession?started:planningStart));
  if (selection.discovery?.complete===false)return {terminal:{plan:selection,exitCode:2,error:'Native discovery is incomplete. Run the native full-suite command and repair discovery before selection.'}};
  const before=snapshot(root,config);
  const serviceBefore=serviceInputs(root,config);
  const decisionCheck=freshness(selection.provenance,before);
  const plannedServices=JSON.stringify(selection.serviceTokens||{});
  if(!decisionCheck.fresh || serviceBefore.warnings.length || plannedServices!==JSON.stringify(before.services||{}) || plannedServices!==JSON.stringify(serviceBefore.values))
    return {terminal:{plan:selection,exitCode:2,executed:false,complete:false,error:'Inputs changed during selection; rerun after source and service versions stabilize.',decisionDrift:[...decisionCheck.reasons,...(plannedServices!==JSON.stringify(before.services||{}) || plannedServices!==JSON.stringify(serviceBefore.values) ? ['planned-service-versions-changed'] : [])]}};
  if (!selection.total) return {terminal:{ plan: selection, exitCode: 2, error: 'No test files detected. Run generate or configure a supported project.' }};
  if (!selection.selected.length && !options.shadow) return {terminal:{ plan: selection, exitCode: 0, executed: false }};
  if (!config.runner && adapterFor(config)!=='playwright' && selection.selected.some(f => !/\.[cm]?js$/.test(f))) return {terminal:{ plan: selection, exitCode: 2, error: 'Configure a TypeScript/JSX-capable runner. See docs/configuration.md.' }};
  const executedTests = options.shadow ? selection.decisions.map(d => d.test) : selection.selected;
  return {root,options,config,selection,before,serviceBefore,executedTests,planningMs,started};
}
function finishRun({root,options,config,selection,before,serviceBefore,executedTests,planningMs,started},execution) {
  const actualFiles=[...new Set(execution.executedFiles||executedTests)];
  const sourceCheck=freshness(before,snapshot(root,config));
  const serviceAfter=serviceInputs(root,config);
  const servicesStable=!serviceBefore.warnings.length&&!serviceAfter.warnings.length&&JSON.stringify(serviceBefore.values)===JSON.stringify(serviceAfter.values);
  if(!servicesStable){execution.complete=false;execution.error='Service versions changed or became unavailable during execution';if(execution.exitCode===0)execution.exitCode=2;}
  if(!sourceCheck.fresh){execution.complete=false;execution.error='Source changed during execution: '+sourceCheck.reasons.join(', ');if(execution.exitCode===0)execution.exitCode=2;}
  if(execution.complete && execution.exitCode===0)rememberServices(root,config,actualFiles,serviceBefore.values);
  const directory = safePath(root, '.tddswarm');
  fs.mkdirSync(directory, { recursive: true });
  const runner = runnerIdentity(root, config);
  const historyFile = path.join(directory, `history-${runner}.json`);
  let history = { count: 0, failed: [], failedCases: [] };
  try { history = JSON.parse(fs.readFileSync(historyFile, 'utf8')); } catch {}
  if (!Number.isInteger(history.count) || history.count < 0) history.count = 0;
  if (!Array.isArray(history.failed)) history.failed = [];
  if (!Array.isArray(history.failedCases)) history.failedCases = [];
  const report = { ...execution, plan: selection, executed: true, shadow: Boolean(options.shadow), executedTests:actualFiles, runner,
    provenance: before };
  if (options.shadow) report.comparison = compareShadow(selection, execution);
  // Incomplete reporting retains every executed file. Passing a subset cannot erase
  // remembered failures from files that were not executed.
  const failed = execution.complete ? execution.tests.filter(t => t.status === 'failed').map(t => t.file) : execution.exitCode || !execution.complete ? actualFiles : [];
  const failedCases = execution.tests.filter(t => t.status === 'failed');
  const next = { schemaVersion: 1, runner, count: history.count + 1,
    failed: [...new Set([...history.failed.filter(f => !actualFiles.includes(f)), ...failed])].sort(),
    failedCases: [...history.failedCases.filter(t => !actualFiles.includes(t.file)), ...failedCases],
    complete: execution.complete, provenance: report.provenance };
  fs.writeFileSync(historyFile, JSON.stringify(next, null, 2));
  // Compatibility receipt only; selection treats namespaced history as authority.
  fs.writeFileSync(path.join(directory, 'history.json'), JSON.stringify(next, null, 2));
  // Timings cover completed selection/execution/provenance/history work. Final
  // report sealing cannot include its own write; pilots measure an outer span.
  report.timings={planningMs,executionMs:execution.durationMs||0,totalMs:Math.round(performance.now()-started),finalReportSealingExcluded:true};
  report.timings.otherMs=Math.max(0,report.timings.totalMs-planningMs-report.timings.executionMs);
  fs.writeFileSync(path.join(directory, 'last-run.md'), renderRunReport(report));
  fs.writeFileSync(path.join(directory, 'last-run.json'), JSON.stringify(report, null, 2));
  return report;
}
