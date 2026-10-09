# Claude-mem: native Bun qualification

The first campaign pins `thedotmack/claude-mem` at
`fa8ab09f06aa05f958c5225cf3756ce52a3ebb96` (13.35.0), and Bun at 1.4.2.
There is no current qualified public result or speed claim until the raw campaign
artifacts have been produced and independently assessed.

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
node scripts/claude-mem-public-pilot.js /absolute/disposable/claude-mem /absolute/new/evidence /absolute/new/evidence/home
```

The script requires the pinned clean checkout. It never installs dependencies,
starts a personal worker, runs `build-and-sync`, or reads the user's normal HOME.
Only PATH and its isolated HOME/temp/CI environment reach native subprocesses.
The root of this upstream pin has no committed package lock: retain the
installation's generated lock and dependency inventory as campaign evidence.
This is an original-source and original-declaration installation, not a claim
that upstream provided an immutable root dependency environment.

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
