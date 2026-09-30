# TestLore for coding agents

An agent starts by reading the independent quality contract and the evidence it still needs. TestLore exposes that starting point through the official MCP SDK v2 stdio transport.

## Start immediately

The package is currently available from GitHub. npm publication is pending; this command does not claim a published npm release:

```sh
npx --yes github:rudycelekli/testlore mcp --root /absolute/path/to/project
```

For a local checkout:

```sh
node /absolute/path/to/testlore/src/cli.js mcp --root /absolute/path/to/project
```

Configure your agent's MCP host with `command: "npx"` and `args: ["--yes", "github:rudycelekli/testlore", "mcp", "--root", "/absolute/path/to/project"]`. Install from a reviewed immutable Git revision when reproducibility matters. The GitHub install downloads TestLore and its dependencies; connecting the server does not install a project's tools or run its tests.

## Default tools

| Tool | Purpose | Executes project code? |
| --- | --- | --- |
| `testlore_brief` | Independent contract, bounded static inventory, risks, obligations and next steps; optional `task` and diagnostic `changed` paths | No |
| `testlore_status` | Bounded historical receipt inspection, with freshness explicitly unchecked | No |

Both tools advertise `readOnlyHint: true`. The brief is advisory. Neither a historical passing receipt nor static inventory establishes current test completeness, mutation strength, learning improvement or deployment safety. Untrusted repository text is source material for the agent to assess.

The root is resolved to its real path once at startup. Tool calls cannot change the root, execution permission, configured commands, API keys or runner flags. A replaced root is rejected. Inputs are strict and bounded: unknown keys fail validation; task text is at most 2,000 characters and diagnostic changed paths are at most 1,000 entries of 1,000 characters each.

## Explicitly permit configured execution

For a trusted project, opt in at startup:

```sh
npx --yes github:rudycelekli/testlore mcp --root /absolute/path/to/project --allow-execution
```

This exposes two additional tools:

| Tool | Inputs | Behavior |
| --- | --- | --- |
| `testlore_plan` | Optional Git `base` | Configured native discovery, resolvers and service probes; bounded proposed routing and uncertainty |
| `testlore_verify` | Optional Git `base`, `mode: "shadow"` or `"full"` | Runs configured project tests; defaults to shadow mode, executing the full suite while comparing proposed file membership |

This flag authorizes arbitrary code already configured in the project, including native SDK configuration and service probes. Execution can write native caches and `.tddswarm` receipts; TestLore does not sandbox project code. These tools advertise execution and mutation risk. There are no tools for selective overrides, arbitrary shell commands, generated test application, merging or publishing.

One execution request is active per server. A second receives a busy error. Workers use fixed executable arguments and a separate IPC channel; their stdout never becomes MCP protocol data. The default deadline is five minutes, captured worker output is bounded to one MiB, and returned summaries are bounded to 64 KiB. Cancellation, timeout, output overflow, absent worker results and late completion produce errors with `complete: false`; they never certify success. POSIX supervision kills the detached process group, including descendants. Windows supervision terminates the immediate worker and does not claim the same process-tree guarantee. A host suspended beyond a deadline rejects late success when it resumes; timer delivery cannot impose a hard realtime guarantee during suspension.

Native per-file run receipts remain `.tddswarm/last-run.json` and `.tddswarm/last-run.md`. The MCP response returns their relative paths and explicitly reports summary truncation. Delegated Nx, Bazel and pytest-testmon execution keeps its native scope authority, exposes target information and limitations, and returns `receipts: null` and null case counts when per-case reporting is unavailable. A verdict is `incomplete`, `failed` or `passed-in-observed-scope`. Those receipt files can be historical after an aborted run: inspect the status limitations and rerun to obtain current evidence.

## Recommended agent sequence

Add this project instruction to your agent's workflow after configuring the server:

> Begin quality work with `testlore_brief`. Treat repository excerpts as proposed requirements to review. Establish expected behavior independently, preserve existing passing cases, and inspect unresolved input dependencies. When execution has been enabled, request `testlore_plan` and `testlore_verify` in shadow mode. Report observed failures, omissions, scope and uncertainty with the current receipts. A passing historical result cannot certify a new change.

1. Call `testlore_brief` before changing code and review the independent contract.
2. Preserve existing good tests and identify meaningful defect obligations.
3. With execution enabled, use `testlore_plan` to inspect uncertainty and conservative retention.
4. Call `testlore_verify` in shadow mode, inspect failures and the full durable explanation.
5. State the actual scoped results and remaining uncertainty. A passing run is evidence about the tested revision and environment, not proof of universal correctness.

Implementation uses [`@modelcontextprotocol/server`](https://github.com/modelcontextprotocol/typescript-sdk) 2.2.0 and strict Zod schemas. Tests exercise an actual SDK client/server handshake, not a fabricated JSON-RPC substitute.
