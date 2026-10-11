# First-run value and immutable alpha distribution

Status: Implementation candidate; execution and registry receipts govern qualification
Date: 2026-10-11

## Problem and decision

The default source setup can execute a complete native shadow run, but its human output is a large nested object and its run output begins with every test decision. A new user must find a failure, distinguish proposed omissions from actual execution, and interpret fallback warnings before knowing what to do. Public npm 0.1.0 also predates source repair and automatic adapter policy. Adding more adapters does not solve either activation problem.

Derive one bounded, advisory first-run summary from current raw execution evidence. Lead human setup/run/report output with the scoped verdict, observed file/case counts, named failures, proposed versus actual omissions, grouped uncertainty and a concrete next action. Retain full decisions and raw native output in durable receipts. Expose the same structured summary in setup JSON, run receipts and opted-in MCP verification. Recompute summaries from raw input when displaying historical reports; a stored summary is not execution authority.

Incomplete, interrupted, contradictory or unverified execution cannot become a passing summary. Delegated engines keep native target authority and null individual-case evidence. Reported per-case durations are optional observations, not critical-path, suite-cost or potential-savings measurements. Missing durations, skips and invalid numeric values contribute no claimed timing. Output limits preserve truncation and total counts. Canonical fallback labels explain why full execution remains necessary; presentation cannot clear warnings or authorize omission.

Prepare 0.2.0-alpha.1 with package/lockfile version parity and MCP handshake matching the installed manifest. Keep 0.1.0 release receipts immutable. Current source installation remains available; the candidate npm command is not advertised as available before exact registry bytes and fresh installation qualify it. Publication uses the tested immutable archive, the protected environment and verified publisher access. A version bump, green CI or publication attempt alone is not a published-release claim.

## Verification and limits

- Independently exercise real native success/failure setup, persisted report, compact CLI and SDK MCP transport. Native exits, requested/observed scope, original assertions and full shadow default must remain preserved.
- Challenge malformed, duplicate, empty, interrupted, delegated and truncated evidence, misleading timings and unknown warnings. No positive summary may upgrade raw execution, routing or deployment authority.
- Qualify the exact installed archive through actual npm exec, including a failing shadow run and the same source-bound summary in its returned and durable evidence. Retain historical proof format compatibility without rewriting old receipts.
- Run complete exact-source qualification with Chromium/Bun, independently review the exact commit, then verify registry integrity and provenance after any publication.

This improves first-use comprehension and distributes existing capabilities. It does not establish a routing speed advantage, independent model repair quality, stronger learning, maintainer adoption or production safety. The final e2e campaign still selected all 174 files and lost to native related selection. Those failed goals remain separate qualification work.
