import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, writeFile, readFile, statfs } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';

const FIELDS = 'number title url state isDraft createdAt updatedAt mergedAt baseRefOid headRefOid author{login} mergedBy{login} repository{nameWithOwner isPrivate isFork owner{login} url} additions deletions changedFiles';
export const INVENTORY_QUERY = `query($searchQuery:String!,$cursor:String){search(query:$searchQuery,type:ISSUE,first:100,after:$cursor){issueCount pageInfo{hasNextPage endCursor} nodes{... on PullRequest{${FIELDS}}}}}`;
export const DETAIL_QUERY = `query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){pullRequest(number:$number){${FIELDS} body files(first:100){totalCount pageInfo{hasNextPage} nodes{path additions deletions changeType}}}}}`;
const digest = value => createHash('sha256').update(value).digest('hex');
const iso = value => new Date(value).toISOString().replace('.000Z', 'Z');
const dateOnly = value => iso(value).slice(0, 10);
const DAY_MS = 86400000;
export const creationWindowQuery = (baseQuery, low, high) => `${baseQuery} created:${dateOnly(low)}..${dateOnly(high - DAY_MS)} sort:created-asc`;
export function validateAuthor(author) {
  if (typeof author !== 'string' || !/^[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?$/i.test(author)) throw new Error('Invalid GitHub author');
  return author;
}
export function sanitizePublicPullRequest(node, author, { includeDetails = false, bodyLimit = 8192 } = {}) {
  if (!node || node.repository?.isPrivate !== false || typeof node.repository?.isFork !== 'boolean' || node.author?.login?.toLowerCase() !== author.toLowerCase()) return null;
  const repo = node.repository;
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo.nameWithOwner ?? '') || !Number.isSafeInteger(node.number) || node.number < 1 || node.url !== `https://github.com/${repo.nameWithOwner}/pull/${node.number}`) return null;
  if (!['OPEN', 'CLOSED', 'MERGED'].includes(node.state) || !Number.isFinite(Date.parse(node.createdAt)) || !Number.isFinite(Date.parse(node.updatedAt))) return null;
  const record = {};
  for (const field of ['number', 'title', 'url', 'state', 'isDraft', 'createdAt', 'updatedAt', 'mergedAt', 'baseRefOid', 'headRefOid', 'additions', 'deletions', 'changedFiles']) record[field] = node[field] ?? null;
  record.title = String(record.title ?? '').slice(0, 4096);
  record.author = { login: node.author.login };
  record.mergedBy = node.mergedBy?.login ? { login: node.mergedBy.login } : null;
  record.repository = { nameWithOwner: repo.nameWithOwner, isPrivate: false, isFork: repo.isFork === true, owner: { login: repo.owner?.login ?? repo.nameWithOwner.split('/')[0] }, url: `https://github.com/${repo.nameWithOwner}` };
  record.detailsComplete = false;
  if (includeDetails) {
    const body = typeof node.body === 'string' ? node.body : '';
    const bytes = Buffer.from(body);
    record.body = bytes.subarray(0, bodyLimit).toString('utf8').replace(/\uFFFD$/, '');
    const files = node.files;
    if (files && Array.isArray(files.nodes) && Number.isSafeInteger(files.totalCount) && typeof files.pageInfo?.hasNextPage === 'boolean') {
      record.files = { nodes: files.nodes.slice(0, 100).map(file => ({ path: String(file.path).slice(0, 4096), additions: file.additions, deletions: file.deletions, changeType: file.changeType })), totalCount: files.totalCount, pageInfo: { hasNextPage: files.pageInfo.hasNextPage } };
      const validFiles = files.nodes.every(file => typeof file.path === 'string' && file.path.length > 0 && Number.isSafeInteger(file.additions) && file.additions >= 0 && Number.isSafeInteger(file.deletions) && file.deletions >= 0 && typeof file.changeType === 'string');
      record.detailsComplete = node.detailsComplete !== false && typeof node.body === 'string' && bytes.length <= bodyLimit && validFiles && files.nodes.length <= 100 && !files.pageInfo.hasNextPage && files.nodes.length === files.totalCount;
    }
  }
  return record;
}

export function selectRepresentativeDetails(records, count = 24, seed = 'testlore-public-contributions-v1') {
  const groups = new Map();
  for (const record of records) {
    const key = `${record.repository.nameWithOwner}:${record.state}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(record);
  }
  const ranked = [...groups].map(([key, values]) => [key, values.sort((a, b) => digest(`${seed}:${a.url}`).localeCompare(digest(`${seed}:${b.url}`)))]).sort(([a], [b]) => digest(`${seed}:${a}`).localeCompare(digest(`${seed}:${b}`)));
  const selected = [];
  for (let depth = 0; selected.length < count; depth++) {
    let found = false;
    for (const [, values] of ranked) if (values[depth] && selected.length < count) { selected.push(values[depth]); found = true; }
    if (!found) break;
  }
  return selected;
}

export function githubGraphql(query, variables, { timeoutMs = 45000, maxBytes = 2 * 1024 * 1024 } = {}) {
  return new Promise((resolveResult, reject) => {
    const child = spawn('gh', ['api', 'graphql', '--input', '-'], { stdio: ['pipe', 'pipe', 'pipe'], shell: false });
    const chunks = []; let size = 0; let exceeded = false;
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.stdout.on('data', chunk => { size += chunk.length; if (size > maxBytes) { exceeded = true; child.kill('SIGKILL'); } else chunks.push(chunk); });
    // Never include stderr: authentication diagnostics can contain account or credential context.
    child.stderr.resume();
    child.on('error', () => { clearTimeout(timer); reject(new Error('GitHub transport unavailable')); });
    child.on('close', code => {
      clearTimeout(timer);
      if (code !== 0 || exceeded) return reject(new Error(exceeded ? 'GitHub response exceeds byte budget' : 'GitHub request failed or timed out'));
      try { const value = JSON.parse(Buffer.concat(chunks).toString('utf8')); if (value.errors) throw new Error(); resolveResult(value.data); } catch { reject(new Error('GitHub response is not valid GraphQL data')); }
    });
    child.stdin.on('error', () => {});
    child.stdin.end(JSON.stringify({ query, variables }));
  });
}

export async function collectPublicContributions({ author, fetch = githubGraphql, capturedAt = new Date().toISOString(), maxCalls = 400, maxDurationMs = 900000, detailLimit = 24, maxPersistedBytes = 20 * 1024 * 1024, persistPage = async () => {}, resumeSnapshot = null, resumeSourceSha256 = null }) {
  validateAuthor(author);
  if (!Number.isFinite(Date.parse(capturedAt))) throw new Error('Invalid capture timestamp');
  for (const [name, value, min, max] of [['maxCalls',maxCalls,1,400],['maxDurationMs',maxDurationMs,1,900000],['detailLimit',detailLimit,0,40],['maxPersistedBytes',maxPersistedBytes,1,20*1024*1024]]) if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error(`Invalid bounded ${name}`);
  const start = Date.now(); const records = new Map(); const partitions = []; const pageSources = []; const limits = []; let calls = 0; let bytes = 0; let rejected = 0;
  const baseQuery = `is:pr author:${author} is:public`;
  // GitHub issue search silently ignores timestamp-form qualifiers and repeated
  // created: qualifiers in this API. Use one calendar-date range and independently
  // check every returned record's membership before persisting it.
  const upperBound = Math.floor(Date.parse(capturedAt) / DAY_MS) * DAY_MS + DAY_MS;
  const boundedQuery = `${baseQuery} created:<${dateOnly(upperBound)} sort:created-asc`;
  let lowerBound = Date.parse('1970-01-01T00:00:00Z');
  let resumeProvenance = null;
  if (resumeSnapshot) {
    if (resumeSnapshot.schemaVersion !== 1 || resumeSnapshot.kind !== 'public-authored-pr-snapshot' || resumeSnapshot.author?.toLowerCase() !== author.toLowerCase() || !Array.isArray(resumeSnapshot.pullRequests) || !Array.isArray(resumeSnapshot.coverage?.partitions)) throw new Error('Invalid resume snapshot');
    const retained = [];
    for (const partition of resumeSnapshot.coverage.partitions) {
      const range = partition.query?.match(/ created:(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2}) sort:created-asc$/);
      if (!partition.complete || !range || Date.parse(range[1]) !== lowerBound) break;
      const high = Date.parse(range[2]) + DAY_MS;
      if (!Number.isFinite(high) || high <= lowerBound || high > upperBound) throw new Error('Invalid resume partition');
      if (partition.query !== creationWindowQuery(baseQuery, lowerBound, high)) throw new Error('Resume query mismatch');
      retained.push(partition); lowerBound = high;
    }
    for (const node of resumeSnapshot.pullRequests) {
      const record = sanitizePublicPullRequest(node, author, { includeDetails: typeof node.body === 'string' });
      if (!record) throw new Error('Resume contains unproven public or foreign-author records');
      if (Date.parse(record.createdAt) < lowerBound) records.set(record.url, record);
    }
    for (const partition of retained) {
      const [lowDate, highDate] = partition.query.match(/ created:(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2}) /).slice(1);
      const count = [...records.values()].filter(record => Date.parse(record.createdAt) >= Date.parse(lowDate) && Date.parse(record.createdAt) < Date.parse(highDate) + DAY_MS).length;
      if (count !== partition.reportedCount || count !== partition.returnedCount) throw new Error('Resume partition count mismatch');
    }
    partitions.push(...retained.map(partition => ({ ...partition, retainedFromCapturedAt: resumeSnapshot.capturedAt })));
    resumeProvenance = { canonicalSha256: digest(JSON.stringify(resumeSnapshot)), sourceFileSha256: resumeSourceSha256, capturedAt: resumeSnapshot.capturedAt, retainedCount: records.size, retainedPartitions: retained.length, resumedFromDate: dateOnly(lowerBound), sourceHashes: resumeSnapshot.sourceHashes };
  }
  async function request(query, variables) {
    if (calls >= maxCalls) throw new Error('api-call-budget');
    const remaining = maxDurationMs - (Date.now() - start);
    if (remaining <= 0) throw new Error('wall-clock-budget');
    calls++;
    const response = await fetch(query, variables, { timeoutMs: Math.min(45000, remaining) });
    if (Date.now() - start >= maxDurationMs) throw new Error('wall-clock-budget');
    return response;
  }
  async function retain(kind, query, cleanRecords) {
    const value = { schemaVersion: 1, kind, query, captureStartedAt: capturedAt, capturedAt: new Date(Date.parse(capturedAt) + Date.now() - start).toISOString(), pullRequests: cleanRecords };
    const serialized = `${JSON.stringify(value)}\n`; bytes += Buffer.byteLength(serialized);
    if (bytes > maxPersistedBytes) throw new Error('persistence-byte-budget');
    const entry = { index: pageSources.length, kind, sha256: digest(serialized), bytes: Buffer.byteLength(serialized), returnedCount: cleanRecords.length };
    await persistPage(entry, serialized);
    pageSources.push(entry);
  }
  let reportedCount = null;
  async function visit(query, low, high, initial = null) {
    const response = initial ?? await request(INVENTORY_QUERY, { searchQuery: query, cursor: null });
    const search = response?.search;
    if (!Number.isSafeInteger(search?.issueCount) || !Array.isArray(search.nodes) || typeof search.pageInfo?.hasNextPage !== 'boolean') throw new Error('invalid-search-response');
    if (search.issueCount >= 1000) {
      const midpoint = Math.floor((low + high) / (2 * DAY_MS)) * DAY_MS;
      if (midpoint <= low || midpoint >= high) { partitions.push({ query, reportedCount: search.issueCount, returnedCount: 0, complete: false, reason: 'search-cap-at-minimum-window' }); return; }
      await visit(creationWindowQuery(baseQuery, low, midpoint), low, midpoint);
      await visit(creationWindowQuery(baseQuery, midpoint, high), midpoint, high);
      return;
    }
    const partition = { query, reportedCount: search.issueCount, returnedCount: 0, complete: false }; partitions.push(partition);
    let current = search; const seenCursors = new Set(); const seenUrls = new Set();
    while (true) {
      const clean = current.nodes.map(node => sanitizePublicPullRequest(node, author)).filter(record => record && Date.parse(record.createdAt) >= low && Date.parse(record.createdAt) < high);
      rejected += current.nodes.length - clean.length;
      const pageIdentities = new Map();
      for (const record of clean) {
        const existing = pageIdentities.get(record.url) ?? records.get(record.url);
        if (existing && JSON.stringify(existing) !== JSON.stringify(record)) throw new Error('contradictory-duplicate-record');
        pageIdentities.set(record.url, record);
      }
      await retain('public-pr-metadata-page', query, clean);
      for (const record of clean) { seenUrls.add(record.url); records.set(record.url, record); }
      partition.returnedCount = seenUrls.size;
      if (!current.pageInfo.hasNextPage) { partition.complete = seenUrls.size === partition.reportedCount && clean.length === current.nodes.length; break; }
      const cursor = current.pageInfo.endCursor;
      if (typeof cursor !== 'string' || !cursor || seenCursors.has(cursor)) throw new Error('invalid-or-repeated-cursor');
      seenCursors.add(cursor);
      current = (await request(INVENTORY_QUERY, { searchQuery: query, cursor })).search;
      if (!current || current.issueCount !== partition.reportedCount || !Array.isArray(current.nodes) || typeof current.pageInfo?.hasNextPage !== 'boolean') throw new Error('search-changed-during-capture');
    }
  }
  try {
    const first = await request(INVENTORY_QUERY, { searchQuery: boundedQuery, cursor: null });
    reportedCount = first?.search?.issueCount ?? null;
    if (resumeProvenance) {
      if (lowerBound < upperBound) await visit(creationWindowQuery(baseQuery, lowerBound, upperBound), lowerBound, upperBound);
    } else await visit(boundedQuery, lowerBound, upperBound, first);
  } catch (error) { const known = ['api-call-budget', 'wall-clock-budget', 'persistence-byte-budget', 'invalid-search-response', 'invalid-or-repeated-cursor', 'search-changed-during-capture', 'contradictory-duplicate-record', 'Disk reserve reached']; limits.push(`Inventory incomplete: ${known.includes(error.message) ? error.message : 'transport-or-invalid-response'}.`); }
  let detailAttempted = 0; let detailReturned = 0; let detailComplete = 0;
  for (const record of selectRepresentativeDetails([...records.values()], detailLimit)) {
    detailAttempted++;
    try {
      const [owner, name] = record.repository.nameWithOwner.split('/');
      const response = await request(DETAIL_QUERY, { owner, name, number: record.number });
      const detail = sanitizePublicPullRequest(response?.repository?.pullRequest, author, { includeDetails: true });
      if (!detail || detail.url !== record.url) throw new Error('Detail identity rejected');
      await retain('public-pr-detail', record.url, [detail]);
      records.set(detail.url, detail); detailReturned++; if (detail.detailsComplete) detailComplete++;
    } catch { limits.push('A requested detail record could not be completely captured.'); }
  }
  const pullRequests = [...records.values()].sort((a, b) => a.url.localeCompare(b.url));
  const complete = reportedCount !== null && pullRequests.length === reportedCount && partitions.every(partition => partition.complete) && rejected === 0 && limits.length === 0;
  const elapsedMs = Date.now() - start;
  return { schemaVersion: 1, kind: 'public-authored-pr-snapshot', author, captureStartedAt: capturedAt, capturedAt: new Date(Date.parse(capturedAt) + elapsedMs).toISOString(), coverage: { complete, reportedCount, returnedCount: pullRequests.length, query: boundedQuery, partitions, limits: [...new Set(limits)], detailCoverage: { requested: detailLimit, attempted: detailAttempted, returned: detailReturned, complete: detailComplete, bodyByteLimit: 8192, filesPerRecordLimit: 100, selection: 'deterministic-repository-and-outcome-round-robin', seed: 'testlore-public-contributions-v1' }, rejectedRecords: rejected, apiCalls: calls, maxCalls, maxDurationMs, maxPersistedBytes, consistency: resumeProvenance ? 'Resumed calendar-window observations retain older metadata; not an atomic GitHub snapshot.' : 'UTC calendar-day bounded paginated observation; not an atomic GitHub snapshot.', creationUpperBoundExclusive: dateOnly(upperBound), elapsedMs, resumeProvenance }, sourceHashes: { inventoryQuerySha256: digest(INVENTORY_QUERY), detailQuerySha256: digest(DETAIL_QUERY), pages: pageSources }, pullRequests };
}

export async function main(argv = process.argv.slice(2)) {
  const options = {};
  for (let index = 0; index < argv.length; index += 2) {
    if (!['--author', '--output', '--details', '--resume'].includes(argv[index]) || !argv[index + 1]) throw new Error('Use --author LOGIN --output PATH [--details 24] [--resume PATH]');
    options[argv[index].slice(2)] = argv[index + 1];
  }
  validateAuthor(options.author);
  if (!options.output) throw new Error('An output path is required');
  const details = Number(options.details ?? 24);
  if (!Number.isSafeInteger(details) || details < 0 || details > 40) throw new Error('Details must be bounded between 0 and 40');
  const output = resolve(options.output); await mkdir(dirname(output), { recursive: true });
  const filesystem = await statfs(dirname(output));
  if (filesystem.bavail * filesystem.bsize < 1024 ** 3 + 40 * 1024 ** 2) throw new Error('At least 1 GiB disk reserve is required');
  // Reserve the destination before any network operation; never overwrite an earlier snapshot.
  await writeFile(output, '', { flag: 'wx', mode: 0o600 });
  const pagesDir = `${output}.pages`; await mkdir(pagesDir, { recursive: false });
  const resumeBytes = options.resume ? await readFile(resolve(options.resume), 'utf8') : null;
  const resumeSnapshot = resumeBytes ? JSON.parse(resumeBytes) : null;
  const result = await collectPublicContributions({ author: options.author, detailLimit: details, resumeSnapshot, resumeSourceSha256: resumeBytes ? digest(resumeBytes) : null, persistPage: async (entry, bytes) => {
    const currentFs = await statfs(pagesDir);
    if (currentFs.bavail * currentFs.bsize < 1024 ** 3 + Buffer.byteLength(bytes) + 20 * 1024 ** 2) throw new Error('Disk reserve reached');
    const path = `${pagesDir}/${String(entry.index).padStart(4, '0')}.json`;
    await writeFile(path, bytes, { flag: 'wx', mode: 0o600 }); entry.path = path;
  } });
  const serialized = `${JSON.stringify(result, null, 2)}\n`;
  await writeFile(output, serialized, { mode: 0o600 });
  await writeFile(`${output}.sha256`, `${digest(serialized)}  ${output}\n`, { flag: 'wx', mode: 0o600 });
  process.stdout.write(`${JSON.stringify({ output, complete: result.coverage.complete, reportedCount: result.coverage.reportedCount, returnedCount: result.coverage.returnedCount, detailCoverage: result.coverage.detailCoverage, sha256: digest(serialized) })}\n`);
  if (!result.coverage.complete) process.exitCode = 2;
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main().catch(() => { process.stderr.write('Public contribution capture failed; no credentials or raw API diagnostics were retained.\n'); process.exitCode = 1; });
