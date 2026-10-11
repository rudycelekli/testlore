import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { assertOracleCounts, daemonFullSuiteObservation, validateDaemonBaseline, validateDaemonPair } from '../../scripts/openrig-defect-pilot.js';

// Synthetic artifact controls exercise rejection semantics, never upstream proof.
const corpus = path.dirname(fileURLToPath(import.meta.url));
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const sandbox = '(version 1)(allow default)(deny network-outbound)(allow network-outbound (remote ip "localhost:*"))(allow network-outbound (subpath (param "IPC_ROOT")))';
const producer = { revision: 'a'.repeat(40), repository: 'rudycelekli/testlore', runId: '123', runAttempt: '1' };
const manifest = { ...JSON.parse(fs.readFileSync(path.join(corpus, 'manifest.json'))), originalLockSha256: sha('fixture lock') };
const names = [];
for (const reader of ['daemon', 'shipped']) for (const marker of ['```', '~~~']) for (const ending of ['\n', '\r\n']) {
  const suffix = JSON.stringify(ending).replaceAll('\\', '\\\\');
  names.push(`${reader}: tab-indented ${marker} opener keeps sibling address (${suffix})`, `${reader}: tab-indented ${marker} closer keeps example heading hidden (${suffix})`);
}
const tap = passed => 'TAP version 13\n' + names.map((name, i) => `${passed ? 'ok' : 'not ok'} ${i + 1} - ${name}`).join('\n') + `\n1..16\n# tests 16\n# pass ${passed ? 16 : 0}\n# fail ${passed ? 0 : 16}\n# skipped 0\n# cancelled 0\n# todo 0\n`;
const groupProfile = JSON.parse(fs.readFileSync(path.join(corpus, 'daemon-full-suite-groups.json')));
const fixtureSource = name => gunzipSync(fs.readFileSync(path.join(corpus, 'fixtures', name + '.gz')), { maxOutputLength: 64 * 1024 });
const originalSources = Object.keys(manifest.originalSources);
const inputs = () => Object.fromEntries([['cliPidProfileSha256', 'cli-ephemeral-pid-profile.json'], ['daemonGroupProfileSha256', 'daemon-full-suite-groups.json'], ['runnerSha256', '../../scripts/openrig-defect-pilot.js'], ['manifestSha256', 'manifest.json'], ['regressionSha256', 'regression.mjs'], ['nativeRegressionSha256', 'markdown-address-tab-fence.test.ts'], ['candidatePatchSha256', 'fixed.patch']].map(([name, relative]) => [name, sha(fs.readFileSync(path.resolve(corpus, relative)))]));

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'openrig-pair-control-'));
  const dirs = { baseline: path.join(root, 'baseline'), fixed: path.join(root, 'fixed') };
  const originalBytes = [fixtureSource('original-markdown-address.ts.txt'), fixtureSource('original-resolve-markdown.mjs.txt')];
  const project = path.join(root, 'source-replay');
  for (const [i, relative] of originalSources.entries()) { const file = path.join(project, relative); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, originalBytes[i]); }
  const applied = spawnSync('git', ['apply', path.join(corpus, 'fixed.patch')], { cwd: project, encoding: 'utf8' }); assert.equal(applied.status, 0, applied.stderr);
  const fixedBytes = originalSources.map(relative => fs.readFileSync(path.join(project, relative)));
  const receipts = {};
  for (const phase of ['baseline', 'fixed']) {
    const directory = dirs[phase]; fs.mkdirSync(directory);
    const upstream = `/declared/${phase}/source`; const scratch = `/declared/${phase}/scratch`; const output = `/declared/${phase}/output`;
    const receipt = { schemaVersion: 1, phase: phase === 'baseline' ? 'baseline' : 'paired-candidate', suite: 'daemon', status: phase === 'baseline' ? 'native-baseline-and-independent-defect-reproduced' : 'bounded-candidate-preserves-original-native-leg', legQualified: true, qualified: false, repository: manifest.repository, revision: manifest.revision, manifestSha256: sha(fs.readFileSync(path.join(corpus, 'manifest.json'))), producer, producerRoot: '/declared/producer', corpusRoot: '/declared/producer/benchmarks/openrig-tab-fence', producerInputs: inputs(), upstreamRoot: upstream, physicalScratch: scratch, outputRoot: output, nodeVersion: process.version, originalSources: manifest.originalSources, originalLockSha256: manifest.originalLockSha256, hostedGitHubMarker: true, resourceBudget: { maxGrowthBytes: 3 * 1024 ** 3, reserveBytes: 1024 ** 3, maxLogBytes: 2 * 1024 ** 2, timeoutMs: 17 * 60_000 }, executions: [], limitations: ['Synthetic rejection control, not native execution evidence'], originalNativeSourceHashes: { 'packages/daemon/test/original.test.ts': sha('original native test') } };
    receipt.originalDaemonGroupSources = groupProfile.sources; receipt.daemonGroupProfileSha256 = sha(fs.readFileSync(path.join(corpus, 'daemon-full-suite-groups.json')));
    for (const [relative, digest] of Object.entries(groupProfile.sources)) {
      for (const prefix of phase === 'fixed' ? ['original', 'fixed'] : ['original']) { const target = path.join(directory, prefix + '-group-sources', relative); fs.mkdirSync(path.dirname(target), { recursive: true }); const source = path.join(corpus, 'fixtures/daemon-group-sources', relative); fs.writeFileSync(target, fs.existsSync(source) ? fs.readFileSync(source) : gunzipSync(fs.readFileSync(source + '.gz'), { maxOutputLength: 64 * 1024 })); }
      if (relative.endsWith('.test.ts')) receipt.originalNativeSourceHashes[relative] = digest;
    }
    if (phase === 'fixed') receipt.fixedDaemonGroupSources = groupProfile.sources;
    fs.writeFileSync(path.join(directory, 'original-lock.json'), 'fixture lock');
    fs.writeFileSync(path.join(directory, 'original-digest-generator.mjs'), fixtureSource('original-generator.mjs.txt'));
    for (const [i, relative] of originalSources.entries()) { const file = path.join(directory, 'original-sources', relative); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, originalBytes[i]); }
    const commandNames = phase === 'baseline' ? ['install', 'original-build', 'system-ps-copy', 'native-platform-probe', 'original-native', 'original-frozen-oracle'] : ['install', 'original-build', 'system-ps-copy', 'native-platform-probe', 'original-frozen-oracle', 'candidate-paths', 'candidate-apply', 'candidate-apply-write', 'candidate-generate-digests', 'candidate-final-diff', 'fixed-frozen-oracle', 'fixed-native', 'candidate-verified-production-diff', 'candidate-verified-regression-diff'];
    const patch = receipt.corpusRoot + '/fixed.patch';
    const wrap = values => ['sandbox-exec', '-D', `IPC_ROOT=${scratch}`, '-p', sandbox, ...values];
    const commands = { install: ['npm', 'ci'], 'original-build': ['npm', 'run', 'build'], 'system-ps-copy': ['/usr/bin/install', '-m', '0755', '/bin/ps', scratch + '/bin/ps'], 'native-platform-probe': wrap(['node', 'scripts/ci-macos-process-probe.mjs']), 'candidate-paths': ['git', 'apply', '--numstat', patch], 'candidate-apply': ['git', 'apply', '--check', patch], 'candidate-apply-write': ['git', 'apply', patch], 'candidate-generate-digests': ['node', 'scripts/regen-edge-digests.mjs'], 'candidate-final-diff': ['git', 'diff', '--no-ext-diff', '--binary'], 'candidate-verified-production-diff': ['git', 'diff', '--no-ext-diff', '--binary', 'HEAD'], 'candidate-verified-regression-diff': ['git', 'diff', '--no-ext-diff', '--no-index', '--', '/dev/null', 'packages/daemon/test/markdown-address-tab-fence.test.ts'] };
    for (const prefix of ['original', 'fixed']) { commands[prefix + '-native'] = wrap(['npm', 'run', 'test', '-w', 'packages/daemon', '--', '--reporter=default', '--reporter=json', `--outputFile=${output}/${prefix}-native.json`]); commands[prefix + '-frozen-oracle'] = ['node', '--experimental-strip-types', '--test', '--test-reporter=tap', receipt.corpusRoot + '/regression.mjs']; }
    const origin = Date.parse('2026-10-11T00:00:00.000Z'); receipt.startedAt = new Date(origin).toISOString();
    for (const [i, name] of commandNames.entries()) {
      fs.mkdirSync(path.join(directory, name)); const stdout = name.endsWith('frozen-oracle') ? tap(name.startsWith('fixed')) : name === 'candidate-verified-production-diff' ? fs.readFileSync(path.join(corpus, 'fixed.patch')) : name === 'candidate-verified-regression-diff' ? 'fixture regression diff\n' : '';
      fs.writeFileSync(path.join(directory, name, 'stdout.log'), stdout); fs.writeFileSync(path.join(directory, name, 'stderr.log'), '');
      const footprint = { units: 'KiB', paths: [scratch, upstream, output], raw: [scratch, upstream, output].map(p => `1\t${p}`).join('\n') + '\n' };
      receipt.executions.push({ name, command: commands[name], startedAt: new Date(origin + i * 2 + 1).toISOString(), durationMs: 1, exitCode: ['original-frozen-oracle', 'candidate-verified-regression-diff'].includes(name) ? 1 : 0, signal: null, reason: null, stdout: name + '/stdout.log', stderr: name + '/stderr.log', stdoutSha256: sha(stdout), stderrSha256: sha(''), budgetGrowthBytes: 1, finalResources: { availableBytes: 10 * 1024 ** 3, growthBytes: 1, stdoutBytes: Buffer.byteLength(stdout), stderrBytes: 0 }, descendantCleanup: { scope: 'Best effort process-tree observation', observed: 1, survivingAtClose: 0, observationFailed: false, requested: false }, taskFootprint: { before: footprint, after: footprint } });
    }
    receipt.durationMs = commandNames.length * 2 + 1; receipt.completedAt = new Date(origin + receipt.durationMs).toISOString();
    receipt.originalOracle = assertOracleCounts(tap(false), 0, 16, 16);
    const nativeFile = { name: upstream + '/packages/daemon/test/original.test.ts', status: 'passed', assertionResults: [{ ancestorTitles: [], title: 'unchanged assertion', fullName: 'unchanged assertion', status: 'passed' }] };
    const raw = { success: true, numFailedTests: 0, numFailedTestSuites: 0, numTotalTests: phase === 'baseline' ? 46 : 62, numPassedTests: phase === 'baseline' ? 46 : 62, testResults: [nativeFile] };
    for (const group of groupProfile.groups) {
      const name = upstream + '/' + group.rawIdentity[0]; let file = raw.testResults.find(item => item.name === name);
      if (!file) { file = { name, status: 'passed', assertionResults: [] }; raw.testResults.push(file); }
      file.assertionResults.push(...Array.from({ length: group.statuses.passed }, () => ({ ancestorTitles: group.rawIdentity[1], title: group.rawIdentity[2], fullName: group.rawIdentity[3], status: 'passed' })));
    }
    if (phase === 'fixed') {
      raw.testResults.push({ name: upstream + '/packages/daemon/test/markdown-address-tab-fence.test.ts', status: 'passed', assertionResults: names.map(name => ({ ancestorTitles: [], title: name.replaceAll('\\\\', '\\'), fullName: name.replaceAll('\\\\', '\\'), status: 'passed' })) });
      receipt.fixedOracle = assertOracleCounts(tap(true), 16, 0, 16); receipt.frozenNativeAssertions = 16;
      receipt.fixedNativeSourceHashes = { ...receipt.originalNativeSourceHashes, 'packages/daemon/test/markdown-address-tab-fence.test.ts': manifest.protectedArtifacts['markdown-address-tab-fence.test.ts'] };
      receipt.candidate = JSON.parse(fs.readFileSync(path.join(corpus, 'candidate.json')));
      const digest = '{"syntheticControlOnly":true}\n'; receipt.generatedDigestSha256 = sha(digest); fs.writeFileSync(path.join(directory, 'generated-skill-edge-digests.json'), digest);
      receipt.generatorSourceSha256 = sha(fixtureSource('original-generator.mjs.txt'));
      const patchBytes = Buffer.concat([fs.readFileSync(path.join(directory, 'candidate-verified-production-diff/stdout.log')), fs.readFileSync(path.join(directory, 'candidate-verified-regression-diff/stdout.log'))]); receipt.completePatchSha256 = sha(patchBytes); fs.writeFileSync(path.join(directory, 'complete-upstream.patch'), patchBytes);
      receipt.fixedSourceHashes = { 'scripts/skill-edge-digests.generated.json': sha(digest) };
      for (const [i, relative] of originalSources.entries()) { const file = path.join(directory, 'fixed-sources', relative); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, fixedBytes[i]); receipt.fixedSourceHashes[relative] = sha(fixedBytes[i]); }
    }
    const nativeBytes = JSON.stringify(raw); fs.writeFileSync(path.join(directory, phase === 'baseline' ? 'original-native.json' : 'fixed-native.json'), nativeBytes);
    receipt[phase === 'baseline' ? 'originalInventory' : 'fixedInventory'] = { sha256: sha(nativeBytes), total: raw.numTotalTests, passed: raw.numPassedTests, unexercised: 0, runtimeErrorCounter: null };
    receipts[phase] = receipt;
    if (phase === 'fixed') { receipt.originalInventory = receipts.baseline.originalInventory; receipt.baselineBinding = { producer, assessmentSha256: sha(fs.readFileSync(path.join(dirs.baseline, 'assessment.json'))), sourceRoot: receipts.baseline.upstreamRoot, targetRoot: upstream }; }
    fs.writeFileSync(path.join(directory, 'assessment.json'), JSON.stringify(receipt));
  }
  return { root, dirs, receipts };
}

test('paired daemon replay requires full baseline authority, exact raw bindings and 16 frozen additions', () => {
  const f = fixture();
  try {
    assert.equal(validateDaemonBaseline(f.dirs.baseline, producer, manifest).groups.total, 46);
    const result = validateDaemonPair(f.dirs.baseline, f.dirs.fixed, producer, manifest);
    assert.equal(result.legQualified, true); assert.equal(result.qualified, false); assert.equal(result.omissionAuthority, false); assert.equal(result.frozenNativeAssertions, 16);
    const mutate = (phase, change) => { const receipt = structuredClone(f.receipts[phase]); change(receipt); fs.writeFileSync(path.join(f.dirs[phase], 'assessment.json'), JSON.stringify(receipt)); assert.throws(() => validateDaemonPair(f.dirs.baseline, f.dirs.fixed, producer, manifest)); fs.writeFileSync(path.join(f.dirs[phase], 'assessment.json'), JSON.stringify(f.receipts[phase])); };
    for (const phase of ['baseline', 'fixed']) {
      mutate(phase, r => { r.producer.revision = 'b'.repeat(40); });
      mutate(phase, r => { r.schemaVersion = 2; });
      mutate(phase, r => { r.repository = 'different/target'; });
      mutate(phase, r => { r.originalDaemonGroupSources['docs/reference/schemas/fixtures/identity-vectors.json'] = 'f'.repeat(64); });
      mutate(phase, r => { r.nodeVersion = 'v0.0.0'; });
      mutate(phase, r => { r.executions[0].command = ['npm', 'ci', '--ignore-scripts']; });
      mutate(phase, r => { r.executions[0].finalResources.availableBytes = null; });
      mutate(phase, r => { delete r.executions[0].finalResources.growthBytes; });
      mutate(phase, r => { r.executions[0].budgetGrowthBytes = -1; });
      mutate(phase, r => { r.executions[0].durationMs = null; });
      mutate(phase, r => { r.durationMs = 17 * 60_000 + 1; r.completedAt = new Date(Date.parse(r.startedAt) + r.durationMs).toISOString(); });
      mutate(phase, r => { r.executions.pop(); });
      mutate(phase, r => { r.originalLockSha256 = 'f'.repeat(64); });
    }
    mutate('fixed', r => { r.upstreamRoot = 'relative/source'; r.baselineBinding.targetRoot = r.upstreamRoot; });
    mutate('fixed', r => { r.completePatchSha256 = sha('rebound delivered patch'); fs.writeFileSync(path.join(f.dirs.fixed, 'complete-upstream.patch'), 'rebound delivered patch'); });
    const restored = Buffer.concat([fs.readFileSync(path.join(f.dirs.fixed, 'candidate-verified-production-diff/stdout.log')), fs.readFileSync(path.join(f.dirs.fixed, 'candidate-verified-regression-diff/stdout.log'))]); fs.writeFileSync(path.join(f.dirs.fixed, 'complete-upstream.patch'), restored);
    mutate('fixed', r => { r.fixedNativeSourceHashes['packages/daemon/test/original.test.ts'] = sha('weakened native source'); });
    mutate('fixed', r => { r.frozenNativeAssertions = 15; });
    const nativePath = path.join(f.dirs.fixed, 'fixed-native.json'); const originalNative = fs.readFileSync(nativePath);
    for (const change of [raw => { raw.testResults[0].assertionResults[0].title = 'renamed original'; }, raw => { raw.testResults[1].assertionResults.pop(); raw.numTotalTests--; raw.numPassedTests--; }, raw => { raw.testResults[0].assertionResults.push({ ancestorTitles: [], title: 'unexpected extra', fullName: 'unexpected extra', status: 'passed' }); raw.numTotalTests++; raw.numPassedTests++; }, raw => { raw.testResults[1].assertionResults[0].location = { line: 1, column: 1 }; }, raw => { raw.testResults.find(file => file.name.endsWith('/markdown-address-tab-fence.test.ts')).assertionResults.pop(); raw.numTotalTests--; raw.numPassedTests--; }]) {
      const raw = JSON.parse(originalNative); change(raw); const bytes = JSON.stringify(raw); fs.writeFileSync(nativePath, bytes);
      mutate('fixed', r => { r.fixedInventory.sha256 = sha(bytes); r.fixedInventory.total = raw.numTotalTests; r.fixedInventory.passed = raw.numPassedTests; });
      fs.writeFileSync(nativePath, originalNative);
    }
    fs.appendFileSync(path.join(f.dirs.baseline, 'original-build/stdout.log'), 'changed raw bytes');
    assert.throws(() => validateDaemonPair(f.dirs.baseline, f.dirs.fixed, producer, manifest));
  } finally { fs.rmSync(f.root, { recursive: true, force: true }); }
});
