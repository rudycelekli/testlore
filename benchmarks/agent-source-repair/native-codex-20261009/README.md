# One recorded native Codex source repair

This is an adapted source-repair trial against the original `is-number` fault
at `204c885659b8ee1946534c61db91603b9a16d661`. Independent issue #3 behavior
requirements and eight fixed Node assertion cases were supplied; the fixed
implementation was not supplied. Three actual native Codex adapter role calls
completed. Native validation retained two baseline failures twice, verified two
independent assertion-error probes, then passed eight unchanged cases twice and
on the final local commit. Only `index.js` changed. The caller remained clean,
and no external PR was published.

The earlier incomplete baseline included both the adapted oracle and the original
Mocha file. It is retained in `baseline-scope-rejected.json`. The subsequent
registration declared an adapted eight-case Node profile, with Mocha bytes kept
as documentation. This is not a full upstream-installation or original-suite
qualification. One whitespace bug exposed two assertions.

The original registration named fixed test commit `12749e3c`, but the retained
Mocha file actually matches fault-version blob `23e32490`. The independent review
preserves that mismatch: `original-mocha-retained.txt` is unchanged, and
`original-mocha-fixed-12749.txt` separately retains the exact fixed test blob
`3cbbc560`. The adapted oracle reuses original assertion semantics with issue #3
inputs and a representative negative `-1`. It is not eight untouched original
maintainer cases. Primary references: [fault source](https://github.com/jonschlinkert/is-number/blob/204c885659b8ee1946534c61db91603b9a16d661/index.js),
[original fixed tests](https://github.com/jonschlinkert/is-number/blob/12749e3c411750f754d50f093471234c7ab270b0/test.js),
and [issue #3](https://github.com/jonschlinkert/is-number/issues/3).

`integrity.json` binds 18 retained UTF8 members, with original and public
byte counts and SHA-256 hashes. Runtime account and temporary-directory prefixes
alone are replaced with `<USER_HOME>` and `<TEMP>`. Original private bytes remain
in the campaign directory. Dependencies, Git internals, authentication logs and
the local HMAC key are excluded. The original HMAC was verified privately;
transformed public receipts cannot be authenticated by that seal. Upstream MIT
source attribution and license are preserved.

Run `node scripts/agent-repair-frozen-replay.js` from the repository root to
reproduce `independent-assessment.json`. This checks recorded evidence without
making provider calls or rerunning upstream tests. The full running TestLore
source revision was not independently preregistered; only the worker adapter
hash was bound before invocation. CLI default model, token counts and currency
cost are unknown. No learning, superiority, registry-release or general repair
reliability claim follows from this single trial.
