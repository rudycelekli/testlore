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

The script copies only regular tracked inputs to a disposable directory and adds the exact source SHA as `package.json.gitHead`; this metadata-only recipe is recorded and leaves the checkout unchanged. The installed setup then pins GitHub Actions to that SHA rather than a moving default branch. It creates one archive with lifecycle scripts disabled, hashes it, installs that exact input archive production-only with scripts disabled, and runs the packed CLI proof. The proof exercises plugin inspection/automatic setup, missing optional SDK fallback, native shadow defect detection, runtime capture, and a fully validated improvement branch. It rechecks archive integrity after execution. The receipt binds source revision, archive SHA-256/npm integrity, package version and proof hash. Ordinary source checks and tests must also succeed at this revision; seal alone does not replace them. Archive qualification may download declared production dependencies through npm.

`--archive /path/testlore-VERSION.tgz --expected-sha256 HEX` on `scripts/packed-proof.js` qualifies an existing archive without repacking. Publishing must use this exact tested archive; rebuilding after qualification invalidates that correspondence.

## Protected trusted-publisher workflow

[alpha-release.yml](../.github/workflows/alpha-release.yml) accepts a full reviewed main-branch SHA and defaults `publish` to false. A qualification job requires the exact current main revision, runs source checks/tests/demo, seals the archive and uploads its immutable artifact with receipts. This is useful without npm credentials. The optional publish job receives only that artifact, verifies hashes, version and the OIDC-enabled job context again, and publishes the archive with the `alpha` dist-tag. The current candidate stays at version `0.1.0`; the explicit `alpha` dist-tag marks its release channel and does not update npm's `latest` tag. A later reviewed prerelease version such as `X.Y.Z-alpha.N` also works. Version changes require a corresponding reviewed lockfile update.

The GitHub environment **npm-alpha** is configured with required maintainer review and a `main` deployment branch policy (verified through the repository API on 2026-09-30). Maintain these protections before enabling publishing. GitHub environment protections are repository settings and are not created by adding YAML. Configure the matching npm trusted publisher for owner `rudycelekli`, repository `testlore`, workflow `alpha-release.yml`, and environment `npm-alpha`. Package ownership/name availability and first-publication bootstrapping still require actual maintainer npm access: the October 8 npm identity check confirms the user-selected account `rudycelekli`, but account-level 2FA is disabled and the public registry package is still unobserved. No npm package or registry installation has been claimed or performed. npm documents trusted OIDC requirements and publisher mapping in [trusted publishing](https://docs.npmjs.com/trusted-publishers/).

The publish job alone receives `id-token: write`; qualification has read-only repository permissions. It does not install project dependencies or execute package lifecycle scripts. It uses Node 24 and checks npm >=11.5.1 for the documented OIDC support. It intentionally supplies no long-lived npm token and does not create an authentication `.npmrc` via setup-node. Trusted publishing supplies provenance; the workflow additionally requests it explicitly. See [npm provenance](https://docs.npmjs.com/generating-provenance-statements/).

Run the workflow with publishing disabled first and retain the exact hosted run URL/SHA, artifact digest, and packed proof. Then review package contents/license/dependency state and publisher mapping before approving a publish-enabled run. After publication, verify the registry version, dist-tag, integrity and provenance against the qualified receipt, and test installation from the registry in a fresh project. Only that later evidence supports a published-release claim. GitHub release notes, announcements and pilot outreach remain separate deliberate actions.

Every PR also runs `packed-install` against its exact checkout, without installing development dependencies into the proof project. The installed proof runs ordinary `testlore run` to verify the persisted shadow default and ordinary `improve` to verify the generated Action uses the sealed source SHA; command-line overrides cannot supply these assurances. Verification requires strict boolean attestations, both Action identities and the installed manifest hash.

The proof also connects the official MCP SDK client to the installed package's stdio server, checks the default read-only tool set and runner-free brief, then explicitly enables execution and verifies that default shadow mode catches a planted fault while retaining both test files. The client SDK is a development dependency of the proof harness, not of the fresh production-only project. These measured checks cover the named fixture; they do not establish universal agent-host compatibility.

Release qualification independently reruns the measured-quality, native-selector and browser proof scripts. Its full source suite uses `scripts/test-qualification.js` with Chromium enabled. This gate retains native TAP and a source-bound receipt, enumerates all current test files and requires the two browser proof cases. Skipped/todo/cancelled/failed cases, empty file-load placeholders, inconsistent or truncated summaries, wrong scope, output/deadline overruns and source drift reject qualification. A normal test command exiting zero is insufficient. To run locally on a clean committed checkout with the SDK and browser installed:

```sh
TESTLORE_PLAYWRIGHT_BROWSER=1 node scripts/test-qualification.js --output .tddswarm/new-source-qualification.json
```

`TESTLORE_BROWSER_CHANNEL=chrome` may select an already installed Chrome for local qualification; the channel is recorded. Hosted release qualification installs bundled Chromium and never publishes when these gates fail.

The publish job additionally runs `scripts/registry-proof.js`: it revalidates source lineage and the sealed local artifact, downloads registry bytes with bounded size/time, and compares SHA-256 plus npm SHA-512 integrity to the qualified archive. Its receipt and qualification records are uploaded together. A mismatch fails the workflow; there is no repack or alternate download fallback.

## Read-only npm readiness

The diagnostic distinguishes GitHub repository ownership from unknown npm account ownership. Configuring publishers through `npm trust` requires npm >=11.15.0, authenticated package write access, account 2FA and an existing registry package; publishing through an already configured OIDC mapping has a separate >=11.5.1 CLI requirement. The website offers the other publisher-configuration path. No successful diagnostic substitutes for a real exact-archive publish and registry verification. [Official CLI prerequisites](https://docs.npmjs.com/cli/v11/commands/npm-trust/).

Run `node scripts/npm-readiness.js` to inspect CLI OIDC support, interactive identity, public package presence, protected GitHub environment and exact main revision. It does not authenticate, grant access, or publish, and it never certifies the npm account mapping from CLI identity. The publish job checks that main still equals the qualified source immediately before publishing.

As of the npm documentation checked on 2026-10-08, newly configured trusted publishers default to staged publishing permission. This workflow uses direct `npm publish`; explicitly enable that allowed action in the exact mapping. Keep the existing `npm-alpha` review protection. Interactive login, first-package bootstrapping and the npm account mapping remain required maintainer operations. See [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/).

## Authenticated first-publication sequence

Interactive login establishes an account identity, not package ownership or an OIDC mapping. Enable account-level 2FA before bootstrapping the package; npm requires 2FA for interactive package creation and publication. Complete any browser or security-key challenge locally, with credentials and recovery codes kept out of reports. [Official npm requirements](https://docs.npmjs.com/requiring-2fa-for-package-publishing-and-settings-modification/).

Use the exact archive from a successful publish-disabled workflow at current `main` for the first `0.1.0` publication, with scripts disabled and the `alpha` tag. Then verify registry bytes against that receipt and exercise production installation and shadow setup in a fresh project. Configure the exact trusted publisher only after the registry package exists. With npm >=11.15.0 and authenticated write access, the mapping command is:

```sh
npm trust github testlore --file alpha-release.yml \
  --repository rudycelekli/testlore --environment npm-alpha \
  --allow-publish --yes
npm trust list testlore --json
```

Retain the protected environment review. The next immutable version requires its own reviewed source/lockfile update and complete qualification before proving an actual OIDC publication. Never republish an existing version. Once the alpha registry release is verified, the channel-specific setup command is `npm exec --yes --package=testlore@alpha -- testlore setup`; inspect the actual dist-tags rather than assuming a `latest` release.
