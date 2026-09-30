# Improve on a branch, keep the quality layer after merge

The improvement workflow creates a new Git branch and an isolated worktree, generates or accepts a reviewed candidate, validates original and proposed full suites independently, applies only an accepted exact patch, and runs the resulting branch's native full suite again before committing. The user's current checkout stays on its original branch. Merging remains an explicit review decision.

The default CLI entry point is `tddswarm improve`. It can use a configured worker or an installed Codex worker selected by the CLI. Add and commit `tddswarm.requirements.md` with independent behavior expectations before generation. Missing requirements, unavailable workers, rejected review, or failed testing do not produce a successful improvement claim. A clean checkout and an existing Git commit are required; staged, unstaged, and relevant untracked changes are refused before creating the improvement branch. Commit or stash those changes deliberately first.

The CLI can automatically open a GitHub pull request for review after the tested commit when GitHub authentication and a remote are available. `--local` keeps the result local. The library function itself neither pushes nor creates or merges a pull request.

## Library flow

```js
import { improve, installQualityLayer, installQualityWorkflow } from 'tddswarm';

const result = await improve(projectRoot, {
  id: previouslyValidatedCandidateId,
  prepare: root => installQualityLayer(root, {ci:false}),
  prepareRepository: (repository, {project}) => installQualityWorkflow(repository, {project})
});
console.log(result.status, result.branch, result.worktree, result.sha);
```

`improve(root, options)` accepts one of:

- `id`: an existing candidate with accepted validation for its exact manifest. The manifest and bound file contents are copied into the new branch and validated again there.
- `patch`: a complete reviewable patch object accepted by `stagePatch`; staging occurs only in the branch.
- Neither: generation runs in the new branch using `config.agent`, or an explicit runtime argv array in `options.agent`. Independent requirements and the architect/author/reviewer protocol are still required.

Generation is followed by `validateCandidates`, which checks the original full suite, proposed full suite, executable candidate collection, retained original passing cases, review/oracle evidence, provenance, and any provided held-out defects. An accepted validation is consumed by `applyPatch` for that exact manifest. No files are applied in the original checkout. See [candidate validation](candidates.md) for the patch and review formats.

`options.prepare(branchProjectRoot)` is a trusted callback invoked after accepted patch application and before the final full run. It must return an array of changed project-relative paths. The CLI uses it to install ongoing quality configuration and CI workflow files; those paths are committed together with the validated patch. It cannot alter the exact reviewed candidate file contents or restore a reviewed deletion. A preparation step that changes runtime behavior must still pass the complete final suite and preserve the candidate's passing case names and multiplicities.

`options.prepareRepository(repositoryRoot, {project})` is a trusted callback for repository-level workflow files. It returns canonical repository-relative paths, which are included in the exact staged tree. Nested projects use repository-root workflows with their project path passed to the action; dependency setup uses the applicable workspace lockfile. Existing workflow contents are preserved, and distinct nested projects receive distinct workflow filenames.

An optional `options.initialize(branchProjectRoot)` callback runs before generation when neither `id` nor `patch` is supplied. It must likewise return changed paths, which are included in a successful commit. It does not run ahead of a prevalidated candidate's provenance checks. The usual CLI path can pass its detected worker through `options.agent` without writing machine-specific executable paths into project configuration.

Before committing, the workflow rejects test-created source drift, original-checkout drift, branch movement in the original checkout, and unexpected file changes outside the declared patch/preparation paths. Only those declared paths are staged. Repository-wide inputs are checked around the full run, and the final commit tree must exactly equal the staged tree from before hooks. If commit hooks change tested inputs or produce a different committed tree, the result requires review rather than being marked ready. Dependencies and project executables remain trusted: installed `node_modules` can be shared through a symlink, and this is file-state isolation, not a security sandbox.

Generated branch names use `tddswarm/improve-<uuid>`. A library caller can supply `branch` only in the validated `tddswarm/improve-...` namespace. Arbitrary worktree destinations are not accepted. Worktrees are registered with Git under a generated temporary-system path and retained for review. The branch ref preserves committed results; save any uncommitted failure artifacts before cleaning a worktree or allowing system temporary-directory cleanup.

## Receipts and outcomes

Results include `branch`, `baseBranch`, original `sourceHead`/`base`, project `worktree`, repository `worktreeRoot`, `sha`, `status`, and `merged: false`. For a project below a monorepo root, `worktree` points to the project subdirectory while `worktreeRoot` points to the repository checkout. A receipt is written to `<worktree>/.tddswarm/improvement/result.json`, with candidate locations, validation evidence, final full-run results, and errors when available.

| Status | Meaning |
| --- | --- |
| `ready-for-review` | Exact reviewed candidates and preparation paths passed validation and the final full run; the new branch has a commit |
| `validation-rejected` | Original/candidate equivalence, independent review, collection, provenance, or supplied defect checks failed; no improvement commit |
| `full-run-failed` | The applied/prepared branch failed its final native full run or lost previously passing cases; no improvement commit |
| `awaiting-requirements` | A branch and work order exist, but independent requirements are missing; no tests were generated or committed |
| `awaiting-agent` | A branch and work order exist, but no worker was configured or supplied; no tests were generated or committed |
| `no-changes` | Validation passed but no declared Git changes remained to commit |
| `failed` | A prerequisite, application, drift, Git operation, or callback failed; inspect `error` and retained artifacts |
| `commit-requires-review` | A commit hook changed the tested inputs or committed tree; the commit cannot be treated as the verified result |

Rejected candidates and failed applied branches remain available for inspection. A generated commit is a review artifact, not an automatic merge or a guarantee that tests contain no undiscovered defects. Held-out defect checks are only measured when supplied and actually demonstrated.

## Staying the quality engineer after merge

The CLI's branch preparation installs or preserves `tddswarm.config.json`, ignores local `.tddswarm/` artifacts, and adds a repository-root `.github/workflows/tddswarm.yml` (or a project-specific filename for nested projects) when that workflow does not already exist. Existing configuration and existing workflow contents are preserved. Review dependency setup, declared browser/service inputs, and the action reference in the proposed diff. The installer pins the source commit recorded by the Git installation when available; otherwise it uses main. `--action-ref <reviewed-sha>` provides an explicit reproducible pin.

After merge, that workflow runs static/measured audit reporting plus affected execution on pull requests, and a full native run on default-branch pushes. It retains machine-readable evidence through the composite action. The configuration remains available for local affected-test execution and periodic full-run policy. This makes the quality layer part of the project rather than a one-time test rewrite.

Scheduled mutation testing, repeated stability measurements, browser instrumentation, and external-service version sources still need the project's corresponding tools and policies. Continuous CI execution does not automatically reauthor tests or merge future changes: new improvements can repeat the branch/review flow, while measurement and selection continue through the installed layer.

See [runner receipts](runners.md), [quality/runtime evidence](evidence.md), and [ecosystem integrations](integrations.md).
