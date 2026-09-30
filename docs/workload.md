# When callback cost makes routing useful

In this constructed workload, TestLore reduced median end-to-end time from **4,269 ms to 1,487 ms**, including cold native discovery, planning, execution, and evidence retention. Both methods detected the same planted leaf regression in all three repetitions. This is evidence for one specified workload condition, not a production speed guarantee.

| Method | Planted failure observations detected | Callback files per repetition | Median end-to-end time |
| --- | ---: | ---: | ---: |
| Full native Node suite | 3/3 | 64/64 (100%) | 4,269 ms |
| TestLore routing | 3/3 | 1/64 (1.56%) | 1,487 ms |

That is 65.2% less median wall-clock time for TestLore in this condition. The [separate tiny-suite comparison](comparison.md) remains relevant: TestLore took 559 ms versus the full suite's 133 ms there. Routing has overhead; whether it pays off depends on the work avoided.

## Fixed workload and ground truth

The authored fixture contains 64 independent source modules and 64 Node test files. Every asynchronous test callback awaits a **constructed 200 ms timer** before asserting its corresponding module's value. Node runs at `--test-concurrency=4`. The delay models expensive waiting inside a callback; it is intentionally synthetic and does not model CPU-heavy tests, browsers, database contention, or a production repository.

The harness changes only `src/feature000.js` from returning `1` to returning `2`. The original full suite must pass with all 64 callbacks reported before measurement. After mutation, the full suite must report exactly the expected failing case from `test/000.test.js`. TestLore then receives actual Git changes, discovers tests natively, computes its selection, and runs it. Correctness credit comes from the same observed failing-case ID in actual execution, rather than from file selection membership.

There is **one distinct planted regression**, repeated three times. This cannot establish broad fault recall. Both method orders occur, alternating which method runs first; each repetition uses a fresh fixture and clears TestLore run history before every measurement. The defaults were fixed before execution and were not tuned after seeing results.

TestLore still loads all 64 test modules during native discovery. The 1.56% count describes files whose test callbacks actually ran. It does not describe module loading. The full native baseline executes the complete authored file manifest; its runtime collection is part of execution and it does not perform an unnecessary separate discovery probe. Both methods exclude dependency installation, fixture creation, and the original green validation suite from measured latency. The original validation reports are retained separately.

## Reproduce

From a checkout with dependencies installed, using Node 22 or newer and Git:

```sh
npm ci --ignore-scripts
node scripts/workload-proof.js --output /tmp/testlore-workload-new
```

The defaults are explicit and can be varied for a new, separately named run:

```sh
node scripts/workload-proof.js --output /tmp/testlore-workload-another \
  --files 64 --workload-ms 200 --concurrency 4 --repetitions 3
```

Output directories must be new. File counts are bounded to 2–256, callback delays to 0–1,000 ms, concurrency to 1–32 and no more than the file count, and repetitions to 1–9. The harness preserves raw outputs as each execution finishes, refuses to overwrite receipts, and removes only its own temporary fixture checkout. It returns a failing status for incomplete results or observed misses.

Inspect the [measured report](../benchmarks/workload/constructed-64-200-4-2026-09-29/workload.json) and [exact portable fixture](../benchmarks/workload/constructed-64-200-4-2026-09-29/fixture.json). The report records source revision `eea603f828a0ff765a1431227b6150048649814a`, harness and dataset SHA-256 values, Node `v22.19.0`, macOS arm64, Apple M4 Pro, method order, actual callback files, timing, observed failures, misses, and links to raw native reports. Raw reports include commands, stdout/stderr, test outcomes, durations, and TestLore provenance. Local paths are sanitized. September 29 local execution is timestamped September 30 UTC.

No leaderboard, competitor, installation-cost, generation-quality, or learning claim is measured here. Constructed callback delay, independence, and concurrency determine the observed improvement. Independent real repositories with expensive callbacks need their own complete measurements before extrapolating this result.
