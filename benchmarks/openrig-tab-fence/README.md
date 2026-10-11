# OpenRig tab-indented Markdown defect pilot

This is a bounded fresh-defect repair experiment on [OpenRig at `8376d390`](https://github.com/mvschwarz/openrig/tree/8376d390140b761800430b143cc4131c1f020e42). A tab-indented fence marker incorrectly opens or closes a fenced block in both the daemon scanner and the shipped Markdown resolver. This can hide a real section or expose an example heading as an address.

The defect was discovered during manual source review. TestLore is not credited with discovery. Its existing audited Codex adapter produced two source-only proposals and an independent static review using the frozen behavioral requirements; no exact source solution was supplied. This two-reader monorepo experiment is outside the qualified one-module proactive repair-controller profile.

## Evidence before hosted native qualification

- The [independent contract](specification.md) and [scope addendum](scope-addendum.md) were frozen before generation. They derive from primary CommonMark indentation rules and existing upstream behavior, rather than implementation output.
- Sixteen named LF/CRLF, backtick/tilde, opener/closer assertions fail against the original readers and pass against the candidate readers, repeated twice. These are sixteen exposures of one defect, not sixteen independent bugs.
- The [source patch](fixed.patch) changes only the two affected scanner lines. The [candidate record](candidate.json) retains native adapter/executable identities and reported token usage. Model billing is unknown.
- The expectations are investigator-constructed; they are not untouched maintainer tests, protected model holdouts or evidence of learning improvement.
- No complete native qualification, upstream PR, maintainer acceptance, routing speed win or best-in-class result is established by these module observations or static model review.

## Genuine upstream checks

The [hosted workflow](../../.github/workflows/openrig-defect-pilot.yml) installs the unchanged original lock, executes original native checks before the failing regression, applies only the hash-bound two-reader patch, regenerates the skill digest with the pinned upstream generator, then runs the same native checks again. Package test legs preserve raw original outcomes and platform opt-ins, subject to the explicit identity limits below. The daemon leg also requires actual collection and passing outcomes for every added frozen regression.

The five declared legs cover build/lint/repository/package inventories/installed scenarios on Linux and daemon/CLI/TUI/UI package suites under the upstream macOS fixture sandbox. Native skips and todos remain unexercised; the selected Node 22 profile does not qualify every upstream runtime or platform. Commands have bounded deadlines, output, disk growth and reserve; observed descendant cleanup is best effort, not an adversarial execution sandbox.

Strict individual identity validation rejects duplicate names. Separate source-bound observations permit nonselective full-suite preservation for a finite pinned profile:

- CLI: 44 outcomes in 20 reviewed repeated raw groups, bound to twelve original test-source hashes. Five additional source-bound `process.pid` rows retain both distinct raw input sets and require exact row keys, types, ports, host, ancestors, full names, absent locations and passing status cardinalities. Every other raw group remains exact; input equivalence and individual identities for these ephemeral rows are unqualified.
- TUI: one repeated delayed-owner group of two passing outcomes, plus one source-bound `process.pid` input. Both actual PID names and values are retained independently; their input equivalence and individual identity preservation are unqualified. All other raw groups must remain exact.
- Daemon: exactly 15 repeated raw groups covering 45 outcomes observed in a successful original native run, bound to nine original test sources and two input fixtures. These include a pair of separately declared tests sharing one title, so named individual test identities remain ambiguous. A fresh complete original/fixed comparison must confirm exact raw names, ancestors, full names, location shape and status cardinalities; unknown ambiguities reject the pilot.

These observations grant no selection or omission authority. Every repeated parameter/input identity remains unqualified. The daemon's additional regression file still requires sixteen unique, exact, passing native outcomes, without allowing arbitrary added outcomes.

The original daemon suite previously exceeded a 1 GiB whole-runner growth limit after about 10.8 minutes; that stop remains inconclusive. Its complete original and fixed suites now run in distinct gated hosted jobs, each with a 17-minute runner deadline and 20-minute workflow ceiling. Only the hosted daemon allowance is 3 GiB per command, justified by the observed 1.25 GiB lower bound and about 100 GB remaining; the 1 GiB reserve, 2 MiB combined command logs, full native assertions and local 1 GiB growth bound remain intact. Raw whole-runner signed space deltas and before/after task `du` footprints are recorded separately.

The fixed job requires a successful complete baseline from the same TestLore head, run and attempt. A separate paired replay binds every declared command, finite resource/duration observation, raw log and JSON hash, pinned source/lock/runtime, original native test-source hashes, generated digest and final patch. Checkout relocation applies only to declared canonical source paths; raw titles are not normalized. Missing, truncated, drifted or unsuccessful evidence refuses acceptance.

`assessment.json` starts with `qualified:false`. The previous `e64db605` run retained green repository/UI/TUI legs, a green original daemon suite (14,400 passed of 14,413; thirteen unexercised) whose unexpected duplicate groups rejected the baseline gate, and two green CLI suites whose five distinct PID inputs rejected comparison. Those rejection records are retained; the amended finite profiles do not retroactively qualify them or the skipped daemon repair. A fresh full run is required.

Individual successful legs set `legQualified:true`; the aggregate and upstream acceptance require independent inspection of every leg, unchanged inputs and the final patch. Failures, infrastructure gaps and timeouts are retained. A green TestLore source test or evaluator control is not an upstream native result.

Reproduce on a disposable complete checkout of the pinned revision with the upstream prerequisites installed:

```sh
node --test benchmarks/openrig-tab-fence/runner-controls.test.mjs \
  benchmarks/openrig-tab-fence/daemon-pair-controls.test.mjs \
  benchmarks/openrig-tab-fence/ephemeral-profile-controls.test.mjs
node scripts/openrig-defect-pilot.js --upstream /absolute/pinned/original-openrig \
  --output /absolute/new/baseline --phase baseline --suite daemon
node scripts/openrig-defect-pilot.js --upstream /absolute/fresh/pinned/openrig \
  --output /absolute/new/fixed --phase paired-candidate --suite daemon \
  --baseline /absolute/new/baseline
node scripts/openrig-daemon-pair.js --baseline /absolute/new/baseline \
  --fixed /absolute/new/fixed --output /absolute/new/paired \
  --run-id ACTUAL_HOSTED_RUN --run-attempt ACTUAL_ATTEMPT
```

The paired daemon authority is a hosted-only profile; local executions retain smaller resource bounds and do not produce qualifying hosted baseline authority. Other package legs use `--phase candidate --suite cli|tui|ui` as appropriate; the repository leg uses `--suite repo`. Each leg needs a fresh output directory and clean original checkout. Read [the manifest](manifest.json), upstream contribution instructions and runner before execution. This command executes trusted upstream project code; it does not invoke a model or publish a PR.
