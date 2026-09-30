import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { SOURCE, git, normalize, readConfig } from './files.js';
import { buildGraph, addSource, evidencePath, dependencies } from './graph.js';

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
  const graph = buildGraph(root);
  const config = readConfig(root);
  let changed, baseSha = null, prefix = '', gitError = null;
  if (options.changed) changed = [...new Set(options.changed.map(normalize))].filter(f => !f.startsWith('.tddswarm/')).sort();
  else {
    try { ({ changed, baseSha, prefix } = gitChanges(root, options.base || 'HEAD')); }
    catch { changed = []; gitError = 'git-baseline-unavailable'; }
  }
  const reasons = [];
  const canIgnore = f => (config.ignoreChanges || []).includes(f) && !graph.tests.some(t => evidencePath(graph, t, f));
  const ignored = changed.filter(canIgnore);
  const active = changed.filter(f => !canIgnore(f));
  // Old edges matter when a change removes an import or deletes a module.
  if (baseSha) {
    const oldFiles = new Set(graph.files);
    for (const file of changed) oldFiles.add(file);
    for (const file of active.filter(f => SOURCE.test(f))) {
      try { addSource(graph, file, git(root, ['show', `${baseSha}:${prefix}${file}`]), oldFiles); }
      catch { /* New file: current edges already describe it. */ }
    }
  }
  if (options.full) reasons.push('explicit-full-run');
  if (gitError) reasons.push(gitError);
  if (active.some(f => GLOBAL.test(f))) reasons.push('global-configuration-changed');
  if (active.length && graph.warnings.length) reasons.push('dependency-graph-incomplete');
  const unresolvedChanges = active.filter(f => !graph.files.includes(f) && !Object.values(graph.edges).some(deps => deps.includes(f)));
  if (unresolvedChanges.length) reasons.push('unmapped-or-deleted-input');
  for (const test of config.alwaysRun || []) if (!graph.tests.includes(test)) reasons.push('unknown-always-run-test');
  const unmapped = active.filter(f => !graph.tests.some(t => evidencePath(graph, t, f)));
  if (unmapped.length) reasons.push('change-without-test-evidence');
  let state = { count: 0, failed: [] };
  try { state = JSON.parse(fs.readFileSync(path.join(root, '.tddswarm', 'history.json'), 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') reasons.push('invalid-run-history'); }
  if (!Number.isInteger(state.count) || !Array.isArray(state.failed)) { reasons.push('invalid-run-history'); state = { count: 0, failed: [] }; }
  if (config.fullRunEvery && (state.count + 1) % config.fullRunEvery === 0) reasons.push('periodic-full-run');
  const mode = reasons.length ? 'full' : active.length ? 'affected' : 'none';
  const decisions = graph.tests.map(test => {
    const paths = active.map(file => evidencePath(graph, test, file)).filter(Boolean);
    const policy = [];
    if ((config.alwaysRun || []).includes(test)) policy.push('always-run-policy');
    if (state.failed.includes(test)) policy.push('previous-run-failed');
    // Browser/server tests may observe runtime state without importing their subject.
    if (!dependencies(graph, test).length && active.length) policy.push('test-without-local-dependencies');
    const selected = mode === 'full' || paths.length > 0 || policy.length > 0;
    return { test, selected, reasons: selected ? [...(mode === 'full' ? reasons : []), ...(paths.length ? ['dependency-path'] : []), ...policy] : ['no-known-dependency-on-change'], paths };
  });
  const selected = decisions.filter(d => d.selected).map(d => d.test);
  const fingerprint = createHash('sha256').update(JSON.stringify({ config, sources: graph.sources, edges: graph.edges, changed, baseSha })).digest('hex');
  return {
    schemaVersion: 1, mode: mode === 'none' && selected.length ? 'policy' : mode, base: baseSha, changed, ignored, selected,
    total: graph.tests.length, omitted: graph.tests.length - selected.length,
    selectionReduction: graph.tests.length ? 1 - selected.length / graph.tests.length : 0,
    reasons: [...new Set(reasons)], warnings: graph.warnings, decisions, fingerprint,
    evidence: 'static-imports-and-declared-dependencies',
    limitations: ['Runtime and external service dependencies are not observed.', 'Selection operates at test-file granularity.', 'No deployment safety or measured wall-clock savings are implied.']
  };
}
