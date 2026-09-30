# TDDSwarm

**Know why each test runs. Improve the tests that matter.**

An MIT-licensed test intelligence layer: create or improve tests with an agent team, measure test quality, validate modular patches, and explain which tests a change can affect. Node/Jest/Vitest retain their runners; pytest-testmon, Nx and Bazel retain their dependency engines.

**Experimental alpha.** Quality and routing use scoped evidence. A static grade, passing agent review or runtime trace does not certify every possible behavior.

## One-line improvement workflow

Requires Node.js 22.19+, Git, a clean project checkout, and GitHub CLI authentication for automatic pull requests:

```sh
npm exec --yes --package=github:rudycelekli/tddswarm -- tddswarm improve
```

The default workflow creates an isolated improvement branch, uses a configured worker or authenticated installed Codex CLI, validates the original and candidate suites, runs the full suite on the branch, and opens a GitHub pull request. Independent expectations belong in `tddswarm.requirements.md`. Without a worker or requirements, it retains a concrete work order instead of pretending tests were generated. `--local` leaves the tested branch for local review. No automatic merge.

The proposal installs an ongoing GitHub quality workflow: scoped audit and affected tests on pull requests, full tests on default-branch pushes. Use shadow mode to compare selections with full-suite outcomes. Your existing configuration is preserved. See [improvement workflow](docs/improvement.md).

For deterministic setup without generation:

```sh
npm exec --yes --package=github:rudycelekli/tddswarm -- tddswarm init
npm install --save-dev github:rudycelekli/tddswarm
npx --no-install tddswarm audit --json
npx --no-install tddswarm run --shadow --base HEAD
```

Distributed through GitHub; **not published to npm**. Pin a reviewed Git commit for reproducibility. `init` preserves existing configuration, adds metadata to `.gitignore`, and writes a local audit. Generation sends bounded source context to your chosen worker and may consume its allowance. Deterministic analysis needs no AI account.

## A paragraph edit should have an understandable test plan

```text
AFFECTED · 1/2 test files selected
RUN  test/landing.test.js — dependency-path
     test/landing.test.js → public/copy.json
SKIP test/checkout.test.js — no-known-dependency-on-change
```

Copy, styles, templates, localization and schemas are inputs, not automatic permission to bypass testing. Declare their browser/contract relationships or capture runtime reads. Unknown inputs, stale evidence and unresolved dependencies widen the plan. `npm run demo` demonstrates selective copy changes, shared dependencies and conservative fallback.

## Implemented commands

| Command | Result |
| --- | --- |
| `improve` | Isolated branch → reviewed candidates → full validation → full branch test → automatic PR |
| `init`, `audit`, `modules` | Runner setup, static triage plus scoped measured evidence, modular group proposals |
| `plan --base <ref>` | Complete Git changes, dependency chains and reasons for every selected/omitted file |
| `run`, `run --shadow`, `run --full` | Native per-case outcomes, retained failures and comparison with the proposed subset |
| `snapshot`, `evidence` | Pre-run provenance and genuine Istanbul/Stryker report import |
| `stability --repeat 5` | Observed repeated-run outcomes and unstable case identities |
| `capture` | Per-file Node module/coverage/read observations; custom runtime report import |
| `generate`, `generate --execute` | Bounded architect/authors/reviewer work order or staged agent proposals |
| `modularize`, `validate`, `apply` | Reviewed file/fixture/deletion patch, isolated validation, explicit transactional application |
| `external-plan`, `external-run` | Native pytest-testmon, Nx and Bazel delegation |
| `aqe --target src/example.js` | Genuine optional Agentic QE generation, staged as unreviewed |

Selection operates at **test-file granularity**; native execution reports individual case identities. Native Node/Jest/Vitest discovery reconciles framework scope. TypeScript paths/extends and supported native aliases resolve to local dependencies. Static and runtime relationships are combined; runtime observations never delete static edges. Dynamic uncertainty remains conservative unless the project explicitly chooses a closed-world runtime policy.

Failure history is partitioned by runner, dependency state and environment. Passing a subset preserves failures from unexecuted files. Source/service drift, incomplete reports and altered receipts invalidate evidence. Integrity digests detect accidental changes; they are not cryptographic signatures or a security sandbox.

## Quality that is measured

```sh
npx --no-install tddswarm snapshot
# Run your coverage/mutation tool; keep reports under .tddswarm/
npx --no-install tddswarm evidence --type coverage --report .tddswarm/coverage/coverage-final.json --provenance .tddswarm/snapshot.json
npx --no-install tddswarm stability --repeat 5
```

Candidate acceptance requires independent expectations, full collection/execution, preserved original outcomes and fresh provenance. Optional held-out defects must cause actual failing cases. Name/outcome preservation is useful regression evidence, not formal semantic equivalence. Candidates execute in disposable copies using trusted dependencies, with the user's permissions.

Read [configuration](docs/configuration.md), [runner adapters](docs/runners.md), [evidence](docs/evidence.md), [candidates](docs/candidates.md), [agents](docs/agents.md), and [native integrations](docs/integrations.md).

## Evidence and prior art

The ecosystem already includes [pytest-testmon](https://www.testmon.org/), [Jest](https://jestjs.io/docs/cli), [Vitest](https://vitest.dev/guide/cli.html), [Nx](https://nx.dev/docs/features/ci-features/affected), [Bazel](https://bazel.build/query/guide), and [Agentic QE](https://github.com/proffesor-for-testing/agentic-qe). TDDSwarm connects quality, modular proposals and explainable execution; it does not claim to invent test selection. See [landscape research](docs/landscape.md).

```sh
npm ci --ignore-scripts
npm test
npm run benchmark
npm run benchmark:public
node scripts/quality-proof.js
node scripts/bazel-proof.js
```

Pinned public nanoid/defu changes caught both planted regressions with zero observed misses, while conservatively selecting the full runtime scope. [Raw results](benchmarks/results/2026-09-29-final-roadmap/summary.json) include native baselines and planning overhead. Single-run timing differences establish no production speedup.

[Real c8/Stryker proof](docs/quality-proof.md) measured 6/8 covered lines and 11/13 detected mutants on a controlled fixture, and rejected source/service drift and report tampering. Synthetic candidate controls caught four held-out defects while vacuous replacements caught none. A [live Codex run](benchmarks/quality/live-codex.receipt.json) generated 50 passing cases and caught four withheld mutations on one controlled specification. Actual pytest-testmon, Nx, Bazel and AQE executions are documented with exact limits. Hosted CI tests the composite action. Live model quality and universal selection safety remain open qualification work.

See [roadmap implementation](docs/roadmap.md) and [architecture](docs/architecture.md). Bring a reproducible missed dependency, independent quality metric or public benchmark. We welcome failures and measured overhead alongside improvements. No telemetry in the core CLI.
