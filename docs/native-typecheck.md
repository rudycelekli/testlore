# Native TypeScript verification

A runtime test can pass while a nullable branch, declared return type, readonly mutation or consumer call violates a type contract. TestLore runs the project's installed TypeScript compiler as a complementary oracle. It does not replace the project's tests or make type checking a universal correctness claim.

`testlore setup --verify` recommends and enables this check when it finds both a root `tsconfig.json` and an installed project-local TypeScript SDK. Explicitly disabled plugins stay disabled. Setup reads bounded package/configuration metadata without importing the compiler, downloading optional tools or calling providers. Execution then qualifies the actual compiler configuration and inputs.

```json
{
  "plugins": {
    "typescript": {"enabled": true, "project": "tsconfig.json", "timeoutMs": 30000}
  }
}
```

Run through the full shadow workflow with `testlore run --shadow`. To inspect just the compiler oracle:

```sh
testlore typecheck --project tsconfig.json --json
```

The standalone command returns its result directly; it does not claim that a native runtime suite ran. Routine verification persists the combined run report. Native cases, history and shadow comparisons retain their native meaning. The overall exit is **0** when requested checks complete and pass, **1** for demonstrated failures, or **2** for incomplete evidence. A type diagnostic cannot disappear behind green runtime cases. Human summaries show diagnostic codes and bounded locations without echoing raw diagnostic prose.

## Qualified scope and limitations

The initial profile supports one project-local, unreferenced TypeScript implementation program. It uses the genuine installed SDK, preserves declared compiler options affecting checking, forces `noEmit`, disables incremental reuse and refuses writes. JSONC configuration is parsed by TypeScript. The checker records checked implementation files separately from SDK/declaration inputs.

Project references, composite builds, compiler plugins, `noCheck`, `@ts-nocheck` implementation files, empty/declaration-only or unchecked-JavaScript scope, external input/symlink layouts, unresolved configuration, malformed output and exceeded budgets remain **incomplete**. A pnpm workspace with external dependency symlinks may require a different qualified profile. `skipLibCheck`, `skipDefaultLibCheck`, excluded files and `@ts-ignore`/`@ts-expect-error` suppressions remain disclosed limitations of the declared scope.

The controller captures full source—including ignored files—and installed dependency bytes before runtime planning or execution. Its opening token is local, opaque and required by the combined verification controller; copied JSON cannot mint that binding. After runtime assertions and independent behavioral checks, it checks compiler results against the same inputs. Configuration/service callbacks run before the final byte capture. Source, dependency, Node or producer changes prevent a combined green report. Service probes and compiler execution use bounded, minimal environments. This is trusted native execution, not an OS security sandbox.

Type verification does not permit test omissions. Routing still needs its existing independently qualified dependency evidence. A pass covers only the declared compiler program and recorded suppressions; browser behavior, service correctness and security remain separate obligations.

Enabled type checking also gates the supported Node source-repair profile. Disposable repair copies retain the exact admitted installed dependency tree. Two baseline compiler checks may expose existing type errors; both candidate checks must complete and pass. Type evidence joins the authenticated validation receipt, and application/publication refuse missing, changed or failed evidence. Final branch verification checks the compiler again after independent behavioral challenges. Unsupported dependency relocation remains rejected. The initial repair profile still needs a genuine failing native assertion; a type-only failure produces a gap to resolve rather than an invented runtime repair.

Test-only improvements preserve the same initially requested compiler obligation. They copy the admitted dependency tree, require a complete compiler preflight before initialization or generation, and veto runtime-green candidates whose final compiler check fails. Native candidate acceptance alone is not typed quality readiness. After a commit, the controller actually reruns the full native suite and compiler at the new revision; it compares case identities and input bindings rather than copying a revision into old evidence. Commit-hook drift cannot become ready. Publication checks the compiler and bound inputs again before authentication and at subsequent publication boundaries. Linked candidate, result and PR-body receipts are refused without overwriting source.

Repair, investigation-repair and final CLI result updates use bounded atomic metadata storage as well. A linked result cannot clobber verified source after the last native/compiler check. Storage refusal returns `receipt-failed`, a null receipt and exit 2. If a PR was already verified before a late storage failure, its confirmed publication details remain in the returned result; a local failure does not undo that external action. The writer checks real directories, regular unlinked leaves and temporary-file identity. This is best-effort local concurrency protection within trusted native execution, not an OS sandbox.

Dependency copying is bounded to 100,000 entries and 1 GiB, with an additional 1 GiB free-space reserve. Absolute or external dependency links and incomplete compiler profiles remain reviewable gaps. A passed program covers the files admitted by its configuration; new JavaScript tests outside that program still rely on the native runtime checks. These controls do not establish provider-generated test quality or catch every possible defect.

## Reproduce the development evidence

The [public fixture manifest](../benchmarks/type-detection/development-v1/manifest.json) preserves five independently frozen development defect pairs and one separately unqualified project-reference pair. Each healthy/fault pair keeps identical ordinary-input assertions, configuration and shared contracts, changing exactly one TypeScript source. The runtime probes execute real top-level `node:assert/strict` assertions and print a completion marker. Reproduce from a reviewed source checkout:

```sh
npm ci
node scripts/type-detection-benchmark.js --output .tddswarm/type-detection-replay
node scripts/type-detection-benchmark.js --verify .tddswarm/type-detection-replay/summary.json
node scripts/type-detection-benchmark.js --challenge-evaluator .tddswarm/type-detection-replay/summary.json
```

The output directory must be new. The harness checks the original fixture and TypeScript 6.0.3 SDK hashes, repeats healthy/fault states, retains raw native/compiler output and reports unique defects, false positives, incomplete arms and total time. Source is copied into isolated fresh directories; no model or provider is called. The original reference build's cache-sensitive exit discrepancy is retained in the manifest and excluded from scored detection and speed. Its unsupported TestLore result is exercised and recorded.

These are now observed development examples, not untouched maintainer specifications, newly discovered upstream bugs, an AQE comparison or evidence of learning improvement. Native TypeScript catches the same type defects. TestLore's contribution is invoking that complementary check in the normal verification workflow, binding the inputs and retaining actionable evidence.

Recorded local replay on Node 22.19.0 and TypeScript 6.0.3: **5 unique seeded defects, 10/10 fault exposures detected, 0 healthy false positives, 0 ordinary incomplete checks**. All 24 unchanged ordinary-input runtime probes passed; four reference exposures remained explicitly incomplete. Staging, opening capture, native probes, both compiler arms and evidence writes took **79.34 seconds** before the final receipt. This is a development qualification result with uncontrolled host load, not a speed claim. CI reruns the public examples, raw-output replay and eleven evaluator counterexamples.
