# Framework profile qualification

A whole application profile is still an open gate. The October 7 public
`openapi-ts/openapi-typescript` attempt found a real dependency-analysis gap:
TestLore recognized npm workspace declarations but ignored
`pnpm-workspace.yaml`. The pinned upstream source is
[`d46a319ae2efab30e135ba9b223a3cffd1a67eab`](https://github.com/openapi-ts/openapi-typescript/tree/d46a319ae2efab30e135ba9b223a3cffd1a67eab).
The [preflight record](../benchmarks/framework-profiles/openapi-fetch-20261007.json)
contains source/producer commitments, the installation rejection, and bounded
verification results.

TestLore now proposes package input groups from a bounded literal pnpm
`packages` list, including quoted exclusions. The list and current declaration
bytes are included in proposal evidence. YAML aliases, tags, inline lists,
multiline scalars, oversized declarations, and competing npm/pnpm declarations
remain unsupported and visibly require review. A change to the workspace file
forces global fallback even if an `ignoreChanges` entry names it.

On the actual pinned source, the previous producer emitted **0 workspace groups**
(8 total proposals); the new producer emitted **7 workspace groups** (15 total).
Both recorded **63 graph warnings**. These are review hypotheses, never an
assertion that native package exports, browser serving, or external services are
fully understood. No mappings were enabled and no application tests were omitted.

The public installation attempt selected **3 of 9** upstream workspaces through
`--filter openapi-fetch...`, with the unchanged frozen upstream lockfile. It was
stopped by the first missing offline tarball, `axios@1.16.0`; the planned closure
contained 592 registry packages. The local package manager was pnpm 10.17.1,
whereas upstream specifies 10.30.3, and its strict package-manager version check
was explicitly disabled for this incomplete offline preflight. This is not a
qualified upstream environment. The partial installation was removed only after
retaining per-file size/hash evidence and installation logs to preserve the disk
reserve. No global cache or original repository was modified.

| Dependency category | Evidence from this attempt | Qualification |
| --- | --- | --- |
| Workspace imports | Seven proposed package groups on pinned upstream bytes | Review only |
| Routes and bundles | Existing `openapi-fetch` Vite browser app and Playwright oracle inspected | Native execution blocked |
| Styles and assets | This browser app does not supply a representative style/asset contract | Not covered |
| Server and service inputs | Maintainer browser oracle intercepts API calls in Playwright | Actual service behavior not covered |
| Independent full/subset preservation | Constructed pnpm package asset test: two full cases, one selected case, same failure retained | Narrow Node fixture only |
| Unknown dependencies | Constructed unknown server input retains full fallback | Narrow Node fixture only |

The controlled native fixture verifies copied workspace symlinks resolve into
the disposable candidate source, preserves the original test assertions and
source, and does not apply the mapping. It is neither a historical application
bug nor a Vitest/Playwright application qualification. Parser exclusions,
ambiguous declarations, unsupported YAML, forged declaration hashes, and
declaration drift have separate rejection checks.

To close the application gate, use the upstream pinned package-manager version
and complete frozen dependency environment, record successful maintainer full
runs, and challenge every proposed omission with independent full/subset runs.
Choose an application with actual styles, assets and server inputs; the current
`openapi-fetch` browser app cannot supply evidence for all of those categories.
Retain native failures, deliberately misrouted mappings and unknown-input
negative controls, complete wall-clock timings, and explanations for every
omitted test. Passing exercised paths must not silently enable closed-world
browser routing.
