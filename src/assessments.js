import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { safePath, readConfig } from './files.js';
import { normalizeGuardanaReport } from './adapters/guardana-report.js';
import { normalizeIfixaiReport } from './adapters/ifixai-report.js';

export const ASSESSMENT_PLUGINS = Object.freeze(['guardana', 'ifixai']);
const MAX_BYTES = 4 * 1024 * 1024;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const normalizers = { guardana: normalizeGuardanaReport, ifixai: normalizeIfixaiReport };
const authority = Object.freeze({ routingOmissions: false, candidateAcceptance: false, repairAcceptance: false, learningPromotion: false });
const limitations = [
  'Historical producer self-report; current source, model, policy, dataset and instrumentation bindings are unverified.',
  'A report hash identifies imported bytes; it does not prove completeness, authenticity or truth.',
  'Import performs no external commands, provider calls, telemetry, installations or native verification.',
  'Reported-clean describes only the producer-reported scope. Use native shadow verification and independent assessment before promotion.'
];

// Check JSON keys BEFORE JSON.parse can silently replace an earlier required field.
// Parsing is bounded independently of the upstream normalizers, including ignored evidence.
export function parseAssessmentJSON(text) {
  if (typeof text !== 'string' || Buffer.byteLength(text) > MAX_BYTES) throw new Error('Assessment exceeds the 4 MiB input limit');
  let cursor = 0, nodes = 0;
  const space = () => { while (/\s/.test(text[cursor] || '') && cursor < text.length) cursor++; };
  function string() {
    const start = cursor++;
    while (cursor < text.length) {
      const character = text[cursor++];
      if (character === '\\') cursor++;
      else if (character === '"') return JSON.parse(text.slice(start, cursor));
    }
    throw new Error('Invalid assessment JSON string');
  }
  function value(depth) {
    if (++nodes > 100000 || depth > 24) throw new Error('Assessment JSON exceeds structural limits');
    space();
    const character = text[cursor];
    if (character === '{') {
      cursor++; space(); const keys = new Set();
      if (text[cursor] === '}') { cursor++; return; }
      while (cursor < text.length) {
        space(); if (text[cursor] !== '"') throw new Error('Invalid assessment JSON key');
        const key = string();
        if (keys.has(key) || ['__proto__', 'constructor', 'prototype'].includes(key)) throw new Error('Duplicate or unsafe assessment JSON key');
        keys.add(key); if (keys.size > 4096) throw new Error('Assessment object exceeds key limit');
        space(); if (text[cursor++] !== ':') throw new Error('Invalid assessment JSON object');
        value(depth + 1); space();
        if (text[cursor] === '}') { cursor++; return; }
        if (text[cursor++] !== ',') throw new Error('Invalid assessment JSON object');
      }
    } else if (character === '[') {
      cursor++; space(); let count = 0;
      if (text[cursor] === ']') { cursor++; return; }
      while (cursor < text.length) {
        if (++count > 4096) throw new Error('Assessment array exceeds item limit');
        value(depth + 1); space();
        if (text[cursor] === ']') { cursor++; return; }
        if (text[cursor++] !== ',') throw new Error('Invalid assessment JSON array');
      }
    } else if (character === '"') { string(); return; }
    else {
      const match = /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(text.slice(cursor));
      if (!match) throw new Error('Invalid assessment JSON value');
      cursor += match[0].length; return;
    }
    throw new Error('Incomplete assessment JSON');
  }
  value(0); space(); if (cursor !== text.length) throw new Error('Unexpected assessment JSON suffix');
  const result = JSON.parse(text);
  if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('Assessment report must be an object');
  return result;
}

function readReport(root, file) {
  if (typeof file !== 'string' || file.length > 512) throw new Error('Assessment report requires a bounded project-relative path');
  const target = safePath(root, file);
  const before = fs.lstatSync(target);
  if (!before.isFile() || before.size > MAX_BYTES) throw new Error('Assessment must be a regular file of at most 4 MiB');
  const fd = fs.openSync(target, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  try {
    const opened = fs.fstatSync(fd);
    if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino || opened.size > MAX_BYTES) throw new Error('Assessment changed while opening');
    const bytes = Buffer.alloc(Math.min(opened.size + 1, MAX_BYTES + 1));
    let length = 0;
    while (length < bytes.length) { const read = fs.readSync(fd, bytes, length, bytes.length - length, null); if (!read) break; length += read; }
    const after = fs.fstatSync(fd);
    const located = fs.lstatSync(safePath(root, file));
    if (length !== opened.size || after.size !== opened.size || after.mtimeMs !== opened.mtimeMs || after.ctimeMs !== opened.ctimeMs || located.dev !== opened.dev || located.ino !== opened.ino || !located.isFile()) throw new Error('Assessment changed during import; retry');
    const snapshot = bytes.subarray(0, length);
    const text = new TextDecoder('utf-8', { fatal: true }).decode(snapshot);
    return { report: parseAssessmentJSON(text), sha256: hash(snapshot), bytes: length };
  } finally { fs.closeSync(fd); }
}

/** Read-only, runner-free inspection. No raw prompts, findings prose or traces are persisted. */
export function inspectAssessmentReport(projectRoot, { plugin, report } = {}) {
  if (!ASSESSMENT_PLUGINS.includes(plugin)) throw new Error('Assessment plugin must be guardana or ifixai');
  const root = fs.realpathSync(path.resolve(projectRoot));
  const input = readReport(root, report);
  const normalized = normalizers[plugin](input.report);
  if (!Array.isArray(normalized.checks) || normalized.checks.length > 2048 || Buffer.byteLength(JSON.stringify(normalized)) > 512 * 1024) throw new Error('Normalized assessment exceeds output limits');
  return { ...normalized, importComplete: true, assessmentComplete: normalized.outcome === 'reported-clean',
    source: { path: report, sha256: input.sha256, bytes: input.bytes }, currentBinding: 'unverified',
    evidenceKind: 'historical-producer-assessment', advisory: true, authority: { ...authority },
    limitations: [...limitations], nextAction: normalized.nextAction || 'Review imported checks and run native shadow verification before promotion.' };
}

/** Explicit one-off import, or all enabled configured report adapters; never executes providers. */
export function importAssessments(projectRoot, { plugin, report, output } = {}) {
  const root = fs.realpathSync(path.resolve(projectRoot));
  if (report !== undefined && plugin === undefined) throw new Error('--report requires --plugin');
  if (plugin !== undefined && !ASSESSMENT_PLUGINS.includes(plugin)) throw new Error('Assessment plugin must be guardana or ifixai');
  const config = readConfig(root);
  const selections = plugin ? [{ plugin, report: report ?? (config.plugins?.[plugin]?.enabled === true ? config.plugins[plugin].report : undefined) }]
    : ASSESSMENT_PLUGINS.filter(id => config.plugins?.[id]?.enabled === true).map(id => ({ plugin: id, report: config.plugins[id].report }));
  const assessments = selections.map(selection => {
    if (!selection.report) return { plugin: selection.plugin, outcome: 'incomplete', importComplete: false, assessmentComplete: false, currentBinding: 'unverified', advisory: true, authority: { ...authority }, error: 'missing-report', nextAction: 'Configure an enabled adapter report path, or supply --plugin and --report for an explicit one-off import.' };
    try { return inspectAssessmentReport(root, selection); }
    catch { return { plugin: selection.plugin, outcome: 'incomplete', importComplete: false, assessmentComplete: false, currentBinding: 'unverified', advisory: true, authority: { ...authority }, error: 'invalid-or-unreadable-report', nextAction: 'Check the local report path, size and supported native format. Unsupported, unsafe or changed reports are refused; regenerate using the documented upstream version.' }; }
  });
  const exitCode = !assessments.length || assessments.some(item => !item.importComplete || item.outcome === 'incomplete') ? 2 : assessments.some(item => item.outcome === 'findings') ? 1 : 0;
  const receipt = { schemaVersion: 1, kind: 'assessment-import', id: randomUUID(), importedAt: new Date().toISOString(), assessments,
    exitCode, nativeVerificationExecuted: false, providerCalls: 0, limitations: [...limitations],
    nextAction: assessments.length ? 'Review each assessment and its uncertainty. Use testlore run --shadow for independent native verification.' : 'No assessment adapters are enabled. Supply --plugin guardana|ifixai --report local-report.json, or configure report paths explicitly.' };
  const destination = output ?? `.tddswarm/assessments/${receipt.id}.json`;
  const target = safePath(root, destination);
  const relative = path.relative(root, target).split(path.sep);
  if (relative[0] === '.tddswarm' && relative[1] !== 'assessments') throw new Error('Assessment receipts must stay in .tddswarm/assessments or outside the internal evidence store');
  if (selections.some(item => item.report && path.resolve(root, item.report) === target)) throw new Error('Assessment receipt must not replace an input report');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  safePath(root, destination);
  const fd = fs.openSync(target, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
  try { fs.writeFileSync(fd, JSON.stringify(receipt, null, 2) + '\n'); fs.fsyncSync(fd); }
  finally { fs.closeSync(fd); }
  return { ...receipt, receipt: destination };
}
