# Community contributions: earn the claim

TestLore's proposed value is helping an agent find the relevant verification contract, preserve existing good tests, validate a bounded candidate, and explain every test omission. A useful upstream patch is a contribution; an additional failure caught or lower complete runtime against native tooling is a separate TestLore result. Neither proves universal correctness or a best-in-class ranking.

## Working evidence evaluator

```sh
node src/cli.js campaign --root /absolute/private/evidence --manifest campaign.json --json
```

The equivalent package API is `assessCommunityCampaignFile(root, relativeManifest)`. This command reads existing local captures, executes no project code, uploads nothing, and changes no configuration or learning/routing stores. An inconclusive regression returns exit 2. Exit 0 means the captured regression contract passed, not deployment safety, speed leadership or current maintainer approval.

The bounded version-1 manifest contains one to 32 unique attempts. Each pins public repository URL, original/fixed revisions, patch/environment digests, discovery attribution, protected oracle identity and full native inventories. SHA-256 references bind local process receipts and raw Vitest JSON. Source independence and process authenticity still require independent review: hashes alone cannot establish them. [Evaluator and schemas](../src/community-campaign.js) · [Adversarial examples](../test/community-campaign.test.js).

A qualifying regression needs a passing original native baseline, an independently demonstrated named failure, its unchanged assertion passing after the patch, and a passing complete native suite preserving original cases. Missing infrastructure, timeouts, skips, inconsistent exits/counts, lost assertions and ambiguous duplicate names cannot count as success. Real Vitest nested describe scopes are parsed separately from test files.

Routing and performance require separately captured complete native/TestLore/full runs, repeated under declared first/repeat cache protocols on both faulty and fixed states. Every full-run failure must survive TestLore selection. Native missed failures disqualify a quality-equivalent speed comparison. Timings include the whole command; cache labels do not establish OS-cold machines. A captured GitHub submission is separate from a captured merge, and neither establishes present-day maintainer satisfaction.

Constructed evaluator fixtures use `evidenceClass: "constructed-contract-test"`; they never increment public qualification or acceptance counters. Public captures remain scoped, historical and advisory. This evaluator grants no permission to omit tests, accept repairs or promote learning.

## Initial research campaign, October 10, 2026

Five public targets were inspected using pinned source, GitHub policies, current PRs and outside-contributor merge records. Trending was observed once in GitHub's weekly TypeScript list; popularity is neither contribution permission nor a correctness result.

| Target / inspected revision | Useful campaign scope | Current disposition |
| --- | --- | --- |
| [Helix Foundry](https://github.com/HelixDB/helix-foundry/tree/84899851d845d1db98f9e328634f14e0ed4ad7b7) | Vitest monorepo; in-memory store tests and genuine accepted bug histories. | Prioritize independent accepted-fix replay; new bug not established. |
| [tester-army/e2e](https://github.com/tester-army/e2e/tree/449fa93670ee4da77086cfe535af047f86f4755d) | Browser application, explicit agent contribution workflow, observed weekly Trending. | [ElementInternals accessible names](https://github.com/tester-army/e2e/issues/1020) remains an unconfirmed candidate requiring browser reproduction and fresh dedup. |
| [REA](https://github.com/morluto/rea/tree/ee46323b493994902b04824a7dc8aae2a8117903) | Maintainer-accepted regression histories and application inputs. | Fresh native/full comparison required; fast-moving head. |
| [claude-mem](https://github.com/thedotmack/claude-mem/tree/fa8ab09f06aa05f958c5225cf3756ce52a3ebb96) | Genuine Bun environment, observed weekly Trending. | Retain baseline blockers; the inspected doctor issue already had an open fix. |
| [ufo](https://github.com/unjs/ufo/tree/f06c800d0c59f2a4a1b9ba65eb6cb61a84419be6) | Small upstream-lock installation and native selector comparison. | Reject issue #394 as a patch candidate: existing query tests explicitly require its disputed behavior. |

[UFO issue #394](https://github.com/unjs/ufo/issues/394) asks array empty values to match scalar encoding, but [existing maintainer tests](https://github.com/unjs/ufo/blob/f06c800d0c59f2a4a1b9ba65eb6cb61a84419be6/test/query.test.ts) require `param=3&param=` and `param=&param=3`. Do not silently rewrite those tests. Other inspected UFO/mlly fixes already had open patches; Nano ID's inspected async declaration issue was already fixed on its current v3 branch. No duplicate submissions were made.

A manual local diagnostic initially bypassed the campaign installer's existing inherited-workspace preflight and was stopped by its disk-growth guard. The reusable physical-path preflight now supports explicit diagnostics too. A fresh temporary checkout outside inherited workspaces installed UFO's original lock with its exact pnpm 10.33.2 (12.698 seconds; 325,566,464 bytes observed whole-filesystem growth). The subsequent complete upstream `pnpm test` attempt was stopped by disk-growth guard after 13.459 seconds; native baseline remains **inconclusive**. Whole-filesystem growth is a guard observation, not causal package resource attribution. Installation time is not test-selection time. Raw attempts, logs, input pins and research snapshots remain private under `.tddswarm/community-campaign-20261010/`.

This intake established **zero new reproduced bugs, zero new upstream submissions, zero new maintainer acceptances and zero new speed wins**. It improved candidate/evidence controls; it did not complete the proposed 100-change benchmark. Earlier accepted user contributions are replay candidates, not retroactively TestLore discoveries.

## Contribution procedure

1. Pin a clean public checkout and inspect repository instructions, AI policy, active issue/PR duplicates and genuine upstream test/build requirements. Use an isolated output outside unrelated workspaces. Freeze resource/model budgets and the independent expected behavior before generation.
2. Run the original environment unmodified. Retain installation failures, full baseline, named outcomes, configuration, dependency/source identities and raw outputs. An unavailable baseline blocks a submission-quality claim.
3. Reproduce one unambiguous defect without supplying its exact solution to the repair agent. Keep maintainer tests/oracle protected. Stage the smallest source patch and regression test; validate it with the genuine full upstream checks and repeated stability runs.
4. Measure what TestLore contributed against native tooling under the same budget. Count all attempts, rejected outputs, timeouts, oversight and available token/cost records. Preserve losses and uncertainty; retrieval is not learning improvement.
5. Submit a focused PR explaining the concrete defect, before/after behavior and actual checks, complying with maintainer policies and disclosing agent assistance where required. No marketing pitch or duplicate issue campaign. Leave upstream merge/release decisions to maintainers.
6. Capture review/merge outcomes separately and rerun evidence after meaningful source/configuration changes. Only independently reproduced, repeatable additional value supports stronger public claims.

[Gradia ecosystem fit and executed verifier preflight](gradia-ecosystem-review.md) · [Existing qualification results and limitations](qualification-campaign.md) · [Original-lock public benchmark accounting](portable-public-campaign.md).
