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

Requires an installed Codex CLI supporting the adapter's flags and an existing authenticated login. It uses `codex exec` with `--output-schema`, `--output-last-message`, `--ephemeral`, `--ignore-user-config`, and a read-only sandbox in a temporary directory. It removes known provider API-key variables and uses the CLI default model. The adapter does not install Codex or initiate authentication. Usage may consume your plan allowance. Configured provider keys/settings that are not those environment variables are outside this adapter's guarantee; review your CLI auth.

The prompt asks the worker to use only supplied context and avoid tools. The sandbox restricts file mutation but is not a promise that a model can never access any local read-only data. Request construction and a live Codex 0.155.1 controlled generation run are verified: three actual role calls produced 50 passing Node cases and caught four withheld mutations. See [live proof](../benchmarks/quality/live-codex.receipt.json). This small fixture does not establish general model quality or vendor-diverse review. Official behavior is documented in [Codex non-interactive mode](https://learn.chatgpt.com/docs/non-interactive-mode). Flags were also checked against the installed CLI during development.

Agentic QE has a separate genuine optional CLI bridge: `testlore aqe --target src/example.js`. It does not implement these worker roles. Upstream quality estimates remain upstream metadata; candidates are unreviewed until independent oracle review and validation. See [integrations](integrations.md). Do not present deterministic mock workers as an actual AI swarm.

## Your project agent

`testlore agent --name "My project quality engineer" --json` creates or inspects the local identity at `.tddswarm/agent.json`. It describes the project’s roles, local memory and validation boundaries. The identity is copied into improvement worktrees; future runs use the same name. It is a persistent configuration and workflow, not a background daemon.

Set `qualityAgent.name` and `qualityAgent.focus` in `tddswarm.config.json` to specialize the agent. Supported focus values are `boundary`, `error`, `contract`, `integration`, `determinism`, `mutation`, `accessibility`, and `performance`. Preferences guide proposals; they never waive independent requirements, native execution, or deterministic selection. Existing SPEC/requirements/README material can bootstrap a proposed contract on the isolated branch. Source implementation is never used to manufacture independent expected values.
