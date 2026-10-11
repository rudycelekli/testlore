# Repository immunity: investigate beyond a green suite

TestLore can turn a verified historical bug pattern into an executable investigation of a separately reviewed current contract. A green existing suite can coexist with a missing edge case. The useful outcome is a reproducible contradiction of intended behavior, an honest clean observation, or a specific reason the investigation could not finish.

“Immunity” names this bounded workflow; it does not promise universal protection, continuous self-improvement, or a bug on every run. Investigation, routing, source repair, and learning keep separate acceptance boundaries.

## Inspect first

Use current reviewed Git source containing this feature. The npm registry still serves `0.1.0`, which predates these commands; the source candidate is `0.2.0-alpha.1`, pending publication and registry-byte qualification.

```sh
npm exec --yes --package=github:rudycelekli/testlore#main -- testlore immunity --json
```

Replace moving `#main` with a reviewed full Git SHA for reproducible use. From a source checkout, the equivalent is `node src/cli.js immunity --root /absolute/path/to/project --json`.

Inspection reports the bundled recipe catalog, current receipt freshness, approved versus unresolved declared investigations, reviewed outcome counts, and a concrete next action. It does not execute project modules, call a model, or start a background service. A new project reports `awaiting-reviewed-probes` rather than inventing its expected behavior.

Inspect or copy the qualified historical declarations:

```sh
testlore probe-catalog --json
testlore probe-catalog --execute --json
```

These commands assume `testlore` from the reviewed source is on your path. Copying writes a new `testlore/recipes` directory, including hash-bound replay evidence, without executing project code or overwriting an existing directory. `--output relative/directory` changes that destination. Review the contracts and retained upstream licenses before committing them.

## Review a current contract

Each transferred recipe needs an independently reviewed expectation for the current target. Similar identifiers, historical merges, and plausible agent explanations are insufficient. Confirm that the target export and input/output semantics match the probe; an encoder and a decoder, for example, share only a limited subset of behavior.

The current profile supports bounded JavaScript/JSON module closures, named or default exports, and JSON arguments with explicit equality or error-name expectations. Declare every required local file, including existing package configuration along the module's ancestry. Unsupported imports or incomplete execution produce an inconclusive result. Module copies, credential scrubbing, VM restrictions, and filesystem controls are not an operating-system sandbox; only investigate code you are authorized to execute.

Create `tddswarm.probes.json`. The following is a **schema example**, not an approved contract. Replace every `REVIEWED_*` placeholder with the actual value, review the current behavior independently, and adjust the module/test paths to your project:

```json
{
  "schemaVersion": 1,
  "kind": "bug-investigation-manifest",
  "recipes": [
    {
      "path": "testlore/recipes/qualified/historical-whitespace-classification/recipe.json",
      "sha256": "REVIEWED_RECIPE_FILE_SHA256",
      "qualification": {
        "path": "testlore/recipes/qualified/historical-whitespace-classification/qualification.json",
        "sha256": "REVIEWED_QUALIFICATION_FILE_SHA256"
      }
    }
  ],
  "targets": [
    {
      "id": "numeric-input",
      "module": "src/is-number.mjs",
      "files": ["src/is-number.mjs", "package.json"],
      "tests": ["test/is-number.test.mjs"],
      "contracts": [
        {
          "recipeId": "historical-whitespace-classification",
          "recipeSha256": "REVIEWED_CANONICAL_RECIPE_SHA256",
          "sourceSha256": "REVIEWED_SOURCE_CLOSURE_SHA256",
          "expectation": {
            "path": "contracts/numeric-input.md",
            "sha256": "REVIEWED_EXPECTATION_FILE_SHA256"
          },
          "reviewer": "REVIEWED_CONTRACT_OWNER",
          "revisionPolicy": "pinned-source"
        }
      ]
    }
  ],
  "budget": { "totalMs": 30000, "timeoutMs": 3000, "maxInvestigations": 3 }
}
```

The catalog-copy result supplies `recipes` file references and hashes. Its `entries[].recipeSha256` identifies the validated canonical recipe; this differs from the raw recipe-file digest. `captureBugProbeSource(root, {module, files})` returns the source-closure hash. `readBugRecipe(root, file, expectedSha256)` returns both identities. These JavaScript APIs are exported by the reviewed current package, not the old registry release. Do not substitute a single module-file digest for the closure digest.

`reviewer` records a declaration, not an authenticated review. Hashes bind bytes and detect changes; they do not establish that an expectation is true or independently reviewed.

Choose the revision policy deliberately:

- **`pinned-source`**, the default: approval applies to the exact recipe and source closure. A source change requires renewed contract review and a new closure hash.
- **`follow-contract`**: explicitly authorize the same reviewed behavior contract to be challenged after source changes. The recipe and expectation remain hash-bound; each fresh run captures its actual current source closure. This policy also bypasses the preliminary identifier gate, allowing a refactor to remain observable. It grants no repair, omission, or learning-promotion authority.

A retained report becomes stale when its bound inputs change under either policy. `follow-contract` permits a **new** observation; it never makes an old report current.

## Investigate, then repair only a demonstrated problem

```sh
testlore investigate --manifest tddswarm.probes.json --json
testlore investigate --manifest tddswarm.probes.json --execute --json
```

The first command plans without executing project modules. The second runs applicable, approved probes repeatedly in disposable module copies, within the declared budget. It may instead return `reused: true` with an existing complete, hash-bound receipt when the manifest, catalog, source closure, expectations and associated test inputs are unchanged; this is retained observation, not a fresh execution or additional evidence. The JavaScript API accepts `reuse: false` to force a new bounded run.

Results preserve named observations, source identities, raw probe receipts, incomplete attempts, and review-only regression proposals under `.tddswarm/investigations`. Exit `1` means a contradiction was reproduced, `2` means incomplete or exhausted evidence, and `0` means no contradiction was observed in the declared scope. A clean result is not comprehensive correctness.

For a reproduced finding, commit independent `tddswarm.requirements.md` and configure a bounded JSON worker, or use an installed authenticated Codex CLI. From a clean committed checkout:

```sh
testlore investigation-repair \
  --report .tddswarm/investigations/REPORT_UUID/report.json \
  --sha256 REVIEWED_REPORT_FILE_SHA256 \
  --id REVIEWED_FINDING_SHA256 --local --deadline-ms 900000 --json
```

Substitute actual report and finding identities. `--local` retains the branch for review. Omitting it authorizes the existing publication flow to open a validated GitHub PR using authenticated GitHub access; no automatic merge occurs. `--patch relative.json` supplies an already reviewed source proposal instead of calling an agent.

This additional repair path is qualified only for a standalone Node project with complete named native assertions, no external service profile, and one approved existing production module of at most 64 KiB. Configured `repair.sourcePaths` remains an ownership restriction: a reviewed behavior contract cannot authorize a fix outside that explicit scope, and autopilot also preserves an explicit `--sources` restriction. It preserves the caller and:

1. Verifies the original complete native suite is green twice with stable case identities.
2. Adds exactly the hash-bound, contract-derived new regression on a disposable worktree; existing assertions and requirements remain unchanged.
3. Demonstrates stable native failures corresponding exactly to the probe's mismatching cases, while preserving original outcomes.
4. Delegates architect, source author, and independent reviewer roles to the existing source-only repair controller; repeated native checks reject wrong fixes and oracle edits.
5. Checks that the committed diff contains only the new regression and approved production source. Freshness guards bind the original caller, contract, report, proposal, and enabled contribution knowledge through worker and validation boundaries.

The direct JavaScript API is `repairInvestigation(root, {report, reportSha256, findingId, agent, patch, deadlineMs})`. It does not publish. Native execution and workers are trusted executable code with filesystem access, not isolated adversaries. Deterministic worker transport tests establish controller behavior, not general AI repair quality.

## Observe trusted changes

Commit the manifest, reviewed recipes, qualification evidence, expectations, target sources, and associated tests first. The workflow installer requires all bound inputs to be tracked. Then:

```sh
testlore setup --immunity --manifest tddswarm.probes.json \
  --action-ref REVIEWED_TESTLORE_40_CHARACTER_GIT_SHA --json
```

The SHA placeholder must be replaced with an exact reviewed TestLore commit. Setup writes `.github/workflows/testlore-investigate.yml` and `investigation: {enabled: true, manifest: "tddswarm.probes.json"}` in configuration. Review and commit those files to activate GitHub execution. The generated investigation workflow runs on trusted `main` pushes or explicit dispatch, has read-only repository permissions and a five-minute job limit, and uploads investigation evidence. It runs probes, not an agent repair. Existing workflows are preserved. No local daemon or schedule is installed.

Default `pinned-source` contracts stop probing changed source until reviewed. Use explicitly reviewed `follow-contract` policy where ongoing behavior expectations genuinely apply across changes.

Agent autofix is a **separate opt-in**:

```sh
testlore setup --immunity --autofix --manifest tddswarm.probes.json \
  --action-ref REVIEWED_TESTLORE_40_CHARACTER_GIT_SHA --json
```

Autofix requires independent committed requirements, explicit `agent` argv and reviewed `repair.sourcePaths`, plus an authenticated trusted self-hosted runner labeled `testlore`. It installs the pinned TestLore revision, performs bounded `autopilot`, deduplicates PRs for an original source revision, and opens reviewed PRs; it never merges. Configured agents may incur model costs. The investigation controller accepts only qualified production ownership, regardless of permissive configuration.

With `investigation.enabled: true`, `autopilot` challenges approved probes after its existing native repair check finds no current failure. It selects a reproduced finding for the new-regression repair path. Without a reproduced finding, it reports clean or incomplete observation rather than manufacturing a patch. This configured branch replaces autopilot's ordinary generation fallback; an unsupported repair profile remains unsupported.

## Retain outcomes without granting them authority

```sh
testlore investigation-outcome --report .tddswarm/investigations/REPORT_UUID/report.json \
  --sha256 REVIEWED_REPORT_FILE_SHA256 --id REVIEWED_FINDING_SHA256 \
  --verdict useful --reviewer REVIEWED_REVIEWER_ID --json
testlore investigation-learn --json
testlore investigation-links --report .tddswarm/investigations/REPORT_UUID/report.json \
  --sha256 REVIEWED_REPORT_FILE_SHA256 --json
```

Verdicts are `useful`, `false-positive`, `intentional-behavior`, `duplicate`, or `inconclusive`. A useful verdict requires a reproduced observation; passing and unfinished probes cannot become useful defect claims. Exclusive local receipts preserve the original observation separately from the reviewer disposition, refuse duplicate counting/relabeling, and bind report bytes. Historical findings can retain advisory usefulness after source changes, with explicit stale flags. Missing or corrupted report evidence is quarantined.

`prioritizeBugRecipes(root, [{id, sha256, family}], {remainingMs, maxInvestigations})` uses reviewed usefulness, observed duration/timeouts, uncertainty, cold-start exploration, and optional reviewer-supplied unverified cost. Ranking remains advisory; the executor enforces actual deadlines. Negative outcomes do not globally suppress a recipe. `learning.enabled: false` disables automatic investigation prioritization and immunity learning inspection; deliberate local outcome commands remain available.

`investigationDependencyLinks` proposes associations between the source, recipe contract, and **declared** test paths. It does not infer dependency completeness or authorize omissions. Validate proposed mappings with independently executed full/subset native runs before using them for selection.

## Evidence and remaining work

The [public historical transfer experiment](../benchmarks/bug-transfer/README.md) reproduced three historical failures and passing fixed revisions. Two compatible, independently maintained target modules passed the transferred probes; an incompatible direct fork was retained as an abstention control. **Zero new target bugs were demonstrated.** The experiment used frozen constructed cases derived from documented behavior, not untouched native maintainer suites, and did not execute full original upstream installations.

No runtime advantage, live AI repair improvement, token-cost reduction, general transfer, or learning effectiveness has been established. The ordinary comparator was deterministic probe input, not an AI agent. The next qualification is an unrelated real application with independently demonstrated failure-before/fix-after outcomes, then protected, equal-budget agent comparisons including false positives, timeouts, complete native outcomes, cost and oversight.

See [public contribution knowledge](contribution-knowledge.md) for metadata retrieval, [agent interfaces](mcp.md) for permitted tool surfaces, and [ADR 009](adr/009-repository-immunity.md) for the acceptance boundaries.
