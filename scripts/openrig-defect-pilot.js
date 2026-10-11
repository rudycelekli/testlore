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
    if (!['--upstream', '--output', '--phase', '--suite'].includes(argv[i]) || !argv[i + 1]) throw new Error('Use --upstream DIR --output DIR --phase baseline|candidate --suite repo|daemon|cli|tui|ui');
    args[argv[i].slice(2)] = argv[i + 1];
  }
  if (!args.upstream || !args.output || !['baseline', 'candidate'].includes(args.phase) || !['repo', 'daemon', 'cli', 'tui', 'ui'].includes(args.suite)) throw new Error('Invalid pilot arguments');
  const upstream = fs.realpathSync(args.upstream);
  const output = path.resolve(args.output);
  assertFreshOutput(output);
  fs.mkdirSync(output, { recursive: true });
  const manifest = JSON.parse(fs.readFileSync(path.join(corpus, 'manifest.json')));
  const started = Date.now();
  const deadline = started + 17 * 60_000;
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'testlore-openrig-'));
  const env = { PATH: process.env.PATH, HOME: path.join(scratch, 'home'), TMPDIR: scratch, TMUX_TMPDIR: scratch, CI: 'true', TERM: 'xterm-256color', LANG: 'en_US.UTF-8', TESTLORE_PILOT_UPSTREAM: upstream };
  fs.mkdirSync(env.HOME);
  const receipt = { schemaVersion: 1, phase: args.phase, suite: args.suite, repository: manifest.repository, revision: manifest.revision, manifestSha256: hash(fs.readFileSync(path.join(corpus, 'manifest.json'))), attribution: manifest.attribution, executions: [], qualified: false, status: 'running', limitations: manifest.limitations };
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
    let actual = command;
    if (nativeSandbox) {
      if (process.platform !== 'darwin') throw new Error('Native package parity requires macOS');
      const profile = '(version 1)(allow default)(deny network-outbound)(allow network-outbound (remote ip "localhost:*"))(allow network-outbound (subpath (param "IPC_ROOT")))';
      actual = ['sandbox-exec', '-D', `IPC_ROOT=${scratch}`, '-p', profile, ...command];
    }
    const result = await boundedInstallProcess(actual[0], actual.slice(1), {
      cwd: upstream, directory, env, timeoutMs: Math.max(1, deadline - Date.now()),
      maxLogBytes: 2 * 1024 ** 2, reserveBytes: 1024 ** 3, maxGrowthBytes: 1024 ** 3,
      terminateDescendants: true,
    });
    const record = { name, command: actual, startedAt: new Date(at).toISOString(), ...result, stdout: `${name}/stdout.log`, stderr: `${name}/stderr.log` };
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
    const jsonPath = path.join(output, prefix + '-native.json');
    await execute(prefix + '-native', ['npm', 'run', 'test', '-w', `packages/${args.suite}`, '--', '--reporter=default', '--reporter=json', `--outputFile=${jsonPath}`], 0, true);
    if (fs.statSync(jsonPath).size > 32 * 1024 ** 2) throw new Error('Native JSON evidence exceeds the declared 32 MiB bound');
    const raw = fs.readFileSync(jsonPath);
    const cases = inventory(JSON.parse(raw));
    const parsed = JSON.parse(raw);
    receipt[prefix + 'Inventory'] = { sha256: hash(raw), total: cases.size, passed: [...cases.values()].filter(s => s === 'passed').length, unexercised: [...cases.values()].filter(s => s !== 'passed').length, runtimeErrorCounter: parsed.numRuntimeErrorTestSuites ?? null };
    if (parsed.numRuntimeErrorTestSuites === undefined) receipt.limitations.push(`${prefix}: native JSON does not report a runtime-error-suite counter; actual successful exit, success flag, complete named assertions and passing file statuses are checked`);
    write();
    return cases;
  };
  try {
    if (git('rev-parse', 'HEAD') !== manifest.revision || git('status', '--porcelain')) throw new Error('Original public checkout is not clean at the pinned revision');
    if (Number(process.versions.node.split('.')[0]) !== manifest.nodeMajor) throw new Error('Wrong Node major');
    verifyProtected();
    for (const [relative, digest] of Object.entries(manifest.originalSources)) if (hash(fs.readFileSync(path.join(upstream, relative))) !== digest) throw new Error(`Original source mismatch: ${relative}`);
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
    const originalCases = await native('original');
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
    verifyProtected();
    const fixed = await execute('fixed-frozen-oracle', ['node', '--experimental-strip-types', '--test', '--test-reporter=tap', path.join(corpus, 'regression.mjs')]);
    receipt.fixedOracle = assertOracleCounts(fixed, manifest.expectedOracleCases, 0, manifest.expectedOracleCases);
    if (JSON.stringify(receipt.originalOracle.names) !== JSON.stringify(receipt.fixedOracle.names)) throw new Error('Frozen assertion names changed');
    const frozenTest = path.join(upstream, 'packages/daemon/test/markdown-address-tab-fence.test.ts');
    if (fs.existsSync(frozenTest)) throw new Error('Frozen regression destination already exists');
    fs.copyFileSync(path.join(corpus, 'markdown-address-tab-fence.test.ts'), frozenTest);
    const fixedCases = await native('fixed');
    if (originalCases) preservesCases(originalCases, fixedCases);
    if (args.suite === 'daemon') receipt.frozenNativeAssertions = assertNewRegression(fixedCases, frozenTest, receipt.fixedOracle.names);
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
    receipt.durationMs = Date.now() - started; write();
    fs.rmSync(scratch, { recursive: true, force: true });
    console.log(JSON.stringify({ status: receipt.status, qualified: receipt.qualified, suite: args.suite, output }));
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 2; });
}
