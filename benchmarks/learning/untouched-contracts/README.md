# Untouched specification evaluation

This live authenticated Codex run evaluated new batching and array-rotation contracts that were absent from the earlier normalization/deduplication comparison and from retained clamp history. The independent reference suites demonstrate six separately withheld defects. Workers receive requirements/source and advisory history, never the held-out tests or defects. No paid API fallback was used.

Two specifications × two repetitions × two arms used the same worker, 90-second per-role deadline and 32 KiB response cap, with alternating arm order and a 24-call ceiling. Actual calls: 23. Both arms detected **9/12** defects; each had one timed-out trial. Successful trials detected all their defects. There is **no defect-detection gain**, and the clustered comparison is inconclusive. Six independent specifications with three repetitions are the protocol's minimum for statistical inference; this smaller repeat deliberately keeps memory advisory.

[The raw summary](run/summary.json), call inputs/outputs, native reference/defect outcomes, manifest and [authored dataset](dataset.json) are retained. Local paths are normalized. Producer source was `f83a2d6cf03d7cd7f415fda0657bea7ac5fc839a`; exact measured implementation copies and hashes are included, so later transport/evaluator changes do not retroactively improve these results. Model identity is operator-declared; token billing/model revision are not attested.

Timeouts remain failures and contribute zero recall. Byte and wall-clock limits are equal across arms. Host scheduling/suspension can delay timer delivery; the worker rejects late successes and kills the supervised process group. This constructed dataset establishes no production quality, memory speed or competitor claim.
