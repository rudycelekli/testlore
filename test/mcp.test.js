import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { fixture, write, commit, twoModules } from './helpers.js';
import { boundedSummary, summarizePlan } from '../src/mcp-worker.js';

const serverUrl = pathToFileURL(path.resolve('src/mcp.js')).href;
async function connect(t, root, options = {}, workerEnv = {}) {
  const transport = new StdioClientTransport({ command: process.execPath,
    args: ['--input-type=module', '-e', `import {serveMcp} from ${JSON.stringify(serverUrl)}; Object.assign(process.env,${JSON.stringify(workerEnv)}); await serveMcp(${JSON.stringify({ root, ...options })});`],
    cwd: root, stderr: 'pipe' });
  const client = new Client({ name: 'testlore-contract-test', version: '1.0.0' });
  let stderr = '';
  transport.stderr.on('data', chunk => { stderr += chunk; });
  t.after(async () => { await client.close(); });
  await client.connect(transport);
  return { client, transport, stderr: () => stderr };
}
const call = (client, name, args = {}, options) => client.callTool({ name, arguments: args }, options);

test('real MCP SDK handshake defaults to strict read-only tools and never runs project code', async t => {
  const root = fixture(t, { ...twoModules,
    'probe.cjs': "require('node:fs').writeFileSync('executed-marker','executed'); console.log('v1');",
    'tddswarm.config.json': { runner: ['node', 'probe.cjs', '{files}'], services: { api: { probe: ['node', 'probe.cjs'] } } } });
  const { client, stderr } = await connect(t, root);
  assert.equal(client.getServerVersion().name, 'testlore');
  const tools = (await client.listTools()).tools;
  assert.deepEqual(tools.map(tool => tool.name).sort(), ['testlore_brief', 'testlore_status']);
  assert.ok(tools.every(tool => tool.annotations.readOnlyHint === true));
  const brief = await call(client, 'testlore_brief', { task: 'Preserve the independent contract', changed: ['src/a.js'] });
  assert.equal(brief.isError, undefined); assert.equal(brief.structuredContent.authority, 'advisory');
  assert.equal((await call(client, 'testlore_status')).isError, undefined);
  assert.equal(fs.existsSync(path.join(root, 'executed-marker')), false);
  assert.equal(fs.existsSync(path.join(root, '.tddswarm')), false);
  for (const [name, args] of [['testlore_brief', { root: '/tmp' }], ['testlore_brief', { task: 'a'.repeat(2001) }],
    ['testlore_status', { allowExecution: true }]])
    assert.equal((await call(client, name, args)).isError, true);
  await assert.rejects(call(client, 'testlore_verify'), /not found/);
  assert.equal(stderr(), '');
});

test('opted-in MCP verification catches an actual planted fault in default shadow scope', async t => {
  const root = fixture(t, twoModules); commit(root); write(root, 'src/a.js', 'export const a=9;');
  const { client } = await connect(t, root, { allowExecution: true });
  const tools = (await client.listTools()).tools;
  assert.equal(tools.length, 4);
  assert.equal(tools.find(tool => tool.name === 'testlore_verify').annotations.readOnlyHint, false);
  const report = await call(client, 'testlore_verify');
  assert.equal(report.isError, undefined);
  const evidence = report.structuredContent;
  assert.equal(evidence.mode, 'shadow'); assert.equal(evidence.complete, true);
  assert.equal(evidence.exitCode, 1); assert.equal(evidence.outcomes.failed, 1);
  assert.equal(evidence.verdict, 'failed');
  assert.deepEqual(evidence.executedFiles.sort(), ['test/a.test.js', 'test/b.test.js']);
  assert.equal(evidence.deploymentSafety, 'not-established');
  const raw = JSON.parse(fs.readFileSync(path.join(root, evidence.receipts.json), 'utf8'));
  assert.equal(raw.shadow, true); assert.equal(raw.tests.length, 2);
  assert.ok(fs.readFileSync(path.join(root, evidence.receipts.markdown), 'utf8').includes('test/b.test.js'));
  for (const args of [{ mode: 'selective' }, { root }, { command: ['echo', 'pass'] }, { selective: true }, { base: '--help' }])
    assert.equal((await call(client, 'testlore_verify', args)).isError, true);
});

test('MCP plan retains runtime uncertainty and never represents a proposal as deployment safety', async t => {
  const root = fixture(t, { ...twoModules, 'src/a.js': "export const a=1; export const load=()=>fetch('https://example.invalid');" });
  commit(root); write(root, 'src/b.js', 'export const b=2; // changed');
  const { client } = await connect(t, root, { allowExecution: true });
  const result = await call(client, 'testlore_plan');
  assert.equal(result.isError, undefined);
  const proposal = result.structuredContent;
  assert.equal(proposal.authority, 'routing-proposal');
  assert.ok(proposal.uncertainty.retainedTests.includes('test/a.test.js'));
  assert.ok(proposal.selectedFiles.includes('test/a.test.js'));
  assert.equal(proposal.deploymentSafety, 'not-established');
  assert.equal(fs.existsSync(path.join(root, '.tddswarm/last-run.json')), false);
});

test('MCP supervision rejects busy execution, bounds timeout and kills late-writing descendants', async t => {
  const root = fixture(t, { ...twoModules,
    'test/a.test.js': "import test from 'node:test'; import fs from 'node:fs'; import {spawn} from 'node:child_process'; test('slow',async()=>{fs.mkdirSync('.tddswarm',{recursive:true});fs.writeFileSync('.tddswarm/started-marker','started'); spawn(process.execPath,['-e',`setTimeout(()=>require('node:fs').writeFileSync('.tddswarm/late-marker','late'),6000)`],{stdio:'ignore'}); await new Promise(r=>setTimeout(r,20000));});" });
  commit(root);
  const { client } = await connect(t, root, { allowExecution: true, executionTimeoutMs: 5000 });
  const active = call(client, 'testlore_verify', { mode: 'full' });
  await new Promise(resolve => setTimeout(resolve, 100));
  const busy = await call(client, 'testlore_plan');
  assert.equal(busy.isError, true); assert.match(busy.content[0].text, /busy/);
  const startedDeadline = Date.now() + 4000;
  while (!fs.existsSync(path.join(root, '.tddswarm/started-marker')) && Date.now() < startedDeadline)
    await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal(fs.existsSync(path.join(root, '.tddswarm/started-marker')), true, 'Actual project test spawned its descendant');
  const timedOut = await active;
  assert.equal(timedOut.isError, true); assert.equal(timedOut.structuredContent.complete, false);
  assert.match(timedOut.content[0].text, /deadline|timed out/);
  await new Promise(resolve => setTimeout(resolve, 6500));
  assert.equal(fs.existsSync(path.join(root, '.tddswarm/late-marker')), false);
  assert.equal(fs.existsSync(path.join(root, '.tddswarm/last-run.json')), false);
});

test('actual MCP client cancellation aborts configured execution and permits a later read-only call', async t => {
  const root = fixture(t, { ...twoModules,
    'test/a.test.js': "import test from 'node:test'; test('slow',async()=>await new Promise(r=>setTimeout(r,10000)));" });
  commit(root);
  const { client } = await connect(t, root, { allowExecution: true });
  const controller = new AbortController();
  const active = call(client, 'testlore_verify', { mode: 'full' }, { signal: controller.signal });
  await new Promise(resolve => setTimeout(resolve, 300)); controller.abort();
  await assert.rejects(active, /abort|cancel/i);
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal((await call(client, 'testlore_status')).isError, undefined);
  assert.equal(fs.existsSync(path.join(root, '.tddswarm/last-run.json')), false);
});

test('MCP rejects root replacement after its startup trust binding', async t => {
  const root = fixture(t, twoModules);
  const { client } = await connect(t, root);
  const moved = `${root}-original`;
  fs.renameSync(root, moved); fs.mkdirSync(root);
  t.after(() => fs.rmSync(moved, { recursive: true, force: true }));
  const result = await call(client, 'testlore_status');
  assert.equal(result.isError, true); assert.match(result.content[0].text, /root changed/);
});

test('MCP summaries explicitly disclose omitted content and never upgrade missing discovery', () => {
  const summary = boundedSummary({ kind: 'agent-verification-run', authority: 'observed-run', complete: true,
    cases: Array.from({ length: 200 }, (_, i) => ({ id: `case-${i}`, text: 'x'.repeat(10000) })) });
  assert.equal(summary.presentation.truncated, true);
  assert.ok(Buffer.byteLength(JSON.stringify(summary)) <= 65536);
  assert.equal(summary.complete, false);
  assert.equal(summarizePlan({}).complete, false);
});

test('MCP rejects successful worker completion delivered after the server deadline', { skip: process.platform === 'win32' }, async t => {
  const root = fixture(t, { ...twoModules,
    'test/a.test.js': "import test from 'node:test'; import fs from 'node:fs'; test('delayed pass',async()=>{fs.mkdirSync('.tddswarm',{recursive:true});fs.writeFileSync('.tddswarm/started-marker','started'); await new Promise(r=>setTimeout(r,100));});" });
  commit(root);
  const { client, transport } = await connect(t, root, { allowExecution: true, executionTimeoutMs: 5000 });
  const active = call(client, 'testlore_verify', { mode: 'full' });
  const startedDeadline = Date.now() + 4000;
  while (!fs.existsSync(path.join(root, '.tddswarm/started-marker')) && Date.now() < startedDeadline)
    await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(fs.existsSync(path.join(root, '.tddswarm/started-marker')), true);
  process.kill(transport.pid, 'SIGSTOP');
  try { await new Promise(resolve => setTimeout(resolve, 5500)); }
  finally { process.kill(transport.pid, 'SIGCONT'); }
  const result = await active;
  assert.equal(result.isError, true); assert.equal(result.structuredContent.complete, false);
  assert.match(result.content[0].text, /deadline|timed out/);
  const native = JSON.parse(fs.readFileSync(path.join(root, '.tddswarm/last-run.json'), 'utf8'));
  assert.equal(native.complete, true); assert.equal(native.exitCode, 0, 'Worker passed while its supervisor was suspended');
});

test('MCP worker stdout overflow is rejected without corrupting the actual SDK protocol', async t => {
  const root = fixture(t, { ...twoModules,
    'preload.cjs': "process.stdout.write('x'.repeat(100000));" });
  const preload = fs.realpathSync(path.join(root, 'preload.cjs'));
  const { client } = await connect(t, root, { allowExecution: true, maxOutputBytes: 4096 }, { NODE_OPTIONS: `--require=${preload}` });
  const result = await call(client, 'testlore_plan');
  assert.equal(result.isError, true); assert.equal(result.structuredContent.complete, false);
  assert.match(result.content[0].text, /output limit/);
  assert.equal((await call(client, 'testlore_status')).isError, undefined);
});

test('MCP unavailable native backend produces explicit incomplete evidence without invented outcomes', async t => {
  const root = fixture(t, { ...twoModules,
    'tddswarm.config.json': { integration: { type: 'nx', executable: 'testlore-no-such-nx' } } });
  commit(root);
  const { client } = await connect(t, root, { allowExecution: true });
  const plan = (await call(client, 'testlore_plan')).structuredContent;
  assert.equal(plan.complete, false); assert.equal(plan.adapter, 'nx');
  assert.equal(plan.totalFiles, undefined);
  const result = (await call(client, 'testlore_verify')).structuredContent;
  assert.equal(result.complete, false); assert.equal(result.executed, false);
  assert.equal(result.verdict, 'incomplete');
  assert.equal(result.outcomes.available, false); assert.equal(result.outcomes.failed, null);
  assert.equal(result.receipts, null);
});
