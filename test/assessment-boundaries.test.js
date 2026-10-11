import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fixture, write } from './helpers.js';
import { inspectAssessmentReport, importAssessments, parseAssessmentJSON } from '../src/assessments.js';
import { BUILTIN_PLUGINS } from '../src/plugin-config.js';
import { pluginCatalog, checkPlugins, configurePluginsAutomatically } from '../src/plugins.js';
import { recommendPlugins } from '../src/plugin-recommendations.js';

const native = name => JSON.parse(fs.readFileSync(new URL(`./fixtures/assessments/${name}`, import.meta.url), 'utf8'));
const guardana = () => native('guardana-clean-v17.json');
const noAuthority = { routingOmissions: false, candidateAcceptance: false, repairAcceptance: false, learningPromotion: false };

test('duplicate escaped JSON keys and prototype-shaped fields cannot overwrite evidence', () => {
  for (const text of [String.raw`{"a":1,"\u0061":2}`, '{"x":{"passed":false,"passed":true}}', '{"__proto__":{}}', '{"constructor":1}', '{"prototype":1}']) {
    assert.throws(() => parseAssessmentJSON(text), /Duplicate or unsafe/);
  }
});

test('ignored report branches remain subject to structural and byte limits', () => {
  for (const text of ['{"ignored":' + '['.repeat(26) + '0' + ']'.repeat(26) + '}', '{"ignored":[' + Array(4097).fill('0').join(',') + ']}', '{"ignored":"' + 'x'.repeat(4 * 1024 * 1024) + '"}']) {
    assert.throws(() => parseAssessmentJSON(text), /limit/);
  }
  for (const text of ['null', '[]', 'true', '{"a":', '{"a":true} false']) assert.throws(() => parseAssessmentJSON(text));
});

test('unsafe report paths and symlink ancestors are refused without exposing source bytes', t => {
  const outside = fixture(t, { 'private.json': guardana() });
  const root = fixture(t, { 'report.json': guardana() });
  fs.symlinkSync(path.join(outside, 'private.json'), path.join(root, 'linked.json'));
  fs.symlinkSync(outside, path.join(root, 'linked-directory'));
  for (const report of ['../private.json', path.join(outside, 'private.json'), 'linked.json', 'linked-directory/private.json']) {
    assert.throws(() => inspectAssessmentReport(root, { plugin: 'guardana', report }), /Unsafe|Symlink|escapes/);
  }
});

test('oversized, invalid UTF-8 and nonregular reports fail bounded inspection', t => {
  const root = fixture(t, { 'oversized.json': ' '.repeat(4 * 1024 * 1024 + 1) });
  fs.writeFileSync(path.join(root, 'invalid.json'), Buffer.from([0xff]));
  fs.mkdirSync(path.join(root, 'directory'));
  for (const report of ['oversized.json', 'invalid.json', 'directory']) assert.throws(() => inspectAssessmentReport(root, { plugin: 'guardana', report }));
  if (process.platform !== 'win32') {
    const fifo = path.join(root, 'fifo.json');
    const result = spawnSync('mkfifo', [fifo], { timeout: 2000 });
    assert.equal(result.status, 0);
    const started = Date.now();
    assert.throws(() => inspectAssessmentReport(root, { plugin: 'guardana', report: 'fifo.json' }), /regular file/);
    assert.ok(Date.now() - started < 1000);
  }
});

test('replacement during report read is rejected before normalization', t => {
  const root = fixture(t, { 'report.json': guardana() });
  const original = fs.readSync;
  let replaced = false;
  fs.readSync = function (...args) {
    const result = original.apply(this, args);
    if (!replaced) {
      replaced = true;
      fs.renameSync(path.join(root, 'report.json'), path.join(root, 'old.json'));
      write(root, 'report.json', guardana());
    }
    return result;
  };
  try { assert.throws(() => inspectAssessmentReport(root, { plugin: 'guardana', report: 'report.json' }), /changed during import/); }
  finally { fs.readSync = original; }
  assert.equal(replaced, true);
});

test('failed import records a sanitized error rather than invalid report body', t => {
  const root = fixture(t, { 'report.json': '{"SECRET_SENTINEL": invalid-secret-body}' });
  const result = importAssessments(root, { plugin: 'guardana', report: 'report.json' });
  assert.equal(result.exitCode, 2);
  assert.equal(result.assessments[0].error, 'invalid-or-unreadable-report');
  assert.equal(JSON.stringify(result).includes('SECRET_SENTINEL'), false);
  assert.equal(fs.readFileSync(path.join(root, result.receipt), 'utf8').includes('invalid-secret-body'), false);
});

test('historical clean reports never acquire current binding or native acceptance authority', t => {
  const root = fixture(t, { 'guardana.json': guardana() });
  const result = importAssessments(root, { plugin: 'guardana', report: 'guardana.json' });
  assert.equal(result.exitCode, 0);
  assert.equal(result.nativeVerificationExecuted, false);
  assert.equal(result.providerCalls, 0);
  assert.equal(result.assessments[0].currentBinding, 'unverified');
  assert.equal(result.assessments[0].advisory, true);
  assert.deepEqual(result.assessments[0].authority, noAuthority);
  assert.match(result.assessments[0].nextAction, /native validation/i);
});

test('assessment receipts cannot replace inputs or existing files and stay out of acceptance stores', t => {
  const existing = { 'guardana.json': guardana(), '.tddswarm/learning/index.json': 'UNCHANGED_LEARNING', '.tddswarm/evidence.json': 'UNCHANGED_NATIVE', 'existing.json': 'UNCHANGED_SOURCE' };
  const root = fixture(t, existing);
  const before = Object.fromEntries(Object.keys(existing).map(file => [file, fs.readFileSync(path.join(root, file), 'utf8')]));
  assert.throws(() => importAssessments(root, { plugin: 'guardana', report: 'guardana.json', output: 'guardana.json' }), /must not replace/);
  assert.throws(() => importAssessments(root, { plugin: 'guardana', report: 'guardana.json', output: 'existing.json' }), /EEXIST/);
  const result = importAssessments(root, { plugin: 'guardana', report: 'guardana.json' });
  assert.match(result.receipt, /^\.tddswarm\/assessments\/[^/]+\.json$/);
  for (const [file, content] of Object.entries(before)) assert.equal(fs.readFileSync(path.join(root, file), 'utf8'), content);
  if (process.platform !== 'win32') assert.equal(fs.statSync(path.join(root, result.receipt)).mode & 0o777, 0o600);
});

test('assessment health and automatic recommendations do not execute installed upstream sentinels', t => {
  const root = fixture(t, { 'guardana.json': guardana(), 'ifixai.json': native('ifixai-native.json'), 'tddswarm.config.json': { adapter: 'node', executionMode: 'shadow', plugins: { guardana: { enabled: true, report: 'guardana.json' }, ifixai: { enabled: true, report: 'ifixai.json' } } } });
  const bin = path.join(root, 'bin'); fs.mkdirSync(bin);
  for (const name of ['guardana', 'ifixai']) { write(root, `bin/${name}`, '#!/bin/sh\ntouch EXECUTED_FORBIDDEN\nexit 1\n'); fs.chmodSync(path.join(bin, name), 0o755); }
  const previous = process.env.PATH; process.env.PATH = bin + path.delimiter + previous;
  try {
    for (const id of ['guardana', 'ifixai']) {
      const result = checkPlugins(root, { id });
      assert.equal(result.exitCode, 0); assert.equal(result.plugins[0].probe, 'local-assessment-report');
      assert.equal(result.plugins[0].measured, false); assert.equal(result.plugins[0].currentBinding, 'unverified');
    }
    const report = recommendPlugins(root), result = configurePluginsAutomatically(root, report);
    assert.deepEqual(result.applied, []);
    assert.ok(report.decisions.filter(item => ['guardana', 'ifixai'].includes(item.id)).every(item => item.action === 'retain'));
    assert.equal(fs.existsSync(path.join(root, 'EXECUTED_FORBIDDEN')), false);
    assert.equal(fs.existsSync(path.join(root, '.tddswarm/assessments')), false);
  } finally { if (previous === undefined) delete process.env.PATH; else process.env.PATH = previous; }
});

test('all builtins and custom worker coexist without changing execution or generation authority', t => {
  const plugins = Object.fromEntries(BUILTIN_PLUGINS.map(plugin => [plugin.id, { enabled: true }]));
  plugins.guardana.report = 'guardana.json'; plugins.ifixai.report = 'ifixai.json';
  plugins['own-worker'] = { enabled: true, kind: 'worker', protocolVersion: 1, command: ['worker-not-invoked'] };
  const config = { adapter: 'node', runner: ['node', '--test', '{files}'], executionMode: 'shadow', executionPlugin: 'nx', plugins, agent: ['worker-not-invoked'] };
  const root = fixture(t, { 'package.json': { name: 'all-enabled' }, 'tddswarm.config.json': config, 'guardana.json': guardana(), 'ifixai.json': native('ifixai-native.json') });
  const original = fs.readFileSync(path.join(root, 'tddswarm.config.json'), 'utf8');
  const catalog = pluginCatalog(root);
  assert.deepEqual(catalog.plugins.filter(item => item.selected).map(item => item.id), ['nx']);
  assert.equal(catalog.plugins.length, BUILTIN_PLUGINS.length + 1);
  assert.ok(catalog.plugins.every(item => item.enabled));
  const recommendation = recommendPlugins(root);
  assert.deepEqual(recommendation.applicable, []);
  assert.equal(recommendation.execution.selected, 'nx');
  const imported = importAssessments(root);
  assert.equal(imported.assessments.length, 2);
  assert.ok(imported.assessments.every(item => item.advisory && item.currentBinding === 'unverified'));
  assert.equal(fs.readFileSync(path.join(root, 'tddswarm.config.json'), 'utf8'), original);
});
