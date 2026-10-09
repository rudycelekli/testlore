# REA public qualification: October 8, 2026

**TestLore is not qualified on this REA profile.** Published `testlore@0.1.0` caught the observed blank-path regression, but ran every declared test file and was much slower than native Vitest related in these retained runs. Randomized upstream property-test names prevented strict cross-run case identity preservation. This is a retained negative result, not evidence of a general speed or safety advantage.

## What actually ran

Pinned [morluto/rea at `3dcb732`](https://github.com/morluto/rea/tree/3dcb732da33f6ceef597506b14a4536f1c9aff96), its unchanged manifests, original Vitest configuration and original npm lockfile. `npm ci --ignore-scripts` installed upstream dependencies on supported Node 22.19.0; upstream recommends Node 24.18.0. Hooks were skipped. No native provider qualification is claimed.

The independent Linux baseline passed **2,781 cases**, with **three skips**, across **261 files** in the original `domain`, `services` and `adapters` projects. A separate macOS baseline passed 2,777 with seven platform-dependent skips. Neither scope includes all eleven REA projects, compiled CLI/MCP acceptance or real providers.

The exact npm archive matches the [published release](npm-release-0.1.0.md) SHA256 `4fa6b36c17aeae3bf1e56f6100ce1ad73d69d6e498f9deb82f8001c32569806a`, source `1f12728`. A harmless comment and an exact historical blank-path source reversion were each repeated three times. Full, TestLore and native `vitest related` arms rotated order: **six trials, eighteen execution arms**. Later upstream tests remained byte-identical. These source reversions do not recreate original historical bug environments.

## What the comparison found

Frozen [second hosted campaign](https://github.com/rudycelekli/testlore/actions/runs/37786413887), campaign source `fc7114d`:

| Change, median of three runs | TestLore span | Native related | Full execution | TestLore / native files |
| --- | ---: | ---: | ---: | ---: |
| Harmless comment | 26.54 s | 1.93 s | 24.12 s | 261 / 1 |
| Blank-path source reversion | 27.85 s | 2.08 s | 25.93 s | 261 / 1 |

Both TestLore and native Vitest preserved the **same six blank-path failure identities in all three regression repetitions**. This is one regression affecting six parameter cases, not six independent bugs. TestLore made zero omissions: multi-project resolver support remains incomplete, with `dependency-graph-incomplete` and `uncertain-dependency-closure` reasons.

All native full/TestLore executions reported 2,784 cases. Nevertheless, **zero of six trials qualify**: five property cases embed a fresh `(with seed=...)` in their names. An upstream schema-object display also differs in the independent baseline title. Changing IDs represent different property inputs; removing seed text would hide evidence. The strict evaluator rejected these runs. No failing property case was observed in this campaign, but that does not establish equivalent inputs or general failure preservation.

The [first hosted campaign](https://github.com/rudycelekli/testlore/actions/runs/37785064137) independently reproduced the six blank-path failures and full fallback, with TestLore roughly 33–35 s and native roughly 2.5 s. Its qualification was also rejected. Timing variation between runners is retained; no faster run is substituted for a rejected trial.

TestLore timing includes discovery, planning, execution, freshness and reporting inside its pilot, but excludes a fresh outer CLI startup. Native timing includes related selection and execution. Full timing excludes independent discovery. Framework/OS cache state was not reset; this is not a controlled cold/warm benchmark. Dependencies were shared by isolated source copies. HOME/npm configuration and environment credentials were isolated; this was not an OS sandbox.

## Separate real Node-loader oracle

REA's untouched `tests/boundary/filesystem/javascriptPackagePrecedence.test.ts` compares reconstruction against actual Node import/require behavior. It passed **23/23** on fixed source, caught the same **three** legacy-entry errors on each of three source reversions, and passed **23/23** again after restoration. This native boundary experiment is independent of TestLore selection. It does not qualify routing for the boundary project or compiled application.

## Reproduce and inspect

[Durable evidence](../benchmarks/rea-20261008/README.md) retains all named outcomes and source/release bindings, with an archive digest and individual member hashes. No randomized names or rejected outcomes were rewritten.

```sh
# Reassess archived executions; no dependency install or upstream execution:
node scripts/rea-public-pilot.js --verify-frozen benchmarks/rea-20261008

# Fresh native campaign; supported Node 22.19.0 and at least 2 GiB reserve:
node scripts/rea-public-pilot.js --directory /tmp/rea-new-workspace --output .tddswarm/rea-new-evidence
```

Fresh campaign exit codes: **0** qualified; **3** complete negative measurement; **1** incomplete, interrupted or infrastructure failure. The hosted workflow accepts a completed negative measurement as successful **evidence collection**, while recording `qualified:false` and explicit notices. A green collection job is not a product qualification badge. Archived assessment replay exit 0 means evidence is intact and collection complete, not that TestLore qualified.

The evaluator independently challenges file scope, named case/status preservation, native exit codes, baseline skips, interrupted execution and the exact Node regression cases. The frozen real negative measurement is also a regression control.

## Engineering consequences

1. Support fresh multi-project Vitest resolution with configuration parity and explicit project boundaries; prove omissions against independently executed full suites.
2. Separate durable test identity from random seeds and formatted parameter descriptions, while retaining seeds/input metadata and requiring comparable property inputs. Use documented seed controls for a separately preregistered experiment; preserve these untouched random runs.
3. Extend beyond this partial scope to build-qualified application, browser and service profiles before claiming installation-to-verification compatibility.
4. Repeat representative changes with complete CLI cold/warm timing. These measurements do not establish a speed advantage.

Rejected REA source reversions do not increment existing qualified historical-change/original-installation corpus counts. No generation, learning or real agent-host improvement was evaluated here. Paid model calls: zero. GitHub Actions billing is unknown. TestLore remains an experimental alpha.

## October 9 candidate observations

The [new source-bound configuration contract](configuration-inputs.md) removes the exact canonical-temp-directory uncertainty while retaining arbitrary filesystem fallback. A separately sealed candidate completed the [three-seed matrix](../benchmarks/rea-config-inputs-20261009/matrix-7532ad0/README.md): 18 comparisons, 234/261 files selected, 27 omitted per trial, no global fallback and no observed missed failures. **Every seed remains unqualified** because three skipped schema-object titles differ between native processes. TestLore was slower than native related and full execution on all three median comparisons. Seed control certifies observed seed metadata, not exact generated property inputs.

The [explicit source-bound registration experiment](rea-case-registration.md) targets those three rows using original parameter inputs and imported object-reference attestations. It never authorizes omissions; actual native transport, future campaign integration and independent comparison remain separate gates. The [earlier October 9 baseline failure and timing loss](../benchmarks/rea-config-inputs-20261009/README.md) are retained unchanged.
