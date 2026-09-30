#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { plan } from '../src/selector.js';
import { TEST } from '../src/files.js';
const repository = fileURLToPath(new URL('../', import.meta.url));
const manifest = JSON.parse(fs.readFileSync(path.join(repository, 'benchmarks/public-projects.json')));
const args = process.argv.slice(2); const requested = args[args.indexOf('--project') + 1];
const outputArg = args.indexOf('--output'); const output = path.resolve(outputArg >= 0 ? args[outputArg + 1] : path.join(repository, 'benchmarks/results', new Date().toISOString().replace(/[:.]/g, '-')));
if (fs.existsSync(output)) throw new Error('Output already exists; preserve previous benchmark evidence');
fs.mkdirSync(output, { recursive: true });
const workspace = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'tddswarm-public-benchmark-')));
function invoke(cwd, command) {
  const start = performance.now(); const env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
  const result = spawnSync(command[0], command.slice(1), { cwd, encoding: 'utf8', env, shell: false, timeout: 180000, maxBuffer: 32 * 1024 * 1024 });
  return { command, exitCode: result.status ?? 2, durationMs: Math.round(performance.now() - start), stdout: result.stdout || '', stderr: result.stderr || '', error: result.error?.message };
}
function requireSuccess(cwd, command) { const result = invoke(cwd, command); if (result.exitCode) throw new Error(`${command[0]} failed: ${result.error || result.stderr}`); return result; }
function identities(root, result, framework, report) {
  if (framework === 'vitest') {
    if (!fs.existsSync(report)) return { complete: false, failures: [] };
    const json = JSON.parse(fs.readFileSync(report));
    return { complete: json.testResults.length > 0 || (json.success === true && result.exitCode === 0), failures: json.testResults.flatMap(file => file.assertionResults.filter(t => t.status === 'failed').map(t => `${path.relative(root, file.name)}:${t.fullName}`)) };
  }
  const events = result.stdout.split('\n').filter(Boolean).map(line => { try { return JSON.parse(line); } catch { return null; } }).filter(Boolean);
  return { complete: events.some(v => v.type === 'test:summary'), failures: events.filter(v => v.type === 'test:fail' && v.data.details?.type !== 'suite').map(v => `${path.relative(root, v.data.file)}:${v.data.name}:${v.data.line}`) };
}
const projects = []; const selectedProjects = manifest.projects.filter(p => !args.includes('--project') || p.name === requested);
if (!selectedProjects.length) throw new Error('Unknown benchmark project');
try {
  for (const project of selectedProjects) {
    const root = path.join(workspace, project.name); const logs = path.join(output, project.name); fs.mkdirSync(logs);
    const setup = [];
    setup.push(requireSuccess(workspace, ['git', 'clone', '--no-checkout', project.url, root]));
    setup.push(requireSuccess(root, ['git', 'checkout', '--detach', project.commit]));
    const tests = requireSuccess(root, ['git', 'ls-files']).stdout.split('\n').filter(v => TEST.test(v));
    let runner;
    if (project.framework === 'vitest') {
      const tools = path.join(workspace, 'tools-' + project.name); fs.mkdirSync(tools);
      setup.push(requireSuccess(workspace, ['npm', 'install', '--prefix', tools, '--ignore-scripts', '--save-exact', ...project.dependencies]));
      fs.symlinkSync(path.join(tools, 'node_modules'), path.join(root, 'node_modules'), 'dir');
      fs.copyFileSync(path.join(tools, 'package-lock.json'), path.join(logs, 'runner-package-lock.json'));
      runner = [process.execPath, path.join(tools, 'node_modules/vitest/vitest.mjs'), 'run'];
      fs.writeFileSync(path.join(root, 'tddswarm.config.json'), JSON.stringify({ runner: [...runner, '{files}'] }));
    } else runner = [process.execPath, '--test', `--test-reporter=${path.join(repository, 'benchmarks/node-reporter.js')}`];
    fs.writeFileSync(path.join(logs, 'setup.json'), JSON.stringify(setup, null, 2));
    const execute = (name, files, nativeChange) => {
      const report = path.join(logs, name + '.runner.json');
      let command = [...runner];
      if (project.framework === 'vitest') { command.push('--reporter=json', '--outputFile=' + report); if (nativeChange) { command[2] = 'related'; command.push(nativeChange, '--run', '--passWithNoTests'); } else command.push(...files); }
      else command.push(...files);
      if (!files.length && !nativeChange) { const skipped = { command, exitCode: 0, durationMs: 0, stdout: '', stderr: '', identities: { complete: true, failures: [] }, skipped: true }; fs.writeFileSync(path.join(logs, name + '.json'), JSON.stringify(skipped, null, 2)); return skipped; }
      const result = invoke(root, command); result.identities = identities(root, result, project.framework, report);
      fs.writeFileSync(path.join(logs, name + '.json'), JSON.stringify(result, null, 2)); return result;
    };
    const baseline = execute('baseline-full', tests);
    if (baseline.exitCode !== 0 || !baseline.identities.complete) throw new Error(`Upstream ${project.name} runtime baseline is not green with complete results; retained evidence in ${logs}`);
    const changes = [];
    for (const change of project.changes) {
      const file = path.join(root, change.file); const original = fs.readFileSync(file, 'utf8');
      if (change.before && (!original.includes(change.before) || original.split(change.before).length !== 2)) throw new Error('Patch precondition did not match exactly once');
      fs.writeFileSync(file, change.append ? original + change.append : original.replace(change.before, change.after));
      try {
        const start = performance.now(); const selection = plan(root, { changed: [change.file] }); const selectionMs = Math.round(performance.now() - start);
        fs.writeFileSync(path.join(logs, change.name + '.plan.json'), JSON.stringify(selection, null, 2));
        const full = execute(change.name + '-full', tests);
        const subset = execute(change.name + '-subset', selection.selected);
        const native = execute(change.name + '-native', tests, project.framework === 'vitest' ? change.file : undefined);
        const missed = full.identities.failures.filter(id => !subset.identities.failures.includes(id));
        const nativeMissed = full.identities.failures.filter(id => !native.identities.failures.includes(id));
        const valid = full.identities.complete && subset.identities.complete && native.identities.complete && (!change.regression || full.identities.failures.length > 0);
        changes.push({ change, valid, selectionMs, selected: selection.selected, totalFiles: tests.length, groundTruthFailures: full.identities.failures, missed, nativeMissed, decisionRecall: full.identities.failures.length ? (full.identities.failures.length - missed.length) / full.identities.failures.length : null, fullMs: full.durationMs, subsetMs: subset.durationMs, nativeMs: native.durationMs, netSavingMs: full.durationMs - subset.durationMs - selectionMs, nativeBaseline: project.framework === 'vitest' ? 'vitest related --run' : 'Node has no native dependency selection; full runtime suite', fullExitCode: full.exitCode, subsetExitCode: subset.exitCode, nativeExitCode: native.exitCode });
      } finally { fs.writeFileSync(file, original); }
    }
    projects.push({ project, baseline: { durationMs: baseline.durationMs, exitCode: baseline.exitCode }, changes });
  }
  const summary = { schemaVersion: 1, date: new Date().toISOString(), environment: { node: process.version, platform: process.platform, architecture: process.arch }, repetitions: 1, projects, limitations: ['Single runs; timing noise and stochastic upstream tests are not controlled.', 'Only listed deterministic patches and runtime test scope measured.', 'Selection is a diagnostic working-tree plan; generated config is excluded from changed inputs.', 'No release safety, whole-project quality, or general production speedup claim.'] };
  fs.writeFileSync(path.join(output, 'summary.json'), JSON.stringify(summary, null, 2)); console.log(JSON.stringify(summary, null, 2));
  if (projects.some(p => p.changes.some(c => !c.valid || c.missed.length))) process.exitCode = 1;
} finally { fs.rmSync(workspace, { recursive: true, force: true }); }
