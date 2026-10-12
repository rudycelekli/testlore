import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { safePath } from './files.js';

const STORE = '.tddswarm/learning/contributions/index.json';
const STORE_HASH = Symbol('contribution-store-byte-hash');
const MAX_BYTES = 8 * 1024 * 1024, MAX_RECORDS = 5000;
const SHA = /^[a-f0-9]{64}$/, OID = /^[a-f0-9]{40}$/;
const LOGIN = /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,38})$/;
const MERGER_LOGIN = /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,38})(?:\[bot\])?$/;
const REPO = /^[a-zA-Z0-9][a-zA-Z0-9-]{0,38}\/[a-zA-Z0-9_.-]{1,100}$/;
const STATES = ['MERGED', 'OPEN', 'CLOSED'];
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const hash = value => createHash('sha256').update(Buffer.isBuffer(value) || typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
const seal = payload => ({ ...payload, integrity: hash(payload) });
const bytes = value => Buffer.byteLength(JSON.stringify(value));
const fail = reason => { throw new Error(reason); };
const integer = (value, max = 100000000) => Number.isSafeInteger(value) && value >= 0 && value <= max;
const iso = value => typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().replace('.000Z', 'Z') === value.replace('.000Z', 'Z');

// Only controlled labels and hypotheses survive import. Free-form PR text is
// classified as untrusted data; neither patches nor instructions are retained.
const TAXONOMY = [
  { id: 'filesystem-boundary', words: ['symlink', 'traversal', 'filesystem', 'realpath', 'basename', 'directory'], summary: 'Investigate filesystem boundaries and independently challenge path handling.', check: 'Add an independent traversal or symlink regression and preserve existing assertions.' },
  { id: 'unicode-boundary', words: ['unicode', 'utf8', 'utf16', 'surrogate', 'normalization', 'grapheme', 'encoding'], summary: 'Investigate Unicode and encoding boundaries.', check: 'Reproduce the reported encoding boundary with independently maintained expected output.' },
  { id: 'async-lifecycle', words: ['timeout', 'abort', 'cancellation', 'promise', 'race', 'shutdown', 'cleanup'], summary: 'Investigate asynchronous completion, cancellation and cleanup.', check: 'Exercise completion, timeout and cancellation separately under a bounded execution budget.' },
  { id: 'configuration-resolution', words: ['workspace', 'monorepo', 'resolver', 'resolution', 'configuration', 'exports', 'esm', 'cjs'], summary: 'Investigate configuration and module resolution parity.', check: 'Compare the original framework configuration and independently executed affected cases.' },
  { id: 'protocol-validation', words: ['schema', 'protocol', 'serialization', 'deserialize', 'json', 'jsonl', 'payload', 'validation'], summary: 'Investigate protocol and serialization validation.', check: 'Challenge valid, malformed and unsupported inputs using an independent contract.' },
  { id: 'resource-bounds', words: ['overflow', 'memory', 'allocation', 'leak', 'buffer', 'quota', 'pagination', 'cache'], summary: 'Investigate resource limits and incomplete enumeration.', check: 'Reproduce boundary and incomplete-result behavior and measure complete execution cost.' },
  { id: 'test-evidence', words: ['assertions', 'coverage', 'mutation', 'flaky', 'reporter', 'vitest', 'playwright', 'pytest'], summary: 'Investigate test and outcome reporting fidelity.', check: 'Verify named case identities, failure preservation and stability against the original native suite.' },
  { id: 'authorization-boundary', words: ['authentication', 'authorization', 'tenant', 'credential', 'permission', 'redaction'], summary: 'Investigate authorization and isolation boundaries.', check: 'Use credential-free independent positive and negative boundary checks.' },
];
const IDS = new Set(TAXONOMY.map(item => item.id));
const WORDS = new Set(TAXONOMY.flatMap(item => item.words));
const GENERIC = new Set('the and for from with this that these those when where which should must return returns returned value values input inputs test tests testing fix fixes fixed bug bugs issue issues add adds added support improve improved improvement regression regressions guard guards ensure handle handling using used use code file files source sources src lib dist docs readme javascript typescript js ts mjs cjs tsx jsx true false null undefined error errors failure failures failed function functions const import export implementation only more into all any not no is are can has have its our your their them new existing default invalid valid expected actual independent contract requirements requirement assert assertions equal equals do does make needed properly allow allows prevent prevents correctly incorrect correct result results data output outputs object objects string strings number numbers integer integers boolean api'.split(' '));
function validAnchor(word) { return typeof word === 'string' && /^[a-z][a-z0-9_]{2,47}$/.test(word) && !GENERIC.has(word) && !/^(?:npm_|gh[pousr]_|sk_|akia)/.test(word) && !/\d{12}/.test(word); }
function anchors(text) {
  const words = new Set((text.toLowerCase().match(/[a-z0-9_]+/g) || []));
  // Common technical spellings normalize into fixed labels, not arbitrary text.
  if (words.has('utf') && words.has('8')) words.add('utf8');
  if (words.has('utf') && words.has('16')) words.add('utf16');
  // Sorted standalone identifiers cannot carry copied prose instructions. They
  // remain untrusted relevance hints, never assertions about implementation.
  const controlled = [...words].filter(word => WORDS.has(word)).sort();
  const identifiers = [...words].filter(word => !WORDS.has(word) && validAnchor(word)).sort();
  return [...controlled, ...identifiers].slice(0, 96).sort();
}
// These presentation/navigation terms can look rare because most historical
// records lack detailed README text. Rarity alone does not make them a behavior
// contract. Filter only retrieval inputs: stored anchors and seals stay valid.
const RETRIEVAL_BOILERPLATE = new Set('also every one open example examples related github gitlab http https www com org net master main branch branches build builds package packages install installation badge badges documentation reference references'.split(' '));
function withoutInlineDestinations(text) {
  let visible='';
  for(let index=0;index<text.length;index++){
    visible+=text[index];
    if(text[index]!==']'||text[index+1]!=='(')continue;
    let depth=1;index+=2;
    for(;index<text.length&&depth;index++){
      if(text[index]==='\\'&&index+1<text.length){
        index++;
        if(text[index]==='\n'||text[index]==='\r')break;
        continue;
      }
      if(text[index]==='(')depth++;
      else if(text[index]===')')depth--;
      else if(text[index]==='\n'||text[index]==='\r')break;
    }
    visible+=' ';index--;
  }
  return visible;
}
function retrievalAnchors(text) {
  // Keep visible Markdown link labels, but never infer semantics from the URL
  // destination, including a technical word occurring only in its path/query.
  const visible = withoutInlineDestinations(text)
    .replace(/^[ \t]{0,3}\[[^\]\r\n]{1,1000}\]:[^\r\n]*$/gm, ' ')
    .replace(/(?:https?|ftp):\/\/[^\s<>]+/gi, ' ');
  // Frequency in a partially detailed corpus can make ordinary prose appear
  // rare. Custom API matches therefore need explicit code identifiers or
  // distinctive camelCase/snake_case spelling, not merely two uncommon words.
  const explicit = new Set([
    ...Array.from(visible.matchAll(/`([a-zA-Z][a-zA-Z0-9_]{2,47})`/g), match => match[1].toLowerCase()),
    ...Array.from(visible.matchAll(/\b(?:[a-z][a-zA-Z0-9]*[A-Z][a-zA-Z0-9]*|[a-z][a-z0-9]*_[a-z0-9_]+)\b/g), match => match[0].toLowerCase())
  ]);
  return anchors(visible).filter(word => !RETRIEVAL_BOILERPLATE.has(word) && (WORDS.has(word) || explicit.has(word)));
}
function patterns(records) {
  return TAXONOMY.flatMap(item => {
    const support = records.filter(record => record.patternIds.includes(item.id));
    if (!support.length) return [];
    return [{ id: item.id, hypothesis: true, summary: item.summary, nextCheck: item.check, records: support.length,
      distinctRepositories: new Set(support.map(record => record.repository.toLowerCase())).size,
      distinctSourceHeads: new Set(support.map(record => `${record.repository.toLowerCase()}@${record.headSha}`)).size,
      outcomes: Object.fromEntries(STATES.map(state => [state.toLowerCase(), support.filter(record => record.state === state).length])),
      defectDetection: 'unknown', causalImprovement: 'unknown' }];
  });
}
function validPath(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 512 && !/[\x00-\x1f\x7f\\]/.test(value) && !value.startsWith('/') && value.split('/').every(part => part && part !== '.' && part !== '..');
}
function publicRecord(node, author, capturedAt) {
  if (!plain(node) || !plain(node.repository) || node.repository.isPrivate !== false) return { excluded: 'nonPublicOrUnknown' };
  const repo = node.repository;
  if (!REPO.test(repo.nameWithOwner || '') || !LOGIN.test(repo.owner?.login || '') || repo.nameWithOwner.split('/')[0].toLowerCase() !== repo.owner.login.toLowerCase() || repo.url !== `https://github.com/${repo.nameWithOwner}` || typeof repo.isFork !== 'boolean') return { excluded: 'malformed' };
  if (!LOGIN.test(node.author?.login || '') || node.author.login.toLowerCase() !== author.toLowerCase()) return { excluded: 'authorMismatch' };
  if (repo.owner.login.toLowerCase() === author.toLowerCase()) return { excluded: 'ownRepository' };
  if (repo.isFork) return { excluded: 'forkTarget' };
  if (!integer(node.number, 100000000) || node.number < 1 || node.url !== `https://github.com/${repo.nameWithOwner}/pull/${node.number}` || !STATES.includes(node.state) || typeof node.isDraft !== 'boolean' || !OID.test(node.baseRefOid || '') || !OID.test(node.headRefOid || '')) return { excluded: 'malformed' };
  if (!iso(node.createdAt) || !iso(node.updatedAt) || Date.parse(node.createdAt) > Date.parse(node.updatedAt) || Date.parse(node.updatedAt) > Date.parse(capturedAt)) return { excluded: 'malformed' };
  if (node.state === 'MERGED' ? !iso(node.mergedAt) || node.isDraft || Date.parse(node.mergedAt) < Date.parse(node.createdAt) || Date.parse(node.mergedAt) > Date.parse(node.updatedAt) : node.mergedAt !== null) return { excluded: 'malformed' };
  if (node.mergedBy !== null && (!plain(node.mergedBy) || !MERGER_LOGIN.test(node.mergedBy.login || '') || node.state !== 'MERGED')) return { excluded: 'malformed' };
  if (typeof node.title !== 'string' || node.title.length > 2048 || (node.body !== undefined && (typeof node.body !== 'string' || Buffer.byteLength(node.body) > 65536)) || ![node.additions, node.deletions, node.changedFiles].every(value => integer(value)) || (node.detailsComplete !== undefined && typeof node.detailsComplete !== 'boolean')) return { excluded: 'malformed' };
  let detailsComplete = false, paths = [];
  if (node.files !== undefined) {
    const files = node.files;
    if (!plain(files) || !Array.isArray(files.nodes) || files.nodes.length > 1000 || !integer(files.totalCount) || files.totalCount !== node.changedFiles || files.nodes.length > files.totalCount || typeof files.pageInfo?.hasNextPage !== 'boolean' || files.nodes.some(file => !plain(file) || !validPath(file.path) || !integer(file.additions) || !integer(file.deletions) || !['ADDED', 'MODIFIED', 'DELETED', 'RENAMED', 'COPIED', 'CHANGED', 'UNCHANGED'].includes(file.changeType))) return { excluded: 'malformed' };
    paths = files.nodes.map(file => file.path);
    if (new Set(paths).size !== paths.length || (!files.pageInfo.hasNextPage && files.nodes.length !== files.totalCount)) return { excluded: 'malformed' };
    detailsComplete = node.detailsComplete === true && files.pageInfo.hasNextPage === false && files.nodes.length === files.totalCount;
  }
  const signals = anchors([node.title, node.body || '', ...paths].join('\n'));
  const patternIds = TAXONOMY.filter(item => signals.some(word => item.words.includes(word))).map(item => item.id);
  return { record: { id: hash(`${repo.nameWithOwner.toLowerCase()}#${node.number}`), repository: repo.nameWithOwner, number: node.number, url: node.url,
    sourceRecordSha256: hash(node), baseSha: node.baseRefOid, headSha: node.headRefOid, state: node.state, draft: node.isDraft,
    createdAt: node.createdAt, updatedAt: node.updatedAt, mergedAt: node.mergedAt, merger: node.mergedBy?.login || null,
    externalMerger: node.mergedBy ? node.mergedBy.login.toLowerCase() !== author.toLowerCase() : null,
    additions: node.additions, deletions: node.deletions, changedFiles: node.changedFiles, detailsComplete, anchors: signals, patternIds,
    outcome: node.state === 'MERGED' ? 'merged-public-metadata' : node.isDraft ? 'draft-public-metadata' : `${node.state.toLowerCase()}-public-metadata`,
    verifiedDefectFix: 'unknown', ciEvidence: 'not-imported', authority: 'none' } };
}

/** A supplied GitHub snapshot establishes metadata observations, not repair proof. */
function buildCorpus(snapshot, { sourceSha256 } = {}) {
  if (!SHA.test(sourceSha256 || '') || !plain(snapshot) || bytes(snapshot) > MAX_BYTES || snapshot.schemaVersion !== 1 || snapshot.kind !== 'public-authored-pr-snapshot' || !LOGIN.test(snapshot.author || '') || !iso(snapshot.capturedAt) || !plain(snapshot.coverage) || typeof snapshot.coverage.complete !== 'boolean' || !integer(snapshot.coverage.reportedCount) || !integer(snapshot.coverage.returnedCount, MAX_RECORDS) || typeof snapshot.coverage.query !== 'string' || snapshot.coverage.query.length > 2048 || !Array.isArray(snapshot.pullRequests) || snapshot.pullRequests.length > MAX_RECORDS || snapshot.coverage.returnedCount !== snapshot.pullRequests.length || snapshot.coverage.reportedCount < snapshot.coverage.returnedCount) fail('invalid-public-pr-snapshot');
  const records = [], identities = new Map(), observed = new Map(), exclusions = { nonPublicOrUnknown: 0, ownRepository: 0, forkTarget: 0, authorMismatch: 0, malformed: 0, duplicate: 0 };
  for (const node of snapshot.pullRequests) {
    if (node?.repository?.isPrivate === false && REPO.test(node.repository.nameWithOwner || '') && integer(node.number) && node.number > 0) {
      const identity = `${node.repository.nameWithOwner.toLowerCase()}#${node.number}`, digest = hash(node);
      if (observed.has(identity) && observed.get(identity) !== digest) fail('conflicting-public-pr-identity');
      observed.set(identity, digest);
    }
    const result = publicRecord(node, snapshot.author, snapshot.capturedAt);
    if (result.excluded) { exclusions[result.excluded]++; continue; }
    const record = result.record, prior = identities.get(record.id);
    if (prior && prior !== record.sourceRecordSha256) fail('conflicting-public-pr-identity');
    if (prior) { exclusions.duplicate++; continue; }
    identities.set(record.id, record.sourceRecordSha256); records.push(record);
  }
  records.sort((a, b) => a.repository.localeCompare(b.repository) || a.number - b.number);
  const complete = snapshot.coverage.complete && snapshot.coverage.reportedCount === snapshot.coverage.returnedCount && !exclusions.malformed && !exclusions.authorMismatch && !exclusions.nonPublicOrUnknown;
  const payload = { schemaVersion: 1, kind: 'public-contribution-corpus', author: snapshot.author, capturedAt: snapshot.capturedAt, sourceSha256,
    coverage: { complete, declaredComplete: snapshot.coverage.complete, reportedCount: snapshot.coverage.reportedCount, returnedCount: snapshot.coverage.returnedCount, retainedCount: records.length, scope: 'public-authored-external-nonfork-pr-metadata', observationMode: snapshot.coverage.resumeProvenance != null ? 'mixed-window-observations' : 'single-capture-observation' },
    exclusions, records, patterns: patterns(records), advisoryOnly: true, authority: 'none', verifiedDefectFixes: 'unknown',
    provenance: 'Supplied snapshot bytes are hash-bound; GitHub authenticity and defect-fix evidence are not independently established.' };
  const corpus = seal(payload);
  if (bytes(corpus) > MAX_BYTES) fail('contribution-corpus-over-budget');
  return corpus;
}

export function buildContributionCorpus(snapshot, options = {}) {
  try { return buildCorpus(snapshot, options); }
  catch (error) {
    const allowed = ['invalid-public-pr-snapshot','conflicting-public-pr-identity','contribution-corpus-over-budget'];
    fail(allowed.includes(error.message) ? error.message : 'invalid-public-pr-snapshot');
  }
}

function target(root, name) { try { return safePath(root, name); } catch { fail('unsafe-contribution-path'); } }
function readBounded(root, name) {
  const file = target(root, name);
  const fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0) | (fs.constants.O_NONBLOCK || 0));
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.size > MAX_BYTES) fail('contribution-artifact-over-budget');
    const chunks = [], buffer = Buffer.alloc(65536); let total = 0;
    for (;;) {
      const count = fs.readSync(fd, buffer, 0, Math.min(buffer.length, MAX_BYTES + 1 - total), null);
      if (!count) break;
      total += count;
      if (total > MAX_BYTES) fail('contribution-artifact-over-budget');
      chunks.push(Buffer.from(buffer.subarray(0, count)));
    }
    const after = fs.fstatSync(fd), named = fs.lstatSync(target(root, name));
    if (total !== stat.size || after.size !== stat.size || after.mtimeMs !== stat.mtimeMs || after.ctimeMs !== stat.ctimeMs || named.isSymbolicLink() || named.dev !== stat.dev || named.ino !== stat.ino) fail('contribution-artifact-changed-during-read');
    return Buffer.concat(chunks, total);
  } finally { fs.closeSync(fd); }
}
function load(root) {
  const file = target(root, STORE);
  if (!fs.existsSync(file)) return null;
  let corpus, raw;
  try { raw = readBounded(root, STORE); corpus = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw)); } catch { fail('invalid-contribution-store'); }
  const { integrity, ...payload } = corpus || {};
  const keys = ['schemaVersion','kind','author','capturedAt','sourceSha256','coverage','exclusions','records','patterns','advisoryOnly','authority','verifiedDefectFixes','provenance','integrity'];
  if (!plain(corpus) || Object.keys(corpus).some(key => !keys.includes(key)) || !SHA.test(integrity || '') || hash(payload) !== integrity || corpus.schemaVersion !== 1 || corpus.kind !== 'public-contribution-corpus' || !LOGIN.test(corpus.author || '') || !iso(corpus.capturedAt) || !SHA.test(corpus.sourceSha256 || '') || corpus.advisoryOnly !== true || corpus.authority !== 'none' || corpus.verifiedDefectFixes !== 'unknown' || !Array.isArray(corpus.records) || corpus.records.length > MAX_RECORDS || !plain(corpus.coverage) || typeof corpus.coverage.complete !== 'boolean' || !integer(corpus.coverage.returnedCount, MAX_RECORDS) || corpus.coverage.retainedCount !== corpus.records.length) fail('invalid-contribution-store');
  const coverage = corpus.coverage, exclusions = corpus.exclusions;
  const exclusionKeys = ['nonPublicOrUnknown','ownRepository','forkTarget','authorMismatch','malformed','duplicate'];
  if (!plain(exclusions) || Object.keys(exclusions).length !== exclusionKeys.length || exclusionKeys.some(key => !integer(exclusions[key], MAX_RECORDS)) || Object.keys(coverage).some(key => !['complete','declaredComplete','reportedCount','returnedCount','retainedCount','scope','observationMode'].includes(key)) || (coverage.observationMode !== undefined && !['mixed-window-observations','single-capture-observation'].includes(coverage.observationMode)) || typeof coverage.declaredComplete !== 'boolean' || !integer(coverage.reportedCount) || coverage.reportedCount < coverage.returnedCount || coverage.scope !== 'public-authored-external-nonfork-pr-metadata' || Object.values(exclusions).reduce((sum,count) => sum + count, 0) + corpus.records.length !== coverage.returnedCount || coverage.complete !== (coverage.declaredComplete && coverage.reportedCount === coverage.returnedCount && !exclusions.malformed && !exclusions.authorMismatch && !exclusions.nonPublicOrUnknown) || corpus.provenance !== 'Supplied snapshot bytes are hash-bound; GitHub authenticity and defect-fix evidence are not independently established.') fail('invalid-contribution-store');
  const seen = new Set();
  for (const record of corpus.records) {
    const recordKeys = ['id','repository','number','url','sourceRecordSha256','baseSha','headSha','state','draft','createdAt','updatedAt','mergedAt','merger','externalMerger','additions','deletions','changedFiles','detailsComplete','anchors','patternIds','outcome','verifiedDefectFix','ciEvidence','authority'];
    if (!plain(record) || Object.keys(record).some(key => !recordKeys.includes(key)) || !REPO.test(record.repository || '') || record.repository.split('/')[0].toLowerCase() === corpus.author.toLowerCase() || !integer(record.number) || record.number < 1 || record.url !== `https://github.com/${record.repository}/pull/${record.number}` || record.id !== hash(`${record.repository.toLowerCase()}#${record.number}`) || seen.has(record.id) || !SHA.test(record.sourceRecordSha256 || '') || !OID.test(record.baseSha || '') || !OID.test(record.headSha || '') || !STATES.includes(record.state) || typeof record.draft !== 'boolean' || !iso(record.createdAt) || !iso(record.updatedAt) || Date.parse(record.createdAt) > Date.parse(record.updatedAt) || Date.parse(record.updatedAt) > Date.parse(corpus.capturedAt) || (record.state === 'MERGED' ? !iso(record.mergedAt) || record.draft || Date.parse(record.mergedAt) < Date.parse(record.createdAt) || Date.parse(record.mergedAt) > Date.parse(record.updatedAt) : record.mergedAt !== null) || (record.merger !== null && (!MERGER_LOGIN.test(record.merger || '') || record.state !== 'MERGED')) || record.externalMerger !== (record.merger ? record.merger.toLowerCase() !== corpus.author.toLowerCase() : null) || ![record.additions,record.deletions,record.changedFiles].every(value => integer(value)) || typeof record.detailsComplete !== 'boolean' || !Array.isArray(record.anchors) || record.anchors.length > 96 || record.anchors.some(word => !WORDS.has(word) && !validAnchor(word)) || new Set(record.anchors).size !== record.anchors.length || !Array.isArray(record.patternIds) || record.patternIds.some(id => !IDS.has(id)) || record.patternIds.join(',') !== TAXONOMY.filter(item => record.anchors.some(word => item.words.includes(word))).map(item => item.id).join(',') || record.outcome !== (record.state === 'MERGED' ? 'merged-public-metadata' : record.draft ? 'draft-public-metadata' : `${record.state.toLowerCase()}-public-metadata`) || record.verifiedDefectFix !== 'unknown' || record.ciEvidence !== 'not-imported' || record.authority !== 'none') fail('invalid-contribution-store');
    seen.add(record.id);
  }
  if (JSON.stringify(corpus.patterns) !== JSON.stringify(patterns(corpus.records))) fail('invalid-contribution-store');
  Object.defineProperty(corpus, STORE_HASH, { value: hash(raw) });
  return corpus;
}

/** Explicit local import; no network, training, copied patches or publication. */
export function importContributionKnowledge(root, snapshotPath, { expectedSha256 } = {}) {
  try {
    if (!SHA.test(expectedSha256 || '')) fail('expected-snapshot-sha256-required');
    const raw = readBounded(root, snapshotPath);
    if (hash(raw) !== expectedSha256) fail('snapshot-sha256-mismatch');
    let snapshot; try { snapshot = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw)); } catch { fail('invalid-public-pr-snapshot'); }
    const corpus = buildContributionCorpus(snapshot, { sourceSha256: expectedSha256 });
    load(root); // Never silently replace a corrupt previous corpus.
    const destination = target(root, STORE);
    fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
    const relative = `.tddswarm/learning/contributions/.write-${randomUUID()}.json`, temporary = target(root, relative);
    try {
      fs.writeFileSync(temporary, JSON.stringify(corpus), { flag: 'wx', mode: 0o600 });
      target(root, STORE); fs.renameSync(temporary, destination);
    } finally { fs.rmSync(temporary, { force: true }); }
    return { imported: true, path: STORE, integrity: corpus.integrity, sourceSha256: corpus.sourceSha256, records: corpus.records.length, coverage: corpus.coverage, exclusions: corpus.exclusions, patterns: corpus.patterns, advisoryOnly: true, authority: 'none' };
  } catch (error) {
    const allowed = ['unsafe-contribution-path','contribution-artifact-over-budget','contribution-artifact-changed-during-read','invalid-contribution-store','expected-snapshot-sha256-required','snapshot-sha256-mismatch','invalid-public-pr-snapshot','conflicting-public-pr-identity','contribution-corpus-over-budget'];
    return { imported: false, reason: allowed.includes(error.message) ? error.message : 'contribution-import-unavailable', advisoryOnly: true, authority: 'none' };
  }
}

/** Contract filtering and repository holdouts precede ranking and aggregation. */
export function recallContributionKnowledge(root, query, options = {}) {
  const maxChars = options.maxChars ?? 6000;
  const output = { records: [], patterns: [], advisoryOnly: true, authority: 'none', retrieval: 'contract-anchored-hypotheses', coverageComplete: false };
  try {
    const limit = options.limit ?? 3;
    if (typeof query !== 'string' || Buffer.byteLength(query) > 4096 || typeof options.contract !== 'string' || Buffer.byteLength(options.contract) > 16000 || !Number.isInteger(limit) || limit < 1 || limit > 20 || !Number.isInteger(maxChars) || maxChars < 256 || maxChars > 20000 || !Array.isArray(options.excludeRepositories ?? []) || (options.excludeRepositories ?? []).length > 100 || (options.excludeRepositories ?? []).some(repo => typeof repo !== 'string' || !REPO.test(repo))) fail('invalid-contribution-retrieval');
    const contract = retrievalAnchors(options.contract);
    if (!contract.length) { output.reason = 'no-current-contract-anchor'; return output; }
    const corpus = load(root);
    if (!corpus) { output.reason = 'no-contribution-knowledge'; return output; }
    output.coverageComplete = corpus.coverage.complete;
    output.corpusStoreSha256 = corpus[STORE_HASH];
    // A resumed inventory mixes observations from different windows. Even
    // single-capture metadata is historical and cannot attest current behavior.
    output.observationMode = corpus.coverage.observationMode || 'legacy-unclassified-observation';
    const excluded = new Set((options.excludeRepositories || []).map(repo => repo.toLowerCase()));
    const requested = new Set(retrievalAnchors(query));
    const available = corpus.records.filter(record => !excluded.has(record.repository.toLowerCase()));
    const technicalContract = new Set(contract.filter(word => WORDS.has(word)));
    const documentFrequency = new Map();
    for (const record of available) for (const word of record.anchors) documentFrequency.set(word, (documentFrequency.get(word) || 0) + 1);
    const rareSharedIdentifiers = new Set(contract.filter(word => !WORDS.has(word) && requested.has(word) && (documentFrequency.get(word) || 0) > 0 && documentFrequency.get(word) / available.length <= 0.01));
    const ranked = available.map(record => {
      const technicalMatches = record.anchors.filter(word => technicalContract.has(word));
      const identifierMatches = record.anchors.filter(word => rareSharedIdentifiers.has(word));
      const applicable = technicalContract.size ? technicalMatches.length > 0 : identifierMatches.length >= 2;
      const matches = technicalContract.size ? technicalMatches : identifierMatches;
      const patternIds = record.patternIds.filter(id => TAXONOMY.find(item => item.id === id).words.some(word => technicalMatches.includes(word)));
      return { record, applicable, matches, patternIds,
        relevanceBasis: technicalContract.size ? 'matched-technical-contract-anchors' : 'two-rare-shared-contract-identifiers',
        score: technicalMatches.length * 100 + Math.min(identifierMatches.length, 5) + technicalMatches.filter(word => requested.has(word)).length };
    }).filter(item => item.applicable).sort((a,b) => b.score - a.score || a.record.id.localeCompare(b.record.id));
    for (const item of ranked.slice(0, limit)) {
      const record = item.record;
      const candidate = { ...output, records: [...output.records, { url: record.url, repository: record.repository, number: record.number, sourceRecordSha256: record.sourceRecordSha256, sourceSha256: corpus.sourceSha256, baseSha: record.baseSha, headSha: record.headSha, outcome: record.outcome, externalMerger: record.externalMerger, detailsComplete: record.detailsComplete, verifiedDefectFix: 'unknown', contractMatches: item.matches, patternIds: item.patternIds, relevanceBasis: item.relevanceBasis }], patterns: [] };
      candidate.patterns = patterns(ranked.filter(value => candidate.records.some(selected => selected.url === value.record.url)).map(value => ({ ...value.record, patternIds: value.patternIds })));
      if (bytes(candidate) <= maxChars) { output.records = candidate.records; output.patterns = candidate.patterns; }
    }
    if (!output.records.length) { delete output.corpusStoreSha256; delete output.observationMode; output.reason = 'no-applicable-contribution-within-budget'; }
    return output;
  } catch {
    return { records: [], advisoryOnly: true, authority: 'none', reason: 'invalid-contribution-retrieval-or-store' };
  }
}

export function reflectContributionKnowledge(root) {
  try {
    const corpus = load(root);
    if (!corpus) return { patterns: [], advisoryOnly: true, authority: 'none', reason: 'no-contribution-knowledge' };
    return { patterns: corpus.patterns, coverage: corpus.coverage, exclusions: corpus.exclusions, sourceSha256: corpus.sourceSha256,
      outcomes: { merged: corpus.records.filter(record => record.state === 'MERGED').length, open: corpus.records.filter(record => record.state === 'OPEN' && !record.draft).length, draft: corpus.records.filter(record => record.draft).length, closed: corpus.records.filter(record => record.state === 'CLOSED' && !record.draft).length },
      advisoryOnly: true, authority: 'none', verifiedDefectFixes: 'unknown', learningImprovement: 'unproven' };
  } catch { return { patterns: [], advisoryOnly: true, authority: 'none', reason: 'invalid-contribution-store' }; }
}
