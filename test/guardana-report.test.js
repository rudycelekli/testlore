import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { normalizeGuardanaReport } from '../src/adapters/guardana-report.js';

// Synthetic native schema-17 fixture, validated against the pinned upstream
// schemas/run-v17.schema.json with Python jsonschema Draft202012Validator.
// No Guardana process, target, judge, or live model produced these fixtures.
const fixture = () => JSON.parse(fs.readFileSync(new URL('./fixtures/assessments/guardana-clean-v17.json', import.meta.url), 'utf8'));
function reconcile(report) {
  const summary = report.run.result_summary;
  for (const key of ['findings', 'unverified', 'waived', 'errors', 'observations', 'assessments']) summary[key] = report[key].length;
  summary.measured = report.assessments.filter(a => a.status === 'measured').length;
  return report;
}
const finding = () => ({ rule_id: 'contract.fixture', severity: 'HIGH', title: 'Synthetic fixture finding', taxonomy: [], target_ref: 'synthetic-only', evidence: { summary: 'Fixture', detail: 'Fixture' }, verdict: { outcome: 'fail', confidence: 1, rationale: 'Fixture', evaluator_id: 'fixture@1' } });

test('Guardana native v17 measured report is a historical reported-clean projection only', () => {
  const report = fixture(); const original = JSON.stringify(report);
  const normalized = normalizeGuardanaReport(report);
  assert.equal(normalized.plugin, 'guardana'); assert.equal(normalized.schemaVersion, 1);
  assert.equal(normalized.upstream.schemaVersion, 17); assert.equal(normalized.outcome, 'reported-clean');
  assert.equal(normalized.counts.pass, 1); assert.deepEqual(normalized.uncertainties, []);
  assert.match(normalized.nextAction, /native validation/);
  assert.equal(JSON.stringify(report), original);
});
test('only supported native schema accepted; fabricated generic scores and older schemas refused', () => {
  for (const report of [null, [], {}, { score: 100, passed: true }, { ...fixture(), schema_version: 12 }, { ...fixture(), schema_version: 18 }, { ...fixture(), schema_version: '17' }]) assert.throws(() => normalizeGuardanaReport(report), /Malformed|Unsupported/);
});
test('missing complete channels or summaries cannot silently become passes', () => {
  for (const field of ['unverified', 'errors', 'assessments', 'waived', 'scope']) {
    const report = fixture(); delete report[field]; assert.throws(() => normalizeGuardanaReport(report), /required/);
  }
  for (const field of ['rules_skipped', 'stopped_by', 'measured', 'gate']) {
    const report = fixture(); delete report.run.result_summary[field]; assert.throws(() => normalizeGuardanaReport(report), /required/);
  }
  const report = fixture(); delete report.run.coverage.shortfall; assert.throws(() => normalizeGuardanaReport(report), /required/);
});
test('findings remain failures even alongside a conflicting native pass gate', () => {
  const report = reconcile(fixture()); report.findings.push(finding()); reconcile(report);
  const normalized = normalizeGuardanaReport(report);
  assert.equal(normalized.upstream.nativeGate, 'pass'); assert.equal(normalized.outcome, 'findings'); assert.equal(normalized.counts.nativeFindings, 1);
  assert.equal(normalized.checks.find(c => c.id === 'findings:1').status, 'fail');
});
test('unverified and waived findings preserve uncertainty despite an upstream pass gate', () => {
  for (const channel of ['unverified', 'waived']) {
    const report = fixture(); report[channel].push(finding()); reconcile(report);
    const result = normalizeGuardanaReport(report);
    assert.equal(result.outcome, 'incomplete'); assert.ok(result.uncertainties.length);
    assert.equal(result.checks.find(c => c.id === `${channel}:1`).status, channel === 'waived' ? 'advisory' : 'incomplete');
  }
});
test('native check errors remain incomplete alongside passing assessments', () => {
  const report = fixture(); report.errors.push({ source: 'fixture', stage: 'fixture', reason: 'Fixture' }); reconcile(report);
  const result = normalizeGuardanaReport(report); assert.equal(result.outcome, 'incomplete'); assert.equal(result.counts.nativeErrors, 1); assert.equal(result.counts.pass, 1);
});
test('all native stop reasons mean incomplete coverage', () => {
  for (const reason of ['budget_exhausted', 'interrupted', 'target_unavailable', 'target_changed']) {
    const report = fixture(); report.run.result_summary.stopped_by = reason;
    const result = normalizeGuardanaReport(report); assert.equal(result.outcome, 'incomplete'); assert.equal(result.checks.find(c => c.id === 'run:stopped').reason, reason);
  }
  const report = fixture(); report.run.result_summary.stopped_by = 'new_unknown_stop'; assert.throws(() => normalizeGuardanaReport(report), /Malformed/);
});
test('all coverage-shortfall kinds retain incomplete evidence with no raw details', () => {
  for (const kind of ['missing_dimension', 'contract_not_applicable', 'unexamined_component', 'incomplete_recording', 'demanded_check', 'seed_not_reached', 'empty_target', 'ungraded_cases']) {
    const report = fixture(); report.run.coverage.shortfall.push({ kind, name: 'SECRET-MARKER', detail: 'SECRET-MARKER' });
    const result = normalizeGuardanaReport(report); assert.equal(result.outcome, 'incomplete'); assert.equal(result.checks.find(c => c.id === 'shortfall:1').reason, kind); assert.equal(JSON.stringify(result).includes('SECRET-MARKER'), false);
  }
});
test('skipped rules retain their native distinction and cannot masquerade as passing checks', () => {
  for (const reason of ['missing_capability', 'unsafe_mode', 'not_applicable', 'not_recorded', 'not_offered']) {
    const report = fixture(); report.run.result_summary.rules_skipped = [{ rule_id: 'different-rule', reason, missing: [], detail: 'Fixture' }];
    const result = normalizeGuardanaReport(report); assert.equal(result.counts.notRun, 1);
    assert.equal(result.checks.find(c => c.id === 'skipped:1').status, 'not-run');
    assert.equal(result.outcome, reason === 'not_applicable' ? 'reported-clean' : 'incomplete');
  }
});
test('no measured assessment, empty rule execution, missing fingerprints and timestamps stay incomplete', () => {
  const cases = [r => { r.assessments = []; reconcile(r); }, r => { r.run.result_summary.rules_run = []; }, r => { r.run.completed_at = null; }, r => { r.run.coverage.digest = null; }, r => { r.run.migrated_from = 12; }, r => { r.scope = { files: [], excludes: [], ignored_directories: [] }; }, r => { r.run.target.document = { digest: `sha256:${'a'.repeat(64)}`, kind: 'content_prefix', bytes: 100 }; }];
  for (const change of cases) { const report = fixture(); change(report); assert.equal(normalizeGuardanaReport(report).outcome, 'incomplete'); }
});
test('assessment unknown, ungraded, errored and skipped states cannot be coerced into passes', () => {
  for (const status of ['inconclusive', 'error', 'skipped']) {
    const report = fixture(); report.assessments[0].status = status; reconcile(report);
    const result = normalizeGuardanaReport(report); assert.equal(result.outcome, 'incomplete'); assert.equal(result.counts.pass, 0);
  }
  const ungraded = fixture(); ungraded.assessments[0].passed = null; assert.equal(normalizeGuardanaReport(ungraded).outcome, 'incomplete');
  const absent = fixture(); delete absent.assessments[0].passed; assert.equal(normalizeGuardanaReport(absent).outcome, 'incomplete');
  for (const passed of [1, 'true', {}, []]) { const report = fixture(); report.assessments[0].passed = passed; assert.throws(() => normalizeGuardanaReport(report), /Malformed/); }
  const unknown = fixture(); unknown.assessments[0].status = 'certified'; reconcile(unknown); assert.throws(() => normalizeGuardanaReport(unknown), /Malformed/);
  const contradictory = fixture(); contradictory.assessments[0].reason = 'declined'; assert.throws(() => normalizeGuardanaReport(contradictory), /Malformed/);
});
test('count truncation and missing rule identities are rejected', () => {
  for (const field of ['findings', 'unverified', 'waived', 'errors', 'observations', 'assessments', 'measured']) {
    const report = fixture(); report.run.result_summary[field]++; assert.throws(() => normalizeGuardanaReport(report), /count disagrees/);
  }
  const missing = fixture(); missing.run.rules = []; assert.throws(() => normalizeGuardanaReport(missing), /missing rule metadata/);
  const duplicate = fixture(); duplicate.run.result_summary.rules_run.push('contract.fixture'); assert.throws(() => normalizeGuardanaReport(duplicate), /duplicate/);
  const mixed = fixture(); mixed.run.result_summary.rules_skipped.push({ rule_id: 'contract.fixture', reason: 'not_recorded', missing: [], detail: 'Fixture' }); assert.throws(() => normalizeGuardanaReport(mixed), /contradictory/);
});
test('uncompleted manifest rules and unbound assessments cannot satisfy clean scope', () => {
  const uncompleted = fixture(); uncompleted.run.rules.push({ ...uncompleted.run.rules[0], id: 'suite.stopped' });
  assert.equal(normalizeGuardanaReport(uncompleted).outcome, 'incomplete');
  const unknown = fixture(); unknown.assessments[0].rule_id = 'unknown.rule';
  assert.throws(() => normalizeGuardanaReport(unknown), /missing rule metadata/);
  for (const ruleId of ['', null]) {
    const report = fixture(); if (ruleId === null) delete report.assessments[0].rule_id; else report.assessments[0].rule_id = ruleId;
    const result = normalizeGuardanaReport(report); assert.equal(result.outcome, 'incomplete'); assert.equal(result.counts.pass, 0);
  }
  const stopped = fixture(); stopped.run.result_summary.rules_run = []; stopped.run.result_summary.stopped_by = 'budget_exhausted';
  assert.equal(normalizeGuardanaReport(stopped).outcome, 'incomplete');
  stopped.assessments[0].passed = false;
  const result = normalizeGuardanaReport(stopped); assert.equal(result.outcome, 'findings'); assert.ok(result.uncertainties.length);
});
test('gate failure remains a native reported finding; indeterminate or null gate stays incomplete', () => {
  for (const gate of ['fail', 'indeterminate', null]) {
    const report = fixture(); report.run.result_summary.gate = gate;
    assert.equal(normalizeGuardanaReport(report).outcome, gate === 'fail' ? 'findings' : 'incomplete');
  }
});
test('independent failure and missing evidence remain visible together', () => {
  const report = fixture(); report.assessments[0].passed = false; report.run.coverage.shortfall.push({ kind: 'demanded_check', name: 'Fixture', detail: 'Fixture' });
  const result = normalizeGuardanaReport(report); assert.equal(result.outcome, 'findings'); assert.equal(result.counts.fail, 1); assert.equal(result.counts.incomplete, 1); assert.ok(result.uncertainties.length);
});
test('raw secret-bearing fields never enter the normalized projection', () => {
  const report = fixture(); const marker = 'SECRET-CREDENTIAL-DO-NOT-EMIT';
  report.run.run_id = marker; report.run.target.ref = `https://user:${marker}@example.invalid`; report.run.source.run_url = marker;
  report.assessments[0].case_id = marker; report.assessments[0].assessor = marker; report.assessments[0].subject_ref = marker; report.assessments[0].rationale = marker;
  report.findings = [{ ...finding(), title: marker, evidence: { summary: marker, detail: marker } }]; reconcile(report);
  assert.equal(JSON.stringify(normalizeGuardanaReport(report)).includes(marker), false);
});
test('altered and interrupted source recordings do not become complete evidence', () => {
  for (const origin of [null, { run_id: 'Fixture', target: 'Fixture', started_at: null, stopped_by: 'interrupted', gate: 'pass' }]) {
    const report = fixture(); report.run.recording = { name: 'Fixture', version: '1', subject: null, verbatim: origin !== null, origin };
    assert.equal(normalizeGuardanaReport(report).outcome, 'incomplete');
  }
});
test('trial and suite gaps retain failure and incompleteness separately', () => {
  const report = fixture(); report.run.rules[0].trial_summary = { trials_per_case: 2, cases: 2, cases_failed: 1, cases_incomplete: 1, bound: null, mean_success_rate: null, correction: null };
  const result = normalizeGuardanaReport(report); assert.equal(result.outcome, 'findings'); assert.ok(result.uncertainties.length);
  report.run.rules[0].trial_summary = null;
  report.run.rules[0].suite = { dataset: 'fixture@1', dataset_digest: 'sha256:abcd', sample_size: null, sample_seed: null, trials_per_case: 1, cases: 2, measured: 1, ungraded: 1, worst: 0.5, best: 1, low: 0.2, high: 1, min_pass_rate: 0.9, min_sample: 1, outcome: 'pass', reason: null, correction: {} };
  assert.equal(normalizeGuardanaReport(report).outcome, 'incomplete');
  report.run.rules[0].suite.measured = 2; assert.throws(() => normalizeGuardanaReport(report), /suite counts/);
});
test('malformed channels, metadata, bounded sizes, and unknown native enums are rejected', () => {
  const changes = [r => { r.errors = true; }, r => { r.run.coverage.shortfall = null; }, r => { r.run.rules[0].suite = { outcome: 'pass' }; }, r => { r.run.result_summary.gate = 'approved'; }, r => { r.run.guardana.commit = 'secret'; }, r => { r.run.coverage.digest = 'weak-digest'; }, r => { r.run.run_id = 'x'.repeat(16385); }, r => { r.assessments = Array(4097).fill(r.assessments[0]); reconcile(r); }];
  for (const change of changes) { const report = fixture(); change(report); assert.throws(() => normalizeGuardanaReport(report), /Malformed/); }
});
