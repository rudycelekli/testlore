# Bounded native generation qualification

Reliability is evaluated before learning comparisons. A rejected role, timeout, invalid review, unstable baseline, incomplete defect execution, or source drift remains a failed trial. Fixed budgets are not extended until a run happens to pass.

Use `scripts/learning-evaluation.js --mode generation-reliability` with a prospectively committed dataset. This mode executes only the `without_memory` arm, requires three roles per successful trial, and retains independent reference runs and repeated generated baseline/defect runs. It reports `not-a-learning-comparison`; learning promotion remains disabled. Existing paired mode is unchanged.

The October 6 native diagnostic observed a Codex error item reporting that inherited skill descriptions were shortened. A separate changed-prerequisite diagnostic, using the documented `skills.max_context_tokens=10000` limit, completed without that warning. The adapter now sets that limit explicitly; it still rejects every native error item, exposed tool attempt, incomplete lifecycle, response mismatch, and changed transport identity. A completed diagnostic is not a generated-test quality result. The larger catalog can increase input usage; billing and actual provider/model identity remain unverified.

Datasets, role calls, rejected outputs, unknown usage, and reference executions remain available in local receipts. A local commitment binds bytes and ordering, not external authorship or semantic independence. Constructed defects must be described as constructed.

Codex behavior and configuration are documented in the official [configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference) and [exec item definitions](https://github.com/openai/codex/blob/main/sdk/typescript/src/items.ts).

For native host qualification, `--authorize-fixture-tools` grants invocation-only approval to `testlore_plan` and `testlore_verify` on the controller-created isolated fixture. This uses the documented per-tool approval configuration, preserves execution annotations and managed policy restrictions, and does not edit personal host settings. The flag defaults off. Actual observer receipts must demonstrate the planted failure and retained passing test before the host qualifies. Claude still requires its own authenticated native session; no provider fallback substitutes for that host.
