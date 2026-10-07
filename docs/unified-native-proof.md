The four-arm CLI harness measures **native full, native related, legacy TestLore selective and opt-in unified TestLore selective**. It is a bounded proof harness, not a completed performance result. Its tests exercise assertion-preservation guards and actual process output/deadline failures; no sustained campaign is implied by those tests.

```sh
node scripts/unified-native-proof.js --output .tddswarm/unified-cli-NEW
```

For an optional real public fix, first prepare a sealed upstream input through the public-corpus controller, then run:

```sh
node scripts/unified-native-proof.js \
  --output .tddswarm/unified-cli-public-NEW \
  --selection benchmarks/public-corpus/preregistration-20261006.json \
  --prepared .tddswarm/NEW_PUBLIC_PREPARATION.json
```

Two constructed workloads retain independent assertions: a static-import leaf defect across twelve files and a runtime asset defect with an explicitly declared mapping. The optional public workload restores exact prior source bytes against unchanged maintainer tests in an exact pinned checkout. The fixed native baseline must pass before any inverse is admitted. A repeated full run must retain the baseline's case identities; faults cannot qualify through module-load errors, changed test identity or skipped assertions.

Each arm receives its own isolated source copy, identical Node/native worker flags and identical empty prior history. The first invocation has an empty pure analysis cache; the second retains that cache and resets history. Every invocation starts a fresh native process/context. Order rotates across repeats. Baseline/discovery and shared OS, dependency and native framework caches remain uncontrolled: these are analysis-cache cold/repeat observations, **not fully cold machine measurements**.

The outer monotonic span starts before spawning Node and ends after child closure. It includes CLI startup, planning, execution, child source/history/report sealing and native context closure. Parent-side parsing, fixture preparation and controller bookkeeping are excluded from that span and retained separately through total controller elapsed time. Native full/related reports also seal JSON before their process exits.

Every process retains its argv, exit/signal, bounded stdout/stderr, native JSON or TestLore sealed report, normalized cases, outer time and append-only attempt accounting. Output paths must be new. Fixed source inputs, source/controller modules, Node binary and actual used native framework metadata/CLI bytes are checked; drift or missing sealed receipts rejects qualification. Native imported dependencies and arbitrary detached test subprocesses are not fully runtime-attested. Controlled native contexts have a 30-second internal budget; the default outer budget is 35 seconds, with a 15-minute total controller budget. A POSIX process group is used for direct CLI deadline/output-budget cleanup. Failed/partial workspaces and receipts remain available for inspection; the controller performs no installs, provider calls or publication.

A selector can emit a complete zero-test report while missing the independently demonstrated runtime-asset fault. The harness records this miss and excludes that native timing from quality-equivalent speed comparisons. Legacy and unified TestLore must preserve every full-run failure and all cases/statuses in their selected files. The unified arm must actually report one fresh context; fallback to legacy execution cannot count as unified qualification. Repeated outcomes must be stable before a scenario qualifies.

Raw outputs stay private. `exportUnifiedCLIProof(report)` exports fixed counts, hashes, framework identities and per-arm spans while excluding source paths, commands, case names and logs. It retains incomplete attempt accounting. A passing authored workload or one real public fix does not complete the 100-change/10-project target, establish a general speed advantage, or qualify browser and monorepo applications.
