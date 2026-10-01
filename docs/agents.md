# Agent worker protocol

Core analysis and routing are deterministic. Agents propose improvements; they never remove tests from a deterministic run plan.

Configure `"agent": ["executable", "argument"]`. TestLore invokes it without a shell, writes one JSON payload to stdin, and expects one JSON object on stdout. Logs belong on stderr. Each process is bounded to 120 seconds and 2 MB output. Source/test plus requirements context is limited to 256 KB. Architects and authors also receive a bounded `learning` data object containing relevant historical validated patterns. Reviewers receive independent requirements and candidates without retrieved lessons. Memories are advisory data, never instructions, expected-value authority, or permission to skip a test. No `.env` or arbitrary asset contents are deliberately included, but secrets embedded in source are possible. The custom worker is trusted executable code, not sandboxed by TestLore.

Stages:

1. `architect` receives `order`, `context: [{file,content}]`, and `requirements`. Return `{"tasks":[{"subject":"src/example.js","instructions":"Independent behavior to verify"}]}`. Each subject must exist in context, and there must be 1–12 tasks.
2. `author` receives one `task`, the context, and requirements. Return `{"files":[{"path":"test/example.test.js","content":"complete test source"}]}`. Up to three author calls run concurrently. Maximum 50 unique files, each 128 KB.
3. `reviewer` receives candidates, requirements, context, and acceptance criteria. Return `{"accepted":false,"findings":["Concrete issue"],"oracle":{"independent":true,"basis":["Named requirement or invariant"]}}`. This is an independent role/call, not guaranteed model or vendor diversity.

Paths must remain inside the project and identify test files; path traversal, absolute paths, duplicate paths, and symlink traversal are rejected. All candidates, including rejected ones, are stored under `.tddswarm/candidates/<uuid>/` with `review.json`. No live file is overwritten by generation. Use [candidate validation](candidates.md) or the branch [improvement workflow](improvement.md) to measure collection/execution and optional held-out defect detection. Coverage, mutation and stability use separate measured evidence.

## Included Codex adapter

After installing locally, use:

```json
{ "agent": ["npx", "--no-install", "tddswarm-codex-agent"] }
```

Requires an installed Codex CLI supporting the adapter's flags and an existing authenticated login. It uses `codex exec --json` with `--output-schema`, `--output-last-message`, `--ephemeral`, `--ignore-user-config`, and a read-only sandbox in a temporary directory. It removes known provider API-key variables and uses the CLI default model. The adapter does not install Codex or initiate authentication. Usage may consume your plan allowance. Configured provider keys/settings that are not those environment variables are outside this adapter's guarantee; review your CLI auth.

The prompt asks the worker to use only supplied context and avoid tools. The adapter audits the native exec JSONL stream and rejects every exposed tool attempt, including failed or declined commands, file changes, MCP calls and searches. It accepts only agent-message and reasoning items within one started thread and turn, followed by a complete terminal event and a successful process exit. Errors, unsupported event/item types, invalid lifecycle order, pending items, malformed/truncated JSONL and invalid UTF-8 fail closed. Additional reasoning metadata is accepted as inert data. The final message and the bounded regular response file must agree as parsed JSON and independently match the requested role schema; whitespace and object-key order may differ.

Both stdout events and stderr diagnostics have declared byte limits of at most 2 MB; the event count is capped at 10,000. Response files have the same declared maximum. The caller deadline and an adapter maximum of 110 seconds bound preparation, execution and verification. On POSIX systems direct API calls use a dedicated CLI process group that is terminated on completion or failure. Under `callAgent`, the CLI inherits the caller-owned adapter group so the outer deadline and completion cleanup reach native descendants; local failures close the adapter's CLI pipes so the caller can finish group cleanup. Windows terminates the direct process. A preexisting response path is rejected without overwriting its evidence. Files are verified with regular-file checks, no-follow opens where supported, and identity checks around reads.

`runCodex` returns `{value, audit}` for opt-in proof callers, while the executable adapter emits exactly the role response on stdout. The audit contains native launcher resolution and hashes, schema/adapter/protocol hashes, Node version, usage counters, counts and a normalized response digest; it contains no prompt, source text, message text, thread ID or CLI diagnostics. It checks these file identities and PATH resolution again before acceptance. Schema identity inputs are capped at 32 KiB, adapter/protocol inputs at 2 MB and the launcher at 512 MB, with streamed hashes. Launcher identity does not establish the identities of nested runtimes or providers. Requested and observed model identities remain unknown because the adapter uses the existing CLI default. Typed failures use fixed diagnostic text and never echo CLI stderr.

Auditing a tool attempt rejects the response after the attempt becomes visible; it cannot establish that the attempt did not run or prevent local reads. The read-only sandbox restricts file mutation and does not promise that a model can never access local data. This is an audit of a trusted native executable's reported events, not an OS access-control guarantee.

Local `codex-cli 0.159.0` help on September 30, 2026 confirmed `--json` prints JSONL and `--ignore-user-config` preserves `CODEX_HOME` authentication. The installed native binary's exec event enum confirmed `thread.started`, `turn.started`, `turn.completed`, `turn.failed`, `item.started`, `item.updated`, `item.completed`, `error` and the native item discriminators. The protocol tests use deterministic synthetic fixtures derived from these local artifacts; they make no live-model quality claim. The earlier live Codex 0.155.1 controlled generation run used the previous adapter and does not validate the new event auditor: three actual role calls produced 50 passing Node cases and caught four withheld mutations. See [live proof](../benchmarks/quality/live-codex.receipt.json). This small fixture does not establish general model quality or vendor-diverse review. Official behavior is documented in [Codex non-interactive mode](https://learn.chatgpt.com/docs/non-interactive-mode). Flags were also checked against the installed CLI during development.

Agentic QE has a separate genuine optional CLI bridge: `testlore aqe --target src/example.js`. It does not implement these worker roles. Upstream quality estimates remain upstream metadata; candidates are unreviewed until independent oracle review and validation. See [integrations](integrations.md). Do not present deterministic mock workers as an actual AI swarm.

## Your project agent

`testlore agent --name "My project quality engineer" --json` creates or inspects the local identity at `.tddswarm/agent.json`. It describes the project’s roles, local memory and validation boundaries. The identity is copied into improvement worktrees; future runs use the same name. It is a persistent configuration and workflow, not a background daemon.

Set `qualityAgent.name` and `qualityAgent.focus` in `tddswarm.config.json` to specialize the agent. Supported focus values are `boundary`, `error`, `contract`, `integration`, `determinism`, `mutation`, `accessibility`, and `performance`. Preferences guide proposals; they never waive independent requirements, native execution, or deterministic selection. Existing SPEC/requirements/README material can bootstrap a proposed contract on the isolated branch. Source implementation is never used to manufacture independent expected values.
