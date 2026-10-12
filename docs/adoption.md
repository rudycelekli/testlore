# Experimental alpha adoption

TestLore is experimental. Current source is prepared as **`0.2.0-alpha.1`**, pending publication and exact registry-byte verification. The older verified npm `0.1.0` is retained as a historical release and lacks current repair and automatic adapter features. [Candidate release gates](releases/0.2.0-alpha.1.md) and [historical registry evidence](npm-release-0.1.0.md) keep those states separate.

## Start with a useful native result

From your project, use the same current-source command as the README:

```sh
npm exec --yes --package=github:rudycelekli/testlore#main -- testlore setup --verify
```

This configures a named project quality-agent profile and shadow/full workflow, explains suitable installed complementary adapters, and attempts native full shadow verification. It preserves existing choices and workflows. Setup makes no agent calls or optional-tool downloads; local audit/routing need no AI account. `--verify` runs project code. Omit it for configuration-only setup. A missing native prerequisite produces a next action rather than a passing verification claim.

`#main` moves. An immutable fallback for the previously reviewed workspace/case-identity implementation is:

```sh
npm exec --yes --package=github:rudycelekli/testlore#abc861db7830945628cc8e0f154c622e72461a84 -- testlore setup --verify
```

That revision predates the new candidate's first-result reporting changes; its prior qualification does not qualify new candidate bytes. Replace the SHA with a separately reviewed revision when adopting those changes.

`npm exec` temporarily installs TestLore for that invocation. For later `npx --no-install` commands and the optional `testlore/playwright` fixture, install the same reviewed source persistently:

```sh
npm install --save-dev github:rudycelekli/testlore#abc861db7830945628cc8e0f154c622e72461a84
npx --no-install testlore doctor --json
npx --no-install testlore audit --json
npx --no-install testlore plugins --recommend --json
```

Inspect and commit setup files and independent `tddswarm.requirements.md` before running `autopilot`. Generation workers and optional tools are configured separately. Node/Jest/Vitest have native validation paths; Nx, Bazel and pytest-testmon retain their own delegated scope.

Start with a clean committed checkout and a representative test suite. Keep full CI execution while evaluating shadow plans:

```sh
npx --no-install testlore run --shadow --base YOUR_REVIEWED_BASE_COMMIT --json
```

Shadow mode executes the full suite and compares the proposed file selection against actual failures. It can cost more than your existing full run because discovery, planning and evidence collection are included. Study representative copy/assets, source, shared dependencies, configuration, deleted files and dynamic dependencies. Record unknown-input fallbacks and misses rather than selectively reporting favorable changes. Existing benchmark charts show both a tiny-suite slowdown and a constructed costly-workload improvement; neither predicts your repository's savings.

To evaluate improved tests, commit independent behavior in `tddswarm.requirements.md`, configure an installed worker, then use `testlore improve --local` for the first proposal. Examine candidate review, collection preservation, full branch execution, and independent fault expectations before merging. A high static grade or upstream estimate does not prove assertion quality.

For source repairs, also commit a [behavioral challenge manifest and scripts](autonomous-repair.md#executable-regression-vetoes) under `repair.challenges`. They must exercise independently maintained behavior that already passes on unchanged source. `awaiting-challenges` returns a concrete setup action before any repair worker starts. A proposed patch must pass the original assertions and repeated challenges; publication rechecks the authenticated receipt, source, oracle, runtime and installed dependencies. Challenges establish their observed behavior, not complete correctness or a security sandbox.

## Pilot participation

We are seeking independently maintained Node, Jest and Vitest repositories with real tests and reviewable change history, including projects where selection overhead may dominate. Python/Nx/Bazel pilots can assess native delegation separately. Participation is voluntary; no pilot is claimed merely because a public benchmark used a repository.

A useful pilot report records the reviewed TestLore revision, runner/dependency versions, setup effort, representative changes, observed omitted failures, callback-bearing files, planning and execution time, full-suite behavior, candidate acceptance/rejections, and actionable setup failures. Keep proprietary sources, receipts, tokens and test output local. Share only an explicitly reviewed aggregate or a reproducible sanitized public example. The existing local learning aggregate export contains fixed counts; it is not a license to publish raw evaluation receipts.

Open a [pilot issue](https://github.com/rudycelekli/testlore/issues/new) with the framework, approximate suite size and a public or sanitized reproduction when you are ready to participate. Maintainers should agree on scope, success criteria and allowed data before collecting evidence. No announcements or outbound messages are sent by the software or this document.

Adoption progress is evidence-driven: retain misses and overhead, establish a stable shadow baseline, review independent generated-test behavior, and only then change CI policy deliberately. A pilot can conclude that the existing native full suite is faster or simpler. That is a useful result.

## Interpret the first result

The current source candidate returns the same advisory `summary` from setup verification, CLI runs and MCP verification. Human output leads with it; add `--json` for machines. It includes the observed `verdict` and `complete` status, proposed versus actually executed files, named `failedCases`, grouped `fallbackCauses` with actions, `slowCases`, scoped timings and `nextAction`. Case counts are `null` when a delegated engine does not expose trustworthy individual outcomes. `slowCases` uses native reported individual durations only; it is not total execution time or a safe-removal recommendation. The durable raw run keeps `summary`, and the Markdown report leads with the same information. Preserve `.tddswarm/last-run.json` and `.tddswarm/last-run.md` when produced. After an aborted attempt, those files may describe an older run; check freshness before using them.

A passing full shadow run establishes observed native outcomes at that revision. It does not qualify omissions for other changes or establish a speed advantage. A static grade does not establish bugs caught, and retrieved lessons remain advisory. Expensive test measurements identify observed costs to investigate; they do not prove tests can safely be removed.

An explicit `node --test` package script takes precedence over installed Vitest/Jest development dependencies. Otherwise setup chooses the installed native framework. Local Vitest commands use a portable project-relative CLI path; existing runner configuration stays explicit.

Inspect prerequisites before starting execution:

```sh
npx --no-install testlore doctor --json
```

`doctor` parses bounded configuration and installed native SDK metadata without importing SDK code, running discovery, probing services, downloading dependencies or changing files. Exit 1 means prerequisites are blocked; exit 0 means a shadow attempt can begin, not that tests passed or omissions are qualified. Each check gives a concrete next action. Existing selective policies are preserved and flagged for review. `setup` returns this diagnostic, and the default agent brief includes the same facts.

## Registry adoption gate

Do not substitute `testlore@0.2.0-alpha.1` into these commands until its sealed archive, registry bytes and fresh installed setup are independently verified. A version change in Git does not publish it. The `alpha` tag moves and is not an immutable pin. The historical `0.1.0` receipts and commands continue to describe only that release.

The alpha release workflow already uses the protected `npm-alpha` GitHub environment and token-free trusted OIDC publication. The environment is present; the npm trusted-publisher mapping remains unverified. The latest local readiness inspection found no usable interactive npm identity. These are publication gates, not reasons to weaken account protection or put credentials in reports. [Exact candidate procedure and blockers](releases/0.2.0-alpha.1.md).
