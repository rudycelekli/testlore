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

This profile permits **one prospective Codex invocation**, with no retries or Claude invocation. Missing Claude remains `not-started`, so a qualified Codex result alone does not make the two-host aggregate complete. Native authentication remains an external prerequisite. The synthetic profile remains the default.

The controller seals all ten fixture files, including the original assertion source, adapted runnable oracle, README, license, requirements, provenance and configuration. The qualification-only tool accepts a source string of at most 1 KB and writes only `src/promise.cjs`; it accepts exactly the canonical fixed source bytes. The prompt supplies the historical source and the necessary boolean-guard repair explicitly. This measures whether the host follows the bounded tool workflow and preserves an independent maintainer oracle; it is not a free-form bug-solving benchmark.

Qualification requires the initial shadow run to expose exactly the two independently demonstrated historical failures, a single source edit, a fresh plan, a fresh full host verification and an independently launched full native verification with all eight identities preserved. Every protected file and executable is checked again. Changed oracle bytes, unknown source repairs, missing cases, fabricated failure identities, reordered calls, malformed observations and incomplete executions remain rejected. Native runnable names come from the completed Node test tree, including concurrent sibling suites and dynamic tests sharing a declaration location. Earlier receipts produced with the old enqueue-based naming retain their original identity limitations.

Deterministic tests establish these controller gates and the actual historical failure/repair under Node. An immutable native host receipt is required separately before claiming agent qualification for this profile. No broad repair-quality or deployment-safety claim follows from this one historical contract.
