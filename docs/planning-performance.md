# Fresh planning performance: September 30, 2026

Planning now returns diagnostic `timings.totalMs`, sequential `timings.phases`, and `timings.graph` for graph construction. Graph phases separate inventory, native discovery, configuration, source reads, analysis/resolution, declarations and warning classification. Plan phases retain provenance, change collection, service/runtime evidence, baseline reconstruction, uncertainty, history and decisions. These wall-clock values are excluded from plan and provenance fingerprints. They do not certify selection safety or savings. Runner outer spans remain authoritative for complete execution comparisons.

Fresh profiling found an unnecessary native framework startup when old changed source contained no literal imports. Baseline reconstruction now skips only such non-root resolution batches. Initial root passes—including explicitly empty roots—still load native configuration, and removed nonempty imports still obtain baseline resolution. Graph configuration discovery also uses that graph's newly collected file inventory. Every independent plan still discovers tests, reads/hashes sources, resolves configuration and validates runtime/environment/service evidence. No cross-execution graph or resolver cache was added.

The [frozen receipt](../benchmarks/planning-proof.json) contains three sequential repetitions per arm, alternating order, fresh authored fixture roots/processes, disabled analysis disk caches, cold history, unchanged implementation hashes and before/after fixture fingerprints. Actual native Vitest 5.0.2 executes independently through both TestLore's adapter and its own related selector. The same failing test case and status are preserved in both one-file scopes; native full executes all twelve files. The single planted regression has an independent equality assertion. It is one fault, not broad recall evidence.

| Work span, median | Before optimization | After optimization |
| --- | ---: | ---: |
| Static shared-closure plan | 233 ms | 201 ms |
| Native fixture: TestLore planning and execution | 1,910 ms | 1,317 ms |

For the native fixture, TestLore planning alone fell from approximately 1,364 ms to 862 ms. Empty baseline reconstruction fell from approximately 508 ms to 30 ms; phase receipts retain the exact per-trial values.

| Final native fixture method | Median work span | Observed range | Median child-process outer span |
| --- | ---: | ---: | ---: |
| TestLore | 1,317 ms | 1,270–1,346 ms | 1,696 ms |
| Vitest related, same failing one-file scope | 312 ms | 311–383 ms | 687 ms |
| Native full, twelve files | 1,438 ms | 1,417–1,491 ms | 1,810 ms |

TestLore remains approximately 4.2 times slower than native related on the same case scope. This tiny workload does not establish a production or general full-suite speed advantage. Internal work spans exclude import/setup; outer spans include fresh process/module startup and the same harness source-verification work for every arm. Fixture creation is excluded. OS/dependency caches are not flushed, and other host activity is not controlled. Dependencies are shared and identified by lockfile/version; installed dependency bytes and the Node executable bytes are not frozen by this harness. The static fixture deliberately concentrates forty diagnostic changed paths in one shared closure. Neither fixture is a representative historical corpus.

[Exploratory receipts](../benchmarks/planning-exploratory.json) preserve the initial instrumentation trial, earlier iteration summaries and an additional exploratory run. Those attempts are explicitly separate from final qualification: possible overlap with other lanes' tests and an unfrozen source correction limit their interpretation. Summaries whose raw trial payloads were not retained say so.

Focused checks cover unchanged fingerprints despite timing diagnostics, unknown inputs and missing runtime evidence retaining full fallback, runner/environment drift, source mutation during native configuration rejecting execution, empty baseline imports avoiding redundant startup, empty root passes retaining native configuration, and removed imports retaining their old dependency path. Native runner test helpers now locate installed CLIs through exported package metadata; Vitest's unexported CLI subpath had previously caused those conditional checks to disappear.

To reproduce against the instrumentation-only pre-optimization commit without installing dependencies:

```sh
planning_baseline=$(mktemp -d /tmp/testlore-planning-baseline.XXXXXX)
git archive f37f134f3c98f72948c8c3f9fb665890ce2dd78c src package.json | tar -x -C "$planning_baseline"
ln -s "$PWD/node_modules" "$planning_baseline/node_modules"
node scripts/planning-proof.js "$planning_baseline" benchmarks/planning-proof.json
```

Use the same Node executable/dependencies for both arms. The harness records runtime, lockfile/Vitest identity, complete implementation hashes, fixture configuration, selected scopes, case outcomes and all trial timings. It asserts that implementation and fixture identities remain unchanged. Run focused tests separately from timing measurements.
