# REA's source-bound skipped-case registration experiment

The Windows-only rows in `src/contracts/sessionPathInputs.test.ts` render an imported Zod schema through `%o`. Native titles can therefore differ between runs even when the literal path inputs are unchanged. A title-normalization rule would discard evidence. This experiment instead captures actual framework registrations with their plain inputs and original imported object references, retaining raw titles.

The producer is narrowly pinned to REA `3dcb732da33f6ceef597506b14a4536f1c9aff96`, the complete test source hash, and the complete `sessionLifecycleInputs.ts` and `sessionToolContracts.ts` source hashes. The dependency lock, Node, platform and architecture are bound into each registration. Changed source, different literal declarations or unsupported parameter types fail closed. The schema objects are opaque: their original import binding is verified by object reference at registration time. No `Function.toString`, schema JSON serialization, estimated structural signature or title ordinal substitutes for that reference.

## Explicit transformed profile

`prepareReaCaseRegistration(root, {upstreamRevision})` writes three new files in a disposable checkout. Original test and schema bytes remain unchanged on disk. A Vite `enforce: 'pre'` plugin transforms only the unique exact Windows declaration into a call to a registration helper. The helper registers each actual row through `it.each([row])` with the same `"accepts %o"` title and unchanged assertion callback, adding public `TestOptions.meta` evidence. The formatter has no index placeholder, so splitting this one three-row table does not rewrite its displayed titles or callback arguments. Other parameterized tests are untouched.

Configure the explicit overlay with the returned plugin and reporter and enable `test.includeTaskLocation: true`. Preserve other native project options and original reporters. Native collection and finish hooks must both return the same metadata-to-task linkage. Missing metadata, duplicate native task IDs, missing file/location, changed inputs, changed import references, unsupported objects or executed rather than skipped rows reject qualification. Framework versions that do not expose this metadata contract are unsupported until verified; source inspection and mocked tests are not native producer qualification.

`observeReaCaseRegistrations(stdout, manifest)` requires exactly one actual reporter receipt and independently rechecks it against the frozen expected manifest. `compareReaSkippedRegistrations(manifest, arms)` requires matching captured identities, project membership and reported locations across independent arms. It preserves every raw title, including different Zod renderings.

## Limits on authority

This evidence supports comparison of **these three actually skipped registrations** on a non-Windows platform. It does not establish cross-process schema structural equivalence, equivalent generated property inputs, browser coverage, a passing Windows assertion or a detected bug. Windows execution cannot use this skip-only comparison.

The overlay never authorizes an omission. All other named outcomes retain strict native comparison. Unknown dependencies and unsupported plugins retain conservative fallback. The producer is deliberately an explicit experimental profile rather than a claim of untouched original runner execution. A selective or faster run is not established until the complete independent campaign succeeds under its own criteria.

The local tests validate transformations and rejection rules using controlled registration objects. They do not claim that Vitest collected metadata successfully; an actual native run must supply that evidence separately. The archived maintainer test fixture retains its source license.

## Retained actual failures

The first hosted producer attempt under source `7532ad0` never reached REA task collection: its original installation exceeded 450 MiB growth. The [immutable installation rejection](../benchmarks/rea-case-registration/installation-blocked-20261009/README.md) retains the artifact and raw receipts. A separately reviewed 768 MiB cap applies prospectively to REA only, with the same deadline/reserve and original dependencies.

The first full-source native transport fixture also exposed an incorrectly escaped Windows input in its handwritten JavaScript source template. The source-bound producer metadata was already correct. The native fixture now uses the exact original frozen table source rather than a separately escaped copy; matching rules were not relaxed. A direct raw-literal-to-input-digest test now catches that error. Passing controlled evaluator tests still cannot substitute for native REA registration evidence.

## Actual reporter integration rejection and prospective repair

[Run 37949751822](https://github.com/rudycelekli/testlore/actions/runs/37949751822) installed the original REA dependencies and ran the original file (14 passed, three skipped), but emitted no metadata receipt. The installed Vitest 5.0.3 Reporter interface does not include the legacy `onCollected`/`onFinished` hooks used by the first producer. The [raw failed observation](../benchmarks/rea-case-registration/reporter-blocked-20261009/README.md) remains immutable.

The prospective reporter now uses [public reported-task hooks](https://vitest.dev/guide/advanced/reporters), `TestModule.children.allTests()`, and the [TestCase metadata/result API](https://vitest.dev/api/advanced/test-case). It retains both raw reported full names and the native JSON suite/name components. Collection/result linkage must still agree, and exactly one complete receipt remains required. Built-in lifecycle checks test missing collection and changed native IDs; they do not replace the required fresh native transport test or original REA workflow. Unknown-plugin fallback remains untouched.

The declared version contract is root Vitest **5.0.2** for the required controlled native transport test and the unmodified REA lock's Vitest **5.0.3** for original-source qualification. The producer uses reported-task methods only; there is no silent legacy-hook compatibility fallback. Native qualification must be repeated if this API changes. The failed 5.0.3 artifact remains a negative observation until a fresh run emits and independently rechecks both receipts.

## Fresh original native producer qualification

[Run 37950751379](https://github.com/rudycelekli/testlore/actions/runs/37950751379), source `c1246773`, passed both native original-source executions under original lock Vitest 5.0.3: 14 passed and three skipped per execution. The manifest was independently reconstructed from pinned original source/schema/lock bytes; actual producer hashes and raw native skipped names matched both independently checked receipts. The [original archive and replay](../benchmarks/rea-case-registration/native-pass-20261009/README.md) preserve this narrow producer pass. It does not qualify test routing, property-input equivalence, speed or any earlier artifact, and unknown-plugin fallback remains unchanged.
