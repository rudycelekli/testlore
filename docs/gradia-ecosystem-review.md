# Gradia ecosystem: complementary roles and qualification gates

Source review: 2026-10-10 America/New_York. All inspected projects below are public repositories owned by `rudycelekli`. This review inspected immutable source, packaging, command dispatch and declared limitations. A bounded native Python Guard SDK verification experiment is recorded below; other evaluators and published experiments were not executed, and no improvement to TestLore application testing was measured. Private Gradia implementations and trajectories are outside this review.

The useful contribution is to strengthen evidence and challenge TestLore's evaluators. Adding every package to every installation would introduce unrelated research workloads without proving better testing. TestLore keeps ownership of native test execution, dependency routing, independent candidate validation and conservative fallback. Guardana/iFixAi remain historical assessments; Agentic QE remains a candidate-generation capability.

## Pinned public inventory

| Project / inspected default-head revision | Packaging and inspected interfaces | Decision |
| --- | --- | --- |
| [Gradia Guard](https://github.com/rudycelekli/gradia-guard/tree/92a93c610f4d02c3db21fe6a6d526d9bd046fe86), `92a93c610f4d02c3db21fe6a6d526d9bd046fe86` | `@gradia/guard` `0.1.0-beta.8`, Node >=20.12; `runGuardedProcess`, `verifyBundle`, `verifyProofPackDirectory`, `SdkRecorder`. CLI `run`, `verify`, `proof-pack verify`, SDK/runtime/MCP-specific verifiers. | **ACCEPT scoped adapter design.** Independently replay existing local evidence and retain exact coverage/uncertainty. Implementation and qualified transport still required. |
| [Wind Tunnel](https://github.com/rudycelekli/gradia-wind-tunnel/tree/5ee09fbd4730ea5ada449ac652dcc3945b2274ce), `5ee09fbd4730ea5ada449ac652dcc3945b2274ce` (`master`) | `gradia-wind-tunnel` `1.0.0`, Python >=3.11, no base runtime dependencies; CLI `verify-bundle`, `verify-report`, `program-readiness`; optional real datasets/provider/container paths. | **ACCEPT development evaluation role.** Challenge the scorekeeper with independently wrong outcomes that weak scorers accept. Defer automatic live evaluation and production adapter activation. |
| [Code Transplant](https://github.com/rudycelekli/code-transplant/tree/51297987d6aa12786313b43686ea9715b47c3aba), `51297987d6aa12786313b43686ea9715b47c3aba` | `@gradia/code-transplant` `0.1.0`, Node >=22, runtime TypeScript `5.9.3`; `extractFeature`, `verifyBehavior`, `verifyReport`; CLI `extract`, `check`, `verify`. | **DEFER general adapter.** Consider an explicitly selected migration/differential-testing workload. Its dependency capsules are hypotheses to compare against native resolvers, not evidence permitting arbitrary test omissions. |
| [Gradia Universes work sample](https://github.com/rudycelekli/gradia-universes-work-sample/tree/8f4ff4aa4b4e462eb5e2b1c853a48307e9e9406a), `8f4ff4aa4b4e462eb5e2b1c853a48307e9e9406a` | Python >=3.11, alpha `0.1.0`, no base runtime dependencies; `gradia-universe verify`, `frontier-verify`, `axes-verify`, `study-a-verify`; deterministic synthetic world/runner and criterion judge. | **ACCEPT development fixture role.** Exercise stale evidence, changed authority, retraction, interruption and exactly-once restore. Defer default/runtime adapter; synthetic underwriting tasks do not qualify real application routing or agents. |
| [Gradia Lens](https://github.com/rudycelekli/gradia-lens/tree/09b5ea2179aecf9d98a8ed38c76e36b74182148a), `09b5ea2179aecf9d98a8ed38c76e36b74182148a` | Python >=3.9, alpha `0.1.0a1`; base has no runtime dependencies, explicit model extra pins Torch/Transformers/NumPy. `execute`, `replay`, `Engine`; CLI compare/trace/head/weight/evaluate/search/challenge/replay. | **DEFER ordinary testing adapter.** Useful only when the project itself qualifies supported model interventions. Current GPT-2 lexical probes and replay do not demonstrate improved test generation or semantic correctness. |
| [Reward Loop](https://github.com/rudycelekli/gradia-reward-loop/tree/cac806c91843d853f703b28cf90f1a04f936b4ee), `cac806c91843d853f703b28cf90f1a04f936b4ee` | Python >=3.10, research alpha `1.0.3`, NumPy base dependency; optional real-model training dependencies. CLI `verify`, `verify-pair`, `analyze-pair`, `verify-analysis`, `verify-final-replay`. | **DEFER default adapter/training.** Its proxy-versus-oracle diagnostics inform learning promotion controls. A single frozen training diagnostic cannot establish that TestLore learns effectively. |

The public license files and package metadata declare Apache-2.0 for all six projects. Code Transplant's retained date-fns donor has its own MIT license; copying a donor still requires retaining its provenance/notices and evaluating compatibility. GitHub's repository license classifier returned `NOASSERTION` for four projects, which is not a reason to replace the actual license text. Gradia Lens excludes the surrounding Gradia application and model weights from its package license. Gradia names/marks do not grant derivative branding rights.

Sources: each pinned repository above, especially its `LICENSE`, `package.json`/`pyproject.toml`, README and the concrete source files linked below. Version strings and development classifiers describe those source editions, not independently established production maturity.

## Important installation and scope corrections

The [Guard package manifest](https://github.com/rudycelekli/gradia-guard/blob/92a93c610f4d02c3db21fe6a6d526d9bd046fe86/package.json) contains runtime dependency `@ag-ui/core: "0.0.59"`. Calling the entire current Node package dependency-free would be inaccurate. Its local verification paths do not require a managed account; this is different from proving that every package import is dependency-free or performs no work.

A live registry metadata lookup for `@gradia/guard` returned npm `E404` during this review. Registry installation was therefore **not verified**. The pinned README also contains older beta.7 install/action examples while the checked package and CLI identify beta.8. Any integration must use a verified immutable build/archive and record its actual identity; do not promise a working `npx @gradia/guard` installation from this source review.

The [Python Guard verifier](https://github.com/rudycelekli/gradia-guard/blob/92a93c610f4d02c3db21fe6a6d526d9bd046fe86/python/src/gradia_guard/verify.py) is an independent standard-library implementation of the G2 SDK ABI. Its CLI declares Python >=3.12, supports local `verify`/`inspect`, and is narrower than the Node verifier. The README says PyPI publication is pending; this review did not independently qualify a registry wheel.

The [Proof Pack implementation](https://github.com/rudycelekli/gradia-guard/blob/92a93c610f4d02c3db21fe6a6d526d9bd046fe86/src/proof-pack.ts) admits a specific Wind Tunnel manifest/frame profile. It is not a general verifier of arbitrary TestLore receipts. Its [composite action](https://github.com/rudycelekli/gradia-guard/blob/92a93c610f4d02c3db21fe6a6d526d9bd046fe86/action.yml) installs and builds source before verification; those costs belong in complete campaign timing.

## Minimal Guard integration worth qualifying

Add a separate optional **local evidence verification** capability. Do not reuse the historical assessment adapter's score/status semantics. The initial interface should verify an explicitly named existing bundle with one verified local Guard implementation; recording new runs is a later, separate capability.

1. Resolve an explicit project-relative bundle directory. Copy only the allowlisted manifest/frame files into a private immutable snapshot after bounded regular-file, no-symlink, stable-identity reads. Refuse unknown profiles, excessive bytes/frame counts, duplicate JSON keys, unsafe payload references or changing inputs. Never pass an untrusted bundle directory straight to an unbounded upstream filesystem reader. Start with digest-only bundles; encrypted payload support needs its own key policy and qualified handling.
2. Execute the pinned trusted verifier using an argument array and finite wall/output limits. No shell, automatic install, provider evaluation, managed upload or credential discovery. Keep local verification opt-in until packaged execution and environment behavior are qualified. A parent runner must enforce termination: [`runGuardedProcess`](https://github.com/rudycelekli/gradia-guard/blob/92a93c610f4d02c3db21fe6a6d526d9bd046fe86/src/run.ts) does not expose a timeout in `RunOptions`.
3. Preserve the native exit, bounded stdout/stderr, parsed blockers, exact verifier/source/archive identity, input file digests, elapsed time, supported schema, session/chain identity, payload availability and validated manifest coverage. Join these to the TestLore campaign, repository revision, configuration, test manifest and independently executed result by explicit content identities. Guard's process command digest alone does not bind all source/configuration dependencies.
4. Return independent fields for `verificationValid`, `recordedOutcome`, `captureScope`, `currentBinding` and `nextAction`. A valid historical failed/not-started record stays failed/not-started. Missing bytes and blind spots stay visible. All authority fields for routing omission, generated/repair acceptance, deployment safety and learning promotion remain false.
5. Permit schema families only after qualifying each one. Node supports process, gateway and SDK bundle dispatch; Python parity testing is limited to the shared SDK family. This is not license to translate a process bundle into SDK evidence or promote recorder coverage to complete application coverage.

The critical semantic distinction is in [`verifyBundle`](https://github.com/rudycelekli/gradia-guard/blob/92a93c610f4d02c3db21fe6a6d526d9bd046fe86/src/verify.ts): `ok` means the evidence record passes verification. A correctly recorded nonzero child exit can pass verification. The native [`VerificationResult`](https://github.com/rudycelekli/gradia-guard/blob/92a93c610f4d02c3db21fe6a6d526d9bd046fe86/src/types.ts) does not itself include terminal disposition, so the adapter must preserve the separately validated manifest/outcome. Digest-only payloads may be unavailable while the chain is valid. Neither a hash nor a signature proves that the recorded test was adequate or that the recorder was honest.

Its concrete extra value over TestLore's existing signed observation loop is portable producer-specific evidence verification, explicit SDK/provider/tool coverage and, for supported SDK bundles, an independently implemented Python cross-check. Hash-chaining alone duplicates a mechanism TestLore already has and is not sufficient justification for another dependency.

### Acceptance before claiming a working adapter

- Verify a genuine pinned producer fixture and a newly produced bounded local bundle in the sealed TestLore production installation. Capture the actual process result, not a fabricated `ok` JSON.
- Independently challenge truncation, missing terminal frames, reordered/replayed occurrences, identity substitution, false complete-world coverage, malformed/duplicate fields, symlink substitution, oversized files, executable failure, timeout and inconsistent exit/JSON results.
- Accept valid failure records as valid **records** while refusing to label them passing tests. Verify that missing payload bytes remain disclosed and that no result enters routing/acceptance/learning stores.
- For SDK ABI parity, run both exact Node and Python implementations over one frozen corpus and every applicable malformed control. Preserve disagreements as refusals; do not choose the more favorable verifier.
- Show an actionable gain: a corruption/coverage/provenance gap caught beyond current TestLore checks, or a portable external verification workflow a maintainer can replay. Measure full added time/bytes/resources and report negative results.

This review accepts the design, not those unexecuted acceptance outcomes.

### Executed native SDK verification preflight

[`scripts/gradia-guard-proof.js`](../scripts/gradia-guard-proof.js) executes the actual pinned Python verifier over the upstream cross-language golden fixture and five owned derivatives. It checks nine exact upstream file hashes (including LICENSE/NOTICE) before any supplied Python executable runs, copies only those files into a fresh private snapshot, requires an existing Python >=3.12, uses isolated Python startup and a bounded subprocess, and preserves 41 raw source/input/stdout/stderr/process records with hashes. It performs no download, installation, provider call or project test execution. Both the original source bytes and all owned inputs remain available for independent replay.

Run from a reviewed source checkout containing the pinned files; the destination's parent must already exist:

```sh
node scripts/gradia-guard-proof.js \
  --source /absolute/reviewed/gradia-guard \
  --python /absolute/existing/python3.12 \
  --output .tddswarm/gradia-proof-new
```

Observed with Python 3.12.12 and Guard source `92a93c610f4d02c3db21fe6a6d526d9bd046fe86`:

| Input | Actual verifier exit | Observed meaning |
| --- | --- | --- |
| Upstream SDK golden fixture | 0 | Valid recorded evidence; all three digest-only payloads remain unavailable. |
| Owned rehashed `decision_failure` record | 0 | Valid **failure evidence**, demonstrating why verifier success cannot imply a passing task. |
| Truncated frame log | 1 | Missing action and inconsistent counts/head refused. |
| Changed frame digest | 1 | Digest/previous-head mismatch refused. |
| Rehashed complete-world overclaim | 1 | Coverage semantics refused despite a consistently rebuilt chain. |
| Unsupported SDK schema | 1 | Unsupported manifest schema refused. |

`verifyGradiaGuardProofRaw` rehashes and reparses the retained inputs, exact pinned producer source, actual native outcomes and process results; a changed raw verdict or invented acceptance authority is refused. Four local regression checks cover source substitution before execution, source symlinks, independently recomputed overclaim-chain consistency, original-input preservation and authority refusal. The native six-case experiment and raw replay passed. Independent Node/Python parity, fresh recorder production, a packaged TestLore adapter, adversarial filesystem races and general effectiveness remain unqualified. This is a real native verifier preflight, not an installed optional plugin or a quality improvement result.

## Wind Tunnel and Universes: test the evaluator

Use [Wind Tunnel's oracle/scorer contract](https://github.com/rudycelekli/gradia-wind-tunnel/blob/5ee09fbd4730ea5ada449ac652dcc3945b2274ce/src/gradia_wind_tunnel/contracts.py) to challenge generated-test grading, report imports and campaign claims. Candidate attacks should include assertion removal, always-true assertions, only executing the happy path, excluded failing cases, incomplete named outcomes, graded infrastructure failure, and fabricated/rehash-consistent aggregate reports. A frozen independent native bug oracle must decide whether an output is actually wrong; an agent's plausibility score cannot be its own oracle.

Retain budgets, discovery/holdout separation, every attempt and cost, clean negative controls, and an independent promotion decision. The published Wind Tunnel findings are source-reported research results; importing them does not establish that TestLore's evaluators pass those challenges. Its current public contracts must be adapted and executed against the actual TestLore evaluator before claiming integration effectiveness.

Use the public [Universes world and runner](https://github.com/rudycelekli/gradia-universes-work-sample/tree/8f4ff4aa4b4e462eb5e2b1c853a48307e9e9406a/src/gradia_universes) as synthetic conformance cases for repair/evidence state machines: a plan becomes stale after authority/source changes; a retracted fact cannot authorize a patch; restore must not apply an event twice; an unauthorized embedded instruction cannot grant tool authority. Public `verify`/`frontier-verify`/`axes-verify` commands replay finite scripted controls. Keep them labeled synthetic and separate from upstream regression campaigns. Later private implementations described in the README are not available public integration evidence.

## What earns an upstream campaign win

A complementary package is valuable only when it improves a recorded task. For each real contribution, retain a pinned unchanged upstream baseline, independently reproduced bug, protected regression test, candidate patch, genuine native fixed/full runs, TestLore/native/full-suite timings and complete failure/cost accounting. Track maintainer review/acceptance separately from passing CI. Publicly available packages may supply instrumentation or evaluator controls; enabling them all is not a measure of quality.

Current campaign claims must distinguish who found the bug, whether TestLore independently caught it, whether routing omitted tests safely, and whether an optional adapter changed the outcome under an identical budget. Neither public popularity nor a passing local fixture establishes universal correctness, a speed advantage, better learning or maintainer acceptance.
