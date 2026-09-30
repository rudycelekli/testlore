# Candidate validation and reviewed modularization

Candidate generation and modularization use the same staged patch format. Nothing is installed in the project during staging or validation. A patch includes complete changed test and fixture files, explicit deleted files, independent requirements, and a separate reviewer response:

```json
{
  "files": [{"path":"test/example.test.js","content":"complete file contents"}],
  "delete": ["test/old.test.js"],
  "requirements": "Public behavior, boundary conditions, and integration contracts.",
  "review": {
    "accepted": true,
    "findings": ["Original integration assertions and case names are retained."],
    "oracle": {
      "independent": true,
      "basis": ["Independently specified requirements or domain invariants."]
    }
  }
}
```

`stagePatch(root, patch)` writes `.tddswarm/candidates/<id>/manifest.json`, content hashes, original project and runner provenance, and the changed files under `files/`. `review.json` and copies at their project-relative paths support inspection; only the manifest and hashed `files/` content authorize validation. Rejected proposals can be staged for review. Accepted review alone does not authorize application.

`validateCandidates(root, id)` runs native full-suite discovery and execution separately in disposable copies of the original and proposed project. It requires complete supported runner reports, green original and proposed suites, at least one executed case in every changed test file, and all original case names with their original multiplicities and passing counts. This includes unchanged integration tests. A project with no original tests can bootstrap a nonempty executable suite. Skipped tests and empty files cannot prove candidate execution. Generic custom runners cannot certify candidate validation until an execution-report adapter is implemented; an arbitrary exit code of zero is insufficient.

Case names must remain stable when moving tests. This operational check does **not** prove semantic equivalence of rewritten assertions. Independent oracle review and demonstrated held-out regressions provide additional evidence. Review metadata records the reviewer's attestation; it cannot guarantee that a human or model actually reviewed independently. The same model in separate roles is not guaranteed independent reasoning or vendor diversity.

Validation reports preserve both full-suite outcomes, individual cases, commands, stdout/stderr, omitted cases, and held-out outcomes in `validation.json`. Source, runner, environment, manifest, or staged-content drift invalidates the result. Older generated candidates without original provenance fail explicitly; regenerate or restage them. Generation should capture `snapshot(root, config)` **before** invoking workers and supply it as `patch.provenance`; staging rejects worker-induced source drift.

`applyPatch(root, id)` reports readiness without changes. `applyPatch(root, id, {execute:true})` requires the previously accepted validation of the exact manifest and a still-fresh source snapshot. It applies file replacements atomically per file, retaining original bytes and permissions for rollback if any operation fails. Deletions and fixture additions are explicit. Package manifests, lockfiles, and `tddswarm.config.json` require the exact path in `allowProtectedPaths`. `.git`, `.tddswarm`, and `node_modules` are always forbidden patch destinations. Path traversal and symlink traversal are rejected. Application is a local operation, not a deployment.

## Independent held-out defects

Add `heldOutDefects: [{name,path,content}]` to a patch, where `content` is the complete replacement for an existing, unchanged production source file. Tests, configuration, candidate paths, and absent files are forbidden defect targets. Each defect is evaluated independently in fresh original and candidate copies. The original full suite must demonstrate an actual failing case, and the candidate full suite must catch the same defect. Module-load failures, an undemonstrated change, incomplete reports, and missed defects fail acceptance. Defect assertions and requirements should be specified independently, then withheld from test authors and reviewers until their proposals are frozen.

To attach an external corpus after generation and review:

```sh
node scripts/generated-defects.js --project /path/to/project --candidate ID --corpus /path/to/held-out.json --output held-out-report.json
```

The corpus is a JSON array in the format above. This stages a new candidate bound to the original provenance; it does not alter the original proposal or apply any patch. Its report names the corpus digest, demonstrated defects, caught defects, misses, and raw outcomes. Recall is `null` when no defects are demonstrated. An incomplete experiment is never a 100% result.

Run the offline reproducible controls with:

```sh
node scripts/generated-defects.js --output generated-defects-report.json
```

The positive control preserves independent requirement tests; the negative control retains their names but replaces assertions with vacuous passes. Four synthetic regressions exercise zero, negative, upper boundary, and invalid-input behavior. These controls test validator behavior. They do **not** measure an AI model, invoke Agentic QE, or establish production test quality. Real model comparisons need frozen candidate artifacts, an independently maintained hidden corpus, model/version settings, and published failures as well as successes.

## Isolation limits

Disposable copies isolate project-file state; they are **not a security sandbox**. Test modules, native discovery, runner commands, preload hooks, and dependencies execute trusted arbitrary code with the caller's privileges. Existing `node_modules` is symlinked into the copy so installed dependencies work; that dependency directory remains shared and writable to the process. Repository symlinks are not copied. Untracked ignored files and excluded build outputs are not supplied, so projects requiring them must first make their validation inputs reproducible. Network, credentials, and filesystem access outside the copy are not restricted. Run untrusted candidate code in a restricted container or VM supplied by the caller. TestLore does not assert container isolation it has not verified.

Validation receipts include an integrity digest. Altering recorded outcomes invalidates application and copying a prevalidated candidate into an improvement branch; this is accidental-tamper detection, not authentication of an adversarial producer.
