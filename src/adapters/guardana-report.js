/**
 * Offline, advisory projection of Guardana saved-run schema 17, inspected at
 * guardana/guardana@b6fe4fd2bb45c12107a64dd695e86b3ae4c0829c:
 * schemas/run-v17.schema.json and core/report/{serialize,result,load}.py.
 * This is not the complete upstream JSON Schema validator. It validates the
 * channels and invariants needed for this projection and refuses unsupported
 * versions. It never executes Guardana, a judge, a trace, or a report's strings.
 * No raw evidence, target refs, prompts, labels, or rationales are returned.
 */
const STOP_REASONS = ['budget_exhausted', 'interrupted', 'target_unavailable', 'target_changed'];
const SKIP_REASONS = ['missing_capability', 'unsafe_mode', 'not_applicable', 'not_recorded', 'not_offered'];
const SHORTFALL_KINDS = ['missing_dimension', 'contract_not_applicable', 'unexamined_component', 'incomplete_recording', 'demanded_check', 'seed_not_reached', 'empty_target', 'ungraded_cases'];
const ASSESSMENT_STATUSES = ['measured', 'inconclusive', 'error', 'skipped'];
const ASSESSMENT_REASONS = ['not_recorded', 'reply_altered', 'declined', 'target_declined'];
const MANIFEST_FIELDS = ['run_id', 'created_at', 'started_at', 'completed_at', 'migrated_from', 'source', 'guardana', 'target', 'deployment', 'configuration', 'execution', 'usage', 'rules', 'evaluators', 'coverage', 'result_summary', 'privacy', 'exchanges', 'recording', 'recipe', 'fixtures'];

function invalid(field) { throw new Error(`Malformed Guardana report: ${field}`); }
function object(value, field) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(field);
  return value;
}
function required(value, fields, field) {
  object(value, field);
  for (const key of fields) if (!Object.hasOwn(value, key)) invalid(`${field}.${key} is required`);
  return value;
}
function array(value, field) {
  if (!Array.isArray(value) || value.length > 4096) invalid(field);
  return value;
}
function text(value, field) {
  if (typeof value !== 'string' || value.length > 16384) invalid(field);
  return value;
}
function integer(value, field) {
  if (!Number.isSafeInteger(value) || value < 0) invalid(field);
  return value;
}
function choice(value, values, field, nullable = false) {
  if (!(nullable && value === null) && !values.includes(value)) invalid(field);
  return value;
}
function digest(value, field, nullable = true, sha256 = false) {
  const pattern = sha256 ? /^sha256:[0-9a-f]{64}$/ : /^[a-z0-9]{1,16}:[0-9a-f]{1,128}$/;
  if (!(nullable && value === null) && (typeof value !== 'string' || !pattern.test(value))) invalid(field);
  return value;
}
function timestamp(value, field) {
  if (value !== null && (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(value) || !Number.isFinite(Date.parse(value)))) invalid(field);
}

/** Normalize a parsed native saved-run document; its claims remain self-reports. */
export function normalizeGuardanaReport(report) {
  object(report, 'root');
  if (report.schema_version !== 17) throw new Error('Unsupported Guardana report schema: this adapter reads native schema_version 17 only');
  required(report, ['run', 'findings', 'unverified', 'waived', 'errors', 'observations', 'assessments', 'scope'], 'root');
  const run = required(report.run, MANIFEST_FIELDS, 'run');
  text(run.run_id, 'run.run_id');
  if (!run.run_id) invalid('run.run_id');
  for (const key of ['created_at', 'started_at', 'completed_at']) timestamp(run[key], `run.${key}`);
  if (run.migrated_from !== null) integer(run.migrated_from, 'run.migrated_from');
  const source = required(run.source, ['kind', 'provider', 'run_url'], 'run.source');
  choice(source.kind, ['local', 'ci', 'scheduled', 'imported_trace', 'replay'], 'run.source.kind');
  const guardana = required(run.guardana, ['version', 'commit', 'distribution_versions'], 'run.guardana');
  text(guardana.version, 'run.guardana.version');
  object(guardana.distribution_versions, 'run.guardana.distribution_versions');
  if (guardana.commit !== null && (typeof guardana.commit !== 'string' || !/^[0-9a-f]{40}$/.test(guardana.commit))) invalid('run.guardana.commit');
  const target = required(run.target, ['type', 'ref', 'fingerprint', 'fingerprint_inputs', 'capabilities', 'document'], 'run.target');
  choice(target.type, ['artifact', 'endpoint', 'trace'], 'run.target.type');
  digest(target.fingerprint, 'run.target.fingerprint');
  for (const key of ['fingerprint_inputs', 'capabilities']) array(target[key], `run.target.${key}`).forEach(v => text(v, `run.target.${key}[]`));
  if (target.document !== null) {
    required(target.document, ['digest', 'kind', 'bytes'], 'run.target.document');
    digest(target.document.digest, 'run.target.document.digest', false, true);
    choice(target.document.kind, ['content', 'content_prefix'], 'run.target.document.kind');
    integer(target.document.bytes, 'run.target.document.bytes');
  }
  for (const key of ['deployment', 'configuration', 'execution', 'usage', 'privacy']) object(run[key], `run.${key}`);
  array(run.evaluators, 'run.evaluators');
  const rules = array(run.rules, 'run.rules');
  const coverage = required(run.coverage, ['digest', 'taxonomies', 'protocols', 'shortfall'], 'run.coverage');
  digest(coverage.digest, 'run.coverage.digest');
  array(coverage.taxonomies, 'run.coverage.taxonomies');
  object(coverage.protocols, 'run.coverage.protocols');
  const shortfalls = array(coverage.shortfall, 'run.coverage.shortfall');
  const summary = required(run.result_summary, ['findings', 'unverified', 'waived', 'errors', 'observations', 'rules_run', 'rules_skipped', 'max_severity', 'gate', 'stopped_by', 'assessments', 'measured'], 'run.result_summary');
  choice(summary.gate, ['pass', 'fail', 'indeterminate'], 'run.result_summary.gate', true);
  choice(summary.stopped_by, STOP_REASONS, 'run.result_summary.stopped_by', true);
  const ran = array(summary.rules_run, 'run.result_summary.rules_run');
  ran.forEach(v => text(v, 'run.result_summary.rules_run[]'));
  if (new Set(ran).size !== ran.length) invalid('duplicate rules_run');
  const skipped = array(summary.rules_skipped, 'run.result_summary.rules_skipped');
  for (const channel of ['findings', 'unverified', 'waived', 'errors', 'observations', 'assessments']) {
    array(report[channel], channel);
    integer(summary[channel], `run.result_summary.${channel}`);
    if (summary[channel] !== report[channel].length) invalid(`run.result_summary.${channel} count disagrees with channel`);
  }
  integer(summary.measured, 'run.result_summary.measured');
  if (summary.measured !== report.assessments.filter(a => a?.status === 'measured').length) invalid('run.result_summary.measured count disagrees with assessments');
  if (report.scope !== null) {
    required(report.scope, ['files', 'excludes', 'ignored_directories'], 'scope');
    array(report.scope.files, 'scope.files').forEach(v => text(v, 'scope.files[]'));
    array(report.scope.ignored_directories, 'scope.ignored_directories');
    if (report.scope.excludes !== null) array(report.scope.excludes, 'scope.excludes');
  }

  const checks = [];
  const uncertainties = [];
  const add = (id, status, details = {}) => checks.push({ id, status, ...details });
  const uncertain = reason => { if (!uncertainties.includes(reason)) uncertainties.push(reason); };
  for (const channel of ['findings', 'unverified', 'waived']) report[channel].forEach((finding, i) => {
    required(finding, ['rule_id', 'severity', 'title', 'taxonomy', 'target_ref', 'evidence', 'verdict'], `${channel}[]`);
    for (const key of ['rule_id', 'severity', 'title', 'target_ref']) text(finding[key], `${channel}[].${key}`);
    array(finding.taxonomy, `${channel}[].taxonomy`);
    required(finding.evidence, ['summary', 'detail'], `${channel}[].evidence`);
    text(finding.evidence.summary, `${channel}[].evidence.summary`);
    text(finding.evidence.detail, `${channel}[].evidence.detail`);
    if (finding.verdict !== null) {
      required(finding.verdict, ['outcome', 'confidence', 'rationale', 'evaluator_id'], `${channel}[].verdict`);
      choice(finding.verdict.outcome, ['pass', 'fail', 'inconclusive'], `${channel}[].verdict.outcome`);
      if (typeof finding.verdict.confidence !== 'number' || !Number.isFinite(finding.verdict.confidence) || finding.verdict.confidence < 0 || finding.verdict.confidence > 1) invalid(`${channel}[].verdict.confidence`);
    }
    const status = channel === 'findings' ? 'fail' : channel === 'unverified' ? 'incomplete' : 'advisory';
    add(`${channel}:${i + 1}`, status, { channel });
    if (channel !== 'findings') uncertain(channel === 'unverified' ? 'Some native findings could not be verified.' : 'Waived findings remain reported and require the upstream waiver review.');
  });
  report.errors.forEach((error, i) => {
    required(error, ['source', 'stage', 'reason'], 'errors[]');
    for (const key of ['source', 'stage', 'reason']) text(error[key], `errors[].${key}`);
    add(`error:${i + 1}`, 'incomplete'); uncertain('Some native checks could not run.');
  });
  report.observations.forEach(observation => required(observation, ['kind', 'name', 'ref', 'attributes'], 'observations[]'));
  const ruleIds = new Set();
  rules.forEach((rule, i) => {
    required(rule, ['id', 'digest', 'version', 'maturity', 'declared_requests', 'origin', 'trial_summary', 'suite'], 'run.rules[]');
    text(rule.id, 'run.rules[].id'); text(rule.digest, 'run.rules[].digest');
    if (ruleIds.has(rule.id)) invalid('duplicate run.rules[].id');
    ruleIds.add(rule.id);
    if (rule.trial_summary !== null) {
      const trials = required(rule.trial_summary, ['trials_per_case', 'cases', 'cases_failed', 'cases_incomplete', 'bound', 'mean_success_rate', 'correction'], 'run.rules[].trial_summary');
      for (const key of ['trials_per_case', 'cases', 'cases_failed', 'cases_incomplete']) integer(trials[key], `trial_summary.${key}`);
      if (!trials.trials_per_case || trials.cases_failed + trials.cases_incomplete > trials.cases) invalid('trial_summary counts');
      if (trials.cases_failed) add(`trial-summary:${i + 1}`, 'fail');
      if (trials.cases_incomplete || !trials.cases) { add(`trial-summary-incomplete:${i + 1}`, 'incomplete'); uncertain('Repeated native trials include unmeasured cases.'); }
    }
    if (rule.suite !== null) {
      const suite = required(rule.suite, ['dataset', 'dataset_digest', 'sample_size', 'sample_seed', 'trials_per_case', 'cases', 'measured', 'ungraded', 'worst', 'best', 'low', 'high', 'min_pass_rate', 'min_sample', 'outcome', 'reason', 'correction'], 'run.rules[].suite');
      choice(suite.outcome, ['pass', 'fail', 'inconclusive'], 'suite.outcome');
      for (const key of ['cases', 'measured', 'ungraded', 'min_sample', 'trials_per_case']) integer(suite[key], `suite.${key}`);
      if (suite.measured + suite.ungraded !== suite.cases || !suite.trials_per_case || !suite.min_sample) invalid('suite counts');
      const incomplete = suite.outcome === 'inconclusive' || suite.ungraded > 0 || suite.measured < suite.min_sample || !suite.cases;
      add(`suite:${i + 1}`, suite.outcome === 'fail' ? 'fail' : incomplete ? 'incomplete' : 'pass');
      if (incomplete) uncertain('A native suite has declined, insufficient, or ungraded cases.');
    }
  });
  if (ran.some(id => !ruleIds.has(id))) invalid('rules_run references missing rule metadata');
  const seenSkipped = new Set();
  skipped.forEach((skip, i) => {
    required(skip, ['rule_id', 'reason', 'missing', 'detail'], 'rules_skipped[]');
    text(skip.rule_id, 'rules_skipped[].rule_id'); text(skip.detail, 'rules_skipped[].detail');
    choice(skip.reason, SKIP_REASONS, 'rules_skipped[].reason');
    array(skip.missing, 'rules_skipped[].missing').forEach(v => text(v, 'rules_skipped[].missing[]'));
    if (ran.includes(skip.rule_id) || seenSkipped.has(skip.rule_id)) invalid('duplicate or contradictory skipped rule');
    seenSkipped.add(skip.rule_id);
    add(`skipped:${i + 1}`, 'not-run', { reason: skip.reason });
    if (skip.reason !== 'not_applicable') uncertain('Some requested native rules did not execute.');
  });
  // Native manifest.rules records completed rules and suites stopped/raised;
  // an entry outside rules_run is not evidence that its execution completed.
  rules.forEach((rule, i) => {
    if (!ran.includes(rule.id)) {
      add(`rule-not-completed:${i + 1}`, 'incomplete');
      uncertain('Native rule metadata includes a rule without recorded completion.');
    }
  });
  shortfalls.forEach((shortfall, i) => {
    required(shortfall, ['kind', 'name', 'detail'], 'coverage.shortfall[]');
    choice(shortfall.kind, SHORTFALL_KINDS, 'coverage.shortfall[].kind');
    text(shortfall.name, 'coverage.shortfall[].name'); text(shortfall.detail, 'coverage.shortfall[].detail');
    add(`shortfall:${i + 1}`, 'incomplete', { reason: shortfall.kind }); uncertain('The native report records missing coverage evidence.');
  });
  report.assessments.forEach((assessment, i) => {
    required(assessment, ['case_id', 'assessor', 'subject_ref', 'status', 'reason'], 'assessments[]');
    for (const key of ['case_id', 'assessor', 'subject_ref']) text(assessment[key], `assessments[].${key}`);
    choice(assessment.status, ASSESSMENT_STATUSES, 'assessments[].status');
    choice(assessment.reason, ASSESSMENT_REASONS, 'assessments[].reason', true);
    let completedRule = false;
    if (Object.hasOwn(assessment, 'rule_id')) {
      text(assessment.rule_id, 'assessments[].rule_id');
      if (assessment.rule_id && !ruleIds.has(assessment.rule_id)) invalid('assessment references missing rule metadata');
      completedRule = ran.includes(assessment.rule_id);
    }
    if (!completedRule) uncertain('A native assessment is not linked to a recorded completed rule.');
    if (Object.hasOwn(assessment, 'passed') && assessment.passed !== null && typeof assessment.passed !== 'boolean') invalid('assessments[].passed');
    if (assessment.status === 'measured' && assessment.reason !== null) invalid('measured assessment carries unmeasured reason');
    const status = assessment.status === 'skipped' ? 'not-run' : assessment.status !== 'measured' || typeof assessment.passed !== 'boolean' ? 'incomplete' : !assessment.passed ? 'fail' : !completedRule ? 'incomplete' : 'pass';
    add(`assessment:${i + 1}`, status, { nativeStatus: assessment.status, reason: assessment.reason });
    if (status === 'incomplete' || status === 'not-run') uncertain('Some native assessments were not conclusively graded.');
  });
  if (summary.stopped_by !== null) { add('run:stopped', 'incomplete', { reason: summary.stopped_by }); uncertain('The native run stopped before completing its plan.'); }
  if (summary.gate === 'fail') add('run:gate', 'fail', { nativeGate: 'fail' });
  if (summary.gate === null || summary.gate === 'indeterminate') { add('run:gate', 'incomplete', { nativeGate: summary.gate }); uncertain('The native run did not report a determinate gate.'); }
  if (!ran.length || !summary.measured) uncertain('No complete measured native assessment is recorded.');
  if (!run.completed_at || !run.started_at || !run.created_at) uncertain('The native run does not record complete execution timestamps.');
  if (run.migrated_from !== null) uncertain('The native report was migrated from an older schema.');
  if (coverage.digest === null) uncertain('The native report does not record a coverage fingerprint.');
  if (target.document?.kind === 'content_prefix') uncertain('Only a prefix of the native target document was read.');
  if (report.scope !== null && !report.scope.files.length) uncertain('The native file scope contains no files.');
  if (run.recording !== null) {
    required(run.recording, ['name', 'version', 'subject', 'verbatim', 'origin'], 'run.recording');
    if (typeof run.recording.verbatim !== 'boolean') invalid('run.recording.verbatim');
    if (!run.recording.verbatim) uncertain('The native recording reports altered replies.');
    if (run.recording.origin !== null) {
      required(run.recording.origin, ['run_id', 'target', 'started_at', 'stopped_by', 'gate'], 'run.recording.origin');
      choice(run.recording.origin.stopped_by, STOP_REASONS, 'run.recording.origin.stopped_by', true);
      if (run.recording.origin.stopped_by !== null) uncertain('The source recording came from an incomplete native run.');
    }
  }
  const counts = { total: checks.length, pass: 0, fail: 0, incomplete: 0, notRun: 0, advisory: 0, nativeFindings: report.findings.length, nativeUnverified: report.unverified.length, nativeWaived: report.waived.length, nativeErrors: report.errors.length, nativeAssessments: report.assessments.length };
  for (const check of checks) counts[check.status === 'not-run' ? 'notRun' : check.status]++;
  const outcome = counts.fail ? 'findings' : uncertainties.length || counts.incomplete ? 'incomplete' : 'reported-clean';
  const upstream = { schemaVersion: 17, nativeGate: summary.gate, sourceKind: source.kind, migratedFrom: run.migrated_from, coverageDigest: coverage.digest };
  if (/^[0-9][0-9A-Za-z.+_-]{0,63}$/.test(guardana.version)) upstream.version = guardana.version;
  if (guardana.commit !== null) upstream.commit = guardana.commit;
  return { schemaVersion: 1, plugin: 'guardana', upstream, outcome, checks, counts, uncertainties, nextAction: outcome === 'findings' ? 'Review the native findings and independently reproduce relevant failures before proposing a repair.' : outcome === 'incomplete' ? 'Resolve missing evidence and rerun the relevant Guardana checks; retain native test validation.' : 'Review the native report scope and current applicability; run TestLore native validation before accepting a change.' };
}
