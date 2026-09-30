#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { run } from '../src/runner.js';
import { execute } from '../src/execution.js';
import { analyze } from '../src/graph.js';

const repository = fileURLToPath(new URL('../', import.meta.url));
const hash = text => createHash('sha256').update(text).digest('hex');
const median = numbers => { const a = [...numbers].sort((x, y) => x - y); return a.length % 2 ? a[(a.length - 1) / 2] : (a[a.length / 2 - 1] + a[a.length / 2]) / 2; };
const xml = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const methods = [
  { id: 'full-native', name: 'Full native Node suite', kind: 'actual-native-runner' },
  { id: 'testlore', name: 'TestLore routing', kind: 'actual-tool-native-discovery' },
  { id: 'imports-only', name: 'JS imports only (diagnostic)', kind: 'diagnostic-heuristic-not-a-competitor' }
];
function testFile(index, imports, expression, expected) {
  return `import test from 'node:test';\nimport assert from 'node:assert/strict';\n${imports}\ntest('contract ${index}', () => assert.equal(${expression}, ${JSON.stringify(expected)}));\n`;
}
function project(kind) {
  const files = {
    'package.json': JSON.stringify({ name: `testlore-${kind}-fixture`, private: true, type: 'module' }),
    '.gitignore': '.tddswarm/\n',
    'tddswarm.config.json': JSON.stringify({ adapter: 'node', discovery: 'native', runner: [process.execPath, '--test', ...(kind === 'preload' ? ['--import', './setup.js'] : []), '{files}'], ...(kind === 'uncertainty' ? { env: { TESTLORE_SLOT: '0' } } : {}), ...(kind === 'assets' ? { browser: { routes: { '/landing': { tests: ['test/0.test.js'], inputs: ['public/copy.json', 'public/template.json'] } } } } : {}), fullRunEvery: 20 })
  };
  if (kind === 'assets') {
    const names = ['copy', 'locale', 'template', 'theme', 'footer', 'help', 'checkout', 'account'];
    for (let i = 0; i < 8; i++) {
      files[`public/${names[i]}.json`] = JSON.stringify({ value: i + 1, paragraph: 'Welcome' });
      files[`test/${i}.test.js`] = testFile(i, `import input from '../public/${names[i]}.json' with { type: 'json' };`, 'input.value', i + 1);
    }
    return files;
  }
  if (kind === 'modular') files['src/shared.js'] = 'export const normalize = n => n + 1;\n';
  if (kind === 'preload') files['setup.js'] = 'process.env.TESTLORE_TAG = "healthy";\n';
  for (let i = 0; i < 8; i++) {
    files[`src/feature${i}.js`] = kind === 'modular' ? `import { normalize } from './shared.js';\nexport const value = () => normalize(${i});\n` : `export const value = () => ${i + 1};\n`;
    files[`test/${i}.test.js`] = testFile(i, `import { value } from '../src/feature${i}.js';`, kind === 'preload' ? `(assert.equal(process.env.TESTLORE_TAG, 'healthy'), value())` : 'value()', i + 1);
  }
  if (kind === 'uncertainty') {
    files['test/0.test.js'] = testFile(0, `const { value } = await import('../src/feature' + process.env.TESTLORE_SLOT + '.js');`, 'value()', 1);
    files['data/leaf.json'] = '{"value":7}\n';
    files['src/feature6.js'] = `import fs from 'node:fs';\nexport const value = () => JSON.parse(fs.readFileSync(new URL('../data/leaf.json', import.meta.url), 'utf8')).value;\n`;
  }
  return files;
}
/** Exact deterministic fixtures; no benchmark delay, training or model-generated scores. */
export function comparisonDataset() {
  return [
    { id: 'leaf-comment', project: 'modular', change: { file: 'src/feature0.js', append: '// Copy-independent source comment.\n' }, regression: false },
    { id: 'leaf-defect', project: 'modular', change: { file: 'src/feature3.js', replace: ['normalize(3)', 'normalize(3) + 1'] }, regression: true },
    { id: 'shared-defect', project: 'modular', change: { file: 'src/shared.js', replace: ['n + 1', 'n + 2'] }, regression: true },
    { id: 'removed-import', project: 'modular', change: { file: 'src/feature4.js', content: 'export const value = () => 5;\n' }, regression: false },
    { id: 'paragraph-metadata', project: 'assets', change: { file: 'public/copy.json', replace: ['Welcome', 'Welcome to TestLore'] }, regression: false },
    { id: 'locale-defect', project: 'assets', change: { file: 'public/locale.json', replace: ['"value":2', '"value":99'] }, regression: true },
    { id: 'template-defect', project: 'assets', change: { file: 'public/template.json', replace: ['"value":3', '"value":99'] }, regression: true },
    { id: 'unknown-input', project: 'modular', change: { file: 'public/unknown.css', content: 'body { color: blue; }\n' }, regression: false },
    { id: 'dynamic-import-defect', project: 'uncertainty', change: { file: 'src/feature0.js', replace: ['() => 1', '() => 99'] }, regression: true },
    { id: 'deleted-runtime-input', project: 'uncertainty', change: { file: 'data/leaf.json', delete: true }, regression: true },
    { id: 'preload-defect', project: 'preload', change: { file: 'setup.js', replace: ['healthy', 'broken'] }, regression: true },
    { id: 'global-config-control', project: 'modular', change: { file: 'tddswarm.config.json', replace: ['"fullRunEvery":20', '"fullRunEvery":21'] }, regression: false }
  ].map(scenario => ({ ...scenario, files: project(scenario.project), tests: Array.from({ length: 8 }, (_, i) => `test/${i}.test.js`) }));
}
function git(root, args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', shell: false });
  if (result.status !== 0) throw new Error(result.stderr || 'Git prerequisite failed');
  return result.stdout.trim();
}
function write(root, file, content) { const target = path.join(root, file); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, content); }
function mutate(root, change) {
  const target = path.join(root, change.file);
  if (change.delete) { fs.unlinkSync(target); return; }
  if (change.content !== undefined) { write(root, change.file, change.content); return; }
  const original = fs.readFileSync(target, 'utf8');
  if (change.append) { fs.writeFileSync(target, original + change.append); return; }
  const [before, after] = change.replace;
  if (original.split(before).length !== 2) throw new Error(`Patch must match exactly once: ${change.file}`);
  fs.writeFileSync(target, original.replace(before, after));
}
/** Diagnostic only: literal relative JS imports; no asset/runtime/config/fallback policy. */
function importsOnly(root, tests, changed) {
  const edges = new Map();
  function visit(dir) {
    for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
      if (item.name.startsWith('.') || item.name === 'node_modules') continue;
      const full = path.join(dir, item.name);
      if (item.isDirectory()) visit(full);
      else if (item.name.endsWith('.js')) {
        const file = path.relative(root, full).split(path.sep).join('/');
        const imports = analyze(file, fs.readFileSync(full, 'utf8')).imports;
        edges.set(file, imports.filter(spec => spec.startsWith('.') && spec.endsWith('.js')).map(spec => path.posix.normalize(path.posix.join(path.posix.dirname(file), spec))));
      }
    }
  }
  visit(root);
  function affected(file, visited = new Set()) {
    if (file === changed) return true;
    if (visited.has(file)) return false;
    visited.add(file); return (edges.get(file) || []).some(dependency => affected(dependency, visited));
  }
  return tests.filter(test => affected(test));
}
function sanitize(value, root) {
  if (typeof value === 'string') return value.replaceAll(root, '<fixture>').replaceAll(process.execPath, '<node>').replaceAll(repository.replace(/\/$/, ''), '<testlore-source>').replaceAll(os.homedir(), '<user-home>');
  if (Array.isArray(value)) return value.map(item => sanitize(item, root));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, sanitize(item, root)]));
  return value;
}
function faults(report) { return (report.tests || []).filter(test => test.status === 'failed').map(test => test.id); }
export function summarizeComparison(trials) {
  return methods.map(method => {
    const selected = trials.filter(trial => trial.method === method.id);
    const faultTrials = selected.filter(trial => trial.groundTruthFailures.length > 0);
    const totalFaults = faultTrials.reduce((sum, trial) => sum + trial.groundTruthFailures.length, 0);
    const detectedFaults = faultTrials.reduce((sum, trial) => sum + trial.detectedFailures.length, 0);
    const executed = selected.reduce((sum, trial) => sum + trial.executedFiles.length, 0);
    const available = selected.reduce((sum, trial) => sum + trial.totalFiles, 0);
    return { ...method, valid: selected.length > 0 && selected.every(trial => trial.valid), trials: selected.length, totalFaults, detectedFaults, faultRecall: totalFaults ? detectedFaults / totalFaults : null, faultyScenarioTrials: faultTrials.length, detectedScenarioTrials: faultTrials.filter(trial => trial.detectedFailures.length > 0).length, faultScenarioRecall: faultTrials.length ? faultTrials.filter(trial => trial.detectedFailures.length > 0).length / faultTrials.length : null, missedFailures: faultTrials.reduce((sum, trial) => sum + trial.missedFailures.length, 0), executedFiles: executed, availableFiles: available, executedFileFraction: available ? executed / available : null, endToEndMedianMs: selected.length ? median(selected.map(trial => trial.endToEndMs)) : null, endToEndTotalMs: selected.reduce((sum, trial) => sum + trial.endToEndMs, 0), limitations: method.id === 'imports-only' ? ['Deliberately limited diagnostic baseline, not an existing competing product.'] : [] };
  });
}
export function comparisonSvg(report) {
  const summary = report.summary; const maxTime = Math.max(...summary.map(item => item.endToEndMedianMs), 1);
  const colors = { 'full-native': '#8492a6', testlore: '#2468cf', 'imports-only': '#c4842a' };
  const row = summary.map((item, index) => {
    const y = 177 + index * 92; const recall = item.faultRecall === null ? 'N/A' : `${(100 * item.faultRecall).toFixed(1)}%`;
    return `<text x="36" y="${y + 18}" class="label">${xml(item.name)}</text><text x="36" y="${y + 39}" class="note">${item.missedFailures} missed observed failures</text><rect x="322" y="${y}" width="${230 * (item.faultRecall || 0)}" height="14" rx="3" fill="${colors[item.id]}"/><text x="322" y="${y + 39}" class="value">${recall}</text><rect x="590" y="${y}" width="${210 * item.executedFileFraction}" height="14" rx="3" fill="${colors[item.id]}"/><text x="590" y="${y + 39}" class="value">${(100 * item.executedFileFraction).toFixed(1)}%</text><rect x="845" y="${y}" width="${200 * item.endToEndMedianMs / maxTime}" height="14" rx="3" fill="${colors[item.id]}"/><text x="845" y="${y + 39}" class="value">${Math.round(item.endToEndMedianMs)} ms</text>`;
  }).join('\n');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1100" height="570" viewBox="0 0 1100 570" role="img" aria-labelledby="title description"><title id="title">TestLore controlled routing comparison</title><desc id="description">${xml(summary.map(item => `${item.name}: failing-case recall ${item.faultRecall}, executed-file fraction ${item.executedFileFraction}, median end-to-end ${item.endToEndMedianMs} milliseconds`).join('; '))}</desc><style>text{font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;fill:#142238}.label{font-size:17px;font-weight:600}.note{font-size:12px;fill:#5c6c80}.value{font-size:21px;font-weight:600}.heading{font-size:15px;font-weight:600}</style><rect width="1100" height="570" fill="#f8fafc"/><text x="36" y="46" font-size="29" font-weight="700">TestLore: correctness and routing cost</text><text x="36" y="75" font-size="14">${xml(report.dataset.scenarios + ' deterministic changes · ' + report.dataset.projects + ' modular Node fixtures · ' + report.repetitions + ' repetitions · ' + report.environment.node + ' / ' + report.environment.platform + ' ' + report.environment.architecture)}</text><text x="36" y="100" class="note">Controlled synthetic dataset, not a leaderboard or proof of universal superiority.</text><text x="322" y="141" class="heading">Observed fault recall ↑</text><text x="590" y="141" class="heading">Case execution file % ↓</text><text x="845" y="141" class="heading">Median end-to-end time ↓</text><path d="M36 153H1064" stroke="#d8e0eb"/>${row}<path d="M36 449H1064" stroke="#d8e0eb"/><text x="36" y="477" font-size="13">Time includes TestLore discovery, planning, execution and evidence retention; no speedup is assumed.</text><text x="36" y="501" font-size="13">Node has no native dependency selection: its full runtime suite is the native baseline.</text><text x="36" y="525" class="note">File % counts case execution. Discovery still loads all test modules; JSON contracts are not browser tests.</text><text x="36" y="549" class="note">${xml('Tool revision ' + (report.toolRevision || 'unavailable').slice(0, 12) + ' · dataset SHA-256 ' + report.dataset.digest.slice(0, 16) + ' · raw outcomes and limitations accompany this chart.')}</text></svg>\n`;
}
export function runComparison({ output, repetitions = 3 } = {}) {
  if (!output) throw new Error('A new output directory is required');
  output = path.resolve(output);
  if (fs.existsSync(output)) throw new Error('Output already exists; use a new directory to preserve previous receipts');
  if (!Number.isInteger(repetitions) || repetitions < 1 || repetitions > 9) throw new Error('repetitions must be an integer from 1 to 9');
  fs.mkdirSync(output, { recursive: true });
  const dataset = comparisonDataset(); const trials = []; const baselines = [];
  const workspace = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'testlore-comparison-')));
  try {
    for (const [scenarioIndex, scenario] of dataset.entries()) {
      for (let repetition = 0; repetition < repetitions; repetition++) {
        const root = path.join(workspace, `${scenario.id}-${repetition}`); fs.mkdirSync(root);
        for (const [file, content] of Object.entries(scenario.files)) write(root, file, content);
        git(root, ['init', '-q']); git(root, ['add', '.']); git(root, ['-c', 'user.name=TestLore Benchmark', '-c', 'user.email=benchmark@example.invalid', 'commit', '-qm', 'deterministic baseline']);
        const config = JSON.parse(scenario.files['tddswarm.config.json']);
        const baseline = execute(root, scenario.tests, config, { capture: true });
        baselines.push({ scenario: scenario.id, repetition, rawReport: `baseline-${scenario.id}-${repetition}.json` });
        fs.writeFileSync(path.join(output, `baseline-${scenario.id}-${repetition}.json`), JSON.stringify({ scenario: scenario.id, repetition, baseline: sanitize(baseline, root) }, null, 2));
        if (!baseline.complete || baseline.exitCode !== 0 || baseline.tests.length !== 8) throw new Error(`Baseline is not green and complete: ${scenario.id}`);
        mutate(root, scenario.change);
        const order = methods.map((_, i) => methods[(i + scenarioIndex + repetition) % methods.length]);
        const cohort = [];
        for (const method of order) {
          fs.rmSync(path.join(root, '.tddswarm'), { recursive: true, force: true });
          const started = performance.now(); let result; let planned;
          if (method.id === 'testlore') { result = run(root, { base: 'HEAD', capture: true }); planned = result.plan?.selected || []; }
          else { planned = method.id === 'full-native' ? scenario.tests : importsOnly(root, scenario.tests, scenario.change.file); result = execute(root, planned, config, { capture: true }); }
          const endToEndMs = Math.round(performance.now() - started);
          const trial = { scenario: scenario.id, project: scenario.project, regression: scenario.regression, repetition, order: order.map(item => item.id), method: method.id, totalFiles: scenario.tests.length, plannedFiles: planned, executedFiles: result.executedTests || result.executedFiles || [], endToEndMs, executionMs: result.durationMs || 0, result: sanitize(result, root), observedFailures: faults(result) };
          fs.writeFileSync(path.join(output, `${scenario.id}-${repetition}-${method.id}.json`), JSON.stringify(trial, null, 2)); cohort.push(trial);
        }
        const full = cohort.find(trial => trial.method === 'full-native');
        const groundTruthFailures = full.observedFailures;
        if (!full.result.complete || (scenario.regression ? !groundTruthFailures.length || full.result.exitCode === 0 : groundTruthFailures.length || full.result.exitCode !== 0)) throw new Error(`Ground truth does not match planted scenario: ${scenario.id}`);
        for (const trial of cohort) {
          trial.groundTruthFailures = groundTruthFailures;
          trial.detectedFailures = groundTruthFailures.filter(id => trial.observedFailures.includes(id));
          trial.missedFailures = groundTruthFailures.filter(id => !trial.observedFailures.includes(id));
          trial.valid = trial.result.complete === true && !trial.result.error;
          trials.push(trial);
        }
        fs.rmSync(root, { recursive: true, force: true });
      }
    }
    let toolRevision = null; try { toolRevision = git(repository, ['rev-parse', 'HEAD']); } catch {}
    const datasetArtifact = dataset.map(scenario => ({ ...scenario, files: Object.fromEntries(Object.entries(scenario.files).map(([file, content]) => [file, content.replaceAll(process.execPath, '<node>')])) }));
    const manifest = { name: 'testlore-routing-controlled-v1', scope: '12 deterministic changes in four controlled 8-test Node projects; JSON asset contracts, no real browser or external services', scenarios: dataset.length, projects: new Set(dataset.map(item => item.project)).size, plantedRegressions: dataset.filter(item => item.regression).length, digest: hash(JSON.stringify(datasetArtifact)), setup: 'Native discovery; declared browser-route inputs; cold run history before every measured method; baseline setup outside timing.' };
    const report = { schemaVersion: 1, generatedAt: new Date().toISOString(), toolRevision, harnessDigest: hash(fs.readFileSync(fileURLToPath(import.meta.url))), dataset: manifest, repetitions, environment: { node: process.version, platform: process.platform, architecture: process.arch, cpu: os.cpus()[0]?.model || null }, methods, summary: summarizeComparison(trials), trials: trials.map(({ result, ...trial }) => ({ ...trial, rawReport: `${trial.scenario}-${trial.repetition}-${trial.method}.json` })), limitations: ['Controlled synthetic fixtures are not a community leaderboard or independent evaluation.', 'No named competitors, agent memory, LongMemEval or learning results are measured.', 'Case-execution file counts exclude native discovery probes, which load every test module in these fixtures. JSON contracts are not browser rendering or visual regression tests.', 'Native discovery executes module loading; it is included in TestLore end-to-end cost.', 'Latency is local single-machine wall-clock, not production speed; balanced method order reduces but does not remove warm-up noise.', 'No installation cost is measured. Test files, not individual cases, are routing units.', 'JS imports-only is deliberately limited diagnostic code, not a competitor and not a production-safe selector.', 'Scores describe exactly the listed planted regressions; untested defects and external dependencies remain unknown.'] };
    fs.writeFileSync(path.join(output, 'dataset.json'), JSON.stringify(datasetArtifact, null, 2));
    fs.writeFileSync(path.join(output, 'baselines.json'), JSON.stringify(baselines, null, 2));
    fs.writeFileSync(path.join(output, 'comparison.json'), JSON.stringify(report, null, 2));
    fs.writeFileSync(path.join(output, 'comparison.svg'), comparisonSvg(report));
    return report;
  } finally { fs.rmSync(workspace, { recursive: true, force: true }); }
}
if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) {
  try {
    const argv = process.argv.slice(2); const outputIndex = argv.indexOf('--output'); const repeatIndex = argv.indexOf('--repetitions');
    const result = runComparison({ output: outputIndex >= 0 ? argv[outputIndex + 1] : undefined, repetitions: repeatIndex >= 0 ? Number(argv[repeatIndex + 1]) : 3 });
    console.log(JSON.stringify({ output: path.resolve(argv[outputIndex + 1]), dataset: result.dataset, summary: result.summary }, null, 2));
    if (result.summary.some(item => !item.valid) || result.summary.find(item => item.id === 'testlore').missedFailures) process.exitCode = 1;
  } catch (error) { console.error(error.message); process.exitCode = 2; }
}
