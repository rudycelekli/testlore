# Complementary tools and evidence

TestLore should preserve specialist tools' native behavior and add review, input provenance, fault evidence, and explainable routing. This shortlist identifies distinct useful roles. It is not an overall ranking, a performance certification, or a claim that every tool already has a TestLore plugin.

| Tool | Distinct role documented upstream | What TestLore can add | Current qualification |
| --- | --- | --- | --- |
| [Playwright](https://playwright.dev/docs/test-reporters) | Browser execution with native JSON, JUnit, HTML and trace-related reporting. | Bind browser/project configuration and declared route inputs to complete results; compare proposed subsets with full browser outcomes. | Recommended reporter-adapter candidate. Browser input declarations exist; this research does not implement or certify native Playwright collection/execution. |
| [fast-check](https://fast-check.dev/) | Property-based input generation, usable inside existing test runners. | Preserve independently reviewed properties, fixed budgets, counterexamples and replay details alongside the existing candidate and routing gates. | Qualified below with real fast-check 4.10.2 and Node. It needs no thin registry wrapper or new test engine. Jest/Vitest compatibility is documented upstream, not separately measured here. |
| [Pact](https://docs.pact.io/) | Consumer-driven contracts generated from consumer examples and checked against providers. | Treat contract/version changes as declared inputs; retain both sides' evidence and prevent a static test grade from substituting for provider verification. | Distinct contract-testing candidate. TestLore contract declarations do not constitute a Pact adapter or broker/deployment authority. |
| [Testcontainers](https://node.testcontainers.org/) | Disposable real infrastructure, such as databases, for integration tests. | Bind image/service versions and fixture configuration; keep integration scope and lifecycle failures visible in full-suite evidence. | Infrastructure recipe candidate inside supported runners. Docker availability, startup budgets and environment drift still require separate qualification. |
| [Schemathesis](https://schemathesis.readthedocs.io/en/stable/) | OpenAPI/GraphQL-based API test generation and stateful workflows, with reproduction and report outputs. | Retain schema/API/service provenance, reproducible failing requests, and separate budgets for expensive API exploration. | Recommended API-specialist candidate. Existing pytest delegation is separate; no Schemathesis-native adapter is implemented by this proof. |

The upstream projects deserve credit for these capabilities. Their documented reporters or test generation APIs establish possible integration points. Marketing claims about bugs found or speed are not accepted as TestLore measurements. Tools also cover different boundaries: Pact's consumer expectations and schema-based API exploration answer different questions, while Testcontainers supplies the environment in which tests run. [Pact's description](https://docs.pact.io/#consumer-driven-contracts) makes the consumer/provider distinction explicit; [Schemathesis](https://schemathesis.readthedocs.io/en/stable/) describes schema-driven exploration.

## Admission gate for a future adapter

An integration should earn omission authority through a bounded fixture, not merely appear in a plugin list:

1. Native discovery and normalized results must cover the declared project, cases, configuration and environment. Missing reporters, interrupted collection, unknown projects and loader failures remain incomplete.
2. An independently specified, fixed defect corpus must include cases a proposed subset could miss. Named behavioral failures count; process crashes and import failures do not count as caught defects. Record the corpus and decision/fault recall's actual denominator.
3. Declare generation, execution, shrinking, replay, retry and infrastructure budgets before measurement. Retain seeds/paths, browser traces or API reproducers and confirm replay when supported.
4. Bind source, tool/configuration versions and service inputs before deciding and before execution. Drift invalidates the receipt. A native full run remains the fallback for unsupported resolution contexts.
5. Keep proposals unapplied until independent review and the project's complete validation pass. Upstream confidence, coverage estimates and scores remain upstream metadata.

These are qualification requirements. They do not imply that every shortlisted tool has already passed them.

## A real property-library qualification

[`scripts/property-proof.js`](../scripts/property-proof.js) requires an already installed **fast-check 4.10.2**. It does not install packages, call provider APIs, generate AI tests, or apply candidates. Package version, repository and integrity were checked against the [npm registry](https://www.npmjs.com/package/fast-check/v/4.10.2); the inspected package's `check`, `counterexamplePath`, `numShrinks`, replay `path`, and bounded-interruption APIs match this proof. fast-check's [official repository](https://github.com/dubzzz/fast-check) owns those APIs.

Run against your installed project dependency, or point at an independently prepared tooling project:

```sh
node scripts/property-proof.js \
  --module-root /path/to/project-with-fast-check \
  --output /tmp/property-verification.json \
  --raw-directory /tmp/property-raw
```

The source clamps finite numbers to `[0,10]`. The original suite checks five examples: `-5`, `1`, `5`, `9`, and `20`. A manually authored candidate adds a mathematical piecewise property without removing that original case. Its budget is fixed at **seed 424242**, **500 successful trials**, bounded finite doubles `[-20,30]` plus predetermined boundary/fraction samples, a five-second property limit, and a fifteen-second runner limit. Failures stop sooner; shrinking is recorded separately. The property uses fast-check within a normal Node test case.

TestLore stages the candidate and validates complete original/candidate suites in disposable copies. Four additional fixed defects deliberately evade the five examples: wrong results exactly at `0`, exactly at `10`, rounding interior fractions, and passing negative fractions through. Separate full-suite measurements require the original examples to remain green and the candidate's named property assertion to fail. The receipt also independently checks the counterexample against the written specification and repeats every failure using its original seed/path.

The [retained receipt](../benchmarks/property-verification.json) passed: complete base validation, **4/4** scoped defects caught, **4/4** replayed, and no application. Recorded counterexamples were `0`, `10`, `5e-324`, and `-0.5`; the interior-fraction case took **62 shrinks**. [Raw fixture and reports](../benchmarks/property-raw/fixture.json) preserve the actual inputs, source, candidate, normalized case outcomes and replay results. Raw-file hashes are listed in the receipt.

This experiment intentionally keeps supplementary hold-out measurement separate from core `heldOutDefects`: that gate requires an original failing case, whereas these four defects leave the original examples green. The script exits unsuccessfully unless accepted complete base validation, all four semantic failures, all four replays, and the unchanged/unapplied original fixture are present. It does not weaken that core gate.

The property file has a normal dependency path to `src/clamp.js`. With the qualified external-package declaration handling, the retained plan uses `affected` mode with no warnings and selects both known consumers: the original and property files. This fixture omits no unrelated tests and measures no wall-clock savings. This is one small synthetic compatibility qualification, not broad fault coverage, a best-library claim, or evidence that an LLM produces sound properties.

## AQE complements rather than replaces the gates

The enabled Agentic QE author bridge is distinct from the future adapters above. Architect and reviewer requests still use the separate TestLore worker; the actual AQE CLI supplies candidate code. The [retained real AQE 3.14.6 composition observation](../benchmarks/aqe-composition-verification.json) used a credential-free template author and controlled architect/reviewer fixtures. AQE reported score 100 and `llmEnhanced:false`; the candidate remained rejected and unapplied. No live-model quality comparison, provider activation, native security/a11y integration, or general effectiveness claim follows from that observation.
