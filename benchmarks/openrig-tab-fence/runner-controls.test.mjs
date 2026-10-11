import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { inventory, preservesCases, assertOracleCounts, assertCandidatePaths, assertFreshOutput, assertNewRegression, pilotEnvironment, createPilotScratch, fullSuiteGroupObservation, preservesFullSuiteGroups } from '../../scripts/openrig-defect-pilot.js';

const native = entries => ({ success: true, numTotalTests: entries.length, numPassedTests: entries.filter(([, status]) => status === 'passed').length, numFailedTests: 0, numFailedTestSuites: 0, numRuntimeErrorTestSuites: 0, testResults: [{ name: 'file', status: 'passed', assertionResults: entries.map(([title, status]) => ({ ancestorTitles: ['scope'], title, status })) }] });
test('preserves native named cases and distinguishes unexercised outcomes', () => {
  const original = inventory(native([['kept', 'passed'], ['opt-in', 'pending']]));
  const candidate = inventory(native([['kept', 'passed'], ['opt-in', 'pending'], ['new regression', 'passed']]));
  assert.equal(preservesCases(original, candidate), true);
  assert.throws(() => preservesCases(original, inventory(native([['kept', 'passed']]))));
  assert.throws(() => preservesCases(original, inventory(native([['kept', 'pending'], ['opt-in', 'pending']]))));
});
test('refuses failed, empty and ambiguous native inventories', () => {
  assert.throws(() => inventory({ success: false, testResults: [] }));
  assert.throws(() => inventory(native([])));
  assert.throws(() => inventory(native([['same', 'passed'], ['same', 'passed']])));
  assert.throws(() => inventory(native([['bug', 'failed']])));
  const truncated = native([['kept', 'passed']]); truncated.numTotalTests = 2;
  assert.throws(() => inventory(truncated));
  const runtimeError = native([['kept', 'passed']]); runtimeError.numRuntimeErrorTestSuites = 1;
  assert.throws(() => inventory(runtimeError));
  const olderNative = native([['kept', 'passed']]); delete olderNative.numRuntimeErrorTestSuites;
  assert.equal(inventory(olderNative).size, 1);
  const failedFile = native([['kept', 'passed']]); failedFile.testResults[0].status = 'failed';
  assert.throws(() => inventory(failedFile));
});
test('requires all frozen assertions to fail originally and pass after repair without skips', () => {
  const names = [];
  for (const reader of ['daemon', 'shipped']) for (const marker of ['```', '~~~']) for (const ending of ['\n', '\r\n']) {
    const suffix = JSON.stringify(ending).replaceAll('\\', '\\\\');
    names.push(`${reader}: tab-indented ${marker} opener keeps sibling address (${suffix})`);
    names.push(`${reader}: tab-indented ${marker} closer keeps example heading hidden (${suffix})`);
  }
  const tap = (pass, fail, skipped = 0) => 'TAP version 13\n' + names.map((name, index) => `${index < pass ? 'ok' : 'not ok'} ${index + 1} - ${name}`).join('\n') + `\n1..16\n# tests 16\n# pass ${pass}\n# fail ${fail}\n# skipped ${skipped}\n# cancelled 0\n# todo 0\n`;
  assert.equal(assertOracleCounts(tap(0, 16), 0, 16, 16).fail, 16);
  assert.equal(assertOracleCounts(tap(16, 0), 16, 0, 16).pass, 16);
  assert.throws(() => assertOracleCounts(tap(0, 16, 1), 0, 16, 16));
  assert.throws(() => assertOracleCounts(tap(15, 1), 16, 0, 16));
  assert.throws(() => assertOracleCounts('unrelated fatal startup error', 0, 16, 16));
  assert.throws(() => assertOracleCounts(tap(16, 0).slice(tap(16, 0).indexOf('# tests')), 16, 0, 16));
  assert.throws(() => assertOracleCounts(tap(16, 0).replace('ok 2 -', 'ok 1 -'), 16, 0, 16));
  assert.throws(() => assertOracleCounts(tap(16, 0).replace(/^ok 16 -.*\n/m, ''), 16, 0, 16));
  assert.throws(() => assertOracleCounts(tap(16, 0).replace('daemon:', 'unknown:'), 16, 0, 16));
});
test('refuses to overwrite any prior pilot output', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'testlore-pilot-output-control-'));
  try {
    assert.equal(assertFreshOutput(path.join(root, 'fresh')), true);
    assert.throws(() => assertFreshOutput(root));
    fs.writeFileSync(path.join(root, 'receipt'), 'prior evidence');
    assert.throws(() => assertFreshOutput(path.join(root, 'receipt')));
    assert.equal(fs.readFileSync(path.join(root, 'receipt'), 'utf8'), 'prior evidence');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
test('refuses new unapproved paths and incomplete scanner patches before mutation', () => {
  const first = 'packages/daemon/src/domain/markdown-address.ts';
  const second = 'packages/daemon/assets/plugins/openrig-core/skills/loading-addressable-markdown/scripts/resolve-markdown.mjs';
  const valid = `1\t1\t${first}\n1\t1\t${second}\n`;
  assert.deepEqual(assertCandidatePaths(valid, [first, second]), [first, second]);
  assert.throws(() => assertCandidatePaths(valid + '1\t0\tuntracked-agent-output.js\n', [first, second]));
  assert.throws(() => assertCandidatePaths(`1\t1\t${first}\n`, [first, second]));
  assert.throws(() => assertCandidatePaths('', [first, second]));
});
test('requires every new frozen regression in the actual native inventory', () => {
  const cases = new Map([[JSON.stringify(['regression.ts', 'first']), 'passed'], [JSON.stringify(['regression.ts', 'second']), 'passed']]);
  assert.equal(assertNewRegression(cases, 'regression.ts', ['first', 'second']), 2);
  assert.throws(() => assertNewRegression(cases, 'regression.ts', ['first', 'second', 'missing']));
  assert.throws(() => assertNewRegression(new Map(), 'regression.ts', ['first', 'second']));
  assert.throws(() => assertNewRegression(new Map([[JSON.stringify(['regression.ts', 'first']), 'pending']]), 'regression.ts', ['first']));
});
test('uses physical socket paths while preserving only actual nonsecret hosted markers', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'testlore-pilot-physical-control-'));
  try {
    fs.mkdirSync(path.join(root, 'real'));
    fs.symlinkSync(path.join(root, 'real'), path.join(root, 'alias'));
    const physical = fs.realpathSync(path.join(root, 'real'));
    const ambient = { PATH: '/fixture/bin', GITHUB_ACTIONS: 'true', GITHUB_TOKEN: 'fake-sensitive-control', CODEX_HOME: '/fake/provider', HOME: '/fake/user' };
    const prepared = pilotEnvironment(path.join(root, 'alias'), '/pinned/upstream', ambient);
    assert.equal(prepared.scratch, physical);
    assert.equal(prepared.env.TMPDIR, physical);
    assert.equal(prepared.env.TMUX_TMPDIR, physical);
    assert.equal(prepared.env.HOME, path.join(physical, 'home'));
    assert.equal(prepared.env.GITHUB_ACTIONS, 'true');
    assert.equal(prepared.env.GITHUB_TOKEN, undefined);
    assert.equal(prepared.env.CODEX_HOME, undefined);
    assert.equal(pilotEnvironment(path.join(root, 'alias'), '/pinned/upstream', { PATH: '/fixture/bin' }).env.GITHUB_ACTIONS, undefined);
    assert.equal(pilotEnvironment(path.join(root, 'alias'), '/pinned/upstream', { PATH: '/fixture/bin', GITHUB_ACTIONS: 'false' }).env.GITHUB_ACTIONS, undefined);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
test('matches upstream short hosted scratch and leaves room for genuine native Unix sockets', () => {
  const hosted = createPilotScratch({ GITHUB_ACTIONS: 'true', RUNNER_TEMP: '/tmp' }, 'darwin');
  const local = createPilotScratch({ RUNNER_TEMP: '/ignored/untrusted-marker' }, 'darwin');
  try {
    for (const scratch of [hosted, local]) {
      assert.equal(path.dirname(scratch), fs.realpathSync('/tmp'));
      assert.match(path.basename(scratch), /^opr-test\.[A-Za-z0-9]{6}$/);
      // Native fixtures create nested runtime directories below the suite root.
      const nestedSocket = path.join(scratch, 'home', 'openrig-socket-test.XXXXXX', '.openrig', 'run', 'tui-tui-1.sock');
      assert.ok(Buffer.byteLength(nestedSocket) <= 100, 'native fixture socket exceeds upstream limit');
    }
    const oldMacScratch = '/private/var/folders/36/tjdph2t965j8snz9_vkdnw0r0000gn/T/testlore-openrig-RyCzQz';
    assert.ok(Buffer.byteLength(path.join(oldMacScratch, 'openrig-utf8-XXXXXX', 'control.sock')) > 100);
    const upstreamHostedSocket = path.join('/Users/runner/work/_temp/opr-test.XXXXXX', 'home', 'openrig-socket-test.XXXXXX', '.openrig', 'run', 'tui-tui-1.sock');
    assert.ok(Buffer.byteLength(upstreamHostedSocket) <= 100);
  } finally { for (const scratch of [hosted, local]) fs.rmSync(scratch, { recursive: true, force: true }); }
});
test('separates nonselective raw group cardinality from individual parameter identities', () => {
  const fixture = statuses => {
    const json = native(statuses.map(status => ['same raw parameter title', status]));
    for (const a of json.testResults[0].assertionResults) a.fullName = 'scope same raw parameter title';
    return json;
  };
  const originalJson = fixture(['passed', 'passed']);
  assert.throws(() => inventory(originalJson), /Ambiguous/);
  const original = fullSuiteGroupObservation(originalJson);
  assert.equal(original.individualIdentitiesQualified, false);
  assert.equal(original.omissionAuthority, false);
  assert.equal(original.duplicates.length, 1);
  assert.deepEqual(original.duplicates[0].statuses, { passed: 2 });
  assert.equal(preservesFullSuiteGroups(original, fullSuiteGroupObservation(fixture(['passed', 'passed']))), true);
  assert.throws(() => preservesFullSuiteGroups(original, fullSuiteGroupObservation(fixture(['passed']))));
  assert.throws(() => preservesFullSuiteGroups(original, fullSuiteGroupObservation(fixture(['passed', 'passed', 'passed']))));
  assert.throws(() => preservesFullSuiteGroups(original, fullSuiteGroupObservation(fixture(['passed', 'pending']))));
  const drift = fixture(['passed', 'passed']); drift.testResults[0].assertionResults[0].fullName = 'renamed input';
  assert.throws(() => preservesFullSuiteGroups(original, fullSuiteGroupObservation(drift)));
  const located = fixture(['passed', 'passed']); for (const a of located.testResults[0].assertionResults) a.location = { line: 12, column: 1 };
  assert.throws(() => preservesFullSuiteGroups(original, fullSuiteGroupObservation(located)));
  const failed = fixture(['passed', 'failed']); assert.throws(() => fullSuiteGroupObservation(failed));
  const truncated = fixture(['passed', 'passed']); truncated.numTotalTests = 3; assert.throws(() => fullSuiteGroupObservation(truncated));
});
