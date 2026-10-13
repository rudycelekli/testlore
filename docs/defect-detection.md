# Catch more defects through complementary checks

TestLore has not demonstrated the highest overall bug-detection rate. Its strongest routing observation currently preserves **two seeded failures** in a pinned original unimport environment that native related selection omitted. The original full suite catches both too. This establishes an additional dependency-routing case, not additional defects beyond that full suite. [Exact scope, omissions and timing losses](qualified-routing-repair-gates.md).

A separate development counterexample demonstrates why a green suite is insufficient: a historical proposed klona repair passes all **137 original assertions** but breaks a readonly-constructor case. A separately maintained behavioral challenge rejects the candidate. That is inspected development evidence, not an untouched holdout or proof of better learning. [Repair qualification](parameter-type-repair-qualification.md).

## Routine behavioral verification

Explicitly configured behavioral challenges now supplement `testlore run` and `testlore setup --verify`. They run even when native selection contains no files. No challenge is inferred from a high quality score or generated automatically from implementation output. Existing configurations without challenges expose an additional-check gap.

Use the same reviewed configuration as source repair:

```json
{
  "adapter": "node",
  "discovery": "native",
  "runner": ["node", "--test", "{files}"],
  "executionMode": "shadow",
  "repair": {
    "sourcePaths": ["src/parser.js"],
    "challenges": "quality/contracts.json"
  }
}
```

Commit `quality/contracts.json`:

```json
{
  "schemaVersion": 1,
  "independent": true,
  "basis": "Maintainer-reviewed published parsing contract, section 4.",
  "cases": [
    {"id": "reject-trailing-input", "script": "quality/trailing-input.cjs"}
  ]
}
```

Each script exports a function receiving `{assert, root}`. Maintain expected values independently of the implementation; await asynchronous work. For an ESM project:

```js
module.exports = async ({assert, root}) => {
  const {pathToFileURL} = require('node:url');
  const {parse} = await import(pathToFileURL(root + '/src/parser.js').href);
  assert.throws(() => parse('42 trailing'), /Unexpected trailing input/);
};
```

Run just these explicit obligations with `testlore contracts --json`. Its durable local receipt is `.tddswarm/contracts.json`. This command does not invoke generation, change source, select tests or publish a PR. A missing configuration exits **2**, not a successful zero-check result.

The initial profile is bounded trusted execution: 1–32 unique `.cjs` challenges, explicit existing production source paths, current Node, no inherited application/provider environment, 20 seconds per process and a checked 120-second total budget including input capture. Each challenge needs completed tracked assertions. Bare Node imports do not provide arbitrary TypeScript loaders, browser fixtures or authenticated services. External services and unsupported dependency layouts remain incomplete. This is not an OS sandbox.

The harness records unfinished asynchronous assertions as incomplete even when the challenge forgot to await them. Failed assertions do not suppress later independent checks. Oracle/source/dependency/runtime drift aborts the remaining checks. Original source, ignored project inputs and installed dependency bytes are captured and compared; missing evidence, malformed output, unexpected stderr, output spoofing, timeouts and zero-assertion checks cannot establish green contract coverage.

Native outcomes, native exit, native history and shadow comparisons retain their original meaning. Overall exit includes additional challenges: **0** for the completed requested checks, **1** for demonstrated failures, **2** for incomplete evidence. Reports show native and behavioral outcomes separately. A source mismatch between the native receipt and the contract window prevents combining them into a green result. One routine execution does not establish repeated stability or publication authority.

## Complementary detectors, not a universal ranking

Primary documentation inspected October 12, 2026. Descriptions below are upstream capabilities, not same-task TestLore benchmark results.

| System | What it contributes | What the comparison does not establish |
| --- | --- | --- |
| [Agentic QE](https://github.com/proffesor-for-testing/agentic-qe) | Agent-assisted generation, coverage/flakiness investigation and coordination of security, contract and resilience checks. | TestLore has no demonstrated overall detection advantage over current AQE. Use the supported adapter and independently execute candidates. |
| [Stryker](https://stryker-mutator.io/docs/mutation-testing-elements/mutant-states-and-metrics/) | Reveals mutants that tests kill, miss or do not cover; challenges assertion effectiveness. | Mutant score is not recall on every real defect. TestLore already supports genuine installed Stryker measurement. |
| [OSS-Fuzz/CIFuzz](https://google.github.io/oss-fuzz/getting-started/continuous-integration/) | Runs fuzz targets with address, memory and undefined-behavior sanitizers; can report timeouts/OOMs. | These native fuzzing profiles are not qualified through TestLore's Node challenge runner. |
| [CodeQL](https://codeql.github.com/docs/writing-codeql-queries/about-codeql-queries/) | Security and code-quality queries over a code database. | A static finding needs triage; runtime test selection cannot substitute for its query coverage. |

TestLore should coordinate complementary oracles and preserve their evidence. Enabling a tool, retrieving a lesson, parsing an advisory report or listing an adapter does not establish that its detectors executed successfully. Unrun detector families remain unknown.

The installed project-local TypeScript checker now participates in routine verification when enabled. Setup recommends it for a root TypeScript project. Five observed development defect pairs demonstrate native-green/type-failed behavior with healthy controls; the genuine TypeScript compiler detects the same defects. [Scope, failure handling and public reproduction](native-typecheck.md).

## Qualification and next detection gate

The new evaluator controls intentionally use development fixtures. They demonstrate native-green/contract-failed behavior, empty selections, continuing independent cases, setup/fallback/cancellation, ignored/dependency drift, timeout/output rejection, and completed asynchronous assertions. They do not demonstrate new upstream defects or out-of-sample model quality.

To earn a broader detection claim, freeze independently labeled bugs across behavioral boundaries, property/serialization inputs, browser/server interactions, workspace/type boundaries and security inputs. On identical revisions and budgets, compare full native suites, native selectors, AQE alone and AQE plus TestLore. Retain the union of independently confirmed defects, tool-exclusive detections, false positives, incomplete/time-out arms, unique defect identities, total elapsed time and measured provider cost. Do not count mutation failures as new real bugs or duplicate one bug across many failing cases.

Promotion requires a demonstrated extra defect that the baseline misses, healthy-source negative controls, repeated reproduction and preservation of existing assertions. Never promise that finite checks catch all possible bugs.
