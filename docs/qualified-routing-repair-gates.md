# Qualified omissions and independent repair vetoes

TestLore now demonstrates a bounded additional verification result on the original
unimport application. It does **not** demonstrate a speed advantage or general
application coverage.

## Original application comparison

The frozen implementation was `07fdbf52abda41b8f4ba4d749c60df8000ebbb7d`.
The unchanged original unimport source and assertions were pinned to
`bbd07768ddb4919205bcb5a3cbc06c3a2791981a`, installed with its original frozen
pnpm12.3.4 lock and required original build. The environment was Darwin arm64,
Node22.19.0, Vitest5.0.0, Vite8.2.2 and Rolldown1.2.7.

A declared fixture intervention changes the comma-separated export `BAR` to
`BAZ`. This is a **seeded regression**, not a discovered historical upstream bug.
Original native assertions independently fail in both directory scanning and
declaration generation. The original fixture bytes are restored afterward.

Healthy, faulted and restored phases each run twice, with rotated execution
order and18fresh full/TestLore/native-related invocations. Both JSON outcomes and
source-bound parser-factory identities must agree; all original titles and
assertions are preserved. A deliberately incomplete scan-only run misses the
declaration-generation failure and is rejected by the evaluator.

| Outcome | TestLore | Full native suite | Native related selection |
| --- | ---: | ---: | ---: |
| Files executed per run |23/28|28/28|0/28|
| Cases executed per run |200/254|254/254|0/254|
| Seeded failures retained in each faulted repeat |2/2|2/2|0/2|
| Median complete outer runtime |17.258s|2.510s|1.723s|

TestLore omits `add-import`, `dedupe`, `existing-scanning`, `to-export` and
`to-imports`. Every omission records `no-known-dependency-on-change`; explicit
filesystem mappings retain both original scanner and declaration consumers.
Remaining uncertain runtime consumers continue to run. All six selected runs
match the full suite on every executed case, with no observed missed failures.
The full source inventory is restored, including all224original tracked inputs.

Timing includes fresh CLI startup, admission, planning, execution, reporting and
postflight revalidation. Install/build and the complete controller span are
retained separately. Native caches are disabled equally; operating-system cache
warmth is uncontrolled. These repetitions do not qualify cold/warm cache claims.
The17.258s median is a material **performance loss**, despite the54case omissions.

Runtime admission binds the exact reviewed installation implementation, native
binaries, directory/link membership, effective configuration, original source,
15native transform canaries and a private live context. Three reviewed option/
plugin projections cover the observed agent-host and isolated CI environments.
Only scoped pnpm bookkeeping fields normalize across installations; their full
raw bytes remain immutable during a run. Copied reports cannot authorize
omissions. Unsupported environments or changes retain fallback.

The admitted source profile is deliberately narrow: original healthy bytes,
one declared fixture fault and the inert setup baseline. Arbitrary source edits,
new configuration, different runtime versions, typechecking, browser execution,
other platforms and other repositories are not qualified by this experiment.

Reproduction uses `scripts/unimport-routing-pilot.js` from that exact producer
commit and a clean pinned original upstream checkout. It performs isolated
installation and build itself and preserves raw arm reports. The final assessment
SHA256 is `bc7be6810fa527e13bfcddd8707716d74cecd922e9ffe839a28fab3bd8581db4`.
A fresh-install fingerprint refusal, an excluded producer-drift attempt and an
aborted disk-growth attempt remain recorded separately; none is promoted as a win.

## Repair correctness requires executable counterexamples

A source repair must repeatedly pass the original native assertions and committed,
independently maintained behavioral challenges. Missing challenges produce an
`awaiting-challenges` work order before paid workers start. Changing original
assertions, challenge bytes, installed dependencies, configured native executable
or authenticated validation inputs rejects readiness/publication.

The historical klona counterexample demonstrates the need for this gate: a shared
candidate passes all137original assertions but throws when cloning an enumerable,
non-writable constructor property. Both historical sources pass that independent
challenge. The executable veto now rejects this candidate even with a green
original suite. This is inspected development evidence, not a fresh holdout or a
newly accepted upstream repair. See [challenge setup](autonomous-repair.md).

Persisted graph summaries also remain advisory. A fresh canonical safety parse
checks imports and warnings before disk summaries can be reused. Recomputing a
public checksum cannot erase uncertainty or cause an omission. The corrected
120-module replay took239ms with warm summaries versus206ms with caching disabled;
the older faster cache result predates this correction.

## Remaining promotion gates

The next performance work must measure total admission and execution cost,
without weakening freshness. Broader history, genuine application regressions,
framework/browser profiles and untouched paired repair tasks remain necessary.
Learning is advisory; this campaign makes zero new model calls and establishes
no memory-assisted repair gain. The npm candidate remains unpublished until
owner authentication, protected trusted publication and exact registry-byte
verification succeed. Source/packed CI and main merge are tracked separately from
these application and learning claims.
