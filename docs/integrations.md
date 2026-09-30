# Native graph and generation integrations

TDDSwarm delegates established ecosystems to their native engines. Install these tools in your own project/environment; TDDSwarm never silently downloads them. All command arguments are arrays, executed without a shell. Missing tools, invalid native output and unresolved revisions produce explicit `exitCode: 2`, incomplete reports. Ordinary runner failures preserve their exit codes.

## pytest-testmon

```json
{"integration":{"type":"pytest-testmon","executable":".venv/bin/pytest","options":["-q"]}}
```

`externalPlan(root, config)` reports `delegated: true`, `complete: false`, and no fabricated test list: testmon selects while executing pytest. First execution without `.testmondata` is labeled `initial-full`; subsequent runs use testmon's persisted dependency evidence. `externalRun` invokes `pytest --testmon`; `full` or `shadow` uses `--testmon-noselect`. Preserve `.testmondata` using testmon's environment rules. Configure environments via `options: ["--testmon-env=..."]` where appropriate. TDDSwarm does not reinterpret testmon's runtime graph or claim an individual-test shadow comparison for this adapter.

Verified locally with pytest 8.4.2 / pytest-testmon 2.1.4 / Python 3.9.6: initial 2 passes, unchanged rerun 0 tests, changed library selected 1 failing test, and shadow ran both tests (1 failure). See [testmon documentation](https://www.testmon.org/).

## Nx

```json
{"integration":{"type":"nx","options":["--skipNxCache"]}}
```

The default executable is project-local `node_modules/.bin/nx`; override `executable` and optional prefix `args` when needed. `externalPlan(root, config, {base})` resolves the Git reference and queries `nx show projects --affected --base=<sha> --withTarget=test --json`. Omitting `head` lets Nx include committed, uncommitted and untracked changes; explicit `head` selects the requested committed interval. An explicit diagnostic `changed` array uses native `--files`. Full/shadow discovers every project with a `test` target. Execution uses `nx run-many -t test --projects=<native-discovered-projects>`.

Verified locally against Nx 22 with a real project graph and `nx:run-commands` test target: changed project discovery returned `demo` and actual target execution passed. See [Nx command reference](https://nx.dev/docs/reference/nx-commands).

## Bazel

```json
{"integration":{"type":"bazel","targets":["//..."],"fileLabels":{"src/parser.py":["//src:parser"]}}}
```

Provide explicit labels in `fileLabels`; TDDSwarm never guesses a label from a directory or source filename. Discovery evaluates `kind(".*_test rule", rdeps(set(//...), set(//src:parser)))` and execution invokes `bazel test` on the returned labels. Any changed input without a declared label forces full discovery within `targets`. `targets` defines the declared test scope; omitted targets default to `//...`. Graph queries may need configured `queryOptions` for toolchain/workspace details. A failed query blocks execution rather than pretending it found no tests.

Bazel is **live-verified on a small native `sh_test` fixture** with Bazel 6.5.0 on macOS ARM64. Two independent tests passed initially; a declared data-file defect selected only its dependent test and preserved test-failure exit 3; full and shadow ran both targets; an unmapped input triggered full discovery. See the [sanitized live receipt](../benchmarks/bazel-verification.json) and reproduce with `node scripts/bazel-proof.js --executable /path/to/bazelisk --output /tmp/bazel-proof.json`. Bazel build failures (exit 1) remain incomplete; completed test failures (exit 3) preserve complete execution evidence. Keep a custom `--output_user_root` outside the workspace, or exclude its directory in `.bazelignore`, so `//...` does not scan embedded tool packages. No remote execution, toolchain, generated-source, arbitrary monorepo or speedup claim is established by this fixture. The older native-verification receipt predates Bazel installation. See [Bazel reverse-dependency query guide](https://bazel.build/query/guide). Workspace maintainers must verify native graph scope on their own project.

## Agentic QE generation

`aqeCapabilities(["aqe"])` verifies the installed `aqe test --help` contract. `aqeGenerate(root, {target: "src/add.js", framework: "vitest", command: ["aqe"]})` calls the supported `aqe test generate <target> --framework ... --format json --output ...` interface. It copies bounded source context to a disposable workspace, strips inherited API credentials and personal configuration, validates returned file paths, normalizes scratch imports, and stages artifacts under `.tddswarm/candidates/<id>` for review. It never overwrites project tests. An explicit `env` object can opt into a separately configured generation provider.

AQE does not expose TDDSwarm's architect/author/reviewer JSON protocol; requesting those roles fails explicitly. This is a direct optional CLI integration. No MCP capabilities are fabricated.

Verified with Agentic QE 3.14.6: a credential-free source `add(a,b)` generated actual candidate code. Its deterministic template used TODO inputs and `toBeDefined()` while upstream `qualityGateResult` reported a passing score of 100. The [retained raw output](../benchmarks/aqe-observation/raw-generation.json) demonstrates why upstream estimates are recorded as **upstream**, candidates remain **unreviewed**, and independent oracle review, execution and held-out defect checks are still required. See [AQE CLI source](https://github.com/proffesor-for-testing/agentic-qe/blob/main/src/cli/commands/test.ts).

## GitHub composite action

```yaml
steps:
  - uses: actions/checkout@v4
    with:
      fetch-depth: 0
  - run: npm ci
  - uses: rudycelekli/tddswarm@<reviewed-commit-sha>
    with:
      base: ${{ github.event.pull_request.base.sha }}
      mode: shadow
      environment: node22-linux-service-v1
```

Install your project's test dependencies first. The action installs its own dependencies from its committed lockfile and accepts `shadow` (default), `affected`, or `full`. `adapter` must match configured runner adapter / `integration.type`, or use `auto`. It retains machine-readable evidence even when tests fail, preserves test exit status, and caches history by runner platform, architecture, Node version, adapter, declared environment, dependency/configuration hash and revision. It does not accept arbitrary shell commands as action inputs. External adapter shadow mode runs native full scope; individual-test comparison remains available through the JS/TS runner. The composite workflow has a hosted [smoke workflow](../.github/workflows/action-smoke.yml) that exercises the checked-out action, native discovery, subset proposal, full shadow outcomes and retained artifacts. Passing local adapter tests do not establish hosted results. `audit` defaults to true and retains a scoped quality audit alongside execution evidence.
