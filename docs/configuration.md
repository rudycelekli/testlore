# Configuration and selection boundaries

`tddswarm.config.json` uses executable/argument arrays. No shell interpolation is performed. Exactly one standalone `{files}` item is required; it expands to individual `./path` arguments. Node's test runner is the default.

```json
{
  "runner": ["npx", "--no-install", "vitest", "run", "{files}"],
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

Test files end in `.test.js`, `.spec.js`, or their JS/TS/JSX/TSX/CJS/MJS/CTS/MTS variants. Source files under `__tests__/` are also discovered. Bare `test/foo.js`, Python, Rust, Go, custom names, and runner-generated tests are not supported by discovery. Runtime adapters and configurable discovery are planned. `run` exits 2 when no supported test files exist, instead of certifying a project without tests.

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
- `fullRunEvery` is a positive number of recorded runner invocations. It defaults to 20 on initialization. Runs selecting no files do not increment it. In ephemeral CI, persist `.tddswarm/history.json` if you want this count across jobs. Otherwise use independent full-suite branch/schedule policies.
- Failed runs retain **all files executed in that run**, because this runner protocol has no individual failure report. The next successful retry clears them. Shadow failures retain the full executed scope. History is local and optional; missing history carries no known failures.

## Static evidence limits

A path proves a relationship in the supported graph, not complete runtime behavior. Computed dependencies, detected filesystem/VM/child-process usage, parse errors, unresolved relative imports, aliases, `tsconfig` paths/baseUrl/extends, and package imports/exports/workspaces cause conservative full selection when inputs change. Ordinary third-party imports are treated as external; lock/config changes trigger full runs.

Transitive runtime loading inside third-party packages, custom transforms, services, databases, environment variables, generated code, implicit setup, and injected browser routes are not observed. Third-party packages can hide dependencies that static parsing cannot detect. Declare relevant inputs, retain smoke tests, and use full native runs to verify the scope. Graph warnings anywhere in the project currently broaden all tests; precision will improve with evidence, not speculative skipping.

Shadow mode records the proposed subset while running all **discovered** files. It does not yet compare individual test failures against omitted tests automatically. Test-count reduction is reported separately from elapsed runner time. Neither result proves untested defects are absent.
