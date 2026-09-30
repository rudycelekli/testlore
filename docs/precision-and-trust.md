# Precision and trust acceptance contract

This milestone makes correctness, cost and limits independently reviewable.

| Dimension | Required evidence | Current scope |
| --- | --- | --- |
| Routing | Preserve unknown consumers, global fallback and removed edges; current whole native inventory and named-case identities agree | Node/Jest/Vitest/Playwright test files; custom loader/environment uncertainty stays conservative |
| Speed | Discovery + planning + execution + provenance/history/report retention; independently measured full and native selectors | Local isolated application pilots, three rotating execution arms; results may be negative |
| Browser | Genuine native route/network/JS/CSS evidence, explicit URL/server authority and bounded local source maps | Chromium observations and review-only patches; unexercised paths remain uncertain |
| Test quality | Independently labeled bugs, preserved original passing cases, repeated stable runs, genuine mutants and elapsed cost | Operator-supplied contracts and defects, no universal quality score |
| Learning | Meaningful current-contract relevance, separate unseen specifications, identical bounded worker arms | Advisory memory; absent applicable lessons and inconclusive results cannot establish improvement |
| Adoption | New shadow defaults, useful setup without AI, precise PR/job explanations, actual archive and registry identity | GitHub installation works; npm publication needs maintainer access and protected trusted publishing |

Reproduce `node scripts/native-selection-proof.js`, `node scripts/browser-mapping-proof.js`, and `node scripts/incremental-quality-proof.js`. Browser qualification requires the installed project SDK and Chromium; these scripts do not download tools. The optional installed Chrome channel is recorded explicitly. Run `testlore pilot` for private applications; do not publish their raw source, case IDs, paths or logs.

See [precise routing](precise-routing.md), [browser evidence](browser-mappings.md), [test effectiveness](quality-effectiveness.md), [pilots](pilots.md), [learning evaluation](learning-evaluation.md), and [release gates](launch.md).

## Current measured results

Three isolated application scopes contained 1,147 baseline cases across 128 files. Eighteen rotated trials preserved selected-file named cases and matched all 18 observed planted failing-case results, with zero observed misses; native selectors also caught those imported-source regressions. Timing is mixed: native Vitest related selection was faster, and one application’s small apparent gain over full execution is within a noisy six-trial condition. No robust general application speed claim is established. [Fixed privacy-preserving aggregate](../benchmarks/precision-pilot-aggregate.json); raw source/paths/case logs stay local.

A fixed 64-file, 200 ms callback-delay workload was rerun with current routing. Full native median: 4,226 ms; complete TestLore median: 1,726 ms (59.2% less). Both caught the same single planted leaf fault in all three repetitions. This constructed workload supports a conditional speed gain, not a production forecast. [Exact fixture and raw runs](../benchmarks/workload/precision-64-200-4/workload.json).

The new live untouched-contract comparison detected 9/12 defects in both arms, with one timeout each. No learning gain is established. [Raw specification-level comparison](../benchmarks/learning/untouched-contracts/README.md).
