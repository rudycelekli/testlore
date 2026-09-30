#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stagePatch, validateCandidates } from '../src/candidates.js';
import { safePath } from '../src/files.js';
import { digest } from '../src/provenance.js';

const implementation = "export function successor(value){if(!Number.isInteger(value))throw new TypeError('integer required');return value+1;}";
const prelude = "import test from 'node:test';import assert from 'node:assert/strict';import {successor} from '../src/successor.js';";
const cases = [
  { name: 'zero successor', assertion: 'assert.equal(successor(0),1)' },
  { name: 'negative successor', assertion: 'assert.equal(successor(-1),0)' },
  { name: 'upper boundary successor', assertion: 'assert.equal(successor(100),101)' },
  { name: 'reject noninteger input', assertion: 'assert.throws(()=>successor(1.5),TypeError)' }
];
const corpus = [
  { name: 'zero off by one', path: 'src/successor.js', content: implementation.replace('return value+1', 'return value===0?0:value+1') },
  { name: 'negative off by one', path: 'src/successor.js', content: implementation.replace('return value+1', 'return value<0?value:value+1') },
  { name: 'upper boundary off by one', path: 'src/successor.js', content: implementation.replace('return value+1', 'return value===100?100:value+1') },
  { name: 'accept noninteger', path: 'src/successor.js', content: implementation.replace("if(!Number.isInteger(value))throw new TypeError('integer required');", '') }
];
const sourceFor = (items, weak = false) => prelude + items.map(item => `test(${JSON.stringify(item.name)},()=>{${weak ? 'assert.ok(true)' : item.assertion};});`).join('\n');
const independentReview = { accepted: true, findings: ['Synthetic protocol fixture; no AI reviewer or Agentic QE was invoked.'], oracle: { independent: true, basis: ['Integer successor requirements and independently written table cases, rather than implementation-derived expectations.'] } };

function write(root, file, content) { const target = safePath(root, file); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, content); }
function measurement(validation) {
  const demonstrated = validation.defects.filter(defect => defect.demonstrated);
  return { accepted: validation.accepted, demonstrated: demonstrated.length, caught: demonstrated.filter(defect => defect.caught).length, missed: demonstrated.filter(defect => !defect.caught).length, recall: demonstrated.length ? demonstrated.filter(defect => defect.caught).length / demonstrated.length : null, reasons: validation.reasons, validation };
}

/** Offline synthetic regression harness. It measures the validator, not LLM quality. */
export function generatedDefectBenchmark() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tddswarm-defects-'));
  try {
    write(root, 'package.json', '{"type":"module"}');
    write(root, 'src/successor.js', implementation);
    write(root, 'test/original.test.js', sourceFor(cases));
    const variants = [];
    for (const weak of [false, true]) {
      const files = [{ path: 'test/numeric.test.js', content: sourceFor(cases.slice(0, 3), weak) }, { path: 'test/invalid.test.js', content: sourceFor(cases.slice(3), weak) }];
      const staged = stagePatch(root, { files, delete: ['test/original.test.js'], requirements: 'For integer input return its mathematical successor. Reject noninteger inputs with TypeError.', review: independentReview, heldOutDefects: corpus });
      variants.push({ name: weak ? 'same-name-vacuous-tests-negative-control' : 'requirement-tests-positive-control', candidateHash: digest(files), ...measurement(validateCandidates(root, staged.id)) });
    }
    const passed = variants[0].accepted && variants[0].caught === corpus.length && !variants[1].accepted && variants[1].missed === corpus.length;
    return { schemaVersion: 1, scope: 'deterministic synthetic held-out defect validation controls; no model efficacy claim', generatedAt: new Date().toISOString(), node: process.version, passed, fixture: { implementation, independentOriginalCases: cases, corpus }, variants };
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}

/** Attach separately supplied defects after authors and reviewer finish. */
export function evaluateHeldOutCandidates(root, id, defects) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(id)) throw new Error('Invalid candidate id');
  const dir = safePath(root, `.tddswarm/candidates/${id}`), manifest = JSON.parse(fs.readFileSync(safePath(dir, 'manifest.json'), 'utf8'));
  const files = manifest.files.map(file => {
    const content = fs.readFileSync(safePath(dir, `files/${file.path}`), 'utf8');
    if (digest(content) !== file.hash) throw new Error(`Candidate content changed: ${file.path}`);
    return { path: file.path, content };
  });
  const staged = stagePatch(root, { ...manifest, files, heldOutDefects: defects });
  const validation = validateCandidates(root, staged.id);
  return { schemaVersion: 1, scope: 'caller-supplied candidates and independent held-out defect corpus', originalCandidate: id, evaluatedCandidate: staged.id, corpusHash: digest(defects), ...measurement(validation) };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  try {
    const args = process.argv.slice(2), options = {};
    for (let i = 0; i < args.length; i += 2) {
      if (!['--project', '--candidate', '--corpus', '--output'].includes(args[i]) || !args[i + 1]) throw new Error('Usage: node scripts/generated-defects.js [--project PATH --candidate ID --corpus FILE] [--output FILE]');
      options[args[i].slice(2)] = args[i + 1];
    }
    const provided = ['project', 'candidate', 'corpus'].filter(key => options[key]);
    if (provided.length && provided.length !== 3) throw new Error('--project, --candidate and --corpus must be supplied together');
    const report = provided.length ? evaluateHeldOutCandidates(path.resolve(options.project), options.candidate, JSON.parse(fs.readFileSync(options.corpus, 'utf8'))) : generatedDefectBenchmark();
    const text = JSON.stringify(report, null, 2) + '\n';
    if (options.output) fs.writeFileSync(path.resolve(options.output), text);
    process.stdout.write(text);
    process.exitCode = provided.length ? (report.accepted ? 0 : 1) : (report.passed ? 0 : 1);
  } catch (error) { process.stderr.write(error.message + '\n'); process.exitCode = 1; }
}
