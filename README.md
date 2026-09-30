# TDDSwarm

**Know why each test runs. Improve the tests that matter.**

An open source, local-first test intelligence layer for JavaScript and TypeScript. Audit existing tests, propose modular boundaries, stage tests with an agent team, and explain which test files a change affects.

**Experimental alpha.** The deterministic CLI works without AI credentials. Agent-generated candidates require a configured worker and independent requirements. Static grades describe visible structure; they do not certify test effectiveness or deployment readiness.

## One-line setup

Requires Node.js 22+ and Git. Run inside your project:

```sh
npm exec --yes --package=github:rudycelekli/tddswarm -- tddswarm init
```

This creates configuration, adds `.tddswarm/` to `.gitignore`, and saves a local health report. Existing configuration is preserved. Nothing is uploaded and no agent is invoked by `init`, `audit`, `modules`, `plan`, or `run`. Installation downloads this package and its dependency; your chosen test runner still has its usual behavior.

For ongoing use, install in the project:

```sh
npm install --save-dev github:rudycelekli/tddswarm
npx --no-install tddswarm audit
npx --no-install tddswarm plan --base HEAD
npx --no-install tddswarm run --shadow --base HEAD
```

The package is currently distributed through GitHub, **not published to npm**. `npx tddswarm` without a local installation is not the install command. Pin the Git dependency to a reviewed commit for reproducibility.

## A small change should have an understandable test plan

```text
Landing-page copy
AFFECTED · 1/2 test files selected
SKIP test/checkout.test.js — no-known-dependency-on-change
RUN  test/landing.test.js — dependency-path
     test/landing.test.js → src/copy.json

Shared helper
AFFECTED · 2/2 test files selected
     test/landing.test.js → src/landing.js → src/shared.js
     test/checkout.test.js → src/checkout.js → src/shared.js

Unknown runtime input
FULL · 2/2 test files selected
Reasons: unmapped-or-deleted-input, change-without-test-evidence
```

Run the synthetic demo with `npx --no-install tddswarm demo` after installation, or `npm run demo` from this repository. These are illustrative fixtures, not production performance results.

Copy, CSS, templates, localization, and schemas can affect visual, accessibility, or integration tests. Declare dependencies when static imports cannot represent them. A paragraph change does not automatically bypass tests.

## What is implemented

| Command | Result |
| --- | --- |
| `init` | Detect Node/Vitest/Jest runner configuration; create a health report |
| `audit` | Static A–F triage grade, findings with lines, missing import relationships, and explicit unmeasured dimensions |
| `plan --base <ref>` | Git changes → import/declaration graph → selected test files, dependency paths, uncertainty reasons |
| `run` | Execute selected files, preserve exit status, record elapsed time and retry files from failed runs |
| `run --shadow` | Execute the full discovered suite while recording the proposed subset |
| `run --full` | Force the full discovered suite |
| `modules` | Propose subject-based groups and flag broad dependencies; no automatic rewrite |
| `generate` | Export an architect/author/reviewer work order without invoking agents |
| `generate --execute` | Invoke configured workers; run up to three authors concurrently; stage reviewed or rejected candidates |

Selection works at **test-file granularity**. It uses AST-parsed imports/re-exports, literal `require`/`import`, previous edges for changed files, and explicit asset dependencies. The graph is rebuilt each time; there is no stale graph cache. Unknown changed inputs, missing imports, computed imports, runtime filesystem access, config changes, and unsupported resolution widen selection to all discovered tests. Tests with no local dependencies are retained when inputs change. Explicit policy retains smoke tests, prior failed files, and periodic full runs.

The built-in runner is Node's test runner. `init` detects installed Vitest/Jest dependencies and writes their CLI commands. TypeScript/JSX tests require a capable configured runner. Native runner discovery can be broader than TDDSwarm's naming convention; review the discovered files before enabling selective execution. See [configuration and limitations](docs/configuration.md).

## Optional agent team

Use your installed Codex CLI, or supply any JSON worker implementing the [agent protocol](docs/agents.md). The included Codex adapter uses separate architect, author, and reviewer calls with structured outputs. It does not use Agentic QE internally or claim its capabilities. The worker interface allows future integration without coupling routing to an LLM.

1. Install TDDSwarm locally and authenticate your Codex CLI.
2. Write `tddswarm.requirements.md` with independent expected behaviors.
3. Add `"agent": ["npx", "--no-install", "tddswarm-codex-agent"]` to configuration.
4. Run `npx --no-install tddswarm generate --execute`.
5. Review `.tddswarm/candidates/<id>/`, copy desired changes, and validate with your runner and mutation tooling.

`--execute` sends the bounded source/test context and requirements to the configured worker. A remote worker may upload that context and consume usage allowance. There are at most 14 worker calls, each with a timeout; this bounds calls, not tokens or money. Source can contain embedded secrets; inspect it before opting in. Candidates never overwrite project files or execute automatically. Reviewer acceptance is separate from runtime validation. The orchestration protocol is verified with deterministic workers; live model quality has not been benchmarked.

## Why another testing tool?

The problem is established. [pytest-testmon](https://www.testmon.org/), [Jest](https://jestjs.io/docs/30.0/cli), [Vitest](https://vitest.dev/guide/cli.html), [Nx](https://nx.dev/docs/features/ci-features/affected), and commercial products already select tests. [Agentic QE](https://github.com/proffesor-for-testing/agentic-qe) already covers test generation, quality assessment, and change impact.

TDDSwarm's proposed contribution is an approachable open layer linking **test health → modular boundaries → explicit dependency evidence → understandable execution decisions**. It aims to interoperate with mature tools. This is an integration opportunity, not a claim to have invented test selection or AI testing. Read the [primary-source landscape research](docs/landscape.md).

## Evidence, not a speedup slogan

```sh
npm ci
npm test
npm run benchmark
```

The benchmark creates 1,000 deliberately independent test files and measures planning, then compares selected and full execution on six small change fixtures. Raw sample outcomes and hardware information are in [synthetic.json](docs/benchmarks/synthetic.json). Test-count reduction is not wall-clock savings. This is not a production repository benchmark.

Next milestones are runtime/coverage evidence, measured mutation and flake reports, browser dependency adapters, automatic shadow-result comparison, and reproducible public-repository benchmarks. See [roadmap](docs/roadmap.md) and [architecture](docs/architecture.md).

## Contribute

Bring a reproducible missed dependency, a runner discovery fixture, an independent test-quality metric, or a public benchmark. See [CONTRIBUTING.md](CONTRIBUTING.md). Issues and pull requests are welcome. We will publish misses and overhead alongside improvements.

MIT licensed. No telemetry in the core CLI.
