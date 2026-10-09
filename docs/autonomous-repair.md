# An installed quality agent that can propose fixes

TestLore's source workflow includes `autopilot` and `repair`. These commands are not in the older npm 0.1.0 release. Use a reviewed Git revision until the next npm release is published.

```sh
npm install --save-dev 'git+https://github.com/rudycelekli/testlore.git#main'
npx --no-install testlore autopilot --json
```

Run from a clean, committed project with independent `tddswarm.requirements.md`. A configured JSON worker or an installed, authenticated Codex CLI supplies agent proposals; authenticated `gh` supplies PR publication. The original checkout is preserved. `--local` keeps the tested branch without publication. Default configuration continues using shadow routing.

`autopilot` detects failures on an isolated branch. A failing supported Node suite enters source repair; a green suite enters the existing reviewed test-improvement flow. Other frameworks retain the existing test-improvement path. Missing requirements, incomplete native discovery, unsupported assertion evidence, uncertain case identities, rejected proposals and timeouts produce retained reasons and no successful publication.

For a focused source repair:

```sh
npx --no-install testlore repair --sources src/parser.js,src/validator.js --local --json
```

The source paths must already exist. The controller can discover production paths under `src`, `lib` and `app`; larger projects should commit a reviewed `repair.sourcePaths` list in `tddswarm.config.json`. At most 32 files enter context, three disjoint authors can propose changes, and total proposed source content is limited to 64 KiB. One repair round has a 15-minute maximum, each worker a two-minute maximum, and native validation a separate bounded portion of the remaining round. `--deadline-ms` controls the repair round; the existing green-suite improvement path has its own per-call/per-run limits.

```json
{
  "adapter": "node",
  "discovery": "native",
  "runner": ["node", "--test", "{files}"],
  "agent": ["node", "scripts/quality-worker.cjs"],
  "repair": {"sourcePaths": ["src/parser.js", "src/validator.js"]}
}
```

The worker protocol is JSON stdin/stdout. Dedicated `repair-architect`, `repair-author` and `repair-reviewer` roles have the architect/author/reviewer response shapes documented in [agents.md](agents.md). An architect assigns distinct existing source paths, authors return only their owned file, and a separate reviewer checks independent behavior requirements. These are delegated subprocess tasks. They do not gain authority to edit or execute commands through their responses. The supplied Codex adapter uses a read-only native session, supplied context only, and rejects observed tool attempts. Custom worker executables, project tests and dependencies remain trusted executable code; disposable copies and integrity checks are not an OS security sandbox.

Acceptance requires:

- Two complete baseline runs with the same named failures, plus independent Node reporter probes confirming actual assertion errors.
- Two fresh candidate full runs preserving the exact existing case inventory and skip states, with every previously passing case and demonstrated failure passing.
- Immutable tests, ignored oracle inputs, requirements, configuration, file modes and installed dependency bytes.
- A final full run on the proposed branch and the exact tested/staged/committed tree, including checks for Git-hook mutation and caller drift.
- A pushed remote SHA and GitHub PR metadata matching the tested commit, repository, head/base branches and open state.

Native repair checks use fresh temporary HOME, XDG, npm and Git profiles, and mask inherited or configured authentication variables. Each baseline, assertion probe, candidate repetition and final run receives fresh profiles. Agent-provider and PR-publication authentication stay outside those checks. This is standard environment isolation, not an OS sandbox: project code can still access arbitrary filesystem paths and the network. Environment-dependent suites may reject rather than establish comparable results.

Repair currently qualifies Node assertions only. Configured native discovery determines the suite scope. Full validation does not establish unasserted behavior or production safety. Skipped assertions cannot become new proof. Learning remains advisory. Rejected evidence and unknown token/dollar costs are reported rather than turned into success metrics. No automatic merge is performed.

## Ongoing opt-in operation

Ordinary installation and setup do not start background model calls. To add an ongoing workflow, commit an explicit worker argv, source scope and independent requirements, then run:

```sh
npx --no-install testlore setup --autofix --action-ref YOUR_REVIEWED_40_CHARACTER_COMMIT_SHA
```

This creates a workflow for trusted default-branch pushes or manual dispatch. It requires a **self-hosted runner labeled `testlore`**, with the configured worker authenticated, Node/Git/npm/`gh` available, and GitHub Actions permission to create PRs. TestLore itself is installed from the exact reviewed Git SHA. The workflow uses contents/PR write permissions, skips an open TestLore PR for the same original revision, keeps a 20-minute job bound and never runs privileged agent work on a fork PR trigger. Review and commit the generated workflow to activate it; no scheduler is registered merely by creating the file.

## What is proven

Deterministic-worker tests exercise actual subprocess delegation, repeated native Node failures and fixes, preservation guards, wrong repairs, oracle edits, timeouts, stale inputs and publication metadata. The sealed production-archive gate additionally exercises the installed CLI through the same flow. These checks are not a measurement of model repair quality or live GitHub publication. Native provider trials and actual hosted archive receipts must retain their own scope and outcomes.

## Recorded native Codex repair

The [October 9 record](../benchmarks/agent-source-repair/native-codex-20261009/README.md) contains one actual source repair using the configured native Codex adapter. The input was `is-number` at [upstream fault `204c885`](https://github.com/jonschlinkert/is-number/blob/204c885659b8ee1946534c61db91603b9a16d661/index.js), with independent requirements derived from [issue #3](https://github.com/jonschlinkert/is-number/issues/3), and eight explicitly adapted Node cases. The exact fix and fixed source were not supplied. Three completed architect/author/reviewer calls proposed a string-whitespace guard; the reviewer remained advisory.

Two full runs of the declared eight-case Node scope each retained the same two whitespace assertion failures. Two separate native assertion probes confirmed `ERR_ASSERTION`. Two candidate runs and the final branch run passed all eight unchanged cases. The resulting local commit `5fa5b5373ef2b466a1959435d8c343f45f7f5cc6` changed only `index.js`; the caller stayed clean on its original `main` commit. `--local` was used, so no PR was published. The two failures expose one whitespace bug, not two independently demonstrated defects.

The first scope attempt also discovered the original Mocha file and was rejected before agent work because discovery was incomplete. That loss is retained. The later profile deliberately kept the Mocha file as documentation and executed the adapted Node oracle only. It is not a complete upstream installation or original Mocha-suite qualification. The originally retained Mocha bytes came from the fault commit, despite the registration naming fixed commit `12749e3c`; both versions are now retained with an explicit provenance correction. The Node cases use original assertion semantics and issue inputs, with `-1` chosen as a representative negative number; they are not eight untouched original Mocha cases.

The adapter hash was recorded before invocation. The complete running TestLore source revision and Codex CLI model/version were not independently preregistered. Tokens and currency cost are unknown; the recorded worker component took about 30.4 seconds and native validation about 3.7 seconds, excluding other phases. This single adapted trial establishes neither broad repair reliability, superiority, improved learning, nor an untouched holdout result.

`node scripts/agent-repair-frozen-replay.js` checks the frozen member hashes, input bindings, named outcomes, protected-input observations and retained rejection. It runs no provider or upstream tests. Public runtime paths are replaced; original private receipts are preserved. The local HMAC was checked privately, and its key is excluded; transformed public receipts do not retain that local authentication proof.
