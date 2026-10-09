# Original e2e unit campaign: complete negative observation

The [hosted run 37953327771](https://github.com/rudycelekli/testlore/actions/runs/37953327771) used TestLore source `6cea38950813e8ccfde6a7b8ea2d7c44ddbd7026` and tester-army/e2e upstream `0ddea76a7091ac8768e0ced2a9926b37e72e9497`. Original pnpm 12.3.4 frozen installation and root build succeeded. The original unit baseline has 174 files, 2,495 cases, 2,493 passes and two skips.

`original-outcomes.json.gz` retains all 98 original UTF-8 artifact members exactly, including native JSON, actual CLI stdout/stderr, process events, source/input bindings and restored baseline. `original-outcomes.integrity.json` binds member bytes, compressed/uncompressed payloads, original ZIP digest, run/artifact IDs and controller source hash/Git blob. No titles are normalized and no parameter identities are invented. Hashes check integrity; they do not establish truth.

Run the bounded independent replay:

```sh
node scripts/contributed-e2e-frozen-replay.js benchmarks/contributed-e2e/observed-20261009
```

All six TestLore trials fall back to the full 174 files and omit none. Native selection runs 32 files for the comment control and 104 for the exact-parent Unicode source regression. The unique Unicode assertion fails in all three fault repetitions and is retained by full/native/TestLore; exact file/title/status multiplicities match. Two original `hidden` parameter rows share one raw title, so individual case identity remains incomplete and **qualification is false**.

Complete process median times:

| Change | Full | Native related | TestLore |
| --- | ---: | ---: | ---: |
| Comment control | 23.227 s | 8.482 s | 27.875 s |
| Unicode regression | 23.409 s | 15.754 s | 27.249 s |

Planning and reporting are inside the measured test processes. Shared original builds are separate. The controller took 450.870 seconds through its primary execution receipt; source archive sealing/install before it and upload are excluded. OS caches were not reset. There is no observed speed or safe selective-omission advantage.

The actual resolver reports one server, 2,195 requests and 4,390 calls, with **zero avoided calls** in every trial. Object-identity deduplication yields no gain here. External monorepo TypeScript configuration and uncertain runtime registration/dependency evidence retain full fallback.

The independent replay compares original native reports against actual CLI stdout, validates their copies in trial receipts, checks process outcomes, restores the original raw baseline and matches 568 protected in-scope hashes per trial. Final external monorepo workspace bytes are unavailable; whole-monorepo freshness depends on the original controller admission. Rudy authored the Unicode contribution and its assertions, so test authorship is not independent. This covers one original unit project, not browser/provider/integration or whole-project quality. Earlier rejected attempts remain rejected.
