import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fixture} from './helpers.js';
import {createFixture, boundedProcess, safeHostEnvironment, hostEvents} from '../scripts/host-qualification.js';
import {repairFixture} from '../scripts/fixture-repair-mcp.js';
import {fixtureSnapshot, assessRepairDiff, parseIndependentRun, assessRepairLoop, parseRepairArguments, qualifyRepairHosts} from '../scripts/agent-repair-qualification.js';
import {execute} from '../src/execution.js';
import {Client} from '@modelcontextprotocol/client';
import {StdioClientTransport} from '@modelcontextprotocol/client/stdio';
const hash = text => createHash('sha256').update(text).digest('hex');
const testFiles = ['test/fault.test.js', 'test/preserved.test.js'];
const fault = 'export const value=9;\n', fixed = 'export const value = 1;\n';

function config(root) {root = fs.realpathSync(root); const stat = fs.statSync(root); return {root, rootIdentity: {dev: stat.dev, ino: stat.ino}, expectedFaultSha256: hash(fault)};}
async function independent(root) {
  const result = await boundedProcess(process.execPath, ['--test', `--test-reporter=${path.resolve('src/reporters/node.js')}`, ...testFiles],
    {cwd: root, env: safeHostEnvironment(process.env), timeoutMs: 10000, maximumBytes: 65536});
  return parseIndependentRun(result, root);
}
function observerCalls(initial, final) {
  const entrypoint = {sha256: 'a'.repeat(64)}, node = {sha256: 'b'.repeat(64)};
  const call = (id, name, args, result, start) => ({id, name, arguments: args, result, requestedAt: start, respondedAt: start + 1});
  return {entrypoint, node, processResult: {status: 'completed', exitCode: 0}, observed: [
    {mode: 'readonly', entrypoint, node, tools: ['testlore_brief', 'testlore_status'], calls: [
      call(1, 'testlore_brief', {}, {authority: 'advisory', execution: {projectCommandsInvoked: false}}, 1),
      call(2, 'testlore_status', {}, {present: false, reason: 'no-retained-run', projectCommandsInvoked: false}, 3)]},
    {mode: 'execution', entrypoint, node, tools: ['testlore_brief', 'testlore_status', 'testlore_plan', 'testlore_verify'], calls: [
      call(1, 'testlore_plan', {base: 'HEAD'}, {complete: true, authority: 'routing-proposal'}, 5),
      call(2, 'testlore_verify', {base: 'HEAD', mode: 'shadow'}, initial, 7),
      call(3, 'testlore_plan', {base: 'HEAD'}, {complete: true, authority: 'routing-proposal'}, 11),
      call(4, 'testlore_verify', {base: 'HEAD', mode: 'full'}, final, 13)]}]};
}

test('bounded repair refuses arbitrary code, repeated edits, symlinks and fault drift', t => {
  const root = fixture(t); createFixture(root); const bound = config(root);
  for (const source of ['export const value=2;', 'export const value=1;process.exit(0);', 'x'.repeat(129), null]) assert.throws(() => repairFixture(bound, source), /authorized/);
  const before = fixtureSnapshot(root), result = repairFixture(bound, fixed);
  assert.equal(result.complete, true); assert.deepEqual(assessRepairDiff(before, fixtureSnapshot(root)), []);
  assert.throws(() => repairFixture(bound, fixed), /planted fault/);
  fs.unlinkSync(path.join(root, 'src/value.js')); fs.symlinkSync(path.join(root, 'src/preserved.js'), path.join(root, 'src/value.js'));
  assert.throws(() => repairFixture(bound, fixed)); assert.throws(() => fixtureSnapshot(root), /symlink/);
});

test('independent full execution preserves the actual fixed Node case identities across repair', async t => {
  const root = fixture(t); createFixture(root);
  fs.writeFileSync(path.join(root, 'src/value.js'), 'export const value=1;\n'); const baseline = await independent(root);
  fs.writeFileSync(path.join(root, 'src/value.js'), fault); const planted = await independent(root), before = fixtureSnapshot(root);
  const nativeInitial = execute(root, testFiles, {adapter: 'node'}, {capture: true});
  assert.equal(baseline.complete, true, JSON.stringify(baseline.errors)); assert.equal(planted.complete, true, JSON.stringify(planted.errors));
  assert.deepEqual(planted.cases.map(({id}) => id).sort(), nativeInitial.tests.map(({id}) => id).sort());
  const result = repairFixture(config(root), fixed), after = fixtureSnapshot(root), post = await independent(root);
  const initial = {complete: true, executed: true, mode: 'shadow', verdict: 'failed', outcomes: {passed: 1, failed: 1, skipped: 0},
    failedCases: planted.cases.filter(row => row.status === 'failed'), executedFiles: testFiles};
  const final = {complete: true, executed: true, mode: 'full', verdict: 'passed-in-observed-scope', outcomes: {passed: 2, failed: 0, skipped: 0}, executedFiles: testFiles};
  const input = {...observerCalls(initial, final), before, after, baseline, planted, independent: post,
    repair: {schemaVersion: 1, kind: 'bounded-fixture-repair', rejectedAdditionalCalls: 0, calls: [{requestedAt: 9, respondedAt: 10, sourceSha256: hash(fixed), result}]},
    finalMessage: JSON.stringify({verdict: 'passed-in-observed-scope', repairedFile: 'src/value.js', executedFiles: testFiles,
      uncertainty: 'This synthetic fixed contract does not establish deployment safety.', nextAction: 'Qualify real repair tasks with independent unchanged tests.', deploymentSafety: 'not-established'})};
  assert.equal(assessRepairLoop(input).qualified, true, JSON.stringify(assessRepairLoop(input).reasons));
  for (const mutate of [
    value => {value.after.find(row => row.file === 'test/fault.test.js').sha256 = 'c'.repeat(64);},
    value => {value.after.push({file: 'extra.js', sha256: 'c'.repeat(64)});},
    value => {value.independent.complete = false;},
    value => {value.independent.cases[0].status = 'failed';},
    value => {value.independent.cases[0].id = 'fabricated';},
    value => {value.repair.calls[0].result.complete = false;},
    value => {value.repair.rejectedAdditionalCalls = 1;},
    value => {value.observed[1].calls[3].id = value.observed[1].calls[1].id;},
    value => {value.repair.calls[0].requestedAt = 1;},
    value => {value.observed[1].calls.pop();},
    value => {value.observed[1].calls[3].result.complete = false;},
    value => {value.observed[1].calls[3].arguments.mode = 'shadow';},
    value => {value.processResult.status = 'timeout';},
    value => {value.finalMessage = '{"verdict":"passed-in-observed-scope"}';}
  ]) {const altered = structuredClone(input); mutate(altered); assert.equal(assessRepairLoop(altered).qualified, false);}
  for (const mutate of [
    value => {value.stdout += '\nall passed';},
    value => {value.exitCode = 1;},
    value => {value.stdout = '';},
    value => {value.status = 'timeout';}
  ]) {const bad = structuredClone(post.process); mutate(bad); assert.equal(parseIndependentRun(bad, root).complete, false);}
});

test('real fixture-only MCP capability repairs source and records rejected duplicate edits', async t => {
  const directory = fixture(t), root = path.join(directory, 'fixture'); createFixture(root);
  const configuration = {...config(root), receipt: path.join(directory, 'repair.json')}, filename = path.join(directory, 'config.json');
  fs.writeFileSync(filename, JSON.stringify(configuration));
  const transport = new StdioClientTransport({command: process.execPath, args: [path.resolve('scripts/fixture-repair-mcp.js'), filename], cwd: root, stderr: 'pipe'});
  const client = new Client({name: 'repair-capability-test', version: '1.0.0'}); t.after(async () => {await client.close();}); await client.connect(transport);
  const tools = (await client.listTools()).tools;
  assert.deepEqual(tools.map(({name}) => name), ['repair_fixture']); assert.equal(tools[0].annotations.destructiveHint, true);
  assert.equal((await client.callTool({name: 'repair_fixture', arguments: {source: fixed}})).structuredContent.complete, true);
  assert.equal((await independent(root)).complete, true);
  assert.equal((await client.callTool({name: 'repair_fixture', arguments: {source: fixed}})).isError, true);
  const receipt = JSON.parse(fs.readFileSync(configuration.receipt, 'utf8'));
  assert.equal(receipt.calls.length, 1); assert.equal(receipt.rejectedAdditionalCalls, 1);
});

test('explicit repair opt-in never expands default detection host tools', async () => {
  const argv = ['--run', '--authorize-fixture-tools', '--entrypoint', '/package/src/cli.js', '--output', '/tmp/repair.json'];
  assert.throws(() => parseRepairArguments(argv), /authorize-fixture-repair/);
  assert.equal(parseRepairArguments([...argv, '--authorize-fixture-repair']).authorizeFixtureRepair, true);
  await assert.rejects(qualifyRepairHosts({authorizeFixtureRepair: true, authorizeFixtureTools: false}), /opt-ins/);
  const event = JSON.stringify({item: {type: 'mcp_tool_call', server: 'testlore_fixture', tool: 'repair_fixture'}});
  assert.equal(hostEvents('codex', event).errors.length, 1); assert.equal(hostEvents('codex', event, true).errors.length, 0);
  assert.equal(hostEvents('codex', JSON.stringify({item: {type: 'mcp_tool_call', server: 'testlore_fixture', tool: 'change_tests'}}), true).errors.length, 1);
});
