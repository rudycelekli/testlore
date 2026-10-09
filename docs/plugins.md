# Optional tools, one TestLore workflow

TestLore is a complementary coordination layer for independently maintained specialist tools. Users access their capabilities through a consistent workflow while those tools retain their native scope and TestLore retains its acceptance rules. Plugins are explicit project configuration, not automatic downloads. Listing plugins does not invoke them. Enabling a tool does not establish that it is installed, compatible, or produces effective tests.

The built-in catalog covers Agentic QE generation, pytest-testmon/Nx/Bazel selection and execution, c8/Stryker measured-report tooling, and optional RuVector learning retrieval. Their implementations remain independent upstream projects. Updating one does not automatically qualify a new version: check its contract and run the project's validation after upgrades.

## Let your project choose its setup

```sh
npx --no-install testlore plugins --recommend --json
npx --no-install testlore plugins --auto --json
```

Inspection reads bounded project manifests and local installation evidence without executing tools. Recommendations explain each role, the supporting files, and missing prerequisites. Ordinary `setup` applies suitable installed complementary choices by default and records `decisions` and actual `applied` entries. `plugins --auto` remains available separately. Automatic setup retains manually enabled or disabled plugins and existing execution settings. It never downloads optional tools, invokes a provider, changes tests, or resolves competing execution engines by arbitrary precedence. An explicit runner is retained; switch to a native alternative with `plugins --select`.

This is a deterministic project-fit policy, not a performance ranking. Installation evidence does not certify a tool's runtime contract or measured quality: validate the actual operation. RuVector becomes applicable when local learning contains usable history and its optional SDK is present. AQE is chosen separately during generation rather than persistently enabled by setup.

## Automatic generation composition

Generation records a per-run `generationPlan` explaining the chosen author provider and rejected alternatives. Default automatic routing requires a safely inspected project-local supported AQE distribution, a compatible Vitest/Jest scope, independent requirements, distinct existing production-source tasks and an available architect/reviewer worker. Current automatic AQE admission is restricted to the inspected 3.14.8 distribution; a newer version needs contract qualification. Node assertions and source repair retain their supported JSON-worker path. Explicit disabled plugins, selected workers and manual AQE choices take precedence.

At most two independent AQE author tasks run concurrently, each in a separate bounded subprocess. Planning precedes authors, and the independent reviewer runs after all authors settle. Providers do not race to rewrite the same task. A failed automatically selected AQE task retains its artifact and may receive one JSON-worker fallback within the remaining campaign budget; successful tasks are not regenerated. Explicit AQE requests fail closed. The report retains fallback reasons, time/call bounds and unknown costs. Time/call limits do not guarantee a currency budget; use your configured provider limits.

AQE drafts remain candidates. Existing freshness checks, independent review and native validation control promotion. Actual supported AQE campaigns recently returned rejected drafts, and no combined quality or speed advantage has been demonstrated. Parallel subprocess tests prove coordination behavior, not model quality or live provider success. Coverage/mutation report import and advisory retrieval keep their separate roles; enabling them does not schedule every expensive measurement on every commit.

## Enable what your project needs

After installing TestLore locally:

```sh
npx --no-install testlore plugins --json
npx --no-install testlore plugins --enable agentic-qe
npx --no-install testlore plugins --check --plugin agentic-qe --json
npx --no-install testlore plugins --disable agentic-qe
npx --no-install testlore plugins --select nx
```

Install the actual tool separately using its own documented instructions. AQE can be installed project-locally; the generation adapter resolves the installed project executable. Health checks are explicit bounded probes. They are not a security certification or evidence of test quality.

Configuration lives in the existing `tddswarm.config.json`. Unrelated configuration is preserved when a plugin is enabled or disabled. A settings file can supply tool-specific settings without shell command parsing:

```sh
npx --no-install testlore plugins --enable nx --settings nx-plugin.json
```

The settings file is a project-relative JSON object, for example `{"options":["--skipNxCache"]}`. The resulting entry is `"plugins":{"nx":{"enabled":true,"options":["--skipNxCache"]}}`. Commit the configuration and dependency lockfile before running `improve`, which requires a clean committed checkout.

## Composition and authority

| Capability | Optional provider | What TestLore does |
| --- | --- | --- |
| Draft test code | Agentic QE | Architect tasks go to the actual AQE CLI. The independent worker reviewer evaluates returned code against requirements. Candidates still require isolated execution validation. |
| Select and execute native scope | pytest-testmon, Nx, Bazel | Ordinary `plan`/`run` commands delegate to the selected native engine. Native project/target scope remains explicit; no individual-case evidence is invented. |
| Coverage and mutation reports | c8, Stryker | Existing `snapshot`/`evidence` commands import actual reports with integrity and source provenance. Enabling these plugins does not schedule measurements or turn estimates into measured results. |
| Retrieve historical lessons | RuVector | A local native vector index retrieves IDs from validated memory. Canonical JSON records, framework filtering, provenance labels, and output budgets remain authoritative. |
| Supply generation workers | A registered community worker | Use the versioned architect/author/reviewer JSON protocol through an explicit installed executable. No arbitrary package is imported by TestLore. |

All built-in plugins can be enabled together. A project selects one native execution backend through `executionPlugin` (for example `"executionPlugin":"nx"`). The CLI preserves the current selected backend when additional providers are enabled; `plugins --select bazel` switches it explicitly. A hand-written configuration with multiple enabled backends and no explicit or legacy selection is rejected rather than assigned arbitrary precedence. Independent projects can select different backends through their own project roots/configuration. Other providers run only for relevant generation, measurement, or retrieval operations.

Within JavaScript/TypeScript projects, the existing Node/Jest/Vitest dependency routing remains the default when no external backend is selected. External engines supply their own selection policy; TestLore does not layer a smaller guessed JS graph over their native test universe. Legacy `integration` configuration remains explicit and is never silently overwritten by plugin configuration.

AQE remains a generation provider, not an implementation of TestLore's worker-role protocol. It needs a configured reviewer/architect worker, or the CLI's installed authenticated Codex adapter. Upstream quality scores remain labeled upstream. An unavailable enabled generation provider fails explicitly rather than silently replacing its output.

AQE receives no inherited provider API keys by default. `envNames` can explicitly opt into known provider-key variable names, for example `"envNames":["OPENAI_API_KEY"]`. Values stay in the process environment rather than the configuration; missing named variables fail explicitly. This can authorize the configured upstream provider to consume its allowance. Passing a variable does not prove AQE selected an LLM path: the actual `llmEnhanced` outcome stays visible. No unsupported provider/model CLI flags are invented.

Candidate improvement currently requires Node/Jest/Vitest individual-case validation. Native ecosystem routing works through `plan` and `run`; an external native backend needs a corresponding candidate-case validator before the branch improvement workflow can support it. Enabling an adapter does not imply every feature works for every ecosystem.

## RuVector learning

```sh
npm install --save-dev @ruvector/core@0.1.32
npx --no-install testlore plugins --enable ruvector
npx --no-install testlore plugins --check --plugin ruvector --json
npx --no-install testlore recall --query "boundary validation" --json
```

The native SDK is optional and project-local. The default embedding mode is **feature-vectors**, not a bundled semantic language model. An explicitly configured embedding command can provide vectors from a chosen model; its identity and dimensions are part of cache invalidation. See [RuVector](ruvector.md) for the real API, provider protocol, derived cache, and native verification receipt.

The sealed JSON memory remains the source of truth. Disabling RuVector returns to ordinary lexical retrieval. Missing SDKs or unusable derived indexes fall back with a reason. `learning.enabled:false` overrides retrieval plugins. No vector result can authorize omitted tests, change an oracle, accept a candidate, or merge a PR. These operations do not train model weights or establish that future tests improve.

## Community worker contract

```json
{
  "plugins": {
    "my-team-worker": {
      "enabled": true,
      "kind": "worker",
      "protocolVersion": 1,
      "command": ["node", "tools/test-worker.mjs"]
    }
  }
}
```

The worker receives JSON on stdin and returns one JSON object on stdout. Version one uses the existing [architect/author/reviewer protocol](agents.md), execution limits, bounded contexts, and independent requirements. Multiple competing workers or conflicting explicit `agent` settings are rejected. Workers are trusted local executable code and run with the user's permissions; the protocol is not a security sandbox. Explicit executable checks establish availability only, not conformance of every response.

Future integrations can implement this worker contract or contribute a native adapter with actual completeness evidence and integration tests. Hosted services such as Datadog are not connected by this catalog; account/API/authentication integrations require their own implementation. No remote-provider support is implied by a generic plugin name.
