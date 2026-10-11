import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { normalizeIfixaiReport } from '../src/adapters/ifixai-report.js';

// Synthetic native-format fixture, not a live provider/evaluator result.
// Independently inspected upstream exporter: ifixai-ai/iFixAi at
// 8066421a25df687609d28ce3ed6dab7ec14aa6a2, ifixai/reporting/scorecard.py
// generate_json_report/build_test_results_section and scoring/mandatory_minimums.py.
const fixture = () => JSON.parse(fs.readFileSync(new URL('./fixtures/assessments/ifixai-native.json', import.meta.url), 'utf8'));
test('all-passing native iFixAi grade cannot establish complete or current assessment coverage', () => {
  const result = normalizeIfixaiReport(fixture());
  assert.equal(result.plugin, 'ifixai');
  assert.equal(result.outcome, 'incomplete');
  assert.equal(result.upstream.reportedGrade, 'A');
  assert.equal(result.upstream.format, 'native-json');
  assert.equal(Object.hasOwn(result.upstream, 'schemaVersion'), false);
  assert.equal(result.checks.length, 6);
  assert.equal(result.counts.pass, 6);
  assert.match(result.uncertainties.join(' '), /current code.*unverified/i);
  assert.match(result.uncertainties.join(' '), /no report schema version/i);
});
test('native mandatory failures survive optimistic aggregates and missing inspection entries', () => {
  const report = fixture();
  report.mandatory_minimums.per_test.B08 = 'fail';
  report.mandatory_minimums.violations = ['B08'];
  report.test_results = report.test_results.filter(check => check.test_id !== 'B08');
  const result = normalizeIfixaiReport(report);
  assert.equal(result.outcome, 'findings');
  assert.equal(result.checks.find(check => check.id === 'mandatory:B08').status, 'fail');
  assert.equal(result.upstream.reportedScore, 1);
  // Even an inconsistent optimistic per-test map cannot suppress a violation.
  report.mandatory_minimums.per_test.B08 = 'pass';
  assert.equal(normalizeIfixaiReport(report).checks.find(check => check.id === 'mandatory:B08').status, 'fail');
});
test('reported calls and latency remain bounded observations with incomplete cost caveat', () => {
  const report = fixture(); report.test_results[0].judge_calls_used = 10;
  const result = normalizeIfixaiReport(report);
  assert.equal(result.checks[0].judgeCallsUsed, 10);
  assert.equal(result.checks[0].durationMs, 1);
  assert.match(result.uncertainties.join(' '), /internal SDK retries/);
});
test('partial and omitted mandatory checks are explicit not-run, never grade A coverage', () => {
  const report = fixture();
  report.partial = true;
  report.abort_reason = 'SECRET_BUDGET_CONTEXT';
  report.test_results = report.test_results.filter(check => check.test_id !== 'P01');
  report.not_run_test_ids = ['P01'];
  report.mandatory_minimums.evaluated = false;
  report.mandatory_minimums.per_test.P01 = 'inconclusive';
  report.mandatory_minimums.not_run = ['P01'];
  const result = normalizeIfixaiReport(report);
  assert.equal(result.outcome, 'incomplete');
  assert.equal(result.checks.find(check => check.id === 'P01').status, 'not-run');
  assert.equal(result.checks.find(check => check.id === 'mandatory:P01').status, 'not-run');
  assert.equal(result.counts.notRun, 2);
  assert.match(result.uncertainties.join(' '), /partial, aborted/);
  assert.equal(JSON.stringify(result).includes('SECRET_BUDGET_CONTEXT'), false);
});
test('insufficient, error, extraction and no-evidence outcomes remain incomplete', () => {
  for (const mutate of [
    report => report.warnings.push('insufficient evidence: B01 (got 1, min 10)'),
    report => { report.test_results[0].status = 'error'; report.test_results[0].score = null; report.test_results[0].error = 'PRIVATE_ERROR'; },
    report => { report.test_results[0].status = 'inconclusive'; report.test_results[0].score = null; },
    report => { report.test_results[0].evidence[0].extraction_error = 'budget'; },
    report => { report.test_results[0].evidence = []; report.test_results[0].evidence_count = 0; }
  ]) {
    const report = fixture(); mutate(report);
    const result = normalizeIfixaiReport(report);
    assert.equal(result.outcome, 'incomplete');
    assert.equal(result.checks[0].status, 'incomplete');
    assert.equal(JSON.stringify(result).includes('PRIVATE_ERROR'), false);
  }
});
test('exploratory, advisory and attestation outcomes retain native diagnostic classification', () => {
  const report = fixture();
  report.warnings = [
    'exploratory inspection (excluded from aggregation): B01',
    'advisory inspection (excluded from aggregation): B08',
    'attestation inspection (deployer-attested, not scored): P01'
  ];
  const result = normalizeIfixaiReport(report);
  assert.equal(result.outcome, 'incomplete');
  assert.equal(result.counts.advisory, 3);
  assert.deepEqual(result.checks.slice(0, 3).map(check => check.classifications), [['exploratory'], ['advisory'], ['attestation']]);
  report.test_results[0].status = 'fail';
  report.test_results[0].passing = false;
  const failed = normalizeIfixaiReport(report);
  assert.equal(failed.outcome, 'findings');
  assert.equal(failed.checks[0].status, 'advisory');
  assert.equal(failed.checks[0].nativeStatus, 'fail');
});
test('resume, self-judge and private raw evidence do not become provenance or escape output', () => {
  const report = fixture();
  report.metadata.self_judged = true;
  report.metadata.provider = 'https://PRIVATE_TOKEN@example.test';
  report.metadata.system_name = 'PRIVATE_TOKEN';
  report.resumed_run_id = 'PRIVATE_TOKEN';
  report.reused_result_count = 2;
  for (const field of ['prompt_sent', 'actual', 'expected', 'description', 'evaluation_result']) report.test_results[0].evidence[0][field] = 'PRIVATE_TOKEN';
  report.test_results[0].evidence[0].details = { apiKey: 'PRIVATE_TOKEN' };
  report.warnings = ['PRIVATE_TOKEN'];
  const result = normalizeIfixaiReport(report);
  assert.equal(JSON.stringify(result).includes('PRIVATE_TOKEN'), false);
  assert.match(result.uncertainties.join(' '), /judged its own outputs/);
  assert.match(result.uncertainties.join(' '), /final session/);
  assert.equal(result.upstream.reusedResultCount, 2);
});
test('zero executed checks cannot become clean through empty mandatory maps', () => {
  const report = fixture(); report.test_results = []; report.mandatory_minimums.per_test = {};
  const result = normalizeIfixaiReport(report);
  assert.equal(result.outcome, 'incomplete');
  assert.equal(result.checks.length, 0);
  assert.match(result.uncertainties.join(' '), /No executed/);
  report.warnings = ['insufficient evidence: B11 (got 0, min 10)'];
  const orphan = normalizeIfixaiReport(report).checks.find(check => check.id === 'B11');
  assert.equal(orphan.status, 'incomplete');
  assert.deepEqual(orphan.classifications, ['insufficient']);
});
test('malformed, unsupported, coerced and contradictory native records fail closed', () => {
  const mutations = [
    report => { delete report.partial; },
    report => { delete report.mandatory_minimums; },
    report => { report.metadata.specification_version = '4.0'; },
    report => { report.schemaVersion = 99; },
    report => { report.test_results[0].status = 'success'; },
    report => { report.overall.score = '1'; },
    report => { report.test_results[0].score = -0.1; },
    report => { report.test_results[0].score = NaN; },
    report => { delete report.test_results[0].score; },
    report => { report.test_results[0].evidence_count = 999; },
    report => { report.test_results[0].passing = 'true'; },
    report => { report.test_results[0].threshold = null; },
    report => { report.test_results[0].duration_ms = Infinity; },
    report => { report.test_results[0].judge_calls_used = -1; },
    report => { delete report.test_results[0].evidence[0].extraction_error; },
    report => { report.test_results[0].evidence[0].extraction_error = 'ignored'; },
    report => { report.test_results.push(structuredClone(report.test_results[0])); },
    report => { report.not_run_test_ids = ['B01']; },
    report => { report.not_run_test_ids = ['../../secrets']; },
    report => { report.mandatory_minimums.per_test.B08 = 'skipped'; },
    report => { report.mandatory_minimums.not_run = ['B08']; report.mandatory_minimums.violations = ['B08']; },
    report => { report.warnings = ['attestation inspection (deployer-attested, not scored): PRIVATE_TOKEN']; },
    report => { report.reused_result_count = 4; },
    report => { report.warnings = Array(1025).fill('warning'); }
  ];
  for (const mutate of mutations) { const report = fixture(); mutate(report); assert.throws(() => normalizeIfixaiReport(report), /Invalid or unsupported/); }
  for (const report of [null, [], {}, true]) assert.throws(() => normalizeIfixaiReport(report), /Invalid or unsupported/);
});
