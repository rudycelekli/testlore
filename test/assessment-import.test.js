import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { importAssessments, inspectAssessmentReport } from '../src/assessments.js';
import { configurePlugin, checkPlugins, pluginCatalog } from '../src/plugins.js';
import { recommendPlugins } from '../src/plugin-recommendations.js';
const cli = fileURLToPath(new URL('../src/cli.js', import.meta.url));
const native = plugin => JSON.parse(fs.readFileSync(new URL(`./fixtures/assessments/${plugin === 'guardana' ? 'guardana-clean-v17' : 'ifixai-native'}.json`, import.meta.url), 'utf8'));
function fixture(t, config = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'testlore-assessment-import-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'tddswarm.config.json'), JSON.stringify(config));
  for (const plugin of ['guardana','ifixai']) fs.writeFileSync(path.join(root, `${plugin}.json`), JSON.stringify(native(plugin)));
  return root;
}
const invoke = (root, args) => spawnSync(process.execPath, [cli, ...args, '--root', root, '--json'], { encoding: 'utf8', timeout: 10000 });

test('one-off assessment imports preserve byte provenance and have no acceptance authority', t => {
  const root = fixture(t), input = fs.readFileSync(path.join(root, 'guardana.json'));
  const inspected = inspectAssessmentReport(root, { plugin: 'guardana', report: 'guardana.json' });
  assert.equal(inspected.importComplete, true);
  assert.equal(inspected.source.sha256, createHash('sha256').update(input).digest('hex'));
  assert.equal(inspected.source.bytes, input.length);
  assert.equal(inspected.currentBinding, 'unverified'); assert.equal(inspected.advisory, true);
  assert.deepEqual(Object.values(inspected.authority), [false,false,false,false]);
  assert.equal(fs.existsSync(path.join(root, '.tddswarm')), false, 'Inspection must not persist');
  const receipt = importAssessments(root, { plugin: 'guardana', report: 'guardana.json' });
  assert.equal(receipt.nativeVerificationExecuted, false); assert.equal(receipt.providerCalls, 0);
  assert.equal(receipt.assessments.length, 1);
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, receipt.receipt))).assessments[0].source.sha256, inspected.source.sha256);
  assert.equal(fs.statSync(path.join(root, receipt.receipt)).mode & 0o777, 0o600);
  assert.equal(fs.existsSync(path.join(root, '.tddswarm/last-run.json')), false);
  assert.equal(fs.existsSync(path.join(root, '.tddswarm/learning')), false);
});

test('both assessment plugins complement explicit execution and generation without executing them', t => {
  const config = { executionPlugin: 'nx', executionMode: 'shadow', runner: ['node','--test','{files}'], agent: ['never-run-worker'], plugins: {
    nx: { enabled: true }, 'agentic-qe': { enabled: true, command: ['never-run-aqe'] },
    guardana: { enabled: true, report: 'guardana.json' }, ifixai: { enabled: true, report: 'ifixai.json' }
  } };
  const root = fixture(t, config), original = fs.readFileSync(path.join(root, 'tddswarm.config.json'), 'utf8');
  const receipt = importAssessments(root);
  assert.deepEqual(receipt.assessments.map(item => item.plugin), ['guardana','ifixai']);
  assert.equal(receipt.assessments[1].outcome, 'incomplete'); assert.equal(receipt.exitCode, 2);
  for (const id of ['guardana','ifixai']) {
    const health = checkPlugins(root, { id });
    assert.equal(health.exitCode, 0); assert.equal(health.plugins[0].probe, 'local-assessment-report');
    assert.equal(health.plugins[0].currentBinding, 'unverified');
    assert.equal(health.plugins[0].measured, false);
  }
  const recommendations = recommendPlugins(root);
  assert.deepEqual(recommendations.applicable, []); assert.equal(recommendations.execution.selected, 'nx');
  assert.equal(recommendations.recommendations.find(item => item.id === 'guardana').role, 'security-assessment');
  assert.equal(recommendations.recommendations.find(item => item.id === 'ifixai').role, 'behavior-assessment');
  assert.equal(fs.readFileSync(path.join(root, 'tddswarm.config.json'), 'utf8'), original);
  assert.deepEqual(pluginCatalog(root).plugins.filter(item => item.selected).map(item => item.id), ['nx']);
});

test('invalid adapter reports cannot prevent a separate configured adapter from retaining evidence', t => {
  const root = fixture(t, { plugins: { guardana: { enabled: true, report: 'guardana.json' }, ifixai: { enabled: true, report: 'ifixai.json' } } });
  fs.writeFileSync(path.join(root, 'guardana.json'), '{"secret":"never-copy-this",broken}');
  const receipt = importAssessments(root);
  assert.equal(receipt.exitCode, 2);
  assert.equal(receipt.assessments[0].importComplete, false); assert.equal(receipt.assessments[1].importComplete, true);
  assert.equal(JSON.stringify(receipt).includes('never-copy-this'), false);
});

test('automatic setup requires explicit report choice and never treats Python tool presence as permission', t => {
  const root = fixture(t); const report = recommendPlugins(root);
  for (const id of ['guardana','ifixai']) {
    const item = report.recommendations.find(row => row.id === id);
    assert.equal(item.automaticDecision, 'skip'); assert.equal(item.ready, false);
    assert.match(item.reasons.join(' '), /Explicit report paths/);
    configurePlugin(root, id, { enabled: true });
    assert.equal(checkPlugins(root, { id }).exitCode, 2);
    assert.throws(() => configurePlugin(root, id, { enabled: true, settings: { command: ['must-never-execute'] } }), /Unsupported/);
    assert.throws(() => configurePlugin(root, id, { enabled: true, settings: { report: '../outside.json' } }), /project-relative/);
  }
});

test('disabled configured reports stay inert while an explicit one-off import is allowed', t => {
  const root = fixture(t, { plugins: { ifixai: { enabled: false, report: 'ifixai.json' } } });
  assert.equal(importAssessments(root).assessments.length, 0);
  assert.equal(importAssessments(root, { plugin: 'ifixai' }).assessments[0].error, 'missing-report');
  assert.equal(importAssessments(root, { plugin: 'ifixai', report: 'ifixai.json' }).assessments[0].importComplete, true);
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'tddswarm.config.json'))).plugins.ifixai.enabled, false);
});

test('CLI imports both configured reports and preserves nonzero findings or uncertainty with a durable receipt', t => {
  const root = fixture(t, { plugins: { guardana: { enabled: true, report: 'guardana.json' }, ifixai: { enabled: true, report: 'ifixai.json' } } });
  const result = invoke(root, ['assess']); assert.equal(result.status, 2, result.stderr);
  const receipt = JSON.parse(result.stdout); assert.equal(receipt.assessments.length, 2);
  assert.equal(fs.existsSync(path.join(root, receipt.receipt)), true);
  const failed = native('ifixai'); failed.test_results[0].status = 'fail'; failed.test_results[0].passing = false;
  fs.writeFileSync(path.join(root, 'failed.json'), JSON.stringify(failed));
  const findings = invoke(root, ['assess','--plugin','ifixai','--report','failed.json']);
  assert.equal(findings.status, 1, findings.stderr); assert.equal(JSON.parse(findings.stdout).assessments[0].outcome, 'findings');
  assert.equal(invoke(root, ['assess','--report','ifixai.json']).status, 2);
  assert.equal(invoke(root, ['assess','--execute']).status, 2);
  assert.equal(invoke(root, ['assess','--plugin','agentic-qe','--report','ifixai.json']).status, 2);
});

test('receipt destinations cannot replace inputs, existing reports, or escape the project', t => {
  const root = fixture(t), before = fs.readFileSync(path.join(root, 'guardana.json'));
  for (const output of ['guardana.json','../outside.json','tddswarm.config.json']) assert.throws(() => importAssessments(root, { plugin: 'guardana', report: 'guardana.json', output }));
  assert.deepEqual(fs.readFileSync(path.join(root, 'guardana.json')), before);
});
