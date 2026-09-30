import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { generate } from '../src/index.js';
import { callAgent } from '../src/swarm.js';
import { codexRequest, schemas } from '../src/adapters/codex.js';
import { fixture, write, twoModules } from './helpers.js';

const worker = `let text='';for await(const c of process.stdin)text+=c;const p=JSON.parse(text);
const reply=p.role==='architect'?{tasks:[{subject:'src/a.js',instructions:'Verify a=1 using requirements'}]}:
p.role==='author'?{files:[{path:'test/generated.test.js',content:"import test from 'node:test';import assert from 'node:assert/strict';import {a} from '../src/a.js';test('requirement',()=>assert.equal(a,1));"}]}:
{accepted:true,findings:['Mock review only; no LLM called.']};process.stdout.write(JSON.stringify(reply));`;
function setup(t, script = worker) {
  const root = fixture(t, { ...twoModules, 'worker.mjs': script, 'tddswarm.requirements.md': 'Public constant a must equal 1.', 'tddswarm.config.json': { agent: ['node', 'worker.mjs'] } });
  return root;
}
test('default generation is an exportable work order with no agent execution', async t => {
  const result = await generate(fixture(t, { 'src/a.js': 'export const a=1;' }));
  assert.equal(result.executed, false); assert.equal(result.purpose, 'bootstrap-tests');
});
test('architect → authors → reviewer protocol stages candidates without overwriting', async t => {
  const root = setup(t);
  const before = fs.readFileSync(path.join(root, 'test/a.test.js'), 'utf8');
  const result = await generate(root, { execute: true });
  assert.equal(result.calls, 3); assert.equal(result.status, 'reviewed-candidates');
  assert.equal(result.applied, false); assert.equal(result.measured.execution, false);
  assert.ok(fs.existsSync(path.join(result.directory, 'test/generated.test.js')));
  assert.equal(fs.existsSync(path.join(root, 'test/generated.test.js')), false);
  assert.equal(fs.readFileSync(path.join(root, 'test/a.test.js'), 'utf8'), before);
});
test('a reviewer rejection is retained, never applied or relabeled accepted', async t => {
  const result = await generate(setup(t, worker.replace('accepted:true','accepted:false')), { execute: true });
  assert.equal(result.status, 'rejected-candidates'); assert.equal(result.applied, false);
});
test('missing requirements prevent any agent invocation', async t => {
  const root = setup(t); fs.unlinkSync(path.join(root, 'tddswarm.requirements.md'));
  await assert.rejects(generate(root, { execute: true }), /requirements/);
});
test('path traversal and absolute paths from an author are rejected', async t => {
  for (const candidate of ['../escape.test.js', '/tmp/escape.test.js']) {
    await assert.rejects(generate(setup(t, worker.replace('test/generated.test.js',candidate)), { execute: true }), /Unsafe project path/);
  }
});
test('agents cannot stage non-test files or duplicate candidate paths', async t => {
  await assert.rejects(generate(setup(t, worker.replace('test/generated.test.js','package.json')), { execute: true }), /Candidate must be a test path/);
});
test('malformed agent JSON and failing executables surface errors', async t => {
  const root = fixture(t, { 'bad.mjs': "process.stdout.write('not json')" });
  await assert.rejects(callAgent(['node','bad.mjs'], {}, root), /JSON object/);
  await assert.rejects(callAgent(['missing-tddswarm-worker'], {}, root), /ENOENT/);
});
test('hung workers are bounded and terminated', async t => {
  const root = fixture(t, { 'hung.mjs': 'setInterval(()=>{},1000)' });
  await assert.rejects(callAgent(['node','hung.mjs'], {}, root, 50), /timed out/);
});
test('context limits stop accidental large payload submission', async t => {
  const root = setup(t); write(root,'src/large.js', '//'+ 'x'.repeat(300000));
  await assert.rejects(generate(root, { execute: true }), /256 KB/);
});
test('Codex adapter constructs schema-constrained read-only requests without shell interpolation', t => {
  const dir = fixture(t);
  const request = codexRequest({ role: 'author', task: { instructions: 'literal $(touch nope)' } }, dir);
  assert.ok(request.args.includes('read-only')); assert.ok(request.args.includes('--output-schema'));
  assert.ok(request.args.includes('--ignore-user-config'));
  assert.equal(request.args.includes('--dangerously-bypass-approvals-and-sandbox'), false);
  assert.ok(request.prompt.includes('$(touch nope)'));
  assert.equal(schemas.author.additionalProperties, false);
});
