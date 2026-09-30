# Experimental alpha adoption

TestLore is available from the merged public GitHub main branch. It is experimental: native Node/Jest/Vitest validation is the best qualified improvement path; Nx, Bazel and pytest-testmon retain their own native execution scope. Pin a reviewed commit when evaluating a reproducible setup.

```sh
npm exec --yes --package=github:rudycelekli/testlore -- testlore init
npm install --save-dev github:rudycelekli/testlore
npx --no-install testlore audit --json
npx --no-install testlore plugins --recommend --json
```

`npm exec` installs temporarily for that invocation. The local development install makes later `npx --no-install` commands available. Requirements, generation workers and optional tools are configured separately. Local audit/routing need no AI account.

Start with a clean committed checkout and a representative test suite. Keep full CI execution while evaluating shadow plans:

```sh
npx --no-install testlore run --shadow --base YOUR_REVIEWED_BASE_COMMIT --json
```

Shadow mode executes the full suite and compares the proposed file selection against actual failures. It can cost more than your existing full run because discovery, planning and evidence collection are included. Study representative copy/assets, source, shared dependencies, configuration, deleted files and dynamic dependencies. Record unknown-input fallbacks and misses rather than selectively reporting favorable changes. Existing benchmark charts show both a tiny-suite slowdown and a constructed costly-workload improvement; neither predicts your repository's savings.

To evaluate improved tests, commit independent behavior in `tddswarm.requirements.md`, configure an installed worker, then use `testlore improve --local` for the first proposal. Examine candidate review, collection preservation, full branch execution, and independent fault expectations before merging. A high static grade or upstream estimate does not prove assertion quality.

## Pilot participation

We are seeking independently maintained Node, Jest and Vitest repositories with real tests and reviewable change history, including projects where selection overhead may dominate. Python/Nx/Bazel pilots can assess native delegation separately. Participation is voluntary; no pilot is claimed merely because a public benchmark used a repository.

A useful pilot report records the reviewed TestLore revision, runner/dependency versions, setup effort, representative changes, observed omitted failures, callback-bearing files, planning and execution time, full-suite behavior, candidate acceptance/rejections, and actionable setup failures. Keep proprietary sources, receipts, tokens and test output local. Share only an explicitly reviewed aggregate or a reproducible sanitized public example. The existing local learning aggregate export contains fixed counts; it is not a license to publish raw evaluation receipts.

Open a [pilot issue](https://github.com/rudycelekli/testlore/issues/new) with the framework, approximate suite size and a public or sanitized reproduction when you are ready to participate. Maintainers should agree on scope, success criteria and allowed data before collecting evidence. No announcements or outbound messages are sent by the software or this document.

Adoption progress is evidence-driven: retain misses and overhead, establish a stable shadow baseline, review independent generated-test behavior, and only then change CI policy deliberately. A pilot can conclude that the existing native full suite is faster or simpler. That is a useful result.

## One-command local setup

```sh
npm exec --yes --package=github:rudycelekli/testlore -- testlore setup
```

This creates a named project quality-agent profile, native runner configuration with local analysis caching and shadow execution, and a shadow/full GitHub workflow. It preserves existing configuration/workflows and makes no agent calls or optional SDK downloads. Inspect and commit those files before running `improve`. A local TestLore dev dependency is required for the optional `testlore/playwright` fixture; temporary npm execution cannot supply a persistent project import.

The registry shorthand `npm exec --yes --package=testlore -- testlore setup` becomes valid only after a verified npm publication. Until then use the GitHub package and pin a reviewed commit for repeatability. The exact-artifact publisher workflow exists; npm ownership/bootstrap and trusted-publisher access remain maintainer operations.
