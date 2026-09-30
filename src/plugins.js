import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { safePath, validateConfig } from './files.js';
import { BUILTIN_PLUGINS, validatePluginId } from './plugin-config.js';

function rawConfig(root) {
  const file = safePath(root, 'tddswarm.config.json');
  const original = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
  return { file, original, config: original === null ? {} : JSON.parse(original) };
}
function catalogFrom(config, raw) {
  const entries = config.plugins || {};
  const plugins = BUILTIN_PLUGINS.map(plugin => ({ ...plugin, configured: Object.hasOwn(entries, plugin.id), enabled: entries[plugin.id]?.enabled === true, selected: plugin.kind === 'native-backend' && config.integration?.type === plugin.id, legacyConfigured: raw.integration?.type === plugin.id, availability: 'unchecked', measured: false }));
  for (const [id, entry] of Object.entries(entries)) if (!BUILTIN_PLUGINS.some(plugin => plugin.id === id)) plugins.push({ id, kind: entry.kind || 'unregistered', configured: true, enabled: entry.enabled === true, selected: false, legacyConfigured: false, capabilities: entry.kind === 'worker' && entry.protocolVersion === 1 ? ['worker-protocol-v1'] : [], availability: 'unchecked', measured: false });
  return { schemaVersion: 1, plugins, limitations: ['Catalog status does not execute code or establish installation, readiness, or measured quality.'] };
}
export function pluginCatalog(root) {
  const raw = rawConfig(root).config; return catalogFrom(validateConfig(raw), raw);
}
export function configurePlugin(root, id, { enabled, settings = {}, select = false } = {}) {
  validatePluginId(id);
  if (typeof enabled !== 'boolean') throw new Error('Plugin enabled must be an explicit boolean');
  if (typeof select !== 'boolean' || (select && (!enabled || !BUILTIN_PLUGINS.some(plugin => plugin.id === id && plugin.kind === 'native-backend')))) throw new Error('select requires an enabled native backend plugin');
  if (!settings || typeof settings !== 'object' || Array.isArray(settings) || Object.hasOwn(settings, 'enabled')) throw new Error('Plugin settings must be an object without enabled');
  const current = rawConfig(root);
  if (!current.config || typeof current.config !== 'object' || Array.isArray(current.config)) throw new Error('Project configuration must be an object');
  const plugins = current.config.plugins || {};
  if (!plugins || typeof plugins !== 'object' || Array.isArray(plugins)) throw new Error('plugins must be an object');
  const entry = { ...(plugins[id] || {}), ...settings, enabled };
  const candidate = { ...current.config, plugins: { ...plugins, [id]: entry } };
  if (select) candidate.executionPlugin = id;
  else if (!enabled && candidate.executionPlugin === id) {
    const remaining = BUILTIN_PLUGINS.filter(plugin => plugin.kind === 'native-backend' && candidate.plugins[plugin.id]?.enabled === true);
    if (remaining.length > 1) throw new Error('Select another executionPlugin before disabling the selected backend');
    delete candidate.executionPlugin;
  } else if (enabled && candidate.executionPlugin === undefined) {
    const backends = BUILTIN_PLUGINS.filter(plugin => plugin.kind === 'native-backend' && candidate.plugins[plugin.id]?.enabled === true);
    if (backends.length > 1) {
      // Adding an available backend preserves existing execution instead of choosing precedence.
      let previous; try { previous = validateConfig(current.config).integration?.type; } catch {}
      if (backends.some(plugin => plugin.id === previous)) candidate.executionPlugin = previous;
    }
  }
  validateConfig(candidate); // Full resolution and legacy validation before any write.
  const temporary = safePath(root, `.tddswarm.config.plugin-${randomUUID()}.tmp`);
  try {
    fs.writeFileSync(temporary, JSON.stringify(candidate, null, 2) + '\n', { flag: 'wx', mode: fs.existsSync(current.file) ? fs.statSync(current.file).mode & 0o777 : 0o600 });
    if ((fs.existsSync(current.file) ? fs.readFileSync(current.file, 'utf8') : null) !== current.original) throw new Error('Project configuration changed during plugin configuration; retry');
    // Recheck the safe project path immediately before atomic replacement.
    safePath(root, 'tddswarm.config.json'); fs.renameSync(temporary, current.file);
  } finally { fs.rmSync(temporary, { force: true }); }
  return { id, enabled, configFile: current.file, plugin: pluginCatalog(root).plugins.find(plugin => plugin.id === id) };
}
function commandFor(root, id, entry) {
  if (entry.command) return entry.command;
  if (['nx', 'c8', 'stryker'].includes(id)) return [entry.executable || path.join(root, 'node_modules', '.bin', id), ...(entry.args || [])];
  return [entry.executable || ({ 'agentic-qe': 'aqe', 'pytest-testmon': 'pytest', bazel: 'bazel' })[id], ...(entry.args || [])];
}
function executablePath(root, executable) {
  const candidates = executable.includes('/') || executable.includes('\\') ? [path.resolve(root, executable)] : (process.env.PATH || '').split(path.delimiter).filter(Boolean).map(directory => path.join(directory, executable));
  return candidates.find(candidate => { try { fs.accessSync(candidate, process.platform === 'win32' ? fs.constants.F_OK : fs.constants.X_OK); return fs.statSync(candidate).isFile(); } catch { return false; } }) || null;
}
function probe(root, id, entry) {
  if (id === 'ruvector') {
    try {
      if (!fs.existsSync(path.join(root, 'node_modules', '@ruvector', 'core', 'package.json'))) throw new Error('Missing project-local SDK');
      const resolved = createRequire(path.join(path.resolve(root), 'package.json')).resolve('@ruvector/core'); return { installed: true, available: true, probe: 'project-sdk-resolution', resolved, measured: false, limitation: 'Resolution only; no SDK code, embedding worker, index, or quality measurement was executed.' };
    }
    catch { return { installed: false, available: false, probe: 'project-sdk-resolution', measured: false, error: 'Project-installed @ruvector/core is unavailable' }; }
  }
  const command = commandFor(root, id, entry);
  if (entry.kind === 'worker') { const installed = Boolean(executablePath(root, entry.command[0])); return { installed, available: installed, probe: 'executable-presence', command: entry.command, measured: false, protocolVerified: false, limitation: 'Worker presence only; no agent/provider or protocol request was executed.' }; }
  if (id === 'bazel') {
    const executable = executablePath(root, command[0]);
    if (/bazelisk/i.test(path.basename(command[0])) || (executable && /bazelisk/i.test(fs.realpathSync(executable)))) return { installed: Boolean(executable), available: false, probe: 'installer-wrapper-skipped', command, measured: false, integrationVerified: false, error: 'Bazelisk may download Bazel; configure an installed Bazel binary for an offline version probe.' };
  }
  const args = id === 'agentic-qe' ? ['test', '--help'] : ['--version'];
  // Explicit local probes omit provider credentials and configured plugin environments.
  const env = Object.fromEntries(['PATH', 'HOME', 'TMPDIR', 'TMP', 'TEMP', 'SystemRoot', 'COMSPEC'].filter(key => process.env[key] !== undefined).map(key => [key, process.env[key]]));
  Object.assign(env, { CI: 'true', NX_DAEMON: 'false', NX_NO_CLOUD: 'true', npm_config_offline: 'true', npm_config_update_notifier: 'false' });
  const result = spawnSync(command[0], [...command.slice(1), ...args], { cwd: root, env, shell: false, encoding: 'utf8', timeout: Math.min(entry.timeoutMs || 15000, 15000), killSignal: 'SIGKILL', maxBuffer: 1024 * 1024 });
  const output = result.stdout || ''; const generationContract = id !== 'agentic-qe' || (/generate/.test(output) && /--framework/.test(output) && /--format/.test(output) && /--output/.test(output));
  const installed = !result.error && !result.signal && result.status === 0;
  return { installed, available: installed && generationContract, probe: id === 'agentic-qe' ? 'supported-generation-help' : 'executable-version', command: [...command, ...args], exitCode: result.status ?? 2, ...(result.signal ? { signal: result.signal } : {}), stdout: output, stderr: result.stderr || '', measured: false, ...(id === 'agentic-qe' ? { generationContract: installed && generationContract, workerRoles: [] } : { integrationVerified: false }), ...(result.error ? { error: result.error.message } : !generationContract ? { error: 'Installed AQE does not expose the supported generation CLI contract' } : {}), limitation: id === 'pytest-testmon' ? 'Pytest version does not verify the testmon extension, selection correctness, or measured quality.' : 'Availability does not establish execution correctness or measured quality.' };
}
export function checkPlugins(root, { id } = {}) {
  if (id !== undefined) validatePluginId(id);
  const raw = rawConfig(root).config; const config = validateConfig(raw); const catalog = catalogFrom(config, raw);
  if (id !== undefined && !catalog.plugins.some(plugin => plugin.id === id)) throw new Error(`Unknown plugin: ${id}`);
  const plugins = catalog.plugins.filter(plugin => id === undefined || plugin.id === id).map(plugin => {
    if (!plugin.enabled) return { ...plugin, availability: 'disabled', available: false, probe: 'skipped-disabled', measured: false };
    const health = probe(path.resolve(root), plugin.id, config.plugins[plugin.id]);
    return { ...plugin, ...health, availability: health.available ? 'available' : 'unavailable' };
  });
  return { schemaVersion: 1, exitCode: plugins.some(plugin => plugin.enabled && !plugin.available) ? 2 : 0, plugins, limitations: ['Explicit availability probes do not certify measured quality; tools are never installed or downloaded by TestLore.'] };
}
