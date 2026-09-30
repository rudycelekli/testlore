# Local adoption pilots

Start with shadow measurements in a clean repository. TestLore keeps the original checkout unchanged and creates a local detached clone under `.tddswarm/pilots/`. Native test code is trusted executable code: this is isolation of source changes, not an operating-system sandbox. Installed `node_modules` is linked locally; dependencies and external services are not frozen. Credentials are removed from the worker's inherited environment, but filesystem access and network are not blocked. Review the repository's test commands first.

```sh
testlore pilot --manifest local-pilots.json --json
testlore pilot --manifest local-pilots.json --execute --json
```

The first command inspects only. The second explicitly executes native discovery and tests. No dependencies are downloaded, agents invoked, or results uploaded. The manifest and raw receipts can contain private code, case names, paths, and logs: keep the manifest under `.tddswarm/` and retain results there. Failed workspaces are retained too. Output directories cannot replace existing evidence.

```json
{
  "schemaVersion": 1,
  "repetitions": 3,
  "timeoutMs": 120000,
  "projects": [{
    "name": "my-app",
    "root": "/absolute/path/to/my-app",
    "scope": "Native Node unit tests; browser and integration suites excluded",
    "config": {"adapter": "node", "discovery": "native", "analysisCache": {"enabled": true}},
    "changes": [{
      "name": "source-comment",
      "file": "src/example.js",
      "before": "export const answer = 42;",
      "after": "export const answer = 42; // local pilot",
      "expectedFailure": false
    }]
  }]
}
```

Support covers 1–20 local repositories, 1–5 repetitions, and 1–12 changes per repository. Configure a project-local Node/Jest/Vitest/Playwright runner and native test scope. A replacement must match once; add a separate planted behavioral regression with `expectedFailure: true`. Declare browser assets and runtime inputs through the regular TestLore configuration. Mixed framework projects need separately described pilots; one framework's passing scope cannot certify the others.

A change can replay a real Git history pair instead of applying a text replacement:

```json
{
  "name": "historical-change",
  "kind": "history",
  "baseRevision": "FULL_IMMUTABLE_BASE_COMMIT_ID",
  "headRevision": "FULL_IMMUTABLE_HEAD_COMMIT_ID",
  "expectedFailure": false
}
```

Use full 40- or 64-character hexadecimal commit IDs; the base must be an ancestor of the head. Each pair is bounded to 500 diff entries and independently checks a green, stable base scope before checking out the actual head tree. Renames, deletions, additions, configuration, assets and multiple files are replayed together. Private receipts retain the immutable revisions, Git change statuses, old/new paths, current complete native scope and baseline cases. The pilot configuration is overlaid identically at both revisions, so historical changes to `tddswarm.config.json`, dependency directories or pilot metadata are rejected. The original checkout stays at its original revision.

Historical dependency and runtime declarations must match both revisions and the current installed checkout, including nested workspace package manifests, lockfiles, `.npmrc`, `.nvmrc`, `.node-version` and `.tool-versions`. A mismatch is retained as an invalid change with `historical-dependency-or-runtime-drift`; it is never reported as a speed gain. Workspace package links are redirected into the isolated revision rather than loading source from the original checkout. Links to local dependencies outside the repository are rejected for history replay. Matching declarations do not freeze the actual installed dependency bytes or external services. Existing dependencies remain shared locally by convention and no installation occurs. Ignored build outputs are not copied from the current checkout. Failed pair baselines and later execution errors remain in each change receipt while subsequent pairs continue.

Each project must have a green, complete, stable baseline with at least one named passing case. Each change uses Git's complete comparison against the isolated configuration commit. Each repetition records discovery and routing overhead, then independently runs full execution, the actual TestLore run, and the native dependency selector in rotating order. Vitest uses `related --run`; Jest uses `--findRelatedTests`; Node and Playwright use a clearly labeled native full baseline because these adapters do not expose an equivalent dependency selector. Missing reports, loader errors, source drift, undemonstrated planted failures, omitted failing case IDs, and extra subset-only failures invalidate the measurement. The `testLoreMs` outer span includes discovery, planning, execution, freshness/service checks, history and final report retention. `fullMs` conservatively measures native execution alone; verification discovery is separate oracle overhead. `nativeMs` includes the native selector’s own discovery and execution. `netSavingMs = fullMs - testLoreMs` and `netVsNativeMs = nativeMs - testLoreMs` can be negative. Native misses are reported separately and cannot be credited as safe speed gains. Entire discovered file sets must agree, and selected-file named cases/statuses must be preserved; equal file counts and zero failing-case misses alone cannot certify a trial. Full receipts retain skips and exact scope: a passing subset is no universal safety claim.

An explicit aggregate export excludes aliases, paths, source, case names, and logs:

```sh
testlore pilot-export --report .tddswarm/pilots/RUN/summary.json --json
```

Aggregates are local self-reports, not authenticated benchmark certificates. They count invalid trials, project errors, historical changes and negative savings; all-trial timing totals preserve failed trial timings while valid-trial totals remain separate. Review an exported aggregate before sharing. A useful qualification campaign includes multiple real projects, representative historical changes plus independent regressions, repeated measurements, and ongoing full shadow runs before trusting selection as a deployment gate.
