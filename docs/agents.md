# Agent worker protocol

Core analysis and routing are deterministic. Agents propose improvements; they never remove tests from a deterministic run plan.

Configure `"agent": ["executable", "argument"]`. TDDSwarm invokes it without a shell, writes one JSON payload to stdin, and expects one JSON object on stdout. Logs belong on stderr. Each process is bounded to 120 seconds and 2 MB output. Source/test plus requirements context is limited to 256 KB. No `.env` or arbitrary asset contents are deliberately included, but secrets embedded in source are possible. The custom worker is trusted executable code, not sandboxed by TDDSwarm.

Stages:

1. `architect` receives `order`, `context: [{file,content}]`, and `requirements`. Return `{"tasks":[{"subject":"src/example.js","instructions":"Independent behavior to verify"}]}`. Each subject must exist in context, and there must be 1–12 tasks.
2. `author` receives one `task`, the context, and requirements. Return `{"files":[{"path":"test/example.test.js","content":"complete test source"}]}`. Up to three author calls run concurrently. Maximum 50 unique files, each 128 KB.
3. `reviewer` receives candidates, requirements, context, and acceptance criteria. Return `{"accepted":false,"findings":["Concrete issue"]}`. This is an independent role/call, not guaranteed model or vendor diversity.

Paths must remain inside the project and identify test files; path traversal, absolute paths, duplicate paths, and symlink traversal are rejected. All candidates, including rejected ones, are stored under `.tddswarm/candidates/<uuid>/` with `review.json`. No live file is overwritten. Execution, collection, coverage, mutation, and repeated-run stability remain unmeasured until separately validated.

## Included Codex adapter

After installing locally, use:

```json
{ "agent": ["npx", "--no-install", "tddswarm-codex-agent"] }
```

Requires an installed Codex CLI supporting the adapter's flags and an existing authenticated login. It uses `codex exec` with `--output-schema`, `--output-last-message`, `--ephemeral`, `--ignore-user-config`, and a read-only sandbox in a temporary directory. It removes known provider API-key variables and uses the CLI default model. The adapter does not install Codex or initiate authentication. Usage may consume your plan allowance. Configured provider keys/settings that are not those environment variables are outside this adapter's guarantee; review your CLI auth.

The prompt asks the worker to use only supplied context and avoid tools. The sandbox restricts file mutation but is not a promise that a model can never access any local read-only data. This adapter is verified for request construction; live model outcomes have not been tested. Official behavior is documented in [Codex non-interactive mode](https://learn.chatgpt.com/docs/non-interactive-mode). Flags were also checked against the installed CLI during development.

Agentic QE is researched as prior art; it is not bundled or invoked. An AQE or other framework bridge can implement this protocol. Do not present a deterministic mock worker as an actual AI swarm.
