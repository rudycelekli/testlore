TestLore's public regression campaign separates **selected candidates**, **independently demonstrated defects**, and **qualified three-arm trials**. The [frozen October 6 selection](../benchmarks/public-corpus/preregistration-20261006.json) contains 100 distinct upstream fix commits across 10 projects. The earlier [October 7 campaign](qualification-20261007.md) executed three candidates: **two qualified changes in one project**, one completed unqualified attempt, 97 unattempted. Candidate counts do not satisfy the proposed 100-qualified-change benchmark.

The inventory contains ufo, pathe, destr, ofetch, h3, defu, unctx, mlly, Vite and Playwright. It represents a narrow JavaScript/TypeScript ecosystem, dominated by related UnJS projects. The selected upstream histories include service inputs, browser behavior and workspace boundaries, but those categories are not experimentally qualified by their inclusion.

Every candidate pins the exact fix, parent and tree SHA, GitHub commit URL, changed-file Git blob identities and available patch SHA-256. Bounded enrichment verifies Git SHA-1 blob bytes before recording SHA-256 for source, unchanged fixed maintainer oracles, root dependency metadata and lock/runtime declarations. The current selection has 524 byte bindings. This establishes public upstream byte association; commit titles and signatures do not demonstrate a bug, maintainer authorship independence, or a complete runtime attestation. Metadata outside the bounded inventory remains explicitly incomplete.

Fifty-two candidates have no recorded structural blocker. All still require a reviewed native profile and independently passing fixed baseline. Blockers overlap: 24 candidates lack a changed maintainer oracle, 20 need browser/monorepo build profiles, 11 change multiple source files, seven exceed the existing inverse-patch byte bound, three involve additions/deletions/renames, and one has incomplete metadata enrichment. Type-only fixes may have no runtime failure and must not fill the runtime-defect target. The failed first search for the renamed h3 repository is retained in accounting.

Three reviewed profiles are ready for sequential qualification:

| Profile | Exact upstream fix | Independent oracle preflight | Three-arm campaign |
| --- | --- | --- | --- |
| ufo prefix | [eb299454](https://github.com/unjs/ufo/commit/eb29945470c8629309764f026a36e7f477a9a1ff) | Earlier retained full executions demonstrated four unchanged maintainer assertion failures | Qualified twice; no speed lead over native |
| ufo leading slashes | [5cd9e676](https://github.com/unjs/ufo/commit/5cd9e676711af3f4e4b5398ddf6ca8d52c1c7e1f) | Fixed baseline passed; exact prior source failed the same four assertions twice | Qualified twice; no speed lead over native |
| pathe UNC prefix | [b52fcacc](https://github.com/unjs/pathe/commit/b52fcacc59717a1e4a8783d4bbfae7fa81b4db07) | Fixed baseline passed; exact prior source failed the same ten assertions twice | Failures preserved twice; unqualified due to skipped upstream cases |

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

The later [October 7 expansion](../benchmarks/public-corpus/expansion-20261007.json) reaches **five unique qualified changes across three projects**, with 95 candidates still unattempted in a three-arm campaign. Across eight retained attempt executions, five qualify and three remain rejected. Two new genuine defu bugs preserved their unchanged upstream failures under reviewed legacy profiles; a new pathe attempt preserved ten runnable defect assertions under a prospective exact baseline-skip policy. The earlier pathe rejection and two new unified defu rejections remain unchanged. This still falls far short of 100/10, and every new TestLore arm remained slower than native selection.

Defu's upstream lock pins Vitest 4.1.2 and Vite 8.0.3. The one-context prototype conservatively rejected a resolved plugin on that runtime, returning no planning decision. Fresh profiles explicitly froze legacy execution after those retained rejections. The [runtime package](../benchmarks/public-corpus/runtime-projections/defu-node22.package.json) and [npm lock](../benchmarks/public-corpus/runtime-projections/defu-node22.npm-lock.json) freeze a reproducible runtime projection: selected top-level versions match the upstream lock, while the full development dependency graph is omitted. Install the two files as `package.json` and `package-lock.json` in a disposable runtime directory with `npm ci --ignore-scripts --no-audit --no-fund`, then link its `node_modules` into the clean pinned checkout. This **is not a full upstream-lock installation**. Installed package metadata, local native entrypoint, Node and projection-lock hashes are bound; entire installed package contents are not independently runtime-attested. Lint, type checks, coverage and build scripts are outside these profiles.

For independent preflight, provide a reviewed profile with a bounded scope, clean exact checkout, native discovery and project-local runner:

```sh
node scripts/public-corpus-preflight.js \
  --selection benchmarks/public-corpus/preregistration-20261006.json \
  --candidate unjs-defu-3942bfbbcaa7 \
  --profile .tddswarm/reviewed-defu-profile.json \
  --output .tddswarm/NEW-defu-preflight
```

Preflight uses a disposable clone, runs the unchanged fixed baseline, restores exact prior source bytes and independently executes the full fault twice. It retains all reports and requires each defect oracle to have passed in the baseline. Copy the resulting failure names into a separately reviewed profile before preparation. For an optional skip policy, freeze `baselineDeclaredSkips` as exact `{id,file,name}` triples before the campaign; the corpus independently checks them against its fixed-baseline report. Extra skips, skipped defect oracles, changed skip identities, missing baselines and module-load outcomes remain disqualifying. `pathe-unc-declared-skips.template.json` is a new profile; the older strict profile is unchanged.

Use the sequential batch controller after preparing each reviewed candidate. Its private JSON plan binds each absolute prepared-input path and SHA-256, the frozen selection commitment, `maxCandidateMs` (up to 30 minutes), `maxCampaignMs` (up to two hours), and `minFreeBytes` (at least 1 GiB). Each entry contains one `candidateId` and either the bound prepared input or an explicit reviewed `blockedReason`. The plan may cover fewer than 100 candidates; omitted entries remain unattempted.

```sh
node scripts/public-corpus-batch.js \
  --selection benchmarks/public-corpus/preregistration-20261006.json \
  --plan .tddswarm/reviewed-batch.json \
  --output .tddswarm/public-batches/NEW_CAMPAIGN
```

Repeating that exact command resumes the same immutable plan and source implementation. Exclusive starts and terminal receipts preserve completed, rejected, interrupted and blocked attempts. An interrupted start becomes a terminal partial attempt, never an automatic retry. To change a prerequisite or execution policy, create a new named campaign and retain the old receipts. The controller stops at deadline, output-byte or disk-reserve limits; a resource stop leaves subsequent candidates unattempted. Controller deadlines are bounded and observed descendant groups are terminated on timeout, with best-effort cleanup explicitly recorded. This is not containment of arbitrary upstream subprocesses. The controller performs no installations, downloads, model calls or account changes.

A further [bounded preflight pass](../benchmarks/public-corpus/additional-preflight-20261007.json) inspected ten additional distinct ufo, pathe and defu histories without new dependency installation. Five independently demonstrated stable unchanged maintainer failures and are ready for prospective comparative profiles. Three pathe fixed baselines failed module loading on the frozen comparative runtime; one ufo inverse and one defu inverse passed without an observed regression. Those five remain rejected under that scope. An initial overlong scope declaration rejected all ten controller inputs before native execution; its receipts remain separate from the corrected, prospectively frozen native pass. None of these preflight counts adds a qualified three-arm change. The updated preflight controller now prospectively binds all imported core source modules and controller Node, as well as source/dependency/runtime inputs; earlier receipts are not retroactively promoted to that identity scope.
