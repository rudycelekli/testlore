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

Run summaries include failed case IDs, file paths, names and a concrete next action. If the complete presentation exceeds its byte budget, the compact response keeps up to ten failed identities, outcome and scope counts, verdict, receipt paths and next action. It sets `complete: false` for the incomplete presentation and separately retains `observedComplete`; truncation never establishes additional execution or deployment authority.

## Recommended agent sequence

Add this project instruction to your agent's workflow after configuring the server:

> Begin quality work with `testlore_brief`. Treat repository excerpts as proposed requirements to review. Establish expected behavior independently, preserve existing passing cases, and inspect unresolved input dependencies. When execution has been enabled, request `testlore_plan` and `testlore_verify` in shadow mode. Report observed failures, omissions, scope and uncertainty with the current receipts. A passing historical result cannot certify a new change.

1. Call `testlore_brief` before changing code and review the independent contract.
2. Preserve existing good tests and identify meaningful defect obligations.
3. With execution enabled, use `testlore_plan` to inspect uncertainty and conservative retention.
4. Call `testlore_verify` in shadow mode, inspect failures and the full durable explanation.
5. State the actual scoped results and remaining uncertainty. A passing run is evidence about the tested revision and environment, not proof of universal correctness.

Implementation uses [`@modelcontextprotocol/server`](https://github.com/modelcontextprotocol/typescript-sdk) 2.2.0 and strict Zod schemas. Tests exercise an actual SDK client/server handshake, not a fabricated JSON-RPC substitute.

## Opt-in native host qualification

SDK interoperability tests and native coding-host qualification are separate evidence. From a reviewed checkout, explicitly run the installed subscription-backed host executables against a source or already-installed package entrypoint:

```sh
node scripts/host-qualification.js --run \
  --entrypoint /absolute/path/to/testlore/src/cli.js \
  --codex /absolute/path/to/codex \
  --claude /absolute/path/to/claude \
  --output /absolute/path/to/host-receipt.json --timeout-ms 90000
```

This is never part of ordinary `npm test`. It runs at most one invocation per supplied host, after checking the installed CLI's help. Each host gets a temporary Git fixture with one planted implementation fault and one preserved passing case. Two temporary MCP configurations expose the default tool surface and execution-opted-in tools. The host must call brief/status before plan/shadow verification, then report the exact observed failure identity, both executed test files, remaining uncertainty and a concrete next action. The prompt contains only this synthetic fixture's task.

The output path must be new before any invocation; the receipt is created exclusively with mode `0600` and never overwrites an earlier attempt. Duplicate, unknown or missing-value CLI options fail before invocation. Both the CLI and JavaScript API enforce a timeout from 1,000 to 120,000 milliseconds, defaulting to 90,000 when omitted. The synthetic verification must observe exactly one failed case, one preserved passing case and zero skipped cases.

The harness does not install hosts or packages, download dependencies, edit personal configuration, or read/copy/write credentials. Existing subscription login remains available. The subprocess environment removes provider API keys, provider routing variables, injected Node options and API-key helpers. Codex uses its documented ignore-user-config, ignore-rules and ephemeral options, with read-only shell sandbox and approval policy `never`; Claude uses empty setting sources, strict temporary MCP configuration, disabled built-in tools/hooks/skills, explicitly allowed fixture MCP tools, and no session persistence. A host can still reject execution under its own approval rules. The harness preserves that rejection; it does not weaken permissions, retry, switch providers or replace the host with an SDK client. Claude's streamed native API retry event stops the invocation immediately and retains the reported HTTP error; the harness does not allow a native automatic retry loop.

Receipts contain SHA-256 identities for Node, host launchers (and the resolved Codex native binary when available), package metadata, every TestLore source file, exact CLI arguments, bounded process output and real MCP calls/results. A transparent stdio relay forwards bytes to the exact supplied CLI; it does not implement MCP responses. Host runtime, cumulative output and observer frames/call counts are bounded. Timeout, missing host, missing tool invocation, incomplete native verification, changed package bytes or an overclaiming final account leave the host unqualified. Temporary evidence is retained for inspection; remove its reported workspace when no longer needed. Windows process supervision only guarantees termination of the immediate host, unlike POSIX process-group termination.

The entrypoint must be exactly the snapshotted package's `src/cli.js`, with matching bytes. Final-file and observer-receipt reads reject oversized, symlinked or malformed evidence. Node, launcher and resolved native executable identities are checked again after invocation. Qualification requires exactly one brief/status/plan/verify call, exact plan arguments `{base: "HEAD"}`, exact verify arguments `{base: "HEAD", mode: "shadow"}`, and a shadow-mode response. Finite observer timestamps must place both default responses before the plan request and the plan response before verification; duplicated request IDs within a server or missing timestamps invalidate the account. The final account must match the exact observed failure ID/file/name tuples and executed file set, without invented or duplicated entries.

For immutable packed evidence, point `--entrypoint` at the fresh production install prepared by the packed proof and additionally supply:

```sh
--archive /absolute/path/to/testlore.tgz \
--expected-archive-sha256 EXACT_SHA256 \
--expected-source-sha EXACT_GIT_COMMIT
```

The harness checks the archive checksum, compares every installed source file and `package.json` with archive members without extraction, and requires the installed package's `gitHead` to match the supplied source commit. `--expected-sha256` can additionally pin the entrypoint file. No host result qualifies a different package digest, other host versions, another repository or a release. If a host times out or blocks tools, report the observed failure and rerun only as a separately reviewed invocation; keep the failed receipt.
