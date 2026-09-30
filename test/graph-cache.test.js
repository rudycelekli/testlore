import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fixture, write, twoModules, commit } from './helpers.js';
import { buildGraph } from '../src/graph.js';
import { plan } from '../src/selector.js';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createAnalysisCache, analysisCacheSettings } from '../src/graph-cache.js';

const directory = root => path.join(root, '.tddswarm/analysis-cache/v1');
const entries = root => fs.readdirSync(directory(root)).filter(file => file.endsWith('.json'));
const config = { analysisCache: { enabled: true } };
const routing = result => ({ mode: result.mode, selected: result.selected, reasons: result.reasons, warnings: result.warnings, decisions: result.decisions, configurationFiles: result.configurationFiles });

test('unconfigured graph remains read-only and native source analysis deduplicates in memory', t => {
  const root = fixture(t, { ...twoModules, 'tddswarm.config.json': { adapter: 'node', discovery: 'native' } });
  const graph = buildGraph(root);
  assert.equal(graph.analysisCache.enabled, false); assert.ok(graph.analysisCache.memoryHits >= graph.tests.length);
  assert.equal(graph.analysisCache.parses, 4); assert.equal(fs.existsSync(path.join(root, '.tddswarm')), false);
});

test('cold, warm, disabled and corrupt caches produce identical routing including uncertainty', t => {
  const root = fixture(t, { ...twoModules, 'tddswarm.config.json': config });
  write(root, 'src/b.js', 'export const b=require(process.env.MODULE);');
  const cold = plan(root, { changed: ['src/a.js'] });
  const warm = plan(root, { changed: ['src/a.js'] }); assert.deepEqual(routing(warm), routing(cold));
  const graph = buildGraph(root); assert.equal(graph.analysisCache.diskHits, 4); assert.equal(graph.analysisCache.parses, 0);
  for (const name of entries(root)) fs.writeFileSync(path.join(directory(root), name), '{invalid');
  const corrupt = plan(root, { changed: ['src/a.js'] }); assert.deepEqual(routing(corrupt), routing(cold));
  assert.ok(corrupt.warnings.some(item => item.reason === 'dynamic-dependency'));
  write(root, 'tddswarm.config.json', { analysisCache: { enabled: false } });
  assert.deepEqual(routing(plan(root, { changed: ['src/a.js'] })), routing(cold));
});

test('source content changes invalidate summaries even when timestamps and sizes are preserved', t => {
  const root = fixture(t, { ...twoModules, 'tddswarm.config.json': config });
  const changedText = "export{b}from'./b.js';";
  write(root, 'src/a.js', fs.readFileSync(path.join(root, 'src/a.js'), 'utf8').padEnd(changedText.length, ' '));
  buildGraph(root); const file = path.join(root, 'src/a.js'), stat = fs.statSync(file);
  write(root, 'src/a.js', changedText); assert.equal(fs.statSync(file).size, stat.size); fs.utimesSync(file, stat.atime, stat.mtime);
  const graph = buildGraph(root); assert.ok(graph.analysisCache.parses >= 1); assert.deepEqual(graph.edges['src/a.js'], ['src/b.js']);
  assert.deepEqual(plan(root, { changed: ['src/b.js'] }).selected, ['test/a.test.js','test/b.test.js']);
});

test('aliases, declarations, removed files and new test collection resolve freshly on cache hits', t => {
  const root = fixture(t, { ...twoModules, 'tddswarm.config.json': config, 'tsconfig.json': { compilerOptions: { baseUrl: '.', paths: { '#subject': ['src/a.js'] } } }, 'test/a.test.js': "import {a} from '#subject';" });
  assert.deepEqual(buildGraph(root).edges['test/a.test.js'], ['src/a.js']);
  write(root, 'tsconfig.json', { compilerOptions: { baseUrl: '.', paths: { '#subject': ['src/b.js'] } } });
  const aliased = buildGraph(root); assert.ok(aliased.analysisCache.diskHits >= 4); assert.deepEqual(aliased.edges['test/a.test.js'], ['src/b.js']);
  fs.unlinkSync(path.join(root, 'src/b.js')); write(root, 'test/new.test.js', "import{a}from'../src/a.js';");
  const changed = buildGraph(root); assert.ok(changed.tests.includes('test/new.test.js')); assert.ok(changed.warnings.some(item => item.reason === 'unresolved-import:#subject'));
});

test('git baseline imports remain preserved independently of the warm current summary', t => {
  const root = fixture(t, { ...twoModules, 'tddswarm.config.json': config, 'src/wrapper.js': "export{a}from'./a.js';", 'test/a.test.js': "import{a}from'../src/wrapper.js';" });
  commit(root); buildGraph(root); write(root, 'src/wrapper.js', 'export const a=1;');
  const result = plan(root, { base: 'HEAD' });
  assert.ok(result.selected.includes('test/a.test.js')); assert.ok(result.decisions.find(item => item.test === 'test/a.test.js').paths.some(chain => chain.includes('src/wrapper.js')));
  const first = routing(result); assert.deepEqual(routing(plan(root, { base: 'HEAD' })), first);
});

test('unsafe paths, oversized entries, schema and engine drift fall back to source parsing', t => {
  const root = fixture(t, { ...twoModules, 'tddswarm.config.json': config }); buildGraph(root);
  const baseline = routing(plan(root, { changed: ['src/a.js'] }));
  const names = entries(root);
  for (const name of names) {
    const file = path.join(directory(root), name), value = JSON.parse(fs.readFileSync(file));
    value.engine = 'f'.repeat(64); const { integrity, ...payload } = value; value.integrity = createHash('sha256').update(JSON.stringify(payload)).digest('hex'); fs.writeFileSync(file, JSON.stringify(value));
  }
  assert.deepEqual(routing(plan(root, { changed: ['src/a.js'] })), baseline);
  for (const name of entries(root)) {
    const file = path.join(directory(root), name), value = JSON.parse(fs.readFileSync(file)); value.result.warnings = ['invented-authority'];
    const { integrity, ...payload } = value; value.integrity = createHash('sha256').update(JSON.stringify(payload)).digest('hex'); fs.writeFileSync(file, JSON.stringify(value));
  }
  assert.deepEqual(routing(plan(root, { changed: ['src/a.js'] })), baseline);
  fs.writeFileSync(path.join(directory(root), entries(root)[0]), 'x'.repeat(128 * 1024 + 1));
  assert.deepEqual(routing(plan(root, { changed: ['src/a.js'] })), baseline);
  fs.rmSync(path.join(root, '.tddswarm/analysis-cache'), { recursive: true, force: true });
  const outside = fixture(t); fs.symlinkSync(outside, path.join(root, '.tddswarm/analysis-cache'));
  assert.deepEqual(routing(plan(root, { changed: ['src/a.js'] })), baseline); assert.deepEqual(fs.readdirSync(outside), []);
});

test('bounded eviction and lock contention cannot alter routing or leave partial JSON', t => {
  const root = fixture(t, { ...twoModules, 'tddswarm.config.json': { analysisCache: { enabled: true, maxEntries: 2, maxBytes: 4096 } } });
  const baseline = routing(plan(root, { changed: ['src/a.js'] })); assert.ok(entries(root).length <= 2);
  assert.ok(entries(root).reduce((sum, name) => sum + fs.statSync(path.join(directory(root), name)).size, 0) <= 4096);
  fs.writeFileSync(path.join(directory(root), '.lock'), '{"token":"other-writer"}');
  write(root, 'src/a.js', 'export const a=99;');
  assert.deepEqual(routing(plan(root, { changed: ['src/a.js'] })), baseline);
  assert.equal(fs.readFileSync(path.join(directory(root), '.lock'), 'utf8'), '{"token":"other-writer"}');
  for (const name of entries(root)) assert.doesNotThrow(() => JSON.parse(fs.readFileSync(path.join(directory(root), name))));
});

test('configured bounds shrink an existing warm cache and parser changes never share identities', t => {
  const root = fixture(t), engine = 'a'.repeat(64); let computations = 0;
  const compute = () => { computations++; return { imports: ['./a.js'], warnings: ['parse-error'] }; };
  for (const file of ['a.js','b.js','c.js']) { const cache = createAnalysisCache(root, { enabled: true }, engine); cache.analyze(file, 'source', compute); cache.flush(); }
  assert.equal(entries(root).length, 3);
  const smaller = createAnalysisCache(root, { enabled: true, maxEntries: 1 }, engine); smaller.analyze('c.js', 'source', compute); smaller.flush(); assert.equal(entries(root).length, 1);
  const changed = createAnalysisCache(root, { enabled: true }, 'b'.repeat(64)); changed.analyze('c.js', 'source', compute); changed.flush(); assert.equal(changed.stats.parses, 1);
  assert.equal(computations, 4);
  for (const value of [{ enabled: 'yes' }, { maxEntries: 0 }, { maxBytes: 4095 }, { directory: '../escape' }]) assert.throws(() => analysisCacheSettings(value));
});

test('Playwright config helpers remain global configuration dependencies through cached analysis', t => {
  const root = fixture(t, { ...twoModules, 'tddswarm.config.json': config, 'playwright.config.ts': "import setup from './src/setup.js';export default {globalSetup:setup};", 'src/setup.js': 'export default ()=>{};' });
  for (let attempt = 0; attempt < 2; attempt++) {
    const graph = buildGraph(root); assert.ok(graph.configFiles.has('playwright.config.ts')); assert.ok(graph.configFiles.has('src/setup.js'));
    assert.ok(plan(root, { changed: ['src/setup.js'] }).reasons.includes('global-configuration-changed'));
  }
});


test('concurrent process writers leave bounded complete entries and no partial artifacts', async t => {
  const root = fixture(t), module = new URL('../src/graph-cache.js', import.meta.url).href;
  const code = `import {createAnalysisCache} from ${JSON.stringify(module)};const c=createAnalysisCache(${JSON.stringify(root)},{enabled:true,maxEntries:8,maxBytes:4096},'e'.repeat(64));for(let i=0;i<32;i++)c.analyze('src/module-'+i+'.js','source-'+i,()=>({imports:[],warnings:[]}));c.flush();`;
  await Promise.all(Array.from({ length: 4 }, () => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--input-type=module','-e',code], { stdio: ['ignore','ignore','pipe'], timeout: 10000, killSignal: 'SIGKILL' });
    let stderr = ''; child.stderr.on('data', chunk => stderr += chunk); child.on('error', reject); child.on('close', status => status === 0 ? resolve() : reject(new Error(stderr || 'Writer failed')));
  })));
  const names = fs.readdirSync(directory(root)); assert.ok(names.length <= 8); assert.ok(names.every(name => /^[a-f0-9]{64}\.json$/.test(name)));
  assert.ok(names.reduce((sum, name) => sum + fs.statSync(path.join(directory(root), name)).size, 0) <= 4096);
  for (const name of names) { const record = JSON.parse(fs.readFileSync(path.join(directory(root), name))); assert.deepEqual(record.result, { imports: [], warnings: [] }); }
});
