import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fixture, write } from './helpers.js';
import { recommendPlugins } from '../src/plugin-recommendations.js';
import { configurePluginsAutomatically } from '../src/plugins.js';
import { digest } from '../src/provenance.js';

const sha = value => createHash('sha256').update(value).digest('hex');
function installed(root, name, bin) {
  write(root, `node_modules/${name}/package.json`, { name, version: '1.0.0', main: 'index.js' });
  write(root, `node_modules/${name}/index.js`, 'throw new Error("Package must never be imported by recommendations");');
  if (bin) {
    const executable = `node_modules/${name}/bin/tool.js`;
    write(root, executable, '#!/usr/bin/env node\nrequire("node:fs").writeFileSync("EXECUTED_FORBIDDEN", "yes");');
    fs.chmodSync(path.join(root, executable), 0o755);
    fs.mkdirSync(path.join(root, 'node_modules/.bin'), { recursive: true });
    fs.symlinkSync(path.relative(path.join(root, 'node_modules/.bin'), path.join(root, executable)), path.join(root, 'node_modules/.bin', bin));
  }
}
function memory(root) {
  // Intact protocol-fixture historical episode; ingestion authenticity is tested by learning.test.js.
  const manifestHash = digest('fixture');
  const payload = { schemaVersion: 1, id: digest({ manifestHash, outcome: 'accepted' }), candidateId: 'fixture', createdAt: '2026-09-01T00:00:00.000Z', manifestHash, validationHash: digest('validation'), provenance: Object.fromEntries(['fingerprint','runner','servicesHash','sourceHash'].map(key => [key, digest(key)])), framework: 'node', outcome: 'accepted', tags: ['boundary'], warnings: [], context: { language: 'javascript', changedTests: 1, deletedFiles: 0, purpose: 'candidate-tests' }, evidence: { originalCases: 1, candidateCases: 2, passedCases: 2, failedCases: 0, missingCases: 0, demonstratedDefects: 0, caughtDefects: 0, complete: true }, patterns: [] };
  const value = { schemaVersion: 1, records: [{ ...payload, integrity: digest(payload) }] };
  write(root, '.tddswarm/learning/index.json', { ...value, integrity: digest(value) });
}
const recommendation = (report, id) => report.recommendations.find(item => item.id === id);

test('ordinary Node/Jest/Vitest projects reuse core and never invoke package scripts or installed bins', t => {
  const root = fixture(t, { 'package.json': { name: 'sample', devDependencies: { vitest: '1' }, scripts: { postinstall: 'touch EXECUTED_FORBIDDEN', test: 'touch EXECUTED_FORBIDDEN' } } });
  installed(root, 'agentic-qe', 'aqe');
  const report = recommendPlugins(root);
  assert.equal(report.execution.selected, 'core'); assert.equal(report.execution.needsChoice, false);
  assert.deepEqual(report.applicable, []); assert.equal(recommendation(report, 'agentic-qe').ready, true);
  assert.ok(recommendation(report, 'agentic-qe').reasons.some(reason => reason.includes('never persists automatic')));
  assert.equal(fs.existsSync(path.join(root, 'EXECUTED_FORBIDDEN')), false);
  assert.deepEqual(recommendPlugins(root), report);
});

test('unique ready Nx evidence selects local execution; absence stays missing without installation', t => {
  const root = fixture(t, { 'package.json': { name: 'sample', devDependencies: { nx: '1' } }, 'nx.json': {} });
  const missing = recommendPlugins(root);
  assert.equal(recommendation(missing, 'nx').status, 'missing'); assert.deepEqual(missing.applicable, []);
  installed(root, 'nx', 'nx'); const report = recommendPlugins(root);
  assert.equal(report.execution.selected, 'nx'); assert.deepEqual(report.applicable, [{ id: 'nx', select: true }]);
  assert.equal(recommendation(report, 'nx').status, 'recommended'); assert.ok(recommendation(report, 'nx').evidence.includes('nx.json'));
  assert.notEqual(report.fingerprint, missing.fingerprint); assert.equal(fs.existsSync(path.join(root, 'EXECUTED_FORBIDDEN')), false);
});

test('Nx plus Bazel evidence requires a choice even when only one is installed', t => {
  const root = fixture(t, { 'package.json': { name: 'sample', dependencies: { nx: '1' } }, 'nx.json': {}, 'MODULE.bazel': 'module(name="sample")' });
  installed(root, 'nx', 'nx');
  const report = recommendPlugins(root);
  assert.equal(report.execution.needsChoice, true); assert.equal(report.execution.selected, 'core');
  assert.deepEqual(report.execution.candidates, ['nx','bazel']); assert.deepEqual(report.applicable, []);
});

test('manual disabled entries, explicit runner, legacy integration, and selected backend remain intact', t => {
  const base = { 'package.json': { name: 'sample', devDependencies: { nx: '1', c8: '1' } }, 'nx.json': {} };
  for (const config of [{ runner: ['node','--test','{files}'], plugins: { c8: { enabled: false }, nx: { enabled: false } } }, { integration: { type: 'nx', options: ['manual'] }, plugins: { c8: { enabled: false } } }, { executionPlugin: 'nx', plugins: { nx: { enabled: true }, c8: { enabled: false } } }]) {
    const root = fixture(t, { ...base, 'tddswarm.config.json': config }); installed(root, 'nx', 'nx'); installed(root, 'c8', 'c8');
    const original = fs.readFileSync(path.join(root, 'tddswarm.config.json')), report = recommendPlugins(root);
    assert.equal(report.configHash, sha(original)); assert.deepEqual(report.applicable, []);
    assert.equal(recommendation(report, 'c8').status, 'retained'); assert.equal(report.execution.selected, config.runner ? 'core' : 'nx');
    assert.deepEqual(fs.readFileSync(path.join(root, 'tddswarm.config.json')), original);
  }
});

test('coverage and mutation require matching declared dependencies and safe installed bins', t => {
  const root = fixture(t, { 'package.json': { name: 'sample', devDependencies: { c8: '1', '@stryker-mutator/core': '1' } } });
  installed(root, 'c8', 'c8'); installed(root, '@stryker-mutator/core', 'stryker');
  const report = recommendPlugins(root); assert.deepEqual(report.applicable, [{ id: 'c8' }, { id: 'stryker' }]);
  write(root, 'package.json', { name: 'sample' });
  assert.deepEqual(recommendPlugins(root).applicable, []); assert.equal(recommendation(recommendPlugins(root), 'c8').status, 'available');
  assert.equal(fs.existsSync(path.join(root, 'EXECUTED_FORBIDDEN')), false);
});

test('ready complementary add-ons compose while the explicit execution profile and generation stay intact', t => {
  const root=fixture(t,{'package.json':{name:'sample',devDependencies:{nx:'1',c8:'1','@stryker-mutator/core':'1'}},'nx.json':{},'tddswarm.config.json':{adapter:'node',runner:['node','--test','{files}'],executionMode:'shadow'}});
  for(const [name,bin] of [['nx','nx'],['c8','c8'],['@stryker-mutator/core','stryker'],['agentic-qe','aqe'],['@ruvector/core']])installed(root,name,bin);
  memory(root);
  const recommendation= recommendPlugins(root),result=configurePluginsAutomatically(root,recommendation),config=JSON.parse(fs.readFileSync(path.join(root,'tddswarm.config.json')));
  assert.deepEqual(result.applied,['c8','stryker','ruvector']);assert.equal(result.execution.selected,'core');
  assert.equal(config.executionMode,'shadow');assert.equal(config.adapter,'node');assert.deepEqual(config.runner,['node','--test','{files}']);
  assert.equal(config.plugins.nx,undefined);assert.equal(config.plugins['agentic-qe'],undefined);
  for(const id of result.applied)assert.deepEqual(config.plugins[id],{enabled:true});
  assert.deepEqual(result.decisions.filter(item=>item.action==='enable').map(item=>item.id),result.applied);
  assert.ok(result.decisions.find(item=>item.id==='nx').reasons.some(reason=>reason.includes('preserves the existing execution profile')));
  assert.equal(fs.existsSync(path.join(root,'EXECUTED_FORBIDDEN')),false);
  const repeated=configurePluginsAutomatically(root,recommendPlugins(root));assert.deepEqual(repeated.applied,[]);assert.equal(repeated.changed,false);
  assert.ok(repeated.decisions.filter(item=>result.applied.includes(item.id)).every(item=>item.action==='retain'));
});

test('explicit disabled add-ons stay disabled while unrelated installed capabilities can be enabled', t => {
  const root=fixture(t,{'package.json':{name:'sample',devDependencies:{c8:'1','@stryker-mutator/core':'1'}},'tddswarm.config.json':{adapter:'node',executionMode:'shadow',plugins:{c8:{enabled:false},ruvector:{enabled:false}}}});
  installed(root,'c8','c8');installed(root,'@stryker-mutator/core','stryker');installed(root,'@ruvector/core');memory(root);
  const result=configurePluginsAutomatically(root,recommendPlugins(root)),config=JSON.parse(fs.readFileSync(path.join(root,'tddswarm.config.json')));
  assert.deepEqual(result.applied,['stryker']);assert.deepEqual(config.plugins.c8,{enabled:false});assert.deepEqual(config.plugins.ruvector,{enabled:false});
  assert.equal(result.decisions.find(item=>item.id==='c8').action,'retain');assert.equal(result.decisions.find(item=>item.id==='ruvector').action,'retain');
  assert.equal(fs.existsSync(path.join(root,'EXECUTED_FORBIDDEN')),false);
});

test('automatic complementary activation retains the explicitly selected native backend and its settings', t => {
  const native={enabled:true,options:['manual-target']},root=fixture(t,{'package.json':{name:'native-profile',devDependencies:{c8:'1','@stryker-mutator/core':'1',nx:'1'}},'nx.json':{},'MODULE.bazel':'module(name="sample")','tddswarm.config.json':{executionMode:'shadow',executionPlugin:'nx',plugins:{nx:native}}});
  for(const [name,bin] of [['nx','nx'],['c8','c8'],['@stryker-mutator/core','stryker']])installed(root,name,bin);
  write(root,'tools/bazel','#!/bin/sh\nexit 99');fs.chmodSync(path.join(root,'tools/bazel'),0o755);
  const result=configurePluginsAutomatically(root,recommendPlugins(root)),config=JSON.parse(fs.readFileSync(path.join(root,'tddswarm.config.json')));
  assert.deepEqual(result.applied,['c8','stryker']);assert.equal(result.execution.selected,'nx');assert.equal(result.execution.needsChoice,false);
  assert.equal(config.executionPlugin,'nx');assert.deepEqual(config.plugins.nx,native);assert.equal(config.plugins.bazel,undefined);assert.equal(config.executionMode,'shadow');
  assert.equal(result.decisions.find(item=>item.id==='nx').action,'retain');assert.equal(result.decisions.find(item=>item.id==='bazel').action,'skip');assert.equal(fs.existsSync(path.join(root,'EXECUTED_FORBIDDEN')),false);
});

test('RuVector requires intact nonempty local learning and preserves disabled learning', t => {
  const root = fixture(t, { 'package.json': { name: 'sample' } }); installed(root, '@ruvector/core');
  assert.deepEqual(recommendPlugins(root).applicable, []);
  memory(root); assert.deepEqual(recommendPlugins(root).applicable, [{ id: 'ruvector' }]);
  write(root, 'tddswarm.config.json', { learning: { enabled: false } });
  assert.deepEqual(recommendPlugins(root).applicable, []);
  write(root, 'tddswarm.config.json', {}); write(root, '.tddswarm/learning/index.json', '{"integrity":"fake"}');
  assert.deepEqual(recommendPlugins(root).applicable, []);
});

test('all enabled builtin entries and custom worker remain retained without competing generation', t => {
  const plugins = Object.fromEntries(['nx','bazel','pytest-testmon','agentic-qe','c8','stryker','ruvector'].map(id => [id, { enabled: true }]));
  plugins['my-worker'] = { enabled: true, kind: 'worker', protocolVersion: 1, command: ['manual-worker'] };
  const root = fixture(t, { 'package.json': { name: 'sample' }, 'tddswarm.config.json': { executionPlugin: 'bazel', plugins, agent: ['manual-worker'] }, 'nx.json': {}, 'MODULE.bazel': 'module(name="sample")' });
  const report = recommendPlugins(root);
  assert.equal(report.execution.selected, 'bazel'); assert.equal(report.execution.needsChoice, false);
  assert.deepEqual(report.applicable, []); assert.equal(report.recommendations.filter(item => item.id !== 'core').every(item => item.status === 'retained'), true);
});

test('local pytest extension metadata selects testmon; Bazelisk is never treated as ready native Bazel', t => {
  const root = fixture(t, { 'pyproject.toml': '[project]\nname="sample"\ndependencies=["pytest", "pytest-testmon"]', '.venv/bin/pytest': '#!/bin/sh\nexit 99', '.venv/lib/python3.11/site-packages/pytest_testmon-2.1.0.dist-info/METADATA': 'Name: pytest-testmon\nVersion: 2.1.0\n' });
  fs.chmodSync(path.join(root, '.venv/bin/pytest'), 0o755);
  const report = recommendPlugins(root);
  assert.deepEqual(report.applicable, [{ id: 'pytest-testmon', settings: { executable: '.venv/bin/pytest' }, select: true }]);
  const bazel = fixture(t, { 'MODULE.bazel': 'module(name="sample")' }); installed(bazel, '@bazel/bazelisk', 'bazel');
  const other = recommendPlugins(bazel); assert.equal(recommendation(other, 'bazel').ready, false); assert.deepEqual(other.applicable, []);
});

test('unsafe symlinks, malformed and oversized manifests block automatic plans without touching outside files', t => {
  for (const content of ['null', '[]', '{bad', ' '.repeat(256 * 1024 + 1)]) {
    const root = fixture(t, { 'tddswarm.config.json': content, 'nx.json': {} }); installed(root, 'nx', 'nx');
    const report = recommendPlugins(root); assert.equal(report.blocked, true); assert.deepEqual(report.applicable, []);
  }
  const outside = fixture(t, { 'nx.json': {} }), root = fixture(t, { 'package.json': { name: 'sample', dependencies: { nx: '1' } } }); installed(root, 'nx', 'nx');
  fs.symlinkSync(path.join(outside, 'nx.json'), path.join(root, 'nx.json'));
  const report = recommendPlugins(root); assert.equal(report.blocked, true); assert.deepEqual(report.applicable, []);
  assert.equal(fs.readFileSync(path.join(outside, 'nx.json'), 'utf8'), '{}');
});

test('external executable symlinks cannot satisfy local readiness; fingerprints bind changed availability', t => {
  const root = fixture(t, { 'package.json': { name: 'sample', dependencies: { c8: '1' } } }); installed(root, 'c8', 'c8');
  const before = recommendPlugins(root); const target = path.join(root, 'node_modules/.bin/c8'); fs.unlinkSync(target);
  const outside = fixture(t, { tool: '#!/bin/sh\nexit 0' }); fs.chmodSync(path.join(outside, 'tool'), 0o755); fs.symlinkSync(path.join(outside, 'tool'), target);
  const after = recommendPlugins(root); assert.deepEqual(after.applicable, []); assert.notEqual(before.fingerprint, after.fingerprint);
  assert.equal(recommendation(after, 'c8').installed, false);
});
