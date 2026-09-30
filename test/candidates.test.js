import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { stagePatch, validateCandidates, applyPatch } from '../src/candidates.js';
import { snapshot } from '../src/provenance.js';
import { fixture, write } from './helpers.js';

const source = 'export const increment = value => value + 1;';
const first = "import test from 'node:test'; import assert from 'node:assert/strict'; import {increment} from '../src/increment.js'; test('increments zero',()=>assert.equal(increment(0),1));";
const second = "import test from 'node:test'; import assert from 'node:assert/strict'; import {increment} from '../src/increment.js'; test('increments negatives',()=>assert.equal(increment(-1),0));";
const review = { accepted: true, findings: ['Names and integration assertions retained.'], oracle: { independent: true, basis: ['Requirement: increment returns the mathematical successor, including zero and negative integers.'] } };
function project(t, extras = {}) {
  return fixture(t, { 'package.json': { type: 'module' }, 'src/increment.js': source, 'test/original.test.js': first + second.replace(/import .*?;/g, ''), ...extras });
}
function patch(root, extra = {}) {
  return stagePatch(root, { files: [{ path: 'test/zero.test.js', content: first }, { path: 'test/negative.test.js', content: second }], delete: ['test/original.test.js'], requirements: 'Return the mathematical successor for every finite integer.', review, ...extra });
}

test('reviewed modularization preserves every case and catches held-out defects', t => {
  const root = project(t), original = fs.readFileSync(path.join(root, 'test/original.test.js'), 'utf8');
  const staged = patch(root, { heldOutDefects: [{ name: 'zero off by one', path: 'src/increment.js', content: 'export const increment = value => value === 0 ? 0 : value + 1;' }, { name: 'negative off by one', path: 'src/increment.js', content: 'export const increment = value => value < 0 ? value : value + 1;' }] });
  const result = validateCandidates(root, staged.id);
  assert.equal(result.accepted, true, JSON.stringify(result.reasons));
  assert.equal(result.original.tests.length, 2); assert.equal(result.candidate.tests.length, 2);
  assert.equal(result.defects.length, 2); assert.ok(result.defects.every(defect => defect.demonstrated && defect.caught));
  assert.equal(fs.readFileSync(path.join(root, 'test/original.test.js'), 'utf8'), original);
  assert.equal(fs.existsSync(path.join(root, 'test/zero.test.js')), false);
  assert.equal(applyPatch(root, staged.id).ready, true);
  assert.equal(fs.existsSync(path.join(root, 'test/zero.test.js')), false);
  assert.equal(applyPatch(root, staged.id, { execute: true }).applied, true);
  assert.equal(fs.existsSync(path.join(root, 'test/original.test.js')), false);
  assert.equal(fs.readFileSync(path.join(root, 'test/zero.test.js'), 'utf8'), first);
});

test('a green candidate suite cannot silently remove original cases', t => {
  const root = project(t), staged = patch(root, { files: [{ path: 'test/zero.test.js', content: first }] });
  const result = validateCandidates(root, staged.id);
  assert.equal(result.candidate.exitCode, 0); assert.equal(result.accepted, false);
  assert.ok(result.reasons.includes('original-test-cases-removed'));
  assert.deepEqual(result.missingCases, [{ name: 'increments negatives', expected: 1, actual: 0 }]);
  assert.throws(() => applyPatch(root, staged.id, { execute: true }), /accepted validation/);
});

test('original integration cases retained even when they belong to another test file', t => {
  const root = project(t, { 'test/integration.test.js': "import test from 'node:test';import assert from 'node:assert/strict'; import {increment} from '../src/increment.js';test('integration chain',()=>assert.equal(increment(increment(0)),2));" });
  const staged = patch(root), result = validateCandidates(root, staged.id);
  assert.equal(result.accepted, true, JSON.stringify(result.reasons));
  assert.ok(result.candidate.tests.some(item => item.name === 'integration chain'));
});

test('duplicate case names preserve multiplicity', t => {
  const root = project(t, { 'test/original.test.js': first + first.replace(/import .*?;/g, '') });
  const staged = patch(root, { files: [{ path: 'test/zero.test.js', content: first }] });
  const result = validateCandidates(root, staged.id);
  assert.equal(result.accepted, false); assert.equal(result.missingCases[0].expected, 2);
});

test('empty and skipped candidate files do not count as validated execution', t => {
  for (const content of ['// no tests', "import test from 'node:test';test.skip('not run',()=>{});"]) {
    const root = project(t), staged = patch(root, { files: [{ path: 'test/zero.test.js', content }] });
    const result = validateCandidates(root, staged.id);
    assert.equal(result.accepted, false); assert.ok(result.reasons.some(reason => reason.includes('candidate')));
  }
});

test('bootstrap validation can add executable requirement tests to a project with no tests', t => {
  const root = fixture(t, { 'package.json': { type: 'module' }, 'src/increment.js': source });
  const staged = stagePatch(root, { files: [{ path: 'test/zero.test.js', content: first }], requirements: 'Increment returns successor.', review });
  const result = validateCandidates(root, staged.id);
  assert.equal(result.accepted, true, JSON.stringify(result.reasons)); assert.equal(result.original.tests.length, 0); assert.equal(result.candidate.tests.length, 1);
});

test('an already failing original suite prevents equivalence claims', t => {
  const root = project(t, { 'src/increment.js': 'export const increment = value => value;' }), staged = patch(root);
  const result = validateCandidates(root, staged.id);
  assert.equal(result.accepted, false); assert.ok(result.reasons.includes('original-suite-failed-or-incomplete'));
});

test('requirements and independent reviewer oracle are mandatory', t => {
  const root = project(t);
  assert.throws(() => patch(root, { requirements: '' }), /requirements/);
  for (const candidateReview of [{ accepted: true, findings: [] }, { ...review, oracle: { independent: false, basis: ['Implementation behavior'] } }, { ...review, accepted: false }]) {
    const staged = patch(root, { review: candidateReview });
    const result = validateCandidates(root, staged.id);
    assert.equal(result.accepted, false); assert.equal(result.measured.execution, false);
  }
});

test('staging cannot rebind already changed agent input provenance', t => {
  const root = project(t), before = snapshot(root);
  write(root, 'src/increment.js', source + '\n// agent altered file');
  assert.throws(() => patch(root, { provenance: before }), /stale.*source-drift/);
});

test('source or runner drift invalidates validation and application', t => {
  const root = project(t), staged = patch(root);
  write(root, 'src/increment.js', source + '\n// changed');
  const result = validateCandidates(root, staged.id);
  assert.equal(result.accepted, false); assert.ok(result.reasons.includes('source-drift:src/increment.js'));
  const secondRoot = project(t), secondStage = patch(secondRoot);
  assert.equal(validateCandidates(secondRoot, secondStage.id).accepted, true);
  write(secondRoot, 'tddswarm.config.json', { runner: ['node', '--test', '--test-concurrency=1', '{files}'] });
  assert.throws(() => applyPatch(secondRoot, secondStage.id, { execute: true }), /stale/);
});

test('changed staged content or manifest cannot reuse validation', t => {
  const root = project(t), staged = patch(root);
  assert.equal(validateCandidates(root, staged.id).accepted, true);
  fs.appendFileSync(path.join(staged.directory, 'files/test/zero.test.js'), '\n// tampered');
  assert.throws(() => applyPatch(root, staged.id, { execute: true }), /content changed/);
  fs.writeFileSync(path.join(staged.directory, 'files/test/zero.test.js'), first);
  const file = path.join(staged.directory, 'manifest.json'), manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
  manifest.requirements += ' A new contract.'; fs.writeFileSync(file, JSON.stringify(manifest));
  assert.throws(() => applyPatch(root, staged.id, { execute: true }), /exact manifest/);
});

test('legacy candidates without bound source evidence fail explicitly', t => {
  const root = project(t); write(root, '.tddswarm/candidates/legacy/review.json', { accepted: true });
  assert.throws(() => validateCandidates(root, 'legacy'), /no provenance manifest/);
});

test('staging blocks traversal, metadata, symlinks, protected config and conflicting paths', t => {
  const root = project(t);
  for (const file of ['../escape.test.js', '/tmp/escape.test.js', 'test/./escape.test.js', '.git/config', '.tddswarm/x', 'package.json', 'tddswarm.config.json']) {
    assert.throws(() => patch(root, { files: [{ path: file, content: first }] }));
  }
  fs.symlinkSync(path.join(root, 'src'), path.join(root, 'linked'));
  assert.throws(() => patch(root, { files: [{ path: 'linked/a.test.js', content: first }] }), /Symlink/);
  assert.throws(() => patch(root, { files: [{ path: 'test/original.test.js', content: first }] }), /Conflicting/);
  assert.throws(() => validateCandidates(root, '../legacy'), /Invalid candidate id/);
});

test('fixture additions are validated alongside modular tests', t => {
  const root = project(t), fixtureTest = first.replace('assert.equal(increment(0),1)', 'assert.equal(increment(JSON.parse(fs.readFileSync(new URL("./fixtures/zero.json",import.meta.url))).input),1)').replace("import test from 'node:test';", "import fs from 'node:fs';import test from 'node:test';");
  const staged = patch(root, { files: [{ path: 'test/zero.test.js', content: fixtureTest }, { path: 'test/negative.test.js', content: second }, { path: 'test/fixtures/zero.json', content: '{"input":0}' }] });
  assert.equal(validateCandidates(root, staged.id).accepted, true);
  assert.equal(applyPatch(root, staged.id, { execute: true }).applied, true);
  assert.equal(fs.readFileSync(path.join(root, 'test/fixtures/zero.json'), 'utf8'), '{"input":0}');
});

test('held-out defects must actually be demonstrated by independent original cases', t => {
  const root = project(t), staged = patch(root, { heldOutDefects: [{ name: 'unobservable change', path: 'src/increment.js', content: source + '\n// harmless' }] });
  const result = validateCandidates(root, staged.id);
  assert.equal(result.accepted, false); assert.ok(result.reasons.includes('held-out-defect-not-demonstrated:unobservable change'));
});

test('same named but weakened candidates cannot pass held-out regression checks', t => {
  const root = project(t), staged = patch(root, { files: [{ path: 'test/zero.test.js', content: first.replace('assert.equal(increment(0),1)', 'assert.ok(true)') }, { path: 'test/negative.test.js', content: second }], heldOutDefects: [{ name: 'zero regression', path: 'src/increment.js', content: 'export const increment = value => value === 0 ? 0 : value + 1;' }] });
  const result = validateCandidates(root, staged.id);
  assert.equal(result.accepted, false); assert.equal(result.defects[0].demonstrated, true); assert.equal(result.defects[0].caught, false);
});

test('held-out changes cannot replace tests, config, proposed fixtures or absent source', t => {
  const root = project(t);
  for (const file of ['test/original.test.js', 'package.json', 'src/missing.js', 'test/zero.test.js']) assert.throws(() => patch(root, { heldOutDefects: [{ name: 'bad defect', path: file, content: '' }] }), /Held-out/);
});

test('source syntax errors are not credited as demonstrated held-out behavioral defects', t => {
  const root = project(t), staged = patch(root, { heldOutDefects: [{ name: 'syntax only', path: 'src/increment.js', content: 'export const increment = ;' }] });
  const result = validateCandidates(root, staged.id);
  assert.equal(result.accepted, false); assert.equal(result.defects[0].demonstrated, false);
});

test('nested case identities preserve their suite contract when moving files', t => {
  const root = project(t, { 'test/original.test.js': "import {describe,it} from 'node:test';import assert from 'node:assert/strict';describe('contract',()=>it('nested behavior',()=>assert.equal(1,1)));" });
  const content = fs.readFileSync(path.join(root, 'test/original.test.js'), 'utf8');
  const staged = patch(root, { files: [{ path: 'test/moved.test.js', content }] });
  const result = validateCandidates(root, staged.id);
  assert.equal(result.accepted, true); assert.equal(result.original.tests[0].name, 'contract > nested behavior');
  const weakened = patch(root, { files: [{ path: 'test/moved.test.js', content: content.replace("describe('contract'", "describe('different contract'") }] });
  assert.ok(validateCandidates(root, weakened.id).reasons.includes('original-test-cases-removed'));
});

test('metadata and dependency destinations stay forbidden even under an explicit allowlist', t => {
  const root = project(t);
  for (const file of ['.git/config', '.tddswarm/last-run.json', 'node_modules/example/index.js']) assert.throws(() => patch(root, { files: [{ path: file, content: '{}' }], allowProtectedPaths: [file] }), /Forbidden/);
});

test('arbitrary runner output cannot claim complete candidate validation', t => {
  const root = project(t, { 'runner.mjs': "process.stdout.write('all passed');", 'tddswarm.config.json': { runner: ['node', 'runner.mjs', '{files}'] } }), staged = patch(root);
  const result = validateCandidates(root, staged.id);
  assert.equal(result.accepted, false); assert.ok(result.reasons.some(reason => reason.includes('incomplete')));
});

test('failed atomic installation rolls back deletions and earlier additions', t => {
  const root = project(t), original = fs.readFileSync(path.join(root, 'test/original.test.js'), 'utf8'), staged = patch(root);
  assert.equal(validateCandidates(root, staged.id).accepted, true);
  let count = 0;
  assert.throws(() => applyPatch(root, staged.id, { execute: true, renameSync: (from, to) => { if (++count === 2) throw new Error('simulated disk failure'); fs.renameSync(from, to); } }), /rolled back.*simulated disk failure/);
  assert.equal(fs.readFileSync(path.join(root, 'test/original.test.js'), 'utf8'), original);
  assert.equal(fs.existsSync(path.join(root, 'test/zero.test.js')), false);
  assert.equal(fs.existsSync(path.join(root, 'test/negative.test.js')), false);
  assert.equal(fs.readdirSync(path.join(root, 'test')).some(file => file.endsWith('.tmp')), false);
  assert.equal(applyPatch(root, staged.id, { execute: true }).applied, true);
});


test('modified validation outcomes cannot authorize application', t => {
  const root=project(t);
  const staged=stagePatch(root,{files:[{path:'test/increment.test.js',content:first}],review,requirements:'Increment returns the mathematical successor.'});
  const result=validateCandidates(root,staged.id);assert.equal(result.accepted,true);
  const file=path.join(staged.directory,'validation.json');const saved=JSON.parse(fs.readFileSync(file));saved.candidate.durationMs=123;fs.writeFileSync(file,JSON.stringify(saved));
  assert.throws(()=>applyPatch(root,staged.id,{execute:true}),/integrity mismatch/);
});
