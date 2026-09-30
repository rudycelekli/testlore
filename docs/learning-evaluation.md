# Paired evaluation of learning

Historical examples reaching an author is evidence of integration. It does not establish better tests. The original [single-task ablation](../benchmarks/learning/2026-09-29-native-ablation/summary.json) remains visible: both variants caught four mutations, memory produced fewer cases and took longer. Its order and default model were unpinned.

The [repeated native run](../benchmarks/learning/2026-09-30-paired-native/README.md) covers two specifications and two repetitions. The no-memory arm caught 12/12 defects; the memory arm caught 9/12, with one author timeout. This result is inconclusive and establishes no learning benefit. Implementation hashes, raw receipts, development-lineage limits and a delayed-timeout caveat remain visible.

`scripts/learning-evaluation.js` adds a prospectively declared paired protocol. Each independent specification runs with and without the same frozen, genuinely validated historical store. Both arms use the same executable/provider, requirements, source, three role calls, response-byte request limit, and subprocess timeout. Fixture order is seeded and shuffled; first-arm order is counterbalanced per specification across repetitions after a seeded initial choice. The order seed controls scheduling, not provider randomness. Runs are sequential so competing calls do not confound latency.

The controller keeps evaluation reference tests and planted defect payloads separate from historical memory, agent stdin and generation roots. It first verifies a green reference baseline and actual named-case failure for every labeled defect. Generated tests must pass independent review and TestLore candidate validation before applying in the disposable trial project. Defects are then executed against those generated tests. Import/process errors do not count as detected faults. Review rejection, incomplete execution, and failed trials remain visible and contribute zero recall.

## Run with an existing authenticated worker

From a source checkout with installed dependencies:

```sh
node scripts/learning-evaluation.js \
  --output /absolute/private/new-learning-evaluation \
  --agent '["/absolute/node","/absolute/testlore/src/adapters/codex.js"]' \
  --identity 'codex/VERSION/default-model-unpinned' \
  --repeat 3 --seed 20260930 --max-calls 54
```

This explicitly invokes generation and consumes the worker's existing allowance. The controller does not install a worker, authenticate, request provider credentials, or fall back to a separately billed provider. The included Codex adapter uses its normal native authentication and default model. Record the actual installed CLI version in `--identity`; for a pinned provider, use a wrapper with a fixed model/version and record that identity. This protocol cannot certify an operator's identity declaration or recover token billing from workers that do not report it.

The default scope has three independent authored contracts (string normalization, stable deduplication, half-open interval overlap), one separate historical numeric-clamp example and nine planted defects. Three repetitions yield eighteen trials and a maximum of fifty-four worker calls. A smaller local run uses `--repeat 1 --max-calls 18`. No live run is implied by shipping this script. Protocol-fixture workers are marked `--evidence-kind protocol-fixture` and never support a learning-quality conclusion.

The fixed three-call budget requires one architect task. A response larger than `--max-output-bytes` (default 65,536 bytes) stops that trial before another call. The bound is verified after the response, with the underlying transport's 2 MB ceiling; it is not an enforced provider token or dollar budget. Each call is terminated at `--timeout-ms` (default 115,000 ms; maximum 120,000 ms). The whole run's worst-case worker time is calls × timeout. There are no automatic retries. More memory necessarily changes input length; output-byte totals and raw payloads disclose this difference.

## Bring independently authored specifications

`--fixtures /absolute/manifest.json` accepts a bounded 2 MB JSON manifest. Export the default schema to inspect it:

```sh
node --input-type=module -e "import {defaultDataset} from './scripts/learning-evaluation.js'; console.log(JSON.stringify(defaultDataset(),null,2));" > /private/evaluation-fixtures.json
```

The manifest contains `schemaVersion:1`, `id`, `history`, and `fixtures`. Historical entries have distinct `id`, `specificationId`, `requirements`, source `files:[{path,content}]`, and `tests:[{path,content}]`. Evaluation entries have source `files`, independent `referenceTests`, and `defects:[{id,files}]` that replace existing source files. Paths are bounded canonical `src/name.js` and `test/name.test.js`; no manifests, binaries, dependency installation or arbitrary commands appear in fixtures. Maximum scope is eight histories, twelve specifications and eight defects per specification. `repeat` is 1–5 and total role-call budget cannot exceed 360. IDs, requirement hashes and source hashes must not overlap across specifications. These mechanical checks prevent exact leakage; maintainers must separately audit semantic independence and whether each defect follows the independent contract.

Do not add evaluation specifications, reference tests, defect labels or defect implementations to historical memory. Do not run a training/tuning loop on held-out specifications. Freeze the manifest and worker settings before collecting results; changes require a fresh output directory and a separately named run.

## Receipts and interpretation

Every run writes an immutable manifest, raw historical validation, reference/defect executions, per-trial role inputs/outputs, candidate validation, generated-baseline cases, and fault outcomes. Output directories must be new. Directory permissions default to 0700 and files to 0600; raw source and generated tests are private until a maintainer reviews them. Workspace paths are normalized, but source is intentionally retained locally. These are not public pilot exports.

The summary compares defect recall, passing case count, generation time and output bytes. More cases are not intrinsically better tests. Generation time covers the three roles; total time additionally includes validation and defect execution. Paired deltas keep rejected trials rather than filtering them out. All raw failure IDs are available to diagnose faults.

Qualification independently repeats the reference baseline, generated baseline and each held-out defect at least twice. `--stability-runs 2` is the default (2–5 permitted). Native case identities, statuses and exit codes must agree; incomplete collection, skipped cases or changing outcomes invalidate a trial. Partial fault detections from an invalid trial remain in the raw receipt but contribute zero to the arm's qualified detection count.

Each call records input JSON bytes as well as response bytes and elapsed time. Arm summaries include actual calls, total validation/execution time and stable-trial counts. Bytes are transport measurements, not tokens. `billingUSD: null` means unknown provider billing; it never means a free call or an estimated dollar saving. The subscription worker consumes the existing allowance.

[`qualification-contracts.js`](../scripts/qualification-contracts.js) supplies six newly authored contracts and eighteen independently executable defects: CSV fields, duration formatting, first-occurrence binary search, frequency maps, common prefixes and numeric version comparison. Two distinct historical contracts are frozen separately. A live run freezes the manifest before invoking a worker, retains all three repetitions and discloses absent relevant memory. A larger dataset or more repetitions still cannot manufacture a learning gain.

Repeated attempts are clustered by specification. A two-sided exact sign test uses the mean recall difference for each independent specification, with ties excluded. A scoped positive/negative difference is labeled only with at least six specifications, three repetitions, complete trials, and p < 0.05. The default three-specification experiment therefore remains **inconclusive** for learning improvement even when an observed average differs. The test is a coarse exploratory statistic, not a power analysis or production-corpus guarantee. It does not establish superiority over other memory systems, train model weights, or authorize different test selection.
