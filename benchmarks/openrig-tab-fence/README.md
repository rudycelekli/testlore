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

The [hosted workflow](../../.github/workflows/openrig-defect-pilot.yml) installs the unchanged original lock, executes original native checks before the failing regression, applies only the hash-bound two-reader patch, regenerates the skill digest with the pinned upstream generator, then runs the same native checks again. Package test legs preserve named original outcomes and platform opt-ins. The daemon leg also requires actual collection and passing outcomes for every added frozen regression.

The five declared legs cover build/lint/repository/package inventories/installed scenarios on Linux and daemon/CLI/TUI/UI package suites under the upstream macOS fixture sandbox. Native skips and todos remain unexercised; the selected Node 22 profile does not qualify every upstream runtime or platform. Commands have bounded deadlines, output, disk growth and reserve; observed descendant cleanup is best effort, not an adversarial execution sandbox.

`assessment.json` starts with `qualified:false`. Individual successful legs set `legQualified:true`; the aggregate and upstream acceptance require independent inspection of every leg, unchanged inputs and the final patch. Failures, infrastructure gaps and timeouts are retained. A green TestLore source test or evaluator control is not an upstream native result.

Reproduce on a disposable complete checkout of the pinned revision with the upstream prerequisites installed:

```sh
node --test benchmarks/openrig-tab-fence/runner-controls.test.mjs
node scripts/openrig-defect-pilot.js --upstream /absolute/pinned/openrig \
  --output /absolute/new/evidence --phase candidate --suite daemon
```

Each leg needs a fresh output directory and clean original checkout. Read [the manifest](manifest.json), upstream contribution instructions and runner before execution. This command executes trusted upstream project code; it does not invoke a model or publish a PR.
