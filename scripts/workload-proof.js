#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { run } from '../src/runner.js';
import { execute } from '../src/execution.js';

const repository = fileURLToPath(new URL('../', import.meta.url));
const digest = value => createHash('sha256').update(value).digest('hex');
const median = values => { const sorted = [...values].sort((a, b) => a - b); const i = Math.floor(sorted.length / 2); return sorted.length % 2 ? sorted[i] : (sorted[i - 1] + sorted[i]) / 2; };
const failed = report => (report.tests || []).filter(test => test.status === 'failed').map(test => test.id);
const callbackFiles = report => [...new Set((report.tests || []).filter(test => ['passed', 'failed'].includes(test.status) && test.name !== '<file-load>').map(test => test.file))].sort();
function git(root, argv) {
  const result = spawnSync('git', argv, { cwd: root, encoding: 'utf8', shell: false });
  if (result.status !== 0) throw new Error(result.stderr || 'Git prerequisite failed');
  return result.stdout.trim();
}
function sanitize(value, root) {
  if (typeof value === 'string') return value.replaceAll(root, '<fixture>').replaceAll(process.execPath, '<node>').replaceAll(repository.replace(/\/$/, ''), '<testlore-source>').replaceAll(os.homedir(), '<user-home>');
  if (Array.isArray(value)) return value.map(item => sanitize(item, root));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, sanitize(item, root)]));
  return value;
}
function bounded(name, value, min, max) {
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${name} must be an integer from ${min} to ${max}`);
}
export function workloadFixture({ files = 64, workloadMs = 200, concurrency = 4 } = {}) {
  bounded('files', files, 2, 256); bounded('workload-ms', workloadMs, 0, 1000); bounded('concurrency', concurrency, 1, 32);
  if (concurrency > files) throw new Error('concurrency must not exceed files');
  const config = { adapter: 'node', discovery: 'native', fullRunEvery: 20, runner: [process.execPath, '--test', `--test-concurrency=${concurrency}`, '{files}'] };
  const contents = {
    'package.json': JSON.stringify({ name: 'testlore-constructed-callback-workload', private: true, type: 'module' }),
    '.gitignore': '.tddswarm/\n', 'tddswarm.config.json': JSON.stringify(config)
  };
  const tests = [];
  for (let index = 0; index < files; index++) {
    const slot = String(index).padStart(3, '0'); const file = `test/${slot}.test.js`; tests.push(file);
    contents[`src/feature${slot}.js`] = `export const value = () => ${index + 1};\n`;
    contents[file] = `import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { value } from '../src/feature${slot}.js';\ntest('independent callback ${slot}', async () => {\n  await new Promise(resolve => setTimeout(resolve, ${workloadMs}));\n  assert.equal(value(), ${index + 1});\n});\n`;
  }
  const changed = 'src/feature000.js';
  return { contents, config, tests, changed, mutation: { file: changed, before: 'export const value = () => 1;\n', after: 'export const value = () => 2;\n' } };
}
export function runWorkload({ output, files = 64, workloadMs = 200, concurrency = 4, repetitions = 3 } = {}) {
  if (!output) throw new Error('A new output directory is required');
  output = path.resolve(output);
  if (fs.existsSync(output)) throw new Error('Output already exists; use a new directory to preserve previous receipts');
  bounded('repetitions', repetitions, 1, 9);
  const fixture = workloadFixture({ files, workloadMs, concurrency });
  fs.mkdirSync(output, { recursive: true });
  const save = (name, value) => fs.writeFileSync(path.join(output, name), JSON.stringify(value, null, 2), { flag: 'wx' });
  const normalizedFixture = { ...fixture, config: { ...fixture.config, runner: fixture.config.runner.map(arg => arg.replaceAll(process.execPath, '<node>')) }, contents: Object.fromEntries(Object.entries(fixture.contents).map(([name, content]) => [name, content.replaceAll(process.execPath, '<node>')])) };
  save('fixture.json', normalizedFixture);
  const workspace = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'testlore-workload-')));
  const trials = []; const baselineReports = [];
  try {
    for (let repetition = 0; repetition < repetitions; repetition++) {
      const root = path.join(workspace, String(repetition)); fs.mkdirSync(root);
      for (const [name, content] of Object.entries(fixture.contents)) { const target = path.join(root, name); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, content); }
      git(root, ['init', '-q']); git(root, ['add', '.']); git(root, ['-c', 'user.name=TestLore Benchmark', '-c', 'user.email=benchmark@example.invalid', 'commit', '-qm', 'constructed baseline']);
      const baseline = execute(root, fixture.tests, fixture.config, { capture: true });
      const baselineName = `baseline-${repetition}.json`; save(baselineName, sanitize(baseline, root)); baselineReports.push(baselineName);
      if (!baseline.complete || baseline.exitCode !== 0 || baseline.tests.length !== files || callbackFiles(baseline).length !== files) throw new Error('Original full suite is not green and complete');
      const target = path.join(root, fixture.changed);
      if (fs.readFileSync(target, 'utf8') !== fixture.mutation.before) throw new Error('Mutation target changed unexpectedly');
      fs.writeFileSync(target, fixture.mutation.after);
      const order = repetition % 2 ? ['testlore', 'full-native'] : ['full-native', 'testlore']; const cohort = [];
      for (const method of order) {
        fs.rmSync(path.join(root, '.tddswarm'), { recursive: true, force: true });
        const started = performance.now();
        const result = method === 'testlore' ? run(root, { base: 'HEAD', capture: true }) : execute(root, fixture.tests, fixture.config, { capture: true });
        const trial = { method, repetition, order, endToEndMs: Math.round(performance.now() - started), executionMs: result.durationMs || 0, callbackFiles: callbackFiles(result), observedFailures: failed(result), observedFailedFiles: (result.tests || []).filter(test => test.status === 'failed').map(test => test.file), complete: result.complete === true, rawReport: `${repetition}-${method}.json` };
        save(trial.rawReport, { ...trial, result: sanitize(result, root) }); cohort.push(trial);
      }
      const groundTruth = cohort.find(trial => trial.method === 'full-native');
      if (!groundTruth.complete || groundTruth.observedFailures.length !== 1 || groundTruth.observedFailedFiles[0] !== 'test/000.test.js') throw new Error('Planted regression did not yield exactly its expected full-suite failure');
      for (const trial of cohort) {
        trial.groundTruthFailures = groundTruth.observedFailures;
        trial.detectedFailures = groundTruth.observedFailures.filter(id => trial.observedFailures.includes(id));
        trial.missedFailures = groundTruth.observedFailures.filter(id => !trial.observedFailures.includes(id));
        trials.push(trial);
      }
      fs.rmSync(root, { recursive: true, force: true });
    }
    const summary = ['full-native', 'testlore'].map(method => {
      const selected = trials.filter(trial => trial.method === method); const executed = selected.reduce((sum, trial) => sum + trial.callbackFiles.length, 0);
      return { method, complete: selected.every(trial => trial.complete), detectedFailureObservations: selected.reduce((sum, trial) => sum + trial.detectedFailures.length, 0), groundTruthFailureObservations: selected.reduce((sum, trial) => sum + trial.groundTruthFailures.length, 0), missedFailureObservations: selected.reduce((sum, trial) => sum + trial.missedFailures.length, 0), executedCallbackFiles: executed, availableFiles: files * repetitions, callbackFileFraction: executed / (files * repetitions), endToEndMedianMs: median(selected.map(trial => trial.endToEndMs)), executionMedianMs: median(selected.map(trial => trial.executionMs)), endToEndTotalMs: selected.reduce((sum, trial) => sum + trial.endToEndMs, 0) };
    });
    const report = { schemaVersion: 1, generatedAt: new Date().toISOString(), toolRevision: git(repository, ['rev-parse', 'HEAD']), harnessDigest: digest(fs.readFileSync(fileURLToPath(import.meta.url))), dataset: { name: 'testlore-constructed-callback-workload-v1', files, workloadMs, concurrency, repetitions, distinctPlantedRegressions: 1, digest: digest(JSON.stringify(normalizedFixture)), setup: 'Fresh authored independent Node modules, fixed async delay inside each test callback, cold history, native TestLore discovery; full native suite uses the exact authored file manifest.' }, environment: { node: process.version, platform: process.platform, architecture: process.arch, cpu: os.cpus()[0]?.model || null }, summary, trials, baselineReports, limitations: ['Constructed callback delays and concurrency determine this result; this is not a production corpus or independent leaderboard.', 'Full native timing includes its complete runtime suite with known authored scope; it does not require a redundant discovery pass.', 'TestLore timing includes native discovery, Git/static planning, selected execution, provenance and evidence retention.', 'Callback-file counts exclude native discovery probes, which still load every test module.', 'One distinct planted leaf regression is repeated; successful detection is not broad fault-recall evidence.', 'Installation and fixture setup costs are excluded for both methods. Local timings include machine noise.', 'Keep the separate tiny-suite comparison visible: it measured a routing slowdown. No universal speed or learning claim is supported.'] };
    save('workload.json', report); return report;
  } finally { fs.rmSync(workspace, { recursive: true, force: true }); }
}
if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) {
  try {
    const argv = process.argv.slice(2); const allowed = new Set(['--output', '--files', '--workload-ms', '--concurrency', '--repetitions']); const options = {};
    for (let index = 0; index < argv.length; index += 2) {
      if (!allowed.has(argv[index]) || argv[index + 1] === undefined) throw new Error('Use --output NEW_DIRECTORY [--files 64 --workload-ms 200 --concurrency 4 --repetitions 3]');
      const key = argv[index].slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase()); options[key] = key === 'output' ? argv[index + 1] : Number(argv[index + 1]);
    }
    const report = runWorkload(options); console.log(JSON.stringify({ dataset: report.dataset, summary: report.summary }, null, 2));
    if (report.summary.some(item => !item.complete || item.missedFailureObservations)) process.exitCode = 1;
  } catch (error) { console.error(error.message); process.exitCode = 2; }
}
