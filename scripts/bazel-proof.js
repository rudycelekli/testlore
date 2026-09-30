#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {fileURLToPath} from 'node:url';
import { externalPlan, externalRun } from '../src/integrations.js';

const args = process.argv.slice(2);
const localBazelisk=fileURLToPath(new URL('../node_modules/.bin/bazelisk',import.meta.url));
const requested=args.includes('--executable')?args[args.indexOf('--executable')+1]:fs.existsSync(localBazelisk)?localBazelisk:'bazelisk';
const executable=requested.includes(path.sep)?path.resolve(requested):requested;
const output = path.resolve(args.includes('--output') ? args[args.indexOf('--output') + 1] : `.tddswarm/bazel-proof-${Date.now()}.json`);
if (fs.existsSync(output)) throw new Error('Proof output already exists; preserve prior receipts');
const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'tddswarm-bazel-proof-')));
const outputRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'tddswarm-bazel-output-')));
for (const name of Object.keys(process.env)) if (/KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL/i.test(name)) delete process.env[name];
process.env.PATH = path.dirname(process.execPath) + path.delimiter + (process.env.PATH || '');
process.env.USE_BAZEL_VERSION = '6.5.0';
const run = command => {
  const result = spawnSync(command[0], command.slice(1), { cwd: root, env: process.env, encoding: 'utf8', shell: false, timeout: 120000, maxBuffer: 4 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`${command[0]} failed: ${result.error?.message || result.stderr}`);
  return result.stdout.trim();
};
function sanitize(value) {
  if (typeof value === 'string') return value.replaceAll(outputRoot, '<bazel-output>').replaceAll(root, '<scratch-workspace>').replaceAll(path.resolve(executable), '<bazelisk-executable>').replaceAll(os.homedir(), '<user-home>');
  if (Array.isArray(value)) return value.map(sanitize);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, sanitize(item)]));
  return value;
}
try {
  const source = {
    '.bazelversion': '6.5.0\n', 'WORKSPACE': 'workspace(name = "tddswarm_native_proof")\n',
    '.gitignore': '.bazel-output/\nbazel-*\n',
    'BUILD': 'sh_test(name="alpha_test", srcs=["alpha.sh"], data=["alpha.txt"])\nsh_test(name="beta_test", srcs=["beta.sh"], data=["beta.txt"])\n',
    'alpha.sh': '#!/usr/bin/env bash\nset -eu\ntest "$(cat alpha.txt)" = "alpha"\n',
    'beta.sh': '#!/usr/bin/env bash\nset -eu\ntest "$(cat beta.txt)" = "beta"\n',
    'alpha.txt': 'alpha\n', 'beta.txt': 'beta\n'
  };
  for (const [file, content] of Object.entries(source)) { fs.writeFileSync(path.join(root, file), content); if (file.endsWith('.sh')) fs.chmodSync(path.join(root, file), 0o755); }
  run(['git', 'init', '-q']); run(['git', 'add', '.']);
  run(['git', '-c', 'user.name=TDDSwarm Proof', '-c', 'user.email=proof@example.invalid', 'commit', '-qm', 'native fixture baseline']);
  const config = { integration: { type: 'bazel', executable, args: ['--batch', `--output_user_root=${outputRoot}`], options: ['--test_output=errors', '--nocache_test_results'], fileLabels: { 'alpha.txt': ['//:alpha.txt'], 'beta.txt': ['//:beta.txt'] } } };
  const version = run([executable, '--version']);
  const baseline = externalRun(root, config, { base: 'HEAD', full: true });
  fs.writeFileSync(path.join(root, 'alpha.txt'), 'broken\n');
  const affectedPlan = externalPlan(root, config, { base: 'HEAD' });
  const affected = externalRun(root, config, { base: 'HEAD' });
  const full = externalRun(root, config, { base: 'HEAD', full: true });
  const shadow = externalRun(root, config, { base: 'HEAD', shadow: true });
  fs.writeFileSync(path.join(root, 'unknown-input.txt'), 'unknown\n');
  const unknownInputPlan = externalPlan(root, config, { base: 'HEAD' });
  const checks = {
    baselineBothPassed: baseline.exitCode === 0 && baseline.plan.targets.length === 2,
    onlyAffectedTarget: affectedPlan.complete === true && affectedPlan.targets.length === 1 && affectedPlan.targets[0] === '//:alpha_test',
    affectedDetectedFailure: affected.exitCode === 3 && affected.complete === true && /alpha_test.*FAILED/.test(affected.stdout + affected.stderr),
    fullDetectedFailure: full.exitCode === 3 && full.plan.targets.length === 2 && /beta_test.*PASSED/.test(full.stdout + full.stderr),
    shadowDetectedFailure: shadow.exitCode === 3 && shadow.plan.targets.length === 2 && shadow.shadow === true,
    unknownInputFallsBack: unknownInputPlan.mode === 'full' && unknownInputPlan.targets.length === 2 && unknownInputPlan.reasons.includes('unmapped-file-label-full-fallback')
  };
  const receipt = sanitize({ schemaVersion: 1, date: new Date().toISOString(), environment: { node: process.version, platform: process.platform, architecture: process.arch }, bazelVersion: version, fixture: source, configuration: config, baseline, affectedPlan, affected, full, shadow, unknownInputPlan, checks, valid: Object.values(checks).every(Boolean), limitations: ['Small native sh_test fixture only; no remote execution, toolchains, generated sources or monorepo claim.', 'Declared fileLabels are required; native query results define target scope.', 'Batch mode and disabled test-result cache make this a correctness proof, not a speed benchmark.', 'Bazel shadow runs full native scope, not a per-test identity equivalence comparison.'] });
  fs.mkdirSync(path.dirname(output), { recursive: true }); fs.writeFileSync(output, JSON.stringify(receipt, null, 2));
  console.log(JSON.stringify({ output, valid: receipt.valid, checks }, null, 2)); if (!receipt.valid) process.exitCode = 1;
} finally { fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(outputRoot, { recursive: true, force: true }); }
