import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { safePath } from './files.js';
import { readInvestigationReport } from './bug-investigation.js';

const DIRECTORY = '.tddswarm/investigations/outcomes';
const SHA = /^[a-f0-9]{64}$/;
const ID = /^[a-zA-Z0-9][a-zA-Z0-9._:\-]{0,127}$/;
const VERDICTS = ['useful', 'false-positive', 'intentional-behavior', 'duplicate', 'inconclusive'];
const LIMIT = 1000, MAX_BYTES = 8 * 1024 * 1024;
const hash = value => createHash('sha256').update(Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest('hex');
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const exact = (value, keys) => plain(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const fail = reason => { throw new Error(reason); };
const boundedString = (value, size) => typeof value === 'string' && value.length > 0 && Buffer.byteLength(value) <= size && !value.includes('\0');
const relative = value => boundedString(value, 512) && !path.isAbsolute(value) && !value.includes('\\') && value.split('/').every(part => part && part !== '.' && part !== '..');

function read(root, file, maximum = MAX_BYTES) {
  const target = safePath(root, file);
  const fd = fs.openSync(target, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  try {
    const before = fs.fstatSync(fd);
    if (!before.isFile() || before.size > maximum) fail('investigation-outcome-over-budget');
    const chunks = []; let length = 0;
    const buffer = Buffer.alloc(Math.min(maximum + 1, 65536));
    for (;;) {
      const count = fs.readSync(fd, buffer, 0, Math.min(buffer.length, maximum + 1 - length), null);
      if (!count) break;
      length += count;
      if (length > maximum) fail('investigation-outcome-over-budget');
      chunks.push(Buffer.from(buffer.subarray(0, count)));
    }
    const after = fs.fstatSync(fd), named = fs.lstatSync(safePath(root, file));
    if (length !== before.size || before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs || named.isSymbolicLink() || named.ino !== after.ino || named.dev !== after.dev) fail('investigation-outcome-changed-during-read');
    return Buffer.concat(chunks, length);
  } finally { fs.closeSync(fd); }
}

function validateReceipt(receipt) {
  const keys = ['schemaVersion','kind','id','recordedAt','report','reportSha256','reportId','sourceStatusAtReview','observation','disposition','advisoryOnly','authority','integrity'];
  if (!exact(receipt, keys)) fail('invalid-investigation-outcome');
  const { integrity, ...payload } = receipt;
  if (!SHA.test(integrity) || hash(payload) !== integrity || receipt.schemaVersion !== 1 || receipt.kind !== 'investigation-outcome' || !['current','stale'].includes(receipt.sourceStatusAtReview) || receipt.advisoryOnly !== true || receipt.authority !== 'none' || !relative(receipt.report) || !SHA.test(receipt.reportSha256) || !ID.test(receipt.reportId) || !Number.isFinite(Date.parse(receipt.recordedAt)) || new Date(receipt.recordedAt).toISOString() !== receipt.recordedAt) fail('invalid-investigation-outcome');
  const observation = receipt.observation, disposition = receipt.disposition;
  if (!exact(observation, ['findingId','recipeId','recipeSha256','module','sourceSha256','outcome','timeout','durationMs']) || !ID.test(observation.findingId) || !ID.test(observation.recipeId) || !SHA.test(observation.recipeSha256) || !relative(observation.module) || !SHA.test(observation.sourceSha256) || !['reproduced','passed','inconclusive','not-applicable','budget-exhausted'].includes(observation.outcome) || typeof observation.timeout !== 'boolean' || !Number.isFinite(observation.durationMs) || observation.durationMs < 0 || observation.durationMs > 3600000 || receipt.id !== hash({ findingId: observation.findingId })) fail('invalid-investigation-outcome');
  if (!exact(disposition, ['verdict','reviewer','note','cost']) || !VERDICTS.includes(disposition.verdict) || !boundedString(disposition.reviewer, 128) || (disposition.note !== null && !boundedString(disposition.note, 512)) || (disposition.cost !== null && (!exact(disposition.cost, ['usd','provenance']) || !Number.isFinite(disposition.cost.usd) || disposition.cost.usd < 0 || disposition.cost.usd > 1000000 || disposition.cost.provenance !== 'reviewer-supplied-unverified'))) fail('invalid-investigation-outcome');
  if (disposition.verdict === 'useful' && observation.outcome !== 'reproduced') fail('invalid-investigation-outcome');
  return receipt;
}

function load(root) {
  const directory = safePath(root, DIRECTORY);
  if (!fs.existsSync(directory)) return [];
  if (!fs.statSync(directory).isDirectory()) fail('invalid-investigation-outcome-store');
  const names = fs.readdirSync(directory).sort();
  if (names.length > LIMIT || names.some(name => !/^[a-f0-9]{64}\.json$/.test(name))) fail('invalid-investigation-outcome-store');
  let length = 0; const receipts = [], ids = new Set();
  for (const name of names) {
    const raw = read(root, `${DIRECTORY}/${name}`, 32768); length += raw.length;
    if (length > MAX_BYTES) fail('investigation-outcome-over-budget');
    const receipt = validateReceipt(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw)));
    if (`${receipt.id}.json` !== name || ids.has(receipt.id)) fail('duplicate-investigation-outcome');
    ids.add(receipt.id); receipts.push(receipt);
  }
  return receipts;
}

function inspectReceipt(root, receipt) {
  try {
    const evidence = readInvestigationReport(root, receipt.report, { expectedSha256: receipt.reportSha256 });
    assertAssociations(evidence.report);
    const finding = evidence.report.findings.find(item => item.id === receipt.observation.findingId);
    if (evidence.report.id !== receipt.reportId || !finding || hash(observation(finding)) !== hash(receipt.observation)) return { usable: false, reason: 'report-observation-mismatch' };
    return { usable: true, stale: evidence.stale, reason: evidence.stale ? 'historical-observation-current-source-stale' : 'current-hash-bound-observation' };
  } catch { return { usable: false, reason: 'report-unavailable-or-invalid' }; }
}

function assertAssociations(report) {
  const inventory = new Set(report.sourceBinding.files.map(item => item.path));
  for (const finding of report.findings) {
    if (!Array.isArray(finding.files) || finding.files.length > 128 || new Set(finding.files).size !== finding.files.length || !finding.files.includes(finding.module) || !Array.isArray(finding.tests) || finding.tests.length > 128 || new Set(finding.tests).size !== finding.tests.length || [...finding.files, ...finding.tests].some(file => !relative(file) || !inventory.has(file))) fail('invalid-investigation-association');
  }
}

function observation(finding) {
  return { findingId: finding.id, recipeId: finding.recipeId, recipeSha256: finding.recipeSha256, module: finding.module, sourceSha256: finding.sourceSha256, outcome: finding.outcome, timeout: finding.reason === 'probe-timeout', durationMs: finding.durationMs };
}

export function recordInvestigationOutcome(root, input) {
  try {
    if (!plain(input) || Object.keys(input).some(key => !['report','reportSha256','findingId','verdict','reviewer','note','cost'].includes(key)) || !relative(input.report) || !SHA.test(input.reportSha256) || !ID.test(input.findingId) || !VERDICTS.includes(input.verdict) || !boundedString(input.reviewer, 128) || (input.note !== undefined && !boundedString(input.note, 512)) || (input.cost !== undefined && (!exact(input.cost, ['usd']) || !Number.isFinite(input.cost.usd) || input.cost.usd < 0 || input.cost.usd > 1000000))) fail('invalid-investigation-outcome-request');
    const evidence = readInvestigationReport(root, input.report, { expectedSha256: input.reportSha256 });
    assertAssociations(evidence.report);
    const finding = evidence.report.findings.find(item => item.id === input.findingId);
    if (!finding) fail('unknown-investigation-finding');
    if (input.verdict === 'useful' && finding.outcome !== 'reproduced') fail('useful-verdict-requires-reproduced-observation');
    const existing = load(root), id = hash({ findingId: finding.id });
    if (existing.some(item => item.id === id)) fail('investigation-outcome-already-recorded');
    if (existing.length >= LIMIT) fail('investigation-outcome-over-budget');
    const payload = { schemaVersion: 1, kind: 'investigation-outcome', id, recordedAt: new Date().toISOString(), report: input.report, reportSha256: input.reportSha256, reportId: evidence.report.id, sourceStatusAtReview: evidence.stale ? 'stale' : 'current', observation: observation(finding), disposition: { verdict: input.verdict, reviewer: input.reviewer, note: input.note ?? null, cost: input.cost ? { usd: input.cost.usd, provenance: 'reviewer-supplied-unverified' } : null }, advisoryOnly: true, authority: 'none' };
    const receipt = validateReceipt({ ...payload, integrity: hash(payload) }), raw = Buffer.from(JSON.stringify(receipt) + '\n');
    const directory = safePath(root, DIRECTORY); fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    const file = `${DIRECTORY}/${id}.json`, destination = safePath(root, file);
    const fd = fs.openSync(destination, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
    try { fs.writeFileSync(fd, raw); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    return { recorded: true, id, file, sha256: hash(raw), advisoryOnly: true, authority: 'none' };
  } catch (error) {
    const safeReasons = ['invalid-investigation-outcome-request','useful-verdict-requires-reproduced-observation','unknown-investigation-finding','investigation-outcome-already-recorded','investigation-outcome-over-budget','invalid-investigation-outcome','invalid-investigation-outcome-store','duplicate-investigation-outcome'];
    return { recorded: false, reason: error.code === 'EEXIST' ? 'investigation-outcome-already-recorded' : safeReasons.includes(error.message) ? error.message : 'investigation-outcome-unavailable', advisoryOnly: true, authority: 'none' };
  }
}

export function inspectInvestigationLearning(root) {
  try {
    const receipts = load(root), counts = Object.fromEntries(VERDICTS.map(verdict => [verdict, 0])), reasons = {}, recipes = new Map();
    let usable = 0, historicalStaleObservations = 0;
    for (const receipt of receipts) {
      counts[receipt.disposition.verdict]++;
      const status = inspectReceipt(root, receipt); reasons[status.reason] = (reasons[status.reason] || 0) + 1;
      if (!status.usable) continue;
      usable++;
      if (status.stale) historicalStaleObservations++;
      const key = `${receipt.observation.recipeId}:${receipt.observation.recipeSha256}`;
      const aggregate = recipes.get(key) || { recipeId: receipt.observation.recipeId, recipeSha256: receipt.observation.recipeSha256, observations: 0, verdicts: Object.fromEntries(VERDICTS.map(verdict => [verdict, 0])), totalDurationMs: 0, timeouts: 0, declaredCostUsd: 0, declaredCostObservations: 0 };
      aggregate.observations++; aggregate.verdicts[receipt.disposition.verdict]++; aggregate.totalDurationMs += receipt.observation.durationMs;
      if (receipt.observation.timeout) aggregate.timeouts++;
      if (receipt.disposition.cost) { aggregate.declaredCostUsd += receipt.disposition.cost.usd; aggregate.declaredCostObservations++; }
      recipes.set(key, aggregate);
    }
    return { schemaVersion: 1, kind: 'investigation-learning-summary', observations: receipts.length, usableObservations: usable, historicalStaleObservations, unusableObservations: receipts.length - usable, counts, reasons, recipes: [...recipes.values()].sort((a,b) => a.recipeId.localeCompare(b.recipeId) || a.recipeSha256.localeCompare(b.recipeSha256)), advisoryOnly: true, authority: 'none', causalImprovement: 'unproven', currentCorrectness: 'not-established', costProvenance: 'reviewer-supplied-unverified', nextAction: usable ? 'Use historical advisory priorities within a fixed investigation budget; independently verify each current finding.' : 'Run a bounded investigation and record reviewed outcomes before expecting useful prioritization.' };
  } catch { return { observations: 0, usableObservations: 0, recipes: [], reason: 'invalid-investigation-outcome-store', advisoryOnly: true, authority: 'none', causalImprovement: 'unproven', nextAction: 'Repair or restore the local receipt store; do not prioritize from corrupt evidence.' }; }
}

export function prioritizeBugRecipes(root, recipes, options = {}) {
  try {
    if (!Array.isArray(recipes) || recipes.length > 100 || !plain(options) || Object.keys(options).some(key => !['remainingMs','maxInvestigations'].includes(key)) || !Number.isSafeInteger(options.remainingMs) || options.remainingMs < 0 || options.remainingMs > 3600000 || !Number.isSafeInteger(options.maxInvestigations ?? 3) || (options.maxInvestigations ?? 3) < 0 || (options.maxInvestigations ?? 3) > 128) fail('invalid-investigation-priority-request');
    const learning = inspectInvestigationLearning(root);
    if (learning.reason) fail('invalid-investigation-outcome-store');
    const seen = new Set(), candidates = recipes.map(recipe => {
      if (!exact(recipe, ['id','sha256','family']) || !ID.test(recipe.id) || !SHA.test(recipe.sha256) || !ID.test(recipe.family) || seen.has(recipe.id)) fail('invalid-investigation-priority-request');
      seen.add(recipe.id);
      const evidence = learning.recipes.find(item => item.recipeId === recipe.id && item.recipeSha256 === recipe.sha256);
      const observations = evidence?.observations || 0, useful = evidence?.verdicts.useful || 0, penalties = (evidence?.verdicts['false-positive'] || 0) + (evidence?.verdicts['intentional-behavior'] || 0) + (evidence?.verdicts.duplicate || 0);
      const estimateMs = Math.max(1, observations ? Math.ceil(evidence.totalDurationMs / observations) : 1000);
      const yieldEstimate = (useful + 1) / (observations + 2), uncertaintyBonus = 0.25 / Math.sqrt(observations + 1);
      const meanDeclaredCostUsd = evidence?.declaredCostObservations ? evidence.declaredCostUsd / evidence.declaredCostObservations : null;
      const costPenalty = 1 + (meanDeclaredCostUsd ?? 0);
      const score = (yieldEstimate + uncertaintyBonus) / (estimateMs * costPenalty);
      return { recipeId: recipe.id, recipeSha256: recipe.sha256, family: recipe.family, observations, useful, penalties, timeouts: evidence?.timeouts || 0, estimateMs, estimateProvenance: observations ? 'mean-of-current-reviewed-observations' : 'cold-start-1000ms-placeholder', yieldEstimate, uncertaintyBonus, costPenalty, costProvenance: meanDeclaredCostUsd === null ? 'unknown' : 'reviewer-supplied-unverified', score, evidence: observations ? 'advisory-observed-dispositions' : 'cold-start-exploration', meanDeclaredCostUsd };
    }).sort((a,b) => b.score - a.score || a.recipeId.localeCompare(b.recipeId));
    let remainingMs = options.remainingMs; const selected = [], deferred = [];
    for (const item of candidates) {
      if (selected.length < (options.maxInvestigations ?? 3) && item.estimateMs <= remainingMs) { selected.push(item); remainingMs -= item.estimateMs; }
      else deferred.push({ recipeId: item.recipeId, reason: selected.length >= (options.maxInvestigations ?? 3) ? 'investigation-count-budget' : 'estimated-time-budget' });
    }
    return { selected, deferred, remainingMs, advisoryOnly: true, authority: 'none', executionBudgetEnforced: false, estimateWarning: 'Estimates can understate runtime; the executor must enforce its own deadline.', causalImprovement: 'unproven' };
  } catch (error) { return { selected: [], deferred: [], reason: error.message === 'invalid-investigation-outcome-store' ? error.message : 'invalid-investigation-priority-request', advisoryOnly: true, authority: 'none' }; }
}

export function investigationDependencyLinks(root, reportFile, options = {}) {
  try {
    if (!relative(reportFile) || !exact(options, ['expectedSha256']) || !SHA.test(options.expectedSha256)) fail('invalid-investigation-link-request');
    const evidence = readInvestigationReport(root, reportFile, options);
    assertAssociations(evidence.report);
    const proposals = evidence.report.findings.map(finding => ({ findingId: finding.id, recipeId: finding.recipeId, recipeSha256: finding.recipeSha256, source: finding.module, sourceSha256: finding.sourceSha256, associatedTests: [...(finding.tests || [])], status: evidence.stale ? 'stale-source-binding' : 'unvalidated-proposal', evidence: 'declared-contract-association', routingAuthority: 'none', requiredValidation: 'Independent full/subset native runs and dependency-contract review before permitting omissions.' }));
    return { proposals, reportSha256: evidence.sha256, stale: evidence.stale, advisoryOnly: true, authority: 'none', omissionsPermitted: false };
  } catch { return { proposals: [], reason: 'invalid-or-unavailable-investigation-report', advisoryOnly: true, authority: 'none', omissionsPermitted: false }; }
}
