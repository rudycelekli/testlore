# Routing analysis cache

TestLore can reuse deterministic source-analysis summaries while collecting tests and resolving dependencies afresh. Graph construction deduplicates summaries in memory during each build, including the two passes used for native import resolution. Unconfigured projects retain the existing read-only planning behavior.

Persist summaries explicitly in `tddswarm.config.json`:

```json
{
  "analysisCache": {
    "enabled": true,
    "maxEntries": 2000,
    "maxBytes": 33554432
  }
}
```

Only `enabled`, `maxEntries`, and `maxBytes` are accepted. `enabled` defaults to false. Entry bounds accept integers 1–10000; byte bounds accept integers 4096–67108864. The example shows the defaults for explicit persistence. Disable it with `enabled: false` to avoid cache reads and writes. Existing files may be removed separately. New project initialization can choose to enable this local optimization explicitly.

The cache lives under `.tddswarm/analysis-cache/v1/`, which normal project scans exclude. Each key binds the source bytes and exact file identity to a schema, Node and TypeScript versions, and digests of the implemented graph analyzer and cache modules. The cached value contains only literal import specifiers and the analyzer's parse, dynamic, registration, and runtime warnings. Source code and AST objects are not persisted. Sources larger than 4 MiB and summaries larger than 128 KiB use fresh parsing without persistent entries.

Native collection, native import resolution, TypeScript aliases and declarations, configuration seeds, file inventory, package exports, declared inputs, runtime evidence, policy, and Git baseline edges remain fresh. A cache hit cannot turn an unresolved dependency into resolved evidence or omit a cached warning. Playwright configuration files and their imported helpers join the same global configuration dependency handling used for Jest and Vite.

Historical imports can reuse an exact `(importer, specifier)` resolution already
collected by the same fresh planning graph's complete native context. This is
graph-local reuse, with no persisted resolution cache. Missing historical imports
and imports from a different file still require native resolution. Incomplete
native contexts cannot authorize this reuse, and an explicit root pass always
loads native configuration. New plans reload configuration and retain the
independent selection and execution drift checks.

The bounded Node 22.19.0 / Vitest 5.0.2 fixture in
`test/planning-timings.test.js` observes one configuration load for unchanged
baseline imports, versus two when reuse is disabled. Missing historical imports,
different importers and incomplete contexts still produce two loads. The load
counter itself uses filesystem operations and retains global uncertainty and full
fallback. A separate pure-configuration fixture selects one of two test files and
preserves the same failing native case as an independently executed full suite.
Four deliberate guard mutations are rejected: disabled reuse, specifier-only
reuse, missing-import suppression and incomplete-context reuse. These checks
establish a narrower startup path, not an end-to-end speed advantage or new
framework qualification; whole-CLI cold/warm comparisons remain necessary.

Malformed, mismatched, oversized, symlinked, or inaccessible entries trigger fresh parsing. Routing warnings and selection do not change merely because the cache fails. `buildGraph(root).analysisCache` reports deterministic counts for parses, memory and disk hits, writes, corruption, eviction, skipped entries, and unavailable persistence. These diagnostics do not certify execution or deployment.

Memory summaries, queued writes, and persisted entries are bounded. Writers acquire a local exclusive lock, write complete entries to temporary files, and rename atomically. Old entries are evicted within the configured byte and count bounds. Concurrent writers that cannot acquire the lock keep their fresh analysis and skip persistence. Unknown directory entries or excessive inventories also disable writes safely. An interrupted writer can leave a lock; remove the derived cache directory when no writer is active to rebuild it. There are no remote cache imports or sharing. Checksums detect corruption and mismatched inputs; a fully writable local cache is not cryptographic proof against a party that can forge all its contents.

## Measure the full planning cost

```sh
node scripts/cache-proof.js --output /tmp/testlore-cache-verification.json
node --test test/graph-cache.test.js test/selector.test.js test/graph-external.test.js
```

The proof creates a deterministic parser-heavy project with 120 modules, 400 declarations per module, and 120 test files. It times the entire `plan()` call, including file scans, source reads and hashing, compiler/config loading, fresh resolution, cache reads, lock and inventory work. Five warm and five disabled runs alternate order to reduce a one-sided JIT/filesystem-cache advantage. The cold sample includes persistent writes; the first uncached sample is recorded separately. Changed-source and corrupt-cache plans are compared against fresh routing results. A separate untimed native Node collection check adds a test after warming and confirms fresh collection.

A local development measurement on Node 22.19.0 / TypeScript 6.0.3 / macOS arm64 observed roughly 178 ms warm versus 240 ms without persistence (medians), with a 433 ms cold sample. Re-run the proof for the current implementation and machine: its JSON receipt binds the measured source hashes and records every sample. These figures describe the constructed fixture; native collection/resolution or a small project can dominate total time, and cold caching can add overhead. Test execution time is outside this measurement. No general project speedup or deployment safety is implied.
