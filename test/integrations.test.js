import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { externalPlan, externalRun } from '../src/integrations.js';
import { aqeCapabilities, aqeGenerate } from '../src/adapters/aqe.js';
function fixture(t, content) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tddswarm-integration-test-')); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  execFileSync('git', ['init', '-q', root]); execFileSync('git', ['-C', root, '-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '--allow-empty', '-qm', 'baseline']);
  const program = path.join(root, 'adapter.cjs'); fs.writeFileSync(program, content); return { root, executable: process.execPath, args: [program] };
}
test('Nx uses graph-native affected discovery and passes pinned references', t => {
  const f = fixture(t, `const a=process.argv.slice(2); if(a[0]==='show'){if(!a.includes('--affected')||!a.some(x=>/^--base=[a-f0-9]{40}$/.test(x)))process.exit(4); console.log(JSON.stringify(['web','lib']));}else{console.log(JSON.stringify(a));}`);
  const config = { integration: { ...f, type: 'nx' } }; const result = externalRun(f.root, config, { base: 'HEAD' });
  assert.equal(result.exitCode, 0); assert.deepEqual(result.plan.targets, ['web', 'lib']); assert.ok(result.command.includes('--projects=web,lib'));
});
test('Nx fails closed on unavailable executable and malformed discovery', t => {
  const f = fixture(t, `console.log('not json')`); assert.equal(externalPlan(f.root, { integration: { ...f, type: 'nx' } }).complete, false);
  assert.equal(externalRun(f.root, { integration: { type: 'nx', executable: '/missing-nx' } }).executed, false);
});
test('Bazel follows declared labels, never guesses source targets, and falls back for unmapped inputs', t => {
  const f = fixture(t, `console.log('//app:unit_test')`); const config = { integration: { ...f, type: 'bazel', fileLabels: { 'src/a.js': ['//app:a'] } } };
  const affected = externalPlan(f.root, config, { changed: ['src/a.js'] }); assert.match(affected.command[3], /rdeps/); assert.equal(affected.mode, 'affected');
  const full = externalPlan(f.root, config, { changed: ['BUILD'] }); assert.equal(full.mode, 'full'); assert.deepEqual(full.reasons, ['unmapped-file-label-full-fallback']);
  const invalid = externalPlan(f.root, { integration: { ...f, type: 'bazel', fileLabels: { 'a': ['bad-label)'] } } }, { changed: ['a'] }); assert.equal(invalid.complete, false);
});
test('testmon initial selection is explicitly runtime delegated; shadow disables selection', t => {
  const f = fixture(t, `console.log(JSON.stringify(process.argv.slice(2)))`); const config = { integration: { ...f, type: 'pytest-testmon' } };
  const initial = externalPlan(f.root, config); assert.equal(initial.mode, 'initial-full'); assert.equal(initial.complete, false); assert.equal(initial.targets, null);
  const shadow = externalRun(f.root, config, { shadow: true }); assert.ok(shadow.command.includes('--testmon-noselect')); assert.equal(shadow.initialFull, true);
});
test('AQE bridge uses supported direct CLI, stages candidates, and preserves upstream estimate distinction', t => {
  const f = fixture(t, `const fs=require('fs'),path=require('path');const a=process.argv.slice(2);if(a.includes('--help')){console.log('generate --framework --format --output');}else{fs.writeFileSync(a[a.indexOf('--output')+1],JSON.stringify({tests:[{testFile:path.join(process.cwd(),'add.test.js'),testCode:'import { add } from "'+process.cwd()+'/add.js"; test("adds",()=>{});',llmEnhanced:false,qualityGateResult:{passed:true}}],coverageEstimate:50}));}`);
  fs.writeFileSync(path.join(f.root, 'add.js'), 'export const add=(a,b)=>a+b;'); const command = [f.executable, ...f.args];
  assert.equal(aqeCapabilities(command).generation, true); const result = aqeGenerate(f.root, { command, target: 'add.js' });
  assert.equal(result.applied, false); assert.equal(result.measured.execution, false); assert.equal(result.upstream.coverageEstimate, 50); assert.match(fs.readFileSync(path.join(result.directory, 'add.test.js'), 'utf8'), /from "\.\/add.js"/);
  assert.throws(() => aqeGenerate(f.root, { role: 'reviewer' }), /does not implement/);
});

test('Bazel test failure exit 3 is complete execution; build failure exit 1 remains incomplete', t => {
  const f = fixture(t, `if(process.argv[2]==='query')console.log('//app:unit_test');else process.exit(Number(process.argv.at(-1)));`);
  const configuration = code => ({ integration: { ...f, type: 'bazel', options: [String(code)], fileLabels: { 'src/a.js': ['//app:a'] } } });
  const failedTest = externalRun(f.root, configuration(3), { changed: ['src/a.js'] });
  assert.equal(failedTest.exitCode, 3); assert.equal(failedTest.complete, true);
  const failedBuild = externalRun(f.root, configuration(1), { changed: ['src/a.js'] });
  assert.equal(failedBuild.exitCode, 1); assert.equal(failedBuild.complete, false);
});
