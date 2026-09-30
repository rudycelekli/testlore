# Measured quality and dependency evidence

Static test grades, measured quality, and observed impact dependencies answer different questions. `audit --json` reports measured evidence alongside static findings; its structural score does not become a coverage score or prove that assertions detect meaningful defects. Every measured record names its source snapshot, runner/environment identity, scope, and raw evidence.

## Snapshot before measuring

Run the snapshot command inside the project, before generating a coverage or mutation report:

```sh
tddswarm snapshot --output .tddswarm/before-quality.json --json
# Run the project's configured coverage or mutation tool here.
tddswarm evidence --type coverage --report coverage/coverage-summary.json \
  --provenance .tddswarm/before-quality.json --json
tddswarm evidence --type mutation --report reports/mutation/mutation.json \
  --provenance .tddswarm/before-quality.json --json
tddswarm audit --json
```

Configure generated report directories as Git-ignored outputs or use `.tddswarm/`; otherwise a newly created report can itself become a source input and invalidate the pre-run snapshot. Coverage's standard output directory is excluded from scanned inputs. Reports do not run your coverage or mutation tools automatically.

`snapshot(root, config)` returns `schemaVersion: 1`, a Git `revision` when available, `runner`, `environment`, per-file content hashes in `files`, hashed declared service tokens in `services`, `serviceWarnings`, and a combined `fingerprint` over files, runner, and service state. Scanning follows the normal project file boundaries, excluding symlinks, generated directories, ignored untracked files, `.tddswarm/`, and `.firecrawl/`. Commit identity is recorded; freshness checks source bytes and runner identity rather than requiring an identical Git revision when bytes are unchanged.

Runner identity includes configured argv/adapter, `env` overrides, environment labels, Node version/platform/architecture, modeled inherited `NODE_ENV`/`TZ`, action environment, and supported dependency/configuration manifests. Use `environment` labels for external state that content hashes cannot see. Arbitrary inherited variables, live database contents, service responses, and untracked ignored inputs are not automatically fingerprinted.

`freshness(record, current)` verifies the snapshot fingerprint and rejects invalid provenance, source drift, changed runner/environment identity, unavailable service tokens, or changed service versions. Service checks apply to quality, stability, candidate, and runtime evidence, so a source-identical project cannot reuse evidence across a changed declared service version. Quality imports require a pre-run provenance file or object and reject drift before attaching the report. Evidence receipts include an integrity hash, and quality reads also verify the retained raw report hash. These detect accidental edits and mismatched retained artifacts; they do not authenticate how a separately supplied report was produced.

## Coverage and mutation reports

The library API is `ingestQuality(root, type, reportPath, { provenance, scope })`, where `type` is `coverage` or `mutation`. `provenance` accepts a pre-run snapshot object or a file path. An explicit `scope` label is available through the library; CLI imports use the default label directing readers to the raw report.

| Evidence | Accepted format | Reported measurements |
| --- | --- | --- |
| Coverage summary | Istanbul `coverage-summary.json` with `total.lines`, `.statements`, `.functions`, and `.branches`, each containing numeric `covered` and `total` | Covered/total counters and derived percentages for each dimension |
| Coverage detail | Istanbul `coverage-final.json` entries containing `statementMap`, statement counts `s`, branch arrays `b`, and function counts `f` | Statements, branches, functions, and statement-derived covered lines |
| Mutation | Stryker mutation JSON with `files` and each file's `mutants` array | Status counts, valid/detected mutants, score, excluded count, and whether unfinished mutants remain |

Coverage percentages use report counters; a zero denominator produces `null`, not a fabricated 100%. Detail-report line coverage groups statement counts by source line, so it is not an independent instrumenter's line map. Unsupported or invalid counters fail import.

Mutation score is `(Killed + Timeout) / (Killed + Timeout + Survived + NoCoverage)`. `CompileError`, `RuntimeError`, and `Ignored` are excluded and reported. `Pending` marks the report incomplete; incomplete mutation evidence is not labeled measured. A timeout contributes to this standard counter formula but does not independently establish a meaningful oracle. Unknown statuses fail import.

Receipts and raw JSON are retained in `.tddswarm/evidence/quality/coverage.json`, `coverage.raw.json`, `mutation.json`, and `mutation.raw.json`. `qualityEvidence(root)` returns coverage, mutation, and stability records with freshness information. Missing, invalid, stale, incomplete or zero-eligible-scope evidence remains unmeasured. Quality measurements currently inform the audit; aggregate coverage and mutation reports do not create per-test impact edges.

## Repeated execution and observed instability

```sh
tddswarm stability --repeat 5 --json
```

`measureStability(root, { repeat })` executes the discovered full file scope repeatedly, with 2–50 repetitions and a default of 5. It compares normalized case IDs across rounds and records each case's status sequence. A case observed both passing and failing is `unstable`; incomplete discovery, missing identities, incomplete runner reports, or source drift make evidence incomplete. Merely using a timer or sleep is not measured flakiness.

The record contains `scope`, `repeat`, raw `rounds`, per-identity status sequences in `metrics.observed`, `metrics.unstable`, and source/runner provenance. It is saved as `.tddswarm/evidence/quality/stability.json`. CLI exit codes are 0 for complete observations without instability, 1 for observed instability, and 2 for incomplete evidence. Always inspect the discovery scope and receipt: repeated outcomes establish behavior in those runs, not permanent reliability or correctness under other environments, schedules, or inputs.

## Runtime imports and filesystem inputs

Configure capture and policy before taking the snapshot, then run:

```json
{
  "runner": ["node", "--test", "{files}"],
  "adapter": "node",
  "discovery": "native",
  "runtime": { "enabled": true }
}
```

```sh
tddswarm capture --json
tddswarm plan --base HEAD --json
```

`captureRuntime(root)` launches one Node invocation per discovered test file, gathers V8 module coverage, and adds filesystem-read observations from a preload hook. The hook observes `readFileSync`, callback/promise `readFile`, `createReadStream`, and promise `open` paths inside the project. It does not intercept every filesystem API, native extension, child-process communication, network call, or browser resource request. Captures are local executions with the project's permissions, not a sandbox.

The per-file observation includes the test itself, observed local module/read paths, and declared inputs. It is complete only after a successful normalized runner result and both coverage and trace output. The full receipt requires complete discovery, unchanged provenance, available and unchanged service versions before/after capture, and a complete observation for every discovered file. Failing tests, crashes, missing trace output, source drift, or missing service evidence prevent a complete capture. Raw outputs are retained under `.tddswarm/runtime/<captureId>/`; the active record is `.tddswarm/evidence/runtime.json`.

`runtimeEvidence(root, graph, changed, config)` is the internal selection reader. It requires an enabled runtime policy, a complete receipt, exact discovered file scope, complete observation arrays, and compatible provenance. It allows drift only in declared `changed` paths during impact planning; unlisted drift rejects evidence. Missing, invalid, stale, and scope-mismatched receipts force conservative full selection. The built-in capture path supports Node. Other producers can import the per-file runtime protocol described below.

Runtime edges supplement known static and declared edges. By default they do not suppress dynamic-import or filesystem uncertainty. `"runtime": {"enabled": true, "closedWorld": true}` is an explicit user policy permitting complete observations to address `dynamic-dependency` and `runtime-dependency` warnings. Configure it before capturing: editing the policy afterward changes provenance. Parse errors, unresolved paths, loader registration, and other uncertainty remain conservative. A closed-world declaration is a project assumption about the exercised paths, not proof that all future runtime branches or inputs have been observed.

## Importing runtime evidence from other producers

```sh
tddswarm snapshot --output .tddswarm/before-runtime.json --json
# Run an instrumented browser/custom runner that emits the protocol below.
tddswarm capture --report .tddswarm/runtime-producer.json \
  --provenance .tddswarm/before-runtime.json --json
```

`ingestRuntime(root, reportPath, { provenance })` accepts a pre-run snapshot object or file. The producer report must include `schemaVersion: 1`, `type: "runtime"`, `complete: true`, a `tests` array covering every discovered test file exactly once, and a complete `observations` entry for each file. Dependencies must be known project files or declared service inputs. For a project without services, a minimal report shape is:

```json
{
  "schemaVersion": 1,
  "type": "runtime",
  "complete": true,
  "tests": ["test/landing.test.js"],
  "inputs": {},
  "observations": {
    "test/landing.test.js": {
      "complete": true,
      "dependencies": ["public/copy.json", "public/theme.css"]
    }
  }
}
```

When services are configured, `inputs` must contain their current `service:<name>` version hashes, matching the `serviceInputs(root, config).values` contract in `src/inputs.js`: each value is the SHA-256 hex digest of `String(version)`. Missing or changed service versions reject the import. The importer adds each test itself and all declared inputs to its observations, checks exact discovery scope and source/runner freshness, and writes an integrity-protected receipt plus `runtime.raw.json`. Invalid paths, partial scope, false completeness, or stale provenance cannot authorize selective execution.

An imported producer's completeness declaration is trusted. TestLore validates the protocol and its binding to project state; it does not prove that browser instrumentation or a custom runner observed every dependency. Import only from instrumentation whose scope and limitations you have reviewed. Integrity hashes are consistency checks rather than signed provenance.

## Browser assets, contracts, and service versions

These declarations add dependency edges without pretending to discover browser or remote behavior automatically:

```json
{
  "browser": {
    "routes": {
      "/": {
        "tests": ["test/landing.test.js"],
        "inputs": ["public/copy.json", "public/theme.css", "templates/home.html", "locales/en.json"]
      }
    }
  },
  "contracts": {
    "contracts/api.json": ["test/api.test.js"]
  },
  "services": {
    "catalog": {
      "tests": ["test/api.test.js"],
      "env": "CATALOG_SCHEMA_VERSION"
    }
  }
}
```

Browser route keys are labels. Their `tests` and `inputs` arrays create file edges for copy, styles, templates, route definitions, localization, or other explicit project inputs. They do not install a browser, collect DOM/network traces, or claim visual coverage. Use the project's existing browser test runner. Contracts likewise map exact input paths to consuming tests; schema changes select consumers, but TestLore does not infer semantic compatibility from a schema diff.

A service needs a nonempty `tests` array and exactly one source of version evidence: literal `version`, environment variable name `env`, or executable/argument array `probe`. A probe runs locally without a shell, has a five-second timeout, and uses trimmed stdout as its version. Service versions are stored as hashes, not raw version strings, in `.tddswarm/services.json`. Both environment lookup and probes honor `config.env` overrides over the inherited process environment.

A first observed version or changed version adds the synthetic changed input `service:<name>`, selecting its mapped consumers. If runtime selection is enabled, changed service provenance also invalidates the previous runtime capture and can widen selection until fresh evidence is captured. A missing version, failed probe, or malformed saved service history widens selection with explicit uncertainty. Versions are remembered only after successful complete execution of all mapped consumer files, or a complete full runtime capture/import. A version identifier is an invalidation signal supplied by the project; TestLore does not monitor the service continuously or validate that the identifier covers every remote behavior change.

See [native runner results](runners.md), [reviewed candidate validation](candidates.md), and [ecosystem integrations](integrations.md) for the adjacent execution and review contracts.
