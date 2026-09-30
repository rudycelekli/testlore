#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { stagePatch, validateCandidates } from '../src/candidates.js';
import { rememberValidation, recallLessons } from '../src/learning.js';

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
function option(name, fallback) { const index = args.indexOf(name); return index < 0 ? fallback : args[index + 1]; }
const sdkRoot = path.resolve(option('--sdk-root', repository));
const output = path.resolve(option('--output', path.join(repository, 'benchmarks/ruvector-verification.json')));
const packageFile = path.join(sdkRoot, 'node_modules/@ruvector/core/package.json');
if (!fs.existsSync(packageFile)) throw new Error('Install @ruvector/core in an isolated project, then pass --sdk-root. This proof never installs dependencies.');
const sdkPackage = JSON.parse(fs.readFileSync(packageFile));
assert.equal(sdkPackage.name, '@ruvector/core'); assert.equal(sdkPackage.version, '0.1.32');
const nativePackages = [];
for (const name of Object.keys(sdkPackage.optionalDependencies || {})) {
  const file = path.join(sdkRoot, 'node_modules', name, 'package.json');
  if (fs.existsSync(file)) { const info = JSON.parse(fs.readFileSync(file)); nativePackages.push({ name: info.name, version: info.version }); }
}
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'testlore-ruvector-verification-'));
function write(file, value) { const target = path.join(root, file); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, typeof value === 'string' ? value : JSON.stringify(value)); }
const plugin = { enabled: true, dimensions: 128, timeoutMs: 10000, embedding: { mode: 'feature-vectors' } };
const config = { adapter: 'node', plugins: { ruvector: plugin } };
const hash = value => createHash('sha256').update(value).digest('hex');
function validate(rejected = false) {
  const proposal = stagePatch(root, {
    files: [{ path: rejected ? 'test/rejected.test.js' : 'test/boundary.test.js', content: `import test from 'node:test';import assert from 'node:assert/strict';import {add} from '../src/add.js';test('zero boundary',()=>assert.equal(add(0,0),${rejected ? 99 : 0}));` }],
    requirements: 'Independent specification: adding zero to zero returns zero.',
    review: { accepted: true, findings: [], oracle: { independent: true, basis: ['Independent arithmetic requirement; reviewer did not derive expectations from implementation.'] } }
  });
  const manifest = JSON.parse(fs.readFileSync(path.join(proposal.directory, 'manifest.json')));
  const result = validateCandidates(root, proposal.id);
  assert.equal(result.accepted, !rejected); assert.equal(rememberValidation(root, manifest, result).remembered, true);
  return { accepted: result.accepted, complete: result.candidate?.complete || false, originalCases: result.original?.tests.length || 0, candidateCases: result.candidate?.tests.length || 0 };
}
try {
  write('package.json', { name: 'testlore-native-ruvector-proof', private: true, type: 'module' });
  write('tddswarm.config.json', config); write('src/add.js', 'export const add=(a,b)=>a+b;');
  write('test/original.test.js', "import test from 'node:test';import assert from 'node:assert/strict';import {add} from '../src/add.js';test('positive addition',()=>assert.equal(add(1,2),3));");
  fs.symlinkSync(path.join(sdkRoot, 'node_modules'), path.join(root, 'node_modules'));
  const accepted = validate(), rejected = validate(true);
  const canonicalFile = path.join(root, '.tddswarm/learning/index.json'), before = fs.readFileSync(canonicalFile);
  const first = recallLessons(root, 'zero boundary');
  assert.equal(first.retrieval, 'ruvector'); assert.equal(first.retrievalDetails.version, sdkPackage.version);
  assert.equal(first.retrievalDetails.cache, 'built'); assert.equal(first.retrievalDetails.mode, 'lexical-vector');
  assert.equal(first.records.length, 2); assert.equal(first.records[0].outcome, 'accepted');
  assert.deepEqual(first.records.find(record => record.outcome === 'rejected').patterns, []);
  const second = recallLessons(root, 'zero boundary'); assert.equal(second.retrievalDetails.cache, 'reused');
  const cli = spawnSync(process.execPath, [path.join(repository, 'src/cli.js'), 'recall', '--root', root, '--query', 'zero boundary', '--json'], { encoding: 'utf8', timeout: 20000, killSignal: 'SIGKILL', maxBuffer: 1024 * 1024 });
  assert.equal(cli.status, 0, cli.stderr); const cliResult = JSON.parse(cli.stdout);
  assert.equal(cliResult.retrieval, 'ruvector'); assert.equal(cliResult.records.length, 2); assert.equal(cliResult.retrievalDetails.cache, 'reused');
  write('src/add.js', 'export const add=(a,b)=>a+b+1;');
  const historical = recallLessons(root, 'zero boundary');
  assert.equal(historical.retrieval, 'ruvector'); assert.ok(historical.records.every(record => record.historical && !record.sourceCompatible && record.advisoryOnly));
  const framework = recallLessons(root, 'zero boundary', { config: { ...config, adapter: 'vitest' } }); assert.equal(framework.records.length, 0);
  const database = path.join(root, '.tddswarm/learning/ruvector/vectors.db'); fs.appendFileSync(database, 'corrupt');
  const fallback = recallLessons(root, 'zero boundary'); assert.equal(fallback.retrieval, 'deterministic-lexical'); assert.equal(fallback.records.length, 2);
  assert.ok(fallback.warnings.some(warning => warning.includes('ruvector-cache-corrupt')));
  const disabled = recallLessons(root, 'zero boundary', { config: { ...config, learning: { enabled: false } } }); assert.equal(disabled.reason, 'learning-disabled');
  assert.deepEqual(fs.readFileSync(canonicalFile), before);
  const sources = {};
  for (const relative of ['src/learning.js','src/adapters/ruvector.js','src/adapters/ruvector-worker.js','scripts/ruvector-proof.js']) sources[relative] = hash(fs.readFileSync(path.join(repository, relative)));
  const receipt = {
    schemaVersion: 1, generatedAt: new Date().toISOString(), kind: 'controlled-native-integration-verification',
    sdk: { name: sdkPackage.name, version: sdkPackage.version, platform: process.platform, architecture: process.arch, nativePackages, upstream: 'https://github.com/ruvnet/ruvector/tree/main/npm/packages/core' },
    command: 'node scripts/ruvector-proof.js --sdk-root <isolated-project-with-@ruvector/core@0.1.32>',
    embedding: { mode: 'lexical-vector', dimensions: plugin.dimensions, modelTraining: false, bundledSemanticModel: false },
    validation: { accepted, rejected },
    checks: { nativeBuild: first.retrievalDetails.cache, nativeReopen: second.retrievalDetails.cache, cliBackend: cliResult.retrieval, cliRecords: cliResult.records.length, acceptedRanksFirst: true, rejectedContainsNoPatterns: true, historicalEvidenceAdvisory: true, crossFrameworkRecords: framework.records.length, corruptCacheFallback: fallback.retrieval, learningDisableOverridesPlugin: true, canonicalStoreUnchanged: true },
    sourceHashes: sources,
    limitations: ['Controlled arithmetic fixture, not evidence of improved generated-test quality or speed.', 'Default vectors encode lexical features; no semantic model or model-weight training.', 'Disposable project and local worker are not a security sandbox for installed SDKs or embedding commands.']
  };
  fs.mkdirSync(path.dirname(output), { recursive: true }); fs.writeFileSync(output, JSON.stringify(receipt, null, 2) + '\n');
  console.log(JSON.stringify({ verified: true, output, sdkVersion: sdkPackage.version, checks: receipt.checks }));
} finally { fs.rmSync(root, { recursive: true, force: true }); }
