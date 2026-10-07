import fs from 'node:fs';
import { plan } from './selector.js';
import { run } from './runner.js';
import {nextVerificationAction,executionFileEvidence} from './run-report.js';

// This is an internal, fixed-argv worker. Project runner output never shares the
// MCP protocol stream; the parent supervises this process and its descendants.
export function summarizePlan(selection) {
  if (selection.adapter) return {
    adapter: selection.adapter, delegated: true, mode: selection.mode,
    complete: selection.complete === true, targets: selection.targets ?? null,
    exitCode: selection.exitCode, error: selection.error, reasons: selection.reasons,
    evidence: selection.evidence, unmapped: selection.unmapped,
    authority: 'routing-proposal', deploymentSafety: 'not-established',
    limitation: 'Native target evidence does not establish per-test-file or case identity.'
  };
  return {
    mode: selection.mode, totalFiles: selection.total, selectedFiles: selection.selected,
    omittedFiles: selection.omitted, changed: selection.changed, reasons: selection.reasons,
    warnings: selection.warnings, uncertainty: selection.uncertainty, discovery: selection.discovery,
    decisions: selection.decisions, fingerprint: selection.fingerprint,
    evidence: selection.evidence, limitations: selection.limitations,
    complete: selection.discovery?.complete === true,
    authority: 'routing-proposal', deploymentSafety: 'not-established'
  };
}

export function summarizeRun(report, mode, receipts) {
  const tests = report.tests || [];
  const fileEvidence=executionFileEvidence(report),unverified=fileEvidence.unverified;
  const caseOutcomesAvailable = Array.isArray(report.tests);
  const observedScope = unverified?fileEvidence.executedFiles.length>0:caseOutcomesAvailable ? tests.some(t => ['passed', 'failed'].includes(t.status))
    : Array.isArray(report.plan?.targets) && report.plan.targets.length > 0;
  return {
    kind: 'agent-verification-run', authority: 'observed-run', mode,
    executed: report.executed === true, complete: report.complete === true&&!unverified,
    verdict: report.complete !== true || report.executed !== true || unverified ? 'incomplete'
      : report.exitCode !== 0 ? 'failed' : observedScope ? 'passed-in-observed-scope' : 'incomplete',
    observedScopeEstablished: observedScope,
    exitCode: report.exitCode, error: report.error, executedFiles: fileEvidence.executedFiles,
    ...(unverified?{actualExecutedFilesUnverified:true,requestedFiles:fileEvidence.requestedFiles,requestedFileCount:fileEvidence.requestedFiles.length,executedFileCount:fileEvidence.executedFiles.length}:{}),
    delegated: report.delegated === true, adapter: report.adapter, nativeTargets: report.plan?.targets ?? null,
    scopeLimitation: unverified?'Requested file execution is unverified; only independently reported named case files are confirmed. File omissions and complete shadow preservation are not established.':report.delegated ? 'Delegated native target execution; per-case identities and file membership are unavailable.' : 'Observed test-file scope only.',
    outcomes: { available: caseOutcomesAvailable, passed: caseOutcomesAvailable ? tests.filter(t => t.status === 'passed').length : null,
      failed: caseOutcomesAvailable ? tests.filter(t => t.status === 'failed').length : null,
      skipped: caseOutcomesAvailable ? tests.filter(t => t.status === 'skipped').length : null },
    failedCases: tests.filter(t => t.status === 'failed').map(t => ({ id: t.id, file: t.file, name: t.name })),
    timings: report.timings, plan: report.plan && summarizePlan(report.plan),
    comparison: report.comparison && { complete: unverified?false:report.comparison.complete,
      noObservedMisses: unverified?null:report.comparison.noObservedMisses,
      decisionRecall: unverified?null:report.comparison.decisionRecall, limitation: unverified?'Requested execution is unverified; omitted-test preservation cannot be established.':report.comparison.limitation },
    receipts,
    nextAction: nextVerificationAction(report),
    deploymentSafety: 'not-established', learningImprovement: 'not-established'
  };
}

export function boundedSummary(value, maxBytes = 65536) {
  if (!Number.isInteger(maxBytes) || maxBytes < 4096 || maxBytes > 65536)
    throw new Error('Agent summary budget must be an integer from 4096 to 65536 bytes');
  let truncated = false;
  function bound(item, depth = 0) {
    if (typeof item === 'string') { if (item.length > 4000) truncated = true; return item.slice(0, 4000); }
    if (item === null || typeof item !== 'object') return item;
    if (depth >= 8) { truncated = true; return '[depth limit]'; }
    if (Array.isArray(item)) { if (item.length > 100) truncated = true; return item.slice(0, 100).map(v => bound(v, depth + 1)); }
    const entries = Object.entries(item);
    if (entries.length > 100) truncated = true;
    return Object.fromEntries(entries.slice(0, 100).map(([k, v]) => [k.slice(0, 200), bound(v, depth + 1)]));
  }
  const result = { ...bound(value), presentation: { truncated, maximumBytes: maxBytes,
    limitation: 'Bounded agent summary; inspect durable receipts for complete run evidence.' } };
  if (Buffer.byteLength(JSON.stringify(result)) <= maxBytes) return result;
  const short = item => typeof item === 'string' ? item.slice(0, 500) : undefined;
  const count = item => Number.isInteger(item) ? item : null;
  let compact = { kind: short(value.kind) || 'agent-summary', authority: short(value.authority) || 'advisory',
    complete: false, observedComplete: value.complete === true, executed: value.executed === true,
    verdict: short(value.verdict), exitCode: count(value.exitCode),
    outcomes: value.outcomes && {available: value.outcomes.available === true,
      passed: count(value.outcomes.passed), failed: count(value.outcomes.failed), skipped: count(value.outcomes.skipped)},
    failedCases: Array.isArray(value.failedCases) ? value.failedCases.slice(0, 10).map(row => ({id: short(row?.id), file: short(row?.file), name: short(row?.name)})) : [],
    failedCaseCount: Array.isArray(value.failedCases) ? value.failedCases.length : null,
    scopeLimitation: short(value.scopeLimitation), executedFileCount: value.actualExecutedFilesUnverified===true&&Number.isInteger(value.executedFileCount)?value.executedFileCount:Array.isArray(value.executedFiles) ? value.executedFiles.length : null,
    ...(value.actualExecutedFilesUnverified===true?{actualExecutedFilesUnverified:true,
      requestedFiles:Array.isArray(value.requestedFiles)?value.requestedFiles.slice(0,10).map(short):[],
      requestedFileCount:Number.isInteger(value.requestedFileCount)?value.requestedFileCount:Array.isArray(value.requestedFiles)?value.requestedFiles.length:null,
      executedFiles:Array.isArray(value.executedFiles)?value.executedFiles.slice(0,10).map(short):[]}:{}),
    error: typeof value.error === 'string' ? value.error.slice(0, 1000) : undefined,
    nextAction: short(value.nextAction), deploymentSafety: 'not-established',
    presentation: { truncated: true, maximumBytes: maxBytes, limitation: 'Summary exceeds output bound; inspect project receipts.' },
    receipts: value.receipts ? {json: short(value.receipts.json), markdown: short(value.receipts.markdown)} : null };
  const fits = () => Buffer.byteLength(JSON.stringify(compact)) <= maxBytes;
  // Reduce extra failures first, preserving the first identity and durable paths
  // ahead of optional prose. UTF-8 and JSON escaping both count toward the bound.
  while (!fits() && compact.failedCases.length > 1) compact.failedCases.pop();
  if (fits()) return compact;
  const clip = (item, limit, preservePaths, key = '') => {
    if (typeof item === 'string') return preservePaths && ['id', 'file', 'json', 'markdown', 'nextAction'].includes(key) ? item : item.slice(0, limit);
    if (Array.isArray(item)) return item.map(row => clip(row, limit, preservePaths));
    if (item && typeof item === 'object') return Object.fromEntries(Object.entries(item).map(([name, child]) => [name, clip(child, limit, preservePaths, name)]));
    return item;
  };
  for (const preservePaths of [true, false]) for (const limit of [256, 128, 64, 32]) {
    compact = clip(compact, limit, preservePaths);
    if (fits()) return compact;
  }
  throw new Error('Agent summary could not fit its validated byte budget');
}

if (process.send && process.argv[2] === '--internal-mcp-worker') {
  try {
    const request = JSON.parse(process.argv[3]);
    if (!['plan', 'verify'].includes(request.operation) || fs.realpathSync(request.root) !== request.root)
      throw new Error('Invalid internal MCP worker request');
    const identity = fs.statSync(request.root);
    if (identity.dev !== request.rootIdentity?.dev || identity.ino !== request.rootIdentity?.ino)
      throw new Error('The fixed project root changed before execution');
    const options = request.base ? { base: request.base } : {};
    let result;
    if (request.operation === 'plan') result = { kind: 'agent-verification-plan', ...summarizePlan(plan(request.root, options)) };
    else {
      const report = run(request.root, { ...options, capture: true, ...(request.mode === 'full' ? { full: true } : { shadow: true }) });
      const receipts = report.executed && !report.delegated ? { json: '.tddswarm/last-run.json', markdown: '.tddswarm/last-run.md' } : null;
      result = summarizeRun(report, request.mode, receipts);
    }
    process.send({ result: boundedSummary(result) }, () => process.exit(0));
  } catch (error) {
    process.send({ error: String(error.message || error).slice(0, 2000) }, () => process.exit(1));
  }
}
