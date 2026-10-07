# Planning phase overhead and retained failures

The October 7 follow-up reduces repeated Git work while retaining fresh execution
checks. It does **not** demonstrate a general wall-clock advantage over native
selection. The public measurements include the losses and outliers.

## What changed

Each synchronous plan reuses its own provenance inventory, validated JSON policy
and runner identity. TypeScript module resolution gets a cache on that fresh
graph, after executable native configuration and compiler options are read.
Resolved edges, discovery, executable configuration, Git changes and permission
to omit tests are not saved for the next invocation.

Git binds the immutable baseline commit and project prefix with one `rev-parse`.
Three or more baseline source reads use one bounded `cat-file --batch` process.
NUL-delimited requests preserve filenames containing newlines; response parsing
uses byte lengths, rejects malformed successful responses and preserves fresh
individual reads when an older Git cannot run the batch operation. Missing new
files contribute no invented baseline edge. Budgets bound request and response
sizes.

The opt-in unified path retains **four independent snapshots**: before native
startup, after native startup, before execution and after execution. Its initial
inventory is reused only before the first startup await. The newly checked
post-startup snapshot is reused only in the immediately following synchronous
planning phase. JSON policy is read freshly and compared by digest. Independent
pre-execution and post-execution checks remain unchanged. Public `run`/`plan`
options cannot provide these internal observations.

New fault challenges reject executable configuration that creates a test during
startup, JSON policy changed after the startup check and a source created before
execution. Existing tests also retain changed aliases, removed imports, native
errors, cancellation, source mutation during execution and failure history.

## Complete process measurements

[Machine-readable results](../benchmarks/qualification-20261007/git-phase-performance.json)
bind the baseline main commit `6648f7b5690fedb4e09236c72fc97c1d698ee35b`, initial
optimization `de5d40320a7be7c6427503666fc62425cd1f82c8` and final source
`032469b26584ceebb7fe16561bea009baa5c1965`. The final campaign completed **36/36
executions**: three workloads, three repetitions and four separate CLI arms.
Every TestLore arm retained the independent full-suite failure and exact in-scope
case outcomes. The two constructed workloads also have a 24-execution baseline
campaign and a separately retained initial optimization campaign.

Final measurements, in milliseconds; each cell lists all three repetitions:

| Workload | Full Vitest | Native related | TestLore legacy | TestLore unified |
| --- | --- | --- | --- | --- |
| Independent static leaves, 12 files → 1 | 1393 / 1381 / 1386 | 336 / 335 / 335 | 1483 / 1373 / 1458 | 1376 / 1411 / 1429 |
| Declared asset, 2 files → 1 | 532 / 509 / 451 | 263 / 266 / 267 | 1349 / 1369 / 1419 | 1338 / 1335 / 1282 |
| Public ufo fault, 13 files → 12 | 1661 / 2058 / 1659 | 1534 / 1532 / 1637 | 3261 / **8683** / 3193 | 2867 / **4902** / 2673 |

Native related selection omitted the independently failing asset test in every
repetition: its shorter duration is not quality-equivalent. It preserved the
static and public ufo failures. TestLore remains slower than native related
selection on those workloads. The conspicuous ufo outliers are retained, not
excluded or rerun to obtain a nicer score.

The upstream ufo fix is `5cd9e676711af3f4e4b5398ddf6ca8d52c1c7e1f`, selected in the
frozen public preregistration. This reuses the earlier projected Vitest 5.0.2
environment, whereas upstream declares `^4.1.5`; it **does not qualify the genuine
upstream lock installation** or add a new unique benchmark change.

Outer spans include Node/CLI startup, native work, report/history sealing and
process shutdown. First invocations start with an empty pure analysis cache;
repeats retain that cache and reset history. OS/framework caches and system load
are uncontrolled. Peer framework/benchmark native work paused during the final
campaign; a separate generation protocol still had intermittent native oracle
subprocesses. Different campaign windows, shifted full/native timings and
unattributed outliers prevent a causal before/after speed claim.

## What profiling established

Separate instrumented diagnostics, excluded from timing samples, showed:

- The demo path used **11 → 9 Git subprocesses** after inventory/baseline reuse.
- The public unified path used **18 → 15 Git subprocesses** after checked startup
  observations were reused within their own phases. Their instrumented Git spans
  were approximately **533 → 464 ms**; these single probes do not establish a
  distribution of speed gains.
- Final public parent hashing took approximately **2.6 ms**. Parent hashing is
  not the leading measured cost and excludes all child hashing.
- Native child spans combine startup, dependency resolution and execution. The
  final instrumented report separates planning and execution overall, but does
  not isolate resolver initialization inside that child.

Three rotating read-only local Git probes also compared the system entrypoint
with the active developer tool selected by `xcrun --find git`. Both reported the
same Git version and commit. The entrypoint took **25.8–29.7 ms** versus
**10.4–13.6 ms** for the developer binary. No production executable selection was
changed. A future platform optimization needs separately verified tool selection,
environment parity and freshness; this diagnostic is not a complete CLI speed
comparison.

The next performance experiment should use paired whole CLI arms on the same
frozen inputs with resource telemetry. Preserve the execution checks while
isolating native initialization and qualifying any Git executable optimization.
Additional precise dependency contracts must earn their omissions independently.

## Syntax engine binding and worker diagnostics

The follow-up exposes bounded diagnostic spans for native framework import,
initialization/configuration, discovery, resolution, parent planning wait,
native execution/reporting and process close. Worker timing begins after static
module imports; the parent startup span also includes those imports. These
nested spans overlap and do not confer dependency or execution authority.

The opt-in unified worker can consume internally generated import literals and
lexical configuration flags for source bytes it rereads and hashes independently.
These are pure syntax observations, not resolved edges or permission to omit a
test. A missing or mismatched observation uses the canonical parser. Native
configuration and plugin admission and the four independent snapshots remain
fresh.

The canonical loader binds parser and TypeScript content **before loading**, then
verifies them after loading. Producers retain that immutable loaded identity,
check it before and after observation production, and never label cached ASTs
with a later disk digest. Consumers independently capture content identities and
check dev/inode/size/mtimeNs/ctimeNs seals on every consumption; changed engine
files fail closed. Unknown externally preloaded compiler/parser instances keep
legacy analysis available while disabling summary production and persistent
syntax caching. Unified fresh-parser fallback rejects an unbound engine with a
specific error. TestLore-owned compiler imports use the shared loader.

Disposable source tests exercise actual cached parser/compiler file changes,
including preserved modification timestamps, late reader drift, changes during
loading/production and external-preload compatibility. Modified file contents
are never executed. These changes have correctness verification; no additional
complete-run speed advantage is claimed until source-bound native measurements
can run with adequate disk and memory resources.
