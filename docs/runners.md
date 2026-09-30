# Native runner evidence

TDDSwarm retains filesystem discovery by default for compatibility. Set `"discovery": "native"` to reconcile selection with the configured runner's real collection scope. A failed discovery returns fallback files with an explicit incomplete warning: it cannot authorize omission or certify shadow recall.

```json
{
  "discovery": "native",
  "runner": ["npx", "--no-install", "vitest", "run", "{files}"],
  "env": {"NODE_ENV": "test"},
  "environment": {"database": "fixture-v1"}
}
```

The adapter is inferred from the runner argv. `"adapter": "jest"`, `"vitest"`, or `"node"` overrides inference for wrappers. TDDSwarm invokes argv directly, without a shell. `env` values override inherited process environment; the inherited `NODE_TEST_CONTEXT` is removed so nested Node runners start independently. Each invocation has a default two-minute timeout, configurable through `runnerTimeoutMs`.

| Runner | Discovery | Execution evidence | Resolution |
| --- | --- | --- | --- |
| Node 22+ | Actual `node --test` collection with a never-matching case-name filter | Public `node:test` reporter events and terminal summary | Existing static JS/TS resolver |
| Jest | `--listTests --json` | `--runTestsByPath --json --outputFile` | Native `jest-resolve`, configured extensions, resolver, module directories and `moduleNameMapper` |
| Vitest | `list --filesOnly --json=<temporary-file>` | `run --reporter=json --outputFile` | Vite plugin-container resolution with the loaded Vitest/Vite config and aliases |
| Custom | Explicit discovery protocol | Process exit and output; incomplete case evidence | Existing static resolver |

Native resolutions are batched per loaded framework configuration. Local static and native resolutions are retained together when aliases disagree. Vitest resolution follows its effective test environment and explicit mode; unsupported contexts remain conservative. Explicit runner configuration files and their imported configuration dependencies are global invalidation inputs.

Node discovery includes actual native conventions such as `test/foo.js`, which legacy filename discovery does not recognize. Discovery can evaluate test-module top-level code; Node's case filter suppresses case callbacks, not module imports. Framework collection and configured resolver plugins can likewise execute project code. Discovery is a local execution step, not a static analysis sandbox.

Custom discovery is a nonempty argv array, for example `"discovery": ["node", "scripts/list-tests.js"]`. It must emit exactly one JSON object on stdout:

```json
{"files":["suite/custom.js"],"complete":true}
```

Files must exist inside the project and avoid symlink traversal. Invalid JSON, unsafe files, a nonzero status, or absent completeness marks discovery incomplete. A custom runner without normalized reporting can execute successfully but never certify case-level shadow evidence.

## Results, shadow runs, and failure retention

`execute(root, files, config, options)` returns normalized `tests` with stable `id`, project-relative `file`, full `name`, `status` (`passed`, `failed`, `skipped`), and `durationMs`. It also returns `collectionFiles`, `requestedFiles`, `missingFiles`, `unknownFiles`, `complete`, `exitCode`, `stdout`, `stderr`, and actual `command`. IDs include file, name, Node source location where available, and duplicate ordinal; moving or renaming a case changes its ID. Skipped and todo cases are not passing assertions. File-load failures are recorded as `<file-load>`.

Missing/invalid native reports and successful processes that collect a different file scope fail closed with exit code 2. Timeout, signals, missing files, out-of-scope files, and native runtime errors cannot produce complete evidence. Generic custom execution is explicitly incomplete even when its process exits successfully.

A plan binds the source and declared service inputs before discovery and graph construction. Execution checks this decision snapshot again before running any test, including an empty selection; changed inputs return incomplete evidence with exit code 2.

`run --shadow` always executes all discovered files, including when the proposed subset is empty. Its `comparison` records individual failing case IDs omitted by proposed file membership, `omittedFailures`, and decision recall when complete evidence contains failures. No-failure runs have no measurable failure recall, so `decisionRecall` is null. `certified` means this comparison has complete runner/discovery evidence; it is not a deployment guarantee. Full-run outcomes do not establish that separately running the subset has identical order-dependent behavior.

History authority lives in `.tddswarm/history-<runner-identity>.json`. The identity includes runner argv, configured environment and env overrides, Node version, platform, architecture and the tracked inherited environment inputs. History stores failed files, individual failed cases, run count, and source/revision provenance. Incomplete runs retain every executed file for retry. Passing one subset preserves failures remembered from unexecuted files. `history.json` remains a compatibility receipt; namespaced history is authoritative.

Configure labels for external environment state in `environment` (for example database fixture revision or service contract version). Arbitrary inherited credentials, remote service state, and every possible runner-specific environment variable are not automatically modeled. Keep such state stable or explicitly label it; changing an unmodeled external input cannot prove invalidation.

## Reproducing runner smoke tests

The normal test suite covers Node and the custom discovery protocol. Installing pinned Jest/Vitest development tools enables genuine framework smoke tests without modifying a tested project's dependency declarations:

```sh
npm install --prefix /tmp/tddswarm-runner-tools --no-audit --no-fund jest@30.2.0 vitest@5.0.2
TDDSWARM_JEST_BIN=/tmp/tddswarm-runner-tools/node_modules/jest/bin/jest.js \
TDDSWARM_VITEST_BIN=/tmp/tddswarm-runner-tools/node_modules/vitest/vitest.mjs \
node --test test/runner-native.test.js
```

These fixtures exercise custom collection patterns, excluded files, individual passes/failures/skips, exact subset execution, and real Jest/Vite aliases. Standard dependency resolution also enables these tests when those tools are installed in TDDSwarm's development environment.

Runner contracts were checked against [Node's public test runner documentation](https://nodejs.org/docs/latest-v22.x/api/test.html), [Jest CLI documentation](https://jestjs.io/docs/cli), [Vitest CLI documentation](https://vitest.dev/guide/cli.html), and pinned installed CLI help. Vitest's published documentation may describe newer majors: the reproducible smoke evidence here specifically uses 5.0.2.
