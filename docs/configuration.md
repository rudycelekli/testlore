# Configuration and selection boundaries

`tddswarm.config.json` uses executable/argument arrays. No shell interpolation is performed. Exactly one standalone `{files}` item is required; it expands to individual `./path` arguments. Node's test runner is the default.

```json
{
  "runner": ["npx", "--no-install", "vitest", "run", "{files}"],
  "adapter": "vitest",
  "discovery": "native",
  "alwaysRun": ["test/smoke.spec.ts"],
  "dependencies": {
    "test/landing.spec.ts": ["public/copy.json", "public/theme.css"],
    "test/api.spec.ts": ["contracts/api.json"]
  },
  "ignoreChanges": ["CONTRIBUTING.md"],
  "fullRunEvery": 20
}
```

For Jest: `["npx", "--no-install", "jest", "--runTestsByPath", "{files}"]`. For Node: `["node", "--test", "{files}"]`. A custom wrapper must accept the exact files and exit nonzero on failures. Configured executables run with your permissions. TDDSwarm does not override your runner's setup, environment, or services.

## Discovery

New configurations use native discovery. Node, Jest and Vitest report their configured file scope; a failed or incomplete collection blocks execution with exit 2. Custom discovery is an argv array returning `{ "files": ["suite/check.js"], "complete": true }`. It is a trusted collection attestation. See [native runners](runners.md).

Static discovery recognizes `.test`/`.spec` JS/TS variants and `__tests__`. `testMatch`/`testExclude` arrays configure additional glob patterns. Static conventions describe only that declared scope. Bare Node test-directory names are supported through native discovery. Other ecosystems use [external adapters](integrations.md).

Git-tracked and nonignored untracked files are scanned; symlinks and `.git`, `node_modules`, `.tddswarm`, `.firecrawl`, `coverage`, `dist`, `build`, `.next` directories are excluded. Without Git, filesystem discovery works, but executing a Git-based plan falls back to the full discovered suite. Run your original native full-suite command in CI until discovery matches your intended scope.

## Git comparison

`--base HEAD` compares the current working tree to HEAD, including staged, unstaged, and untracked files. It does **not** mean “the latest committed change.” For a committed pull request, use its merge base or explicit base SHA:

```sh
npx --no-install tddswarm plan --base <base-sha> --json
npx --no-install tddswarm run --shadow --base <base-sha>
```

Fetch enough history to resolve that SHA. Deleted files and removed imports are evaluated with old source edges where available. `.tddswarm/` metadata does not count as a source change. Invalid Git references cause full selection, with an explicit reason.

`--changed a.js,b.js` is a diagnostic simulation. CLI `run` refuses it because manually supplied paths may omit real changes. The library API supports explicit paths for embedding; its caller owns completeness.

## Policies

- `dependencies` maps a discovered test path to exact project paths, including non-code assets. Missing paths or unknown tests are uncertainty, not permission to skip.
- `alwaysRun` retains listed test files, even without changed files. Use it for critical smoke/integration checks.
- `ignoreChanges` lists exact paths explicitly excluded by your policy. The default is empty. Known dependency relationships take priority over this exclusion. Ignore entries are a user judgment, not safety evidence.
- `fullRunEvery` is a positive number of recorded runner invocations. It defaults to 20 on initialization. Runs selecting no files do not increment it. In ephemeral CI, persist `.tddswarm/history-*.json` if you want this count across jobs. Otherwise use independent full-suite branch/schedule policies.
- Native failed case/file outcomes are retained by runner/dependency/environment identity. Incomplete reporting retains all executed files. Successful retries clear only the executed scope; unrelated remembered failures remain. The compatibility `history.json` receipt is not the primary authority.
- `environment` is a map of stable labels; `env` supplies child-process overrides. Relevant runner/dependency state, Node/platform/architecture and action environment partition history. Explicit [service versions](evidence.md) invalidate runtime and quality evidence.

## Static evidence limits

A path proves a relationship in the supported graph, not complete runtime behavior. Computed dependencies, detected filesystem/VM/child-process usage, parse errors, unresolved relative imports, unresolved internal packages and unsupported transforms cause conservative full selection when inputs change. Ordinary third-party imports are treated as external; lock/config changes trigger full runs.

TypeScript paths/baseUrl/extends and supported native Jest/Vite aliases resolve local imports. Root or explicitly configured tsconfig determines TS resolution. Node capture observes exercised local modules and file reads; browser routes, contracts and external services use explicit declarations. Transitive third-party behavior, unexercised branches, custom transforms, network/database state and implicit setup still need project policy. Third-party packages can hide dependencies that static parsing cannot detect. Declare relevant inputs, retain smoke tests, and use full native runs to verify the scope. Graph warnings anywhere in the project currently broaden all tests; precision will improve with evidence, not speculative skipping.

Shadow mode records the proposed subset while running all **discovered** files. It compares failed case identities against proposed file membership and reports decision recall when observed failures exist. It does not run a separate subset, so order-dependent failures require additional comparisons. Test-count reduction is reported separately from elapsed runner time. Neither result proves untested defects are absent.

Runtime capture/import, browser route declarations, contracts, service versions/probes and measured quality formats are documented in [evidence](evidence.md). Missing or stale required runtime evidence widens selection. `runtime.closedWorld` explicitly allows exercised runtime observations to resolve detected dynamic uncertainty; it is a policy assumption about unexercised behavior.
