# ADR-002: Roadmap implementation contract

Status: Accepted; implementation in progress. Date: September 29, 2026.

Runner discovery, execution results, provenance, impact evidence, quality evidence, and reviewed patches are separate contracts. An empty discovery result cannot certify a suite. Normalized test identities use file plus case name; completeness is explicit. Shadow execution compares failing full-suite identities against the proposed file set and reports omitted failures. Failure history is partitioned by executable/config/environment identity.

Evidence binds results to source hashes, a Git revision where available, runner identity, and environment. Runtime selection requires a complete observation for every discovered test file and rejects stale or incomplete reports. External inputs and browser assets are explicit declarations. Observed dependencies supplement static imports rather than removing known static relationships.

Coverage and mutation evidence report real counters and unavailable dimensions. Repeated executions measure observed instability, not a claim of permanent reliability. Independent requirements/reviews and held-out defects remain distinct from test execution. Candidate validation uses a disposable workspace, records baseline and candidate results, validates additions/deletions/fixtures, and only produces an applicable patch after integrity, drift, and review checks.

Adapters reuse actual Jest/Vitest discovery and result formats, pytest-testmon, Nx affected commands, Bazel query, and Agentic QE CLI/MCP interfaces. An unavailable executable produces an explicit diagnostic, never simulated external results. Benchmark manifests pin public source commits and preserve patches, exact commands, raw results, native selection baselines, and overhead.

No roadmap item is marked complete merely because an interface exists: focused regression verification and declared integration verification levels must accompany it.
