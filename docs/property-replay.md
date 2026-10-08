# Controlled property-test comparisons

A randomized property suite can use different inputs on consecutive runs. Equal case counts are insufficient for comparing a full suite with selected tests. REA's original `@fast-check/vitest` 0.5.0 reports its effective seed in each property name, so the original uncoordinated campaign correctly remains rejected. Its archived names and outcomes are unchanged.

The optional REA replay profile adds a setup file through a generated Vitest configuration wrapper in disposable checkouts. It uses the documented [`configureGlobal` and `readConfigureGlobal` APIs](https://fast-check.dev/docs/configuration/global-settings/) to set one preregistered seed while preserving existing run budgets and other defaults. Original upstream tests, configuration, and lockfile bytes remain unchanged. This is an **explicit controlled configuration profile**, and must be reported separately from unmodified configuration.

The three preregistered seeds are `104729`, `130363`, and `155921`. Each campaign uses one seed for its independent baseline and all full, TestLore, and native-selector arms, with three repetitions and rotating arm order. Complete all three campaigns and publish every result. A single campaign never establishes qualification of the three-seed matrix.

The independent assessor requires the five expected upstream property cases, compares exact raw `[file, name, seed]` observations for every executed file, and retains normal case/status and failure-preservation checks. A missing seed, an explicit per-test seed override, or a different property under the same seed rejects alignment. Native selection may omit all property files; it must retain the exact observations of every property file it does execute. No seed suffix or case identity is stripped or rewritten.

Observed seed agreement does not prove that arbitrary code used identical inputs: property generators can consult external entropy, time, or state. The profile therefore reports `inputReplayCertified:false`. It is comparison evidence for the stated source and configuration, not a proof of all possible dependencies, universal safety, learning improvement, or superiority to another tool.

For a sealed candidate archive whose package records the source `gitHead`, run one campaign with:

```sh
node scripts/rea-public-pilot.js \
  --directory /absolute/new-workspace \
  --output /absolute/new-evidence \
  --candidate-archive /absolute/testlore-0.1.0.tgz \
  --candidate-sha256 ARCHIVE_SHA256 \
  --candidate-revision SOURCE_GIT_SHA \
  --candidate-version 0.1.0 \
  --property-seed 104729 \
  --unified-native
```

Repeat with fresh directories for the other two seeds. The archive SHA256 and installed package identity are checked; candidate results explicitly identify a source candidate rather than the npm release. The campaign requires supported Node 22.19.0, a 2 GiB disk reserve, bounded native execution, and a new evidence directory. Its exit code is `0` for qualification of that campaign, `3` for a completed negative observation, and `1` for incomplete collection. A successful evidence-collection job is not automatically a qualified result.
