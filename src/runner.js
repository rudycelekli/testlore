import fs from 'node:fs';
import path from 'node:path';
import { plan } from './selector.js';
import { readConfig, safePath } from './files.js';
import { execute } from './execution.js';
import { runnerIdentity, snapshot } from './provenance.js';

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

export function run(root, options = {}) {
  const config = readConfig(root);
  const selection = plan(root, options);
  if (!selection.total) return { plan: selection, exitCode: 2, error: 'No test files detected. Run generate or configure a supported project.' };
  if (!selection.selected.length && !options.shadow) return { plan: selection, exitCode: 0, executed: false };
  if (!config.runner && selection.selected.some(f => !/\.[cm]?js$/.test(f))) return { plan: selection, exitCode: 2, error: 'Configure a TypeScript/JSX-capable runner. See docs/configuration.md.' };
  const executedTests = options.shadow ? selection.decisions.map(d => d.test) : selection.selected;
  const execution = execute(root, executedTests, config, options);
  const directory = safePath(root, '.tddswarm');
  fs.mkdirSync(directory, { recursive: true });
  const runner = runnerIdentity(root, config);
  const historyFile = path.join(directory, `history-${runner}.json`);
  let history = { count: 0, failed: [], failedCases: [] };
  try { history = JSON.parse(fs.readFileSync(historyFile, 'utf8')); } catch {}
  if (!Number.isInteger(history.count) || history.count < 0) history.count = 0;
  if (!Array.isArray(history.failed)) history.failed = [];
  if (!Array.isArray(history.failedCases)) history.failedCases = [];
  const report = { ...execution, plan: selection, executed: true, shadow: Boolean(options.shadow), executedTests, runner,
    provenance: snapshot(root, config) };
  if (options.shadow) report.comparison = compareShadow(selection, execution);
  // Incomplete reporting retains every executed file. Passing a subset cannot erase
  // remembered failures from files that were not executed.
  const failed = execution.complete ? execution.tests.filter(t => t.status === 'failed').map(t => t.file) : execution.exitCode || !execution.complete ? executedTests : [];
  const failedCases = execution.tests.filter(t => t.status === 'failed');
  const next = { schemaVersion: 1, runner, count: history.count + 1,
    failed: [...new Set([...history.failed.filter(f => !executedTests.includes(f)), ...failed])].sort(),
    failedCases: [...history.failedCases.filter(t => !executedTests.includes(t.file)), ...failedCases],
    complete: execution.complete, provenance: report.provenance };
  fs.writeFileSync(historyFile, JSON.stringify(next, null, 2));
  // Compatibility receipt only; selection treats namespaced history as authority.
  fs.writeFileSync(path.join(directory, 'history.json'), JSON.stringify(next, null, 2));
  fs.writeFileSync(path.join(directory, 'last-run.json'), JSON.stringify(report, null, 2));
  return report;
}
