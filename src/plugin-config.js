// Pure configuration resolution: listing/configuration never loads plugin code.
export const BUILTIN_PLUGINS = Object.freeze([
  { id: 'agentic-qe', kind: 'generation', capabilities: ['direct-unreviewed-candidate-generation'], limitation: 'AQE is not the architect/author/reviewer worker protocol.' },
  { id: 'pytest-testmon', kind: 'native-backend', capabilities: ['native-selection', 'native-execution'] },
  { id: 'nx', kind: 'native-backend', capabilities: ['native-selection', 'native-execution'] },
  { id: 'bazel', kind: 'native-backend', capabilities: ['native-selection', 'native-execution'] },
  { id: 'c8', kind: 'measured-import', capabilities: ['existing-coverage-report-import'], limitation: 'Enabling does not produce or certify a coverage report.' },
  { id: 'stryker', kind: 'measured-import', capabilities: ['existing-mutation-report-import'], limitation: 'Enabling does not produce or certify a mutation report.' },
  { id: 'ruvector', kind: 'learning-retrieval', capabilities: ['local-advisory-vector-retrieval'], limitation: 'Derived retrieval cache; no model-weight training or acceptance authority.' }
].map(item => Object.freeze({ ...item, capabilities: Object.freeze(item.capabilities) })));
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export function validatePluginId(id) {
  if (typeof id !== 'string' || !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(id) || id.length > 64 || ['constructor', 'prototype'].includes(id)) throw new Error('Plugin id must be a bounded lowercase name with optional hyphens');
  return id;
}
function boundedValue(value, depth = 0) {
  if (depth > 8) throw new Error('Plugin settings are too deeply nested');
  if (typeof value === 'string' && (value.length > 8192 || value.includes('\0'))) throw new Error('Plugin settings contain an oversized or invalid string');
  if (Array.isArray(value)) { if (value.length > 1024) throw new Error('Plugin settings array is too large'); for (const item of value) boundedValue(item, depth + 1); }
  else if (object(value)) { if (Object.keys(value).length > 1024) throw new Error('Plugin settings object is too large'); for (const [key, item] of Object.entries(value)) { if (['__proto__', 'constructor', 'prototype'].includes(key)) throw new Error('Unsafe plugin settings key'); boundedValue(item, depth + 1); } }
  else if (value !== undefined && value !== null && !['string', 'number', 'boolean'].includes(typeof value)) throw new Error('Plugin settings must contain JSON values');
  if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('Plugin settings number must be finite');
}
function argv(value, name, { empty = false } = {}) {
  if (!Array.isArray(value) || (!empty && !value.length) || value.length > 64 || value.some(item => typeof item !== 'string' || !item || item.length > 4096 || item.includes('\0'))) throw new Error(`${name} must be a bounded argv array`);
  if (!empty && value[0].startsWith('-')) throw new Error(`${name} must begin with an executable`);
}
function integer(value, name, min, max) { if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${name} must be an integer from ${min} to ${max}`); }
function keys(entry, allowed, id) { for (const key of Object.keys(entry)) if (!allowed.includes(key)) throw new Error(`Unsupported ${id} plugin setting: ${key}`); }
function canonical(value) { return JSON.stringify(value, (_, item) => object(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item); }
function validateEnabled(id, entry) {
  const builtin = BUILTIN_PLUGINS.find(item => item.id === id);
  if (!builtin) {
    keys(entry, ['enabled', 'kind', 'protocolVersion', 'command'], id);
    if (entry.kind !== 'worker' || entry.protocolVersion !== 1) throw new Error(`Unknown enabled plugin ${id}; register kind worker with protocolVersion 1`);
    argv(entry.command, `${id}.command`); return 'worker';
  }
  if (builtin.kind === 'native-backend') {
    keys(entry, ['enabled', 'executable', 'args', 'options', 'queryOptions', 'targets', 'fileLabels', 'timeoutMs'], id);
    if (entry.executable !== undefined && (typeof entry.executable !== 'string' || !entry.executable || entry.executable.startsWith('-'))) throw new Error(`${id}.executable must be a program path`);
    for (const key of ['args', 'options', 'queryOptions']) if (entry[key] !== undefined) argv(entry[key], `${id}.${key}`, { empty: true });
    if (entry.timeoutMs !== undefined) integer(entry.timeoutMs, `${id}.timeoutMs`, 100, 120000);
    if (id !== 'bazel' && ['queryOptions', 'targets', 'fileLabels'].some(key => entry[key] !== undefined)) throw new Error(`${id} does not support Bazel label settings`);
    if (entry.targets !== undefined && (!Array.isArray(entry.targets) || !entry.targets.length || entry.targets.some(label => label !== '//...' && !/^\/\/[A-Za-z0-9_./-]*:[A-Za-z0-9_.*+-]+$/.test(label)))) throw new Error('Bazel targets must be explicit labels or //...');
    if (entry.fileLabels !== undefined && (!object(entry.fileLabels) || Object.entries(entry.fileLabels).some(([file, labels]) => !file || file.startsWith('/') || file.includes('\\') || file.split('/').includes('..') || !Array.isArray(labels) || !labels.length || labels.some(label => !/^\/\/[A-Za-z0-9_./-]*:[A-Za-z0-9_.*+-]+$/.test(label))))) throw new Error('Bazel fileLabels must map project paths to explicit labels');
  } else if (id === 'ruvector') {
    keys(entry, ['enabled', 'dimensions', 'embedding', 'timeoutMs'], id);
    if (entry.dimensions !== undefined) integer(entry.dimensions, 'ruvector.dimensions', 16, 2048);
    if (entry.timeoutMs !== undefined) integer(entry.timeoutMs, 'ruvector.timeoutMs', 100, 60000);
    if (entry.embedding !== undefined) {
      if (!object(entry.embedding) || !['feature-vectors', 'command'].includes(entry.embedding.mode)) throw new Error('ruvector.embedding requires feature-vectors or command mode');
      keys(entry.embedding, ['mode', 'argv', 'identity'], 'ruvector.embedding');
      if (entry.embedding.mode === 'command') {
        argv(entry.embedding.argv, 'ruvector.embedding.argv');
        if (entry.embedding.argv.length > 32) throw new Error('RuVector embedding command is limited to 32 arguments');
        if (typeof entry.embedding.identity !== 'string' || !entry.embedding.identity.trim() || entry.embedding.identity.length > 128) throw new Error('RuVector embedding command identity must be a bounded nonempty string');
      } else if (entry.embedding.argv !== undefined || entry.embedding.identity !== undefined) throw new Error('Feature-vector retrieval does not execute or identify an embedding command');
    }
  } else if (id === 'agentic-qe') {
    keys(entry, ['enabled', 'command', 'framework', 'timeoutMs', 'envNames'], id);
    if (entry.command !== undefined) argv(entry.command, `${id}.command`);
    if (entry.framework !== undefined && !['vitest', 'jest', 'mocha', 'pytest', 'node'].includes(entry.framework)) throw new Error('Unsupported Agentic QE framework');
    if (entry.timeoutMs !== undefined) integer(entry.timeoutMs, 'agentic-qe.timeoutMs', 100, 120000);
    const providerNames = ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GOOGLE_AI_API_KEY', 'GEMINI_API_KEY', 'GOOGLE_API_KEY', 'OPENROUTER_API_KEY'];
    if (entry.envNames !== undefined && (!Array.isArray(entry.envNames) || entry.envNames.length > providerNames.length || new Set(entry.envNames).size !== entry.envNames.length || entry.envNames.some(name => !providerNames.includes(name)))) throw new Error('AQE envNames must be unique allowed provider variable names; never store values');
  } else {
    keys(entry, ['enabled', 'command'], id); if (entry.command !== undefined) argv(entry.command, `${id}.command`);
  }
  return builtin.kind;
}
export function resolvePluginConfig(raw = {}) {
  if (!object(raw)) throw new Error('Project configuration must be an object');
  const resolved = { ...raw };
  if (raw.plugins === undefined) {
    if (raw.executionPlugin !== undefined) throw new Error('executionPlugin must name an enabled native backend plugin');
    return resolved;
  }
  if (!object(raw.plugins) || Object.keys(raw.plugins).length > 32) throw new Error('plugins must map at most 32 plugin ids to settings');
  if (JSON.stringify(raw.plugins).length > 131072) throw new Error('Plugin configuration is too large');
  const backends = []; const workers = [];
  for (const [id, entry] of Object.entries(raw.plugins)) {
    validatePluginId(id); boundedValue(entry);
    if (!object(entry)) throw new Error(`${id} plugin settings must be an object`);
    if (entry.enabled !== undefined && typeof entry.enabled !== 'boolean') throw new Error(`${id}.enabled must be boolean`);
    if (entry.enabled !== true) continue; // Disabled/unknown settings never become executable configuration.
    const kind = validateEnabled(id, entry);
    if (kind === 'native-backend') backends.push([id, entry]);
    if (kind === 'worker') workers.push([id, entry]);
  }
  if (workers.length > 1) throw new Error('Enable at most one protocol worker per project');
  if (raw.executionPlugin !== undefined && !backends.some(([id]) => id === raw.executionPlugin)) throw new Error('executionPlugin must name an enabled native backend plugin');
  const selected = raw.executionPlugin || backends.find(([id]) => id === raw.integration?.type)?.[0] || (backends.length === 1 ? backends[0][0] : undefined);
  if (backends.length > 1 && !selected) throw new Error('Multiple native backends are enabled; choose executionPlugin explicitly');
  if (selected) {
    const [id, { enabled, ...settings }] = backends.find(([id]) => id === selected); const legacy = raw.integration;
    if (legacy !== undefined && (!object(legacy) || legacy.type !== id || Object.keys(settings).some(key => legacy[key] !== undefined && canonical(legacy[key]) !== canonical(settings[key])))) throw new Error('Enabled plugin conflicts with legacy integration configuration');
    resolved.integration = { ...(legacy || {}), ...settings, type: id };
  }
  if (workers.length) {
    const [id, entry] = workers[0];
    if (raw.agent !== undefined && canonical(raw.agent) !== canonical(entry.command)) throw new Error(`Enabled worker ${id} conflicts with explicit agent configuration`);
    resolved.agent = [...entry.command];
  }
  return resolved;
}
