# Public contribution lookup qualification

[Aggregate observations, 2026-10-11](2026-10-11.json) describe local metadata retrieval, not generated repair quality.

A paginated public-authored inventory observed 3,593 PRs. The local upstream corpus retained 3,432 records across 83 external repositories after excluding 160 own-repository PRs and one fork target. It observed 1,549 merges; these are not independently verified bug fixes. Historical windows and recent windows have separate observations; this is not an atomic current-status snapshot. Twenty of the 24 detailed samples survive filtering. The personal corpus and raw descriptions remain local.

The first six constructed queries produced four expected family hits, but only four of 14 returned patterns were relevant and neither negative case abstained. Those cases became development data. Their negative raw evidence and exact producer implementation were preserved and replayed.

After a principled relevance-policy correction, a separate owner froze ten new constructed queries before inspecting the updated implementation. All ten target repositories were excluded before retrieval; an authorization family was absent from the 3,409-record training subset. Seven positive queries returned their relevant taxonomy, and three negative queries returned no records. All 21 returned records and seven returned patterns matched the case taxonomy labels. Total local lookup took 1,721.744 ms and emitted 18,006 bytes across ten queries. No provider or network calls occurred during evaluation.

This small, constructed qualification measures metadata lookup and abstention. The empty no-retrieval arm is descriptive; it cannot establish better agent fixes, lower model cost, semantic understanding or generalization to untouched maintainer specifications. The queries are now observed evaluation data and must not be reused as untouched evidence after further tuning. Live matched-budget repair experiments remain outstanding. [Feature and evaluation contract](../../docs/contribution-knowledge.md).
