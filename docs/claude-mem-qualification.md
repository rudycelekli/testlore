# Claude-mem: native Bun qualification

The first campaign pins `thedotmack/claude-mem` at
`fa8ab09f06aa05f958c5225cf3756ce52a3ebb96` (13.35.0), and Bun at 1.4.2.
The recorded native campaign remains unqualified and establishes no speed
advantage. Individually completed original scopes are reported separately from
the rejected full suite and routing profile.

The first hosted attempt at TestLore source `664d762ffe12ef5c53b28384aa2a6ef3f9220a13`
passed all 17 Bun/evaluator checks but did not reach an upstream baseline. The
original-declaration npm install exceeded the campaign's 1 GiB growth ceiling
after 25.1 seconds (1,094,934,528 bytes growth, 89,794,072,576 bytes remaining).
The process was stopped and its incomplete inventory rejected. This is a
resource rejection, not a test failure or successful claude-mem qualification.
The retained [hosted attempt](https://github.com/rudycelekli/testlore/actions/runs/37945257806)
and `benchmarks/claude-mem-20261009/install-interruption.json.gz` preserve the
original reports and installation warning: newly resolved Posthog 5.55.1 declares
Node 22.22 or later while this campaign uses Node 22.19. The next recipe changes
only the hosted install growth ceiling to 4 GiB, retaining the 180-second deadline,
2 GiB free-space reserve, original declarations, Node/Bun versions and ignored
lifecycle scripts. Baseline failures remain disqualifying.

The [second attempt](https://github.com/rudycelekli/testlore/actions/runs/37945888282)
at source `433baa2dce9db28847d71686f8ed092befe8330f` completed installation
in 27.1 seconds with 1,407,172,608 bytes growth. The original declarations'
`npm ls --all` still rejected missing peers (`@anthropic-ai/sdk`, several
tree-sitter versions) and an invalid picomatch dependency. No native claude-mem
baseline ran. `inventory-rejection.json.gz` retains the exact original receipt,
newly resolved lock and rejected inventory. The next harness permits isolated
diagnostic baselines after a completed installation, but preserves the rejected
inventory and forces overall qualification false. It adds no missing packages,
changes no source tests and upgrades no runtime to manufacture a successful
environment.

The [third campaign](https://github.com/rudycelekli/testlore/actions/runs/37947220123)
at source `7532ad0005c81686e7edaa3729b349cd5cb43690` finally executed genuine Bun
tests. Original SQLite (244 cases/34 files), worker search (80/7), context (236/30)
and server (322/43) scopes completed green. The full `bun test tests` timed out
at 180 seconds and remains incomplete. The routes scope completed with five
existing browser failures: Chromium never signalled restart-page readiness
within each test's original 30-second window. That scope took about 159 seconds.

The old harness wrongly proceeded to fault trials despite the rejected routes
baseline. Three trials independently demonstrated the timestamp-tie failure and
TestLore retained all six observed failures, but these are diagnostic trials,
not qualified regression results. TestLore ran all 57 files and took 321–323
seconds versus native execution's 158–159 seconds. Full-execution discovery
itself took about 159 seconds; planning beyond discovery was about five seconds.
Restoration still had the same five browser failures. There is no omission or
speed win. The original receipt's per-trial `valid:true` flags are insufficient
because the original scope never qualified; the new prerequisite gate rejects
that promotion. `native-diagnostics.json.gz` retains every original native
JSON/XML/stdout/stderr and TestLore report, unchanged, including negative outcomes.

TestLore uses Bun's own terminal JUnit file, rather than parsing console output
or translating Bun tests into Node tests. The parser validates aggregate counts,
nested suite structure, exact file/classname/title/source-line identities,
skips and failures. Missing, oversized, changing, malformed or ambiguous reports
and process interruptions reject completeness. Duplicate semantic identities
are rejected instead of inventing correspondence. A complete report measures
the cases it contains; it cannot prove every possible runtime registration.

The admitted runner profile is direct `bun test {files}`, with optional `--smol`
and bounded decimal `--timeout`. Every executed file uses an explicit `./` path.
Scope-changing filters, retries, bail, snapshot mutation and other unqualified
flags are rejected. Original `bunfig.toml` is preserved, including the telemetry
mock preload required by upstream.

Bun runs files in a shared global by default. TestLore currently retains full
fallback for Bun: static imports alone cannot authorize omissions across its
shared module state. Native discovery is explicitly a full execution, with its
failures and duration recorded; there is no claimed list-only dry run.

## Reproduce the campaign

In an isolated checkout with Bun 1.4.2 and the original declared dependencies
installed, use:

```sh
node scripts/claude-mem-public-pilot.js /absolute/disposable/claude-mem /absolute/new/evidence /absolute/new/evidence/home /absolute/installation-receipt.json
```

The script requires the pinned clean checkout. It never installs dependencies,
starts a personal worker, runs `build-and-sync`, or reads the user's normal HOME.
Only PATH and its isolated HOME/temp/CI environment reach native subprocesses.
The root of this upstream pin has no committed package lock: retain the
installation's generated lock and dependency inventory as campaign evidence.
This is an original-source and original-declaration installation, not a claim
that upstream provided an immutable root dependency environment.
The optional installation receipt binds the original manifest and completed
installation process. Missing or rejected dependency inventory cannot establish
overall qualification, even if native diagnostic trials finish successfully.

Before any historical fault, the unchanged original worker/http/routes baseline
must finish green, and the exact original timestamp-tie oracle must independently
pass. A rejected or interrupted prerequisite leaves all three fault trials
explicitly not run; independent preregistered baseline scopes are still retained.
After a fault is applied, a complete native run must independently demonstrate
that specific defect before TestLore executes. An incomplete TestLore arm stops
remaining trials for that scope. The collector can finish reporting a bounded
negative campaign (`collectionCompleted`) while native execution remains
unqualified (`observationCompleted:false`). These fields are deliberately
separate: a timeout is never counted as completed native execution.
Before each fault iteration, the prospective profile reserves four complete
180-second arms (native fault, TestLore discovery, TestLore execution and native
restoration) plus a 60-second planning/reporting margin inside the unchanged
36-minute controller deadline. Remaining repetitions are explicitly not run if
that budget no longer fits. These gates are prospective; old results are not
retroactively rewritten.

Preregistered baselines are `bun test tests`, plus sqlite, worker/search, context,
server and worker/http/routes scopes. Baseline losses remain in the result. Three regression trials
reconstruct the timestamp-tie bug documented by upstream commit
`c84c04756ac935add118e875f1f65d963d650d30`, while preserving the original
`tests/worker/http/routes/native-prompt-init.test.ts` and every other test.
The reconstruction restores newest-by-timestamp lookup through the current
store API; it is explicitly not an exact historical full-tree revert. The
unchanged upstream test must independently fail on the fault and pass after
restoration. No assertion is generated from the injected solution.

Native timing includes execution and report validation. TestLore timing includes
full-execution discovery, graph construction, execution and final JSON sealing.
This first campaign compares against the native full scope; Bun's changed-test
selector and OS-cold/warm conditions are not qualified. No model generation is
used, so learning and model-cost gains are not asserted.

Primary references: [Bun reporters](https://bun.sh/docs/test/reporters),
[Bun native JUnit snapshot](https://github.com/oven-sh/bun/blob/bun-v1.4.2/test/js/junit-reporter/__snapshots__/junit.test.js.snap),
[upstream commands](https://github.com/thedotmack/claude-mem/blob/fa8ab09f06aa05f958c5225cf3756ce52a3ebb96/package.json),
[upstream preload](https://github.com/thedotmack/claude-mem/blob/fa8ab09f06aa05f958c5225cf3756ce52a3ebb96/bunfig.toml),
[historical bug fix](https://github.com/thedotmack/claude-mem/commit/c84c04756ac935add118e875f1f65d963d650d30).

## Prospective prerequisite gates verified at `6cea389`

The [new completed collection](https://github.com/rudycelekli/testlore/actions/runs/37953327800) at exact source `6cea38950813e8ccfde6a7b8ea2d7c44ddbd7026` preserves the negative baseline and stops before regression mutation: **zero faults applied, zero TestLore comparison trials**, all three repetitions explicitly not run, and protected source/tests/configuration unchanged. No fault/restoration report exists. The unchanged route scope passed **363 cases** and failed **five** restart-page browser cases after approximately 30 seconds each; complete scope runtime was **158.192 seconds**. The full scope timed out at **180.022 seconds** with SIGKILL and no complete JUnit inventory.

Separate original scopes completed: sqlite **244 passed** (4.190 s), search **80 passed** (0.467 s), context **235 passed/1 skipped** (9.538 s), and server **306 passed/16 skipped** (2.092 s). Installation completed under its resource policy, but `npm ls --all` still rejected the dependency inventory; overall installation/qualification remains false. The upstream root has no committed lock, and ignored lifecycle scripts remain a limitation.

[Durable native evidence](../benchmarks/claude-mem-20261009/gated-6cea389/README.md) retains all original scopes, raw failed names, native stderr/JUnit, timeout, installation logs, lock and preregistered bindings with independently verified artifact hashes. No selection, missed-failure, speed or learning result can be inferred from zero admitted comparisons. The green hosted result confirms bounded negative evidence collection.
