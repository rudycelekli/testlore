import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolvePluginConfig, validatePluginId } from '../src/plugin-config.js';
import { pluginCatalog, configurePlugin, checkPlugins } from '../src/plugins.js';
import { readConfig } from '../src/files.js';

function fixture(t, config = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'testlore-plugin-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'tddswarm.config.json'), JSON.stringify(config));
  return root;
}
const readRaw = root => JSON.parse(fs.readFileSync(path.join(root, 'tddswarm.config.json'), 'utf8'));
function fakeCommand(root, output, { writeMarker = false } = {}) {
  const file = path.join(root, 'tool.cjs');
  fs.writeFileSync(file, `${writeMarker ? `require('node:fs').writeFileSync(${JSON.stringify(path.join(root, 'spawned'))}, 'yes');` : ''}console.log(${JSON.stringify(output)});`);
  return [process.execPath, file];
}

test('enabled native plugin resolves existing integration without mutating raw configuration', t => {
  const raw = { env: { STAGE: 'test' }, plugins: { nx: { enabled: true, options: ['--skipNxCache'] } } };
  const before = JSON.stringify(raw); const resolved = resolvePluginConfig(raw);
  assert.deepEqual(resolved.integration, { type: 'nx', options: ['--skipNxCache'] });
  assert.equal(JSON.stringify(raw), before); assert.equal(raw.integration, undefined);
  assert.deepEqual(readConfig(fixture(t, raw)), resolved);
  assert.deepEqual(resolvePluginConfig({ plugins: { nx: { options: ['--skipNxCache'] } } }).integration, undefined);
});
test('disabled unknown and malformed executable settings remain inert in catalog and checks', t => {
  const root = fixture(t, { plugins: { 'not-installed': { enabled: false, command: 'invalid', kind: 'future' }, nx: { enabled: false, executable: [] } } });
  const catalog = pluginCatalog(root); assert.equal(catalog.plugins.length, 8);
  assert.ok(catalog.plugins.every(plugin => plugin.measured === false && plugin.availability === 'unchecked'));
  const check = checkPlugins(root); assert.equal(check.exitCode, 0);
  assert.ok(check.plugins.every(plugin => plugin.probe === 'skipped-disabled'));
  assert.equal(readConfig(root).integration, undefined);
});
test('catalog and configuration never execute enabled commands or turn AQE into a worker', t => {
  const root = fixture(t); const command = fakeCommand(root, 'should not execute', { writeMarker: true });
  configurePlugin(root, 'agentic-qe', { enabled: true, settings: { command } });
  configurePlugin(root, 'c8', { enabled: true, settings: { command } });
  const catalog = pluginCatalog(root); assert.equal(catalog.plugins.find(plugin => plugin.id === 'agentic-qe').enabled, true);
  assert.equal(fs.existsSync(path.join(root, 'spawned')), false); assert.equal(readConfig(root).agent, undefined);
  assert.ok(catalog.plugins.find(plugin => plugin.id === 'c8').capabilities.includes('existing-coverage-report-import'));
  configurePlugin(root, 'agentic-qe', { enabled: true, settings: { framework: 'node', timeoutMs: 10000, envNames: ['OPENAI_API_KEY'] } });
  assert.deepEqual(readConfig(root).plugins['agentic-qe'].envNames, ['OPENAI_API_KEY']);
  assert.throws(() => configurePlugin(root, 'agentic-qe', { enabled: true, settings: { envNames: ['HOME'] } }), /allowed provider variable names/);
  assert.throws(() => configurePlugin(root, 'agentic-qe', { enabled: true, settings: { envNames: ['OPENAI_API_KEY', 'OPENAI_API_KEY'] } }), /allowed provider variable names/);
  assert.throws(() => configurePlugin(root, 'agentic-qe', { enabled: true, settings: { env: { OPENAI_API_KEY: 'never-store' } } }), /Unsupported agentic-qe/);
  assert.equal(JSON.stringify(pluginCatalog(root)).includes('never-store'), false);
});
test('native backend and legacy conflicts are rejected before configuration changes', t => {
  const root = fixture(t, { runner: [process.execPath, '--test', '{files}'], integration: { type: 'nx', options: ['--skipNxCache'] }, custom: { preserved: true } });
  const original = fs.readFileSync(path.join(root, 'tddswarm.config.json'), 'utf8');
  assert.throws(() => configurePlugin(root, 'bazel', { enabled: true }), /conflicts with legacy/);
  assert.throws(() => configurePlugin(root, 'nx', { enabled: true, settings: { options: ['--different'] } }), /conflicts with legacy/);
  assert.equal(fs.readFileSync(path.join(root, 'tddswarm.config.json'), 'utf8'), original);
  configurePlugin(root, 'nx', { enabled: true, settings: { options: ['--skipNxCache'] } });
  assert.deepEqual(readRaw(root).integration, { type: 'nx', options: ['--skipNxCache'] });
  assert.deepEqual(readRaw(root).custom, { preserved: true });
  configurePlugin(root, 'pytest-testmon', { enabled: true });
  assert.equal(readRaw(root).executionPlugin, 'nx');
  assert.equal(readConfig(root).integration.type, 'nx');
  const committed = fs.readFileSync(path.join(root, 'tddswarm.config.json'), 'utf8');
  assert.throws(() => configurePlugin(root, 'pytest-testmon', { enabled: true, select: true }), /conflicts with legacy/);
  assert.equal(fs.readFileSync(path.join(root, 'tddswarm.config.json'), 'utf8'), committed);
  configurePlugin(root, 'pytest-testmon', { enabled: false });
  configurePlugin(root, 'nx', { enabled: false });
  assert.deepEqual(readConfig(root).integration, readRaw(root).integration); // Legacy intent remains intact.
  assert.equal(fs.readdirSync(root).filter(file => file.endsWith('.tmp')).length, 0);
});
test('custom workers require explicit protocol version and reject ambiguous agent authorities', t => {
  const command = [process.execPath, 'worker.cjs'];
  const raw = { plugins: { 'my-worker': { enabled: true, kind: 'worker', protocolVersion: 1, command } } };
  assert.deepEqual(resolvePluginConfig(raw).agent, command);
  assert.equal(raw.agent, undefined);
  assert.deepEqual(resolvePluginConfig({ ...raw, agent: command }).agent, command);
  assert.throws(() => resolvePluginConfig({ ...raw, agent: ['different'] }), /conflicts with explicit agent/);
  assert.throws(() => resolvePluginConfig({ plugins: { 'my-worker': { enabled: true, kind: 'worker', protocolVersion: 2, command } } }), /protocolVersion 1/);
  assert.throws(() => resolvePluginConfig({ plugins: { 'my-worker': raw.plugins['my-worker'], 'other-worker': raw.plugins['my-worker'] } }), /at most one protocol worker/);
  assert.throws(() => resolvePluginConfig({ plugins: { 'unknown-tool': { enabled: true } } }), /Unknown enabled plugin/);
  const root = fixture(t, raw); const checked = checkPlugins(root, { id: 'my-worker' });
  assert.equal(checked.exitCode, 0); assert.equal(checked.plugins[0].protocolVerified, false);
  assert.equal(checked.plugins[0].probe, 'executable-presence');
});
test('all builtins can be available while one explicit backend owns execution', t => {
  const root = fixture(t);
  for (const id of ['nx', 'bazel', 'pytest-testmon', 'agentic-qe', 'c8', 'stryker', 'ruvector']) configurePlugin(root, id, { enabled: true });
  const raw = readRaw(root); assert.equal(raw.executionPlugin, 'nx');
  assert.equal(raw.integration, undefined); // Configuration persists opt-ins, not derived adapter settings.
  assert.equal(readConfig(root).integration.type, 'nx');
  const catalog = pluginCatalog(root); assert.ok(catalog.plugins.every(plugin => plugin.enabled));
  assert.deepEqual(catalog.plugins.filter(plugin => plugin.selected).map(plugin => plugin.id), ['nx']);
  configurePlugin(root, 'bazel', { enabled: true, select: true }); assert.equal(readConfig(root).integration.type, 'bazel');
  const before = fs.readFileSync(path.join(root, 'tddswarm.config.json'), 'utf8');
  assert.throws(() => configurePlugin(root, 'bazel', { enabled: false }), /Select another executionPlugin/);
  assert.equal(fs.readFileSync(path.join(root, 'tddswarm.config.json'), 'utf8'), before);
  configurePlugin(root, 'nx', { enabled: false }); // Nonselected backend becomes unavailable without affecting execution.
  configurePlugin(root, 'bazel', { enabled: false }); // One alternative remains, so resolution is unambiguous.
  assert.equal(readRaw(root).executionPlugin, undefined); assert.equal(readConfig(root).integration.type, 'pytest-testmon');
  configurePlugin(root, 'pytest-testmon', { enabled: false }); assert.equal(readConfig(root).integration, undefined);
  assert.throws(() => resolvePluginConfig({ plugins: { nx: { enabled: true }, bazel: { enabled: true } } }), /choose executionPlugin/);
  assert.throws(() => resolvePluginConfig({ executionPlugin: 'nx' }), /enabled native backend/);
  assert.throws(() => resolvePluginConfig({ plugins: { nx: { enabled: false } }, executionPlugin: 'nx' }), /enabled native backend/);
  assert.throws(() => configurePlugin(root, 'c8', { enabled: true, select: true }), /select requires/);
});
test('configuration rejects path traversal, unsafe settings and invalid legacy fields without writes', t => {
  const root = fixture(t, { runner: 'not-an-argv' }); const before = fs.readFileSync(path.join(root, 'tddswarm.config.json'), 'utf8');
  assert.throws(() => configurePlugin(root, 'nx', { enabled: true }), /runner must/);
  assert.equal(fs.readFileSync(path.join(root, 'tddswarm.config.json'), 'utf8'), before);
  for (const id of ['../outside', '/tmp/plugin', 'a/b', '__proto__', 'constructor', 'A', 'a'.repeat(65)]) assert.throws(() => validatePluginId(id));
  assert.throws(() => resolvePluginConfig({ plugins: { nx: { enabled: 'yes' } } }), /enabled must/);
  assert.throws(() => resolvePluginConfig({ plugins: { nx: { enabled: true, options: ['a\0b'] } } }), /invalid string/);
  assert.throws(() => resolvePluginConfig({ plugins: { bazel: { enabled: true, fileLabels: { '../outside': ['//:test'] } } } }), /fileLabels/);
  assert.throws(() => resolvePluginConfig({ plugins: Object.fromEntries(Array.from({ length: 33 }, (_, index) => [`p${index}`, { enabled: false }])) }), /at most 32/);
  const other = fixture(t); fs.unlinkSync(path.join(other, 'tddswarm.config.json')); fs.symlinkSync(path.join(root, 'tddswarm.config.json'), path.join(other, 'tddswarm.config.json'));
  assert.throws(() => configurePlugin(other, 'nx', { enabled: true }), /Symlink path/);
  assert.equal(fs.readFileSync(path.join(root, 'tddswarm.config.json'), 'utf8'), before);
});
test('disabling an unsupported enabled plugin preserves its settings and repairs opt-in resolution', t => {
  const root = fixture(t, { keep: 42, plugins: { future: { enabled: true, unknown: 'preserve' } } });
  assert.throws(() => readConfig(root), /Unknown enabled plugin|Unsupported future plugin setting/);
  configurePlugin(root, 'future', { enabled: false });
  assert.deepEqual(readRaw(root), { keep: 42, plugins: { future: { enabled: false, unknown: 'preserve' } } });
});
test('explicit availability checks bound AQE help contract and do not certify quality', t => {
  const root = fixture(t); const command = fakeCommand(root, 'generate --framework --format --output', { writeMarker: true });
  configurePlugin(root, 'agentic-qe', { enabled: true, settings: { command } });
  const good = checkPlugins(root, { id: 'agentic-qe' }); assert.equal(good.exitCode, 0);
  assert.equal(good.plugins[0].generationContract, true); assert.deepEqual(good.plugins[0].workerRoles, []); assert.equal(good.plugins[0].measured, false);
  assert.equal(fs.existsSync(path.join(root, 'spawned')), true);
  fs.writeFileSync(command[1], 'console.log("old incompatible tool");');
  const incompatible = checkPlugins(root, { id: 'agentic-qe' }); assert.equal(incompatible.exitCode, 2); assert.equal(incompatible.plugins[0].installed, true); assert.equal(incompatible.plugins[0].available, false);
  configurePlugin(root, 'nx', { enabled: true, settings: { executable: '/testlore-missing-tool' } });
  assert.equal(checkPlugins(root, { id: 'nx' }).exitCode, 2);
  assert.throws(() => checkPlugins(root, { id: 'unregistered' }), /Unknown plugin/);
});
test('version probes omit provider keys and distinguish installed tools from tested integrations', t => {
  const root = fixture(t); const file = path.join(root, 'version.cjs');
  fs.writeFileSync(file, 'console.log(JSON.stringify({argv:process.argv.slice(2),key:process.env.TESTLORE_PLUGIN_PROVIDER_KEY,openai:process.env.OPENAI_API_KEY}));');
  configurePlugin(root, 'pytest-testmon', { enabled: true, settings: { executable: process.execPath, args: [file] } });
  const previous = process.env.TESTLORE_PLUGIN_PROVIDER_KEY; process.env.TESTLORE_PLUGIN_PROVIDER_KEY = 'must-not-reach-child';
  t.after(() => { if (previous === undefined) delete process.env.TESTLORE_PLUGIN_PROVIDER_KEY; else process.env.TESTLORE_PLUGIN_PROVIDER_KEY = previous; });
  const result = checkPlugins(root, { id: 'pytest-testmon' }); const plugin = result.plugins[0];
  assert.equal(result.exitCode, 0); assert.equal(plugin.integrationVerified, false); assert.equal(plugin.measured, false);
  assert.deepEqual(JSON.parse(plugin.stdout), { argv: ['--version'] });
  assert.match(plugin.limitation, /does not verify the testmon extension/);
});
test('RuVector configuration is optional and SDK checks resolve without loading package code', t => {
  const root = fixture(t); configurePlugin(root, 'ruvector', { enabled: true, settings: { dimensions: 128, timeoutMs: 10000, embedding: { mode: 'feature-vectors' } } });
  assert.equal(checkPlugins(root, { id: 'ruvector' }).exitCode, 2);
  const directory = path.join(root, 'node_modules/@ruvector/core'); fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, 'package.json'), '{"name":"@ruvector/core","main":"index.js"}');
  fs.writeFileSync(path.join(directory, 'index.js'), 'throw new Error("Package must never execute during availability check");');
  const checked = checkPlugins(root, { id: 'ruvector' }); assert.equal(checked.exitCode, 0);
  assert.equal(checked.plugins[0].probe, 'project-sdk-resolution'); assert.equal(checked.plugins[0].measured, false);
  const nested = path.join(root, 'nested'); fs.mkdirSync(nested);
  fs.writeFileSync(path.join(nested, 'tddswarm.config.json'), '{"plugins":{"ruvector":{"enabled":true}}}');
  assert.equal(checkPlugins(nested, { id: 'ruvector' }).exitCode, 2); // An inherited SDK is not silently a project installation.
  configurePlugin(root, 'ruvector', { enabled: true, settings: { embedding: { mode: 'command', argv: ['/missing-embedding-worker'], identity: 'pinned-test-v1' } } });
  assert.equal(checkPlugins(root, { id: 'ruvector' }).exitCode, 0); // SDK presence only; never executes the embedding command.
  for (const settings of [{ dimensions: 15 }, { dimensions: 2049 }, { timeoutMs: 60001 }, { embedding: { mode: 'command', argv: ['local-model'] } }, { embedding: { mode: 'command', argv: Array(33).fill('arg'), identity: 'v1' } }]) assert.throws(() => configurePlugin(root, 'ruvector', { enabled: true, settings }));
});
test('health probes kill SIGTERM-resistant tools at their timeout', t => {
  const root = fixture(t); const file = path.join(root, 'resistant.cjs');
  fs.writeFileSync(file, 'process.on("SIGTERM",()=>{}); setInterval(()=>{},1000);');
  configurePlugin(root, 'nx', { enabled: true, settings: { executable: process.execPath, args: [file], timeoutMs: 100 } });
  const start = Date.now(); const result = checkPlugins(root, { id: 'nx' });
  assert.equal(result.exitCode, 2); assert.equal(result.plugins[0].signal, 'SIGKILL'); assert.ok(Date.now() - start < 3000);
});
test('known installer wrappers are not invoked by offline version probes', t => {
  const root = fixture(t); const executable = path.join(root, 'bazelisk');
  fs.writeFileSync(executable, `#!/bin/sh\ntouch ${JSON.stringify(path.join(root, 'download-attempt'))}\n`); fs.chmodSync(executable, 0o755);
  configurePlugin(root, 'bazel', { enabled: true, settings: { executable } });
  const checked = checkPlugins(root, { id: 'bazel' }); assert.equal(checked.exitCode, 2);
  assert.equal(checked.plugins[0].probe, 'installer-wrapper-skipped'); assert.equal(fs.existsSync(path.join(root, 'download-attempt')), false);
});
