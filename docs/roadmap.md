# Roadmap

These are proposed milestones, not shipped functionality or commitments to release dates.

## 0.1 — implemented experimental foundation

- One-command initialization and a local static health report.
- Explainable JS/TS import/declaration selection with conservative fallbacks.
- Node execution and configurable Vitest/Jest argv adapters.
- Shadow execution, failed-run retention, periodic full-run policy.
- Module proposals and a bounded architect/author/reviewer worker protocol.
- Optional Codex request adapter, reviewable staged candidates.
- Regression fixtures and a transparent synthetic benchmark.

## 0.2 — establish trust on real projects

- Reconcile framework-native discovery with the selector's scope.
- Add runner-native Jest/Vitest resolver adapters and alias support.
- Compare full and proposed subset results at individual-test identity granularity.
- Retain failure history by runner/environment and prove invalidation.
- Publish pinned public-project change sets, raw outputs, overhead, and misses.
- Add GitHub Action integration after shadow evidence is reliable.

Exit criterion: reported decision recall on deterministic real regression changes, with documented uncertainty and no hidden omitted scope. Include native runner selection as a baseline.

## 0.3 — quality that is actually measured

- Ingest coverage and Stryker mutation results with revision/environment provenance.
- Measure repeated-run instability rather than guessing flakiness from sleeps.
- Introduce independent test-oracle review and generated-defect benchmarks.
- Validate candidate collection and execution in an isolated review workspace.
- Add a reviewed modularization patch workflow, including deletion/fixture changes and original-suite equivalence checks.
- Integrate Agentic QE through its actual supported interfaces, without relabeling custom workers as AQE.

Exit criterion: generated tests catch held-out regressions, not just increase coverage; all reported metrics name scope and measured evidence.

## 0.4 — browser and runtime evidence

- Explicit browser route/copy/style/template/localization dependencies.
- Per-test runtime/coverage evidence with completeness and freshness checks.
- Contract/schema and external-service invalidation policies.
- Python integration with pytest-testmon rather than recreating its engine.
- Monorepo integrations with established Nx/Bazel graphs.

## Community priorities

Useful contribution order: reproducible missed dependencies, discovery fixtures, runner adapters, realistic benchmarks, measured quality evidence. Ship a short reproducible demo, document exact limits, invite maintainers to compare native selection, and publish failures as well as wins. Virality is an outcome the project can earn, not an acceptance criterion we can guarantee.
