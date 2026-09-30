import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { safePath, validateConfig } from './files.js';
import { BUILTIN_PLUGINS } from './plugin-config.js';
import { exportLearning } from './learning.js';

const hash = value => createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest('hex');
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const own = (value, key) => Object.hasOwn(value, key);
const LIMITATIONS = [
  'Deterministic project-fit rules; no global performance or quality ranking.',
  'Read-only file and installation evidence; no commands, SDK imports, installs, network, or provider requests.',
  'Presence does not certify native compatibility, runtime correctness, worker readiness, or measured quality.',
  'Automatic configuration may enable ready complementary capabilities; generation and existing explicit choices remain manual.'
];

/** Inspect a fixed bounded inventory. Never import project code or run manifest scripts. */
export function recommendPlugins(projectRoot) {
  const root = fs.realpathSync(path.resolve(projectRoot)), evidence = [], warnings = [];
  let blocked = false, configHash = null, raw = {}, config = {};
  function read(file, { json = false, max = 128 * 1024 } = {}) {
    try {
      const target = safePath(root, file);
      if (!fs.existsSync(target)) { evidence.push({ path: file, state: 'missing' }); return null; }
      const stat = fs.statSync(target);
      if (!stat.isFile() || stat.size > max) throw new Error('not a bounded regular file');
      const bytes = fs.readFileSync(target);
      if (bytes.length > max) throw new Error('file grew beyond bound');
      evidence.push({ path: file, state: 'present', hash: hash(bytes) });
      const text = bytes.toString('utf8');
      if (!json) return text;
      const value = JSON.parse(text);
      if (!object(value)) throw new Error('JSON must be an object');
      return value;
    } catch {
      evidence.push({ path: file, state: 'unsafe-or-invalid' }); warnings.push(`Ignored unsafe, oversized, or invalid evidence: ${file}`); blocked = true; return null;
    }
  }
  const configFile = read('tddswarm.config.json', { max: 256 * 1024 });
  if (configFile !== null) {
    configHash = hash(configFile);
    try { raw = JSON.parse(configFile); config = validateConfig(raw); }
    catch { raw = {}; config = {}; warnings.push('Invalid project configuration; automatic changes are blocked.'); blocked = true; }
  }
  const pkg = read('package.json', { json: true }) || {};
  const deps = {};
  for (const key of ['dependencies', 'devDependencies', 'optionalDependencies']) {
    const entries = pkg[key];
    if (entries === undefined) continue;
    if (!object(entries) || Object.keys(entries).length > 512 || Object.entries(entries).some(([name, version]) => name.length > 128 || typeof version !== 'string' || version.length > 256)) { blocked = true; warnings.push(`Invalid bounded ${key} in package.json`); continue; }
    for (const [name, version] of Object.entries(entries)) deps[name] = version;
  }
  const nx = read('nx.json', { json: true });
  const bazelFiles = ['MODULE.bazel', 'WORKSPACE', 'WORKSPACE.bazel'].filter(file => read(file, { max: 256 * 1024 }) !== null);
  const pythonFiles = ['pyproject.toml', 'pytest.ini', 'setup.cfg'].map(file => ({ file, text: read(file, { max: 256 * 1024 }) })).filter(item => item.text !== null);
  const python = pythonFiles.filter(item => item.file === 'pytest.ini' || /\[tool\.pytest\.ini_options\]|\[tool\.poetry\]|\[project\]|\[tool:pytest\]/.test(item.text));
  const pythonTestmon = pythonFiles.some(item => /(?:^|["'\s,])pytest[-_]testmon(?:["'\s<>=!~;\],]|$)/m.test(item.text.replace(/^\s*#.*$/gm, '')));
  const npmInstalled = new Map();
  function packageInstalled(name) {
    if (npmInstalled.has(name)) return npmInstalled.get(name);
    const file = `node_modules/${name}/package.json`, value = read(file, { json: true, max: 64 * 1024 });
    const result = value?.name === name ? { file, value } : null;
    npmInstalled.set(name, result); return result;
  }
  function executable(file, packageName) {
    try {
      const relative = file.split('/');
      const parent = safePath(root, relative.slice(0, -1).join('/'));
      const target = path.join(parent, relative.at(-1));
      if (!fs.existsSync(target)) { evidence.push({ path: file, state: 'missing' }); return false; }
      const link = fs.lstatSync(target);
      let resolved = target;
      if (link.isSymbolicLink()) {
        // npm bins normally point into the installed matching package. Never follow an external bin.
        if (!packageName || !packageInstalled(packageName)) throw new Error('unsupported binary symlink');
        resolved = fs.realpathSync(target);
        const packageRoot = safePath(root, `node_modules/${packageName}`);
        if (!resolved.startsWith(packageRoot + path.sep)) throw new Error('bin escapes matching local package');
        safePath(root, path.relative(root, resolved).split(path.sep).join('/'));
      }
      const stat = fs.statSync(resolved);
      const usable = stat.isFile() && (process.platform === 'win32' || (stat.mode & 0o111) !== 0);
      evidence.push({ path: file, state: usable ? 'executable-present' : 'non-executable', target: path.relative(root, resolved).split(path.sep).join('/'), size: stat.size, modified: stat.mtimeMs, mode: stat.mode });
      return usable;
    } catch { evidence.push({ path: file, state: 'unsafe-or-unavailable' }); return false; }
  }
  function nodeTool(name, bin) { return Boolean(packageInstalled(name)) && executable(`node_modules/.bin/${bin}`, name); }
  const installed = {
    nx: nodeTool('nx', 'nx'), c8: nodeTool('c8', 'c8'), stryker: nodeTool('@stryker-mutator/core', 'stryker'),
    'agentic-qe': nodeTool('agentic-qe', 'aqe'), ruvector: false, bazel: false, 'pytest-testmon': false
  };
  const ruvector = packageInstalled('@ruvector/core');
  if (ruvector) {
    const main = ruvector.value.main || 'index.js';
    if (typeof main === 'string' && main.length < 512 && !path.isAbsolute(main) && !main.includes('\\') && !main.split('/').includes('..')) {
      const source = `node_modules/@ruvector/core/${main.replace(/^\.\//, '')}`;
      // Resolution evidence only: bounded file presence, never import or native loading.
      installed.ruvector = read(source, { max: 1024 * 1024 }) !== null;
    }
  }
  let bazelExecutable;
  for (const file of ['tools/bazel', '.bin/bazel']) if (executable(file)) { installed.bazel = true; bazelExecutable = file; break; }
  // Bazelisk is deliberately not ready: its first execution can download Bazel.
  const bazelisk = Boolean(packageInstalled('@bazel/bazelisk'));
  let pytestExecutable, testmonMetadata;
  for (const environment of ['.venv', 'venv']) {
    const bin = `${environment}/bin/pytest`;
    if (!executable(bin)) continue;
    try {
      const lib = safePath(root, `${environment}/lib`);
      if (!fs.existsSync(lib)) continue;
      const versions = boundedDirectory(lib, 16).filter(name => /^python\d+\.\d+$/.test(name));
      for (const version of versions) {
        const packages = `${environment}/lib/${version}/site-packages`;
        const directory = safePath(root, packages);
        if (!fs.existsSync(directory)) continue;
        for (const name of boundedDirectory(directory, 512).filter(name => /^pytest_testmon-[A-Za-z0-9.+_-]{1,64}\.dist-info$/.test(name))) {
          const file = `${packages}/${name}/METADATA`, metadata = read(file, { max: 64 * 1024 });
          if (metadata && /^Name:\s*pytest-testmon\s*$/m.test(metadata)) { testmonMetadata = file; pytestExecutable = bin; installed['pytest-testmon'] = true; break; }
        }
      }
    } catch { warnings.push(`Unable to inspect bounded local pytest installation: ${environment}`); }
    if (installed['pytest-testmon']) break;
  }
  const learningFile = '.tddswarm/learning/index.json';
  let learningReady = false;
  if (config.learning?.enabled !== false) {
    const learning = read(learningFile, { max: 4 * 1024 * 1024 });
    if (learning !== null) { const aggregate = exportLearning(root); learningReady = aggregate.exported && aggregate.episodes > 0; if (!aggregate.exported) warnings.push('Local learning store is not intact; vector activation is blocked.'); }
  }
  const configured = raw.plugins && object(raw.plugins) ? raw.plugins : {};
  const nodeProject = own(pkg, 'name') || Object.keys(deps).length > 0 || ['node','jest','vitest'].includes(config.adapter);
  const fit = { nx: nx !== null || own(deps, 'nx'), bazel: bazelFiles.length > 0, 'pytest-testmon': python.length > 0, c8: nodeProject && own(deps, 'c8'), stryker: nodeProject && own(deps, '@stryker-mutator/core'), ruvector: learningReady && config.learning?.enabled !== false, 'agentic-qe': nodeProject || python.length > 0 };
  const evidenceFor = {
    nx: [...(nx ? ['nx.json'] : []), ...(own(deps, 'nx') ? ['package.json'] : []), ...(installed.nx ? ['node_modules/.bin/nx'] : [])],
    bazel: [...bazelFiles, ...(bazelExecutable ? [bazelExecutable] : []), ...(bazelisk ? ['node_modules/@bazel/bazelisk/package.json'] : [])],
    'pytest-testmon': [...python.map(item => item.file), ...(pytestExecutable ? [pytestExecutable, testmonMetadata] : [])],
    c8: ['package.json', ...(installed.c8 ? ['node_modules/.bin/c8'] : [])],
    stryker: ['package.json', ...(installed.stryker ? ['node_modules/.bin/stryker'] : [])],
    ruvector: [...(ruvector ? [ruvector.file] : []), ...(learningReady ? [learningFile] : [])],
    'agentic-qe': [...(nodeProject ? ['package.json'] : python.map(item => item.file)), ...(installed['agentic-qe'] ? ['node_modules/.bin/aqe'] : [])]
  };
  const recommendations = BUILTIN_PLUGINS.map(plugin => {
    const retained = own(configured, plugin.id), ready = installed[plugin.id] && fit[plugin.id];
    const reasons = [];
    if (retained) reasons.push('Existing explicit plugin entry is preserved, including disabled settings.');
    if (!fit[plugin.id]) reasons.push('No matching project evidence for automatic activation.');
    if (!installed[plugin.id]) reasons.push('Matching project-local installation is missing or cannot be safely inspected.');
    if (plugin.id === 'agentic-qe') reasons.push('Generation requires explicit worker/provider setup; never automatically activated.');
    if (plugin.id === 'ruvector') reasons.push('Requires enabled local learning with intact persisted episodes; SDK presence is not native compatibility certification.');
    if (plugin.id === 'bazel' && bazelisk && !installed.bazel) reasons.push('Bazelisk can download tools; configure an installed native Bazel binary explicitly.');
    if (plugin.id === 'pytest-testmon' && !pythonTestmon) reasons.push('No declared pytest-testmon dependency found; local extension metadata is required.');
    if (['c8','stryker'].includes(plugin.id)) reasons.push('Enabling report import does not execute measurement or certify test quality.');
    return { id: plugin.id, role: ({ 'native-backend':'execution','measured-import':plugin.id === 'c8' ? 'coverage' : 'mutation','learning-retrieval':'learning','generation':'generation' })[plugin.kind], status: retained ? 'retained' : ready ? 'recommended' : installed[plugin.id] ? 'available' : 'missing', configured: retained, installed: installed[plugin.id], ready: Boolean(ready), projectFit: Boolean(fit[plugin.id]), evidence: evidenceFor[plugin.id], reasons };
  });
  for (const id of Object.keys(configured).filter(id => !BUILTIN_PLUGINS.some(plugin => plugin.id === id))) recommendations.push({ id, role: configured[id]?.kind === 'worker' ? 'generation' : 'custom', status: 'retained', configured: true, ready: false, evidence: ['tddswarm.config.json'], reasons: ['Explicit custom plugin is preserved; automatic configuration never adds competing workers.'] });
  const explicitCore = own(raw, 'runner') || own(raw, 'adapter');
  const existingBackend = config.integration?.type || raw.executionPlugin;
  const nativeCandidates = ['nx','bazel','pytest-testmon'].filter(id => fit[id]);
  const needsChoice = !existingBackend && !explicitCore && nativeCandidates.length > 1;
  const applicable = recommendations.filter(item => !item.configured && item.ready && ['coverage','mutation','learning'].includes(item.role)).map(item => ({ id: item.id }));
  let selected = existingBackend || (explicitCore ? 'core' : null);
  if (!selected && !needsChoice && nativeCandidates.length === 1) {
    const id = nativeCandidates[0], item = recommendations.find(item => item.id === id);
    if (item.ready && !item.configured) {
      const settings = id === 'bazel' ? { executable: bazelExecutable } : id === 'pytest-testmon' ? { executable: pytestExecutable } : {};
      applicable.push({ id, ...(Object.keys(settings).length ? { settings } : {}), select: true }); selected = id;
    }
  }
  if (!selected) selected = 'core';
  recommendations.unshift({ id: 'core', role: 'execution', status: existingBackend || explicitCore ? 'retained' : 'available', ready: true, configured: explicitCore, selected: selected === 'core', evidence: [...(explicitCore ? ['tddswarm.config.json'] : []), ...(nodeProject ? ['package.json'] : [])], reasons: [existingBackend ? 'Existing explicitly selected native backend is retained; core execution remains available.' : explicitCore ? 'Explicit Node/Jest/Vitest or custom runner/adapter is preserved.' : 'Reuse built-in execution unless one ready native backend has unambiguous project evidence.'] });
  for (const item of recommendations) if (item.role === 'execution') item.selected = item.id === selected;
  if (needsChoice) warnings.push(`Multiple project-native execution systems detected: ${nativeCandidates.join(', ')}; choose explicitly.`);
  if (blocked) applicable.length = 0;
  const evidenceHash = hash(evidence);
  const report = { schemaVersion: 1, recommendations, applicable, execution: { selected, needsChoice, candidates: nativeCandidates }, configHash, evidenceHash, blocked, warnings, limitations: LIMITATIONS };
  return { ...report, fingerprint: hash(report) };
}
function boundedDirectory(directory, maximum) {
  const result = [], stream = fs.opendirSync(directory);
  try { for (let entry; (entry = stream.readSync());) { if (result.length >= maximum) throw new Error('Directory exceeds bound'); result.push(entry.name); } }
  finally { stream.closeSync(); }
  return result.sort();
}
