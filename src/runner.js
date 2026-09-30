import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { plan } from './selector.js';
import { readConfig, safePath } from './files.js';

export function run(root, options = {}) {
  const config = readConfig(root);
  const selection = plan(root, options);
  if (!selection.total) return { plan: selection, exitCode: 2, error: 'No test files detected. Run generate or configure a supported project.' };
  if (!selection.selected.length) return { plan: selection, exitCode: 0, executed: false };
  const command = config.runner || ['node', '--test', '{files}'];
  if (!config.runner && selection.selected.some(f => !/\.[cm]?js$/.test(f))) return { plan: selection, exitCode: 2, error: 'Configure a TypeScript/JSX-capable runner. See docs/configuration.md.' };
  const args = command.flatMap(v => v === '{files}' ? selection.selected.map(f => './' + f) : [v]);
  const start = performance.now();
  // In shadow mode the full suite runs, while the proposed subset is retained.
  const actualArgs = options.shadow ? command.flatMap(v => v === '{files}' ? selection.decisions.map(d => './' + d.test) : [v]) : args;
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT; // A nested Node test runner must start independently.
  const result = spawnSync(actualArgs[0], actualArgs.slice(1), { cwd: root, stdio: options.capture ? 'pipe' : 'inherit', encoding: 'utf8', env, shell: false });
  const exitCode = result.status ?? 1;
  const directory = safePath(root, '.tddswarm');
  fs.mkdirSync(directory, { recursive: true });
  let count = 0;
  try { count = JSON.parse(fs.readFileSync(path.join(directory, 'history.json'), 'utf8')).count || 0;
    if (!Number.isInteger(count) || count < 0) count = 0; } catch {}
  const executedTests = options.shadow ? selection.decisions.map(d => d.test) : selection.selected;
  const report = { plan: selection, exitCode, executed: true, shadow: Boolean(options.shadow), executedTests, durationMs: Math.round(performance.now() - start), command: actualArgs, error: result.error?.message, signal: result.signal, stdout: result.stdout, stderr: result.stderr };
  // The runner protocol does not expose individual failures: retry all files from a failed run.
  fs.writeFileSync(path.join(directory, 'history.json'), JSON.stringify({ count: count + 1, failed: exitCode ? executedTests : [] }, null, 2));
  fs.writeFileSync(path.join(directory, 'last-run.json'), JSON.stringify(report, null, 2));
  return report;
}
