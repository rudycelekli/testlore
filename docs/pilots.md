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

Support covers 1–20 local repositories, 1–5 repetitions, and 1–12 exact source patches per repository. Configure a project-local Node/Jest/Vitest/Playwright runner and native test scope. A replacement must match once; add a separate planted behavioral regression with `expectedFailure: true`. Declare browser assets and runtime inputs through the regular TestLore configuration. Mixed framework projects need separately described pilots; one framework's passing scope cannot certify the others.

Each project must have a green, complete, stable baseline with at least one named passing case. Each change uses Git's complete comparison against the isolated configuration commit. Each repetition records discovery and routing overhead, then independently runs the proposed subset and full discovered scope, alternating execution order. Missing reports, loader errors, source drift, undemonstrated planted failures, omitted failing case IDs, and extra subset-only failures invalidate the measurement. Net savings include planning overhead and may be negative. Full receipts retain skips and exact scope: a passing subset is no universal safety claim.

An explicit aggregate export excludes aliases, paths, source, case names, and logs:

```sh
testlore pilot-export --report .tddswarm/pilots/RUN/summary.json --json
```

Aggregates are local self-reports, not authenticated benchmark certificates. Review an exported aggregate before sharing. A useful qualification campaign includes multiple real projects, normal edits plus independent regressions, repeated measurements, and ongoing full shadow runs before trusting selection as a deployment gate.
