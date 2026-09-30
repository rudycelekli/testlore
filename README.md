<p align="center">
  <img src="docs/assets/testlore-hero.svg" alt="TestLore — the quality engineer that learns your codebase. Build better tests. Run what matters. Remember what worked." width="1200" />
</p>

<p align="center">
  <strong>Create tests. Measure quality. Explain every run. Learn from experience.</strong><br />
  An open-source testing intelligence layer for developers and coding agents.
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-133e3a?style=flat-square" alt="MIT license" /></a>
  <a href="package.json"><img src="https://img.shields.io/badge/Node.js-22.19%2B-133e3a?style=flat-square" alt="Node 22.19 or later" /></a>
  <a href="https://github.com/rudycelekli/testlore/actions/workflows/ci.yml"><img src="https://github.com/rudycelekli/testlore/actions/workflows/ci.yml/badge.svg" alt="Actual CI status" /></a>
  <a href="docs/roadmap.md"><img src="https://img.shields.io/badge/status-experimental_alpha-e8b76a?style=flat-square" alt="Experimental alpha" /></a>
</p>

<p align="center">
  <a href="#start-in-one-command">Quick start</a> ·
  <a href="#a-quality-engineer-inside-your-repository">How it works</a> ·
  <a href="#learning-that-stays-with-your-project">Learning</a> ·
  <a href="#show-the-evidence">Benchmarks</a> ·
  <a href="docs/configuration.md">Documentation</a> ·
  <a href="CONTRIBUTING.md">Contribute</a>
</p>

## A quality engineer inside your repository

Your code changes constantly. Your tests should keep up.

TestLore connects an agent team, your existing test runner, measurable quality evidence, and persistent project memory. It proposes better tests on a new branch, validates them against the original suite, explains which tests each change affects, and remembers useful patterns for the next improvement.

| Your starting point | What TestLore does |
| --- | --- |
| **No tests yet** | An architect, bounded author team, and independent reviewer propose runnable tests from your behavioral requirements. |
| **Tests exist, confidence is unclear** | Audit structure, import actual coverage and mutation results, measure stability, and surface gaps with their evidence. |
| **A growing suite slows development** | Follow static, declared, and observed dependencies to select affected test files, with reasons and conservative fallbacks. |
| **Knowledge disappears between sessions** | Retain validated examples and rejection signals; retrieve useful historical patterns for future agents. |

## Start in one command

From a clean, committed project checkout:

```sh
npm exec --yes --package=github:rudycelekli/testlore -- testlore improve
```

**Experimental alpha:** the implementation is merged into `main`. Pin a reviewed commit for reproducibility. Install from GitHub; an npm alpha release requires separate publisher setup and exact-artifact qualification. [Adoption and pilots →](docs/adoption.md)

Requires **Node 22.19+ and Git**. It creates your project’s quality-agent identity and local memory immediately. Existing `SPEC.md`, `REQUIREMENTS.md`, or README material can seed a proposed behavior contract on the branch. Commit `tddswarm.requirements.md` for explicit expectations; proposals without meaningful independent behavior must be rejected. Generation uses your configured worker or an installed, authenticated Codex CLI. Automatic PR creation uses your authenticated GitHub CLI. `--local` keeps the result for local review.

The default flow:

```text
Your repository
    ↓
Isolated improvement branch
    ↓
Architect → Authors → Independent reviewer
    ↓
Original suite + candidate suite + full branch validation
    ↓
GitHub pull request for your review
    ↓ after you merge
Audit + affected tests on PRs · full tests on default-branch pushes
```

Failed validation retains the proposal and its evidence for inspection. Missing requirements or a worker produces a concrete work order. Merging remains your decision. [Full workflow →](docs/improvement.md)

Personalize your project agent:

```sh
npm exec --yes --package=github:rudycelekli/testlore -- testlore agent --name "My project quality engineer" --json
```

The agent runs when you invoke it or CI; its identity and history persist between runs. Customize `qualityAgent.name` and `qualityAgent.focus` in project configuration.

`npm exec` uses a temporary package for that invocation. Before running any `npx --no-install testlore` commands below, including learning commands, install it locally with `npm install --save-dev github:rudycelekli/testlore`.

Want a useful report before configuring agents?

```sh
npm exec --yes --package=github:rudycelekli/testlore -- testlore init
npm install --save-dev github:rudycelekli/testlore
npx --no-install testlore audit --json
npx --no-install testlore run --shadow --base HEAD
```

Local analysis and routing require no AI account. Generation may consume your selected worker's allowance.

## A paragraph edit deserves an understandable plan

```text
AFFECTED · 1/2 test files selected

RUN   test/landing.test.js
      test/landing.test.js → public/copy.json
      reason: dependency-path

SKIP  test/checkout.test.js
      reason: no-known-dependency-on-change
```

Copy, styles, templates, localization, schemas, fixtures, and services can all affect behavior. Declare their relationships or capture runtime reads. TestLore combines these with static dependencies and explains its choices. Unknown inputs, unresolved paths, and stale evidence widen the run.

Run `npm run demo` for a selective copy edit, a shared dependency, and an uncertain change. Selection works at **test-file granularity**; native execution reports individual cases. Shadow mode runs the full suite while checking the proposed selection against observed failures. [Routing configuration →](docs/configuration.md)

## Learning that stays with your project

```text
RETAIN                        RECALL                        REFLECT
Validated test patterns  →   Relevant historical examples → Supported recommendations
Rejection signals             Source compatibility labels   Evidence IDs and counts
       ↑                              │                           │
       └────────────── future reviewed, validated proposals ──────┘
```

Every validated proposal can contribute to local memory. Architects and authors retrieve bounded examples with framework, source, environment, outcome, and age metadata. Independent reviewers receive requirements and candidates separately. Reflections point to the records supporting them.

```sh
npx --no-install testlore learn --json
npx --no-install testlore recall --query "boundary validation" --json
npx --no-install testlore learning-export --json
```

The default learning loop uses deterministic lexical retrieval and evidence-backed recommendations. An optional RuVector plugin adds native vector retrieval over the same validated lessons. Its default feature vectors are lexical; semantic embeddings require an explicitly configured model provider. Historical snippets are advisory; current requirements and execution determine acceptance. It does not train model weights. Memory stays local, including across improvement branches. Explicit aggregate export contains fixed counts without source, paths, or project identifiers. Disable learning with `"learning": {"enabled": false}`.

Inspired by Hindsight's retain/recall/reflect cycle, implemented around testing evidence. [Learning →](docs/learning.md) · [Hindsight research →](docs/hindsight-research.md)

## Grow with optional tools

TestLore is a complementary coordination layer. Bring your specialist tools into one quality workflow: their engines supply expertise, and TestLore connects modularity, routing, independent validation, and retained lessons. Enable capabilities as your project grows.

| Optional plugin | Contribution |
| --- | --- |
| **Agentic QE** | Draft tests for architect tasks; an independent worker reviews them before isolated validation. |
| **pytest-testmon · Nx · Bazel** | Native selection and execution through the ordinary `plan` and `run` commands. |
| **c8 · Stryker** | Genuine coverage and mutation reports through the existing measured-evidence pipeline. |
| **RuVector** | Optional local vector retrieval of validated historical lessons; JSON memory remains authoritative. |
| **Your team's worker** | Register an installed executable implementing the versioned generation protocol. |

Choose a setup in one command without first installing TestLore locally:

```sh
npm exec --yes --package=github:rudycelekli/testlore -- testlore plugins --auto
```

Or inspect the choices and manage tools after a local install:

```sh
npx --no-install testlore plugins --recommend --json  # Explain project-fit choices
npx --no-install testlore plugins --auto             # Enable compatible installed tools
npx --no-install testlore plugins --json
npx --no-install testlore plugins --enable agentic-qe
npx --no-install testlore plugins --check --plugin agentic-qe --json
# Optional native vector backend:
npm install --save-dev @ruvector/core@0.1.32
npx --no-install testlore plugins --enable ruvector
```

Automatic setup uses explainable project-fit rules, preserves explicit choices, and enables only supported installed tools. Missing tools receive recommendations; ambiguous execution engines require a choice. It performs no downloads or agent calls. Tools are installed separately. Health checks describe availability and supported contracts, not measured quality. All built-in plugins can be enabled together; `executionPlugin` selects the native backend for the project, while other providers run only for their relevant operations. Enabling more tools preserves the current backend. Reviewed branch improvements support Node/Jest/Vitest/Playwright individual-case validation. [Plugin configuration and community contract →](docs/plugins.md) · [RuVector learning →](docs/ruvector.md)

Playwright now has native discovery, project-aware case reports, and real Chromium qualification for declared browser inputs. fast-check composes inside a supported runner. Consumer contracts (Pact), service fixtures (Testcontainers), and API exploration (Schemathesis) remain researched integration seams awaiting their own qualification. Each has a distinct role. [Browser setup →](docs/playwright.md) · [Research and property proof →](docs/ecosystem.md)

Built to work alongside [Agentic QE](https://github.com/proffesor-for-testing/agentic-qe), [RuVector](https://github.com/ruvnet/ruvector), [pytest-testmon](https://www.testmon.org/), [Nx](https://nx.dev/), [Bazel](https://bazel.build/), [c8](https://github.com/bcoe/c8), and [Stryker](https://stryker-mutator.io/). Each remains an independently maintained project; integration does not imply affiliation or endorsement.

## Show the evidence

Reproducible results, raw outcomes, and stated scope accompany the claims. The comparison chart below is generated from actual test executions; raw outcomes and methodology accompany every comparison.

[![TestLore controlled comparison: fault recall, executed test files and total time](benchmarks/comparison/controlled-v1-2026-09-29-clarified/comparison.svg)](docs/comparison.md)

On **12 controlled changes across four Node fixtures**, TestLore caught all 63 observed failing-case results across three repetitions of seven distinct planted regressions. It executed **42.7% fewer callback-bearing test files** than the full suite. Median total time was **559 ms versus 133 ms**: discovery overhead outweighed savings on these tiny fixtures. The imports-only diagnostic missed failures. [Raw comparison →](benchmarks/comparison/controlled-v1-2026-09-29-clarified/comparison.json)

| Experiment | Observed result | Reproduce / inspect |
| --- | --- | --- |
| **Costly callback workload** | Fixed 64-file, 200 ms async-delay fixture: 64 → 1 callback files; same planted failure caught. Median total time 4,269 → 1,487 ms (65.2% less). | [Raw results](benchmarks/workload/constructed-64-200-4-2026-09-29/workload.json) · [Method](docs/workload.md) |
| **Pinned public projects** | Both planted nanoid/defu regressions caught; zero observed misses. Conservative full-scope selection; no speedup established. | [Raw results](benchmarks/results/2026-09-29-final-roadmap/summary.json) · [Method](docs/public-benchmarks.md) |
| **Actual coverage + mutations** | Controlled c8/Stryker fixture: 6/8 covered lines, 11/13 detected valid mutants. Tampered reports and changed inputs rejected. | [Quality proof](docs/quality-proof.md) |
| **Live agent generation** | Three actual Codex role calls generated 50 passing cases and caught four withheld mutations on one specification. | [Raw receipt](benchmarks/quality/live-codex.receipt.json) |
| **Live memory comparison** | With memory: 16 passing cases; without: 33. Both caught 4/4 withheld mutations. Memory generation took longer in this single run. | [Raw comparison](benchmarks/learning/2026-09-29-native-ablation/summary.json) |
| **Native ecosystem adapters** | Actual pytest-testmon, Nx, Bazel and AQE executions, with completeness and upstream-estimate boundaries. | [Integration receipts](docs/integrations.md) |
| **Optional vector recall** | Real RuVector core 0.1.32: native build/reopen, bounded CLI recall, corrupt-cache fallback, and unchanged canonical memory. | [Native receipt](benchmarks/ruvector-verification.json) · [Method](docs/ruvector.md) |
| **Real browser composition** | Chromium: one of two declared route files selected; the same heading defect fails in full and subset runs; candidate validation preserves and adds passing cases. | [Raw browser proof](benchmarks/playwright-verification.json) · [Scope](docs/playwright.md) |
| **Routing cache** | Controlled parser-heavy fixture: 178 ms warm, 240 ms uncached, 433 ms cold. No general project speed claim. | [Samples and checks](benchmarks/cache-verification.json) · [Method](docs/performance.md) |
| **Repeated live learning** | Two specifications × two repetitions: no memory 12/12 defects; memory 9/12 with one timeout. Inconclusive; no improvement claim. | [Raw paired run](benchmarks/learning/2026-09-30-paired-native/README.md) |
| **Complementary property library** | Real fast-check 4.10.2: complete base validation; 4/4 scoped defects caught and replayed from seed/path. | [Receipt](benchmarks/property-verification.json) · [Method](docs/ecosystem.md) |
| **Independent AQE gate** | Actual template author reported score 100; independent review rejected the output. No live LLM claim. | [Composition receipt](benchmarks/aqe-composition-verification.json) |
| **Packed installation** | Production-only install, native shadow fault detection, runtime capture, and a fully tested improvement branch. | `node scripts/packed-proof.js` |

A [paired repeated learning evaluation](docs/learning-evaluation.md) now controls worker budgets and execution order across independent specifications; no quality gain is established merely by shipping the evaluator.

Local repository pilots independently run proposed subsets and full suites in detached copies, alternate execution order, and include discovery and routing overhead. Raw receipts remain local; aggregate export is explicit. [Run your own pilots →](docs/pilots.md)

An opt-in bounded cache reuses source parsing while native discovery and resolution stay fresh. Initialization enables it for new configurations; existing configurations retain their settings. Controlled warm/cold evidence and its limits are in the [performance guide](docs/performance.md).

These are scoped experiments. The memory comparison confirms that historical recall reaches real agent generation; it does not establish a general quality gain. Tiny suites can run slower after discovery and planning. There is no universal safety, production speedup, or “best overall” claim. Misses, overhead, and counterexamples belong in the results. [Benchmark methodology →](docs/comparison.md)

[![Measured constructed workload: full-suite and TestLore total time and callback-file count](docs/assets/workload.svg)](docs/workload.md)

The workload chart uses **64 independent files, a constructed 200 ms asynchronous delay per callback, concurrency four, and three repetitions**. TestLore caught the same one planted failure in every repetition. The observed savings apply to this specified condition. Real projects need their own measurements. [Reproduce this workload →](docs/workload.md)

## Keep your runners

| Ecosystem | Integration |
| --- | --- |
| **Node · Jest · Vitest** | Native discovery, configured resolution, per-case results, shadow comparison and failure retention. |
| **pytest-testmon · Nx · Bazel** | Delegate to the ecosystem's native dependency engine and preserve its measured scope. |
| **Istanbul / c8 · Stryker** | Import genuine coverage and mutation reports bound to pre-run provenance. |
| **Codex · custom workers · Agentic QE** | Bounded worker protocol, included native Codex adapter, and a genuine optional AQE bridge. |
| **Browser routes · contracts · services** | Explicit asset/contract relationships and version/probe-based invalidation. |

Source/service changes, incomplete reports, and altered receipts invalidate evidence. Runtime traces supplement static dependencies. Quality grades label unavailable measurements. [Native runners →](docs/runners.md) · [Evidence →](docs/evidence.md) · [Candidates →](docs/candidates.md)

<details>
<summary><strong>Explore all commands</strong></summary>

| Commands | Purpose |
| --- | --- |
| `agent` | Create or inspect your project’s named quality agent. |
| `plugins` | Recommend a project-fit setup, enable it with `--auto`, or manage and check tools explicitly. |
| `improve` | New branch, reviewed candidates, full validation, automatic PR. |
| `init`, `audit`, `modules` | Setup, quality triage and modular group proposals. |
| `plan`, `run`, `run --shadow`, `run --full` | Explain and execute test selections; compare with full outcomes. |
| `snapshot`, `evidence`, `stability`, `capture` | Bind and collect measured quality and runtime evidence. |
| `generate`, `modularize`, `validate`, `apply` | Stage and validate generated or modular patches. |
| `learn`, `recall`, `learning-export` | Inspect lessons, retrieve history, explicitly export aggregates. |
| `external-plan`, `external-run`, `aqe` | Native ecosystem and Agentic QE integration. |

The `tddswarm` command remains an alias. Existing `tddswarm.config.json`, `tddswarm.requirements.md`, and `.tddswarm/` paths remain compatible.

</details>

## Build the standard together

TestLore is MIT-licensed and experimental. The [engineering roadmap](docs/roadmap.md) is implemented with tests and integration seams; broader real-project qualification continues. Existing tools established generation, mutation testing and selective execution. TestLore connects them into an inspectable workflow. [Prior art →](docs/landscape.md)

Bring a reproducible missed dependency, a public change corpus, an independent quality metric, a runner adapter, or a learning counterexample. [Contribution guide →](CONTRIBUTING.md) · [Open an issue →](https://github.com/rudycelekli/testlore/issues/new)

```sh
npm ci --ignore-scripts
npm test
npm run demo
npm run benchmark
npm run benchmark:public
node scripts/quality-proof.js
node scripts/packed-proof.js
```

<p align="center"><strong>Better tests. Clearer decisions. Knowledge that compounds.</strong></p>
