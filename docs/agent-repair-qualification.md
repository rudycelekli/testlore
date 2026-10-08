# Native agent repair qualification

The existing `scripts/host-qualification.js` four-call detection fixture is unchanged. A separate controller exercises **brief → status → plan → shadow verification → repair → fresh plan → full verification**, with one native host invocation per explicitly supplied host and no controller retries. The final result must also pass a new, independently launched Node full run; an agent's claim does not qualify a repair.

```sh
node scripts/agent-repair-qualification.js --run \
  --authorize-fixture-tools --authorize-fixture-repair \
  --entrypoint /absolute/testlore/src/cli.js \
  --codex /absolute/bin/codex --timeout-ms 120000 \
  --output /absolute/new-repair-receipt.json
```

Supply `--claude /absolute/bin/claude` only after its native subscription authentication is independently established. Missing hosts remain `not-started`; the aggregate is complete only when both qualify. This script never logs in, substitutes providers, selects a model, or configures API keys. An unsupported installed host invocation fails before the provider call. Raw bounded events, stderr, source commitments, observer receipts and independent native outcomes are retained in a disposable workspace. Previous output paths cannot be overwritten.

The qualification-only `repair_fixture` MCP capability is launched by this controller and **is never registered in ordinary TestLore MCP startup**. Its destructive annotation is explicit. It accepts an agent-supplied source string of at most 128 bytes, permits only a declaration of the expected constant `value = 1`, checks the exact planted fault hash and bound filesystem root, and writes only `src/value.js`. It cannot edit tests, configuration, requirements, dependencies or another repository. Invocation-local approval covers only these disposable fixture tools; personal and managed policies remain intact.

The controller seals fixed tests and configuration before the host starts. Any added file, changed oracle/configuration, incomplete observation, repeated repair request, failed native host item, source drift, changed executable, incomplete fresh full run or changed case identity prevents qualification. Unsafe changes are not executed by the independent post-repair runner. API-key and provider-routing environment variables are stripped. Host subprocesses and MCP descendants are terminated on deadline, output overflow, cancellation or completion.

The final-account schema is declared in the prompt and retained with its hash. Codex receives it through its native `--output-schema` option as well; unsupported installed CLIs fail before a provider call. Claude receives the same declared schema in the prompt, and the controller checks either host's final account independently. `uncertainty` and `nextAction` must each be **prose strings of at least 20 characters**; a structured tool uncertainty object is not an actionable final account and remains rejected. The final object has exactly `verdict`, `repairedFile`, `executedFiles`, `uncertainty`, `nextAction` and `deploymentSafety`. The initial native receipt rejected for object-shaped uncertainty remains rejected; later schema clarification does not reinterpret previous evidence.

This deliberately narrow constant repair establishes **actual tool orchestration and unchanged-oracle preservation in a synthetic fixture**. It does not establish general repair quality, independently maintained benchmark performance, other repositories or deployment safety. Native host receipts must be collected separately; deterministic controller tests are not native agent qualification evidence. Archive installation certification remains the responsibility of the existing host qualification controller; this controller binds exact source, harness, reporter and executable identities.

## Genuine maintainer contract profile

`--repair-profile maintainer-is-promise` selects a separate, frozen public contract from [then/is-promise](https://github.com/then/is-promise). The fixed source and original maintainer test, README and MIT notice come from commit `ed0eaa4dec17597f0dae892a0472a9b7f459320d`; the historical source comes from its parent `2dfb684306b6f3b8b374478c86e63f8bab4a7f06`. All five archived upstream files are checked against their SHA-256, byte length and Git blob. The fresh-maintainer dataset commitment is also checked before constructing the disposable fixture.

The historical parent returns `null` and `undefined` rather than boolean `false`. Independently executed fixed maintainer assertions pass **eight runnable leaf cases**; the historical parent fails exactly the two null/undefined cases. Only test imports and framework entry points adapt the original Mocha/better-assert assertions to Node; their assertion bodies remain byte-identical. This profile does not execute the complete original upstream Mocha dependency environment.

```sh
node scripts/agent-repair-qualification.js --run \
  --authorize-fixture-tools --authorize-fixture-repair \
  --repair-profile maintainer-is-promise \
  --entrypoint /absolute/testlore/src/cli.js \
  --codex /absolute/bin/codex --timeout-ms 115000 \
  --output /absolute/new-maintainer-repair-receipt.json
```

This profile permits **at most one explicitly supplied native host: Codex or Claude**, with no retries. Supplying both rejects before source lookup or any host invocation. To select Claude, replace `--codex /absolute/bin/codex` with `--claude /absolute/bin/claude`; no model, provider key, fallback or permission bypass is added. The unselected host remains `not-started`, so one qualified result alone does not make the two-host aggregate complete. Native authentication remains an external prerequisite. The synthetic profile remains the default.

The controller seals all ten fixture files, including the original assertion source, adapted runnable oracle, README, license, requirements, provenance and configuration. The qualification-only tool accepts a source string of at most 1 KB and writes only `src/promise.cjs`; it accepts exactly the canonical fixed source bytes. The prompt supplies the historical source and the necessary boolean-guard repair explicitly. This measures whether the host follows the bounded tool workflow and preserves an independent maintainer oracle; it is not a free-form bug-solving benchmark.

Qualification requires the initial shadow run to expose exactly the two independently demonstrated historical failures, a single source edit, a fresh plan, a fresh full host verification and an independently launched full native verification with all eight identities preserved. Every protected file and executable is checked again. Changed oracle bytes, unknown source repairs, missing cases, fabricated failure identities, reordered calls, malformed observations and incomplete executions remain rejected. Native runnable names come from the completed Node test tree, including concurrent sibling suites and dynamic tests sharing a declaration location. Earlier receipts produced with the old enqueue-based naming retain their original identity limitations.

Deterministic tests establish these controller gates and the actual historical failure/repair under Node. An immutable native host receipt is required separately before claiming agent qualification for this profile. No broad repair-quality or deployment-safety claim follows from this one historical contract.

The [October 7 native Codex receipt](../benchmarks/qualification-20261007/maintainer-agent-repair.json) qualifies this exact profile on source `c996cfda7d69b1abb88a57c0b4d33f7fed61000d`. One native invocation completed the seven sequential MCP calls, including the single canonical source repair. Independent native runs observed eight fixed passes, the two historical null/undefined failures, and eight repaired passes; all case identities and protected files were preserved. The host returned scoped uncertainty, a concrete next action and `deploymentSafety: not-established`. Its 35.636-second process duration and native reported token counters are retained; the provider model and dollar billing are unknown. That historical receipt did not start or qualify Claude, so its two-host aggregate remains incomplete. Authentication alone does not qualify the host. Earlier synthetic and blocked-host receipts remain unchanged.

## Contract-only instructions

Add `--repair-instructions contract-only` to the maintainer invocation to supply only the maintainer README, faulty source and observed failures. The exact implementation and boolean-guard hint are withheld. The default remains `supplied`; other modes and contract-only synthetic tasks reject before invocation. The prompt mode, solution-supplied flag and prompt SHA-256 are retained separately from repair admission.

The [October 8 native Codex receipt](../benchmarks/qualification-20261008/contract-only-agent-repair.json) qualifies this variant at `42b0d45e986bd48f52a2936b6e383baaf83bc2cc`. One actual invocation completed the seven ordered calls in 49.580 seconds without a retry. Independent native runs retained eight fixed passes, two historical failures and eight repaired passes. Only the source changed; all ten fixture identities and eight case identities were checked. Locally reported usage was 235,883 input tokens (including 204,672 cached input), 498 output tokens and 43 reasoning-output tokens. These are native reported counters, not an invoice; provider model and dollar cost remain unknown.

This is a small inference step beyond supplied-repair workflow qualification. The capability still admits only the independently frozen canonical source; equivalent alternative edits can be rejected. The task uses Node import shims and is not a broad autonomous application repair benchmark. Claude remains unqualified, and the two-host aggregate remains incomplete.

## Native Claude negative: 2026-10-08

The [single native Claude contract-only trial](../benchmarks/qualification-20261008/claude-contract-only-agent-repair.json) ran on clean source `f979e9cf7ca261c04d408a7317d7fe0e0b3c9c1c`, with Node 22.19.0, a 115-second deadline, fixture-only tools, no model override and zero retries. **Qualification was rejected**: Claude prefixed the final fenced JSON object with prose, violating the exact final-account contract. The parser, original negative and qualification verdict remain unchanged; no retry was attempted.

Raw observer and native reports were independently reparsed. The host completed all seven sequential tools and one canonical source repair; all ten sealed fixture files and eight case identities were checked. Independent native runs observed eight fixed passes, exactly two historical null/undefined failures, eight repaired passes, and another eight-pass postrun. Those stages establish this bounded workflow observation, while the overall host qualification remains negative. They establish no general repair quality, complete upstream Mocha environment or deployment safety.

Native process time was 37.713 seconds; complete outer time was 39.583 seconds. The native event reported model `claude-opus-4-6[1m]`, 10 input tokens, 13,038 cache-creation input tokens, 75,709 cache-read input tokens and 1,007 output tokens. Its estimated client cost was $0.144567; actual subscription billing and provider request count remain unknown. Private raw events stay local with public SHA-256 bindings. Codex was not rerun and joint two-host qualification remains incomplete.

## Prospective native structured account

`--final-account-format native-structured` is a separate, explicit source-level candidate for one Claude maintainer host. The default remains `message`; the rejected prose-prefixed trial above is unchanged. This mode binds the observed Claude 2.1.88 executable SHA, requires `--json-schema`, keeps `stream-json` and supplies the existing fixed repair-account schema. [CLI documentation](https://code.claude.com/docs/en/cli-reference) documents schema-validated output; [programmatic documentation](https://code.claude.com/docs/en/headless) distinguishes structured output from result text. Pinned local help and implementation evidence are recorded in the [prospective protocol receipt](../benchmarks/qualification-20261008/claude-structured-account-protocol.json).

The parser requires exactly one successful terminal `structured_output` object matching exactly one completed native `StructuredOutput` formatter invocation, after the seven authorized MCP calls and final verify response. The formatter is counted separately and grants no repository-operation capability. Ordinary tools remain forbidden. Missing, malformed, duplicate, mismatched or oversized accounts reject with no prose fallback. The same strict repair, protected-file, oracle, identity, order and final-account assessment still applies. The formatter helper is sealed with the qualification harness.

Pinned source defaults to five formatting attempts; its counter checks on user events and counts formatter assistant messages. A threshold of one is not assumed safe for a successful first output, so that environment variable is not changed. The supervisor stops on observed formatter errors/repeats and existing native API retry events. Stream observation is best effort and cannot prove or prevent all hidden/prebuffered provider requests. No zero-formatting-retry or native structured-result claim is established by the constructed source tests.

A separately authorized native structured experiment is recorded below. Its private external watchdog required at least 2.5 GiB free at launch, sampled every second with a retained 2 GiB reserve, checked frozen source and executable identities, and bounded observed process-tree cleanup. Any further experiment requires its own bounded authorization; resource floors are not lowered to permit a run. The earlier prose-format negative remains unchanged.

## Native structured Claude negative: 2026-10-08

The [distinct structured-output trial](../benchmarks/qualification-20261008/claude-structured-agent-repair.json) ran once on clean source `6dd2e53a20c3e1b7b130e995115edd37fa910aea`, using the pinned Claude 2.1.88 executable and Node 22.19.0. **Its recorded qualification remains rejected** with `initial:readonly-arguments-mismatch`: Claude passed `task` and `changed` to `testlore_brief`, while the frozen harness required `{}`. These are schema-valid TestLore MCP inputs, and the prompt did not explicitly prohibit them. This was an evaluator/API alignment defect, not an invalid MCP call. The original receipt, source-bound assessment and verdict remain unchanged; neither trial is reclassified and no third trial was run.

The native formatter protocol did complete in this observation: exactly seven sequential MCP calls, then one successful `StructuredOutput` formatter, then one matching successful terminal `structured_output` object. Unique tool-use IDs and ordered responses were independently checked. No ordinary tool or observed API retry occurred, and there was no prose fallback. This verifies that narrow native output path while the full host workflow remains negative. Hidden provider requests and provider-side formatting retries remain unknown; the native formatting retry environment was not overridden.

Independent raw replays confirmed all ten fixture seals and a single canonical source edit. Native runs retained eight fixed passes, exactly two historical null/undefined failures, eight repaired passes, and another eight-pass independent postrun, with every case identity preserved. These observations concern unchanged maintainer assertions on Node import shims, not a complete upstream Mocha environment, broad autonomous repair quality or deployment safety.

The native process took 38.469 seconds; complete outer time was 42.984 seconds, including setup, controller verification, external cleanup and resource/identity checks. The watchdog retained 42 samples, a minimum sampled free space of 6,706,565,120 bytes and zero survivors among 22 observed process identities. One-second sampling cannot exclude a shorter reserve breach, and descendant observation is best effort. The native client estimated $0.161365; actual subscription billing and provider request count are unknown. Native reported usage and private raw SHA-256 bindings are preserved in the receipt.

Codex was not rerun, and the two-host aggregate remains incomplete.

## Prospective evaluator/API alignment

Future maintainer reports record evaluator contract version 2. The maintainer evaluator and MCP registration share the unchanged strict `testlore_brief` input schema: optional `task` of at most 2,000 characters and optional `changed` of at most 1,000 paths, each 1–1,000 characters. Qualification additionally requires every supplied changed path to name a file in the sealed fixture inventory; unknown files, traversal and absolute paths remain outside this scope. This is general schema validation, with no exception for the recorded task or path list. `testlore_status` still requires `{}`.

The correction changes only future maintainer input assessment. Tool outputs, advisory authority, seven-call order, one canonical edit, protected bytes, independent oracles, case identities, deadlines and executable bindings remain required. The shared schema module is included in source and harness identities. Tests exercise optional inputs, boundaries, schema parity with the actual MCP handshake, invalid inputs and out-of-fixture paths. The four-call synthetic qualifier contract is unchanged. No native trial has exercised this new evaluator contract; both earlier negative receipts retain their original bytes and verdicts.
