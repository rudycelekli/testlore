# Measure test effectiveness, then decide

TestLore keeps separate evidence dimensions instead of claiming a universal quality score:

- Independent defect detection: the original suite must demonstrate a named behavioral failure before the candidate's detection enters comparable recall. Additional defects caught only by new tests are retained separately.
- Preservation: each existing passing case must still pass with the candidate files installed in an isolated copy.
- Stability: two to five real baseline/candidate executions, with skipped or incomplete runs unable to qualify as passing stability evidence.
- Mutation effectiveness: genuine installed Stryker 10 execution, retaining raw statuses, scope, source snapshot, producer identity, and elapsed time.
- Cost: measured wall-clock duration. Provider tokens and dollars remain `null` unless independently measured.

`measureTestEffectiveness(root, { defects, candidateFiles, repetitions: 3 })` accepts operator-supplied independent specifications and source replacement defects. Each defect is `{id, requirement, files: [{path, content}]}`. Held-out replacements cannot modify tests. `candidateFiles` is optional; source production files are never changed. Raw local reports are written under `.tddswarm/measurements/effectiveness/`. Operator labels alone do not certify specification independence. No model trains on held-out failures.

## Incremental Stryker with conservative invalidation

`await measureMutation(root, {mutate: ['src/clamp.js'], toolsRoot, commandRunner: ['node','--test','test/clamp.test.js']})` runs the installed Stryker CLI against an isolated source copy. For Node projects the native-discovered test files provide the default command. Other frameworks require explicit runner argv. No package is downloaded.

Stryker supports incremental result reuse, but [its documentation](https://stryker-mutator.io/docs/stryker-js/incremental/) explains that command-runner tests do not report locations and that supporting files/environment changes are invisible to its own diff. TestLore therefore permits reuse only when every source input, test, config, lockfile, declared service, effective runner identity, inherited environment hash, Stryker producer and TestLore implementation match the previously completed run. Any change discards the incremental baseline. Each reuse still executes Stryker's required dry run. This deliberately prioritizes correct reuse over incremental source editing in command-runner mode.

Incomplete, timed out, source-drifted, unavailable-service, corrupt, or raw-tampered baselines cannot be reused. Dependency directories are shared by convention; tool version, entry point bytes, and tools lockfile are bound, but arbitrary installed package byte changes are not yet fully attested. Package locks must reflect dependency changes.

Reproduce the real six-run scratch proof:

```sh
node scripts/incremental-quality-proof.js --tools-root . --output .tddswarm/proofs/incremental-quality.json
```

The committed receipt demonstrates 3/3 mutants killed on a tiny independent clamp contract, real warm reuse, non-mutated helper invalidation, lockfile, configuration, and inherited environment invalidation. Public fixture receipts are sanitized display data and cannot be ingested as project authority. The fixture also verifies configured environment values reach both native baseline and Stryker. It establishes no production speedup or model quality ranking.

## Learning and bounded workers

Architect/author retrieval uses meaningful current-contract tokens plus framework filtering and existing sealed canonical records. Generic words such as “boundary”, “error” and “assertion” cannot pull unrelated historical test templates into a contract-filtered run. Canonical hash validation remains required even when RuVector supplies the search ranking. Historical examples remain advisory and never authorize skipped tests or deployment. The independent reviewer receives no memory.

The paired evaluator reports empty applicable memory explicitly; such runs establish no learning treatment or improvement. Repeated trials remain clustered by independent specification. Both arms receive identical transport deadlines and response-byte caps. Source freshness and a bounded full filesystem inventory reject worker side effects, including ignored metadata and empty directories.

Transport deadlines propagate to Codex. On POSIX, the outer worker runs in an isolated process group so timeout/output-budget termination reaches descendants. A Codex adapter started through that transport can terminate that verified group. Host suspension may delay timers; late success is rejected by both wall-clock and monotonic deadline checks. Direct standalone adapters do not provide the same outer-group supervision. No paid API fallback is used.

CLI usage after installing the matching SDK locally:

```sh
npx --no-install testlore mutation --mutate src/clamp.js --json
npx --no-install testlore effectiveness --defects .tddswarm/independent-defects.json --repeat 3 --json
# Optional test-only candidate patch; production source is never applied:
npx --no-install testlore effectiveness --defects .tddswarm/independent-defects.json --patch candidate.json --json
```

Mutation execution imports its genuine raw report into `audit` only when the producer completes with fresh inputs. Non-Node runners can pass a reviewed `--settings` JSON containing `commandRunner` argv, `toolsRoot`, and `timeoutMs`; shell text is not accepted. An effectiveness receipt's `complete` flag establishes complete measurements, not high quality: inspect missed defects and additional candidate detections separately. The CLI fails when a demonstrated defect is missed or measurement is incomplete.
