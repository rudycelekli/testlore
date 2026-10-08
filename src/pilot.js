import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {digest} from './provenance.js';
import { git, safePath, validateConfig } from './files.js';
import { inspectHistoricalChange } from './pilot-history.js';
import {validatePropertyReplay} from './pilot-property-replay.js';

const worker = fileURLToPath(new URL('./pilot-worker.js', import.meta.url));
const frameworks = ['node', 'jest', 'vitest', 'playwright'];
export const PILOT_EXECUTION_MODES = Object.freeze(['legacy','unified-native']);
export function validatePilotCachePolicy(value){
 if(value===undefined)return undefined;
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==1||value.jitiFilesystem!==false)throw Error('Pilot cachePolicy only permits explicit jitiFilesystem:false');
 return {jitiFilesystem:false};
}
export function validatePilotManifest(value) {
  if (value?.schemaVersion !== 1 || !Array.isArray(value.projects) || !value.projects.length || value.projects.length > 20) throw new Error('Pilot manifest needs schemaVersion:1 and 1–20 projects');
  const cachePolicy=validatePilotCachePolicy(value.cachePolicy);
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
    const propertyReplay=validatePropertyReplay(project.propertyReplay);
    if(propertyReplay&&config.adapter!=='vitest')throw new Error('Property replay requires the Vitest adapter');
    if (!Array.isArray(project.changes) || !project.changes.length || project.changes.length > 12) throw new Error('Each pilot needs 1–12 exact source changes');
    const changeNames = new Set();
    for (const change of project.changes) {
      if (!/^[a-z][a-z0-9-]{0,47}$/.test(change.name) || changeNames.has(change.name)) throw new Error('Change aliases must be unique');
      changeNames.add(change.name);
      if (change.kind === 'history') {
        if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(change.baseRevision || '') || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(change.headRevision || '') || change.baseRevision === change.headRevision || typeof change.expectedFailure !== 'boolean' || ['file','before','after'].some(key => key in change)) throw new Error('Historical changes need distinct immutable baseRevision/headRevision and expectedFailure:boolean, without patches');
        continue;
      }
      if (change.kind !== undefined && change.kind !== 'patch') throw new Error('Unknown pilot change kind');
      safePath(project.root, change.file);
      if (!/\.(?:[cm]?[jt]sx?|html|css|json|md)$/.test(change.file) || /(?:^|\/)(?:package(?:-lock)?\.json|tddswarm\.config\.json)$/.test(change.file)) throw new Error('Pilot changes must target source, not dependencies or analysis configuration');
      if (typeof change.before !== 'string' || !change.before || typeof change.after !== 'string' || change.before === change.after || change.before.length + change.after.length > 65536 || typeof change.expectedFailure !== 'boolean') throw new Error('Each change needs bounded distinct before/after text and expectedFailure:boolean');
    }
    return { name: project.name, root: fs.realpathSync(project.root), scope: project.scope, config, changes: project.changes,...(propertyReplay?{propertyReplay}:{}) };
  });
  return { schemaVersion: 1, projects, repetitions, timeoutMs,...(cachePolicy?{cachePolicy}:{}) };
}

function inspect(project) {
  const revision = git(project.root, ['rev-parse', 'HEAD']).trim();
  const repository = fs.realpathSync(git(project.root, ['rev-parse', '--show-toplevel']).trim());
  if (repository !== project.root) throw new Error('Pilot root must be the repository root');
  if (git(project.root, ['status', '--porcelain']).trim()) throw new Error(`Pilot ${project.name} needs a clean source checkout; commit or choose another repository`);
  const historicalChanges = [];
  for (const change of project.changes) {
    if (change.kind === 'history') { historicalChanges.push({ name: change.name, ...inspectHistoricalChange(project.root, change, revision) }); continue; }
    const source = fs.readFileSync(safePath(project.root, change.file), 'utf8');
    if (source.split(change.before).length !== 2) throw new Error(`Patch precondition must match exactly once: ${project.name}/${change.name}`);
  }
  return { name: project.name, revision, framework: project.config.adapter, scope: project.scope, changes: project.changes.length, historicalChanges, dependencyMode: fs.existsSync(path.join(project.root, 'node_modules')) ? 'shared-installed-local' : 'none' };
}
export function pilotEnvironment(cachePolicy) {
  cachePolicy=validatePilotCachePolicy(cachePolicy);
  const env = {};
  for (const key of ['PATH', 'HOME', 'TMPDIR', 'TEMP', 'TMP', 'SystemRoot', 'USERPROFILE', 'LANG', 'LC_ALL', 'PLAYWRIGHT_BROWSERS_PATH']) if (process.env[key]) env[key] = process.env[key];
  return { ...env, CI: '1', NODE_ENV: 'test',...(cachePolicy?{JITI_FS_CACHE:'false'}:{}) };
}

/** Local pilot execution is explicit. No downloads, provider calls, or remote publication. */
export function pilot(root, manifest, options = {}) {
  if (options.unifiedNative !== undefined && typeof options.unifiedNative !== 'boolean') throw new Error('unifiedNative must be an explicit boolean');
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
    fs.writeFileSync(request, JSON.stringify({ project, revision: inspected[index].revision, repetitions: validated.repetitions, timeoutMs: validated.timeoutMs, directory, unifiedNative:options.unifiedNative===true }));
    const result = spawnSync(process.execPath, [worker, request], { encoding: 'utf8', env: pilotEnvironment(validated.cachePolicy), shell: false, timeout: Math.min(1800000, validated.timeoutMs * (3 + project.changes.length * validated.repetitions * 5)), killSignal: 'SIGKILL', maxBuffer: 4 * 1024 * 1024 });
    fs.writeFileSync(path.join(directory, 'worker-log.json'), JSON.stringify({ status: result.status, signal: result.signal, error: result.error?.message, stdout: result.stdout, stderr: result.stderr }, null, 2));
    let receipt;
    try { receipt = JSON.parse(fs.readFileSync(path.join(directory, 'receipt.json'), 'utf8')); } catch { receipt = { name: project.name, framework: project.config.adapter, valid: false, error: 'Worker did not finish; retained workspace and logs', changes: [] }; }
    receipt.requestedChanges = project.changes.length;
    const unchanged = git(project.root, ['rev-parse', 'HEAD']).trim() === inspected[index].revision && !git(project.root, ['status', '--porcelain']).trim();
    receipt.sourceCheckoutUnchanged = unchanged;
    if (result.status !== 0 || !unchanged) receipt.valid = false;
    projects.push(receipt);
  }
  const report = { schemaVersion: 1, executed: true, executionMode:options.unifiedNative===true?'unified-native':'legacy', output, environment: { node: process.version, platform: process.platform, arch: process.arch,...(validated.cachePolicy?{cachePolicy:validated.cachePolicy}:{}) }, repetitions: validated.repetitions, projects,
    valid: projects.every(p => p.valid), implementationHashes:Object.fromEntries(['pilot.js','pilot-worker.js','pilot-history.js','pilot-property-replay.js','runner.js','execution.js','selector.js','graph.js','provenance.js'].map(file=>[file,digest(fs.readFileSync(new URL(file,import.meta.url)))])),limitations: ['Local declared scopes, planted changes and bounded historical Git pairs only; no production or whole-project certification.', 'Installed dependencies are shared read-only by convention, not an OS sandbox. Native test code may access network or local files.', 'Provider credentials are removed from inherited environment; no dependency installation or agent invocation occurs.', 'Three execution arms rotate order; TestLore discovery, planning, execution, provenance and receipt retention are included. Native related selection runs through the native CLI where available. Timing results are environment-specific.','Property replay, when declared, uses an explicit configuration overlay in disposable copies. It changes the measurement profile and does not certify external entropy or exact generated inputs.'] };
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
  const changes=report.projects.flatMap(project=>Array.isArray(project.changes)?project.changes:[]);
  const knownChangeCount=project=>(Number.isInteger(project.requestedChanges)&&project.requestedChanges>=1&&project.requestedChanges<=12)||(Array.isArray(project.changes)&&project.changes.length>=1&&project.changes.length<=12);
  const unknownTrialCounts=report.projects.filter(project=>!knownChangeCount(project)).length;
  const requestedChanges=report.projects.reduce((count,project)=>count+(Number.isInteger(project.requestedChanges)&&project.requestedChanges>=1&&project.requestedChanges<=12?project.requestedChanges:Array.isArray(project.changes)?project.changes.length:0),0);
  const requestedTrials=!unknownTrialCounts&&Number.isInteger(report.repetitions)&&report.repetitions>=1&&report.repetitions<=5?requestedChanges*report.repetitions:null;
  return { schemaVersion: 1, kind: 'local-pilot-aggregate', projects: report.projects.length, validProjects: report.projects.filter(p => p.valid === true).length,
    frameworks: frameworks.filter(f => report.projects.some(p => p.framework === f)), trials: trials.length, validTrials: valid.length,
    requestedTrials, uncompletedTrials:requestedTrials===null?null:Math.max(0,requestedTrials-trials.length),unknownTrialCounts,changeErrors:changes.filter(change=>change.error).length,
    sourceCheckoutsVerifiedUnchanged:report.projects.filter(project=>project.sourceCheckoutUnchanged===true).length,
    sourceCheckoutsUnverified:report.projects.filter(project=>typeof project.sourceCheckoutUnchanged!=='boolean').length,
    nativeUnverifiedTrials:trials.filter(trial=>typeof trial.nativeScopeComplete!=='boolean'||typeof trial.nativeCasePreservation?.complete!=='boolean').length,
    caseObservations:{full:sum('fullCases'),testLore:sum('subsetCases'),native:sum('nativeCases')},fileObservations:{full:sum('totalFiles'),testLore:sum('selectedFiles'),native:sum('nativeFiles')},negativeSavingsVsNative:trials.filter(trial=>Number.isFinite(trial.netVsNativeMs)&&trial.netVsNativeMs<0).length,
    observedFailures: sum('fullFailures'), missedFailures: sum('missedFailures'), unexpectedSubsetFailures: sum('unexpectedSubsetFailures'), nativeValidTrials:trials.filter(t=>t.nativeValid===true&&t.nativeScopeComplete===true&&t.nativeCasePreservation?.complete===true).length,nativeMissedFailures:sum('nativeMissedFailures'),nativeUnexpectedFailures:sum('nativeUnexpectedFailures'), invalidTrials:trials.length-valid.length, errorProjects:report.projects.filter(p=>p.error).length, historicalChanges:changes.filter(change=>change.kind==='history').length, negativeSavings:trials.filter(t=>Number.isFinite(t.netSavingMs)&&t.netSavingMs<0).length, allTrialTimings:{fullMs:sum('fullMs'),testLoreMs:sum('testLoreMs'),nativeMs:sum('nativeMs'),netVsFullMs:sum('fullMs')-sum('testLoreMs'),netVsNativeMs:sum('nativeMs')-sum('testLoreMs')}, validTrialTimings:{fullMs:sum('fullMs',valid),subsetMs:sum('subsetMs',valid),planningMs:sum('planningMs',valid),testLoreMs:sum('testLoreMs',valid),nativeMs:sum('nativeMs',valid)},
    limitation: 'Unauthenticated local aggregates; planted changes, historical revision pairs and declared scopes only. Not an independent leaderboard.' };
}
