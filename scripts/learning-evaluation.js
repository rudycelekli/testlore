#!/usr/bin/env node
// Explicitly invoked evaluation; importing this module never calls an agent.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { callAgent } from '../src/swarm.js';
import { stagePatch, validateCandidates, applyPatch } from '../src/candidates.js';
import { execute, discover } from '../src/execution.js';
import { recallLessons } from '../src/learning.js';
import { digest,snapshot,freshness } from '../src/provenance.js';
import {TEST} from '../src/files.js';

const repository = fileURLToPath(new URL('../', import.meta.url));
const review = requirements => ({ accepted: true, findings: [], oracle: { independent: true, basis: [requirements] } });
const testFile = (name, source) => ({ path: `test/${name}.test.js`, content: "import test from 'node:test';import assert from 'node:assert/strict';" + source });
const sourceFile = (name, source) => ({ path: `src/${name}.js`, content: source });

/** Authored specifications and separately withheld, independently executable labels. */
export function defaultDataset() {
  return {
    schemaVersion: 1, id: 'independent-contracts-v1',
    history: [{ id: 'historical-clamp', specificationId: 'numeric-clamping', requirements: 'Clamp finite numbers to inclusive lower/upper bounds; reversed bounds throw RangeError. Include boundary, interior, negative and error cases.',
      files: [sourceFile('clamp', "export function clamp(x,a,b){if(a>b)throw new RangeError();return Math.max(a,Math.min(b,x));}")],
      tests: [testFile('clamp', "import {clamp} from '../src/clamp.js';test('boundary interior negative error',()=>{assert.equal(clamp(-4,-2,3),-2);assert.equal(clamp(4,-2,3),3);assert.equal(clamp(0,-2,3),0);assert.throws(()=>clamp(0,2,1),RangeError);});")] }],
    fixtures: [
      { id: 'normalize', specificationId: 'string-normalization', requirements: 'normalize accepts a string, trims leading/trailing whitespace, lowercases letters, preserves internal whitespace, and returns empty for all-whitespace strings. Non-string inputs throw TypeError. Use independent exact expectations.',
        files: [sourceFile('normalize', "export function normalize(s){if(typeof s!=='string')throw new TypeError();return s.trim().toLowerCase();}")],
        referenceTests: [testFile('normalize', "import {normalize} from '../src/normalize.js';test('trim lowercase internal empty type',()=>{assert.equal(normalize('  HeLLo  '),'hello');assert.equal(normalize(' A  B '),'a  b');assert.equal(normalize('  '),'');assert.throws(()=>normalize(2),TypeError);});")],
        defects: [ { id: 'trim-omitted', files: [sourceFile('normalize', "export function normalize(s){if(typeof s!=='string')throw new TypeError();return s.toLowerCase();}")] }, { id: 'lowercase-omitted', files: [sourceFile('normalize', "export function normalize(s){if(typeof s!=='string')throw new TypeError();return s.trim();}")] }, { id: 'type-coercion', files: [sourceFile('normalize', "export function normalize(s){return String(s).trim().toLowerCase();}")] } ] },
      { id: 'unique', specificationId: 'stable-deduplication', requirements: 'unique takes an array of numbers or strings and returns a new array containing only the first occurrence of each distinct value, in original order. Number 1 and string "1" remain distinct. Do not mutate the input. Empty arrays return empty. Non-array inputs throw TypeError.',
        files: [sourceFile('unique', "export function unique(xs){if(!Array.isArray(xs))throw new TypeError();return [...new Set(xs)];}")],
        referenceTests: [testFile('unique', "import {unique} from '../src/unique.js';test('stable distinct immutable empty type',()=>{const input=[3,1,3,'1',1];assert.deepEqual(unique(input),[3,1,'1']);assert.deepEqual(input,[3,1,3,'1',1]);assert.deepEqual(unique([]),[]);assert.throws(()=>unique(null),TypeError);});")],
        defects: [ { id: 'duplicate-retention', files: [sourceFile('unique', "export function unique(xs){if(!Array.isArray(xs))throw new TypeError();return [...xs];}")] }, { id: 'type-collapse', files: [sourceFile('unique', "export function unique(xs){if(!Array.isArray(xs))throw new TypeError();return [...new Set(xs.map(String))];}")] }, { id: 'order-reversal', files: [sourceFile('unique', "export function unique(xs){if(!Array.isArray(xs))throw new TypeError();return [...new Set(xs)].reverse();}")] } ] },
      { id: 'overlap', specificationId: 'half-open-intervals', requirements: 'overlap(a,b,c,d) tests whether half-open intervals [a,b) and [c,d) share a point. Endpoints are finite numbers. Each start must be strictly less than its end or RangeError is thrown. Touching endpoints do not overlap. Overlap is symmetric. Negative endpoints are valid.',
        files: [sourceFile('overlap', "export function overlap(a,b,c,d){if(a>=b||c>=d)throw new RangeError();return a<d&&c<b;}")],
        referenceTests: [testFile('overlap', "import {overlap} from '../src/overlap.js';test('touch contained negative symmetric invalid',()=>{assert.equal(overlap(0,2,2,4),false);assert.equal(overlap(0,4,1,2),true);assert.equal(overlap(-4,-1,-2,1),true);assert.equal(overlap(1,2,0,4),true);assert.throws(()=>overlap(1,1,0,2),RangeError);assert.throws(()=>overlap(0,2,4,2),RangeError);});")],
        defects: [ { id: 'touch-is-overlap', files: [sourceFile('overlap', "export function overlap(a,b,c,d){if(a>=b||c>=d)throw new RangeError();return a<=d&&c<=b;}")] }, { id: 'containment-missed', files: [sourceFile('overlap', "export function overlap(a,b,c,d){if(a>=b||c>=d)throw new RangeError();return a<c&&c<b;}")] }, { id: 'empty-accepted', files: [sourceFile('overlap', "export function overlap(a,b,c,d){if(a>b||c>d)throw new RangeError();return a<d&&c<b;}")] } ] }
    ]
  };
}
const boundedText = (s, max) => typeof s === 'string' && s.trim().length > 0 && !s.includes('\0') && Buffer.byteLength(s) <= max;
function fileList(files, kind) {
  if (!Array.isArray(files) || !files.length || files.length > 16) throw new Error('Expected 1–16 bounded files');
  const seen = new Set();
  for (const f of files) {
    if (!f || !/^(?:src|tests?)\/[A-Za-z0-9_-]+(?:\.(?:test|spec))?\.[cm]?js$/.test(f.path) || seen.has(f.path) || !boundedText(f.content, 64 * 1024) || (kind === 'source' ? !f.path.startsWith('src/') || TEST.test(f.path) : !TEST.test(f.path))) throw new Error('Invalid source/test file or path');
    seen.add(f.path);
  }
}
export function validateDataset(dataset) {
  if (!dataset || dataset.schemaVersion !== 1 || !boundedText(dataset.id, 128) || !Array.isArray(dataset.history) || dataset.history.length < 1 || dataset.history.length > 8 || !Array.isArray(dataset.fixtures) || dataset.fixtures.length < 2 || dataset.fixtures.length > 12 || Buffer.byteLength(JSON.stringify(dataset)) > 2 * 1024 * 1024) throw new Error('Invalid bounded evaluation dataset');
  const ids = new Set(), specs = new Set(), contracts = new Set(), sources = new Set();
  for (const [entries, historical] of [[dataset.history, true], [dataset.fixtures, false]]) for (const f of entries) {
    if (!f || !/^[A-Za-z0-9_-]{1,64}$/.test(f.id) || ids.has(f.id) || !boundedText(f.specificationId, 128) || specs.has(f.specificationId) || !boundedText(f.requirements, 16000) || contracts.has(digest(f.requirements))) throw new Error('Specifications must be distinct across history and evaluation');
    ids.add(f.id); specs.add(f.specificationId); contracts.add(digest(f.requirements)); fileList(f.files, 'source');
    for (const file of f.files) { if (sources.has(digest(file.content))) throw new Error('Historical/evaluation source content must not overlap'); sources.add(digest(file.content)); }
    fileList(historical ? f.tests : f.referenceTests, 'test');
    if (!historical) {
      if (!Array.isArray(f.defects) || !f.defects.length || f.defects.length > 8) throw new Error('Expected 1–8 held-out defects');
      const labels = new Set();
      for (const d of f.defects) { if (!d || !/^[A-Za-z0-9_-]{1,64}$/.test(d.id) || labels.has(d.id)) throw new Error('Invalid defect label'); labels.add(d.id); fileList(d.files, 'source'); for (const file of d.files) if (!f.files.some(source => source.path === file.path && source.content !== file.content)) throw new Error('Defect must replace an existing source'); }
    }
  }
  return dataset;
}
const successful = result => result.complete && result.exitCode === 0 && result.tests.length > 0 && result.tests.every(t => t.status === 'passed');
const detected = result => result.complete && result.exitCode === 1 && result.tests.some(t => t.status === 'failed' && t.name !== '<file-load>');
export function stableOutcomes(results) {
  if (!Array.isArray(results) || results.length < 2 || results.some(r => !r.complete || !Array.isArray(r.tests) || !r.tests.length || r.tests.some(t => !['passed','failed'].includes(t.status)))) return false;
  const signature = r => JSON.stringify([r.exitCode, r.tests.map(t => [t.id, t.file, t.name, t.status]).sort((a,b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))]);
  return results.every(r => signature(r) === signature(results[0]));
}
function write(root, file, value) { const target = path.join(root, file); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, typeof value === 'string' ? value : JSON.stringify(value)); }
function install(root, files) { for (const f of files) write(root, f.path, f.content); }
function configuration(enabled) { return { adapter: 'node', discovery: 'native', runner: [process.execPath, '--test', '{files}'], runnerTimeoutMs: 10000, learning: { enabled } }; }
function project(root, files, enabled) { fs.mkdirSync(root); write(root, 'package.json', { type: 'module' }); write(root, 'tddswarm.config.json', configuration(enabled)); install(root, files); }
function collect(root, config) { const discovery = discover(root, config); if (!discovery.complete || !discovery.files.length) throw new Error('Incomplete or empty native discovery'); return { ...execute(root, discovery.files, config, { capture: true, timeoutMs: 10000 }), discovery }; }
function workerInventory(root) {
  const entries = [], queue = ['']; let bytes = 0;
  while (queue.length) {
    const directory = queue.pop();
    for (const name of fs.readdirSync(path.join(root,directory)).sort()) {
      const file = directory ? directory+'/'+name : name, stat = fs.lstatSync(path.join(root,file));
      if (entries.length >= 4096 || stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile())) throw new Error('Worker filesystem inventory exceeded scope or encountered unsafe entry');
      if (stat.isDirectory()) { entries.push([file,'directory']); queue.push(file); }
      else { bytes += stat.size; if (bytes > 32*1024*1024) throw new Error('Worker filesystem inventory exceeds 32 MB'); entries.push([file,digest(fs.readFileSync(path.join(root,file))),stat.mode]); }
    }
  }
  return digest(entries.sort(([a],[b])=>a.localeCompare(b)));
}
export function evaluationSchedule(fixtures, repeat, seed) {
  let state = seed >>> 0 || 1;
  const random = () => { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return (state >>> 0) / 4294967296; };
  const first = random() < 0.5 ? 'without_memory' : 'with_memory';
  const schedule = [], initial = new Map(fixtures.map((f,index) => [f.id,index % 2 ? (first === 'with_memory' ? 'without_memory' : 'with_memory') : first]));
  for (let repetition = 0; repetition < repeat; repetition++) {
    const order = fixtures.map(f => f.id);
    for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
    for (const fixture of order) { const base = initial.get(fixture), start = repetition % 2 ? (base === 'with_memory' ? 'without_memory' : 'with_memory') : base; schedule.push({ fixture, repetition, arms: start === 'with_memory' ? ['with_memory','without_memory'] : ['without_memory','with_memory'] }); }
  }
  return schedule;
}
const mean = values => values.reduce((sum, value) => sum + value, 0) / values.length;
export function summarizeEvaluation(trials, fixtures, repeat) {
  const pairs = [];
  for (const fixture of fixtures) for (let repetition = 0; repetition < repeat; repetition++) {
    const rows = trials.filter(row => row.fixture === fixture.id && row.repetition === repetition);
    const warm = rows.find(row => row.arm === 'with_memory'), cold = rows.find(row => row.arm === 'without_memory');
    if (warm && cold) pairs.push({ fixture: fixture.id, repetition, recallDelta: warm.recall - cold.recall, caseDelta: warm.cases - cold.cases, generationMsDelta: warm.generationMs - cold.generationMs, outputBytesDelta: warm.outputBytes - cold.outputBytes, inputBytesDelta: (warm.inputBytes ?? 0) - (cold.inputBytes ?? 0), totalMsDelta: (warm.totalMs ?? 0) - (cold.totalMs ?? 0), complete: !warm.error && !cold.error });
  }
  const independent = fixtures.map(f => ({ fixture: f.id, recallDelta: mean(pairs.filter(p => p.fixture === f.id).map(p => p.recallDelta)) }));
  const positive = independent.filter(p => p.recallDelta > 0).length, negative = independent.filter(p => p.recallDelta < 0).length, n = positive + negative;
  let probability = 1;
  if (n) { let term = 1, sum = 1; for (let k = 1; k <= Math.min(positive, negative); k++) { term = term * (n - k + 1) / k; sum += term; } probability = Math.min(1, 2 * sum / 2 ** n); }
  const applicable = trials.filter(row => row.arm === 'with_memory').every(row => !row.noApplicableMemory);
  const complete = pairs.length === fixtures.length * repeat && pairs.every(p => p.complete);
  const sufficient = fixtures.length >= 6 && repeat >= 3 && complete && applicable;
  return { pairs, applicableMemoryInAllTrials: applicable, independentSpecificationUnits: independent, complete, inference: sufficient && probability < 0.05 ? (positive > negative ? 'positive-scoped-recall-difference' : 'negative-scoped-recall-difference') : 'inconclusive', exactTwoSidedSignTest: { unit: 'independent specification mean across repetitions; ties excluded', positive, negative, ties: independent.length - n, p: probability }, pairedMeans: Object.fromEntries(['recallDelta','caseDelta','generationMsDelta','outputBytesDelta','inputBytesDelta','totalMsDelta'].map(key => [key, pairs.length ? mean(pairs.map(p => p[key])) : null])) };
}

export async function evaluateLearning({ output, agent, identity, dataset = defaultDataset(), repeat = 3, seed = 20260930, timeoutMs = 115000, maxOutputBytes = 65536, maxCalls = 54, evidenceKind = 'live-worker', stabilityRuns = 2 }) {
  validateDataset(dataset);
  if (!Array.isArray(agent) || agent.length < 1 || agent.length > 32 || agent.some(arg => !boundedText(arg, 4096)) || !boundedText(identity, 256)) throw new Error('Explicit worker argv and provider/model identity are required');
  if (!Number.isInteger(repeat) || repeat < 1 || repeat > 5 || !Number.isInteger(seed) || seed < 0 || seed > 0xffffffff || !Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 120000 || !Number.isInteger(maxOutputBytes) || maxOutputBytes < 1024 || maxOutputBytes > 131072 || !Number.isInteger(maxCalls) || maxCalls < 1 || maxCalls > 360 || !['live-worker','protocol-fixture'].includes(evidenceKind)) throw new Error('Invalid evaluation budget');
  if (!Number.isInteger(stabilityRuns) || stabilityRuns < 2 || stabilityRuns > 5) throw new Error('stabilityRuns must be 2–5');
  const callsRequired = dataset.fixtures.length * repeat * 2 * 3;
  if (callsRequired > maxCalls) throw new Error(`Evaluation requires ${callsRequired} calls; increase explicit maxCalls budget or reduce scope`);
  output = path.resolve(output); if (fs.existsSync(output)) throw new Error('Output must be a new directory; preserve previous evidence'); fs.mkdirSync(output, { recursive: true, mode: 0o700 });
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'testlore-learning-evaluation-'));
  function persist(file, value) { let text = JSON.stringify(value, null, 2); for (const [from, to] of [[workspace,'<workspace>'],[repository,'<repository>'],[process.execPath,'<node>']]) text = text.split(from).join(to); fs.writeFileSync(path.join(output, file), text + '\n', { flag: 'wx', mode: 0o600 }); }
  const schedule = evaluationSchedule(dataset.fixtures, repeat, seed), trials = [], groundTruth = [];
  const sourceRevision = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: repository, encoding: 'utf8', timeout: 10000 }).stdout?.trim() || null;
  const implementationHashes = Object.fromEntries(['scripts/learning-evaluation.js','src/learning.js','src/swarm.js','src/candidates.js','src/execution.js'].map(file => [file, digest(fs.readFileSync(path.join(repository,file)))]));
  persist('manifest.json', { schemaVersion: 1, datasetHash: digest(dataset), dataset, agent, identity, evidenceKind, repeat, seed, budget: { callsRequired, maxCalls, timeoutMs, maxOutputBytes, stabilityRuns }, schedule, sourceRevision, implementationHashes, node: process.version });
  try {
    const historical = path.join(workspace, 'history'); project(historical, [], true);
    for (const h of dataset.history) { install(historical, h.files); const staged = stagePatch(historical, { files: h.tests, requirements: h.requirements, review: review(h.requirements) }); const validation = validateCandidates(historical, staged.id); persist(`history-${h.id}.json`, validation); if (!validation.accepted) throw new Error('Historical example did not pass genuine candidate validation'); }
    const memory = fs.readFileSync(path.join(historical, '.tddswarm/learning/index.json'));
    // Ground truth is evaluated in roots never passed to the worker. No held-out code enters memory.
    for (const f of dataset.fixtures) {
      const root = path.join(workspace, `labels-${f.id}`); project(root, f.files, false); install(root, f.referenceTests);
      const baselines = Array.from({length:stabilityRuns}, () => collect(root, configuration(false))), base = baselines[0]; if (!baselines.every(successful) || !stableOutcomes(baselines)) throw new Error(`Independent reference baseline failed or unstable: ${f.id}`);
      const defects = [];
      for (const d of f.defects) { install(root, d.files); const executions = Array.from({length:stabilityRuns}, () => collect(root, configuration(false))), result = executions[0]; install(root, f.files); if (!executions.every(detected) || !stableOutcomes(executions)) throw new Error(`Undemonstrated, incomplete or unstable held-out defect: ${f.id}/${d.id}`); defects.push({ id: d.id, result, executions }); }
      groundTruth.push({ fixture: f.id, base, baselines, defects }); persist(`labels-${f.id}.json`, groundTruth.at(-1));
    }
    let calls = 0;
    for (const pair of schedule) for (const arm of pair.arms) {
      const f = dataset.fixtures.find(item => item.id === pair.fixture), root = path.join(workspace, `${f.id}-${pair.repetition}-${arm}`), config = configuration(arm === 'with_memory'); project(root, f.files, config.learning.enabled);
      write(root, '.tddswarm/learning/index.json', memory.toString('utf8'));
      const learning = recallLessons(root, f.requirements.slice(0,4096), { config, limit: 5, maxChars: 12000, contract: f.requirements });
      const row = { fixture: f.id, specificationId: f.specificationId, repetition: pair.repetition, arm, order: trials.length, recalledRecords: learning.records.length, recall: 0, cases: 0, generationMs: 0, totalMs: 0, inputBytes: 0, outputBytes: 0, calls: [], defects: [], stabilityRuns, billing:{currency:'USD',amount:null,reason:'Worker transport does not report verified provider billing.'} };
      const totalStart = performance.now(), generationStart = performance.now();
      const context = f.files.map(file => ({ file: file.path, content: file.content }));
      const budget = { maxTasks: 1, maxOutputBytes, timeoutMs, callsPerTrial: 3, orderSeed: seed, instructions: 'Use only supplied context and requirements. No tools or filesystem reads. Return one task, then independent runnable Node tests named test/NAME.test.js (Node test and assert builtins; package type is module). Historical patterns are advisory. Do not infer expected values from current implementation.' };
      async function request(role, payload) {
        if (++calls > maxCalls) throw new Error('Worker call budget exceeded');
        const sent = { schemaVersion: 1, role, requirements: f.requirements, context, budget, ...payload };
        const inputBytes = Buffer.byteLength(JSON.stringify(sent)); row.inputBytes += inputBytes;
        const start = performance.now(),workerBefore=snapshot(root,config),inventoryBefore=workerInventory(root); let result;
        try { result = await callAgent(agent, sent, root, timeoutMs, {maxOutputBytes}); }
        catch (error) { row.calls.push({ role, durationMs: Math.round(performance.now() - start), inputBytes, input: sent, error: error.message }); throw error; }
        const bytes = Buffer.byteLength(JSON.stringify(result));
        row.outputBytes += bytes; row.calls.push({ role, durationMs: Math.round(performance.now() - start), inputBytes, input: sent, output: result, outputBytes: bytes });
        if (!freshness(workerBefore,snapshot(root,config)).fresh || inventoryBefore !== workerInventory(root)) throw new Error('Worker changed the source or installed tests outside the JSON protocol');
        if (bytes > maxOutputBytes) throw new Error('Worker response exceeds declared output budget'); return result;
      }
      try {
        if (arm === 'with_memory' && !learning.records.length) row.noApplicableMemory = true;
        const architecture = await request('architect', { learning, order: { subjects: f.files.map(file => file.path), roles: ['architect','author','reviewer'], acceptance: ['Independent requirements, deterministic assertions, boundaries and errors.'] } });
        if (!Array.isArray(architecture.tasks) || architecture.tasks.length !== 1 || !f.files.some(file => file.path === architecture.tasks[0]?.subject) || !boundedText(architecture.tasks[0]?.instructions, 16000)) throw new Error('Paired budget requires exactly one valid architect task');
        const draft = await request('author', { learning, task: architecture.tasks[0] }); fileList(draft.files, 'test');
        const assessed = await request('reviewer', { files: draft.files, acceptance: ['Independent current specification, deterministic runnable cases.'] });
        row.generationMs = Math.round(performance.now() - generationStart);
        const staged = stagePatch(root, { files: draft.files, requirements: f.requirements, review: assessed }); row.validation = validateCandidates(root, staged.id);
        if (!row.validation.accepted) throw new Error('Generated candidate failed independent review or execution validation');
        applyPatch(root, staged.id, { execute: true }); row.baselines = Array.from({length:stabilityRuns}, () => collect(root, config)); row.baseline = row.baselines[0]; if (!row.baselines.every(successful) || !stableOutcomes(row.baselines)) throw new Error('Generated test baseline incomplete, failing or unstable'); row.cases = row.baseline.tests.filter(t => t.status === 'passed').length;
        for (const d of f.defects) { install(root, d.files); const executions = Array.from({length:stabilityRuns}, () => collect(root, config)), result = executions[0]; install(root, f.files); row.defects.push({ id: d.id, detected: executions.every(detected) && stableOutcomes(executions), result, executions, stable:stableOutcomes(executions) }); if (!stableOutcomes(executions)) throw new Error('Held-out execution incomplete or unstable: ' + d.id); }
        row.recall = row.defects.filter(d => d.detected).length / f.defects.length;
      } catch (error) { row.error = error.message; row.generationMs ||= Math.round(performance.now() - generationStart); }
      row.totalMs = Math.round(performance.now() - totalStart); trials.push(row); persist(`trial-${f.id}-${pair.repetition}-${arm}.json`, row);
    }
    const summary = { schemaVersion: 1, dataset: dataset.id, datasetHash: digest(dataset), sourceRevision, evidenceKind, identity, repeat, seed, calls, budget: { maxCalls, timeoutMs, maxOutputBytes, stabilityRuns }, arms: ['without_memory','with_memory'].map(arm => { const rows = trials.filter(row => row.arm === arm); return { arm, trials: rows.length, failedTrials: rows.filter(row => row.error).length, detected: rows.reduce((n,row) => n + (row.error ? 0 : row.defects.filter(d => d.detected).length), 0), totalDefects: dataset.fixtures.reduce((n,f) => n + f.defects.length, 0) * repeat, meanCases: mean(rows.map(row => row.cases)), meanGenerationMs: mean(rows.map(row => row.generationMs)), meanOutputBytes: mean(rows.map(row => row.outputBytes)), meanInputBytes: mean(rows.map(row => row.inputBytes)), meanTotalMs: mean(rows.map(row => row.totalMs)), calls: rows.reduce((n,row)=>n+row.calls.length,0), stableTrials:rows.filter(row=>!row.error&&row.baselines&&stableOutcomes(row.baselines)&&row.defects.every(d=>d.stable)).length, billingUSD:null }; }), comparison: summarizeEvaluation(trials, dataset.fixtures, repeat), limitations: ['Constructed authored contract dataset; different IDs/hashes prevent exact overlap, but maintainers must audit semantic independence. No production-corpus or competitor claim.', 'Repeated outputs are clustered by specification, not treated as independent samples.', 'Worker identity is operator-declared; model version/seed and provider token billing are not verified by this protocol.', 'Fixed three calls per successful arm; identical argv, time and response-byte limits. Input size increases with memory.', 'Transport rejects responses exceeding the identical declared byte budget in both arms; this is not a provider token or dollar cap. Requested deadlines propagate to adapters; host suspension can delay timers and late successes are rejected.', 'Hold-out reference tests and defect payloads are absent from agent stdin and trial roots; trusted custom workers are not a security sandbox.', 'Each reference baseline, generated baseline and held-out defect executes independently at least twice; changed case identities/statuses, skips and incomplete runs invalidate the trial.', 'Input/output bytes and actual calls are transport resource measurements, not provider token counts. billingUSD is unknown, never zero or an invented estimate.', 'Generation time covers architect/author/reviewer; total time also covers candidate validation, repeated stability and defect execution.', 'Failures and incomplete trials remain visible and contribute zero recall; raw receipts stay local until explicitly reviewed for publication.', ...(evidenceKind === 'protocol-fixture' ? ['Protocol fixture workers are orchestration tests, not live AI or learning-quality evidence.'] : [])] };
    if (evidenceKind === 'protocol-fixture') summary.comparison.inference = 'inconclusive-protocol-fixture';
    persist('summary.json', summary); return summary;
  } finally { fs.rmSync(workspace, { recursive: true, force: true }); }
}
export async function main(argv = process.argv.slice(2)) {
  const options = {}; for (let i = 0; i < argv.length; i += 2) { if (!/^--(output|agent|identity|fixtures|repeat|seed|timeout-ms|max-output-bytes|max-calls|evidence-kind|stability-runs)$/.test(argv[i]) || argv[i+1] === undefined) throw new Error('Expected explicit --option value'); const key = argv[i].slice(2); if (Object.hasOwn(options,key)) throw new Error('Duplicate evaluation option'); options[key] = argv[i+1]; }
  if (!options.output || !options.agent || !options.identity) throw new Error('--output new-directory --agent JSON-argv --identity provider/model/version required');
  let dataset; if (options.fixtures) { const stat = fs.statSync(options.fixtures); if (!stat.isFile() || stat.size > 2 * 1024 * 1024) throw new Error('Fixture manifest exceeds bound'); const bytes = fs.readFileSync(options.fixtures); if (bytes.length > 2 * 1024 * 1024) throw new Error('Fixture manifest grew beyond bound'); dataset = JSON.parse(bytes.toString('utf8')); }
  const result = await evaluateLearning({ output: options.output, agent: JSON.parse(options.agent), identity: options.identity, dataset, repeat: options.repeat === undefined ? 3 : Number(options.repeat), seed: options.seed === undefined ? 20260930 : Number(options.seed), timeoutMs: options['timeout-ms'] === undefined ? 115000 : Number(options['timeout-ms']), maxOutputBytes: options['max-output-bytes'] === undefined ? 65536 : Number(options['max-output-bytes']), maxCalls: options['max-calls'] === undefined ? 54 : Number(options['max-calls']), evidenceKind: options['evidence-kind'] || 'live-worker', stabilityRuns: options['stability-runs'] === undefined ? 2 : Number(options['stability-runs']) });
  console.log(JSON.stringify(result,null,2)); return result.comparison.complete ? 0 : 1;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) { try { process.exitCode = await main(); } catch(error) { console.error(error.message); process.exitCode = 1; } }
