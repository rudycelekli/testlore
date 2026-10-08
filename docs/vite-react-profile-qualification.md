# Pinned Vite React application profile

The original build-browser baseline now completed on vitejs/vite-plugin-react revision `80417060f7bc239d5100e1b47c819e8364c7d551` (`plugin-react@4.7.0`): **20 files, 48 leaf cases, 35 passed, 13 pending, zero failed**, with a recorded phase duration of 10.993 seconds. That duration excludes phase preflight and final provenance/resource/reporting work; complete wall timing was not captured. Pending outcomes are retained by file and name in the [public receipt](../benchmarks/framework-profiles/vite-react-4.7.0-build-baseline-20261008.json).

This establishes an original native baseline for the declared playground scope. It does not establish safe TestLore omissions, fault detection for every input, a speed advantage, or a complete application profile. SWC/RSC native suites, lint, type checks and production service dependencies remain outside this scope. The original 2026-10-07 unit/serve/build and installation bindings remain in the [earlier receipt](../benchmarks/framework-profiles/vite-react-4.7.0-baseline-20261007.json).

## Portable native replay

```sh
node scripts/vite-react-native-profile.js
node scripts/vite-react-native-profile.js --run --output /absolute/new/private/profile
```

The default command prints a plan. Explicit replay requires Node 22.19.0, a fresh output directory, the pinned full original pnpm installation, original manifests/configuration/assertions, and a private pinned Playwright browser path. On a fresh Linux runner lacking browser system libraries, add `--authorize-system-deps`; this is an explicit separate opt-in. Every native phase checks disk and allocation before, during and after execution, retains outputs and checks original tracked bytes. The final result remains `completeApplicationProfile: false` even when all original native baselines pass.

The controller uses distinct fresh private npm user/global configuration files and excludes personal credentials. It rejects all-pending build reports, missing case identities, expired deadlines, excessive logs, failed resource observations and observed child processes that survive a successful parent. Child cleanup observes PID/start identity on a best-effort basis; unobserved or reparented children are not contained. This is a controlled profile runner, not an arbitrary-code sandbox.

A first local attempt produced native output but was rejected because allocation observation raced deletion of generated fixture files. Its raw receipts remain negative evidence. A fresh run passed after adding bounded ENOENT-only remeasurement; other or persistent allocation failures still reject.

## Fixture-root proposals

```sh
node scripts/vite-react-fixture-proposals.js /absolute/pinned/upstream
```

This read-only producer binds original global/setup/configuration bytes, source inventory and original tests. It follows the pinned harness's explicit test → playground → variant/configuration relation and proposes 20 associations with relevant workspace inputs. It returns `review-required`, `routingAuthority: none`, `closedWorld: false` and `omissionAuthority: false`. It applies no mapping and consumes or removes no graph warning.

New source inputs, custom serve hooks and changed setup independently invalidated the review during the local campaign. Missing source and forged integrity/authority payloads are also covered by focused tests. These controls protect the proposal contract; they do not establish complete runtime dependencies.

## Remaining challenges

A fresh serve/fault campaign stopped on its disk reserve before any fault was introduced. Its incomplete receipt remains public. Original tracked bytes were restored/unchanged and no observed descendants survived cleanup. The suite's shared memory/swap demand may contribute to free-space decline; profile allocation measurements cannot attribute every byte to another process.

The next qualification must independently execute original full and proposed subset runs for source changes, Emotion styles, SSR route pages, server inputs, and workspace source/built-artifact boundaries. Deliberately swapped fixture selections must fail failure-preservation review. The unasserted favicon needs an explicit detection-gap control; passing suites cannot prove asset defect detection. Constructed faults must remain separately labeled from genuine historical maintainer bugs.

Keep dynamic imports, generated bundles, unseen routes/assets and service uncertainty in full fallback until the corresponding evidence is independently challenged. The current source tests passed 8/8; complete portable installation and independent fault challenges still require a fresh adequately resourced runner.
