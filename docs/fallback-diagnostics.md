# Make each fallback actionable

Full fallback can reflect several different gaps. A changed global configuration needs full verification. A source or asset without a known consumer needs evidence. A database migration outside a unit suite needs the missing suite, rather than a fabricated dependency to an unrelated unit test. Runtime uncertainty scoped to a test closure retains those tests; an unreachable-source warning does not itself force every test to run.

`diagnoseFallbackSelection(selection)` inspects an existing native planning receipt without executing project code. It explains every retained full-run reason, categorizes unmapped changes, distinguishes warning scopes, and explains each omission as the absence of a retained path/policy. It explicitly does not assert current source freshness or omission safety.

`fallbackDiagnostics(root, selection)` additionally verifies current source/configuration/runner/service freshness and seals the report with diagnostic producer bytes. It includes existing sealed routing proposals and bounded **literal-test input hypotheses**: an exact root/relative string in a test names an existing unmapped input. These associations require review. A literal can name a fixture, unused value or route without reading this project file. There are no basename guesses, configuration writes, service probes, automatic ignores, or closed-world promotion. Native routing proposal collection can evaluate native test configuration; the caller must use a trusted project, just as with existing planning.

After reviewing the actual serving/reading path and assertions, a caller can explicitly challenge hypothesis IDs with `qualifyFallbackHypotheses(root, diagnostic, {hypothesisIds, changed, defects, timeoutMs})`. It uses the existing independent disposable full/subset mapping qualification. Existing runtime closure and configuration fallback policies remain active. Original project bytes and configuration remain unchanged. A source defect that the full suite does not detect cannot qualify the hypothesis. Missing/incomplete native execution remains unqualified, with required full fallback. A passing scenario never establishes complete dependencies.

Literal hypotheses retain the existing qualification engine's manual-proposal classification (`legacyManual: true`, `producerVerified: false`, `completenessVerified: false`). The wrapper separately binds the sealed diagnostic integrity and revalidates the actual literals. Neither that seal nor a passing experiment proves semantic independence or closes unknown inputs.

## Inspect a retained campaign

Run from the source checkout:

```sh
node scripts/fallback-campaign.js --receipts .tddswarm/pilots/recorded-run --output .tddswarm/fallbacks/new-run
```

The output directory must be new and outside the input receipts. Inputs are bounded regular JSON files; symlinks, inconsistent test decisions and oversized/deep inventories are rejected. Private per-plan explanations and paths stay in that directory. Standard output contains only allowlisted aggregate counts. This command does not execute native discovery or tests, read project configuration, or change projects. Historical source freshness remains unverified.

The [October 6 inventory](../benchmarks/fallback-inventory-20261006.json) inspected all eight retained plans from four histories across three repositories: all eight had unmapped-input fallback, two also had changed global configuration. There were 62 repeated unmapped change occurrences, 170 unreachable-source warnings and 108 test-closure warnings; zero global uncertainty warnings and zero omitted tests. Counts include repeated trials and are not independent scenarios. These observations do not establish a speed advantage or failure recall.

The right next experiment reviews actual consumer evidence in an isolated pinned source copy, introduces a separately justified assertion defect, and compares independent full/subset outcomes. Histories that span absent database/browser/research verification keep fallback until their suite boundaries and consumers are evidenced. Documents may themselves encode behavioral contracts; they are never automatically ignored just because of their extension.
