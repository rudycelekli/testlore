# REA: three seeded project measurements

This is a separate source candidate experiment, not the immutable npm 0.1.0 release or the original unmodified REA campaign. Candidate `b02a09e210e2b72c8ad7517d35f4eafb696a9425` ran the original domain, services and adapters projects at upstream `3dcb732da33f6ceef597506b14a4536f1c9aff96`, with a generated global fast-check seed setup. Original tracked tests, configuration and dependency lock were preserved.

[Hosted collection](https://github.com/rudycelekli/testlore/actions/runs/37798113928) completed all three preregistered seeds. **Every seed remains unqualified.**

| Seed | Trials | Full fallback | TestLore median | Native related median | Full median |
| --- | ---: | ---: | ---: | ---: | ---: |
| 104729 | 6 | 6 | 45.15 s | 2.85 s | 33.66 s |
| 130363 | 6 | 6 | 34.00 s | 2.02 s | 25.07 s |
| 155921 | 6 | 6 | 58.36 s | 3.38 s | 41.70 s |

Each seed covers one harmless comment and one blank-path source reversion, with three rotating execution orders. This is two changes, not eighteen independent changes. TestLore omitted no files and observed no missed failures; that establishes no selective safety because it ran all 261 files. Native related selected one. The same blank-path regression produces six failing parameter cases.

The five observed property-test seeds aligned between arms. This does not certify every generated input, external entropy or test-local budget. Schema-object formatted test titles still drifted, including across the independent baseline. Strict named-case preservation rejected the comparisons; names and statuses were not normalized to obtain a pass. Linux full runs retained three upstream skips.

TestLore spans include pilot discovery, planning, execution, freshness and reporting but exclude fresh outer CLI startup. Native spans include selection and execution; full spans exclude separate discovery. This is not a controlled OS-cold/warm benchmark. Runner variation is retained. The complete application, browser, build-dependent projects, generation, learning and agent hosts were not qualified by this experiment. Paid model calls: zero; hosted compute billing unknown.

## Durable replay

Each gzip contains all 123 original JSON receipts as their exact UTF-8 strings, including native named outcomes, plans, property observations, installation locks and negative verdicts. Integrity manifests bind each member, compressed bytes and the original hosted upload. Hashes detect alteration; they are not authenticated signatures or proof of upstream correctness. Original non-JSON phase logs remain in the hosted upload and are not all copied here.

```sh
node scripts/rea-seeded-replay.js benchmarks/rea-projects-20261008
```

Exit 0 means the archived collection was rechecked and complete, not that selection qualified. This command runs no upstream tests. `qualified:false` remains visible. Frozen original assessments are unchanged; reassessment distinguishes a completed rejected comparison from an interrupted process.

REA fragments and outcomes retain its MIT license in `LICENSE.rea`. TestLore is covered by the root MIT license.
