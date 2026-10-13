import test from 'node:test';
import assert from 'node:assert/strict';
import { collectPublicContributions, sanitizePublicPullRequest, selectRepresentativeDetails, validateAuthor, creationWindowQuery, INVENTORY_QUERY, DETAIL_QUERY } from '../scripts/public-contribution-snapshot.js';

function pr(number, overrides = {}) {
  return { number, title: `Correction ${number}`, url: `https://github.com/upstream/project/pull/${number}`, state: 'MERGED', isDraft: false, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-02T00:00:00Z', mergedAt: '2026-01-02T00:00:00Z', baseRefOid: 'a'.repeat(40), headRefOid: 'b'.repeat(40), author: { login: 'rudycelekli' }, mergedBy: { login: 'maintainer' }, repository: { nameWithOwner: 'upstream/project', isPrivate: false, isFork: false, owner: { login: 'upstream' }, url: 'https://github.com/upstream/project' }, additions: 3, deletions: 1, changedFiles: 1, ...overrides };
}
const page = (nodes, issueCount = nodes.length, hasNextPage = false, endCursor = null) => ({ search: { nodes, issueCount, pageInfo: { hasNextPage, endCursor } } });
const config = { author: 'rudycelekli', capturedAt: '2026-10-11T12:00:00Z', detailLimit: 0 };

test('strict public proof, author and GitHub PR identity precede persistence', () => {
  assert.equal(sanitizePublicPullRequest(pr(1, { repository: { ...pr(1).repository, isPrivate: true } }), config.author), null);
  assert.equal(sanitizePublicPullRequest(pr(1, { repository: { ...pr(1).repository, isPrivate: undefined } }), config.author), null);
  for (const isFork of [undefined, null, 'false', 0]) assert.equal(sanitizePublicPullRequest(pr(1, { repository: { ...pr(1).repository, isFork } }), config.author), null);
  assert.equal(sanitizePublicPullRequest(pr(1, { author: { login: 'another-user' } }), config.author), null);
  assert.equal(sanitizePublicPullRequest(pr(1, { url: 'https://example.com/private' }), config.author), null);
  assert.equal(sanitizePublicPullRequest(pr(1), 'RUDYCELEKLI').repository.isPrivate, false);
  assert.throws(() => validateAuthor('rudycelekli is:private'));
});

test('contradictory duplicate identities cannot overwrite prior page metadata or qualify complete coverage', async t => {
  for (const mutation of [{ title: 'Contradiction' }, { headRefOid: 'c'.repeat(40) }, { state: 'OPEN', mergedAt: null }, { repository: { ...pr(1).repository, isFork: true } }]) {
    await t.test(JSON.stringify(mutation), async () => {
      const persisted = [];
      const result = await collectPublicContributions({ ...config, persistPage: async (_, value) => persisted.push(value), fetch: async (_, variables) => variables.cursor === null ? page([pr(1)], 2, true, 'next') : page([pr(1, mutation), pr(2)], 2) });
      assert.equal(result.coverage.complete, false); assert.equal(result.pullRequests.length, 1);
      assert.equal(result.pullRequests[0].title, 'Correction 1'); assert.equal(result.pullRequests[0].headRefOid, 'b'.repeat(40));
      assert.match(result.coverage.limits[0], /contradictory-duplicate-record/); assert.equal(persisted.length, 1);
    });
  }
  const inPage = await collectPublicContributions({ ...config, fetch: async () => page([pr(1), pr(1, { title: 'Contradiction' })], 2) });
  assert.equal(inPage.coverage.complete, false); assert.equal(inPage.pullRequests.length, 0); assert.equal(inPage.sourceHashes.pages.length, 0);
});

test('complete paginated metadata is deduplicated and hash indexed, without descriptions by default', async () => {
  const persisted = []; const calls = [];
  const result = await collectPublicContributions({ ...config, persistPage: async (source, bytes) => persisted.push({ source, bytes }), fetch: async (query, variables) => {
    calls.push({ query, variables }); return variables.cursor === null ? page([pr(1, { body: 'not retained' })], 2, true, 'next') : page([pr(2)], 2);
  } });
  assert.equal(result.coverage.complete, true); assert.equal(result.pullRequests.length, 2);
  assert.equal(calls[1].variables.cursor, 'next'); assert.equal(calls[0].query, INVENTORY_QUERY);
  assert.match(calls[0].variables.searchQuery, /^is:pr author:rudycelekli is:public created:</);
  assert.equal(JSON.stringify(result).includes('not retained'), false);
  assert.equal(persisted.length, 2); assert.equal(result.sourceHashes.pages[0].sha256.length, 64);
});

test('private and foreign-author responses never reach raw page persistence and invalidate complete coverage', async () => {
  const persisted = [];
  const result = await collectPublicContributions({ ...config, persistPage: async (_, bytes) => persisted.push(bytes), fetch: async () => page([pr(1), pr(2, { title: 'PRIVATE_MARKER', repository: { ...pr(2).repository, isPrivate: true } }), pr(3, { author: { login: 'other' }, title: 'FOREIGN_MARKER' })], 3) });
  assert.equal(result.coverage.complete, false); assert.equal(result.coverage.rejectedRecords, 2);
  assert.equal(persisted.join('').includes('PRIVATE_MARKER'), false); assert.equal(persisted.join('').includes('FOREIGN_MARKER'), false);
});

test('search cap triggers nonoverlapping creation windows and never pages the capped search', async () => {
  const queries = [];
  const result = await collectPublicContributions({ ...config, fetch: async (_, variables) => {
    queries.push(variables); if (queries.length === 1) return page([], 1001, true, 'CAP');
    return queries.length === 2 ? page([pr(1)], 1) : page(Array.from({ length: 1000 }, (_, i) => pr(i + 2)), 999);
  } });
  // Deliberately malformed second partition is rejected rather than blessing a 1,001-record inventory.
  assert.equal(result.coverage.complete, false);
  assert.equal(queries.some(query => query.cursor === 'CAP'), false);
  assert.match(queries[1].searchQuery, /created:1970-01-01\.\./);
  const endDay = queries[1].searchQuery.match(/\.\.([^ ]+)/)[1];
  const nextDay = new Date(Date.parse(endDay) + 86400000).toISOString().slice(0, 10);
  assert.ok(queries[2].searchQuery.includes(`created:${nextDay}..`));
  assert.equal(queries[1].searchQuery.match(/created:/g).length, 1);
});

test('partitioned inventories above the search cap qualify only after every page is captured', async () => {
  let requests = 0; let firstPartition = null;
  const result = await collectPublicContributions({ ...config, fetch: async (_, variables) => {
    requests++;
    if (requests === 1) return page([], 1200, true, 'CAP');
    firstPartition ??= variables.searchQuery;
    const base = variables.searchQuery === firstPartition ? 1 : 601;
    const offset = variables.cursor === null ? 0 : Number(variables.cursor);
    const createdAt = variables.searchQuery.match(/created:([^ .]+)/)[1] + 'T00:00:00Z';
    return page(Array.from({ length: 100 }, (_, i) => pr(base + offset + i, { createdAt })), 600, offset < 500, offset < 500 ? String(offset + 100) : null);
  } });
  assert.equal(result.coverage.complete, true); assert.equal(result.pullRequests.length, 1200);
  assert.equal(result.coverage.partitions.length, 2); assert.equal(result.sourceHashes.pages.length, 12); assert.equal(requests, 13);
});

test('one-day query uses a single inclusive calendar range with an exclusive upper bound', () => {
  assert.equal(creationWindowQuery('is:pr author:owner is:public', Date.parse('2026-10-10'), Date.parse('2026-10-11')), 'is:pr author:owner is:public created:2026-10-10..2026-10-10 sort:created-asc');
});

test('a thousand PRs in the minimum creation window remain incomplete instead of claiming capped coverage', async () => {
  const result = await collectPublicContributions({ ...config, capturedAt: '1970-01-01T00:00:00Z', fetch: async () => page([], 1000, true, 'CAP') });
  assert.equal(result.coverage.complete, false); assert.equal(result.coverage.apiCalls, 1);
  assert.equal(result.coverage.partitions[0].reason, 'search-cap-at-minimum-window');
});

test('ignored date qualifiers cannot turn out-of-window public PRs into a complete inventory', async () => {
  const retained = [];
  const result = await collectPublicContributions({ ...config, capturedAt: '2025-01-01T00:00:00Z', persistPage: async (_, value) => retained.push(value), fetch: async () => page([pr(1)]) });
  assert.equal(result.coverage.complete, false); assert.equal(result.coverage.rejectedRecords, 1);
  assert.equal(result.pullRequests.length, 0); assert.equal(retained.join('').includes('Correction 1'), false);
  assert.equal(result.coverage.creationUpperBoundExclusive, '2025-01-02');
});

test('repeated cursors, changed counts and transport errors produce explicit incomplete snapshots', async t => {
  await t.test('cursor loop', async () => {
    const result = await collectPublicContributions({ ...config, fetch: async () => page([pr(1)], 2, true, 'repeat') });
    assert.equal(result.coverage.complete, false); assert.equal(result.coverage.apiCalls, 2);
  });
  await t.test('search drift', async () => {
    let calls = 0;
    const result = await collectPublicContributions({ ...config, fetch: async () => ++calls === 1 ? page([pr(1)], 2, true, 'next') : page([pr(2)], 3) });
    assert.equal(result.coverage.complete, false);
  });
  await t.test('transport diagnostic not retained', async () => {
    const result = await collectPublicContributions({ ...config, fetch: async () => { throw new Error('npm_SECRET_MARKER private-repository'); } });
    assert.equal(result.coverage.complete, false); assert.equal(JSON.stringify(result).includes('SECRET_MARKER'), false);
  });
});

test('API, time and byte ceilings retain partial public evidence without false completeness', async t => {
  const result = await collectPublicContributions({ ...config, maxCalls: 1, fetch: async () => page([pr(1)], 2, true, 'next') });
  assert.equal(result.coverage.complete, false); assert.equal(result.pullRequests.length, 1); assert.equal(result.coverage.apiCalls, 1);
  const tooLarge = await collectPublicContributions({ ...config, maxPersistedBytes: 1, fetch: async () => page([pr(1)]) });
  assert.equal(tooLarge.coverage.complete, false); assert.equal(tooLarge.sourceHashes.pages.length, 0);
  // Freeze startup time, then consume the budget inside the actual fetch seam.
  // A real one-millisecond clock can expire before any query starts, correctly
  // yielding zero calls; scheduler speed must not determine this assertion.
  t.mock.timers.enable({apis:['Date'],now:0});
  const timed = await collectPublicContributions({ ...config, maxDurationMs: 1, fetch: async (_,__,bounds) => { assert.ok(bounds.timeoutMs <= 1); t.mock.timers.tick(10); return page([pr(1)]); } });
  assert.equal(timed.coverage.complete, false); assert.equal(timed.coverage.apiCalls, 1); assert.equal(timed.pullRequests.length, 0);
  assert.match(timed.coverage.limits[0], /wall-clock-budget/);
});

test('representative sample is reproducible across input order and separates repositories and outcomes', () => {
  const records = [pr(1), pr(2), pr(3, { state: 'CLOSED' }), pr(4, { repository: { ...pr(4).repository, nameWithOwner: 'second/project' }, url: 'https://github.com/second/project/pull/4' })];
  const first = selectRepresentativeDetails(records, 3).map(record => record.url);
  const second = selectRepresentativeDetails([...records].reverse(), 3).map(record => record.url);
  assert.deepEqual(first, second); assert.equal(new Set(first).size, 3); assert.equal(first.filter(url => url.includes('second/project')).length, 1);
});

test('explicit details respect file pagination, body bytes and public author proof', async () => {
  let calls = 0;
  const result = await collectPublicContributions({ ...config, detailLimit: 1, fetch: async query => {
    calls++; if (query === INVENTORY_QUERY) return page([pr(1)]);
    assert.equal(query, DETAIL_QUERY);
    return { repository: { pullRequest: pr(1, { body: 'x'.repeat(9000), files: { totalCount: 101, pageInfo: { hasNextPage: true }, nodes: Array.from({ length: 100 }, (_, i) => ({ path: `file-${i}`, additions: 1, deletions: 0, changeType: 'MODIFIED' })) } }) } };
  } });
  assert.equal(calls, 2); assert.equal(Buffer.byteLength(result.pullRequests[0].body), 8192);
  assert.equal(result.pullRequests[0].detailsComplete, false); assert.equal(result.pullRequests[0].files.pageInfo.hasNextPage, true);
  assert.equal(result.coverage.detailCoverage.complete, 0); assert.equal(result.coverage.complete, true);
});

test('complete detail capture and rejected detail identity are distinguishable', async () => {
  const detailed = pr(1, { body: 'Public rationale', files: { totalCount: 1, pageInfo: { hasNextPage: false }, nodes: [{ path: 'test.js', additions: 1, deletions: 0, changeType: 'MODIFIED' }] } });
  const result = await collectPublicContributions({ ...config, detailLimit: 1, fetch: async query => query === INVENTORY_QUERY ? page([pr(1)]) : { repository: { pullRequest: detailed } } });
  assert.equal(result.coverage.detailCoverage.complete, 1); assert.equal(result.pullRequests[0].detailsComplete, true);
  const rejected = await collectPublicContributions({ ...config, detailLimit: 1, fetch: async query => query === INVENTORY_QUERY ? page([pr(1)]) : { repository: { pullRequest: pr(2, { body: 'wrong-identity' }) } } });
  assert.equal(rejected.coverage.detailCoverage.returned, 0); assert.equal(JSON.stringify(rejected).includes('wrong-identity'), false); assert.equal(rejected.coverage.complete, false);
});

test('missing bodies and malformed or over-cap files cannot qualify complete details', () => {
  const files = { totalCount: 1, pageInfo: { hasNextPage: false }, nodes: [{ path: 'test.js', additions: 1, deletions: 0, changeType: 'MODIFIED' }] };
  assert.equal(sanitizePublicPullRequest(pr(1, { files }), config.author, { includeDetails: true }).detailsComplete, false);
  assert.equal(sanitizePublicPullRequest(pr(1, { body: '', files: { ...files, nodes: [{ path: undefined, additions: 1, deletions: 0, changeType: 'MODIFIED' }] } }), config.author, { includeDetails: true }).detailsComplete, false);
  assert.equal(sanitizePublicPullRequest(pr(1, { body: '', files: { ...files, totalCount: 101, nodes: Array.from({ length: 101 }, () => files.nodes[0]) } }), config.author, { includeDetails: true }).detailsComplete, false);
  assert.equal(sanitizePublicPullRequest(pr(1, { body: 'x'.repeat(8192), detailsComplete: false, files }), config.author, { includeDetails: true }).detailsComplete, false);
});

test('resumption carries only contiguous count-validated public windows and explicitly records older observations', async () => {
  const old = await collectPublicContributions({ ...config, fetch: async () => page([pr(1)]) });
  old.coverage.partitions = [{ query: 'is:pr author:rudycelekli is:public created:1970-01-01..2026-01-01 sort:created-asc', complete: true, returnedCount: 1, reportedCount: 1 }];
  const queries = [];
  const result = await collectPublicContributions({ ...config, resumeSnapshot: old, fetch: async (_, variables) => {
    queries.push(variables.searchQuery);
    return queries.length === 1 ? page([pr(1), pr(2)], 2) : page([pr(2, { createdAt: '2026-02-01T00:00:00Z' })], 1);
  } });
  assert.equal(result.coverage.complete, true); assert.equal(result.pullRequests.length, 2);
  assert.equal(result.coverage.resumeProvenance.retainedCount, 1); assert.equal(result.coverage.resumeProvenance.resumedFromDate, '2026-01-02');
  assert.match(result.coverage.consistency, /older metadata/); assert.match(queries[1], /created:2026-01-02\.\./);
});

test('resumption rejects count changes, foreign records and injected query qualifiers before transport', async () => {
  const old = await collectPublicContributions({ ...config, fetch: async () => page([pr(1)]) });
  old.coverage.partitions = [{ query: 'is:pr author:rudycelekli is:public created:1970-01-01..2026-01-01 sort:created-asc', complete: true, returnedCount: 2, reportedCount: 2 }];
  await assert.rejects(collectPublicContributions({ ...config, resumeSnapshot: old }), /count mismatch/);
  old.coverage.partitions[0].returnedCount = 1; old.coverage.partitions[0].reportedCount = 1;
  old.pullRequests[0].repository.isPrivate = true;
  await assert.rejects(collectPublicContributions({ ...config, resumeSnapshot: old }), /unproven public/);
  old.pullRequests[0].repository.isPrivate = false;
  old.coverage.partitions[0].query = 'is:pr author:other is:private created:1970-01-01..2026-01-01 sort:created-asc';
  await assert.rejects(collectPublicContributions({ ...config, resumeSnapshot: old }), /query mismatch/);
});

test('snapshot observation time is completion and preserves the exact capture start', async () => {
  const result = await collectPublicContributions({ ...config, fetch: async () => { await new Promise(resolve => setTimeout(resolve, 10)); return page([pr(1)]); } });
  assert.equal(result.captureStartedAt, config.capturedAt);
  assert.equal(Date.parse(result.capturedAt), Date.parse(result.captureStartedAt) + result.coverage.elapsedMs);
  assert.ok(Date.parse(result.capturedAt) > Date.parse(result.captureStartedAt));
});

test('invalid direct resource limits are refused before invoking transport', async () => {
  for (const limits of [{ maxCalls: 0 },{ maxCalls: 401 },{ maxDurationMs: -1 },{ maxDurationMs: Infinity },{ detailLimit: 41 },{ detailLimit: 1.5 },{ maxPersistedBytes: NaN },{ maxPersistedBytes: 20*1024*1024+1 }]) await assert.rejects(collectPublicContributions({ ...config, ...limits, fetch: async () => assert.fail('invalid limits reached transport') }), /Invalid bounded/);
});
