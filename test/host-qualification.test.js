import test from 'node:test';
import assert from 'node:assert/strict';
import {assessHost, safeHostEnvironment, boundedProcess, executableIdentity, qualifyHosts, packageSnapshot, hostEvents,
  readBoundedText, readObserverReceipt, executableDrift, assertCanonicalEntrypoint, main as hostMain, parseHostArguments} from '../scripts/host-qualification.js';
import {boundedSummary, summarizeRun} from '../src/mcp-worker.js';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fixture, write} from './helpers.js';

function successfulObservation() {
  const entrypoint = {sha256: 'a'.repeat(64)}, nodeIdentity = {sha256: 'b'.repeat(64)}, failedCases = [{id: 'observed-identity', file: 'test/fault.test.js', name: 'independent value remains one'}];
  const executedFiles = ['test/fault.test.js', 'test/preserved.test.js'];
  const observed = [
    {mode: 'readonly', entrypoint, node: nodeIdentity, tools: ['testlore_brief', 'testlore_status'], calls: [
      {id: 1, name: 'testlore_brief', arguments: {}, requestedAt: 100, respondedAt: 101, result: {authority: 'advisory', execution: {projectCommandsInvoked: false}}},
      {id: 2, name: 'testlore_status', arguments: {}, requestedAt: 102, respondedAt: 103, result: {present: false, projectCommandsInvoked: false, reason: 'no-retained-run'}}]},
    {mode: 'execution', entrypoint, node: nodeIdentity, tools: ['testlore_brief', 'testlore_status', 'testlore_plan', 'testlore_verify'], calls: [
      {id: 1, name: 'testlore_plan', arguments: {base: 'HEAD'}, requestedAt: 104, respondedAt: 105, result: {authority: 'routing-proposal', complete: true}},
      {id: 2, name: 'testlore_verify', arguments: {base: 'HEAD', mode: 'shadow'}, requestedAt: 106, respondedAt: 107, result: {verdict: 'failed', mode: 'shadow', executed: true, complete: true, outcomes: {failed: 1, passed: 1, skipped: 0}, failedCases, executedFiles}}]}
  ];
  return {entrypoint, nodeIdentity, observed, processResult: {status: 'completed', exitCode: 0},
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

test('host final account rejects invented failures, invented scope, renamed cases and duplicate or malformed entries', () => {
  for (const mutate of [
    summary => summary.failedCases.push({id: 'phantom', file: 'test/phantom.test.js', name: 'invented failure'}),
    summary => summary.executedFiles.push('test/phantom.test.js'),
    summary => {summary.failedCases[0].name = 'renamed observed failure';},
    summary => summary.failedCases.push({...summary.failedCases[0]}),
    summary => summary.executedFiles.push(summary.executedFiles[0]),
    summary => summary.failedCases.push(null),
    summary => {summary.failedCases[0].id = 123;},
    summary => summary.executedFiles.push({file: 'test/phantom.test.js'})
  ]) {
    const input = successfulObservation(), summary = JSON.parse(input.finalMessage); mutate(summary);
    input.finalMessage = JSON.stringify(summary);
    const result = assessHost(input);
    assert.equal(result.qualified, false); assert.ok(result.reasons.some(reason => /host-summary-(failure-identities|scope)-mismatch/.test(reason)));
  }
  const reordered = successfulObservation(), summary = JSON.parse(reordered.finalMessage);
  summary.executedFiles.reverse(); reordered.finalMessage = JSON.stringify(summary);
  assert.equal(assessHost(reordered).qualified, true);
});

test('native host evidence requires exact shadow arguments, response ordering and unambiguous finite timestamps', () => {
  for (const mutate of [
    input => {input.observed[1].calls[1].result.mode = 'full';},
    input => {input.observed[1].calls[0].arguments = {base: 'HEAD', root: '/unsafe'};},
    input => {input.observed[1].calls[0].arguments = {};},
    input => {input.observed[1].calls[1].arguments = {base: 'HEAD', mode: 'full'};},
    input => {input.observed[1].calls[1].arguments = {base: 'HEAD', mode: 'shadow', command: ['unsafe']};},
    input => {input.observed[1].calls[1].arguments = {mode: 'shadow'};},
    input => {input.observed[0].calls.push({...input.observed[0].calls[0]});},
    input => {input.observed[1].calls[1].id = input.observed[1].calls[0].id;},
    input => {delete input.observed[0].calls[0].id;},
    input => {delete input.observed[0].calls[0].respondedAt;},
    input => {input.observed[1].calls[0].requestedAt = Infinity;},
    input => {input.observed[1].calls[1].respondedAt = 105;},
    input => {input.observed[0].calls[0].respondedAt = 105;},
    input => {input.observed[0].calls[1].respondedAt = 105;},
    input => {input.observed[1].calls[0].respondedAt = 107;},
    input => {input.observed[1].node = {sha256: 'c'.repeat(64)};}
  ]) {const input = successfulObservation(); mutate(input); assert.equal(assessHost(input).qualified, false);}
  const sameMillisecond = successfulObservation();
  for (const receipt of sameMillisecond.observed) for (const call of receipt.calls) call.requestedAt = call.respondedAt = 100;
  assert.equal(assessHost(sameMillisecond).qualified, true);
});

test('synthetic native host fixture requires exactly one failure, one preserved pass and zero skips', () => {
  for (const alter of [
    run => {run.outcomes.passed = 0;}, run => {run.outcomes.passed = 2;}, run => {run.outcomes.skipped = 1;},
    run => {run.failedCases = [];}, run => {run.failedCases.push({...run.failedCases[0]});}
  ]) {const input = successfulObservation(); alter(input.observed[1].calls[1].result); assert.equal(assessHost(input).qualified, false);}
});

test('CLI rejects reused receipts and invalid options before invoking a sentinel host; API validates its timeout first', async t => {
  const root = fixture(t, {'package.json': {name: 'testlore', bin: {testlore: 'src/cli.js'}}, 'src/cli.js': "console.log('fixture');"});
  const entrypoint = path.join(root, 'src/cli.js'), output = path.join(root, 'previous.json'), freshOutput = path.join(root, 'fresh.json');
  const marker = path.join(root, 'host-called'), host = path.join(root, 'sentinel-host');
  fs.writeFileSync(host, `#!/usr/bin/env node\nrequire('node:fs').writeFileSync(${JSON.stringify(marker)},'called');process.exit(9);\n`, {mode: 0o700});
  fs.writeFileSync(output, 'previous evidence');
  const base = ['--run', '--entrypoint', entrypoint, '--codex', host, '--output', freshOutput];
  for (const argv of [
    ['--run', '--entrypoint', entrypoint, '--codex', host, '--output', output],
    [...base, '--run'], [...base, '--output', output], [...base, '--unknown', 'value'],
    [...base, '--timeout-ms'], [...base, '--archive', '--timeout-ms', '1000'],
    [...base, '--timeout-ms', '0'], [...base, '--timeout-ms', '120001']
  ]) {
    await assert.rejects(hostMain(argv), /new path|Duplicate|Unknown|Missing|timeout/);
    assert.equal(fs.existsSync(marker), false); assert.equal(fs.existsSync(freshOutput), false); assert.equal(fs.readFileSync(output, 'utf8'), 'previous evidence');
  }
  for (const timeoutMs of [0, 120001, NaN, Infinity, 1000.5, null, '1000']) {
    await assert.rejects(qualifyHosts({entrypoint: '/unreadable-before-timeout-validation', codex: host, timeoutMs}), /timeout/);
    assert.equal(fs.existsSync(marker), false);
  }
  const defaults = parseHostArguments(base); assert.equal(defaults.timeoutMs, 90000);
  const report = await qualifyHosts({entrypoint}); t.after(() => fs.rmSync(report.workspace, {recursive: true, force: true}));
  assert.equal(report.timeoutMs, 90000); assert.equal(report.complete, false);
  const newReceipt = path.join(root, 'new-receipt.json');
  assert.equal(await hostMain(['--run', '--entrypoint', entrypoint, '--output', newReceipt]), 1);
  const saved = JSON.parse(fs.readFileSync(newReceipt, 'utf8')); t.after(() => fs.rmSync(saved.workspace, {recursive: true, force: true}));
  assert.equal(saved.complete, false); assert.equal(fs.statSync(newReceipt).mode & 0o777, 0o600);
  assert.equal(fs.existsSync(marker), false);
});

test('native host file evidence rejects oversized, symlinked, malformed and noncanonical inputs and detects executable drift', async t => {
  const root = fixture(t, {'package.json': {name: 'testlore', bin: {testlore: 'src/cli.js'}}, 'src/cli.js': "console.log('canonical');", 'foo/cli.js': "console.log('canonical');"});
  const entrypoint = path.join(root, 'src/cli.js'), identity = executableIdentity(entrypoint), snapshot = packageSnapshot(entrypoint);
  assert.doesNotThrow(() => assertCanonicalEntrypoint(identity, snapshot));
  assert.throws(() => assertCanonicalEntrypoint(executableIdentity(path.join(root, 'foo/cli.js')), snapshot), /exactly match/);
  await assert.rejects(qualifyHosts({entrypoint: path.join(root, 'foo/cli.js'), timeoutMs: 1000}), /exactly match/);
  assert.throws(() => assertCanonicalEntrypoint({...identity, sha256: '0'.repeat(64)}, snapshot), /exactly match/);
  const large = path.join(root, 'large.json'); fs.writeFileSync(large, 'x'.repeat(16385));
  assert.throws(() => readBoundedText(large, 16384), /byte budget/);
  const linked = path.join(root, 'linked.json'); fs.symlinkSync(large, linked);
  assert.throws(() => readBoundedText(linked, 16384), /regular file/);
  const receiptPath = path.join(root, 'receipt.json'), receipt = {schemaVersion: 1, transport: 'transparent-stdio-relay', mode: 'readonly',
    entrypoint: identity, node: identity, tools: ['testlore_brief', 'testlore_status'], calls: successfulObservation().observed[0].calls, incomplete: false, stderr: ''};
  fs.writeFileSync(receiptPath, JSON.stringify(receipt)); assert.deepEqual(readObserverReceipt(receiptPath, 'readonly'), receipt);
  assert.throws(() => readObserverReceipt(receiptPath, 'execution'), /schema/);
  fs.writeFileSync(receiptPath, JSON.stringify({...receipt, calls: 'invented'})); assert.throws(() => readObserverReceipt(receiptPath, 'readonly'), /schema/);
  fs.writeFileSync(receiptPath, 'x'.repeat(2 * 1024 * 1024 + 1)); assert.throws(() => readObserverReceipt(receiptPath, 'readonly'), /byte budget/);
  assert.deepEqual(executableDrift(identity, 'fixture-launcher'), []);
  fs.writeFileSync(entrypoint, "console.log('changed');"); assert.deepEqual(executableDrift(identity, 'fixture-launcher'), ['fixture-launcher-executable-identity-changed']);
  fs.unlinkSync(entrypoint); assert.match(executableDrift(identity, 'fixture-launcher')[0], /executable-unreadable/);
  assert.ok(hostEvents('codex', 'null\n').errors.includes('invalid-native-host-event-shape'));
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
    assert.equal(incomplete.verdict, 'incomplete');
    assert.match(incomplete.nextAction, /testlore doctor --json/);
    assert.match(incomplete.nextAction, /repair.*rerun full native verification/i);
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
