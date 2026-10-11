# Workspace context and native registration evidence

Status: Bounded implementation; application results govern qualification and promotion
Date: 2026-10-11
Related: [ADR 005](005-precise-routing-and-prospective-qualification.md), [real monorepo trial](../real-monorepo-trial.md)

## Problem and decision

The pinned e2e application has an inherited compiler configuration outside the package inventory and duplicate parameterized titles. A package-only graph cannot bind the compiler context. Native task IDs distinguish collected tasks within a run, but registration order alone cannot distinguish semantic inputs across runs. Neither problem is repaired by accepting arbitrary outside paths or inventing title suffixes.

The workspace profile separates the inventory root, native project root and native working directory. It admits one explicit in-inventory canonical root and config, binds directory identities and configuration bytes independently in parent and worker, and rechecks the effective context before and after native initialization/execution. `--root` changes native discovery; it does not change `process.cwd()`. Missing or mutated context rejects selective authority. Implicit changed roots retain conservative rejection.

The campaign separately executes the original package-cwd baseline and the explicit workspace-cwd baseline. Exact named outcome parity is an observation, not proof of configuration equivalence or dependency completeness. Protected upstream lock/config/test bytes and original installation/build remain bound. Whole command times include planning, execution and reporting; shared builds are reported separately. Native full and related timing arms remain uninstrumented; separately timed observer arms must preserve their outcomes. TestLore's complete time includes its case collection.

An explicit experimental native case reporter records public collection/result lifecycle, native IDs, projects, source identities and stable outcomes. The narrowly reviewed locator-table overlay captures actual plain parameter inputs while preserving upstream disk bytes, row values, callback and raw title. Arbitrary dynamic or opaque registrations remain incomplete. Instrumented and original native outcomes must agree before the instrumentation profile can qualify. This evidence never clears dependency uncertainty or grants omission authority.

Registration proposals remain separate from routing admission. Source-bound call observations and review labels cannot establish all shared-state consumers. Node module hook aliases and capability escapes retain global uncertainty. A domain method can affect a consumer outside its static imports; executable adversarial evidence challenges that assumption. Every existing uncertainty remains retained unless a separately qualified contract justifies a narrower scope.

## Acceptance and failure handling

- Independent CLI/API/unified checks cover actual cwd, effective root/config, project isolation, setup inputs, sibling imports and inherited compiler context.
- External, symlinked, excluded, conflicting, replaced or mutated roots/configurations cannot mint fresh authority. Failures after native execution retain partial evidence.
- Native capture rejects missing lifecycle events, changed producer/source/config inputs, ambiguous unreviewed rows, reordered or changed reviewed inputs, altered skip inventory and lost cases within retained files.
- Actual application trials retain full/native/TestLore raw results, every attempt, omission reasons and complete runtimes. Negative results remain recorded.
- `caseComparisonQualified` records complete captured identity/outcome comparison. `applicationSuccess` separately requires complete identities, nonzero justified omissions, preserved independently demonstrated failures and a complete runtime advantage against native selection in every preregistered repetition. A qualified comparison or green measurement job does not establish application success.

Default adoption remains shadow mode. No general speed, automatic learning gain, deployment safety or best-overall claim follows from this profile.
