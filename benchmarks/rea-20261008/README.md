# REA: retained negative evidence

Published TestLore 0.1.0 was measured against pinned [morluto/rea](https://github.com/morluto/rea/tree/3dcb732da33f6ceef597506b14a4536f1c9aff96) and its original npm lockfile. This is **not a successful routing qualification**. See [the report](../../docs/rea-public-qualification.md).

`native-evidence.json.gz` preserves 50 original JSON receipts as UTF-8 strings, including native reports, stdout/stderr fields, named outcomes, plans, manifest, installation locks and source hashes. `integrity.json` binds every original member and the compressed archive. No test names, seeds, failure statuses or rejected outcomes were normalized away. The full original hosted upload also contains phase stdout/stderr logs; these are not all included in the durable JSON archive.

Recheck the recorded executions without installing dependencies or running upstream code:

```sh
node scripts/rea-public-pilot.js --verify-frozen benchmarks/rea-20261008
```

Exit 0 here means archived evidence was independently rechecked and complete. The printed `assessment.qualified` remains **false**. Reassessment is not a new native run. The frozen original assessment remains unchanged.

REA test outputs and fragments are retained under its MIT license, reproduced in `LICENSE.rea`. TestLore tooling is covered by the root MIT license.
