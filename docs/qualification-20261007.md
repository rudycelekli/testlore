# October 7 frontier qualification

TestLore can now discover, resolve and execute tests in one fresh Vitest context, explain actual fallback causes, complete a bounded native generation assay, and report failures through a real Codex host. **General speed leadership, improved learning, the 100-change public benchmark, Claude host qualification and npm publication remain open.** Results below are scoped to their recorded source revisions; later commits do not relabel earlier experiments.

## One context, complete CLI measurements

`testlore run --unified-native --shadow` opts into the [prototype](unified-native.md). Selective execution remains explicit. Supported Vitest 4.1/5 profiles share one invocation context for discovery, dependency resolution and execution. Unknown contexts and plugins reject qualification rather than assume parity. A real stateful resolver counterexample changed outcomes after extra planning calls, so project plugins are conservatively excluded. Framed transport, bounded native report descriptors, late-result rejection and descendant cleanup preserve incomplete outcomes. Requested files on interrupted runs are labeled unverified in human and MCP reports.

The [four-arm CLI campaign](../benchmarks/qualification-20261007/unified-cli.json), source `522b8d5`, completed **24/24 executions** across two constructed workloads and one actual upstream ufo bugfix inversion. Each workload repeated twice, rotating arm order. All legacy and unified TestLore runs preserved full-run failures and selected-file cases. Independent fixed baselines passed; assertions stayed unchanged.

| Workload, first / repeat outer span | Native full | Native related | Legacy TestLore | One-context TestLore |
| --- | ---: | ---: | ---: | ---: |
| Static leaf, 12 files → 1 | 1.324 / 1.339 s | 0.327 / 0.320 s | 1.499 / 1.507 s | 1.532 / 1.534 s |
| Declared asset, 2 files → 1 | 0.451 / 0.443 s | 0.258 / 0.263 s **missed fault** | 1.450 / 1.435 s | 1.439 / 1.443 s |
| Public ufo regression, 13 files → 12 | 1.599 / 1.639 s | 1.460 / 1.479 s | 3.149 / 3.056 s | 2.832 / 2.760 s |

One context saved roughly 300 ms per public-library invocation against legacy TestLore, but remained slower than native related and full execution. The static workload gained no speed. Native related missed the runtime asset assertion in both repetitions; its lower time is excluded from quality-equivalent comparisons. This is a bounded coverage benefit, not a general speed claim.

Outer spans include Node/CLI startup, planning, execution, child source/history/report sealing and native closure. Parent parsing/preparation is excluded and controller elapsed time is retained separately. First TestLore runs start with empty pure analysis caches; repeats retain those caches and reset history. Fresh native contexts are used every time. Baseline execution and OS/dependency caches are uncontrolled; these are **analysis-cache first/repeat measurements, not cold-machine timings**. [Harness and reproduction](unified-native-proof.md).

## Actual fallback causes and a reviewed asset challenge

The [eight-plan inventory](../benchmarks/fallback-inventory-20261006.json) covers every retained own-repository fallback: all eight have changes without consumer evidence; two also change global configuration. Runtime warnings are scoped to their test closures. Research/server/database changes outside the available verification suites retain fallback.

One reviewed literal hypothesis named an actual asset served by an existing HTTP test. A separately executed full/subset challenge selected **16/82 files**, retained **86/424 cases**, and preserved all **three named full-run failures**, with no observed misses. Runtime-uncertain consumers stayed selected. The proposal is **unapplied**, requires review, and remains `closedWorld: false`. This does not establish complete dependency coverage, safe omissions for unrelated changes or a speed advantage. [Sanitized receipt](../benchmarks/qualification-20261007/frontier.json) · [Diagnostic APIs and procedure](fallback-diagnostics.md).

## Native generation completion before learning

A raw diagnostic reproduced a native skill-context warning under the small catalog budget. A second diagnostic with the documented 10,000-token catalog cap completed. The adapter now supplies that fixed cap while continuing to reject native errors, tool use, failed turns and malformed completion. These diagnostics do not retrospectively prove the cause of all seven earlier rejected trials; those failures remain recorded.

A fresh prospective **generation-reliability** assay froze two authored RFC-based API contracts and six constructed faults before calls. Source `725dc60` completed **4/4 trials, 12/12 audited role calls**, within a 12-call cap, 115-second per-call deadline, 64 KiB output budget and **zero retries**. Baselines and each fault executed twice. All six distinct faults were caught in both generation repetitions: **12/12 fault-trial detections**, four stable trials, zero rejected or timed-out trials. This does not establish consistent generation across real projects or independently maintained specifications.

Mean generation time was 62.78 s; mean trial time 66.03 s; controller time 268.71 s. Worker-reported completed-call usage totaled 227,905 input tokens (34,944 cached) and 6,784 output tokens. Model identity and billing remain unknown. Controller timing excludes process startup and final receipt writes. Catalog expansion has an observable input cost. Learning was disabled: **no learning comparison, no improvement claim, promotion disabled**. [Aggregate](../benchmarks/qualification-20261007/frontier.json) · [Evaluator](learning-evaluation.md).

## Public benchmark denominator

The frozen inventory contains **100 unique fix candidates / 10 projects**, with 524 upstream byte bindings. Three candidates executed in this campaign; **two qualified changes, both in ufo**, and one pathe attempt remained unqualified because upstream skipped cases violate strict named-outcome acceptance. Pathe still preserved its observed failures. A separate destr preflight retained a failing fixed baseline. Neither repeated executions nor earlier executions of the same fix add unique changes.

All three campaigns used one-context TestLore at clean source `137c0b6`. Both qualified ufo changes selected 12/13 files and preserved failures in both repetitions, but remained slower than native selection. Public browser and monorepo profiles remain unexecuted. The inventory is dominated by related UnJS projects, and comparative installed Vitest differs from upstream-lock installations. **The proposed 100-qualified-change / 10-project benchmark is not complete.** [Accounting](../benchmarks/qualification-20261007/frontier.json) · [Frozen corpus and reproduction](public-regression-corpus.md).

## Hosted distribution and real agents

The formerly queued main CI run [37567899757](https://github.com/rudycelekli/testlore/actions/runs/37567899757) completed all six checks at `7807c98`. Downloaded artifacts were independently checked against that exact source: **481 passing tests, zero skips, three required Chromium cases**, and archive SHA-256 `d9f431d84d3419649611ff828f6efc9d6363c0d923fed5e2f92d071c632378b1`. This qualifies the recorded main artifact, not an arbitrary later archive.

The real Codex CLI completed four ordered TestLore MCP calls using that production-installed archive. It observed the planted named failure and preserved passing test, returned uncertainty and a repair/fresh-full next action, and did not claim deployment safety. An explicit controller opt-in authorized only the disposable fixture's plan/verify tools; personal configuration stayed unchanged. **Codex qualified in that fixture scope.** Claude's installed native CLI reports no active login, so its earlier authentication failures remain unresolved. [Host procedure](mcp.md).

Read-only npm checks still show no authenticated npm identity and no observed public package. GitHub ownership is not npm ownership. Publisher CLI configuration requires npm >=11.15.0, package write access, account 2FA and an existing package; the current npm 11.6.1 supports publishing through OIDC but not that newer configuration command. The protected workflow remains prepared for an exact qualified archive, with the `alpha` dist-tag. Native account authentication, first-package ownership/bootstrap and the exact publisher mapping are prerequisites before registry publication. [Launch steps](launch.md) · [Official npm trust prerequisites](https://docs.npmjs.com/cli/v11/commands/npm-trust/).

The next engineering acceptance work is to reduce measured planning/startup overhead without caching executable configuration, qualify upstream-lock/browser/monorepo profiles, expand genuine independent public faults, and rerun learning only after reliable completion on untouched external specifications. Authentication gates remain separate from code qualification.
