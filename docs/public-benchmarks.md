# Reproducible public-project evidence

Run from the TDDSwarm checkout with Node 22+ and Git:

```sh
node scripts/public-benchmark.js --project nanoid --output /tmp/nanoid-evidence
node scripts/public-benchmark.js --project defu --output /tmp/defu-evidence
```

The output must be new; previous evidence is never overwritten. The harness clones each repository into a disposable directory, checks out the exact [manifest](../benchmarks/public-projects.json) commit, verifies a green upstream runtime baseline, applies exact one-occurrence patches, and runs full, proposed subset and native selections. It retains raw stdout/stderr, argv, exit statuses, per-test failure identities, planning overhead and execution times. For Vitest, dependencies are installed at explicit versions and the resolved installation lockfile (with integrity hashes) is retained. The harness restores source and removes only its temporary checkout.

| Pinned project | Held-out deterministic regression | Full-suite failing identity | TDDSwarm misses | Native misses |
| --- | --- | --- | --- | --- |
| [nanoid](https://github.com/ai/nanoid/tree/bb68abcd59ebb86a849d634320726add6be54d47) | Default non-secure ID length 21 → 20 | `test/non-secure.test.js:generates URL-friendly IDs:12` | 0 | 0 |
| [defu](https://github.com/unjs/defu/tree/82632b66f5914e9946edce300e10633a3d5c0cb7) | Stop treating null as missing | `test/defu.test.ts:defu should fill in values that are null` | 0 | 0 |

Native baseline for defu is the actual supported `vitest related <file> --run` command. Node has no native dependency-selection command, so nanoid's native baseline is its full runtime suite. README-only edits are included as non-regression controls. No-failure controls have null decision recall: they cannot establish defect recall.

The initial [nanoid evidence](../benchmarks/results/nanoid-2026-09-29/summary.json) and [defu evidence](../benchmarks/results/defu-2026-09-29/summary.json) were measured September 29, 2026, on macOS ARM64 with Node 22.19.0. These are one-run measurements, with two injected defects total. The conservative selector chose all four nanoid files and both defu files. Planning plus execution often exceeded the full suite. **These results show defect detection on the listed patches, not a production speedup.** Upstream stochastic randomness and process-startup noise are uncontrolled; lint, type, size, version and packaging checks are outside the declared runtime scope.

The [rejected native-CLI attempt](../benchmarks/results/defu-native-cli-rejected-2026-09-29/summary.json) is retained transparently. Its unsupported `--related` flag produced no native identities and `valid: false`; it is excluded from the table and is a harness error, not an algorithm miss. The corrected run uses the native subcommand and completes all three baselines.

Re-run the manifest after resolver or discovery changes, retain new output directories, and publish misses as well as successes. Two small projects and two defects cannot establish general release safety or justify automatically skipping a project's full validation gates.
