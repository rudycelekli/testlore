# Fresh planning performance

Planning now returns diagnostic `timings.totalMs`, sequential `timings.phases`, and `timings.graph` for graph construction. Graph phases separate inventory, native discovery, configuration, source reads, analysis/resolution, declarations and warning classification. Plan phases retain provenance, change collection, service/runtime evidence, baseline reconstruction, uncertainty, history and decisions. These wall-clock values are excluded from plan and provenance fingerprints. They do not certify selection safety or savings. Runner outer spans remain authoritative for complete execution comparisons.

Fresh profiling found an unnecessary native framework startup when old changed source contained no literal imports. Baseline reconstruction now skips only such non-root resolution batches. Initial root passes—including explicitly empty roots—still load native configuration, and removed nonempty imports still obtain baseline resolution. Graph configuration discovery also uses that graph's newly collected file inventory. Every independent plan still discovers tests, reads/hashes sources, resolves configuration and validates runtime/environment/service evidence. No cross-execution graph or resolver cache was added.

The [strict frozen receipt](../benchmarks/planning-proof-v2.json) contains three sequential repetitions per arm, alternating order, fresh authored fixture roots/processes, disabled analysis disk caches, cold history, unchanged implementation hashes and before/after fixture fingerprints. Actual native Vitest 5.0.2 executes independently through both TestLore's adapter and its own related selector. The same named failing `leaf 0` case and status are preserved in both one-file scopes; native full must report twelve distinct named `leaf 0` through `leaf 11` cases and exactly the planted `leaf 0` failure. File-load failures, missing cases, duplicate identities and wrong failing cases reject qualification. The receipt records 45 native case observations across all arms/repetitions. The single planted regression has an independent equality assertion. It is one fault, not broad recall evidence.

| Work span, median | Before optimization | After optimization |
| --- | ---: | ---: |
| Static shared-closure plan | 236 ms | 201 ms |
| Native fixture: TestLore planning and execution | 1,747 ms | 1,277 ms |

For the native fixture, TestLore planning alone fell from approximately 1,281 ms to 830 ms. Empty baseline reconstruction fell from approximately 410 ms to 31 ms; phase receipts retain the exact per-trial values.

| Final native fixture method | Median work span | Observed range | Median child-process outer span |
| --- | ---: | ---: | ---: |
| TestLore | 1,277 ms | 1,275–1,296 ms | 1,657 ms |
| Vitest related, same failing one-file scope | 300 ms | 296–314 ms | 679 ms |
| Native full, twelve files | 1,380 ms | 1,342–1,397 ms | 1,751 ms |

TestLore remains approximately 4.3 times slower than native related on the same case scope. This tiny workload does not establish a production or general full-suite speed advantage. Internal work spans exclude import/setup; outer spans include fresh process/module startup and the same harness source-verification work for every arm. Fixture creation is excluded. OS/dependency caches are not flushed, and other host activity is not controlled. Dependencies are shared and identified by lockfile/version; installed dependency bytes and the Node executable bytes are not frozen by this harness. The static fixture deliberately concentrates forty diagnostic changed paths in one shared closure. Neither fixture is a representative historical corpus.

The [original v1 receipt](../benchmarks/planning-proof.json) remains immutable. It predates the strict named full-case oracle and output/failure guards and does not substitute for v2 qualification. The harness now reserves new output before creating fixtures, refuses existing output, and seals failed/partial attempts with `complete:false`, their diagnostics and partial summaries. TestLore runs explicitly request selective execution.

[Exploratory receipts](../benchmarks/planning-exploratory.json) preserve the initial instrumentation trial, earlier iteration summaries and an additional exploratory run. Those attempts are explicitly separate from final qualification: possible overlap with other lanes' tests and an unfrozen source correction limit their interpretation. Summaries whose raw trial payloads were not retained say so.

Focused checks cover unchanged fingerprints despite timing diagnostics, unknown inputs and missing runtime evidence retaining full fallback, runner/environment drift, source mutation during native configuration rejecting execution, empty baseline imports avoiding redundant startup, empty root passes retaining native configuration, and removed imports retaining their old dependency path. Native runner test helpers now locate installed CLIs through exported package metadata; Vitest's unexported CLI subpath had previously caused those conditional checks to disappear.

To reproduce against the instrumentation-only pre-optimization commit without installing dependencies:

```sh
planning_baseline=$(mktemp -d /tmp/testlore-planning-baseline.XXXXXX)
git archive f37f134f3c98f72948c8c3f9fb665890ce2dd78c src package.json | tar -x -C "$planning_baseline"
ln -s "$PWD/node_modules" "$planning_baseline/node_modules"
node scripts/planning-proof.js "$planning_baseline" .tddswarm/planning-reproduction.json
```

Choose a new output path for each reproduction; existing paths are rejected. Use the same Node executable/dependencies for both arms. The harness records runtime, lockfile/Vitest identity, complete implementation hashes, fixture configuration, selected scopes, case outcomes and all trial timings. It asserts that implementation and fixture identities remain unchanged. Run focused tests separately from timing measurements.

## Shared native planning: October 6, 2026

The supported Vitest path now creates one fresh native Vitest context for both file discovery and transitive plugin resolution. It uses the selected absolute CLI installation's exported `vitest/node` API, parses the admitted CLI options, collects the framework's relevant specifications and resolves imports through that context's Vite server. This removes the separate collection CLI and config/server setup. The API paths were exercised on installed Vitest 4.1.11 and 5.0.2; v4.1 and v5 have separate factory signatures. Bare PATH executables, other API versions, positional filters and unsupported CLI contexts retain the previous path. Multiple projects, browser configurations, custom environments and shared isolation cannot acquire dependency authority from a failed shared context. Failed attempts remain visible in `discovery.sharedContextAttempt`.

Native configuration still executes on every independent plan. Empty root requests still load it. Removed nonempty baseline imports still resolve in a separate fresh pass. Imported configuration and setup inputs remain global; configuration mutation still causes the runner's before/after provenance check to reject execution. Alias or collection changes are resolved again even when pure source summaries hit disk cache. No executable configuration, native discovery, resolved dependency edge, environment, service result or routing decision is cached. `plan.analysisCache` reports existing pure-summary cache diagnostics separately from routing/provenance fingerprints.

The shared work appears in the graph's `discovery` timing phase; that phase now includes native transitive resolution for the supported path. Compare complete work and process spans rather than interpreting the smaller later analysis phase as an isolated resolution speedup.

The [first attempted proof](../benchmarks/planning-shared-native-v1-failed.json) encountered disk exhaustion while sealing its receipt. The old harness truncated the reserved output before the final write failed. No trial count or timing is recoverable from that attempt; its empty raw artifact and stderr remain local. This failure is retained and excluded from performance claims. The updated harness writes and flushes an append-only attempt journal, preserves partial writes and atomically replaces its reserved receipt only after writing the entire final report. A fault-injection test verifies that `ENOSPC` leaves the reserved receipt and partial bytes intact. New attempts always use new output names.

The expanded harness accepts `cacheStates: ['disabled', 'cold', 'warm']`. Every measured worker uses a fresh process and authored fixture. Disabled and cold caches start empty; warm TestLore measurements follow a separately recorded planning worker that populates only source summaries. Warmup time is recorded separately, not subtracted from a first-use claim. Native comparison engines do not consume TestLore's cache. OS caches, host contention and installed dependency/runtime bytes remain uncontrolled. None of these fixtures establishes representative application speed or failure recall.

The [replacement v2 receipt](../benchmarks/planning-shared-native-v2.json) and its [attempt journal](../benchmarks/planning-shared-native-v2.json.attempts.jsonl) record 54 measured workers, 12 separate warmup workers and 135 strict native case observations. Their public copies replace absolute Node and candidate-repository path prefixes with explicit placeholders. `publicNormalization` binds both immutable private originals and the normalization script by SHA-256. All timing values, failures, case identities, fingerprints, source hashes and ordering are preserved; normalized runner paths are not executable commands. Every native selective arm preserved the same independently demonstrated failing case, while the full oracle retained all twelve named cases. These are repeated observations of one authored defect, not 135 independent defects.

| Cache condition | Previous TestLore work / outer median | Shared TestLore work / outer median | Native related work / outer median | Native full work / outer median |
| --- | ---: | ---: | ---: | ---: |
| Disabled | 3,104 / 3,716 ms | 1,248 / 1,629 ms | 338 / 871 ms | 1,499 / 1,898 ms |
| Cold enabled | 3,555 / 4,283 ms | 1,447 / 2,094 ms | 706 / 1,266 ms | 2,804 / 3,586 ms |
| Warm enabled | 2,369 / 3,108 ms | 1,396 / 1,835 ms | 389 / 858 ms | 1,644 / 2,032 ms |

The structural native startup reduction is verified by configuration load counts. These timing medians cannot isolate its performance effect: the host was contended and experienced disk pressure during the campaign. The unchanged static traversal's warm median reversed from 246 ms to 471 ms; disabled native candidate spans ranged from 1,203 to 5,355 ms. Native related remained faster than TestLore in every condition's median. Treat these measurements as a retained local comparison and an operational warning, not an attributable speedup, evidence that warming helps, or an application performance claim. Representative quiet runs remain required.

```sh
node --input-type=module -e "import {runPlanningProof} from './scripts/planning-proof.js'; const result = runPlanningProof({baseline:'.tddswarm/planning-baseline',output:'.tddswarm/shared-planning-new.json',cacheStates:['disabled','cold','warm'],baselineDescription:'Describe the exact baseline source revision and preparation.'}); if (!result.complete) process.exitCode = 1;"
```

Prepare `.tddswarm/planning-baseline` from an exact source revision as above and share the already installed dependency tree. Keep its source fixed through the campaign. Successful output has a companion `.attempts.jsonl` journal; unsuccessful final sealing can also leave `.partial` bytes. The reserved `complete:false` receipt and journal do not establish successful qualification.
