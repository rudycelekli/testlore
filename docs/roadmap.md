# Roadmap implementation and evidence

The 0.2–0.4 engineering milestones have concrete implementations merged into main. These are experimental capabilities, not published version numbers or certification of arbitrary projects. Each ecosystem retains its own test engine.

| Milestone | Implemented | Evidence and remaining qualification |
| --- | --- | --- |
| 0.1 foundation | One-command initialization, explainable selection, static triage, grouping, bounded worker teams | Regression suite and reproducible synthetic demo |
| 0.2 trusted scope | Native Node/Jest/Vitest discovery and results, TS aliases/extends and native resolver bridges, per-case shadow comparison, runner/environment failure history, pinned public benchmarks, composite action | Real runner fixtures and public regression receipts; hosted action smoke workflow tests the exact PR commit |
| 0.3 measured quality | Pre-run provenance, Istanbul and Stryker import, repeated-run stability, independent-oracle review, held-out defects, disposable candidate validation, transactional patch application, genuine optional AQE CLI bridge | Real c8/Stryker proof, synthetic strong/vacuous comparisons, and one live Codex specification/withheld-mutation proof; general model quality remains unqualified |
| 0.4 runtime/ecosystems | Per-file Node V8/module/read traces, imported runtime protocol, freshness/integrity checks, browser route and contract declarations, service versions/probes, pytest-testmon/Nx/Bazel delegation | Actual adapter executions and runtime regressions; traces observe exercised behavior and require explicit closed-world policy to resolve dynamic uncertainty |

## Acceptance criteria

Public benchmarks retain full, proposed-subset and native baseline outputs, failed case identities, planning overhead, runner time and missed regressions. A passing deterministic benchmark establishes results only for its named patches and runtime scope. It does not establish universal decision recall or production speedups.

Quality reports name their scope and source/runner/environment provenance. Imports require a snapshot taken before execution. Source drift, service drift, incomplete outcomes and altered receipts invalidate measured status. Reviewer acceptance does not authorize application without independent expectations and successful candidate validation. Held-out defects must cause actual failing cases; process/import errors do not count as defect detection.

Candidate preservation checks compare collection identities and passing outcomes, with optional held-out defects. These are useful regression checks, not proof of semantic equivalence. Disposable workspaces isolate file changes; installed dependencies and test executables are trusted and run with the user's permissions.

Browser declarations represent routes, copy, styles, templates and localization as inputs to an existing browser runner. Imported runtime reports trust their producer's completeness attestation. Observed runtime dependencies always supplement static edges; inference about unexercised branches remains a project policy.

## Persistent learning and public comparison

TestLore adds local retain/recall/reflect operations over validated proposals and measured outcomes. Retrieval supplies bounded historical examples to architects and authors while independent review, execution, and selection policy retain authority. Aggregate export is explicit and contains no source or project identifiers. See [learning](learning.md) and [comparison](comparison.md).

The GitHub project and primary command are now TestLore (`testlore`); `tddswarm` and its existing configuration/metadata paths remain compatible.

## Complementary plugin composition

The optional plugin registry supplies explicit generation, native execution, measured-report import, and learning-retrieval roles. All built-ins can be enabled together; one selected execution backend preserves each project's native scope. Ordinary `plan`/`run` dispatch to that backend. AQE can draft architect tasks while an independent worker reviews the actual code and candidate execution determines acceptance. RuVector indexes validated local lessons with explicit provenance, fallback, and no acceptance authority.

Project inspection recommends compatible installed tools without invoking them. Automatic configuration preserves explicit policies and applies the compatible plan atomically. Its project-fit rules are explainable, not evidence of universal provider superiority. See [plugins](plugins.md), [RuVector](ruvector.md), and [ecosystem research](ecosystem.md).

## Continuing qualification

- Broader real-project change corpora, including missed dependencies and order-dependent subset failures.
- Held-out evaluation of actual model-generated tests against independent behavioral specifications.
- Browser/framework instrumentation producers for the runtime protocol.
- Maintainer verification of native discovery and graph scope on large monorepos.
- Repeated timing studies including instrumentation cost and native selection baselines.

The engineering roadmap now has APIs, commands, tests and integration seams. These qualification tasks remain open evidence work. Virality is an outcome the project can earn, not an acceptance criterion we can guarantee.

## Alpha adoption and next evidence milestone

The public GitHub alpha is available for voluntary pilots. [Adoption](adoption.md) describes shadow-first qualification and private evidence boundaries; [launch preparation](launch.md) supplies draft material and a protected exact-archive OIDC release workflow. Adding the workflow does not configure environment protection, establish npm ownership, or publish a package.

The next implementation now includes an opt-in bounded [source-analysis cache](performance.md), [native Playwright](playwright.md) with genuine Chromium qualification, and a [local pilot harness](pilots.md) for up to twenty repositories. New initialization enables caching; existing configuration remains explicit. Full and subset outcomes are independently executed, native scope is freshly verified, execution order alternates, and missed failures survive aggregate export. Wider community adoption and a ten-to-twenty-project campaign remain qualification work; a harness is not a completed campaign.

[Paired learning evaluation](learning-evaluation.md) adds fixed worker budgets, balanced randomized order, distinct authored specifications, separately executed held-out defects, and raw per-trial receipts. Repetitions remain clustered by specification, and the default small dataset yields an inconclusive general-quality assessment. Live multi-task results, independently maintained pilots, exact-SHA hosted release gates, and registry installation evidence remain qualification work.
