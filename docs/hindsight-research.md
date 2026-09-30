# Hindsight-inspired learning and project naming

Research date: September 29, 2026. This document is a design recommendation and preliminary brand screen. The user accepted the TestLore name during this research. It does not assert that Hindsight is integrated, certify trademark availability, or establish testing performance.

## Recommendation

**TestLore** is the strongest name in the screened shortlist and the name accepted by the user. The project is now [rudycelekli/testlore](https://github.com/rudycelekli/testlore). It says what the project does and connects naturally to accumulated project knowledge. It is shorter and easier to say than TDDSwarm, while leaving room for quality assessment, generation, selective execution, and learning beyond TDD or a particular agent architecture.

Suggested positioning: **“Test intelligence that learns your codebase.”** A more concrete explanation: **“Build better tests. Run what matters. Remember what worked.”** These are product direction, not performance claims.

Use Hindsight's retain/recall/reflect pattern to shape a learning layer, with a deterministic execution-evidence store as the authority. Make Hindsight an optional memory backend rather than a requirement for a useful first CLI run.

## What Hindsight establishes

[Hindsight](https://github.com/vectorize-io/hindsight) describes project/user/agent memory banks and three operations: retaining information, retrieving relevant memories, and reflecting over memories to answer questions or infer connections. Retention uses an LLM to extract facts, entities, relationships, and temporal information. Its documented memory types include world facts, experiences, observations, and mental models. This is an architecture for external memory, not proof that a model's weights learn after every run.

Recall combines semantic, keyword, graph, and temporal retrieval, then fuses and reranks results. Exact identifiers and temporal context remain useful alongside similarity search. [Retrieval documentation](https://hindsight.vectorize.io/developer/retrieval)

Reflect is an agentic evidence-gathering and reasoning loop; bank disposition can influence its answers. It is suitable for advice and synthesis, which still need domain-specific validation before becoming execution policy. [Reflect documentation](https://hindsight.vectorize.io/developer/reflect)

Observations consolidate related facts into evidence-backed beliefs. Supporting quotations and proof counts are retained, and new evidence can revise prior observations. This is a useful precedent for separating raw run events from derived recommendations. [Observations documentation](https://hindsight.vectorize.io/developer/observations)

## What the 94.6% result actually measures

Hindsight's live benchmark page reports **94.6% on LongMemEvalS**. The linked Agent Memory Benchmark evaluates retrieval and answers over long-term conversational memory; it is maintained by `vectorize-io`, the same organization as Hindsight. The public methodology ingests documents, retrieves context, generates answers, and judges them against reference answers. Open methodology is valuable, but it does not make this an independently rerun test-selection evaluation. [Hindsight benchmark page](https://benchmarks.hindsight.vectorize.io/), [AMB methodology](https://github.com/vectorize-io/agent-memory-benchmark)

The published result file was inspected directly:

| Recorded field | Value |
| --- | --- |
| Dataset / split | `longmemeval` / `s` |
| Queries / correct | `500` / `473` |
| Accuracy | `0.946` |
| Mode / oracle | `rag` / `false` |
| Ingested documents | `11,303` |
| Answer model | `gemini:gemini-3.1-pro-preview` |
| Judge model | `gemini:gemini-2.5-flash-lite` |
| Average retrieved context | `43,624.5` tokens |
| Average retrieval time | `674.9` ms |

Source: [published run artifact](https://github.com/vectorize-io/agent-memory-benchmark/blob/main/outputs/longmemeval/hindsight/rag/s.json.gz), [downloadable raw JSON archive](https://raw.githubusercontent.com/vectorize-io/agent-memory-benchmark/main/outputs/longmemeval/hindsight/rag/s.json.gz). The repository's `main` resolved to `03c1d0f1d27da63034f0931121c858faba512383` during inspection. These figures describe that specific run, with its answer and judging models; no benchmark was reproduced locally. Retrieved context size and retrieval latency are not total per-question cost or end-to-end latency. This result is not directly comparable to test-generation quality or regression-detection measurements.

**94.6% is not regression-detection recall, test quality, impact-analysis accuracy, or evidence that learning makes a testing system safe.** The score is useful motivation for trying a memory architecture. Testing intelligence needs a separate benchmark with known failing changes and full-suite outcomes.

## A learning loop appropriate for testing

The following design is proposed for this project; it is not a feature-status inventory.

| Operation | Store or compute | Authority boundary |
| --- | --- | --- |
| **Retain** | Structured execution events: repository identity, revision, environment fingerprint, runner/version, full-versus-selected mode, selected tests and reasons, actual outcomes, durations, measured coverage/dependencies, mutation results, and candidate-validation outcomes. | A measured event can be a fact. An LLM's explanation of a failure remains a hypothesis. |
| **Recall** | First retrieve exact compatible repository/test/module evidence; then use tags, time, dependency links, and optional semantic search to find patterns and useful examples. | Memory may prioritize or add tests and inform proposals. It must not silently override required selections. |
| **Reflect** | Propose a missing dependency, weak assertion, flaky fixture, costly duplicate, useful boundary test, or an improvement to generated candidates. Attach source event IDs and a validation plan. | Reflection produces a reviewable candidate. Execution, contracts, and policy determine acceptance. |
| **Consolidate** | Maintain observations such as repeated fixture instability or tests that consistently detect a defect category, with support counts, scope, first/last observations, contradictions, and version validity. | An observation is not a universal fact or an automatic permission to skip tests. |

Learning should improve test ordering, candidate generation, recommendations, and explicit dependency declarations. A miss found by a full defensive run should create a recorded miss event, expand selection conservatively, and prompt investigation of the missing relationship. Keep the raw event; do not replace it with a flattering summary.

For a landing-page copy edit, memory can recall which route, content, accessibility, or visual checks previously exercised that input. If no reliable mapping exists, policy should expand the run. Semantic similarity between the paragraph and a test name cannot establish that other tests are unaffected.

### Practical implementation order

1. Add an append-only local event journal and deterministic indexes. Define exact schemas, provenance, environment compatibility, and evidence invalidation before adding embeddings.
2. Use accumulated measured timings and failures for ordering within the mandatory selection. Keep unknown inputs and incompatible evidence on the conservative path.
3. Add explicit observation records and reviewable improvement proposals. A validated dependency declaration can become routing evidence; a speculative explanation cannot.
4. Offer a backend interface for optional Hindsight retain/recall/reflect. Preserve the same event IDs and project scope, and keep basic local routing usable without an LLM or external memory service.
5. Evaluate whether semantic recall/reflection adds value over exact local history before making it a default.

Keep repository scope and environment scope explicit. Treat repository text, test output, and retrieved memory as untrusted input to agents. Store minimal metadata by default; sending code or logs to an external backend should be a clear opt-in with source filtering. Preserve deletion, reset, export, and contradiction-handling behavior so project memory remains inspectable.

### How to establish that learning helps

Run chronological, held-out change sets with three configurations: static/evidence-only baseline, baseline plus deterministic local history, and baseline plus Hindsight-style recall/reflection. Include cold starts and previously unseen defects. Prevent future outcomes from leaking into earlier decisions.

Measure faulty-change recall and failing-test recall, total wall time including learning overhead, candidate tests accepted after independent validation, useful recommendations, stale-memory errors, and model/storage cost. Keep real faults separate from mutations and flaky outcomes. Report misses and full-run fallbacks. A memory feature earns its place through those results, not through a conversational-memory score or the number of stored facts.

## Naming shortlist and screening

The checks below were read-only exact-name npm registry requests, GitHub repository-name searches, and targeted web searches. They establish only what was found at the research date. A registry 404 does not reserve a package name or guarantee that publishing is allowed. Domain availability and trademarks were not checked.

| Rank | Name | Why it works | Preliminary evidence and tradeoff |
| --- | --- | --- | --- |
| **1** | **TestLore** | Testing plus accumulated knowledge; short, memorable, flexible across languages and agent styles. | [Exact npm registry endpoint](https://registry.npmjs.org/testlore) returned 404. [GitHub name search](https://api.github.com/search/repositories?q=TestLore%20in%3Aname) returned 12 substring matches, with no exact `TestLore` repository in the returned results. Targeted web search found examples/commands containing the word rather than a direct software product. “Lore” should be grounded in measured evidence in the product explanation. |
| **2** | **SuiteLore** | Highlights knowledge of the whole suite and avoids anchoring the brand in TDD. | [npm](https://registry.npmjs.org/suitelore) returned 404; [GitHub](https://api.github.com/search/repositories?q=SuiteLore%20in%3Aname) returned zero. Web results included a hotel-name suggestion rather than a direct software product. “Suite” can be heard as “sweet,” making spoken spelling less obvious. |
| **3** | **TestMemento** | Clearly suggests testing that remembers prior work and failures. | [npm](https://registry.npmjs.org/testmemento) returned 404; [GitHub](https://api.github.com/search/repositories?q=TestMemento%20in%3Aname) returned zero. Web results were memento-pattern test code rather than a direct product. Longer and less distinctive in searches for design-pattern examples. |

The following attractive candidates have existing conflicts and should be dropped from this shortlist:

| Candidate | Conflict evidence |
| --- | --- |
| TestPilot | Existing [npm testing framework](https://www.npmjs.com/package/testpilot), described by its registry metadata as promise-savvy. |
| TestWeave | Existing [visual test automation product](https://app.testweave.com/), [UAT platform](https://testweave.dev/), and [test-generation extension](https://marketplace.visualstudio.com/items?itemName=paulyestchick.testweave). |
| Proofloom | Existing [GitHub project](https://github.com/Jinchainne/Proofloom), plus other projects and proof-related uses found in search. |
| Qualora | Existing [AI documentation and quality-assurance software](https://qualora.co.uk/), alongside other software uses. |
| Proofwise | Existing [compliance software](https://www.proofwise.nl/prijzen). |
| SpecLore | Existing [requirements-driven coding tool](https://speclore.tech/en/) and [npm package](https://www.npmjs.com/package/speclore) described as a BDD/acceptance-testing CLI. |
| Checkloom | [GitHub search](https://api.github.com/search/repositories?q=Checkloom%20in%3Aname) returned `Yuvasys/checkloom-privacy-policy`, suggesting an existing app use that needs further investigation. |

The user accepted **TestLore**, and the parent task updated the GitHub repository to [rudycelekli/testlore](https://github.com/rudycelekli/testlore). This research task changed only this document and did not perform the rename.
