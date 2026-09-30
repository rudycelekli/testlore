import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { git, safePath, validateConfig } from './files.js';

const worker = fileURLToPath(new URL('./pilot-worker.js', import.meta.url));
const frameworks = ['node', 'jest', 'vitest', 'playwright'];
export function validatePilotManifest(value) {
  if (value?.schemaVersion !== 1 || !Array.isArray(value.projects) || !value.projects.length || value.projects.length > 20) throw new Error('Pilot manifest needs schemaVersion:1 and 1–20 projects');
  const repetitions = value.repetitions ?? 3, timeoutMs = value.timeoutMs ?? 120000;
  if (!Number.isInteger(repetitions) || repetitions < 1 || repetitions > 5) throw new Error('Pilot repetitions must be 1–5');
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 300000) throw new Error('Pilot timeoutMs must be 1000–300000');
  const names = new Set();
  const projects = value.projects.map(project => {
    if (!/^[a-z][a-z0-9-]{0,47}$/.test(project.name) || names.has(project.name)) throw new Error('Pilot project names must be unique lowercase aliases');
    names.add(project.name);
    if (!path.isAbsolute(project.root || '') || !frameworks.includes(project.config?.adapter) || project.config.discovery !== 'native') throw new Error('Pilot requires an absolute local root and explicit native adapter');
    if (typeof project.scope !== 'string' || !project.scope.trim() || project.scope.length > 200) throw new Error('Describe the native test scope explicitly');
    if (project.config.integration || project.config.agent || project.config.plugins || project.config.env) throw new Error('Pilot config must use a core adapter without agents, plugins, or credential environment');
    const config = validateConfig(project.config);
    if (!Array.isArray(project.changes) || !project.changes.length || project.changes.length > 12) throw new Error('Each pilot needs 1–12 exact source changes');
    const changeNames = new Set();
    for (const change of project.changes) {
      if (!/^[a-z][a-z0-9-]{0,47}$/.test(change.name) || changeNames.has(change.name)) throw new Error('Change aliases must be unique');
      changeNames.add(change.name); safePath(project.root, change.file);
      if (!/\.(?:[cm]?[jt]sx?|html|css|json|md)$/.test(change.file) || /(?:^|\/)(?:package(?:-lock)?\.json|tddswarm\.config\.json)$/.test(change.file)) throw new Error('Pilot changes must target source, not dependencies or analysis configuration');
      if (typeof change.before !== 'string' || !change.before || typeof change.after !== 'string' || change.before === change.after || change.before.length + change.after.length > 65536 || typeof change.expectedFailure !== 'boolean') throw new Error('Each change needs bounded distinct before/after text and expectedFailure:boolean');
    }
    return { name: project.name, root: fs.realpathSync(project.root), scope: project.scope, config, changes: project.changes };
  });
  return { schemaVersion: 1, projects, repetitions, timeoutMs };
}

function inspect(project) {
  const revision = git(project.root, ['rev-parse', 'HEAD']).trim();
  const repository = fs.realpathSync(git(project.root, ['rev-parse', '--show-toplevel']).trim());
  if (repository !== project.root) throw new Error('Pilot root must be the repository root');
  if (git(project.root, ['status', '--porcelain']).trim()) throw new Error(`Pilot ${project.name} needs a clean source checkout; commit or choose another repository`);
  for (const change of project.changes) {
    const source = fs.readFileSync(safePath(project.root, change.file), 'utf8');
    if (source.split(change.before).length !== 2) throw new Error(`Patch precondition must match exactly once: ${project.name}/${change.name}`);
  }
  return { name: project.name, revision, framework: project.config.adapter, scope: project.scope, changes: project.changes.length, dependencyMode: fs.existsSync(path.join(project.root, 'node_modules')) ? 'shared-installed-local' : 'none' };
}
function environment() {
  const env = {};
  for (const key of ['PATH', 'HOME', 'TMPDIR', 'TEMP', 'TMP', 'SystemRoot', 'USERPROFILE', 'LANG', 'LC_ALL', 'PLAYWRIGHT_BROWSERS_PATH']) if (process.env[key]) env[key] = process.env[key];
  return { ...env, CI: '1', NODE_ENV: 'test' };
}

/** Local pilot execution is explicit. No downloads, provider calls, or remote publication. */
export function pilot(root, manifest, options = {}) {
  const validated = validatePilotManifest(manifest);
  const inspected = validated.projects.map(inspect);
  if (!options.execute) return { executed: false, projects: inspected, repetitions: validated.repetitions, next: 'Use pilot --manifest <file> --execute to run isolated local copies. Native discovery can execute top-level test code.' };
  const relative = options.output || `.tddswarm/pilots/${new Date().toISOString().replace(/[:.]/g, '-')}`;
  if (!relative.startsWith('.tddswarm/pilots/')) throw new Error('Private pilot output must be under .tddswarm/pilots/');
  const output = safePath(root, relative);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.mkdirSync(output); // Never replace prior evidence.
  const projects = [];
  for (let index = 0; index < validated.projects.length; index++) {
    const project = validated.projects[index], directory = path.join(output, project.name);
    fs.mkdirSync(directory);
    const request = path.join(directory, 'request.json');
    fs.writeFileSync(request, JSON.stringify({ project, revision: inspected[index].revision, repetitions: validated.repetitions, timeoutMs: validated.timeoutMs, directory }));
    const result = spawnSync(process.execPath, [worker, request], { encoding: 'utf8', env: environment(), shell: false, timeout: Math.min(1800000, validated.timeoutMs * (3 + project.changes.length * validated.repetitions * 5)), killSignal: 'SIGKILL', maxBuffer: 4 * 1024 * 1024 });
    fs.writeFileSync(path.join(directory, 'worker-log.json'), JSON.stringify({ status: result.status, signal: result.signal, error: result.error?.message, stdout: result.stdout, stderr: result.stderr }, null, 2));
    let receipt;
    try { receipt = JSON.parse(fs.readFileSync(path.join(directory, 'receipt.json'), 'utf8')); } catch { receipt = { name: project.name, framework: project.config.adapter, valid: false, error: 'Worker did not finish; retained workspace and logs', changes: [] }; }
    const unchanged = git(project.root, ['rev-parse', 'HEAD']).trim() === inspected[index].revision && !git(project.root, ['status', '--porcelain']).trim();
    receipt.sourceCheckoutUnchanged = unchanged;
    if (result.status !== 0 || !unchanged) receipt.valid = false;
    projects.push(receipt);
  }
  const report = { schemaVersion: 1, executed: true, output, environment: { node: process.version, platform: process.platform, arch: process.arch }, repetitions: validated.repetitions, projects,
    valid: projects.every(p => p.valid), limitations: ['Local scopes and planted changes only; no production or whole-project certification.', 'Installed dependencies are shared read-only by convention, not an OS sandbox. Native test code may access network or local files.', 'Provider credentials are removed from inherited environment; no dependency installation or agent invocation occurs.', 'Both execution orders and planning overhead are measured. Timing results are environment-specific.'] };
  fs.writeFileSync(path.join(output, 'summary.json'), JSON.stringify(report, null, 2));
  return report;
}

/** Fixed aggregate fields only: never project aliases, paths, source, case names, or logs. */
export function exportPilot(report) {
  if (report?.schemaVersion !== 1 || report.executed !== true || !Array.isArray(report.projects) || report.projects.length > 20) throw new Error('Invalid pilot receipt');
  const trials = report.projects.flatMap(p => Array.isArray(p.changes) ? p.changes.flatMap(c => Array.isArray(c.trials) ? c.trials : []) : []);
  if(trials.length>1200)throw new Error('Pilot trial count exceeds manifest bounds');
  const valid = trials.filter(t => t.valid === true);
  const sum = (key,rows=trials) => rows.reduce((n, t) => n + (Number.isFinite(t[key]) && t[key] >= 0 && t[key] < 1e9 ? t[key] : 0), 0);
  return { schemaVersion: 1, kind: 'local-pilot-aggregate', projects: report.projects.length, validProjects: report.projects.filter(p => p.valid === true).length,
    frameworks: frameworks.filter(f => report.projects.some(p => p.framework === f)), trials: trials.length, validTrials: valid.length,
    observedFailures: sum('fullFailures'), missedFailures: sum('missedFailures'), unexpectedSubsetFailures: sum('unexpectedSubsetFailures'), validTrialTimings:{fullMs:sum('fullMs',valid),subsetMs:sum('subsetMs',valid),planningMs:sum('planningMs',valid)},
    limitation: 'Unauthenticated local aggregates; planted changes and declared scopes only. Not an independent leaderboard.' };
}
