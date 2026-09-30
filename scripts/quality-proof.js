#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = `export function classify(value) {
  if (value < 0) return 'negative';
  if (value === 0) return 'zero';
  return 'positive';
}
export function unused(value) {
  return value * 2;
}
`;
const tests = `import test from 'node:test';
import assert from 'node:assert/strict';
import { classify } from '../src/classify.js';
test('negative requirement', () => assert.equal(classify(-1), 'negative'));
test('zero requirement', () => assert.equal(classify(0), 'zero'));
test('positive requirement', () => assert.equal(classify(1), 'positive'));
`;
const sha = value => createHash('sha256').update(value).digest('hex');
function write(root, file, content) {
  const target = path.join(root, file); fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, typeof content === 'string' ? content : JSON.stringify(content, null, 2));
}
function packageTool(toolsRoot, name) {
  const location = path.join(toolsRoot, 'node_modules', name);
  const info = JSON.parse(fs.readFileSync(path.join(location, 'package.json'), 'utf8'));
  const executable = typeof info.bin === 'string' ? info.bin : Object.values(info.bin)[0];
  return { path: path.resolve(location, executable), version: info.version };
}
function command(root, argv) {
  const env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
  const start = performance.now();
  const result = spawnSync(argv[0], argv.slice(1), { cwd: root, env, shell: false, encoding: 'utf8', timeout: 180000, maxBuffer: 16 * 1024 * 1024 });
  if (result.error || result.status !== 0) throw new Error(`Measurement failed: ${result.error?.message || `exit ${result.status}`}\n${result.stdout}\n${result.stderr}`);
  return { command: argv, exitCode: result.status, durationMs: Math.round(performance.now() - start), stdout: result.stdout, stderr: result.stderr };
}
function sanitize(value, roots) {
  let serialized = JSON.stringify(value);
  for (const [root, label] of roots.sort(([a], [b]) => b.length - a.length)) serialized = serialized.split(root).join(label);
  return JSON.parse(serialized);
}

/** Run real c8 and Stryker, then test ingestion and provenance invalidation. */
export async function qualityProof(options = {}) {
  const apiRoot = path.resolve(options.apiRoot || process.env.TDDSWARM_API_ROOT || repository);
  const toolsRoot = path.resolve(options.toolsRoot || process.env.TDDSWARM_TOOLS_ROOT || apiRoot);
  const implementationDigests = Object.fromEntries(['src/evidence.js', 'src/provenance.js', 'src/inputs.js'].map(file => [file, sha(fs.readFileSync(path.join(apiRoot, file)))]));
  implementationDigests['scripts/quality-proof.js'] = sha(fs.readFileSync(fileURLToPath(import.meta.url)));
  const { ingestQuality, qualityEvidence } = await import(pathToFileURL(path.join(apiRoot, 'src/evidence.js')).href);
  const { snapshot } = await import(pathToFileURL(path.join(apiRoot, 'src/provenance.js')).href);
  const { readConfig } = await import(pathToFileURL(path.join(apiRoot, 'src/files.js')).href);
  const c8 = packageTool(toolsRoot, 'c8'), stryker = packageTool(toolsRoot, '@stryker-mutator/core');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tddswarm-quality-proof-'));
  const serviceVariable = 'TDDSWARM_QUALITY_PROOF_SERVICE', previousService = process.env[serviceVariable];
  process.env[serviceVariable] = 'proof-contract-v1';
  try {
    const config = {
      mutate: ['src/classify.js'], testRunner: 'command', commandRunner: { command: 'node --test test/classify.test.js' },
      coverageAnalysis: 'off', concurrency: 1, reporters: ['json'], jsonReporter: { fileName: '.tddswarm/proof/mutation.json' },
      tempDirName: '.tddswarm/stryker-tmp', cleanTempDir: 'always', symlinkNodeModules: false,
      timeoutMS: 5000, logLevel: 'error', fileLogLevel: 'off', plugins: [], ignorePatterns: ['.tddswarm'], thresholds: { high: 100, low: 0, break: 0 }
    };
    write(root, 'package.json', { type: 'module', private: true });
    write(root, 'src/classify.js', source); write(root, 'test/classify.test.js', tests); write(root, 'stryker.config.json', config);
    write(root, 'tddswarm.config.json', { services: { proofContract: { tests: ['test/classify.test.js'], env: serviceVariable } } });
    // One snapshot predates both actual tool invocations. Reports/temp files stay in excluded metadata.
    const provenance = snapshot(root, readConfig(root));
    write(root, '.tddswarm/proof/provenance.json', provenance);
    const coverageRun = command(root, [process.execPath, c8.path, '--include=src/*.js', '--reporter=json', '--reports-dir=.tddswarm/proof/coverage', process.execPath, '--test', 'test/classify.test.js']);
    const coveragePath = '.tddswarm/proof/coverage/coverage-final.json';
    const coverageRaw = fs.readFileSync(path.join(root, coveragePath), 'utf8');
    const coverage = ingestQuality(root, 'coverage', coveragePath, { provenance, scope: ['src/classify.js'] });
    assert.ok(coverage.metrics.lines.total > 0 && coverage.metrics.lines.covered > 0);
    assert.equal(coverage.metrics.functions.total, 2); assert.equal(coverage.metrics.functions.covered, 1);
    const mutationRun = command(root, [process.execPath, stryker.path, 'run', 'stryker.config.json']);
    const mutationPath = '.tddswarm/proof/mutation.json', mutationRaw = fs.readFileSync(path.join(root, mutationPath), 'utf8');
    const mutation = ingestQuality(root, 'mutation', mutationPath, { provenance, scope: ['src/classify.js'] });
    assert.equal(mutation.metrics.complete, true); assert.ok(mutation.metrics.valid > 0);
    assert.ok(mutation.metrics.counts.Killed > 0); assert.ok(mutation.metrics.counts.Survived > 0);
    const rawStatuses = Object.values(JSON.parse(mutationRaw).files).flatMap(file => file.mutants).map(mutant => mutant.status);
    for (const [status, count] of Object.entries(mutation.metrics.counts)) assert.equal(count, rawStatuses.filter(value => value === status).length);
    const fresh = qualityEvidence(root);
    assert.equal(fresh.coverage.measured, true); assert.equal(fresh.mutation.measured, true);
    const coverageRecordPath = path.join(root, '.tddswarm/evidence/quality/coverage.json');
    const coverageRecordBytes = fs.readFileSync(coverageRecordPath);
    const tamperedRecord = JSON.parse(coverageRecordBytes); tamperedRecord.scope = ['tampered scope'];
    fs.writeFileSync(coverageRecordPath, JSON.stringify(tamperedRecord));
    const recordTamper = qualityEvidence(root).coverage;
    assert.equal(recordTamper.measured, false); assert.match(recordTamper.error, /integrity mismatch/i);
    fs.writeFileSync(coverageRecordPath, coverageRecordBytes);
    const mutationStoredRaw = path.join(root, '.tddswarm/evidence/quality/mutation.raw.json');
    fs.appendFileSync(mutationStoredRaw, '\n');
    const rawTamper = qualityEvidence(root).mutation;
    assert.equal(rawTamper.measured, false); assert.match(rawTamper.error, /raw evidence changed/i);
    fs.writeFileSync(mutationStoredRaw, mutationRaw);
    process.env[serviceVariable] = 'proof-contract-v2';
    const serviceStale = qualityEvidence(root), serviceRejected = {};
    assert.equal(serviceStale.coverage.measured, false); assert.equal(serviceStale.mutation.measured, false);
    for (const [type, reportPath] of [['coverage', coveragePath], ['mutation', mutationPath]]) {
      try { ingestQuality(root, type, reportPath, { provenance }); throw new Error('Changed service version incorrectly accepted'); }
      catch (error) { assert.match(error.message, /Quality evidence source changed:.*service-versions-changed/); serviceRejected[type] = error.message; }
    }
    process.env[serviceVariable] = 'proof-contract-v1';
    assert.equal(qualityEvidence(root).coverage.measured, true); assert.equal(qualityEvidence(root).mutation.measured, true);
    fs.appendFileSync(path.join(root, 'src/classify.js'), '\n// deliberate postmeasurement source drift\n');
    const rejected = {};
    for (const [type, reportPath] of [['coverage', coveragePath], ['mutation', mutationPath]]) {
      try { ingestQuality(root, type, reportPath, { provenance }); throw new Error('Stale ingestion incorrectly succeeded'); }
      catch (error) { assert.match(error.message, /Quality evidence source changed:.*source-drift:src\/classify\.js/); rejected[type] = error.message; }
    }
    const stale = qualityEvidence(root);
    assert.equal(stale.coverage.measured, false); assert.equal(stale.mutation.measured, false);
    const receipt = {
      schemaVersion: 1, scope: 'Real c8 and Stryker execution on a deterministic scratch fixture; not production-project or model quality',
      generatedAt: new Date().toISOString(), verified: true, node: process.version,
      tools: { c8: c8.version, stryker: stryker.version }, implementationDigests, fixture: { source, tests, strykerConfig: config },
      preRunProvenance: provenance, coverage: { run: coverageRun, record: coverage, originalReportHash: sha(coverageRaw), raw: JSON.parse(coverageRaw) },
      mutation: { run: mutationRun, record: mutation, originalReportHash: sha(mutationRaw), raw: JSON.parse(mutationRaw) },
      fresh: { coverageMeasured: fresh.coverage.measured, mutationMeasured: fresh.mutation.measured },
      integrityChecks: { recordTamperRejected: recordTamper.measured === false, recordError: recordTamper.error, rawTamperRejected: rawTamper.measured === false, rawError: rawTamper.error },
      serviceChecks: { coverageMeasuredAfterVersionChange: serviceStale.coverage.measured, mutationMeasuredAfterVersionChange: serviceStale.mutation.measured, ingestionRejected: serviceRejected },
      stale: { coverageMeasured: stale.coverage.measured, mutationMeasured: stale.mutation.measured, ingestionRejected: rejected, coverageReasons: stale.coverage.reasons, mutationReasons: stale.mutation.reasons }
    };
    return sanitize(receipt, [[root, '<fixture>'], [toolsRoot, '<tools>'], [apiRoot, '<api>'], [repository, '<repository>'], [process.execPath, '<node>']]);
  } finally {
    if (previousService === undefined) delete process.env[serviceVariable]; else process.env[serviceVariable] = previousService;
    fs.rmSync(root, { recursive: true, force: true });
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  try {
    const options = {}, args = process.argv.slice(2);
    for (let i = 0; i < args.length; i += 2) {
      if (!['--api-root', '--tools-root', '--output'].includes(args[i]) || !args[i + 1]) throw new Error('Usage: node scripts/quality-proof.js [--api-root PATH] [--tools-root PATH] [--output FILE]');
      options[({ '--api-root': 'apiRoot', '--tools-root': 'toolsRoot', '--output': 'output' })[args[i]]] = args[i + 1];
    }
    const receipt = await qualityProof(options), serialized = JSON.stringify(receipt, null, 2) + '\n';
    if (options.output) { fs.mkdirSync(path.dirname(path.resolve(options.output)), { recursive: true }); fs.writeFileSync(options.output, serialized); }
    process.stdout.write(JSON.stringify({ verified: receipt.verified, tools: receipt.tools, coverage: receipt.coverage.record.metrics, mutation: receipt.mutation.record.metrics, stale: receipt.stale, output: options.output }, null, 2) + '\n');
  } catch (error) { process.stderr.write(error.stack + '\n'); process.exitCode = 1; }
}
