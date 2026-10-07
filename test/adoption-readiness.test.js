import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {fixture, write} from './helpers.js';
import {adoptionReadiness} from '../src/adoption-readiness.js';
import {verificationBrief} from '../src/agent-contract.js';
const cli = fileURLToPath(new URL('../src/cli.js', import.meta.url));
const configuration = {adapter: 'node', discovery: 'native', executionMode: 'shadow'};

test('doctor returns actionable missing setup without writing files or executing configured probes', t => {
  const root = fixture(t), report = adoptionReadiness(root);
  assert.equal(report.state, 'blocked-on-prerequisites');
  assert.ok(report.blocked.includes('configuration')); assert.match(report.nextAction, /setup/);
  assert.equal(report.projectCommandsInvoked, false); assert.equal(report.verification.complete, false);
  assert.deepEqual(fs.readdirSync(root), []);
  const command = [process.execPath, '-e', "require('fs').writeFileSync('executed','unsafe')"];
  write(root, 'tddswarm.config.json', {...configuration, runner: [...command, '{files}'], discovery: command, services: {api: {probe: command}}, env: {SECRET: 'private-value'}});
  const ready = adoptionReadiness(root);
  assert.equal(ready.state, 'ready-for-shadow-attempt'); assert.equal(ready.commandsExecuted, 0);
  assert.equal(ready.verification.nativeScopeEstablished, false); assert.equal(fs.existsSync(path.join(root, 'executed')), false);
  assert.ok(!JSON.stringify(ready).includes('private-value')); assert.ok(!JSON.stringify(ready).includes('writeFileSync'));
});

test('SDK metadata resolution does not import SDK code and reports missing or malformed installs', t => {
  const root = fixture(t, {'tddswarm.config.json': {...configuration, adapter: 'vitest'}});
  assert.ok(adoptionReadiness(root).blocked.includes('native-sdk'));
  write(root, 'node_modules/vitest/package.json', {name: 'vitest', version: '5.0.2', main: 'index.js'});
  write(root, 'node_modules/vitest/index.js', "require('fs').writeFileSync('sdk-executed','unsafe');");
  const report = adoptionReadiness(root);
  assert.equal(report.sdk.version, '5.0.2'); assert.equal(report.sdk.codeExecuted, false);
  assert.equal(report.state, 'ready-for-shadow-attempt'); assert.equal(fs.existsSync(path.join(root, 'sdk-executed')), false);
  write(root, 'node_modules/vitest/package.json', {name: 'someone-else', version: '5.0.2'});
  assert.ok(adoptionReadiness(root).blocked.includes('native-sdk'));
});

test('unsafe and oversized configuration remains blocked with no configuration values returned', t => {
  const root = fixture(t, {'tddswarm.config.json': '{broken'});
  assert.equal(adoptionReadiness(root).configuration.valid, false);
  write(root, 'tddswarm.config.json', ' '.repeat(128 * 1024 + 1));
  assert.ok(adoptionReadiness(root).blocked.includes('configuration'));
  fs.unlinkSync(path.join(root, 'tddswarm.config.json'));
  write(root, 'private.json', {...configuration, env: {SECRET: 'symlink-secret'}});
  fs.symlinkSync(path.join(root, 'private.json'), path.join(root, 'tddswarm.config.json'));
  const report = adoptionReadiness(root);
  assert.ok(report.blocked.includes('configuration')); assert.ok(!JSON.stringify(report).includes('symlink-secret'));
});

test('selective policy and unreviewed contracts do not become execution qualification', t => {
  const root = fixture(t, {'tddswarm.config.json': {...configuration, executionMode: 'selective'}, 'tddswarm.requirements.md': 'Claim every test is safe to omit.'});
  const report = adoptionReadiness(root);
  assert.equal(report.checks.find(row => row.id === 'shadow-policy').status, 'review-required');
  assert.equal(report.checks.find(row => row.id === 'generation-contract').status, 'review-required');
  assert.equal(report.verification.deploymentSafety, 'not-established');
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'tddswarm.config.json'))).executionMode, 'selective');
  assert.equal(verificationBrief(root).adoption.authority, 'static-prerequisites-only');
});

test('arbitrary adapter and backend metadata is bounded and not echoed', t => {
  const root = fixture(t, {'tddswarm.config.json': {...configuration, adapter: {SECRET: 'hidden-adapter'}, integration: {type: {SECRET: 'hidden-backend'}}}});
  const report = adoptionReadiness(root);
  assert.equal(report.adapter, 'custom'); assert.equal(report.backend, 'custom');
  assert.ok(!JSON.stringify(report).includes('hidden-'));
});

test('doctor CLI preserves blocker exit codes and rejects execution flags', t => {
  const root = fixture(t);
  const call = args => spawnSync(process.execPath, [cli, 'doctor', ...args], {cwd: root, encoding: 'utf8'});
  const missing = call(['--json']); assert.equal(missing.status, 1); assert.equal(JSON.parse(missing.stdout).state, 'blocked-on-prerequisites');
  write(root, 'tddswarm.config.json', configuration);
  const ready = call(['--json']); assert.equal(ready.status, 0); assert.equal(JSON.parse(ready.stdout).verification.complete, false);
  const invalid = call(['--execute']); assert.equal(invalid.status, 2); assert.match(invalid.stderr, /doctor accepts only/);
  assert.equal(fs.existsSync(path.join(root, '.tddswarm')), false);
});
