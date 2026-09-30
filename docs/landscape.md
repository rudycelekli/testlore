# Testing intelligence landscape and TestLore opportunity

Research date: September 29, 2026. Sources are primary documentation, project repositories, and an original engineering report. This is a targeted landscape review, not an exhaustive market census. Product descriptions below report documented capabilities; they are not independent performance certifications. No competing service was benchmarked during this review.

## The idea exists; the opportunity is the integration

Test generation, test-quality assessment, modular suites, and selective execution already exist. “AI agents for tests” or “run only impacted tests” would not be defensible novelty claims. The stronger opportunity is an accessible open-source layer that connects **test quality → explicit dependencies → explainable selection → measured outcomes**, without requiring a hosted account for local analysis and routing.

The user's reference, Agentic QE, already describes test generation, coverage analysis, quality assessment, mutation testing, and change-impact tools. It is a potential integration partner and architectural reference, not a project that lacks testing functionality. Its README claims are not proof of results on arbitrary repositories. [Agentic QE repository](https://github.com/proffesor-for-testing/agentic-qe)

## Existing approaches

| Project / product | What the primary source establishes | Constraint or implication for TestLore |
| --- | --- | --- |
| **pytest-testmon** | A pytest plugin records test/code dependencies through Coverage.py and uses code changes to select tests. It needs an initial full run and reruns previously failed tests. Its documentation explicitly excludes static assets and external services from tracked dependencies. | Coverage-based selective execution is established open source. Browser assets, contracts, and explicit non-code dependencies are useful areas for integration. [Documentation](https://www.testmon.org/), [dependency mechanism](https://www.testmon.org/blog/determining-affected-tests/) |
| **Jest** | `--findRelatedTests` takes changed source files; `--onlyChanged` uses Git/Hg and requires a static dependency graph, without dynamic requires. | A JavaScript adapter should reuse runner capabilities where appropriate; wrapping this flag alone is weak differentiation. [Jest CLI](https://jestjs.io/docs/30.0/cli) |
| **Vitest** | `vitest related` selects tests related to source files. Static imports, including literal `import('./index.js')`, are supported; variable dynamic imports such as `import(filepath)` are not. | Unknown dynamic dependencies need an explicit conservative policy. [Vitest CLI](https://vitest.dev/guide/cli.html) |
| **Nx** | `nx affected -t test` uses Git and a project graph to identify changed projects and their dependents. Lockfile changes mark all projects affected by default; configurable dependency analysis can narrow this. | Project-level selection and safe invalidation are existing practice. Finer test-level evidence can complement Nx. [Nx affected](https://nx.dev/docs/features/ci-features/affected) |
| **Bazel** | Reverse-dependency queries identify targets depending on another target. Test suites organize test targets and tags for different policies. | Explicit build graphs and modular suites are mature alternatives. Adopt their discipline without requiring every user to migrate build systems. [Query guide](https://bazel.build/query/quickstart), [test suites](https://bazel.build/reference/be/general#test_suite) |
| **Datadog Test Impact Analysis** | Coverage is cross-referenced with changed files to omit unaffected tests. Users can configure tracked files that trigger full runs and branches on which selection is disabled. The feature was formerly called Intelligent Test Runner. | Coverage selection and full-run escape hatches are commercial capabilities already. A transparent local implementation is a different adoption model, not a new algorithm. [TIA](https://docs.datadoghq.com/tests/test_impact_analysis/), [configuration](https://docs.datadoghq.com/getting_started/test_impact_analysis/) |
| **Launchable** | Predictive selection learns from test results and changes, including historical correlations, test characteristics, path similarity, and change characteristics. It prioritizes likely failures within an optimization target. Its docs recommend later full defensive runs. | Statistical failure prediction differs from evidence that a dependency was unaffected. Do not display a model probability as a safety guarantee. [Selection mechanism](https://help.launchableinc.com/features/predictive-test-selection/how-launchable-selects-tests/), [defensive runs](https://help.launchableinc.com/features/predictive-test-selection/use-cases-for-predictive-test-selection/) |
| **Meta predictive selection** | A 2018 engineering report describes a learned model over historical changes and outcomes. Meta reported catching over 99.9% of faulty changes while executing about one third of transitively dependent tests in its environment. | Industrial proof that the problem is real. The denominator is transitively dependent tests, not the entire repository suite. These historical, environment-specific results are not TestLore targets achieved today. [Original report](https://engineering.fb.com/2018/11/21/developer-tools/predictive-test-selection/) |
| **Qodo Cover** | The open-source README describes generation validated through a supplied test command and coverage report. CLI source exposes repeated runs, diff coverage, and strict coverage options. | AI-generated tests plus execution/coverage feedback already exist. Independent behavior oracles and mutation evidence can improve acceptance criteria. [README](https://github.com/qodo-ai/qodo-cover/blob/main/README.md), [CLI source inspected](https://github.com/qodo-ai/qodo-cover/blob/main/cover_agent/main.py) |
| **Stryker** | Mutation testing checks whether tests detect deliberately changed behavior. Incremental mode reuses prior mutant results, with documented limits for changes outside mutated/test files and runner metadata support. | Measure assertion effectiveness and reuse mutation tooling rather than inventing a score from test counts. Incremental quality assessment itself is established. [Mutation metrics](https://stryker-mutator.io/docs/mutation-testing-elements/mutant-states-and-metrics/), [incremental mode](https://stryker-mutator.io/docs/stryker-js/incremental/) |
| **Agentic QE** | The README describes specialized agents, generation, coverage gaps, quality gates, mutation/testing skills, and a `code impact` command. | Agent orchestration is not unique. Differentiate through narrow scope, installation friction, transparent execution evidence, and reproducible comparisons. [Repository](https://github.com/proffesor-for-testing/agentic-qe) |

Verification level: the Qodo CLI source was read; other entries were verified against their primary documentation or README. We did not audit those implementations, validate their advertised quality, verify hosted plans, or compare their speed. No claim is made that this list contains every competitor.

## A concrete initial wedge

Position TestLore as **“Know why each test runs. Improve the tests that matter.”** Begin with a small deterministic CLI, a documented evidence format, and adapters for a deliberately narrow set of runners. A one-command bootstrap should produce a useful report without API keys. The command is an onboarding promise; it does not imply universal zero-configuration correctness.

The following are product recommendations, not claims that this repository already implements them:

1. **Explain every choice.** Emit machine-readable and human-readable plans containing changed files, selected test identities, dependency paths, policy reasons, unknown dependencies, and evidence provenance. Distinguish observed coverage, static imports, declared dependencies, and heuristics.
2. **Run more when uncertain.** Missing/stale/corrupt evidence, changed runner configuration, lockfiles, setup hooks, shared fixtures, unresolved imports, or unknown changed runtime inputs should expand selection or request a full run. Explicit documentation-only exclusions should be configurable and reviewable.
3. **Treat browser inputs as dependencies.** Templates, copy, CSS, images, localization, route metadata, schemas, and fixtures need declared or observed links to tests. A landing-page paragraph change may affect rendering, accessibility, snapshots, SEO, localization, or content behavior. It should not automatically bypass all tests merely because it looks textual.
4. **Keep local routing independent of LLMs.** Use agents to propose tests, review assertions, and identify missing dependency declarations. An LLM's opinion should not remove deterministically selected tests. Generation should be optional, provider-neutral, budgeted, and produce reviewable diffs.
5. **Make grades honest.** Report distinct dimensions: execution results, covered behavior, mutation results, repeated-run stability, isolation, cost, and critical-path evidence. Label unavailable dimensions “not measured.” Static smell detection is a triage signal, not a complete measure of test quality.
6. **Make modularization preserve behavior.** Suggest feature ownership, fixtures, contracts, test tags, and boundaries. Validate a split suite against its original behavior and retain integration/end-to-end checks for cross-module interactions. Fewer files or shorter tests alone do not establish improvement.

An import graph with static parsing is a practical starting point, but its evidence boundary must be explicit. Dynamic loading, filesystem reads, ambient environment, generated code, aliases, runtime hooks, and services can invalidate naive “unrelated” conclusions. A fallback full run is a valid result, not a failure of the product.

## Defining “world class” through acceptance evidence

For generated tests, require compilation/collection, execution, and meaningful assertions. Derive expected behavior from requirements, public contracts, existing independent examples, and invariants; merely copying current implementation output risks cementing bugs. A proposed swarm should have separate author, adversarial reviewer, and execution verifier roles. More agents alone do not establish better tests.

Use mutation testing as one signal rather than a universal truth. Stryker documents equivalent mutants that cannot be definitively classified automatically, so raw mutation scores need scope and interpretation. [Equivalent mutants](https://stryker-mutator.io/docs/mutation-testing-elements/equivalent-mutants/)

Require users to see what was actually measured: runner version, repository revision, environment, valid mutant count, excluded scope, repeat count, timeouts, and results. Never call a suite deployment-safe based only on a static grade or an AI narrative.

## Benchmark before marketing savings

Publish a reproducible benchmark with pinned public repository commits, preserved change sets, exact commands, raw results, and hardware/runtime details. Compare against the full suite and each runner's existing selection mode. Include small fixtures for explanation, but separate these from real-project evaluations.

| Measure | Definition / evaluation |
| --- | --- |
| Faulty-change recall | Changes where the selected suite detects at least one deterministic regression divided by changes where the full suite detects one. A full suite that detects no bug gives no recall ground truth. |
| Failing-test recall | Deterministic failing tests included by selection divided by deterministic failing tests in the full suite. Report separately from faulty-change recall. |
| Selection reduction | `1 - selected tests / total tests`; also report actual runner granularity and whether cases, files, or suites were counted. |
| Wall-clock improvement | Full-run wall time compared with selection plus execution, including collection/index overhead. Test-count reduction alone does not prove speedup. |
| Setup and evidence cost | Cold bootstrap time, trace/instrumentation overhead, disk usage, and index-refresh time. |
| Uncertainty behavior | Frequency and correctness of full-run fallbacks for aliases, computed imports, config/fixture changes, assets, deletes/renames, new tests, and missing evidence. |
| Test quality improvement | Added deterministic defects caught, valid-mutant results, independent assertion review, and flake/repeated-run outcomes; report agent tokens and monetary cost alongside benefit. |

Use chronological training/evaluation splits for learned strategies to prevent historical leakage. For flaky outcomes, reproduce and label instability instead of counting arbitrary failures as regression detection. Include adversarial changes and real bug fixes; mutation-only evidence cannot stand in for field results.

Initially operate in observation mode: produce a selection plan while still running the full suite, compare outcomes, and retain scheduled or policy-required full runs after selective execution is enabled. Launchable's defensive-run recommendation and Datadog's branch exclusions provide precedents. Neither an observation run nor a full suite proves the absence of untested defects.

## Adoption and community strategy

Start with a verifiable demonstration: a content change, a shared-library change, and an unknown dependency change. Show the plan, chosen tests, fallback behavior, and total elapsed time. Label synthetic fixtures clearly. The useful story is a small change producing an understandable decision, not an unsupported “1,000 tests skipped safely” claim.

Invite maintainers to contribute runner adapters and dependency evidence, offer a clear migration path that keeps existing tests, and publish benchmark improvements with misses and overhead included. Interoperate with pytest-testmon, native Jest/Vitest selection, Nx, coverage providers, Stryker, and agent frameworks where their capabilities fit. Prefer integration over rebuilding mature engines.

Track first useful report, installation failures, plan accuracy, issue resolution, repeated usage, and contributor adoption. Stars and launch attention are secondary. Virality cannot be promised; transparent results and low-friction usefulness make the project worth sharing.
