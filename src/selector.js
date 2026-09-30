import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { SOURCE, git, normalize, readConfig } from './files.js';
import { runnerIdentity, snapshot } from './provenance.js';
import { changedServices } from './inputs.js';
import { runtimeEvidence } from './evidence.js';
import { buildGraph, addSources, evidencePath, dependencies, classifyWarnings } from './graph.js';
import {adapterFor} from './execution.js';
import { externalPlan } from './integrations.js';

const GLOBAL = /(?:^|\/)(?:package(?:-lock)?\.json|npm-shrinkwrap\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?|tsconfig[^/]*\.json|jsconfig\.json|tddswarm\.config\.json|[^/]*(?:vitest|vite|jest|babel|webpack|rollup|playwright|cypress)[^/]*\.(?:[cm]?[jt]s|json)|(?:setup|globalSetup|globalTeardown)[^/]*\.[cm]?[jt]s|\.env(?:\..*)?|\.gitignore)$/;

export function gitChanges(root, base) {
  const baseSha = git(root, ['rev-parse', '--verify', `${base}^{commit}`]).trim();
  const prefix = git(root, ['rev-parse', '--show-prefix']).trim();
  const raw = git(root, ['diff', '--name-only', '--no-renames', '-z', baseSha, '--', '.']).split('\0').filter(Boolean);
  const changed = raw.map(f => prefix && f.startsWith(prefix) ? f.slice(prefix.length) : f);
  changed.push(...git(root, ['ls-files', '--others', '--exclude-standard', '-z', '--', '.']).split('\0').filter(Boolean));
  return { baseSha, prefix, changed: [...new Set(changed.map(normalize))].filter(f => !f.startsWith('.tddswarm/')).sort() };
}

export function plan(root, options = {}) {
  root = path.resolve(root);
  const config = readConfig(root);
  if (config.integration) return externalPlan(root, config, options);
  const provenance = snapshot(root,config);
  const graph = buildGraph(root);
  if(adapterFor(config)==='playwright'){
    const declared=new Set(Object.values(config.browser?.routes||{}).filter(route=>route.inputs?.length).flatMap(route=>route.tests||[]));
    // Page/server behavior is not closed by a test's local helper imports.
    for(const test of graph.tests)if(config.browser?.closedWorld!==true||!declared.has(test))graph.warnings.push({file:test,reason:'unmodeled-browser-runtime-inputs'});
  }
  let changed, baseSha = null, prefix = '', gitError = null;
  if (options.changed) changed = [...new Set(options.changed.map(normalize))].filter(f => !f.startsWith('.tddswarm/')).sort();
  else {
    try { ({ changed, baseSha, prefix } = gitChanges(root, options.base || 'HEAD')); }
    catch { changed = []; gitError = 'git-baseline-unavailable'; }
  }
  const services = changedServices(root,config);
  changed = [...new Set([...changed,...services.changed])].sort();
  graph.warnings.push(...services.warnings);
  const runtime = runtimeEvidence(root,graph,changed,config);
  if(runtime.usable) for(const [test,observation] of Object.entries(runtime.record.observations)) graph.edges[test] = [...new Set([...(graph.edges[test]||[]),...observation.dependencies])];
  const reasons = [];
  if(services.warnings.length)reasons.push('external-service-evidence-unavailable');
  if(config.runtime?.enabled && !runtime.usable)reasons.push(runtime.reason);
  if(graph.discovery?.complete===false)reasons.push('discovery-incomplete');
  const canIgnore = f => !GLOBAL.test(f) && !graph.configFiles.has(f) && (config.ignoreChanges || []).includes(f) && !graph.tests.some(t => evidencePath(graph, t, f));
  const ignored = changed.filter(canIgnore);
  const active = changed.filter(f => !canIgnore(f));
  // Old edges matter when a change removes an import or deletes a module.
  if (baseSha) {
    const oldFiles = new Set(graph.files);
    for (const file of changed) oldFiles.add(file);
    const oldSources=[];
    for (const file of active.filter(f => SOURCE.test(f))) {
      try { oldSources.push([file,git(root, ['show', `${baseSha}:${prefix}${file}`])]); }
      catch { /* New file: current edges already describe it. */ }
    }
    if(oldSources.length)addSources(graph,oldSources,oldFiles);
  }
  if (options.full) reasons.push('explicit-full-run');
  if (gitError) reasons.push(gitError);
  if (active.some(f => GLOBAL.test(f) || graph.configFiles.has(f))) reasons.push('global-configuration-changed');
  classifyWarnings(graph);
  const unresolvedWarnings = graph.warnings.filter(w => !(runtime.usable && config.runtime?.closedWorld === true && ['runtime-dependency','dynamic-dependency'].includes(w.reason)));
  const globalWarnings = unresolvedWarnings.filter(w=>w.scope==='global');
  const uncertainTests = new Set(unresolvedWarnings.filter(w=>w.scope==='test-closure').flatMap(w=>w.tests));
  if (active.length && globalWarnings.length) reasons.push('dependency-graph-incomplete');
  const unresolvedChanges = active.filter(f => !graph.files.includes(f) && !Object.values(graph.edges).some(deps => deps.includes(f)));
  if (unresolvedChanges.length) reasons.push('unmapped-or-deleted-input');
  for (const test of config.alwaysRun || []) if (!graph.tests.includes(test)) reasons.push('unknown-always-run-test');
  const unmapped = active.filter(f => !graph.tests.some(t => evidencePath(graph, t, f)));
  if (unmapped.length) reasons.push('change-without-test-evidence');
  let state = { count: 0, failed: [] };
  const identity=runnerIdentity(root,config);
  const historyPath=path.join(root,'.tddswarm',`history-${identity}.json`);
  try {
    if(fs.existsSync(historyPath))state=JSON.parse(fs.readFileSync(historyPath,'utf8'));
    else {
      const legacy=JSON.parse(fs.readFileSync(path.join(root,'.tddswarm','history.json'),'utf8'));
      if(!legacy.runner || legacy.runner===identity)state=legacy;
      else reasons.push('runner-or-environment-history-changed');
    }
  }
  catch (error) { if (error.code !== 'ENOENT') reasons.push('invalid-run-history'); }
  if (!Number.isInteger(state.count) || state.count < 0 || !Array.isArray(state.failed) || state.failed.some(f=>typeof f!=='string')) { reasons.push('invalid-run-history'); state = { count: 0, failed: [] }; }
  if(state.failed.some(f=>!graph.tests.includes(f)))reasons.push('failed-history-scope-changed');
  if (config.fullRunEvery && (state.count + 1) % config.fullRunEvery === 0) reasons.push('periodic-full-run');
  const mode = reasons.length ? 'full' : active.length ? 'affected' : 'none';
  const decisions = graph.tests.map(test => {
    const paths = active.map(file => evidencePath(graph, test, file)).filter(Boolean);
    const policy = [];
    if ((config.alwaysRun || []).includes(test)) policy.push('always-run-policy');
    if (state.failed.includes(test)) policy.push('previous-run-failed');
    if(active.length && uncertainTests.has(test))policy.push('uncertain-dependency-closure');
    // Browser/server tests may observe runtime state without importing their subject.
    if (!dependencies(graph, test).length && active.length) policy.push('test-without-local-dependencies');
    const selected = mode === 'full' || paths.length > 0 || policy.length > 0;
    return { test, selected, reasons: selected ? [...(mode === 'full' ? reasons : []), ...(paths.length ? ['dependency-path'] : []), ...policy] : ['no-known-dependency-on-change'], paths };
  });
  const selected = decisions.filter(d => d.selected).map(d => d.test);
  const fingerprint = createHash('sha256').update(JSON.stringify({ config, sources: graph.sources, edges: graph.edges, changed, baseSha })).digest('hex');
  return {
    schemaVersion: 1, provenance, serviceTokens: services.values, configurationFiles: [...graph.configFiles].sort(), mode: mode === 'none' && selected.length ? 'policy' : mode, base: baseSha, changed, ignored, selected,
    total: graph.tests.length, omitted: graph.tests.length - selected.length,
    uncertainty: { global: globalWarnings.length, retainedTests: [...uncertainTests].sort(), unreachableSources: [...new Set(unresolvedWarnings.filter(w=>w.scope==='unreachable-source').map(w=>w.file))].sort() },
    selectionReduction: graph.tests.length ? 1 - selected.length / graph.tests.length : 0,
    reasons: [...new Set(reasons)], warnings: graph.warnings, decisions, fingerprint, discovery: graph.discovery,
    runtime: {usable:runtime.usable,reason:runtime.reason,captureId:runtime.record?.captureId,policy:config.runtime?.closedWorld?'declared-closed-world':'supplement-static-only'},
    evidence: runtime.usable?'static-declared-and-observed-runtime-inputs':'static-imports-and-declared-dependencies',
    limitations: ['Runtime observations cover exercised inputs; external services require declared versions.', 'Selection operates at test-file granularity.', 'No deployment safety or measured wall-clock savings are implied.']
  };
}
