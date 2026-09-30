# Qualification campaign: September 30, 2026

TestLore has stronger evidence contracts. These results do not establish a general speed advantage, improved learning, complete native agent compatibility or npm publication.

## Real change histories

Four immutable Git revision pairs across three existing repositories were replayed twice in disposable source copies. The native Node/Vitest full suites, TestLore scopes and native selectors executed independently, with rotating order, green baseline requirements, native case/status preservation and unchanged original checkouts. Configuration, assets, source additions and multi-file changes appeared in this corpus. Controlled committed-history tests separately cover renamed/deleted files and workspace package copies.

| Complete measured span, eight valid trials | Total |
| --- | ---: |
| Native full suites | 149.0 seconds |
| TestLore discovery, planning and execution | 201.5 seconds |
| Native selectors, including discovery/selection | 140.0 seconds |

All 422 TestLore file observations fell back to full scope. Both full and TestLore observed 3,152 cases; native selectors observed 2,028. No failing cases appeared in these real revisions, so zero observed misses **does not estimate regression recall**. TestLore lost 52.5 seconds against full execution and 61.5 seconds against native selection. Concurrent local qualification processes and unfrozen installed runtime/dependency bytes limit timing interpretation. Two superseded runs retain their rejected baselines and incomplete workers; their timings are excluded, their missing trials are counted.

[Public aggregate](../benchmarks/history-pilot-aggregate.json) retains losses, failures and scope limitations. Private source, paths and case names remain local. The measured implementation revision is recorded there; later additive native-case validation rechecked all eight raw trials rather than claiming another execution campaign. [Historical replay instructions](pilots.md) explain dependency/runtime rejection and independent comparisons.

The next performance acceptance test is a larger, quiet, representative change corpus containing independently demonstrated regressions. Optimize the measured planning/discovery overhead and resolve evidenced dependencies before expecting selective execution to save time.

## Browser and monorepo proposals

`testlore mapping-qualify` independently executes full and proposed scopes in separate source copies. Native workspace package links point into each copy. Chromium qualification preserves the same named failure in the correct one-file subset and rejects a deliberately wrong proposal that misses it. Incomplete discovery, stale source, altered case identity/status, unknown inputs and late results retain full fallback.

A passing proposal remains **unapplied**, **review required**, and **closedWorld:false**. Browser observations cannot establish unexercised branches or all server inputs; browser fallback remains explicit. Synchronous source copying and hashing are bounded by size but not forcibly interrupted. [Mapping procedure](browser-mappings.md) documents the process and budgets.

## Generated tests and learning

Six new authored contracts, eighteen reference-demonstrated conformance faults, three repetitions and two arms produced 36 attempted trials and 100 controller role invocations. Native reference baselines, generated baselines and each fault repeated at least twice. All valid generated-test trials caught all three faults for their specification; fifteen distinct faults were caught. All six version-comparison generation trials timed out.

| Frozen live arm | Qualified fault detections / opportunities | Valid trials | Timeouts | Mean recorded trial time |
| --- | ---: | ---: | ---: | ---: |
| Without memory | 42 / 54 | 14 / 18 | 4 | 69.9 seconds |
| With advisory memory | 39 / 54 | 13 / 18 | 5 | 73.5 seconds |

The paired inference is **inconclusive**, with incomplete pairs and absent relevant memory disclosed. Learning has no demonstrated improvement and remains advisory. More generated cases did not establish better detection. No timeout was raised, failed attempt rerun, or favorable trial selected.

[Public aggregate](../benchmarks/learning/six-contracts-live-aggregate.json) records the original source revision and hashes. Its recorded times omit project/memory setup and retrieval; byte counts are normalized JSON payloads, not raw transport bytes or tokens. Billing is unknown. Subsequent accounting now measures setup/retrieval and shared controller costs, retains failed ground-truth receipts and states these byte definitions; it does not rewrite this frozen experiment. Two frozen fault names overstate their precise semantics, documented in the [evaluation method](learning-evaluation.md).

Held-out exclusion is established for supplied stdin, historical memory and trial roots. This run does not establish OS read confinement or independently observed zero tool use. There is no observed leakage claim. Constructed specifications, an unpinned default model and local contention limit generalization. The next quality acceptance milestone needs separately frozen, independently maintained specifications, native event auditing, stronger worker confinement and reliable bounded completion before testing any learning-effect claim.

## Native coding-agent hosts

The opt-in harness launches installed native hosts against two isolated TestLore MCP servers and records actual stdio requests and responses. It requires exact case/scope summaries, call arguments and order, deadlines, output bounds and immutable package/executable identity. An SDK smoke test cannot substitute for native execution.

| Actual host attempt | Observed result | Next step |
| --- | --- | --- |
| Codex CLI 0.159.0 | Two readonly calls; execution refused: “MCP tool call requires approval, but approval policy is never” | Review the host's execution-permission configuration separately before a fresh isolated qualification. |
| Claude CLI 2.1.88 | Two connected servers, zero TestLore calls; bounded attempts retained HTTP 401 `authentication_failed` | Repair the existing native subscription login, then run a fresh isolated qualification. |

Neither host is fully qualified. Credentials, personal configuration and host approval policies were not changed to force success. Subsequent hardening was tested locally against malformed observations; it does not relabel the blocked host runs as passed. [Public aggregate](../benchmarks/host-native-aggregate.json) excludes private traces. [Host procedure](mcp.md) supplies concrete commands and bounded failure interpretation.

## Distribution

Production-only archive qualification now also exercises the installed mapping command and verifies that it cannot apply declarations. The protected release workflow requires the exact current main SHA both when qualifying and immediately before publishing.

Read-only probes found no authenticated npm identity and no public `testlore` package metadata. A public 404 does not establish name availability or ownership. The `npm-alpha` GitHub environment is protected. Maintainer npm access, first-package bootstrap and the exact trusted-publisher mapping remain external blockers. New npm mappings must explicitly permit `npm publish` for this workflow. `node scripts/npm-readiness.js` lists these gates without logging in or publishing. See [launch procedure](launch.md) and [official npm publisher documentation](https://docs.npmjs.com/trusted-publishers/).

Source qualification, installed archive execution, hosted CI, native hosts, model-quality experiments and registry publication are separate acceptance results. TestLore remains an experimental alpha until broader independent evidence supports stronger claims.
