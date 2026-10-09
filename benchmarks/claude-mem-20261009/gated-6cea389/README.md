# Prospective Bun prerequisite gates: October 9

[Hosted collection 37953327800](https://github.com/rudycelekli/testlore/actions/runs/37953327800) ran exact TestLore source `6cea38950813e8ccfde6a7b8ea2d7c44ddbd7026`, original claude-mem `fa8ab09f06aa05f958c5225cf3756ce52a3ebb96`, and Bun 1.4.2. It completed a **negative collection**, not product qualification.

| Original scope | Native outcome | Complete process/report time |
| --- | --- | ---: |
| `tests` | SIGKILL timeout; no complete JUnit report | 180.022 s |
| `tests/sqlite` | 244 passed | 4.190 s |
| `tests/worker/search` | 80 passed | 0.467 s |
| `tests/context` | 235 passed, 1 skipped | 9.538 s |
| `tests/server` | 306 passed, 16 skipped | 2.092 s |
| `tests/worker/http/routes` | 363 passed, 5 failed | 158.192 s |

The five route failures are the unchanged restart-page browser cases for stalled post, health, health-body, readiness and no-successor requests, each reaching its approximately 30-second test timeout. The full-suite timeout's partial stderr is retained; it does not certify a completed named-case inventory.

**Zero fault applications and zero TestLore regression trials ran.** The original route prerequisite failed, all three repetitions explicitly remain `notRun`, no fault/restoration/oracle report exists, and the protected-input receipt remains unchanged. This confirms the prospective fail-closed gate from the collector's native evidence and receipts; it is not an OS execution trace. Missed failures and fallback frequency are unmeasured because no comparison arm was admitted. Nothing here demonstrates speed, generated-test quality or learning improvement.

Original-declaration installation finished in 22.648 seconds with 1,407,098,880 bytes growth, under the unchanged 180-second deadline/2 GiB reserve/4 GiB growth policy. `npm ls --all` exited 1; the installation receipt's `dependencyInventoryAccepted` and `completed` remain false. Upstream has no committed root lock; the newly resolved lock is retained. Ignored lifecycle scripts and this rejected environment prevent overall qualification.

## Retained evidence

`independent-assessment.json` records all scopes, failed names, durations, gate decisions, immutable source/oracle bindings and installation limitations. `native-gated.json.gz` preserves 37 exact UTF-8 members: every top-level native baseline JSON/JUnit/stdout/stderr, preregistration and assessment, install/inventory logs, original manifest, resolved lock, and controller receipts. Adjacent integrity metadata binds gzip, bundle, and original member bytes. No failing scope or outlier is omitted. Isolated temporary HOME and test-side-effect files remain in the privately retained complete ZIP.

Artifact **11627267140**, 15,092,234 bytes, original ZIP SHA256 **`61f5e31fc2767b3bbb53a4bb0542bcf6c128d8d36ec68889a0991e0a398c2f8c`**, independently matched GitHub's API. Hosted retention expires October 23. Native subprocesses inherited no provider credentials. Model calls: zero; monetary cost remains unknown. Cold/warm conditions were not controlled.
