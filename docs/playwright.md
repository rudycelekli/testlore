# Native Playwright execution

TestLore executes the project's installed Playwright Test CLI and uses a [custom reporter](https://playwright.dev/docs/test-reporters#custom-reporters) through the public [Reporter API](https://playwright.dev/docs/api/class-reporter). Playwright supplies browser execution and assertions; TestLore adds normalized evidence, candidate gates and file routing. The controlled qualification uses **@playwright/test 1.63.0**, Chromium revision **1243**.

Install Playwright and its browsers using the upstream instructions. TestLore does not install browsers or packages while discovering or executing tests. Configure the project:

```json
{
  "adapter": "playwright",
  "discovery": "native",
  "runner": ["node", "node_modules/@playwright/test/cli.js", "test", "{files}"],
  "browser": {
    "routes": {
      "/landing": {
        "tests": ["browser/landing.spec.ts"],
        "inputs": ["src/landing.tsx", "public/landing.json"]
      }
    }
  }
}
```

`adapter: "playwright"` also resolves the project-local CLI when `runner` is omitted. Explicit runner arguments retain configuration, project and repeat settings. File filters are escaped and anchored because Playwright's native CLI interprets file arguments as regular expressions. Native `test --list` supplies collection evidence; static filename matching alone does not certify browser scope.

The reporter binds the `onBegin` inventory to `onEnd` outcomes and the terminal `onExit` seal. Names and identifiers preserve project and repeat context. Attempt statuses, retries, durations and assertion errors remain in normalized results. A passing retry is **flaky**, not green quality evidence. A test expected to fail also remains failed evidence even if Playwright considers its outcome expected. Skipped cases are reported separately. Missing reports, loader/global errors, empty scope, unfinished cases, interrupted runs or mismatched inventories remain incomplete.

Configured setup and teardown dependency projects execute normally and their extra files appear in `executedFiles` and `dependencyFiles`. Reporter and artifact output locations are owned by the adapter; temporary browser outputs are cleaned up after normalization. This adapter retains case evidence, not an HTML report or trace archive. Execution uses argv without a shell, a finite runner timeout and a kill signal. Project code, fixtures, dependencies and hooks remain trusted executable code; disposable copies are not a security sandbox.

Scope-restricting CLI/configuration options such as grep, sharding, last-failed lists, embedded positional test filters and `--no-deps` cannot certify full collection through this adapter. Interactive, agent-generation and source/snapshot-update options are rejected; `--forbid-only` and `--update-snapshots=none` are supplied. An explicitly configured project scope is supported with its dependency projects. Native configuration still needs complete declared application/server/asset inputs: browser navigation does not create import edges to a page's source. Unknown graph contexts continue to force the existing full-suite fallback. External services require the existing service-version declarations.

## Reproduce the real browser qualification

With the pinned SDK and Chromium already installed in the project or a separate tooling directory:

```sh
node scripts/playwright-proof.js \
  --module-root /path/to/installed-tooling \
  --output /tmp/playwright-verification.json \
  --raw-directory /tmp/playwright-raw

TESTLORE_PLAYWRIGHT_BROWSER=1 npm test
```

Hosted Linux setup can use `npm ci --ignore-scripts`, then `npx playwright install --with-deps chromium`. The browser test is explicitly enabled by `TESTLORE_PLAYWRIGHT_BROWSER=1`; regular native adapter tests require the installed SDK but no browser launch. `TESTLORE_PLAYWRIGHT_MODULE_ROOT` can point tests at independently prepared tooling. The proof itself never downloads or installs anything.

The [retained receipt](../benchmarks/playwright-verification.json) uses two real localhost routes and independent fixed heading/copy assertions. A paragraph edit selects only the landing browser file while full and selected execution pass. A planted incorrect heading fails the same named case in both runs. A manually authored candidate preserves original cases and adds a paragraph assertion; complete original/candidate browser validation and a held-out heading defect pass without applying the patch. Every validation copy starts its own localhost server against its own HTML, so copied source defects are actually exercised.

The [raw fixture](../benchmarks/playwright-raw/fixture.json) and normalized reports preserve actual source, assertions, server fixture, selection, browser outcomes and candidate validation. Raw hashes appear in the receipt. The fixture server is an explicit controlled dependency, not an external service. This is two routes and one defect, with no model/provider calls; it establishes scoped compatibility and fault observation, not general browser fault recall, deployment safety or measured wall-clock savings. Native discovery and browser startup still have costs.
