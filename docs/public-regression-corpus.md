TestLore's public regression campaign separates **selected candidates**, **independently demonstrated defects**, and **qualified three-arm trials**. The [frozen October 6 selection](../benchmarks/public-corpus/preregistration-20261006.json) contains 100 distinct upstream fix commits across 10 projects. **Zero changes in this new campaign are qualified yet.** Candidate counts do not satisfy the proposed 100-qualified-change benchmark.

The inventory contains ufo, pathe, destr, ofetch, h3, defu, unctx, mlly, Vite and Playwright. It represents a narrow JavaScript/TypeScript ecosystem, dominated by related UnJS projects. The selected upstream histories include service inputs, browser behavior and workspace boundaries, but those categories are not experimentally qualified by their inclusion.

Every candidate pins the exact fix, parent and tree SHA, GitHub commit URL, changed-file Git blob identities and available patch SHA-256. Bounded enrichment verifies Git SHA-1 blob bytes before recording SHA-256 for source, unchanged fixed maintainer oracles, root dependency metadata and lock/runtime declarations. The current selection has 524 byte bindings. This establishes public upstream byte association; commit titles and signatures do not demonstrate a bug, maintainer authorship independence, or a complete runtime attestation. Metadata outside the bounded inventory remains explicitly incomplete.

Fifty-two candidates have no recorded structural blocker. All still require a reviewed native profile and independently passing fixed baseline. Blockers overlap: 24 candidates lack a changed maintainer oracle, 20 need browser/monorepo build profiles, 11 change multiple source files, seven exceed the existing inverse-patch byte bound, three involve additions/deletions/renames, and one has incomplete metadata enrichment. Type-only fixes may have no runtime failure and must not fill the runtime-defect target. The failed first search for the renamed h3 repository is retained in accounting.

Three reviewed profiles are ready for sequential qualification:

| Profile | Exact upstream fix | Independent oracle preflight | Three-arm campaign |
| --- | --- | --- | --- |
| ufo prefix | [eb299454](https://github.com/unjs/ufo/commit/eb29945470c8629309764f026a36e7f477a9a1ff) | Earlier retained full executions demonstrated four unchanged maintainer assertion failures | Unmeasured in this frozen campaign |
| ufo leading slashes | [5cd9e676](https://github.com/unjs/ufo/commit/5cd9e676711af3f4e4b5398ddf6ca8d52c1c7e1f) | Fixed baseline passed; exact prior source failed the same four assertions twice | Unmeasured |
| pathe UNC prefix | [b52fcacc](https://github.com/unjs/pathe/commit/b52fcacc59717a1e4a8783d4bbfae7fa81b4db07) | Fixed baseline passed; exact prior source failed the same ten assertions twice | Unmeasured |

A destr candidate was also attempted. Its unchanged fixed maintainer baseline failed on the available Node/Vitest runtime, so no inverse or selection trial was admitted. Its receipt stays in the [preflight accounting](../benchmarks/public-corpus/preflight-20261006.json). Assertions were not modified. These preflights are not new speed, routing, browser, or learning results. Windows path assertions executed on the local host do not establish qualification on Windows.

The profiles explicitly use local upstream source imports and a comparative installed Vitest. Its package metadata and CLI are hashed, and the upstream declared framework and lockfile bytes are separately recorded. **An available shared SDK is not an upstream-lock installation.** Missing project dependencies, package builds and browser/server fixtures must be resolved in bounded disposable checkouts. Never substitute an installed copy of the tested library for its upstream checkout. Vite and Playwright have real browser/monorepo histories in the inventory; no giant build/install was attempted within the current disk budget, and their native profiles remain open work.

Use an existing clean checkout pinned to the exact fix and containing its parent; source imports must refer to that checkout. Install the project's reviewed runtime dependencies separately. The controller performs no downloads, installation, model calls or maintainer communication. Preparation binds dependency/Node/native framework bytes and preserves original checkouts.

```sh
node scripts/public-corpus.js prepare \
  --selection benchmarks/public-corpus/preregistration-20261006.json \
  --candidate unjs-ufo-eb29945470c8 \
  --profile benchmarks/public-corpus/profiles/ufo-prefix.template.json \
  --root /absolute/clean/pinned/ufo \
  --output .tddswarm/public-ufo-prepared.json

node scripts/public-corpus.js run \
  --selection benchmarks/public-corpus/preregistration-20261006.json \
  --prepared .tddswarm/public-ufo-prepared.json \
  --output .tddswarm/pilots/public-ufo-NEW
```

The other candidate/profile pairs are `unjs-ufo-5cd9e676711a` / `ufo-leading-slashes.template.json` and `unjs-pathe-b52fcacc5971` / `pathe-unc.template.json`. Every output must have a new name; old failures, partial attempts and completed receipts are retained. Templates freeze `executionMode: unified-native` before performance trials. The corpus refuses that mode unless the installed pilot explicitly supports it, and passes the mode only to TestLore's arm; full/native executions remain unchanged. The prepared commitment, dependency hashes, Node/native CLI identity and wrapper/core hashes must remain stable.

The existing `runCorpus`/pilot machinery rotates full/native/TestLore arm order, independently executes full and selected suites, checks named case preservation, and records fallback frequency, misses, unexpected failures and repeated outcome stability. Time includes native execution or TestLore planning, execution and receipt retention; orchestration is separately timed. Each candidate requests two repeats under a 30-second native deadline and one bounded isolated project worker. A repeated trial is never a new change or project.

Cache evidence is specific: the first analytical plan begins in a new workspace; the profiles enable the guarded pure analysis cache for the repeat. Native processes are fresh, but baseline/discovery and shared OS, dependency and native framework disk caches are uncontrolled. Public attempt receipts include per-repeat complete arm spans and analysis-cache counters. These are **analysis-cache cold/repeat observations**, not fully cold machine measurements or a general speed claim. A missing native process, partial report, unstable outcome or failed fixed baseline cannot qualify a change.

A larger campaign must add reviewed browser/monorepo profiles, exact project-lock installations, independent complete cold/warm controls and broader project diversity. It must preserve all rejected candidates and publish the denominator. The target is 100 genuinely demonstrated unique changes across at least 10 projects; the checked-in selection is a reproducible starting inventory, not completion of that target.

For a new dated selection, use `node scripts/public-corpus-curation.js --directory .tddswarm/NEW_PUBLIC_CURATION --cutoff YYYY-MM-DD`. The read-only curator uses the [official GitHub commit API](https://docs.github.com/en/rest/commits/commits), retains API byte hashes/failed-request accounting, caps request/time/blob/cache budgets and creates a fresh selection. Never refresh a frozen manifest in place after seeing results.
