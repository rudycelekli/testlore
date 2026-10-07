# Regression corpus qualification

`scripts/regression-corpus.js` adds named-failure and repetition gates around the existing isolated pilot. It accepts operator-supplied real repository histories, exact public bugfix inversions, and explicitly labeled authored changes. These origins are counted separately. A self-project bugfix is useful regression evidence, but does not establish independent external application performance.

Each change supplies `expectedFailureNames`, immutable `oracleFiles` hashes, and origin/maintainer/independence metadata. Fault patches cannot modify test files. For historical faults, both immutable revisions must contain the same oracle bytes. Public inversions bind the complete fixed and buggy source payloads to hashes and pin the upstream fix and parent revision. The caller must separately verify the upstream commit/source association; a repository URL in a manifest is a declaration, not a verified fetch.

The full native arm must independently produce the declared named assertion failures. The subset must preserve the same failure identities, case scope and statuses. Module-load errors, missing evidence, changed case signatures across repetitions, incomplete requested trials, source drift and changed harness bytes cannot qualify. A passing-only corpus cannot establish failure preservation. Scope completeness comes from the existing pilot's independently collected native inventory.

Private evidence includes requests, source copies, per-arm named case results, plans and failures. Output directories are exclusive: failed attempts stay in their original directories. The public assessment contains bounded counts, hashes, provenance categories and p50/p95/total arm time, with no project aliases, paths or case names. The full controller time is reported separately. Discovery used to establish the independent full oracle is outside per-arm comparisons. Cache state is shared and not experimentally controlled; report this limitation.

Inputs and case evidence use bounded, no-follow, nonblocking file descriptors; non-regular files, excessive size and changes during reading reject before unbounded allocation. Oracle hashes stream through bounded readers. The controller records its Git revision, clean-state observation, all existing core module hashes, helper-module hashes and Node binary identity, and checks the implementation again at completion. Native framework dependencies and child runtimes remain outside this attestation. A controller failure after completed pilot work recovers the retained summary; if its completed count cannot be reconstructed, accounting is explicitly incomplete with null completed/uncompleted counts.

```sh
node scripts/regression-fixtures.js \
  --directory .tddswarm/regression-input-NEW \
  --manifest .tddswarm/regression-manifest-NEW.json
node scripts/regression-corpus.js \
  --manifest .tddswarm/regression-manifest-NEW.json \
  --output .tddswarm/pilots/regression-NEW --execute
```

The bundled constructor has twelve Vitest contract cases covering a shared package, a source calculation, runtime caption/style/service files, and optional-source availability. It commits explicitly constructed rename and deletion histories. These are not real user application histories or browser execution. It also derives an exact source inverse of public TestLore fix [`189f82c`](https://github.com/rudycelekli/testlore/commit/189f82c965d673b354483a1f2d8ac78c4405b6d4), which corrected child-relative `PATH` interpretation. A separately specified Node assertion executes a mocked native launcher; no provider or model is called.

For the next real-application campaign, keep the immutable user repository histories and add independently demonstrated failures whose assertion bytes stay fixed. Compare native selection only after reporting its failure preservation: a native selector that runs no tests can be cheap and still omit the demonstrated fault. Retain each negative timing result and every failed baseline. Stable case outcomes across two runs are a minimum gate, not an estimate of production flake probability or universal recall.

The [first development attempt](../benchmarks/regression/20261006-exploratory-aggregate.json) is retained as unqualified exploration: 14/16 trials completed and preserved their 14 demonstrated assertion failures; native related selection missed eight failure observations involving runtime files/deletion. TestLore took more total time than both comparison arms. The constructed rename baseline produced a module-load failure, leaving two trials uncompleted; its cause was not established. This was before final oracle-hash and harness-freshness gates, so it is not exact immutable qualification evidence. Subsequent focused test failures caused by local `ENOSPC`, and the successful focused rerun, remain counted. No provider calls occurred.
