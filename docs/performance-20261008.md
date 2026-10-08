# Complete CLI performance: October 8

The clean `cdfa5b82755456ceff4f9921695ee66457d69108` campaign completed **36/36**
executions: three workloads, three repeats and independent full/native-related/
legacy/unified CLI arms. Every TestLore arm preserved the independently
established failure and exact selected case outcomes. Native related missed the
asset failure in all three repeats; its shorter duration is not quality-equivalent.

[All results and phase spans](../benchmarks/qualification-20261008/whole-cli-cdfa.json)
retain cold-analysis-cache first invocations, warm-analysis-cache repeats, every
loss and the observed controller time of 65.19 seconds. Other qualification
workers paused for the campaign; unrelated machine activity was not instrumented.
The OS and native framework caches were not reset. Complete outer spans include
CLI imports, planning, execution, report/history sealing and process shutdown.

Milliseconds; columns retain the first invocation and both repeats:

| Workload | Full Vitest | Native related | TestLore legacy | TestLore unified |
| --- | --- | --- | --- | --- |
| Static, 12 files → 1 | 1620 / 1269 / 1374 | 354 / 364 / 355 | 1428 / 1525 / 1274 | 1437 / 1140 / 1030 |
| Declared asset, 2 files → 1 | 471 / 671 / 591 | 260 / 256 / 343 | 1130 / 1121 / 1785 | 934 / 1656 / 1507 |
| Projected ufo fault, 13 files → 12 | 1665 / 1662 / 1615 | 1471 / 1442 / 1797 | 2747 / 2693 / 2609 | 2266 / 2233 / 2271 |

Unified remains slower than native related for the static and ufo workloads, and
slower than full execution for the asset and ufo workloads. The asset warm
outliers remain published. On the projected ufo workload it is consistently
faster than legacy TestLore in these paired repeats, but does not establish a
causal speed improvement over a previous code revision or a general speed win.

The ufo workload reuses the prior selected upstream fix and its **projected
Vitest 5.0.2 / Vite 8.3.1 environment**. It is not the original upstream lock
installation, which uses Vitest 4.1.5 / Vite 8.0.10. It adds no new unique public
benchmark change. Full execution records 480 cases and related/selected execution
465; the known fault is preserved in all three scopes.

## Remaining overhead

The first projected-ufo unified report separates approximately 148 ms of request
preparation, 214 ms of worker startup/planning, 297 ms of parent planning/protocol
wait and 1,285 ms of native tests/reporting. Worker discovery/source expansion
is 10 ms, native import resolution 11 ms, and runner initialization less than
1 ms. Twenty-two source observations matched fresh bytes and the bound engine;
none required parsing again. Worker timing begins after static imports, leaving
approximately 41 ms inside the parent startup span outside worker instrumentation.

The whole CLI took 2,266 ms; its internal reported total was 2,096 ms, with the
remaining 170 ms covering work outside that timer, including CLI imports and
final sealing/shutdown. Diagnostic spans overlap and are not an additive cost
breakdown. All repeats and planning subphases are in the result artifact.
The next optimization needs paired evidence for parent/Git/boundary work rather
than removing fresh checks or assuming duplicate expensive test collection.

## Original Vitest 4.1.5 rejection

Exact primary source packages were inspected without running their code:
[Vite 8.0.10](https://registry.npmjs.org/vite/-/vite-8.0.10.tgz) and
[Rolldown 1.0.0-rc.17](https://registry.npmjs.org/rolldown/-/rolldown-1.0.0-rc.17.tgz).
Vite's default plugin sequence calls `viteWasmFallbackPlugin()`. Rolldown creates
`BuiltinPlugin("builtin:vite-wasm-fallback")` and wraps callable native hooks.
This explains the hosted rejection but does not prove a live object's origin,
configuration parity or failure preservation. Fields and hooks are mutable;
a name or class shape alone is insufficient qualification.

The rejection is preserved. No plugin was admitted based on its name. A future
original-runtime qualification must bind the actual installed factory and live
hook/option origin, reject forged/replaced objects, and demonstrate independent
full/subset outcomes and configuration/source drift behavior on that exact
installation. Original-runtime timings remain separate from this projection.
