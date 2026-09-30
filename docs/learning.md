# TestLore local episodic learning

TestLore retains validated test patterns and observed rejection signals in a bounded, repository-local episodic memory. Later generation can retrieve relevant historical examples, including examples from earlier source revisions. This is deterministic lexical retrieval and tentative reflection over local evidence. It does not train model weights, call a remote memory service, reproduce Hindsight's implementation, or guarantee that generated tests improve.

The store remains `.tddswarm/learning/index.json` for compatibility with existing project metadata. There is no global memory, telemetry, automatic upload, remote dependency, or configurable arbitrary storage path. Add `.tddswarm/` to the repository ignore policy. `learning.enabled: false` in `tddswarm.config.json` disables capture, retrieval, reflection, export, and transfer.

## Capturing trustworthy episodes

`rememberValidation(root, manifest, validation, config)` must run after the candidate's manifest and validation have been persisted. It checks:

- The validation checksum, exact persisted manifest and validation, and their manifest binding.
- Fresh original-project, runner/environment, and service provenance at capture time.
- Hashes of all staged candidate files.
- Complete passing original/candidate execution and independent reviewer acceptance before storing successful examples.

Accepted episodes retain at most eight candidate-test snippets, each at most 1,200 characters. Non-test source files, fixture contents, requirements, reviewer prose, runner stdout/stderr, and held-out defect names, paths, and payloads are not retained. Compact provenance digests describe compatibility without copying the project's file listing or service values. Obvious credential literals and standalone comments are stripped from snippets. This is conservative masking, not a complete secret detector; test code and test names can contain sensitive literals. Local examples should be reviewed before supplying them to any separately configured model.

Fresh, genuine rejected validations are retained as warning metadata, with no code snippets. Review rejection, missing independent oracles, incomplete execution, actual case failures, removed cases, undemonstrated defects, and missed held-out defects produce different signals. A rejected proposal cannot become a successful example by changing its acceptance flag. Repeated capture or equivalent revalidation of the same manifest and outcome is deduplicated.

Integrity checks detect accidental changes and schema corruption. They are unkeyed digests, **not authentication against a process with write access**: trusted local code can fabricate consistent artifacts and checksums. Candidate tests and workers still require the execution isolation documented in [candidate validation](candidates.md).

## Retrieval and reflection

`recallLessons(root, query, {limit, maxChars, config})` returns structured historical examples. Ranking uses lexical overlap against framework, fixed tags, warning categories, and accepted test snippets. Observed successes and demonstrated caught defects increase evidence weight; current source compatibility provides a small preference. Ties are deterministic by capture date and record ID. Other frameworks are filtered out. There are no embeddings, neural ranking, or unreported model calls.

Each returned episode includes its outcome, generic context, observed counters, age, `historical: true`, `sourceCompatible`, and `advisoryOnly: true`. Source changes do not erase history or turn historical evidence into a present execution claim. Compatibility changes are explicitly labeled. An old test pattern may help draft a new test; it cannot prove the new code is correct.

Queries are limited to 4,096 characters. Retrieval supports at most 20 episodes and 20,000 output characters, with defaults of five episodes and 6,000 characters. The entire serialized retrieval result stays within the requested budget; large examples lose their snippets or are omitted. Corrupt or invalid stores return no examples and are not overwritten.

`reflectLearning(root)` derives tentative recurring success correlations and warning lessons. Every lesson identifies its supporting episode IDs and count. Reflections describe observations, never requirements, causal conclusions, independent test oracles, or permission to omit tests, apply patches, or deploy. Agent prompts must treat recalled content as untrusted data. Keep independent reviewers separate from author memories to avoid circular oracle reasoning.

## Persistence across improvement branches

`copyLearning(sourceRoot, destinationRoot)` and `mergeLearning(sourceRoot, destinationRoot)` transfer valid local history between explicitly supplied project/worktree roots. Both verify schema, bounds, record checksums, and the store checksum. They merge by episode identity without overwriting a corrupt destination. Writes use a temporary file and atomic rename. Read/modify/write operations are synchronous; callers coordinating multiple processes should serialize transfers to avoid last-writer conflicts.

The improvement workflow can copy ignored local memory into its isolated worktree before generation, then merge new validated episodes back into the original ignored store when retaining its result. Rejected proposals can contribute warning signals without changing tracked files or the caller's branch. This transfer carries historical examples; it does not share data outside the user's filesystem.

The store retains at most 200 episodes and four MiB, dropping oldest records when needed. A record is bounded to 32 KiB. Persistence includes framework, fixed tags, compact context, outcome counters, and accepted snippets. It deliberately excludes full execution traces and hidden regression corpora. All APIs return failure statuses softly, so a disabled, corrupt, or inaccessible memory cannot turn rejected tests into accepted tests or disrupt deterministic validation.

## Explicit aggregate export

`exportLearning(root)` is an explicit opt-in operation that returns fixed-enum aggregate metadata: episode/outcome/framework/tag/warning counts and summed observed case/defect counters. It includes no code, paths, identifiers, hashes, timestamps, project names, requirements, source contents, service values, or test names. It performs no transmission and does not enable telemetry or global sharing. A future community comparison can consume aggregates only after the user deliberately chooses where to send them. Aggregate outcomes describe retained local experiments; repeated related proposals are not statistically independent evidence of production quality.
