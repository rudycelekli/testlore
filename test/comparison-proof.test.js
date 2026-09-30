import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { comparisonDataset, summarizeComparison, comparisonSvg, runComparison } from '../scripts/comparison-proof.js';

test('comparison metrics include controls and measure executed cases rather than inferred selection', () => {
  const faulty = { method: 'testlore', valid: true, groundTruthFailures: ['a', 'b'], detectedFailures: ['a'], missedFailures: ['b'], executedFiles: ['one.test.js'], totalFiles: 4, endToEndMs: 20 };
  const control = { ...faulty, groundTruthFailures: [], detectedFailures: [], missedFailures: [], executedFiles: [], endToEndMs: 10 };
  const metric = summarizeComparison([faulty, control]).find(item => item.id === 'testlore');
  assert.equal(metric.faultRecall, 0.5); assert.equal(metric.missedFailures, 1);
  assert.equal(metric.executedFileFraction, 1 / 8); assert.equal(metric.endToEndMedianMs, 15);
  assert.equal(metric.faultScenarioRecall, 1);
  assert.equal(summarizeComparison([]).every(item => item.valid === false && item.faultRecall === null), true);
});
test('dataset and exported chart state scope and avoid unsafe or invented leaderboard claims', () => {
  const dataset = comparisonDataset(); assert.equal(dataset.length, 12);
  assert.equal(new Set(dataset.map(item => item.project)).size, 4);
  assert.equal(dataset.filter(item => item.regression).length, 7);
  assert.ok(dataset.every(item => item.tests.length === 8));
  const summary = ['full-native', 'testlore', 'imports-only'].map(id => ({ id, name: id === 'testlore' ? 'TestLore <routing>' : id, faultRecall: 1, executedFileFraction: 0.5, endToEndMedianMs: 25, missedFailures: 0 }));
  const svg = comparisonSvg({ summary, dataset: { scenarios: 12, projects: 4, digest: 'abc123' }, repetitions: 3, environment: { node: '22', platform: 'linux', architecture: 'x64' }, toolRevision: 'deadbeef' });
  assert.match(svg, /TestLore &lt;routing&gt;/); assert.match(svg, /not a leaderboard/);
  assert.match(svg, /discovery, planning, execution/); assert.doesNotMatch(svg, /NaN|Infinity/);
});
test('comparison proof requires append-only output and bounds repetitions before running commands', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'testlore-comparison-output-test-')); t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  assert.throws(() => runComparison(), /output directory/);
  assert.throws(() => runComparison({ output: directory }), /already exists/);
  assert.throws(() => runComparison({ output: path.join(directory, 'new'), repetitions: 0 }), /repetitions/);
  assert.equal(fs.existsSync(path.join(directory, 'new')), false);
});
