import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fixture, write } from './helpers.js';
import { stagePatch, validateCandidates } from '../src/candidates.js';
import { rememberValidation, recallLessons } from '../src/learning.js';
import { digest } from '../src/provenance.js';
import { ruvectorRecall, ruvectorSettings } from '../src/adapters/ruvector.js';

const plugin = { plugins: { ruvector: { enabled: true, dimensions: 128, timeoutMs: 3000 } } };
const cache = root => path.join(root, '.tddswarm/learning/ruvector');
const entries = [{ id: 'a'.repeat(64), text: 'zero boundary behavior' }, { id: 'b'.repeat(64), text: 'invalid error assertion' }];
// A protocol fixture, deliberately not a native performance/semantic proof.
function sdk(root, mode = 'normal') {
  write(root, 'node_modules/@ruvector/core/package.json', { name: '@ruvector/core', version: '0.0.0-protocol-fixture', main: 'index.cjs' });
  write(root, 'node_modules/@ruvector/core/index.cjs', `const fs=require('node:fs');
    ${mode === 'crash' ? "process.exit(9);" : ''}
    ${mode === 'load' ? "throw new Error('native unavailable');" : ''}
    ${mode === 'timeout' ? "process.on('SIGTERM',()=>{});while(true){}" : ''}
    exports.VectorDb=class {constructor(o){this.file=o.storagePath;this.values=fs.existsSync(this.file)?JSON.parse(fs.readFileSync(this.file)):[];if(o.distanceMetric!=='Cosine')throw Error('enum');}
    async insertBatch(entries){this.values=entries.map(v=>({id:v.id,vector:Array.from(v.vector)}));fs.writeFileSync(this.file,JSON.stringify(this.values));}
    async len(){return this.values.length;}
    async search(q){${mode === 'fabricated' ? "return [{id:'f'.repeat(64),score:0}];" : "return this.values.map(v=>({id:v.id,score:1-v.vector.reduce((sum,x,i)=>sum+x*q.vector[i],0)})).sort((a,b)=>a.score-b.score);"}}
    };`);
}
function episode(root, { rejected = false } = {}) {
  const content = `import test from 'node:test';import assert from 'node:assert/strict';import {a} from '../src/a.js';test('zero boundary',()=>assert.equal(a,${rejected ? 99 : 1}));`;
  const staged = stagePatch(root, { files: [{ path: rejected ? 'test/rejected.test.js' : 'test/boundary.test.js', content }], requirements: 'a equals one', review: { accepted: true, findings: [], oracle: { independent: true, basis: ['Separate requirement a equals one.'] } } });
  const manifest = JSON.parse(fs.readFileSync(path.join(staged.directory, 'manifest.json'))), validation = validateCandidates(root, staged.id);
  assert.equal(validation.accepted, !rejected); assert.equal(rememberValidation(root, manifest, validation).remembered, true);
  return { manifest, validation };
}
function project(t) { return fixture(t, { 'package.json': { type: 'module' }, 'src/a.js': 'export const a=1;', 'test/original.test.js': "import test from 'node:test';test('original',()=>{});" }); }

test('disabled plugin and disabled learning never load SDK or create vector cache', t => {
  const root = project(t); episode(root); sdk(root, 'crash');
  assert.equal(recallLessons(root, 'boundary').retrieval, 'deterministic-lexical');
  assert.equal(recallLessons(root, 'boundary', { config: { ...plugin, learning: { enabled: false } } }).reason, 'learning-disabled');
  assert.equal(fs.existsSync(cache(root)), false);
});

test('missing SDK and native load failure fall back to intact lexical recall with explicit warnings', t => {
  const root = project(t); episode(root);
  for (const expected of ['ruvector-sdk-missing', 'ruvector-native-load-failed']) {
    const result = recallLessons(root, 'boundary', { config: plugin });
    assert.equal(result.retrieval, 'deterministic-lexical'); assert.equal(result.records.length, 1);
    assert.ok(result.warnings.some(w => w.includes(expected)));
    sdk(root, 'load');
  }
});

test('actual vector protocol caches, rebuilds canonical scope and refuses corrupt database', t => {
  const root = project(t); episode(root); sdk(root);
  const canonical = fs.readFileSync(path.join(root, '.tddswarm/learning/index.json'));
  let result = recallLessons(root, 'zero boundary', { config: plugin });
  assert.equal(result.retrieval, 'ruvector'); assert.equal(result.retrievalDetails.mode, 'lexical-vector'); assert.equal(result.retrievalDetails.cache, 'built');
  assert.equal(recallLessons(root, 'boundary', { config: plugin }).retrievalDetails.cache, 'reused');
  assert.deepEqual(fs.readFileSync(path.join(root, '.tddswarm/learning/index.json')), canonical);
  const raw = fs.readFileSync(path.join(cache(root), 'metadata.json'), 'utf8');
  assert.equal(raw.includes('assert.equal'), false); assert.equal(raw.includes('zero boundary'), false);
  episode(root, { rejected: true });
  result = recallLessons(root, 'boundary', { config: plugin });
  assert.equal(result.retrievalDetails.cache, 'built'); assert.equal(result.records.length, 2); assert.equal(result.records[0].outcome, 'accepted');
  assert.deepEqual(result.records.find(r => r.outcome === 'rejected').patterns, []);
  fs.appendFileSync(path.join(cache(root), 'vectors.db'), 'corrupt');
  result = recallLessons(root, 'boundary', { config: plugin });
  assert.equal(result.retrieval, 'deterministic-lexical'); assert.ok(result.warnings.some(w => w.includes('ruvector-cache-corrupt')));
});

test('fabricated IDs, crash and uncooperative worker fail safely with bounded SIGKILL timeout', t => {
  const root = project(t);
  for (const [mode, expected] of [['fabricated','ruvector-no-valid-hits'],['crash','ruvector-worker-failed'],['timeout','ruvector-worker-timeout']]) {
    sdk(root, mode); fs.rmSync(cache(root), { recursive: true, force: true });
    const start = Date.now(), result = ruvectorRecall(root, entries, 'boundary', { dimensions: 128, timeoutMs: mode === 'timeout' ? 200 : 3000 });
    assert.equal(result.used, false); assert.equal(result.reason, expected); assert.ok(Date.now() - start < 2500);
  }
});

test('historical source changes remain labeled and incompatible frameworks cannot enter vector scope', t => {
  const root = project(t); episode(root); sdk(root);
  write(root, 'src/a.js', 'export const a=2;');
  const result = recallLessons(root, 'boundary', { config: plugin });
  assert.equal(result.retrieval, 'ruvector'); assert.equal(result.records[0].sourceCompatible, false); assert.equal(result.records[0].advisoryOnly, true);
  assert.equal(recallLessons(root, 'boundary', { config: { ...plugin, adapter: 'vitest' } }).records.length, 0);
});

test('bounds, symlink cache escape and tiny budgets fail closed', t => {
  const root = project(t); episode(root); sdk(root);
  write(root, 'node_modules/@ruvector/core/package.json', { name: '@ruvector/core', version: 'v'.repeat(64), main: 'index.cjs' });
  for (const maxChars of [256, 1000, 6000]) assert.ok(JSON.stringify(recallLessons(root, 'boundary', { config: plugin, maxChars })).length <= maxChars);
  for (const value of [{ dimensions: 15 }, { dimensions: 2049 }, { timeoutMs: 99 }, { timeoutMs: 60001 }, { embedding: { mode: 'command', argv: ['node'] } }]) assert.throws(() => ruvectorSettings(value));
  fs.rmSync(cache(root), { recursive: true, force: true });
  const outside = fixture(t); fs.symlinkSync(outside, cache(root));
  assert.equal(ruvectorRecall(root, entries, 'boundary', {}).used, false); assert.deepEqual(fs.readdirSync(outside), []);
});

test('explicit local embedding command validates vectors and invalidates changed provider', t => {
  const root = project(t); sdk(root);
  write(root, 'embedding.cjs', `let input='';process.stdin.on('data',x=>input+=x).on('end',()=>{const r=JSON.parse(input);console.log(JSON.stringify({schemaVersion:1,vectors:r.texts.map(()=>[1,...Array(r.dimensions-1).fill(0)])}));});`);
  const settings = { dimensions: 16, embedding: { mode: 'command', argv: [process.execPath, 'embedding.cjs'], identity: 'fixture-v1' } };
  const first = ruvectorRecall(root, entries, 'boundary', settings);
  assert.equal(first.used, true); assert.equal(first.mode, 'external-embedding'); assert.equal(first.cache, 'built');
  assert.equal(ruvectorRecall(root, entries, 'boundary', settings).cache, 'reused');
  fs.appendFileSync(path.join(root, 'embedding.cjs'), '\n//changed provider');
  assert.equal(ruvectorRecall(root, entries, 'boundary', settings).cache, 'built');
  write(root, 'embedding.cjs', "console.log(JSON.stringify({schemaVersion:1,vectors:[[null]]}));");
  assert.equal(ruvectorRecall(root, entries, 'boundary', settings).reason, 'ruvector-invalid-embedding-output');
});


test('deleted canonical episodes invalidate native scope and corrupt canonical records never reach SDK', t => {
  const root = project(t); episode(root); episode(root, { rejected: true }); sdk(root);
  assert.equal(recallLessons(root, 'boundary', { config: plugin }).records.length, 2);
  const file = path.join(root, '.tddswarm/learning/index.json');
  const stored = JSON.parse(fs.readFileSync(file));
  stored.records = stored.records.filter(record => record.outcome === 'rejected');
  const { integrity, ...payload } = stored; stored.integrity = digest(payload);
  fs.writeFileSync(file, JSON.stringify(stored));
  const result = recallLessons(root, 'boundary', { config: plugin });
  assert.equal(result.retrievalDetails.cache, 'built'); assert.equal(result.records.length, 1); assert.equal(result.records[0].outcome, 'rejected');
  assert.equal(JSON.parse(fs.readFileSync(path.join(cache(root), 'metadata.json'))).ids.length, 1);
  stored.records[0].outcome = 'accepted'; fs.writeFileSync(file, JSON.stringify(stored));
  const before = fs.readFileSync(path.join(cache(root), 'vectors.db')); sdk(root, 'crash');
  assert.equal(recallLessons(root, 'boundary', { config: plugin }).records.length, 0);
  assert.deepEqual(fs.readFileSync(path.join(cache(root), 'vectors.db')), before);
});

test('embedding commands that ignore SIGTERM are terminated within the configured bound', t => {
  const root = project(t); sdk(root);
  write(root, 'embedding.cjs', "process.on('SIGTERM',()=>{});while(true){}");
  const before = Date.now();
  const result = ruvectorRecall(root, entries, 'boundary', { timeoutMs: 500, dimensions: 16, embedding: { mode: 'command', argv: [process.execPath, 'embedding.cjs'], identity: 'timeout-fixture' } });
  assert.equal(result.used, false); assert.ok(['ruvector-embedding-command-failed','ruvector-worker-timeout'].includes(result.reason));
  assert.ok(Date.now() - before < 2500);
});
