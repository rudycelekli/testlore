// Native JSON exporter inspected at ifixai-ai/iFixAi commit
// 8066421a25df687609d28ce3ed6dab7ec14aa6a2, reporting/scorecard.py:
// generate_json_report/build_*_section. This pin describes adapter development,
// not the origin, completeness, or authenticity of an imported report.
const SOURCE_REVISION = '8066421a25df687609d28ce3ed6dab7ec14aa6a2';
const NATIVE_STATUSES = new Set(['pass', 'fail', 'inconclusive', 'error']);
const ID = /^[A-Z][0-9]{2}$/;
const LIMIT = 1024;
function invalid(field) { throw new Error(`Invalid or unsupported iFixAi native report: ${field}`); }
function object(value, field) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(field);
  return value;
}
function boolean(value, field) { if (typeof value !== 'boolean') invalid(field); return value; }
function array(value, field) { if (!Array.isArray(value) || value.length > LIMIT) invalid(field); return value; }
function text(value, field) { if (typeof value !== 'string' || value.length > 8192) invalid(field); return value; }
function id(value, field) { if (typeof value !== 'string' || !ID.test(value)) invalid(field); return value; }
function ids(value, field) {
  const values = array(value, field).map(item => id(item, field));
  if (new Set(values).size !== values.length) invalid(field);
  return values;
}
function integer(value, field) { if (!Number.isSafeInteger(value) || value < 0) invalid(field); return value; }
function score(value, field) { if (value !== null && (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1)) invalid(field); return value; }
function status(value, field) { if (!NATIVE_STATUSES.has(value)) invalid(field); return value; }
const translated = value => value === 'pass' || value === 'fail' ? value : 'incomplete';
const MARKERS = [
  ['insufficient evidence: ', 'insufficient'],
  ['exploratory inspection (excluded from aggregation): ', 'exploratory'],
  ['advisory inspection (excluded from aggregation): ', 'advisory'],
  ['attestation inspection (deployer-attested, not scored): ', 'attestation']
];

/** Import a historical assessment; never authorizes omissions or native acceptance. */
export function normalizeIfixaiReport(report) {
  object(report, 'document');
  // This upstream exporter has no report schema-version field. Refuse alternate
  // versioned documents rather than silently treating them as the inspected format.
  if (Object.hasOwn(report, 'schemaVersion') || Object.hasOwn(report, 'schema_version')) invalid('report schema version');
  const metadata = object(report.metadata, 'metadata');
  if (metadata.specification_version !== '3.0') invalid('metadata.specification_version');
  const selfJudged = boolean(metadata.self_judged, 'metadata.self_judged');
  const partial = boolean(report.partial, 'partial');
  if (report.abort_reason !== null) text(report.abort_reason, 'abort_reason');
  if (report.resumed_run_id !== null) text(report.resumed_run_id, 'resumed_run_id');
  const reused = integer(report.reused_result_count, 'reused_result_count');
  const notRun = ids(report.not_run_test_ids, 'not_run_test_ids');
  const warnings = array(report.warnings, 'warnings').map(value => text(value, 'warnings'));
  const validationWarnings = array(report.validation_warnings, 'validation_warnings').map(value => text(value, 'validation_warnings'));
  const overall = object(report.overall, 'overall');
  const reportedScore = score(overall.score, 'overall.score');
  if (!['A', 'B', 'C', 'D', 'F'].includes(overall.grade)) invalid('overall.grade');
  if (!['pass', 'fail', 'inconclusive', 'error'].includes(overall.verdict)) invalid('overall.verdict');
  boolean(overall.passed, 'overall.passed');
  boolean(overall.mandatory_minimums_passed, 'overall.mandatory_minimums_passed');
  ids(overall.mandatory_minimums_inconclusive, 'overall.mandatory_minimums_inconclusive');
  const gates = object(report.mandatory_minimums, 'mandatory_minimums');
  boolean(gates.all_passed, 'mandatory_minimums.all_passed');
  const evaluated = boolean(gates.evaluated, 'mandatory_minimums.evaluated');
  boolean(gates.any_inconclusive, 'mandatory_minimums.any_inconclusive');
  const gateStatuses = object(gates.per_test, 'mandatory_minimums.per_test');
  if (Object.keys(gateStatuses).length > LIMIT) invalid('mandatory_minimums.per_test');
  const gateNotRun = ids(gates.not_run, 'mandatory_minimums.not_run');
  const gateInconclusive = ids(gates.inconclusive, 'mandatory_minimums.inconclusive');
  const gateViolations = ids(gates.violations, 'mandatory_minimums.violations');
  const classifications = new Map();
  for (const warning of warnings) for (const [prefix, classification] of MARKERS) {
    if (!warning.startsWith(prefix)) continue;
    const match = /^([A-Z][0-9]{2})(?:$| \(got [0-9]+, min [0-9]+\)$)/.exec(warning.slice(prefix.length));
    if (!match) invalid('classification warning');
    const values = classifications.get(match[1]) || new Set();
    values.add(classification); classifications.set(match[1], values);
  }
  const checks = [], seen = new Set();
  let nativeFailures = 0;
  for (const result of array(report.test_results, 'test_results')) {
    object(result, 'test_results item');
    const checkId = id(result.test_id, 'test_results.test_id');
    if (seen.has(checkId) || notRun.includes(checkId)) invalid('duplicate or executed not-run inspection');
    seen.add(checkId);
    const nativeStatus = status(result.status, 'test_results.status');
    const passing = boolean(result.passing, 'test_results.passing');
    const reportedCheckScore = score(result.score, 'test_results.score');
    if (result.threshold === null) invalid('test_results.threshold');
    score(result.threshold, 'test_results.threshold');
    if (result.error !== null) text(result.error, 'test_results.error');
    const evidence = array(result.evidence, 'test_results.evidence');
    if (integer(result.evidence_count, 'test_results.evidence_count') !== evidence.length) invalid('test_results.evidence_count');
    let extractionFailures = 0, diagnosticCount = 0;
    for (const item of evidence) {
      object(item, 'test_results.evidence item');
      boolean(item.passed, 'test_results.evidence.passed');
      if (!Object.hasOwn(item, 'extraction_error') || !Object.hasOwn(item, 'is_diagnostic')) invalid('evidence provenance');
      if (item.extraction_error !== null) {
        if (!['communication', 'extraction', 'contract', 'budget'].includes(item.extraction_error)) invalid('evidence.extraction_error');
        extractionFailures++;
      }
      if (boolean(item.is_diagnostic, 'evidence.is_diagnostic')) diagnosticCount++;
    }
    if (nativeStatus === 'fail') nativeFailures++;
    const labels = [...(classifications.get(checkId) || [])].sort();
    let normalizedStatus = translated(nativeStatus);
    const incompleteEvidence = labels.includes('insufficient') || extractionFailures > 0 || evidence.length === 0 || result.error !== null ||
      (nativeStatus === 'pass' && (!passing || reportedCheckScore === null));
    if (nativeStatus !== 'fail' && incompleteEvidence) normalizedStatus = 'incomplete';
    else if (nativeStatus !== 'error' && nativeStatus !== 'inconclusive' && labels.some(value => ['exploratory', 'advisory', 'attestation'].includes(value))) normalizedStatus = 'advisory';
    const cost = {};
    if (Object.hasOwn(result, 'judge_calls_used')) cost.judgeCallsUsed = integer(result.judge_calls_used, 'test_results.judge_calls_used');
    if (Object.hasOwn(result, 'duration_ms')) {
      if (typeof result.duration_ms !== 'number' || !Number.isFinite(result.duration_ms) || result.duration_ms < 0) invalid('test_results.duration_ms');
      cost.durationMs = result.duration_ms;
    }
    checks.push({ id: checkId, status: normalizedStatus, nativeStatus, facet: 'inspection', classifications: labels,
      evidenceCount: evidence.length, diagnosticCount, extractionFailures,
      ...cost,
      ...(reportedCheckScore !== null ? { reportedScore: reportedCheckScore } : {}) });
  }
  if (reused > seen.size) invalid('reused_result_count');
  for (const checkId of notRun) checks.push({ id: checkId, status: 'not-run', facet: 'inspection', classifications: [...(classifications.get(checkId) || [])].sort() });
  for (const [checkId, labels] of classifications) {
    if (!seen.has(checkId) && !notRun.includes(checkId)) checks.push({ id: checkId, status: 'incomplete', facet: 'inspection', classifications: [...labels].sort(), evidenceCount: 0 });
  }
  for (const [checkId, value] of Object.entries(gateStatuses)) {
    id(checkId, 'mandatory_minimums.per_test key');
    status(value, 'mandatory_minimums.per_test status');
    if (value === 'fail') nativeFailures++;
    if (gateNotRun.includes(checkId) && gateViolations.includes(checkId)) invalid('contradictory mandatory omission and violation');
    checks.push({ id: `mandatory:${checkId}`, inspectionId: checkId, facet: 'mandatory-minimum', nativeStatus: value,
      status: gateViolations.includes(checkId) ? 'fail' : gateNotRun.includes(checkId) ? 'not-run' : gateInconclusive.includes(checkId) ? 'incomplete' : translated(value) });
  }
  // A status map may be incomplete. Preserve separate omission/violation lists
  // rather than accepting its all_passed summary or dropping their identities.
  for (const checkId of new Set([...gateNotRun, ...gateInconclusive, ...gateViolations])) {
    if (Object.hasOwn(gateStatuses, checkId)) continue;
    if (gateNotRun.includes(checkId) && gateViolations.includes(checkId)) invalid('contradictory mandatory omission and violation');
    const gateStatus = gateNotRun.includes(checkId) ? 'not-run' : gateViolations.includes(checkId) ? 'fail' : 'incomplete';
    checks.push({ id: `mandatory:${checkId}`, inspectionId: checkId, facet: 'mandatory-minimum', status: gateStatus });
  }
  if (gateViolations.length || overall.verdict === 'fail') nativeFailures++;
  const counts = { pass: 0, fail: 0, incomplete: 0, notRun: 0, advisory: 0, inspections: seen.size, nativeFailures };
  for (const check of checks) counts[check.status === 'not-run' ? 'notRun' : check.status]++;
  const uncertainties = [
    'Imported historical assessment; current code, fixture, model, and policy identity are unverified.',
    'Native JSON has no report schema version or complete per-inspection scoring classification; aggregate grades cannot establish complete assessment coverage.',
    'Reported outcomes are diagnostic observations, not native test acceptance or test-selection evidence.'
  ];
  if (partial || report.abort_reason !== null || notRun.length || gateNotRun.length || !evaluated) uncertainties.push('Run was partial, aborted, or left planned or mandatory inspections unevaluated.');
  if (!seen.size) uncertainties.push('No executed inspection results were supplied.');
  if (counts.incomplete) uncertainties.push('Some observations errored, were inconclusive, or lacked sufficient usable evidence.');
  if (counts.advisory) uncertainties.push('Exploratory, advisory, and deployer-attested observations are preserved separately from scored checks.');
  if (selfJudged) uncertainties.push('The system judged its own outputs; evaluator independence is unverified.');
  if (reused || report.resumed_run_id !== null) uncertainties.push('Resumed results may have different evaluator provenance; reported judge-call statistics cover only the final session.');
  if (checks.some(check => check.judgeCallsUsed > 0)) uncertainties.push('Reported judge calls do not include all internal SDK retries; they are not complete token, provider-request, or monetary cost measurements.');
  if (warnings.length || validationWarnings.length) uncertainties.push('Native warnings are present; review the original report privately. Free-form warning and evidence content was not copied.');
  return {
    schemaVersion: 1, plugin: 'ifixai', upstream: { format: 'native-json', adapterSourceRevision: SOURCE_REVISION,
      specificationVersion: metadata.specification_version, selfJudged, partial, reusedResultCount: reused,
      reportedGrade: overall.grade, reportedScore, reportedVerdict: overall.verdict, mandatoryMinimumsEvaluated: evaluated },
    outcome: nativeFailures ? 'findings' : 'incomplete', checks, counts, uncertainties,
    nextAction: nativeFailures ? 'Review reported failing inspections and mandatory gates against independent requirements; rerun native validation after any repair.' :
      'Review omitted and unscored observations and the original native warnings; supply independently bound evidence before making acceptance or completeness claims.'
  };
}
