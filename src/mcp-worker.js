import fs from 'node:fs';
import { plan } from './selector.js';
import { run } from './runner.js';

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

function summarizeRun(report, mode, receipts) {
  const tests = report.tests || [];
  const caseOutcomesAvailable = Array.isArray(report.tests);
  const observedScope = caseOutcomesAvailable ? tests.some(t => ['passed', 'failed'].includes(t.status))
    : Array.isArray(report.plan?.targets) && report.plan.targets.length > 0;
  return {
    kind: 'agent-verification-run', authority: 'observed-run', mode,
    executed: report.executed === true, complete: report.complete === true,
    verdict: report.complete !== true || report.executed !== true ? 'incomplete'
      : report.exitCode !== 0 ? 'failed' : observedScope ? 'passed-in-observed-scope' : 'incomplete',
    observedScopeEstablished: observedScope,
    exitCode: report.exitCode, error: report.error, executedFiles: report.executedTests || [],
    delegated: report.delegated === true, adapter: report.adapter, nativeTargets: report.plan?.targets ?? null,
    scopeLimitation: report.delegated ? 'Delegated native target execution; per-case identities and file membership are unavailable.' : 'Observed test-file scope only.',
    outcomes: { available: caseOutcomesAvailable, passed: caseOutcomesAvailable ? tests.filter(t => t.status === 'passed').length : null,
      failed: caseOutcomesAvailable ? tests.filter(t => t.status === 'failed').length : null,
      skipped: caseOutcomesAvailable ? tests.filter(t => t.status === 'skipped').length : null },
    failedCases: tests.filter(t => t.status === 'failed').map(t => ({ id: t.id, file: t.file })),
    timings: report.timings, plan: report.plan && summarizePlan(report.plan),
    comparison: report.comparison && { complete: report.comparison.complete,
      noObservedMisses: report.comparison.noObservedMisses,
      decisionRecall: report.comparison.decisionRecall, limitation: report.comparison.limitation },
    receipts,
    deploymentSafety: 'not-established', learningImprovement: 'not-established'
  };
}

export function boundedSummary(value, maxBytes = 65536) {
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
  return { kind: value.kind || 'agent-summary', authority: value.authority || 'advisory',
    complete: false, deploymentSafety: 'not-established',
    presentation: { truncated: true, maximumBytes: maxBytes, limitation: 'Summary exceeds output bound; inspect project receipts.' },
    receipts: value.receipts || null };
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
