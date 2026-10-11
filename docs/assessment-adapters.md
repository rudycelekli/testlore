# Complementary assessments, explicit evidence

TestLore routes tests and validates changes. Agentic QE can author candidate tests. Guardana contributes security-contract assessments; iFixAi contributes agent-behavior assessments. These roles coexist without a combined score overriding native tests.

The **Guardana and iFixAi adapters import existing local JSON reports**. They do not run either evaluator, install Python packages, call providers, transmit traces, or trigger upstream telemetry. Live evaluation orchestration remains unimplemented. TestLore's one-command shadow setup continues to work without these optional tools.

## Use a report immediately

With the current TestLore source installed locally:

```sh
npx --no-install testlore assess --plugin guardana --report reports/security.json --json
npx --no-install testlore assess --plugin ifixai --report reports/behavior.json --json
```

Both paths are project-relative. A direct `--plugin` plus `--report` requests a one-off import, including when that plugin is disabled in configuration. It does not enable the plugin. Supplying just `--plugin` uses its configured report only if enabled. Without either option, `assess` imports all enabled assessment adapters independently.

Configure repeated imports in `tddswarm.config.json`:

```json
{
  "plugins": {
    "guardana": {"enabled": true, "report": "reports/security.json"},
    "ifixai": {"enabled": true, "report": "reports/behavior.json"}
  }
}
```

```sh
npx --no-install testlore plugins --recommend --json
npx --no-install testlore plugins --check --plugin guardana --json
npx --no-install testlore assess --json
```

Recommendations explain each separate role and retain explicit settings. Setup never guesses report paths or treats upstream executable presence as permission to evaluate a system. Assessment health checks only establish that the configured report can be imported, including incomplete reports. They do not certify its findings or current relevance. All nine built-in plugins can be enabled together; one selected native backend owns execution.

## Supported upstream formats

| Adapter | Inspected format | What survives import |
| --- | --- | --- |
| Guardana | Native saved-run `schema_version:17`; source inspected at [`b6fe4fd`](https://github.com/guardana/guardana/tree/b6fe4fd2bb45c12107a64dd695e86b3ae4c0829c) | Findings, unverified and waived findings, errors, skipped rules, stopped runs, coverage shortfalls, trial/suite gaps and assessment outcomes. |
| iFixAi | Native JSON exporter from package 4.1.0 at [`8066421`](https://github.com/ifixai-ai/iFixAi/tree/8066421a25df687609d28ce3ed6dab7ec14aa6a2), with `metadata.specification_version:"3.0"` | Per-inspection outcomes, mandatory violations and omissions, partial/aborted runs, extraction failures, reported classifications and available logical-call/duration observations. |

The inspected source pin identifies the adapter's development contract; it does not authenticate a report. Unknown versions and malformed completeness-critical fields are refused. These are bounded projections of the inspected formats, not complete implementations of the upstream schema validators. Synthetic fixtures verify parser and transport behavior; no live upstream evaluation or effectiveness improvement is claimed.

iFixAi's native exporter has no report schema-version field and does not export complete per-inspection scoring classifications or fixture/model bindings. Even a reported grade A remains **incomplete** in TestLore. Warning markers preserve exploratory, advisory and attestation distinctions where available; absence of markers proves nothing. SDK retries are outside reported logical-call accounting, so reported counts cannot establish total provider cost.

## Understand the result

Each import preserves the input SHA-256 and byte count, normalized checks, uncertainty and a next action. Raw prompts, responses, trace contents, URLs and free-form finding prose are omitted; review the original report privately for details. Inputs are limited to 4 MiB, structural JSON bounds and 2,048 normalized checks. Duplicate JSON keys, unsafe paths, symlinks, nonregular files and detected concurrent changes are refused. One invalid adapter does not discard another adapter's usable report.

Receipts are new private files under `.tddswarm/assessments/`, created with mode `0600`. `--output` can choose a new project-relative file; existing files are never overwritten. Inside `.tddswarm`, custom output is restricted to `assessments/`, keeping receipts separate from native-run, routing, quality-evidence and learning stores.

| Result | Exit | Meaning |
| --- | --- | --- |
| `reported-clean` | 0 | Guardana reports no findings or unresolved coverage gaps within its recorded scope. Historical producer claim only. |
| `findings` | 1 | Reported failures retained, including alongside uncertainty. Investigate independently. |
| `incomplete` | 2 | Missing evidence, refused input, unsupported format or no configured assessment. Resolve the reported gap. |

A batch returns 2 if an input is refused or an assessment is incomplete; otherwise it returns 1 for findings, or 0 for reported-clean. `importComplete` means the supported report was read; `assessmentComplete` conservatively identifies only reported-clean scope. Every receipt has `currentBinding:"unverified"` and explicit false authority for routing omissions, candidate/repair acceptance and learning promotion. An imported report never establishes deployment safety, a fresh test result, evaluator independence or a superior tool.

Run `testlore run --shadow` for independent native verification. Reproduce relevant findings and review assessment scope before any repair or promotion. Live adapters would additionally need explicit data policy, telemetry controls, finite request/time/token budgets and independently measured conformance before activation.
