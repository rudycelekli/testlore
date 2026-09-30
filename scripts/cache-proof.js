#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { plan } from '../src/selector.js';
import ts from 'typescript';
import { buildGraph } from '../src/graph.js';

const args = process.argv.slice(2), option = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
const output = path.resolve(option('--output', path.join(os.tmpdir(), 'testlore-cache-verification.json')));
const moduleCount = Number(option('--modules', 120)), declarations = Number(option('--declarations', 400)), repeats = Number(option('--repeats', 5));
if (!Number.isInteger(moduleCount) || moduleCount < 4 || moduleCount > 500 || !Number.isInteger(declarations) || declarations < 1 || declarations > 2000 || !Number.isInteger(repeats) || repeats < 3 || repeats > 20) throw new Error('Invalid proof fixture bounds');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'testlore-cache-proof-'));
const write = (file, text) => { const target = path.join(root, file); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, typeof text === 'string' ? text : JSON.stringify(text)); };
const routing = result => ({ mode: result.mode, selected: result.selected, reasons: result.reasons, warnings: result.warnings, decisions: result.decisions, configurationFiles: result.configurationFiles });
const run = () => { const start = performance.now(), result = plan(root, { changed: ['src/module-0.js'] }); return { ms: performance.now() - start, result }; };
const median = values => [...values].sort((a,b) => a-b)[Math.floor(values.length / 2)];
try {
  write('package.json', { name: 'testlore-cache-controlled-proof', type: 'module' });
  for (let index = 0; index < moduleCount; index++) {
    write(`src/module-${index}.js`, Array.from({ length: declarations }, (_, item) => `const value${item}=${item};`).join('\n') + '\nexport const value=value0;');
    write(`test/module-${index}.test.js`, `import test from 'node:test';import assert from 'node:assert/strict';import{value}from'../src/module-${index}.js';test('module ${index}',()=>assert.equal(value,0));`);
  }
  write('tddswarm.config.json', { analysisCache: { enabled: false } });
  const uncachedInitial = run(); // Includes the first parser/compiler initialization.
  write('tddswarm.config.json', { analysisCache: { enabled: true } });
  const cold = run(); assert.deepEqual(routing(cold.result), routing(uncachedInitial.result));
  const warmStats = buildGraph(root).analysisCache; assert.equal(warmStats.diskHits, moduleCount * 2); assert.equal(warmStats.parses, 0);
  const warm = [], noCache = [];
  for (let index = 0; index < repeats; index++) {
    // Alternate order to limit a one-sided JIT/filesystem-cache advantage.
    for (const enabled of index % 2 ? [false,true] : [true,false]) {
      write('tddswarm.config.json', { analysisCache: { enabled } });
      const value = run(); assert.deepEqual(routing(value.result), routing(cold.result)); (enabled ? warm : noCache).push(value.ms);
    }
  }
  write('tddswarm.config.json', { analysisCache: { enabled: true } });
  write('src/module-0.js', "export{value}from'./module-1.js';");
  const changed = plan(root, { changed: ['src/module-1.js'] });
  assert.deepEqual(changed.selected, ['test/module-0.test.js','test/module-1.test.js']);
  const directory = path.join(root, '.tddswarm/analysis-cache/v1');
  for (const name of fs.readdirSync(directory).filter(name => name.endsWith('.json'))) fs.writeFileSync(path.join(directory, name), '{corrupt');
  assert.deepEqual(routing(plan(root, { changed: ['src/module-1.js'] })), routing(changed));
  // Native collection is deliberately exercised afresh, including a newly added test.
  write('tddswarm.config.json', { adapter: 'node', discovery: 'native', testMatch: ['test/module-0.test.js','test/module-1.test.js','test/fresh.test.js'], analysisCache: { enabled: true } });
  const nativeBefore = buildGraph(root); write('test/fresh.test.js', "import test from 'node:test';test('fresh collected case',()=>{});");
  const nativeAfter = buildGraph(root); assert.equal(nativeAfter.discovery.complete, true); assert.ok(nativeAfter.tests.includes('test/fresh.test.js')); assert.ok(!nativeBefore.tests.includes('test/fresh.test.js'));
  const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), sourceHashes = {};
  for (const relative of ['src/graph.js','src/graph-cache.js','scripts/cache-proof.js']) sourceHashes[relative] = createHash('sha256').update(fs.readFileSync(path.join(repository, relative))).digest('hex');
  const receipt = { schemaVersion: 1, generatedAt: new Date().toISOString(), kind: 'controlled-static-routing-cache-measurement', runtime: process.version, typescript: ts.version, platform: process.platform, architecture: process.arch,
    fixture: { moduleCount, declarationsPerModule: declarations, testFiles: moduleCount, repeats, deterministic: true },
    methodology: 'Whole plan() wall time includes source scanning/hashing, metadata I/O, compiler/config loading, graph resolution and cache lock/inventory work. Alternating warm/no-cache order; no tests executed in timed runs. Native collection freshness is a separate untimed check.',
    timingsMs: { uncachedInitial: uncachedInitial.ms, cold: cold.ms, warm, noCache, warmMedian: median(warm), noCacheMedian: median(noCache) },
    observedWarmToNoCacheRatio: median(warm) / median(noCache), warmStats,
    checks: { coldWarmDisabledRoutingEqual: true, changedSourceRerouted: true, corruptedCacheRoutingEqual: true, nativeCollectionFresh: true }, sourceHashes,
    limitations: ['Constructed parser-heavy static Node fixture; no cross-project or native framework speedup implied.', 'Cold persisted caching adds writes; small projects or native resolution/collection can dominate total time.', 'Cache is rebuildable local optimization, never execution or deployment evidence.'] };
  fs.mkdirSync(path.dirname(output), { recursive: true }); fs.writeFileSync(output, JSON.stringify(receipt, null, 2) + '\n');
  console.log(JSON.stringify({ verified: true, output, warmMedianMs: receipt.timingsMs.warmMedian, noCacheMedianMs: receipt.timingsMs.noCacheMedian, coldMs: cold.ms, ratio: receipt.observedWarmToNoCacheRatio, checks: receipt.checks }));
} finally { fs.rmSync(root, { recursive: true, force: true }); }
