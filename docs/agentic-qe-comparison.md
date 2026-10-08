# TestLore and Agentic QE: complementary capabilities and evidence

TestLore has not demonstrated that it is better than Agentic QE as a whole. Agentic QE already implements change impact analysis, selective test scheduling, generation, quality gates and learning. TestLore's intended contribution is a small, inspectable controller around existing tools: fresh native discovery, conservative selection, bounded execution, independent challenges and explanations for omissions. That contribution must be measured on the application's actual runner configuration.

This comparison inspected Agentic QE source at **`829d03060d56ee82e6fa294b2be8f6c5fc9f2766`**, retrieved on October 8, 2026. It did not install or execute that revision, invoke its models, or qualify its advertised platforms. Counts and examples in its README are upstream descriptions. Source implementation is evidence of a capability, not proof of its effectiveness on a particular repository.

## Where capabilities overlap

| Capability | Agentic QE at the inspected revision | TestLore's contribution to evaluate |
| --- | --- | --- |
| Change-based selection | `GitAwareTestSelector` requires an impact analyzer, selects tests from its results, and uses full fallback for recognized configuration changes or reported analysis failures. `ImpactAnalyzerService` searches incoming graph edges and naming-related indexed tests. | Bind discovery and resolution to the native runner, current source and configuration; retain uncertainty, removed edges and explicit omission reasons. |
| Test generation | Framework generators, optional LLM enhancement, caller-supplied behavior examples and deterministic scaffolds with explicit limits. | Keep generated artifacts as candidates; execute them against independent contracts and faults before promotion. |
| Test quality | Deterministic syntax/assertion checks reject malformed or assertion-free output and flag tautologies, empty bodies and mirrored assertions. | Static scores accompany executable defect detection, stability, preserved original tests and complete measured cost. |
| Learning | Pattern storage, contextual/vector retrieval, usage feedback, promotion thresholds and dream-cycle consolidation. | Keep retrieved lessons advisory; compare memory/no-memory under equal budgets on untouched tasks and retain negative outcomes. |
| Agent workflows | Broad QE domains and coding-agent integrations described upstream. | A bounded plan/verify/repair loop whose reports say what ran, what did not, why, remaining uncertainty and the next action. |

Primary sources: [Git-aware selector](https://github.com/proffesor-for-testing/agentic-qe/blob/829d03060d56ee82e6fa294b2be8f6c5fc9f2766/src/test-scheduling/git-aware/test-selector.ts), [impact analyzer](https://github.com/proffesor-for-testing/agentic-qe/blob/829d03060d56ee82e6fa294b2be8f6c5fc9f2766/src/domains/code-intelligence/services/impact-analyzer.ts), [generator service](https://github.com/proffesor-for-testing/agentic-qe/blob/829d03060d56ee82e6fa294b2be8f6c5fc9f2766/src/domains/test-generation/services/test-generator.ts), [quality gate](https://github.com/proffesor-for-testing/agentic-qe/blob/829d03060d56ee82e6fa294b2be8f6c5fc9f2766/src/domains/test-generation/gates/test-quality-gate.ts), [pattern store](https://github.com/proffesor-for-testing/agentic-qe/blob/829d03060d56ee82e6fa294b2be8f6c5fc9f2766/src/learning/pattern-store.ts), [promotion criteria](https://github.com/proffesor-for-testing/agentic-qe/blob/829d03060d56ee82e6fa294b2be8f6c5fc9f2766/src/learning/qe-patterns.ts), [dream engine](https://github.com/proffesor-for-testing/agentic-qe/blob/829d03060d56ee82e6fa294b2be8f6c5fc9f2766/src/learning/dream/dream-engine.ts).

The inspected impact analyzer requests an incoming dependency depth of three for impacted tests. Its selector accepts a successful empty result as no tests selected. Those are concrete behaviors to challenge with deep dependencies, stale/missing graph entries and untracked inputs; this inspection does not establish that a composed upstream workflow fails those challenges. TestLore's own graph limits, incomplete runtime evidence and fallbacks require equivalent challenges.

The generator's hash-selected internal holdout flag does not by itself establish that specifications were maintained independently or hidden from generation. Likewise, TestLore's disjoint specifications do not establish semantic independence or secrecy from a provider's training data. Both need separately governed evaluation tasks.

## Compose the tools without duplicating authority

Use Agentic QE for optional generation or specialized analysis, native Vitest/Playwright or an established graph backend for execution, and TestLore to retain and challenge the resulting evidence. The existing [AQE adapter](integrations.md#agentic-qe-generation) stages drafts for review; it does not fabricate support for TestLore's worker protocol. A capability probe establishes the installed CLI contract, not candidate quality or model availability. A new upstream version must pass the same probe and executable checks before integration claims change.

Choose one authoritative selection/execution backend per project. Additional analyzers may propose evidence or candidates; enabling several plugins must not silently create competing omission decisions. Learning, upstream quality scores and agent explanations cannot authorize a skipped test. Reviewed contracts and current execution evidence remain the basis for selective runs; unresolved dependencies retain fallback. See [plugins](plugins.md), [precise routing](precise-routing.md) and [learning evaluation](learning-evaluation.md).

Our retained credential-free observation of Agentic QE **3.14.6** produced weak template assertions alongside an upstream passing quality score. That is a historical release observation, not a description of all current AQE generation. The newer inspected source explicitly labels deterministic scaffolds and LLM fallback, and rejects assertion-free output. Preserve [the raw historical output](../benchmarks/aqe-observation/raw-generation.json); rerun a pinned newer release under the same conditions before asserting that an old behavior persists.

## What currently supports a claim

Published TestLore **0.1.0** ran all 261 files in the declared REA scope. It preserved the six observed blank-path failing cases, as did native Vitest related, but took approximately **26.5–27.9 seconds** versus native selection's **1.9–2.1 seconds** in the retained campaign. Random property inputs prevented strict cross-run qualification. These are losses, with zero qualified comparisons; they demonstrate neither a speed advantage nor superiority over Agentic QE. [Original configuration, measurements and limitations](rea-public-qualification.md).

No same-task, same-environment runtime comparison against current Agentic QE has been collected here. No learning advantage is established. Candidate multi-project routing or controlled property replay must produce new evidence without rewriting the old rejection.

## A fair superiority experiment

Before any comparison run, freeze the repositories/revisions, original dependencies, runner projects, independently labeled changes/bugs and promotion criteria. Record each installed tool's version and artifact identity. Compare original full execution, native selection, TestLore selection and the supported AQE selection workflow against the same scope. Unsupported or incomplete arms remain visible; they are not zero-time wins.

Rotate arm order, repeat executions, retain flaky outcomes and measure complete cold and warm processes, including indexing/discovery, planning, execution and report retention. A subset qualifies only if independent full/subset runs preserve all relevant named outcomes and declared project memberships. Property runs retain actual seeds and input-control metadata; matching titles or counts alone do not establish equivalent inputs. Report failure preservation, omission rate, fallback frequency and total time together.

For generation, supply identical independently maintained contracts, repository context, model/provider identity where ascertainable, call/time/token budgets and fault set. Compare AQE alone with AQE plus TestLore's review/challenge loop, and TestLore's other worker path. Count rejected output, timeouts, fixed-source stability, bugs caught and total cost. Upstream quality scores are observations, not ground truth. For learning, counterbalance memory/no-memory on untouched tasks with equal limits and report additional context cost. Promotion needs repeated held-out gains; a larger index or a passing demo is insufficient.

The useful claim is conditional and reproducible: which verified controller or composition preserved which failures, reduced which costs and improved which outcomes. A universal "best quality engineer" claim remains unproven.
