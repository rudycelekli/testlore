import test from 'node:test';
import assert from 'node:assert/strict';
import {assessHost, safeHostEnvironment, boundedProcess, executableIdentity, qualifyHosts, packageSnapshot, hostEvents} from '../scripts/host-qualification.js';
import {boundedSummary, summarizeRun} from '../src/mcp-worker.js';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fixture, write} from './helpers.js';

function successfulObservation() {
  const entrypoint = {sha256: 'a'.repeat(64)}, failedCases = [{id: 'observed-identity', file: 'test/fault.test.js', name: 'independent value remains one'}];
  const executedFiles = ['test/fault.test.js', 'test/preserved.test.js'];
  const observed = [
    {mode: 'readonly', entrypoint, tools: ['testlore_brief', 'testlore_status'], calls: [
      {name: 'testlore_brief', result: {authority: 'advisory', execution: {projectCommandsInvoked: false}}},
      {name: 'testlore_status', result: {present: false, projectCommandsInvoked: false, reason: 'no-retained-run'}}]},
    {mode: 'execution', entrypoint, tools: ['testlore_brief', 'testlore_status', 'testlore_plan', 'testlore_verify'], calls: [
      {name: 'testlore_plan', result: {authority: 'routing-proposal', complete: true}},
      {name: 'testlore_verify', result: {verdict: 'failed', executed: true, complete: true, outcomes: {failed: 1}, failedCases, executedFiles}}]}
  ];
  return {entrypoint, observed, processResult: {status: 'completed', exitCode: 0},
    finalMessage: JSON.stringify({verdict: 'failed', failedCases, executedFiles, uncertainty: 'Fixture observations do not establish deployment safety or defect effectiveness.',
      nextAction: 'Repair the value to match the independent expectation and rerun the full suite.', deploymentSafety: 'not-established'})};
}

test('host qualification requires actual scoped tool observations and an actionable final account', () => {
  assert.equal(assessHost(successfulObservation()).qualified, true);
  for (const alter of [
    input => input.observed.splice(0, 2),
    input => {input.observed[1].calls[1].result.complete = false;},
    input => {input.observed[1].calls[1].result.verdict = 'passed-in-observed-scope';},
    input => {input.observed[1].calls[1].result.failedCases[0].id = null;},
    input => {input.observed[1].entrypoint = {sha256: 'wrong'};},
    input => {input.observed[1].incomplete = true;},
    input => {input.observed[0].tools.push('testlore_verify');},
    input => {input.finalMessage = JSON.stringify({verdict: 'failed'});},
    input => {input.finalMessage = 'null';},
    input => {input.finalMessage = '0';},
    input => {const summary = JSON.parse(input.finalMessage); summary.failedCases = {}; input.finalMessage = JSON.stringify(summary);},
    input => {input.processResult = {status: 'timeout', exitCode: null, reason: 'deadline-exceeded'};}
  ]) {const input = successfulObservation(); alter(input); assert.equal(assessHost(input).qualified, false);}
});

test('no observations, host spawn failures and malformed final output never become qualified', () => {
  const result = assessHost({processResult: {status: 'not-started', reason: 'ENOENT'}, observed: [], finalMessage: 'all good', entrypoint: {sha256: 'unknown'}});
  assert.equal(result.qualified, false);
  assert.ok(result.reasons.includes('readonly-server-not-started'));
  assert.ok(result.reasons.includes('execution-server-not-started'));
  assert.equal(result.observedFailure, null);
});

test('native streamed authentication errors retain the observed cause without a provider fallback', () => {
  const events = hostEvents('claude', JSON.stringify({type: 'system', subtype: 'api_retry', error_status: 401, error: 'authentication_failed', attempt: 1}) + '\n');
  assert.equal(events.nativeApiRetriesObserved, 1);
  const input = successfulObservation(); input.hostErrors = events.errors;
  const assessment = assessHost(input);
  assert.equal(assessment.qualified, false); assert.match(assessment.reasons.join(','), /authentication_failed/);
  assert.match(assessment.nextAction, /subscription login/);
});

test('immutable archive qualification rejects installed source drift and mismatched source identity', async t => {
  const sourceSha = 'a'.repeat(40), root = fixture(t, {
    'package/package.json': {name: 'testlore', version: '0.0.0-fixture', gitHead: sourceSha, bin: {testlore: 'src/cli.js'}},
    'package/src/cli.js': "console.log('unused fixture entrypoint');\n"
  });
  const archive = path.join(root, 'fixture.tgz'), entrypoint = path.join(root, 'package/src/cli.js');
  const tar = spawnSync('tar', ['-czf', archive, '-C', root, 'package']);
  assert.equal(tar.status, 0);
  const options = {entrypoint, archive, expectedArchiveSha256: executableIdentity(archive).sha256, expectedSourceSha: sourceSha, timeoutMs: 1000};
  const report = await qualifyHosts(options); t.after(() => fs.rmSync(report.workspace, {recursive: true, force: true}));
  assert.equal(report.archive.installedSourceFilesMatched, 2);
  assert.equal(report.complete, false); assert.ok(report.hosts.every(host => host.status === 'not-started'));
  await assert.rejects(qualifyHosts({...options, expectedSourceSha: 'b'.repeat(40)}), /gitHead/);
  const before = packageSnapshot(entrypoint).sha256;
  write(root, 'package/src/cli.js', "console.log('changed installed bytes');\n");
  assert.notEqual(packageSnapshot(entrypoint).sha256, before);
  await assert.rejects(qualifyHosts(options), /differs from immutable archive/);
});

test('host environment retains subscription login context and removes provider keys/routing/helpers', () => {
  const env = safeHostEnvironment({PATH: '/bin', HOME: '/home/fixture', CODEX_HOME: '/codex',
    CLAUDE_CODE_OAUTH_TOKEN: 'subscription-token', ANTHROPIC_API_KEY: 'paid-key', OPENAI_API_KEY: 'paid-key',
    OPENROUTER_API_KEY: 'paid-key', CLAUDE_CODE_USE_BEDROCK: '1', AWS_ACCESS_KEY_ID: 'paid-key',
    GOOGLE_APPLICATION_CREDENTIALS: '/private/credential', NODE_OPTIONS: '--require=untrusted', CLAUDE_CODE_API_KEY_HELPER: 'untrusted'});
  assert.deepEqual(Object.keys(env).sort(), ['CLAUDE_CODE_OAUTH_TOKEN', 'CODEX_HOME', 'HOME', 'PATH']);
});

test('bounded native host process preserves timeout, output overflow and not-started outcomes', async () => {
  const missing = await boundedProcess('/testlore/no-such-host', [], {timeoutMs: 1000});
  assert.equal(missing.status, 'not-started'); assert.equal(missing.reason, 'ENOENT');
  const timeout = await boundedProcess(process.execPath, ['-e', 'setTimeout(()=>{},10000)'], {timeoutMs: 100});
  assert.equal(timeout.status, 'timeout'); assert.equal(timeout.exitCode, null);
  const overflow = await boundedProcess(process.execPath, ['-e', "process.stdout.write('x'.repeat(100000))"], {timeoutMs: 1000, maximumBytes: 1000});
  assert.equal(overflow.status, 'failed'); assert.equal(overflow.reason, 'output-limit-exceeded');
  assert.ok(overflow.stdout.length <= 1000);
  const nativeRetry = await boundedProcess(process.execPath, ['-e', `console.log(JSON.stringify({type:'system',subtype:'api_retry',error_status:401,error:'authentication_failed'}));setTimeout(()=>{},10000);`], {timeoutMs: 1000, stopOnNativeRetry: true});
  assert.equal(nativeRetry.status, 'failed'); assert.equal(nativeRetry.reason, 'native-host-retry-refused:401:authentication_failed');
  assert.match(executableIdentity(process.execPath).sha256, /^[a-f0-9]{64}$/);
});

test('large agent summaries keep failed identities, scope counts and next action without upgrading completeness', () => {
  const failed = Array.from({length: 200}, (_, i) => ({id: `failure-${i}`, file: `test/${i}.test.js`, name: 'independent expected behavior '.repeat(500), status: 'failed'}));
  const run = summarizeRun({tests: failed, executed: true, complete: true, exitCode: 1,
    executedTests: failed.map(row => row.file)}, 'shadow', {json: '.tddswarm/last-run.json', markdown: '.tddswarm/last-run.md'});
  const summary = boundedSummary(run);
  assert.equal(summary.complete, false); assert.equal(summary.observedComplete, true);
  assert.equal(summary.verdict, 'failed'); assert.equal(summary.outcomes.failed, 200);
  assert.equal(summary.failedCaseCount, 200); assert.equal(summary.failedCases[0].id, 'failure-0');
  assert.equal(summary.executedFileCount, 200); assert.equal(summary.deploymentSafety, 'not-established');
  assert.match(summary.nextAction, /repair.*full suite/);
  assert.ok(Buffer.byteLength(JSON.stringify(summary)) <= 65536);
  for (const report of [{executed: false, complete: false, exitCode: 2}, {executed: true, complete: false, exitCode: 0}]) {
    const incomplete = summarizeRun(report, 'shadow', null);
    assert.equal(incomplete.verdict, 'incomplete'); assert.match(incomplete.nextAction, /Repair.*rerun/);
  }
});

test('4096-byte agent summaries retain first failure and reject invalid budgets', () => {
  const failedCases = Array.from({length: 200}, (_, i) => ({id: `failure-${i}`, file: `test/${i}.test.js`, name: '\u0000🚨'.repeat(10000)}));
  const value = {kind: 'agent-verification-run', authority: 'observed-run', complete: true, executed: true, verdict: 'failed', exitCode: 1,
    outcomes: {available: true, passed: 0, failed: 200, skipped: 0}, failedCases,
    error: '\u0000🚨'.repeat(10000), scopeLimitation: '\u0000🚨'.repeat(10000),
    nextAction: 'Inspect failed identities, repair the independent defect, and rerun the full suite.',
    receipts: {json: '.tddswarm/last-run.json', markdown: '.tddswarm/last-run.md'}};
  const summary = boundedSummary(value, 4096);
  assert.ok(Buffer.byteLength(JSON.stringify(summary)) <= 4096);
  assert.equal(summary.complete, false); assert.equal(summary.presentation.truncated, true);
  assert.equal(summary.presentation.maximumBytes, 4096); assert.equal(summary.failedCaseCount, 200);
  assert.equal(summary.failedCases[0].id, 'failure-0'); assert.equal(summary.failedCases[0].file, 'test/0.test.js');
  assert.deepEqual(summary.receipts, value.receipts); assert.match(summary.nextAction, /repair/);
  for (const budget of [0, 4095, 65537, NaN, Infinity, 4096.5, '4096']) assert.throws(() => boundedSummary(value, budget), /4096 to 65536/);
});
