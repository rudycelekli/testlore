# Alpha launch and release preparation

The merged GitHub project is available for experimental adoption. npm publication and a GitHub release are separate operational actions. Their completion must be verified independently; preparation receipts do not prove publisher access or registry availability.

## Draft public introduction

> TestLore is an open-source testing intelligence layer for developers and coding agents. It proposes tests from independent requirements, validates candidates on an isolated branch, explains affected-test plans, and retains validated local lessons for future authors. It composes with existing Node/Jest/Vitest runners and optional native ecosystem tools. The alpha includes raw benchmark outcomes and conservative fallbacks: tiny suites can slow down, and learned examples do not establish a general quality gain. We are looking for pilot maintainers who can help measure setup effort, missed regressions, assertion quality and total CI cost on real changes.

This is draft launch text, not an announcement already sent. A short demo can run `npm run demo`, show a copy edit and shared-dependency change, then show the unknown-input full fallback. Explain that the demo is constructed and that shadow mode runs the full suite. Link [adoption](adoption.md), [comparison](comparison.md), [learning evaluation](learning-evaluation.md), and the actual scoped raw results. Do not present a leaderboard, certification, universal recall, or community uptake that has not been measured.

## Qualify an immutable npm archive

Commit the candidate first; the seal script rejects a dirty checkout. From that exact revision:

```sh
node scripts/release-candidate.js --output /absolute/new-release-candidate --revision FULL_COMMIT_SHA
node scripts/release-candidate.js --verify /absolute/new-release-candidate/release-candidate.json
```

The script creates one archive with lifecycle scripts disabled, hashes it, installs that exact input archive production-only with scripts disabled, and runs the packed CLI proof. The proof exercises plugin inspection/automatic setup, missing optional SDK fallback, native shadow defect detection, runtime capture, and a fully validated improvement branch. It rechecks archive integrity after execution. The receipt binds source revision, archive SHA-256/npm integrity, package version and proof hash. Ordinary source checks and tests must also succeed at this revision; seal alone does not replace them. Archive qualification may download declared production dependencies through npm.

`--archive /path/testlore-VERSION.tgz --expected-sha256 HEX` on `scripts/packed-proof.js` qualifies an existing archive without repacking. Publishing must use this exact tested archive; rebuilding after qualification invalidates that correspondence.

## Protected trusted-publisher workflow

[alpha-release.yml](../.github/workflows/alpha-release.yml) accepts a full reviewed main-branch SHA and defaults `publish` to false. A qualification job checks main ancestry, runs source checks/tests/demo, seals the archive and uploads its immutable artifact with receipts. This is useful without npm credentials. The optional publish job receives only that artifact, verifies hashes, version and the OIDC-enabled job context again, and publishes the archive with the `alpha` dist-tag. The current candidate stays at version `0.1.0`; the explicit `alpha` dist-tag marks its release channel and does not update npm's `latest` tag. A later reviewed prerelease version such as `X.Y.Z-alpha.N` also works. Version changes require a corresponding reviewed lockfile update.

Before enabling publishing, the maintainer must configure the GitHub environment **npm-alpha** with required reviewers and main-branch deployment restrictions. GitHub environment protections are repository settings and are not created by adding YAML. Configure the matching npm trusted publisher for owner `rudycelekli`, repository `testlore`, workflow `alpha-release.yml`, and environment `npm-alpha`. Package ownership/name availability and first-publication bootstrapping require actual maintainer npm access; this work does not claim either has been established. npm documents trusted OIDC requirements and publisher mapping in [trusted publishing](https://docs.npmjs.com/trusted-publishers/).

The publish job alone receives `id-token: write`; qualification has read-only repository permissions. It does not install project dependencies or execute package lifecycle scripts. It uses Node 24 and checks npm >=11.5.1 for the documented OIDC support. It intentionally supplies no long-lived npm token and does not create an authentication `.npmrc` via setup-node. Trusted publishing supplies provenance; the workflow additionally requests it explicitly. See [npm provenance](https://docs.npmjs.com/generating-provenance-statements/).

Run the workflow with publishing disabled first and retain the exact hosted run URL/SHA, artifact digest, and packed proof. Then review package contents/license/dependency state and publisher mapping before approving a publish-enabled run. After publication, verify the registry version, dist-tag, integrity and provenance against the qualified receipt, and test installation from the registry in a fresh project. Only that later evidence supports a published-release claim. GitHub release notes, announcements and pilot outreach remain separate deliberate actions.
