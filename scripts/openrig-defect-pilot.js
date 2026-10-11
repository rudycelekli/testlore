import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { boundedInstallProcess } from './qualification-process.js';

const corpus = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../benchmarks/openrig-tab-fence');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const sourcePaths = [
  'packages/daemon/src/domain/markdown-address.ts',
  'packages/daemon/assets/plugins/openrig-core/skills/loading-addressable-markdown/scripts/resolve-markdown.mjs',
];
const tuiPidSourcePath = 'packages/tui/test/socket-collision.test.ts';
const tuiPidSourceSha256 = '4ca84e22bbe60040c7038336ec0eb1107fdc3fc83265cae6b564a1aed32a7500';
const cliGroupProfileSha256 = '5a6a62457dabbb299df1b03d2ce1501259ba7291bfbc7b9136d1f19b540ab9e7';
const daemonGroupProfileSha256 = '528f9ae3b3c87d7ff26268c0b5c275fb52900a452bbf0010b7158ab1b2d3ff8f';
const digestGeneratorSha256 = '3550f93d879f815d7ec4d63eff399ae5d7bc0a23cdbcc3839be179c4025447fc';
const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sandboxProfile = '(version 1)(allow default)(deny network-outbound)(allow network-outbound (remote ip "localhost:*"))(allow network-outbound (subpath (param "IPC_ROOT")))';
const producerInputs = () => ({ daemonGroupProfileSha256: hash(fs.readFileSync(path.join(corpus, 'daemon-full-suite-groups.json'))), runnerSha256: hash(fs.readFileSync(fileURLToPath(import.meta.url))), manifestSha256: hash(fs.readFileSync(path.join(corpus, 'manifest.json'))), regressionSha256: hash(fs.readFileSync(path.join(corpus, 'regression.mjs'))), nativeRegressionSha256: hash(fs.readFileSync(path.join(corpus, 'markdown-address-tab-fence.test.ts'))), candidatePatchSha256: hash(fs.readFileSync(path.join(corpus, 'fixed.patch'))) });
const readEvidence = (directory, relative, limit) => {
  if (path.isAbsolute(relative) || relative.split('/').includes('..')) throw new Error('Evidence path outside artifact');
  const root = fs.realpathSync(directory); const file = path.join(root, relative);
  if (fs.lstatSync(file).isSymbolicLink() || !fs.realpathSync(file).startsWith(root + path.sep) || fs.statSync(file).size > limit) throw new Error('Unbounded or redirected evidence');
  return fs.readFileSync(file);
};

export function validateDaemonBaseline(directory, expectedProducer, manifest, upstreamRoot) {
  const receipt = JSON.parse(readEvidence(directory, 'assessment.json', 1024 ** 2));
  if (!expectedProducer || expectedProducer.repository !== 'rudycelekli/testlore' || !/^[a-f0-9]{40}$/.test(expectedProducer.revision || '') || !/^[1-9][0-9]*$/.test(expectedProducer.runId || '') || !/^[1-9][0-9]*$/.test(expectedProducer.runAttempt || '')) throw new Error('Missing exact trusted daemon producer/head/run authority');
  if (receipt.schemaVersion !== 1 || receipt.repository !== manifest.repository || receipt.phase !== 'baseline' || receipt.suite !== 'daemon' || receipt.status !== 'native-baseline-and-independent-defect-reproduced' || receipt.legQualified !== true || receipt.qualified !== false || receipt.revision !== manifest.revision || receipt.manifestSha256 !== hash(fs.readFileSync(path.join(corpus, 'manifest.json'))) || JSON.stringify(receipt.producer) !== JSON.stringify(expectedProducer) || receipt.nodeVersion !== process.version || receipt.originalLockSha256 !== manifest.originalLockSha256 || JSON.stringify(receipt.originalSources) !== JSON.stringify(manifest.originalSources) || !path.isAbsolute(receipt.upstreamRoot) || !path.isAbsolute(receipt.physicalScratch) || !path.isAbsolute(receipt.outputRoot)) throw new Error('Missing or drifted complete daemon baseline authority');
  const expectedNames = ['install', 'original-build', 'system-ps-copy', 'native-platform-probe', 'original-native', 'original-frozen-oracle'];
  if (receipt.executions.length !== expectedNames.length) throw new Error('Incomplete baseline process inventory');
  validateDaemonProcesses(directory, receipt, expectedNames);
  validateOriginalDaemonInputs(directory, receipt, manifest);
  const bytes = readEvidence(directory, 'original-native.json', 32 * 1024 ** 2);
  const raw = JSON.parse(bytes); const groups = daemonFullSuiteObservation(raw, receipt.upstreamRoot, receipt.originalDaemonGroupSources);
  validateDaemonGroupSources(directory, receipt, 'original', upstreamRoot);
  if (hash(bytes) !== receipt.originalInventory?.sha256 || groups.total !== receipt.originalInventory.total || groups.passed !== receipt.originalInventory.passed) throw new Error('Truncated or drifted baseline native outcomes');
  const oracle = assertOracleCounts(readEvidence(directory, 'original-frozen-oracle/stdout.log', 2 * 1024 ** 2).toString(), 0, manifest.expectedOracleCases, manifest.expectedOracleCases);
  if (JSON.stringify(oracle) !== JSON.stringify(receipt.originalOracle)) throw new Error('Baseline oracle summary differs from raw outcomes');
  const files = new Set(raw.testResults.map(file => path.relative(receipt.upstreamRoot, file.name)));
  if (!receipt.originalNativeSourceHashes || Object.keys(receipt.originalNativeSourceHashes).length !== files.size) throw new Error('Missing baseline native source bindings');
  for (const relative of files) {
    if (relative.startsWith('..') || path.isAbsolute(relative) || !relative.startsWith('packages/daemon/')) throw new Error('Native baseline file outside declared checkout');
    if (upstreamRoot && hash(fs.readFileSync(path.join(upstreamRoot, relative))) !== receipt.originalNativeSourceHashes[relative]) throw new Error('Original native test source differs across physical checkouts');
    if (!/^[a-f0-9]{64}$/.test(receipt.originalNativeSourceHashes[relative] || '')) throw new Error('Missing raw native source SHA');
  }
  if (raw.testResults.some(file => file.name !== path.join(receipt.upstreamRoot, path.relative(receipt.upstreamRoot, file.name)))) throw new Error('Baseline raw native file is not canonical inside declared checkout');
  const relocated = relocateDaemonGroups(groups, receipt.upstreamRoot, upstreamRoot || receipt.upstreamRoot);
  return { receipt, groups: relocated, assessmentSha256: hash(readEvidence(directory, 'assessment.json', 1024 ** 2)), sourceRoot: receipt.upstreamRoot, targetRoot: upstreamRoot || receipt.upstreamRoot, scope: 'Explicit source-bound file relocation within declared checkouts only; raw titles and parameter identities are never normalized' };
}

function validateOriginalDaemonInputs(directory, receipt, manifest) {
  if (hash(readEvidence(directory, 'original-lock.json', 32 * 1024 ** 2)) !== manifest.originalLockSha256) throw new Error('Original raw lock changed');
  for (const [relative, digest] of Object.entries(manifest.originalSources)) if (hash(readEvidence(directory, `original-sources/${relative}`, 4 * 1024 ** 2)) !== digest) throw new Error('Original raw scanner source changed');
  if (hash(readEvidence(directory, 'original-digest-generator.mjs', 4 * 1024 ** 2)) !== digestGeneratorSha256) throw new Error('Original digest generator source changed');
  if (receipt.resourceBudget?.maxGrowthBytes !== 3 * 1024 ** 3 || receipt.resourceBudget.reserveBytes !== 1024 ** 3 || receipt.resourceBudget.maxLogBytes !== 2 * 1024 ** 2 || receipt.resourceBudget.timeoutMs !== 17 * 60_000 || receipt.hostedGitHubMarker !== true) throw new Error('Daemon hosted resource contract drift');
  if (!path.isAbsolute(receipt.producerRoot) || receipt.corpusRoot !== path.join(receipt.producerRoot, 'benchmarks/openrig-tab-fence') || JSON.stringify(receipt.producerInputs) !== JSON.stringify(producerInputs())) throw new Error('Producer/corpus source input drift');
}

function expectedDaemonCommand(name, receipt) {
  const sandbox = command => ['sandbox-exec', '-D', `IPC_ROOT=${receipt.physicalScratch}`, '-p', sandboxProfile, ...command];
  const patch = path.join(receipt.corpusRoot, 'fixed.patch');
  const commands = {
    install: ['npm', 'ci'], 'original-build': ['npm', 'run', 'build'],
    'system-ps-copy': ['/usr/bin/install', '-m', '0755', '/bin/ps', path.join(receipt.physicalScratch, 'bin/ps')],
    'native-platform-probe': sandbox(['node', 'scripts/ci-macos-process-probe.mjs']),
    'candidate-paths': ['git', 'apply', '--numstat', patch], 'candidate-apply': ['git', 'apply', '--check', patch], 'candidate-apply-write': ['git', 'apply', patch],
    'candidate-generate-digests': ['node', 'scripts/regen-edge-digests.mjs'], 'candidate-final-diff': ['git', 'diff', '--no-ext-diff', '--binary'],
    'candidate-verified-production-diff': ['git', 'diff', '--no-ext-diff', '--binary', 'HEAD'], 'candidate-verified-regression-diff': ['git', 'diff', '--no-ext-diff', '--no-index', '--', '/dev/null', 'packages/daemon/test/markdown-address-tab-fence.test.ts'],
  };
  for (const prefix of ['original', 'fixed']) {
    commands[prefix + '-native'] = sandbox(['npm', 'run', 'test', '-w', 'packages/daemon', '--', '--reporter=default', '--reporter=json', `--outputFile=${path.join(receipt.outputRoot, prefix + '-native.json')}`]);
    commands[prefix + '-frozen-oracle'] = ['node', '--experimental-strip-types', '--test', '--test-reporter=tap', path.join(receipt.corpusRoot, 'regression.mjs')];
  }
  if (!commands[name]) throw new Error('Unknown daemon command');
  return commands[name];
}

function validateDaemonProcesses(directory, receipt, expectedNames) {
  if (receipt.executions.length !== expectedNames.length) throw new Error('Incomplete daemon process inventory');
  const finiteInteger = value => Number.isFinite(value) && Number.isSafeInteger(value) && value >= 0;
  const start = Date.parse(receipt.startedAt); const end = Date.parse(receipt.completedAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || !finiteInteger(receipt.durationMs) || receipt.durationMs !== end - start || receipt.durationMs > 17 * 60_000) throw new Error('Daemon phase deadline/timestamp drift');
  let previousEnd = start;
  for (const [i, e] of receipt.executions.entries()) {
    const exit = ['original-frozen-oracle', 'candidate-verified-regression-diff'].includes(e.name) ? 1 : 0;
    if (e.name !== expectedNames[i] || e.stdout !== `${e.name}/stdout.log` || e.stderr !== `${e.name}/stderr.log` || e.exitCode !== exit || e.reason || e.error || e.signal || e.descendantCleanup?.survivingAtClose !== 0 || e.descendantCleanup?.observationFailed !== false) throw new Error('Daemon native process incomplete or unsuccessful');
    const at = Date.parse(e.startedAt);
    if (!Number.isFinite(at) || !finiteInteger(e.durationMs) || at < previousEnd || at + e.durationMs > end || !finiteInteger(e.descendantCleanup.observed) || typeof e.descendantCleanup.requested !== 'boolean' || typeof e.descendantCleanup.scope !== 'string' || JSON.stringify(e.command) !== JSON.stringify(expectedDaemonCommand(e.name, receipt))) throw new Error('Daemon process argv/duration/cleanup drift');
    previousEnd = at + e.durationMs;
    let logBytes = 0;
    for (const stream of ['stdout', 'stderr']) { const bytes = readEvidence(directory, e[stream], 2 * 1024 ** 2); if (hash(bytes) !== e[stream + 'Sha256'] || bytes.length !== e.finalResources?.[stream + 'Bytes']) throw new Error('Daemon raw process bytes changed'); logBytes += bytes.length; }
    const resources = e.finalResources;
    if (!finiteInteger(resources.availableBytes) || !finiteInteger(resources.stdoutBytes) || !finiteInteger(resources.stderrBytes) || !Number.isSafeInteger(resources.growthBytes) || !finiteInteger(e.budgetGrowthBytes) || e.budgetGrowthBytes !== Math.max(0, resources.growthBytes) || logBytes > 2 * 1024 ** 2 || resources.availableBytes < 1024 ** 3 || e.budgetGrowthBytes > 3 * 1024 ** 3 || !e.taskFootprint?.before || !e.taskFootprint?.after) throw new Error('Daemon process resource evidence incomplete');
    for (const observation of [e.taskFootprint.before, e.taskFootprint.after]) {
      const paths = [receipt.physicalScratch, receipt.upstreamRoot, receipt.outputRoot];
      if (observation.units !== 'KiB' || JSON.stringify(observation.paths) !== JSON.stringify(paths) || typeof observation.raw !== 'string') throw new Error('Task footprint unavailable or redirected');
      const rows = observation.raw.trimEnd().split('\n');
      if (rows.length !== paths.length || rows.some((row, index) => { const match = /^(\d+)\t(.+)$/.exec(row); return !match || !finiteInteger(Number(match[1])) || match[2] !== paths[index]; })) throw new Error('Malformed finite task footprint');
    }
  }
}

function validateCandidateSourceReplay(directory, receipt) {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'testlore-daemon-source-replay-'));
  try {
    for (const relative of sourcePaths) {
      const target = path.join(scratch, relative); fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, readEvidence(directory, `original-sources/${relative}`, 4 * 1024 ** 2));
    }
    const result = spawnSync('git', ['apply', path.join(corpus, 'fixed.patch')], { cwd: scratch, encoding: 'utf8', timeout: 5000, maxBuffer: 1024 ** 2 });
    if (result.status !== 0) throw new Error('Bound candidate patch does not apply to raw original scanner bytes');
    for (const relative of sourcePaths) if (hash(fs.readFileSync(path.join(scratch, relative))) !== hash(readEvidence(directory, `fixed-sources/${relative}`, 4 * 1024 ** 2)) || hash(fs.readFileSync(path.join(scratch, relative))) !== receipt.fixedSourceHashes[relative]) throw new Error('Candidate raw source is not the bound patch result');
  } finally { fs.rmSync(scratch, { recursive: true, force: true }); }
}

export function validateDaemonPair(baselineDirectory, fixedDirectory, expectedProducer, manifest) {
  const fixed = JSON.parse(readEvidence(fixedDirectory, 'assessment.json', 1024 ** 2));
  const baseline = validateDaemonBaseline(baselineDirectory, expectedProducer, manifest);
  if (fixed.schemaVersion !== 1 || fixed.repository !== manifest.repository || fixed.phase !== 'paired-candidate' || fixed.suite !== 'daemon' || fixed.status !== 'bounded-candidate-preserves-original-native-leg' || fixed.legQualified !== true || fixed.qualified !== false || JSON.stringify(fixed.producer) !== JSON.stringify(expectedProducer) || fixed.revision !== manifest.revision || fixed.nodeVersion !== process.version || fixed.manifestSha256 !== baseline.receipt.manifestSha256 || fixed.originalLockSha256 !== manifest.originalLockSha256 || JSON.stringify(fixed.originalSources) !== JSON.stringify(manifest.originalSources) || !path.isAbsolute(fixed.upstreamRoot) || !path.isAbsolute(fixed.physicalScratch) || !path.isAbsolute(fixed.outputRoot) || fixed.baselineBinding?.assessmentSha256 !== baseline.assessmentSha256 || fixed.baselineBinding.sourceRoot !== baseline.sourceRoot || fixed.baselineBinding.targetRoot !== fixed.upstreamRoot || JSON.stringify(fixed.baselineBinding.producer) !== JSON.stringify(expectedProducer) || JSON.stringify(fixed.originalInventory) !== JSON.stringify(baseline.receipt.originalInventory)) throw new Error('Paired daemon producer/input/baseline authority drift');
  validateOriginalDaemonInputs(fixedDirectory, fixed, manifest);
  validateDaemonProcesses(fixedDirectory, fixed, ['install', 'original-build', 'system-ps-copy', 'native-platform-probe', 'original-frozen-oracle', 'candidate-paths', 'candidate-apply', 'candidate-apply-write', 'candidate-generate-digests', 'candidate-final-diff', 'fixed-frozen-oracle', 'fixed-native', 'candidate-verified-production-diff', 'candidate-verified-regression-diff']);
  const relocated = relocateDaemonGroups(baseline.groups, baseline.sourceRoot, fixed.upstreamRoot);
  const fixedBytes = readEvidence(fixedDirectory, 'fixed-native.json', 32 * 1024 ** 2);
  const candidateRaw = JSON.parse(fixedBytes);
  const candidateGroups = daemonFullSuiteObservation(candidateRaw, fixed.upstreamRoot, fixed.fixedDaemonGroupSources);
  validateDaemonGroupSources(fixedDirectory, fixed, 'original'); validateDaemonGroupSources(fixedDirectory, fixed, 'fixed');
  if (hash(fixedBytes) !== fixed.fixedInventory?.sha256 || candidateGroups.total !== fixed.fixedInventory.total || candidateGroups.passed !== fixed.fixedInventory.passed) throw new Error('Candidate native outcome hash/count drift');
  const red = assertOracleCounts(readEvidence(fixedDirectory, 'original-frozen-oracle/stdout.log', 2 * 1024 ** 2).toString(), 0, 16, 16);
  const green = assertOracleCounts(readEvidence(fixedDirectory, 'fixed-frozen-oracle/stdout.log', 2 * 1024 ** 2).toString(), 16, 0, 16);
  if (JSON.stringify(red.names) !== JSON.stringify(green.names) || JSON.stringify(red) !== JSON.stringify(fixed.originalOracle) || JSON.stringify(green) !== JSON.stringify(fixed.fixedOracle) || fixed.frozenNativeAssertions !== 16) throw new Error('Independent frozen assertion names/counts changed');
  const frozenFile = path.join(fixed.upstreamRoot, 'packages/daemon/test/markdown-address-tab-fence.test.ts');
  preservesFullSuiteGroups(relocated, candidateGroups, frozenFile);
  assertNewRegression(daemonFrozenCases(candidateRaw, frozenFile), frozenFile, green.names);
  if (JSON.stringify(fixed.originalNativeSourceHashes) !== JSON.stringify(baseline.receipt.originalNativeSourceHashes) || Object.keys(fixed.fixedNativeSourceHashes ?? {}).length !== Object.keys(baseline.receipt.originalNativeSourceHashes).length + 1) throw new Error('Original native source inventory changed');
  for (const [relative, digest] of Object.entries(baseline.receipt.originalNativeSourceHashes)) if (fixed.fixedNativeSourceHashes[relative] !== digest) throw new Error('Original native assertion source changed');
  if (fixed.fixedNativeSourceHashes['packages/daemon/test/markdown-address-tab-fence.test.ts'] !== manifest.protectedArtifacts['markdown-address-tab-fence.test.ts']) throw new Error('Frozen native test bytes changed');
  const expectedCandidate = JSON.parse(fs.readFileSync(path.join(corpus, 'candidate.json')));
  if (JSON.stringify(fixed.candidate) !== JSON.stringify(expectedCandidate) || hash(fs.readFileSync(path.join(corpus, 'fixed.patch'))) !== expectedCandidate.patchSha256 || fixed.generatorSourceSha256 !== digestGeneratorSha256 || hash(readEvidence(fixedDirectory, 'generated-skill-edge-digests.json', 4 * 1024 ** 2)) !== fixed.generatedDigestSha256 || hash(readEvidence(fixedDirectory, 'complete-upstream.patch', 4 * 1024 ** 2)) !== fixed.completePatchSha256) throw new Error('Candidate patch/generated digest bytes changed');
  for (const relative of sourcePaths) if (hash(readEvidence(fixedDirectory, `fixed-sources/${relative}`, 4 * 1024 ** 2)) !== fixed.fixedSourceHashes?.[relative]) throw new Error('Fixed raw scanner source bytes changed');
  if (fixed.fixedSourceHashes['scripts/skill-edge-digests.generated.json'] !== fixed.generatedDigestSha256) throw new Error('Derived digest source binding drift');
  const assembled = Buffer.concat([readEvidence(fixedDirectory, 'candidate-verified-production-diff/stdout.log', 4 * 1024 ** 2), readEvidence(fixedDirectory, 'candidate-verified-regression-diff/stdout.log', 4 * 1024 ** 2)]);
  if (!assembled.equals(readEvidence(fixedDirectory, 'complete-upstream.patch', 4 * 1024 ** 2))) throw new Error('Reviewable patch differs from retained verified diff output');
  validateCandidateSourceReplay(fixedDirectory, fixed);
  return { status: 'paired-daemon-full-native-evidence-verified', legQualified: true, qualified: false, omissionAuthority: false, producer: expectedProducer, revision: manifest.revision, baselineAssessmentSha256: baseline.assessmentSha256, fixedAssessmentSha256: hash(readEvidence(fixedDirectory, 'assessment.json', 1024 ** 2)), original: baseline.receipt.originalInventory, fixed: fixed.fixedInventory, frozenNativeAssertions: 16, completePatchSha256: fixed.completePatchSha256, generatedDigestSha256: fixed.generatedDigestSha256, physicalRoots: { baseline: baseline.sourceRoot, fixed: fixed.upstreamRoot }, scope: baseline.scope, limitations: fixed.limitations };
}

function daemonGroupProfile() {
  const bytes = fs.readFileSync(path.join(corpus, 'daemon-full-suite-groups.json'));
  const profile = JSON.parse(bytes);
  if (hash(bytes) !== daemonGroupProfileSha256 || profile.suite !== 'daemon' || profile.upstreamRevision !== '8376d390140b761800430b143cc4131c1f020e42') throw new Error('Prospective daemon full-suite profile changed');
  return profile;
}

export function daemonFullSuiteObservation(json, upstream, sourceHashes) {
  const observation = fullSuiteGroupObservation(json);
  assertReviewedDuplicateGroups(observation, daemonGroupProfile(), upstream, sourceHashes);
  if (json.testResults.some(file => file.name !== path.join(upstream, path.relative(upstream, file.name)) || path.relative(upstream, file.name).startsWith('..') || !path.relative(upstream, file.name).startsWith('packages/daemon/'))) throw new Error('Daemon raw full-suite file outside declared canonical checkout');
  return observation;
}

function relocateDaemonGroups(observation, sourceRoot, targetRoot) {
  return { ...observation, groups: new Map([...observation.groups].map(([identity, statuses]) => { const raw = JSON.parse(identity); return [JSON.stringify([path.join(targetRoot, path.relative(sourceRoot, raw[0])), ...raw.slice(1)]), statuses]; })) };
}

function daemonFrozenCases(json, frozenFile) {
  const files = json.testResults.filter(file => file.name === frozenFile);
  if (files.length !== 1) throw new Error('Missing or duplicated frozen daemon native file');
  return inventory({ ...json, numTotalTests: 16, numPassedTests: 16, testResults: files });
}

function validateDaemonGroupSources(directory, receipt, prefix, freshRoot) {
  const profile = daemonGroupProfile();
  const sources = receipt[prefix + 'DaemonGroupSources'];
  if (!sources || JSON.stringify(sources) !== JSON.stringify(profile.sources) || receipt.daemonGroupProfileSha256 !== daemonGroupProfileSha256) throw new Error('Daemon full-suite source profile drift');
  for (const [relative, digest] of Object.entries(profile.sources)) {
    if (hash(readEvidence(directory, `${prefix}-group-sources/${relative}`, 4 * 1024 ** 2)) !== digest || (freshRoot && hash(fs.readFileSync(path.join(freshRoot, relative))) !== digest)) throw new Error('Daemon parameter-source or fixture bytes changed');
  }
}

export function inventory(json) {
  if (!json || !Array.isArray(json.testResults) || json.success !== true || json.numFailedTests !== 0 || json.numFailedTestSuites !== 0 || (json.numRuntimeErrorTestSuites !== undefined && json.numRuntimeErrorTestSuites !== 0)) throw new Error('Native JSON is missing or unsuccessful');
  const cases = new Map();
  for (const file of json.testResults) {
    if (typeof file.name !== 'string' || file.status !== 'passed' || !Array.isArray(file.assertionResults)) throw new Error('Missing or failed native assertions');
    for (const item of file.assertionResults) {
      if (!Array.isArray(item.ancestorTitles) || typeof item.title !== 'string') throw new Error('Missing assertion identity');
      const identity = JSON.stringify([file.name, ...item.ancestorTitles, item.title]);
      if (cases.has(identity)) throw new Error('Ambiguous native case identity');
      if (!['passed', 'pending', 'todo', 'skipped'].includes(item.status)) throw new Error('Failed or unknown native case');
      cases.set(identity, item.status);
    }
  }
  const passed = [...cases.values()].filter(status => status === 'passed').length;
  if (!cases.size || json.numTotalTests !== cases.size || json.numPassedTests !== passed) throw new Error('Empty or inconsistent native inventory');
  return cases;
}

export function preservesCases(original, candidate) {
  for (const [name, status] of original) {
    if (candidate.get(name) !== status) throw new Error(`Original native assertion changed or disappeared: ${name}`);
  }
  return true;
}

export function preservesExactCases(original, candidate, allowedAdditional = []) {
  preservesCases(original, candidate);
  const allowed = new Set(allowedAdditional);
  if (allowed.size !== allowedAdditional.length || [...allowed].some(identity => original.has(identity)) || candidate.size !== original.size + allowed.size) throw new Error('Unexpected native assertion cardinality');
  for (const identity of candidate.keys()) if (!original.has(identity) && (!allowed.has(identity) || candidate.get(identity) !== 'passed')) throw new Error('Unexpected or unexercised additional native assertion');
  for (const identity of allowed) if (candidate.get(identity) !== 'passed') throw new Error('Missing permitted frozen native assertion');
  return true;
}

// Full native runs can establish repeated raw groups without identifying their
// individual parameter inputs. This observation grants no selective authority.
export function fullSuiteGroupObservation(json) {
  if (!json || !Array.isArray(json.testResults) || json.success !== true || json.numFailedTests !== 0 || json.numFailedTestSuites !== 0 || (json.numRuntimeErrorTestSuites !== undefined && json.numRuntimeErrorTestSuites !== 0)) throw new Error('Native group JSON is missing or unsuccessful');
  const groups = new Map();
  let total = 0; let passed = 0;
  for (const file of json.testResults) {
    if (typeof file.name !== 'string' || file.status !== 'passed' || !Array.isArray(file.assertionResults)) throw new Error('Missing or failed native group assertions');
    for (const item of file.assertionResults) {
      if (!Array.isArray(item.ancestorTitles) || typeof item.title !== 'string' || typeof item.fullName !== 'string' || !['passed', 'pending', 'todo', 'skipped'].includes(item.status)) throw new Error('Incomplete or failed raw group outcome');
      const identity = JSON.stringify([file.name, item.ancestorTitles, item.title, item.fullName, { reported: Object.hasOwn(item, 'location'), value: item.location ?? null }]);
      const statuses = groups.get(identity) || {};
      statuses[item.status] = (statuses[item.status] || 0) + 1; groups.set(identity, statuses);
      total++; if (item.status === 'passed') passed++;
    }
  }
  if (!total || total !== json.numTotalTests || passed !== json.numPassedTests) throw new Error('Incomplete native group cardinalities');
  const duplicates = [...groups].filter(([, statuses]) => Object.values(statuses).reduce((a, b) => a + b, 0) > 1).map(([identity, statuses]) => ({ rawIdentity: JSON.parse(identity), statuses }));
  return { groups, duplicates, total, passed, individualIdentitiesQualified: false, omissionAuthority: false, scope: 'Nonselective original/fixed full native suite only; repeated parameter/input identities are unqualified' };
}

export function preservesFullSuiteGroups(original, candidate, allowedAdditionalFile = null) {
  const same = (a, b) => ['passed', 'pending', 'todo', 'skipped'].every(status => (a[status] || 0) === (b[status] || 0));
  for (const [identity, statuses] of original.groups) if (!candidate.groups.has(identity) || !same(statuses, candidate.groups.get(identity))) throw new Error('Original raw full-suite group dropped or changed');
  for (const identity of candidate.groups.keys()) if (!original.groups.has(identity) && JSON.parse(identity)[0] !== allowedAdditionalFile) throw new Error('Unexpected new raw full-suite group');
  return true;
}

export function tuiEphemeralPidObservation(observation, upstream, sourceSha256) {
  if (sourceSha256 !== tuiPidSourceSha256) throw new Error('Reviewed TUI ephemeral-case source changed');
  const prefix = 'reports an active or unidentifiable recovery reservation without changing its live socket (';
  const matching = [...observation.groups].filter(([identity]) => {
    const raw = JSON.parse(identity);
    return raw[0] === path.join(upstream, tuiPidSourcePath) && raw[2].startsWith(prefix) && raw[2] !== prefix + '"existing reservation")';
  });
  if (matching.length !== 1) throw new Error('Missing or extra TUI ephemeral PID outcome');
  const [identity, statuses] = matching[0];
  const raw = JSON.parse(identity);
  let input;
  try { input = JSON.parse(raw[2].slice(prefix.length, -1)); } catch { throw new Error('Malformed raw TUI PID title'); }
  if (!raw[2].endsWith(')') || raw[2] !== prefix + JSON.stringify(input) + ')' || raw[1].length !== 0 || raw[3] !== raw[2] || raw[4].reported || typeof input !== 'string' || !/^[1-9][0-9]*\n$/.test(input) || Number(input.trim()) > 2147483647 || statuses.passed !== 1 || Object.keys(statuses).length !== 1) throw new Error('Unreviewed TUI ephemeral PID identity or outcome');
  return { rawIdentity: raw, rawGroupKey: identity, actualPid: input.slice(0, -1), rawInput: input, statuses, sourcePath: tuiPidSourcePath, sourceSha256, individualInputIdentityQualified: false, inputEquivalenceEstablished: false, omissionAuthority: false };
}

export function preservesTuiFullSuiteObservations(original, candidate, upstream, originalSourceSha256, fixedSourceSha256) {
  const before = tuiEphemeralPidObservation(original, upstream, originalSourceSha256);
  const after = tuiEphemeralPidObservation(candidate, upstream, fixedSourceSha256);
  const retainedOriginal = { ...original, groups: new Map(original.groups) };
  const retainedCandidate = { ...candidate, groups: new Map(candidate.groups) };
  retainedOriginal.groups.delete(before.rawGroupKey);
  retainedCandidate.groups.delete(after.rawGroupKey);
  preservesFullSuiteGroups(retainedOriginal, retainedCandidate);
  return { original: before, fixed: after, stableRawGroups: retainedOriginal.groups.size, individualInputIdentityQualified: false, inputEquivalenceEstablished: false, omissionAuthority: false, scope: 'Both full native suites passed; one source-bound process.pid input observed independently each time. No assertion that these distinct inputs are equivalent.' };
}

export function assertReviewedDuplicateGroups(observation, profile, upstream, sourceHashes) {
  if (profile.individualInputIdentitiesQualified !== false || profile.inputEquivalenceEstablished !== false || profile.omissionAuthority !== false || !Array.isArray(profile.groups) || Object.keys(sourceHashes).length !== Object.keys(profile.sources).length || Object.entries(profile.sources).some(([file, digest]) => sourceHashes[file] !== digest)) throw new Error('Reviewed duplicate-group source binding differs');
  const expected = new Map(profile.groups.map(group => [JSON.stringify([path.join(upstream, group.rawIdentity[0]), ...group.rawIdentity.slice(1)]), JSON.stringify(group.statuses)]));
  if (expected.size !== profile.groups.length || observation.duplicates.length !== expected.size || observation.duplicates.some(group => expected.get(JSON.stringify(group.rawIdentity)) !== JSON.stringify(group.statuses))) throw new Error('Unknown or changed reviewed duplicate group');
  return true;
}

export function assertOracleCounts(text, expectedPass, expectedFail, total) {
  const names = [];
  for (const reader of ['daemon', 'shipped']) for (const marker of ['```', '~~~']) for (const ending of ['\n', '\r\n']) {
    const suffix = JSON.stringify(ending).replaceAll('\\', '\\\\');
    names.push(`${reader}: tab-indented ${marker} opener keeps sibling address (${suffix})`);
    names.push(`${reader}: tab-indented ${marker} closer keeps example heading hidden (${suffix})`);
  }
  const results = [...text.matchAll(/^(not ok|ok) (\d+) - (.+)$/gm)];
  const plans = [...text.matchAll(/^1\.\.(\d+)$/gm)];
  const fields = [...text.matchAll(/^# (tests|pass|fail|skipped|cancelled|todo) (\d+)$/gm)];
  if (!text.startsWith('TAP version 13\n') || plans.length !== 1 || Number(plans[0][1]) !== total || results.length !== total || fields.length !== 6 || new Set(fields.map(m => m[1])).size !== 6) throw new Error('Incomplete frozen TAP protocol');
  if (results.some((m, index) => Number(m[2]) !== index + 1 || m[3] !== names[index] || m.index > plans[0].index) || fields.some(m => m.index < plans[0].index)) throw new Error('Unknown, duplicate or truncated frozen TAP identity');
  const counts = Object.fromEntries(fields.map(m => [m[1], Number(m[2])]));
  if (results.filter(m => m[1] === 'ok').length !== expectedPass || results.filter(m => m[1] === 'not ok').length !== expectedFail) throw new Error('Frozen TAP result statuses contradict summary');
  if (counts.tests !== total || counts.pass !== expectedPass || counts.fail !== expectedFail || counts.skipped !== 0 || counts.cancelled !== 0 || counts.todo !== 0) {
    throw new Error(`Frozen oracle outcome mismatch: ${JSON.stringify(counts)}`);
  }
  return { ...counts, names: results.map(m => m[3]) };
}

export function assertFreshOutput(output) {
  if (fs.existsSync(output)) throw new Error('Pilot output already exists; preserve prior evidence');
  return true;
}

export function pilotEnvironment(createdScratch, upstream, ambient = process.env) {
  // Match upstream pwd -P: sandbox IPC subpaths must name the physical socket root.
  const scratch = fs.realpathSync(createdScratch);
  const env = { PATH: ambient.PATH, HOME: path.join(scratch, 'home'), TMPDIR: scratch, TMUX_TMPDIR: scratch, CI: 'true', TERM: 'xterm-256color', LANG: 'en_US.UTF-8', TESTLORE_PILOT_UPSTREAM: upstream };
  // The unchanged installed-scenario runner admits actual GitHub CI explicitly.
  // Keep its nonsecret marker; never manufacture hosted execution on a local run.
  if (ambient.GITHUB_ACTIONS === 'true') env.GITHUB_ACTIONS = 'true';
  return { scratch, env };
}

export function createPilotScratch(ambient = process.env, platform = process.platform) {
  // Upstream tests.yml uses RUNNER_TEMP/opr-test.XXXXXX, then pwd -P.
  // macOS os.tmpdir() is substantially longer and breaks genuine Unix sockets.
  const parent = ambient.GITHUB_ACTIONS === 'true' && ambient.RUNNER_TEMP
    ? ambient.RUNNER_TEMP : platform === 'darwin' ? '/tmp' : os.tmpdir();
  return fs.realpathSync(fs.mkdtempSync(path.join(parent, 'opr-test.')));
}

export function assertNewRegression(cases, filename, expectedNames) {
  const entries = [...cases].map(([identity, status]) => ({ parts: JSON.parse(identity), status })).filter(item => item.parts[0] === filename);
  const expected = expectedNames.map(name => name.replaceAll('\\\\', '\\'));
  if (entries.length !== expected.length || entries.some(item => item.status !== 'passed' || item.parts.length !== 2 || !expected.includes(item.parts[1])) || new Set(entries.map(item => item.parts[1])).size !== expected.length) throw new Error('Native suite did not exercise every unchanged frozen regression');
  return entries.length;
}

export function assertCandidatePaths(numstat, allowedPaths) {
  const proposed = numstat.trim().split('\n').map(line => line.split('\t'));
  if (proposed.some(parts => parts.length !== 3 || !allowedPaths.includes(parts[2])) || sourcePaths.some(relative => !proposed.some(parts => parts[2] === relative))) {
    throw new Error('Candidate patch proposes unapproved or incomplete scanner paths');
  }
  return proposed.map(parts => parts[2]);
}

async function main(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!['--upstream', '--output', '--phase', '--suite', '--baseline'].includes(argv[i]) || !argv[i + 1]) throw new Error('Use --upstream DIR --output DIR --phase baseline|candidate|paired-candidate --suite repo|daemon|cli|tui|ui');
    args[argv[i].slice(2)] = argv[i + 1];
  }
  if (!args.upstream || !args.output || !['baseline', 'candidate', 'paired-candidate'].includes(args.phase) || !['repo', 'daemon', 'cli', 'tui', 'ui'].includes(args.suite) || (args.phase === 'paired-candidate' && (args.suite !== 'daemon' || !args.baseline || process.env.GITHUB_ACTIONS !== 'true')) || (args.phase !== 'paired-candidate' && args.baseline)) throw new Error('Invalid pilot arguments');
  const upstream = fs.realpathSync(args.upstream);
  const output = path.resolve(args.output);
  assertFreshOutput(output);
  fs.mkdirSync(output, { recursive: true });
  const manifest = JSON.parse(fs.readFileSync(path.join(corpus, 'manifest.json')));
  let cliGroupProfile;
  if (args.suite === 'cli') {
    const profileBytes = fs.readFileSync(path.join(corpus, 'cli-full-suite-groups.json'));
    if (hash(profileBytes) !== cliGroupProfileSha256) throw new Error('Reviewed CLI full-suite profile changed');
    cliGroupProfile = JSON.parse(profileBytes);
    if (cliGroupProfile.upstreamRevision !== manifest.revision || cliGroupProfile.suite !== 'cli') throw new Error('CLI full-suite profile does not bind this public revision');
  }
  const started = Date.now();
  const deadline = started + 17 * 60_000;
  const { scratch, env } = pilotEnvironment(createPilotScratch(), upstream);
  fs.mkdirSync(env.HOME);
  const producerGit = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: workspace, encoding: 'utf8' });
  if (producerGit.status !== 0) throw new Error('TestLore producer revision unavailable');
  const producer = { revision: producerGit.stdout.trim(), repository: process.env.GITHUB_REPOSITORY ?? null, runId: process.env.GITHUB_RUN_ID ?? null, runAttempt: process.env.GITHUB_RUN_ATTEMPT ?? null };
  const hostedDaemon = args.suite === 'daemon' && env.GITHUB_ACTIONS === 'true';
  const receipt = { schemaVersion: 1, phase: args.phase, suite: args.suite, repository: manifest.repository, revision: manifest.revision, manifestSha256: hash(fs.readFileSync(path.join(corpus, 'manifest.json'))), attribution: manifest.attribution, producer, producerRoot: workspace, corpusRoot: corpus, producerInputs: producerInputs(), upstreamRoot: upstream, outputRoot: output, originalSources: manifest.originalSources, originalLockSha256: manifest.originalLockSha256, executions: [], qualified: false, status: 'running', startedAt: new Date(started).toISOString(), physicalScratch: scratch, hostedGitHubMarker: env.GITHUB_ACTIONS === 'true', limitations: [...manifest.limitations], resourceBudget: { timeoutMs: 17 * 60_000, reserveBytes: 1024 ** 3, maxGrowthBytes: (hostedDaemon ? 3 : 1) * 1024 ** 3, maxLogBytes: 2 * 1024 ** 2, growthScope: 'Whole runner available-space delta can be negative when space is reclaimed; nonnegative budgetGrowthBytes is max(0, delta), own du footprints are reported separately', justification: hostedDaemon ? 'Previous incomplete native daemon suite used 1.25 GiB global growth with about 100 GB available; finite hosted 3 GiB allowance retains reserve and complete assertions' : 'Original 1 GiB bound retained' } };
  const write = () => fs.writeFileSync(path.join(output, 'assessment.json'), JSON.stringify(receipt, null, 2) + '\n');
  write();
  const git = (...values) => {
    const result = spawnSync('git', values, { cwd: upstream, env, encoding: 'utf8' });
    if (result.status !== 0) throw new Error(`Git verification failed: ${values[0]}`);
    return result.stdout.trim();
  };
  const verifyProtected = () => {
    for (const [relative, digest] of Object.entries(manifest.protectedArtifacts)) if (hash(fs.readFileSync(path.join(corpus, relative))) !== digest) throw new Error(`Protected contract changed: ${relative}`);
    if (hash(fs.readFileSync(path.join(upstream, 'package-lock.json'))) !== manifest.originalLockSha256) throw new Error('Upstream lock differs');
  };
  const execute = async (name, command, acceptedExit = 0, nativeSandbox = false) => {
    const directory = path.join(output, name);
    fs.mkdirSync(directory);
    const stdoutPath = path.join(directory, 'stdout.log');
    const stderrPath = path.join(directory, 'stderr.log');
    const at = Date.now();
    const footprint = () => {
      const result = spawnSync('du', ['-sk', scratch, upstream, output], { env, encoding: 'utf8', timeout: 5000, maxBuffer: 1024 ** 2 });
      return result.status === 0 ? { units: 'KiB', raw: result.stdout, paths: [scratch, upstream, output] } : { unavailable: true, error: result.error?.code ?? result.status };
    };
    const before = hostedDaemon ? footprint() : undefined;
    let actual = command;
    let childEnv = env;
    if (nativeSandbox) {
      if (process.platform !== 'darwin') throw new Error('Native package parity requires macOS');
      actual = ['sandbox-exec', '-D', `IPC_ROOT=${scratch}`, '-p', sandboxProfile, ...command];
      // Upstream package suites use env -i without this Docker-admission marker.
      childEnv = { ...env }; delete childEnv.GITHUB_ACTIONS;
    }
    const result = await boundedInstallProcess(actual[0], actual.slice(1), {
      cwd: upstream, directory, env: childEnv, timeoutMs: Math.max(1, deadline - Date.now()),
      maxLogBytes: receipt.resourceBudget.maxLogBytes, reserveBytes: receipt.resourceBudget.reserveBytes, maxGrowthBytes: receipt.resourceBudget.maxGrowthBytes,
      terminateDescendants: true,
    });
    const record = { name, command: actual, startedAt: new Date(at).toISOString(), ...result, budgetGrowthBytes: result.finalResources ? Math.max(0, result.finalResources.growthBytes) : null, ...(hostedDaemon ? { taskFootprint: { before, after: footprint() } } : {}), stdout: `${name}/stdout.log`, stderr: `${name}/stderr.log` };
    receipt.executions.push(record); write();
    if (result.reason || result.error || result.exitCode !== acceptedExit || !result.stdoutSha256 || !result.stderrSha256) throw new Error(`${name}: ${result.reason || `exit ${result.exitCode}`}`);
    return fs.readFileSync(stdoutPath, 'utf8');
  };
  const native = async prefix => {
    if (args.suite === 'repo') {
      await execute(prefix + '-build', ['npm', 'run', 'build']);
      await execute(prefix + '-lint', ['npm', 'run', 'lint']);
      await execute(prefix + '-repo', ['npm', 'run', 'test:repo']);
      for (const pkg of ['cli', 'daemon', 'tui']) await execute(prefix + '-pack-' + pkg, ['npm', 'pack', '--dry-run', '--json', '--ignore-scripts', '--workspace', `packages/${pkg}`]);
      await execute(prefix + '-installed-scenario', ['bash', 'scripts/run-pr-scenarios.sh']);
      return null;
    }
    if (args.suite === 'tui') {
      const sourceDigest = hash(fs.readFileSync(path.join(upstream, tuiPidSourcePath)));
      if (sourceDigest !== tuiPidSourceSha256) throw new Error('Reviewed original TUI PID test source differs');
      receipt[prefix + 'TuiPidSourceSha256'] = sourceDigest; write();
    }
    const verifyCliSources = () => {
      const sources = Object.fromEntries(Object.keys(cliGroupProfile.sources).map(relative => [relative, hash(fs.readFileSync(path.join(upstream, relative)))]));
      if (Object.entries(cliGroupProfile.sources).some(([relative, digest]) => sources[relative] !== digest)) throw new Error('Reviewed CLI parameter source changed');
      return sources;
    };
    if (args.suite === 'cli') { receipt[prefix + 'CliGroupSources'] = verifyCliSources(); receipt.cliGroupProfileSha256 = cliGroupProfileSha256; write(); }
    const verifyDaemonSources = () => {
      const sources = Object.fromEntries(Object.keys(daemonGroupProfile().sources).map(relative => [relative, hash(fs.readFileSync(path.join(upstream, relative)))]));
      if (JSON.stringify(sources) !== JSON.stringify(daemonGroupProfile().sources)) throw new Error('Prospective daemon parameter source or fixture changed');
      return sources;
    };
    if (args.suite === 'daemon') {
      receipt[prefix + 'DaemonGroupSources'] = verifyDaemonSources(); receipt.daemonGroupProfileSha256 = daemonGroupProfileSha256;
      for (const relative of Object.keys(receipt[prefix + 'DaemonGroupSources'])) { const target = path.join(output, prefix + '-group-sources', relative); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.copyFileSync(path.join(upstream, relative), target); }
      write();
    }
    const jsonPath = path.join(output, prefix + '-native.json');
    await execute(prefix + '-native', ['npm', 'run', 'test', '-w', `packages/${args.suite}`, '--', '--reporter=default', '--reporter=json', `--outputFile=${jsonPath}`], 0, true);
    if (args.suite === 'tui' && hash(fs.readFileSync(path.join(upstream, tuiPidSourcePath))) !== tuiPidSourceSha256) throw new Error('Native checks changed reviewed TUI PID test source');
    if (args.suite === 'cli') verifyCliSources();
    if (args.suite === 'daemon') verifyDaemonSources();
    if (fs.statSync(jsonPath).size > 32 * 1024 ** 2) throw new Error('Native JSON evidence exceeds the declared 32 MiB bound');
    const raw = fs.readFileSync(jsonPath);
    const parsed = JSON.parse(raw);
    if (args.suite === 'daemon') receipt[prefix + 'NativeSourceHashes'] = Object.fromEntries(parsed.testResults.map(file => {
      const relative = path.relative(upstream, file.name);
      if (relative.startsWith('..') || path.isAbsolute(relative) || !relative.startsWith('packages/daemon/')) throw new Error('Native file outside pinned daemon checkout');
      return [relative, hash(fs.readFileSync(path.join(upstream, relative)))];
    }));
    let cases;
    let groups;
    try {
      if (args.suite === 'daemon') groups = daemonFullSuiteObservation(parsed, upstream, receipt[prefix + 'DaemonGroupSources']);
      else cases = inventory(parsed);
    }
    catch (error) {
      if (!['tui', 'cli'].includes(args.suite) || error.message !== 'Ambiguous native case identity') throw error;
      groups = fullSuiteGroupObservation(parsed);
      // The pinned TUI suite exposes this one repeated parameter title without
      // input values or locations. Do not generalize that omission of identity.
      if (args.suite === 'tui') {
        const duplicate = groups.duplicates[0];
        const expectedTitle = 'recovers after a killed reservation owner without removing a concurrent replacement (delayed=$delayed)';
        if (groups.duplicates.length !== 1 || duplicate.rawIdentity[0] !== path.join(upstream, 'packages/tui/test/socket-concurrency.test.ts') || duplicate.rawIdentity[1].length !== 0 || duplicate.rawIdentity[2] !== expectedTitle || duplicate.rawIdentity[3] !== expectedTitle || duplicate.rawIdentity[4].reported || duplicate.statuses.passed !== 2 || Object.keys(duplicate.statuses).length !== 1) throw new Error('Unreviewed native parameter identity ambiguity');
        receipt.limitations.push(`${prefix}: two TUI delayed-parameter inputs share a raw title and have no reported location; individual input identities remain unqualified, group cardinality/status preservation is full-suite evidence only and grants no routing or omission authority`);
      } else {
        assertReviewedDuplicateGroups(groups, cliGroupProfile, upstream, receipt[prefix + 'CliGroupSources']);
        receipt.limitations.push(`${prefix}: 44 CLI parameter outcomes across 20 reviewed raw groups lack individual input identities; unchanged sources and exact full-suite raw group cardinality/status are checked, with no input equivalence or routing/omission authority`);
      }
      receipt[prefix + 'GroupObservation'] = { ...groups, groups: undefined };
    }
    if (args.suite === 'daemon') { receipt[prefix + 'GroupObservation'] = { ...groups, groups: undefined }; receipt.limitations.push(`${prefix}: prospective reviewed daemon profile confirmed eight passing parameter outcomes across two raw groups only; individual input identities and equivalence remain unqualified, with no routing or omission authority`); }
    const total = cases?.size ?? groups.total;
    const passed = cases ? [...cases.values()].filter(s => s === 'passed').length : groups.passed;
    receipt[prefix + 'Inventory'] = { sha256: hash(raw), total, passed, unexercised: total - passed, runtimeErrorCounter: parsed.numRuntimeErrorTestSuites ?? null, identityQualification: cases ? 'unique-native-named-cases' : 'raw-full-suite-groups-only' };
    if (parsed.numRuntimeErrorTestSuites === undefined) receipt.limitations.push(`${prefix}: native JSON does not report a runtime-error-suite counter; actual successful exit, success flag, complete named assertions and passing file statuses are checked`);
    write();
    return { cases, groups };
  };
  try {
    if (git('rev-parse', 'HEAD') !== manifest.revision || git('status', '--porcelain')) throw new Error('Original public checkout is not clean at the pinned revision');
    if (Number(process.versions.node.split('.')[0]) !== manifest.nodeMajor) throw new Error('Wrong Node major');
    verifyProtected();
    for (const [relative, digest] of Object.entries(manifest.originalSources)) if (hash(fs.readFileSync(path.join(upstream, relative))) !== digest) throw new Error(`Original source mismatch: ${relative}`);
    fs.writeFileSync(path.join(output, 'original-lock.json'), fs.readFileSync(path.join(upstream, 'package-lock.json')));
    const generatorBytes = fs.readFileSync(path.join(upstream, 'scripts/regen-edge-digests.mjs'));
    if (hash(generatorBytes) !== digestGeneratorSha256) throw new Error('Pinned digest generator differs');
    fs.writeFileSync(path.join(output, 'original-digest-generator.mjs'), generatorBytes);
    for (const relative of sourcePaths) {
      const target = path.join(output, 'original-sources', relative); fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, fs.readFileSync(path.join(upstream, relative)));
    }
    receipt.nodeVersion = process.version;
    await execute('install', ['npm', 'ci']);
    verifyProtected();
    if (args.suite !== 'repo') {
      await execute('original-build', ['npm', 'run', 'build']);
      const bin = path.join(scratch, 'bin'); fs.mkdirSync(bin);
      await execute('system-ps-copy', ['/usr/bin/install', '-m', '0755', '/bin/ps', path.join(bin, 'ps')]);
      await execute('native-platform-probe', ['node', 'scripts/ci-macos-process-probe.mjs'], 0, true);
      env.PATH = `${bin}${path.delimiter}${env.PATH}`;
    }
    // The unchanged native suite comes first. A red baseline never becomes a claimed fix.
    let baseline;
    if (args.phase === 'paired-candidate') {
      baseline = validateDaemonBaseline(args.baseline, producer, manifest, upstream);
      receipt.baselineBinding = { assessmentSha256: baseline.assessmentSha256, producer: baseline.receipt.producer, sourceRoot: baseline.sourceRoot, targetRoot: baseline.targetRoot, scope: baseline.scope };
      receipt.originalInventory = baseline.receipt.originalInventory;
      receipt.originalNativeSourceHashes = baseline.receipt.originalNativeSourceHashes;
      receipt.originalDaemonGroupSources = baseline.receipt.originalDaemonGroupSources; receipt.daemonGroupProfileSha256 = daemonGroupProfileSha256;
      for (const relative of Object.keys(receipt.originalDaemonGroupSources)) { const target = path.join(output, 'original-group-sources', relative); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.copyFileSync(path.join(upstream, relative), target); }
    }
    const originalCases = baseline ? { groups: baseline.groups } : await native('original');
    verifyProtected();
    const original = await execute('original-frozen-oracle', ['node', '--experimental-strip-types', '--test', '--test-reporter=tap', path.join(corpus, 'regression.mjs')], 1);
    receipt.originalOracle = assertOracleCounts(original, 0, manifest.expectedOracleCases, manifest.expectedOracleCases);
    if (args.phase === 'baseline') {
      receipt.status = 'native-baseline-and-independent-defect-reproduced';
      receipt.legQualified = true; // An aggregate upstream result requires every original/native leg.
      receipt.scope = `Original ${args.suite} leg and frozen current-module regression only`;
      return;
    }
    const candidate = JSON.parse(fs.readFileSync(path.join(corpus, 'candidate.json')));
    const patchPath = path.join(corpus, 'fixed.patch');
    if (candidate.patchSha256 !== hash(fs.readFileSync(patchPath))) throw new Error('Candidate patch digest mismatch');
    receipt.candidate = candidate;
    if (git('status', '--porcelain')) throw new Error('Original native checks changed tracked or untracked inputs');
    const patchStats = await execute('candidate-paths', ['git', 'apply', '--numstat', patchPath]);
    // The author can repair source; only the pinned upstream generator writes digest metadata.
    assertCandidatePaths(patchStats, sourcePaths);
    await execute('candidate-apply', ['git', 'apply', '--check', patchPath]);
    await execute('candidate-apply-write', ['git', 'apply', patchPath]);
    const changed = git('diff', 'HEAD', '--name-only').split('\n').filter(Boolean);
    if (!changed.length || changed.some(p => !manifest.candidateAllowedPaths.includes(p)) || sourcePaths.some(p => !changed.includes(p))) throw new Error('Candidate edits outside the complete scanner/digest scope');
    await execute('candidate-generate-digests', ['node', 'scripts/regen-edge-digests.mjs']);
    const generatedChanged = git('diff', 'HEAD', '--name-only').split('\n').filter(Boolean);
    if (generatedChanged.some(p => !manifest.candidateAllowedPaths.includes(p))) throw new Error('Digest generator changed unapproved files');
    const generatedDigest = fs.readFileSync(path.join(upstream, 'scripts/skill-edge-digests.generated.json'));
    fs.writeFileSync(path.join(output, 'generated-skill-edge-digests.json'), generatedDigest);
    receipt.generatedDigestSha256 = hash(generatedDigest);
    receipt.generatorSourceSha256 = hash(fs.readFileSync(path.join(upstream, 'scripts/regen-edge-digests.mjs')));
    await execute('candidate-final-diff', ['git', 'diff', '--no-ext-diff', '--binary']);
    const fixedSourceHashes = Object.fromEntries(generatedChanged.map(relative => [relative, hash(fs.readFileSync(path.join(upstream, relative)))]));
    receipt.fixedSourceHashes = fixedSourceHashes;
    for (const relative of sourcePaths) {
      const target = path.join(output, 'fixed-sources', relative); fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, fs.readFileSync(path.join(upstream, relative)));
    }
    verifyProtected();
    const fixed = await execute('fixed-frozen-oracle', ['node', '--experimental-strip-types', '--test', '--test-reporter=tap', path.join(corpus, 'regression.mjs')]);
    receipt.fixedOracle = assertOracleCounts(fixed, manifest.expectedOracleCases, 0, manifest.expectedOracleCases);
    if (JSON.stringify(receipt.originalOracle.names) !== JSON.stringify(receipt.fixedOracle.names)) throw new Error('Frozen assertion names changed');
    const frozenTest = path.join(upstream, 'packages/daemon/test/markdown-address-tab-fence.test.ts');
    if (fs.existsSync(frozenTest)) throw new Error('Frozen regression destination already exists');
    fs.copyFileSync(path.join(corpus, 'markdown-address-tab-fence.test.ts'), frozenTest);
    const fixedCases = await native('fixed');
    if (originalCases?.cases) {
      if (!fixedCases.cases) throw new Error('Candidate lost individual native identity qualification');
      const permitted = args.suite === 'daemon' ? receipt.fixedOracle.names.map(name => JSON.stringify([frozenTest, name.replaceAll('\\\\', '\\')])) : [];
      preservesExactCases(originalCases.cases, fixedCases.cases, permitted);
    } else if (originalCases?.groups) {
      const candidateGroups = fixedCases.groups || fullSuiteGroupObservation(JSON.parse(fs.readFileSync(path.join(output, 'fixed-native.json'))));
      if (args.suite === 'tui') {
        receipt.tuiEphemeralPidObservation = preservesTuiFullSuiteObservations(originalCases.groups, candidateGroups, upstream, receipt.originalTuiPidSourceSha256, receipt.fixedTuiPidSourceSha256);
        receipt.limitations.push('One TUI native parameter is process.pid: both distinct raw PID names/inputs passed independently under unchanged source; input equivalence and individual identity preservation are unqualified, with no routing or omission authority');
      } else preservesFullSuiteGroups(originalCases.groups, candidateGroups, args.suite === 'daemon' ? frozenTest : null);
    }
    if (args.suite === 'daemon') receipt.frozenNativeAssertions = assertNewRegression(daemonFrozenCases(JSON.parse(fs.readFileSync(path.join(output, 'fixed-native.json'))), frozenTest), frozenTest, receipt.fixedOracle.names);
    verifyProtected();
    if (hash(fs.readFileSync(frozenTest)) !== manifest.protectedArtifacts['markdown-address-tab-fence.test.ts']) throw new Error('Protected native regression altered');
    for (const [relative, digest] of Object.entries(fixedSourceHashes)) if (hash(fs.readFileSync(path.join(upstream, relative))) !== digest) throw new Error('Native checks changed candidate source bytes');
    const finalChanged = git('diff', 'HEAD', '--name-only').split('\n').filter(Boolean);
    if (finalChanged.some(relative => !manifest.candidateAllowedPaths.includes(relative))) throw new Error('Original tracked oracle or configuration changed');
    const untracked = git('ls-files', '--others', '--exclude-standard').split('\n').filter(Boolean);
    if (untracked.length !== 1 || untracked[0] !== 'packages/daemon/test/markdown-address-tab-fence.test.ts') throw new Error('Unexpected untracked native inputs or missing frozen regression');
    const productionDiff = await execute('candidate-verified-production-diff', ['git', 'diff', '--no-ext-diff', '--binary', 'HEAD']);
    const regressionDiff = await execute('candidate-verified-regression-diff', ['git', 'diff', '--no-ext-diff', '--no-index', '--', '/dev/null', 'packages/daemon/test/markdown-address-tab-fence.test.ts'], 1);
    const completePatch = productionDiff + regressionDiff;
    fs.writeFileSync(path.join(output, 'complete-upstream.patch'), completePatch);
    receipt.completePatchSha256 = hash(completePatch);
    receipt.status = 'bounded-candidate-preserves-original-native-leg';
    receipt.scope = `Original/fixed ${args.suite} leg and unchanged frozen regression only`;
    receipt.legQualified = true;
  } catch (error) {
    receipt.status = 'inconclusive-or-rejected'; receipt.error = error.message;
    process.exitCode = 2;
  } finally {
    const completed = Date.now(); receipt.durationMs = completed - started; receipt.completedAt = new Date(completed).toISOString(); write();
    fs.rmSync(scratch, { recursive: true, force: true });
    console.log(JSON.stringify({ status: receipt.status, qualified: receipt.qualified, suite: args.suite, output }));
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 2; });
}
