import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const label = value => typeof value === 'string' && /^\/\/[A-Za-z0-9_./-]*:[A-Za-z0-9_.*+-]+$/.test(value);
function settings(config) {
  const value = config.integration;
  if (!value || !['pytest-testmon', 'nx', 'bazel'].includes(value.type)) throw new Error('Configure integration.type: pytest-testmon, nx, or bazel');
  for (const key of ['args', 'options', 'queryOptions']) if (value[key] !== undefined && (!Array.isArray(value[key]) || value[key].some(v => typeof v !== 'string' || v.includes('\0')))) throw new Error(`integration.${key} must be an argv array`);
  if (value.executable !== undefined && (typeof value.executable !== 'string' || !value.executable || value.executable.includes('\0'))) throw new Error('integration.executable must be a program path');
  return {...value,env:config.env||{}};
}
function invoke(root, value, args) {
  const executable = value.executable || ({ nx: path.join(root, 'node_modules', '.bin', 'nx'), bazel: 'bazel', 'pytest-testmon': 'pytest' })[value.type];
  const command = [executable, ...(value.args || []), ...args];
  const start = performance.now();
  const env = { ...process.env,...value.env }; delete env.NODE_TEST_CONTEXT;
  const result = spawnSync(command[0], command.slice(1), { cwd: root, env, shell: false, encoding: 'utf8', timeout: value.timeoutMs || 120000, maxBuffer: 16 * 1024 * 1024 });
  return { adapter: value.type, command, exitCode: result.status ?? 2, stdout: result.stdout || '', stderr: result.stderr || '', durationMs: Math.round(performance.now() - start), ...(result.error ? { error: result.error.message } : {}), ...(result.signal ? { signal: result.signal } : {}) };
}
function refs(root, options) {
  const base = options.base || 'HEAD'; const head = options.head || 'HEAD';
  if ([base, head].some(v => typeof v !== 'string' || v.startsWith('-') || v.includes('\0'))) throw new Error('base/head must be Git references');
  const resolve = ref => {
    const result = spawnSync('git', ['rev-parse', '--verify', `${ref}^{commit}`], { cwd: root, encoding: 'utf8', shell: false });
    if (result.status !== 0) throw new Error(`Cannot resolve Git reference: ${ref}`);
    return result.stdout.trim();
  };
  return { base: resolve(base), head: resolve(head) };
}
function fail(adapter, error) { return { adapter, complete: false, exitCode: 2, error: error.message || String(error), targets: [] }; }
export function externalPlan(root, config, options = {}) {
  root = path.resolve(root); let value;
  try {
    value = settings(config);
    if (value.type === 'pytest-testmon') return { adapter: value.type, exitCode: 0, complete: false, delegated: true, mode: fs.existsSync(path.join(root, '.testmondata')) ? 'testmon' : 'initial-full', targets: null, reasons: ['pytest-testmon selects during pytest execution; no invented static collection'], command: [value.executable || 'pytest', ...(value.args || []), '--testmon', ...(value.options || [])] };
    if (value.type === 'nx') {
      if (options.changed && options.changed.some(v => typeof v !== 'string' || v.includes(',') || v.startsWith('-'))) throw new Error('Nx changed paths must be unambiguous strings');
      const revisions = refs(root, options);
      const scope = options.full || options.shadow ? [] : options.changed ? [`--files=${options.changed.join(',')}`] : [`--base=${revisions.base}`, ...(options.head ? [`--head=${revisions.head}`] : [])];
      const result = invoke(root, value, ['show', 'projects', ...(scope.length ? ['--affected', ...scope] : []), '--withTarget=test', '--json']);
      if (result.exitCode !== 0) return { ...result, complete: false, targets: [] };
      const targets = JSON.parse(result.stdout);
      if (!Array.isArray(targets) || targets.some(v => typeof v !== 'string' || !/^[A-Za-z0-9_@/.-]+$/.test(v))) throw new Error('Nx returned invalid project JSON');
      return { ...result, ...revisions, complete: true, targets, mode: scope.length ? 'affected' : 'full', evidence: 'nx-project-graph' };
    }
    const targets = value.targets || ['//...'];
    if (!Array.isArray(targets) || !targets.length || targets.some(v => !label(v) && v !== '//...')) throw new Error('Bazel targets must be explicit labels or //...');
    let changed = options.changed;
    if (!changed) {
      const revisions = refs(root, options);
      const diff = spawnSync('git', ['diff', '--name-only', '-z', revisions.base, '--'], { cwd: root, encoding: 'utf8', shell: false });
      if (diff.status !== 0) throw new Error('Bazel Git change discovery failed');
      const untracked = spawnSync('git', ['ls-files', '--others', '--exclude-standard', '-z'], { cwd: root, encoding: 'utf8', shell: false });
      if (untracked.status !== 0) throw new Error('Bazel untracked discovery failed');
      changed = [...diff.stdout.split('\0'), ...untracked.stdout.split('\0')].filter(Boolean);
    }
    if (!Array.isArray(changed) || changed.some(v => typeof v !== 'string')) throw new Error('changed must be a path array');
    const mapping = value.fileLabels || {};
    const unmapped = changed.filter(file => !Array.isArray(mapping[file]) || !mapping[file].length);
    const mapped = [...new Set(changed.flatMap(file => mapping[file] || []))];
    if (mapped.some(v => !label(v))) throw new Error('Bazel fileLabels values must be explicit labels');
    const full = options.full || options.shadow || unmapped.length > 0;
    const universe = `set(${targets.join(' ')})`;
    const query = `kind(".*_test rule", ${full ? universe : mapped.length ? `rdeps(${universe}, set(${mapped.join(' ')}))` : 'set()'})`;
    const result = invoke(root, value, ['query', query, '--output=label', ...(value.queryOptions || [])]);
    if (result.exitCode !== 0) return { ...result, complete: false, targets: [] };
    const selected = result.stdout.trim().split('\n').filter(Boolean);
    if (selected.some(v => !label(v))) throw new Error('Bazel returned invalid target labels');
    return { ...result, complete: true, targets: selected, mode: full ? 'full' : 'affected', reasons: unmapped.length ? ['unmapped-file-label-full-fallback'] : [], unmapped, evidence: 'bazel-query-rdeps' };
  } catch (error) { return fail(value?.type || config.integration?.type, error); }
}
export function externalRun(root, config, options = {}) {
  let value;
  try {
    value = settings(config); const selection = externalPlan(root, config, options);
    if (selection.exitCode || (value.type !== 'pytest-testmon' && !selection.complete)) return { ...selection, executed: false };
    let args;
    if (value.type === 'pytest-testmon') args = ['--testmon', ...(options.full || options.shadow ? ['--testmon-noselect'] : []), ...(value.options || [])];
    else if (!selection.targets.length) return { ...selection, executed: false, exitCode: 0 };
    else if (value.type === 'nx') args = ['run-many', '-t', 'test', `--projects=${selection.targets.join(',')}`, ...(value.options || [])];
    else args = ['test', ...selection.targets, ...(value.options || [])];
    const result = invoke(path.resolve(root), value, args);
    // Bazel uses 1 for build failure and 3 for a completed build with failed tests.
    return { ...result, plan: selection, complete: !result.error && !result.signal && (value.type === 'bazel' ? [0, 3] : [0, 1]).includes(result.exitCode), executed: true, shadow: Boolean(options.shadow), delegated: true, initialFull: selection.mode === 'initial-full' };
  } catch (error) { return { ...fail(value?.type, error), executed: false }; }
}
