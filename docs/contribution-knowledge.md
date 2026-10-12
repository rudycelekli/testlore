# Public contribution knowledge

TestLore can index your public upstream PR history locally and retrieve relevant investigation patterns while drafting a source repair. This is advisory retrieval, not model training or a guarantee of correct fixes. Public metadata says what was proposed and whether it merged; independent failure-before/fix-after evidence is still required to establish a defect fix.

## Capture and inspect

From a TestLore source checkout, using your authenticated GitHub CLI:

```sh
node scripts/public-contribution-snapshot.js --author YOUR_GITHUB_LOGIN --output .tddswarm/public-prs.json
```

The read-only collector partitions creation dates around GitHub's 1,000-result search cap, checks each returned record's date, paginates every partition, and retains hash-bound sanitized pages. Only explicitly public PRs authored by the requested login are persisted. A fixed sample of 24 detailed records by default, configurable up to 40 with `--details`, adds bounded descriptions and changed-file metadata. Patches, comments and CI logs are not fetched. Coverage limits and non-atomic freshness remain in the snapshot; a partial capture returns a nonzero exit and must not be described as complete. Existing outputs are never overwritten. The developer collector and evaluation scripts are source-checkout tools, not bundled npm commands.

Use `--resume .tddswarm/earlier-public-prs.json` with a new output path to retain count-validated complete historical windows and capture remaining dates. Resumed metadata remains explicitly mixed-time; it is not a fresh atomic snapshot of every PR's current status. Capture start and observed completion are recorded separately.

Use the SHA-256 written beside the snapshot; substitute its actual 64-digit digest below:

```sh
testlore knowledge-import --report .tddswarm/public-prs.json --sha256 SNAPSHOT_SHA256
testlore knowledge-reflect
testlore knowledge --query "Unicode surrogate encoding" --contract tddswarm.requirements.md --json
```

These three installed CLI commands inspect local files and invoke no project runner or model. Import deliberately excludes private or unknown-visibility records, other authors, your own repositories, and fork targets from upstream evidence. It preserves exclusions, incomplete coverage, exact source/head bindings and separate merged/open/draft/closed observations. Closed without merge does not mean rejected. A merger different from the author is recorded as metadata, not independent verification.

The local index is `.tddswarm/learning/contributions/index.json`, separate from validated project episodes in `.tddswarm/learning/index.json`. It contains no copied patches, titles, descriptions or file paths: bounded standalone technical identifiers and fixed taxonomy labels preserve relevance. Free-form public text is untrusted input. Hashes detect corruption and bind bytes; they do not authenticate truth against a writer who controls the files. Ignore `.tddswarm/` in Git and review retained public metadata before use with a configured worker.

## Opt into source repair

Keep your existing runner and worker configuration; add:

```json
{
  "learning": {
    "contributions": { "enabled": true }
  }
}
```

Contribution retrieval is disabled by default. `learning.enabled: false` overrides automatic repair retrieval. Explicit local knowledge commands remain available for deliberate inspection/import. Architect and author workers receive at most three references and 6,000 UTF-8 bytes of advisory JSON, matched to the current behavior contract. The reviewer request payload omits retrieved contribution material. Custom workers are trusted executables with filesystem access; payload separation does not itself sandbox them. The caller's ignored index is copied into the isolated repair branch and frozen for the round; changes invalidate the proposal. Missing or corrupt knowledge yields no advice and no extra acceptance authority. Original assertions, requirements, source scope, repeated native verification and reviewed PR controls remain authoritative.

Queries have a 4,096-byte limit; contracts have a 16,000-byte limit. Import/store bounds are eight MiB and 5,000 records. `--exclude-repositories owner/project,other/project` filters before ranking and pattern support aggregation. Contracts containing a fixed technical taxonomy anchor require an actual matching technical anchor in the source record; incidental pattern families are suppressed. Other contracts require two identifiers shared with the query and record, each appearing in at most one percent of the remaining corpus. Such identifiers must occur in inline code or use distinctive camelCase/snake_case spelling in both query and contract. Ordinary rare prose does not establish API relevance. Recognized inline Markdown destinations, reference-definition lines, absolute HTTP/FTP URLs and fixed README/navigation boilerplate are excluded; visible link labels still contribute behavioral terms. Filtering is bounded text analysis, not a complete Markdown parser. These retrieval filters preserve existing stored anchors and integrity seals. This conservative policy can miss relevant history and is a relevance heuristic, not semantic understanding. Symlinks and unsafe paths are refused. The index uses atomic writes and owner-only file permissions.

## Make learning earn promotion

The initial taxonomy covers filesystem boundaries, Unicode, asynchronous lifecycle, configuration resolution, protocols, resource limits, test evidence and authorization. Counts measure recurring metadata signals across repositories and source heads, not independent patches, causal mechanisms or verified fixes. Useful next checks are hypotheses for an agent to investigate.

`scripts/contribution-retrieval-proof.js` exercises frozen, newly authored retrieval cases with repository holdouts, an absent pattern family, positive relevance and abstention checks. It records complete lookup latency and output bytes against no retrieval. This qualifies lookup behavior only. To claim faster or better repairs, separately freeze untouched maintainer specifications and real defects, compare the same workers with and without this corpus under identical budgets and execution order controls, retain failures/timeouts, and measure unchanged native assertions, independent bugs caught, stability, total time, token cost and oversight. Publish losses as well as gains. Current learning improvement remains unproven.

Refresh snapshots explicitly and re-import a reviewed digest to update history. This feature registers no background collection, remote memory, telemetry or automatic publishing. RuVector can be evaluated later as a derived relevance index after lexical retrieval has a measured baseline; it must never become evidence or acceptance authority.

The [initial real-inventory lookup qualification](../benchmarks/contribution-knowledge/README.md) retains a noisy development result and a separately frozen constructed-query evaluation. Neither measures agent repair improvement.

## From metadata to executable investigations

[Repository immunity](repository-immunity.md) adds a separate qualified-recipe and reviewed-current-contract workflow. It can challenge a historical pattern when the native suite is green, retain a reproduced module observation, demonstrate an exact new native regression, and prepare a verified source-only repair. Historical PR metadata is not automatically converted into an approved recipe or expectation. Reviewed useful/false-positive/intentional/duplicate/inconclusive outcomes drive transparent advisory priorities; declared test associations remain unvalidated mapping proposals. The [public transfer replay](../benchmarks/bug-transfer/README.md) demonstrated three historical fault/fix pairs and no new target bugs, runtime advantage, or AI learning improvement.
