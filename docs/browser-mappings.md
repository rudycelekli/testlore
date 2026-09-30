# Browser observations and reviewable mappings

TestLore can observe native Playwright cases, associate page requests and executed JavaScript/CSS coverage with each native case identity, and propose route dependencies for review. The project's Playwright SDK supplies browser execution. TestLore never installs a browser, rewrites tests, downloads source maps, or changes configuration while observing or proposing mappings.

Install TestLore locally alongside the project's Playwright Test dependency before using its fixture. A temporary `npm exec` invocation alone does not make `testlore/playwright` importable by project tests. Extend the existing SDK test:

```js
import { test as base, expect } from '@playwright/test';
import { createBrowserTest } from 'testlore/playwright';

const test = createBrowserTest(base);
test('landing copy', async ({ page }) => {
  await page.goto('http://127.0.0.1:3000/landing.html');
  await expect(page.getByRole('heading')).toHaveText('Community tools');
});
```

`proposeBrowserInstrumentation(root, { files })` offers these edits as a sealed proposal for an improvement branch. It parses files with TypeScript's AST and preserves named SDK aliases, `expect`, and type imports. It supports one static named `test` import from `@playwright/test`; existing fixture modules, namespace/CommonJS imports, collisions, malformed files and imports after executable code require manual integration. It retains original/proposed hashes and full pre-proposal source/runner/configuration provenance. It does not write files or alter assertions. Independently execute and review the proposed instrumentation on an isolated branch.

The fixture runs normally when capture is disabled. `captureBrowserEvidence(root, { timeoutMs: 120000 })` enables it for the actual native configured scope, uses the existing native reporter and joins `testId`, repeat context and attempt to normalized outcomes. A capture is complete only when native discovery and execution are complete, every collected case passes without retries/skips, every case has instrumentation, Chromium coverage finishes, and source/configuration/service provenance remains fresh. Artifacts remain under ignored `.tddswarm/browser/`; query strings, fragments and URL credentials are removed. Capture is bounded to 2,000 cases, 2 MiB per case, 16 MiB of case artifacts, 256 covered scripts/styles per case, and a finite runner deadline.

Then declare the authority that relates served URL paths to project files:

```js
import { captureBrowserEvidence, proposeBrowserMappings } from 'testlore';

const evidence = captureBrowserEvidence(process.cwd());
const proposal = proposeBrowserMappings(process.cwd(), evidence, {
  urlRoots: [{
    origin: 'http://127.0.0.1:3000',
    urlPrefix: '/',
    directory: 'public'
  }],
  serverInputs: {
    '/landing.html': ['src/server.js', 'templates/landing.html']
  }
});
```

`urlRoots` use exact redacted HTTP origins and path prefixes ending in `/`. Each observed request must match exactly one root and a safe existing project file. Script and stylesheet files can reference bounded local v3 source maps; their `sources` and relative `sourceRoot` resolve only to safe, tracked local files. URL schemes, indexed maps, remote/data maps, symlinks, escaped paths, missing files, oversized bundles and ambiguous origins remain unresolved. No source-map contents execute and no remote map is fetched. Generated `dist`/`build` outputs excluded from core provenance cannot silently acquire dependency authority. The explicit inspection API below binds their current bytes and provides source suggestions while preserving unresolved build completeness.

`serverInputs` are explicit review declarations for routes on the known origin. They associate application handlers, templates, loaders and other server-side sources that browser coverage cannot see. Route observations alone cannot infer a handler or a database dependency. External services still require explicit versioned service declarations. Query-dependent routing and other service state need separate review because captured URLs deliberately discard sensitive query values.

The proposal includes per-case dependencies, request gaps, exact source/runner/configuration hashes and proposed `browser.routes` entries. Existing manual route declarations are preserved. **Every proposal has `reviewRequired: true` and `closedWorld: false`.** Failed/incomplete captures remain visibly incomplete; proposals never become automatic completeness attestations. Route-level declarations select files using the existing declared-input layer after explicit branch validation/review. Do not set a closed-world policy merely because captured coverage or network requests look extensive.

Unknown input mappings, additional pages, missing fixture coverage, Firefox/WebKit coverage gaps and source-map gaps remain review warnings and require conservative routing. This first fixture observes the injected `page` only; popups, separately created pages, frame-only routes, service workers and unexercised behavior cannot certify the application's entire dependency universe. The native runner supplies case outcomes; browser coverage supplies observations, not new passing-test authority.

## Reproduce the controlled qualification

With `@playwright/test@1.63.0` and its Chromium browser already installed:

```sh
node scripts/browser-mapping-proof.js --output /tmp/browser-mapping-proof.json \
  --raw-directory /tmp/browser-mapping-raw
TESTLORE_PLAYWRIGHT_BROWSER=1 node --test test/browser-evidence.test.js
```

The fixture serves two separate HTML routes, styles and JavaScript bundles. Local source maps identify their independent source modules. Only the relevant route's dependencies are proposed. Three independently planted heading, stylesheet and module defects must fail the same named case in both full and selected native Chromium runs. The result measures mapping fidelity on this fixture; it makes no claim about general fault recall, learned quality gains, deployment safety or wall-clock savings.

The retained [receipt](../benchmarks/browser-mapping-verification.json) was produced with the already installed Google Chrome **154.0.8037.58** (`--channel chrome`) and Playwright Test **1.63.0**. It does not claim the bundled Chromium revision was installed locally. [Normalized public raw artifacts](../benchmarks/browser-mapping-raw/fixture.json) retain the controlled source and actual case outcomes with local scratch paths and ephemeral server ports removed; receipt hashes bind these normalized artifacts. Hosted qualification can use its explicitly installed bundled Chromium.

## Conservative navigation scope

Native Playwright files are retained on every active change unless an operator explicitly asserts `browser.closedWorld: true` **and** each omitted file belongs to a reviewed route input declaration. Importing a local assertion helper does not make a page's server/browser inputs statically complete. Automatic mappings and generated-build suggestions never set this assertion. Complete route declarations must cover relevant server handlers, templates, scripts, styles, build configuration and service contracts, including unexercised paths; captured JS/CSS ranges cannot establish that guarantee. Missing/unknown declared inputs still widen the whole run. The small two-route proofs assert this policy only because their entire controlled server/asset contract is manually scoped. Normal adoption stays in full shadow validation until maintainers qualify their contracts.
## Inspect generated application bundles

Real applications commonly serve ignored `dist` or `build` outputs. Inspect selected files explicitly without running a build:

```js
import {
  inspectBrowserBuildArtifacts,
  validateBrowserBuildArtifacts,
  proposeBrowserMappings
} from 'testlore';

const buildManifest = inspectBrowserBuildArtifacts(process.cwd(), {
  artifacts: ['dist/assets/app.js', 'dist/assets/app.css']
});
const proposal = proposeBrowserMappings(process.cwd(), evidence, {
  urlRoots: [{
    origin: 'http://127.0.0.1:3000',
    urlPrefix: '/assets/',
    directory: 'dist/assets'
  }],
  buildManifest
});

// Recheck immediately before accepting any suggestion; source provenance alone
// cannot detect tampering with ignored generated output.
validateBrowserBuildArtifacts(process.cwd(), proposal.buildManifest);
```

The sealed manifest contains source/runner/configuration provenance, raw bundle and map SHA-256 hashes, byte counts and safe tracked source references. Inspection accepts at most 1,000 unique explicit JavaScript/CSS bundle paths, 2 MiB per bundle/map, 16 MiB total and 10,000 source references across maps. Source maps must be local v3 maps with bounded `sources`; unsupported maps, escapes, symlinks, remote references and missing tracked sources remain unresolved. Source files, configuration, bundle bytes and mapping bytes must all stay fresh when the manifest is reused. Inspection does not run builds, execute maps, import an SDK, fetch URLs or write source/configuration. Configured executable service probes are rejected during inspection/revalidation; use fixed or environment-based service declarations for this read-only operation.

For an observed ignored bundle, each case exposes `generatedBuildSuggestions` and `sourceSuggestions`. These are separate from authoritative declared dependencies and from proposed route `inputs`. The request retains `generated-build-completeness-unverified`; the proposal retains `unverified-build-completeness`, `reviewRequired: true`, and `closedWorld: false`. The build manifest is embedded and hashed into the proposal for later byte revalidation. This proves which bytes were inspected and which local sources the map names. It does not prove the map is truthful, that every runtime input appears in it, that output corresponds to the current build, or that unexercised branches are safe to omit. A reviewer must establish complete application/server/build/service scope before asserting a closed world; observed coverage and generated maps cannot make that assertion automatically.

## Qualify a proposed mapping in independent native runs

`qualifyRoutingMappings` evaluates the actual proposal before maintainers accept its configuration changes. It merges only proposed route/dependency additions into a disposable candidate configuration, preserves existing manual declarations, and executes the native full suite and proposed subset in separate source copies. The original project's tests, configuration and run history remain unchanged.

```js
import { qualifyRoutingMappings } from 'testlore';

const qualification = qualifyRoutingMappings(process.cwd(), proposal, {
  changed: ['public/landing.html'],
  timeoutMs: 30000,
  // Optional controlled defect; applied independently to both scratch copies.
  defects: [{
    path: 'public/landing.html',
    content: '<h1>Wrong heading</h1>'
  }]
});

console.log(qualification.selection?.selected);
console.log(qualification.preservation); // missing/changed/extra native case IDs
console.log(qualification.missedFailures, qualification.unexpectedFailures);
console.log(qualification.conservativeFallback);
```

The same API accepts `routingProposals(root)` for monorepo/literal filesystem input suggestions. Candidate dependencies add edges without replacing existing manual dependencies. Local workspace package links are rebound to the copied package sources, so an optional package-source defect executes in both scratch roots; installed registry dependencies remain shared and trusted. This is source/configuration isolation, not an execution sandbox. Ignored generated bundles are copied only when explicitly bound by the proposal's validated build manifest; unresolved build completeness still requires full fallback.

For browser proposals, subset selection temporarily evaluates `browser.closedWorld: true` **only inside the candidate copy as a hypothesis to challenge**. The returned proposal and qualification retain `closedWorld: false`, `reviewRequired: true` and `applied: false`. Even a qualified browser result requires conservative full execution until a maintainer independently reviews and asserts a complete application contract. No API installs a browser, enables mappings, changes the original configuration or creates an automatic completeness attestation.

The report retains native full/subset case identities, statuses, selected files, candidate configuration hash, source provenance and scenario hashes. Qualification fails closed on incomplete discovery/reporting, native inventory changes, missing/extra/changed selected cases, missed full-suite failures, unexpected subset failures, skipped/retried cases, source drift or incomplete observations. A supplied defect must produce a full-suite failure to count as a demonstrated challenge. A passing run without defects qualifies only observed case preservation for the explicit change scenario; it measures no fault recall or dependency completeness. Incomplete evidence returns full fallback and cannot certify that no failures were missed.

Qualification accepts 1–1,000 unique changed project paths, at most 20 explicit source defects (512 KiB each), 10,000 source files, 8 MiB per source file and 128 MiB total copied bytes. Test/configuration defects are rejected. Each native discovery/execution has a 1–120 second deadline, and native inventories/reports are limited to 2,000 files/cases. Configured executable service probes are rejected before reading provenance in the original workspace; use fixed or environment-based service versions. Disposable copies are removed after each run.

Reproduce both a correct proposal and a deliberately misrouted proposal using the already installed browser:

```sh
node scripts/browser-mapping-proof.js --channel chrome --qualify \
  --output /tmp/browser-qualification.json \
  --raw-directory /tmp/browser-qualification-raw
TESTLORE_BROWSER_CHANNEL=chrome TESTLORE_PLAYWRIGHT_BROWSER=1 \
  node --test test/mapping-qualification.test.js
```

The correct proposal must preserve the same failing landing case in independent full/subset runs. The misrouted proposal must report the omitted landing failure and require full fallback. These are controlled native qualification fixtures, not a claim of general application recall.

`timeoutMs` is a per-native-process deadline, not a total wall-clock promise. `overallTimeoutMs` adds a monotonic evaluation budget of 1–600 seconds (by default six times the process deadline, capped at 600 seconds). The evaluator checks this budget before native phases and rejects a result that finishes late with `overall-evaluation-budget-exceeded`; it cannot forcibly interrupt synchronous source copies, snapshots or planning. The report's `budget` records both limits and elapsed evaluation time, and explicitly sets `hardWallClockBound: false`. Final report sealing is additional work. An expired budget requires full fallback even when an earlier native phase returned a complete report.

## Qualify from the CLI

Save the output of `testlore mappings --json` or `testlore browser-mappings --report OBSERVATIONS --settings URL_MAPPING --json` under `.tddswarm/`, then explicitly execute the review-only check:

```sh
testlore mapping-qualify --report .tddswarm/proposal.json \
  --changed public/landing.html --execute --json
```

The command requires a provenance-bound proposal (at most 2 MiB) and a diagnostic change scenario. It independently runs native full and proposed scopes in disposable source copies. Exit 0 means qualification in that observed scenario; exit 1 means complete evidence disagreed or remained insufficient, and exit 2 means incomplete execution or invalid input. It leaves mappings unapplied. Fault challenges are available through the API's explicit `defects` option; this CLI command alone does not plant bugs or measure defect recall.
