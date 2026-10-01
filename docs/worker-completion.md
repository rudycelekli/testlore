# Bounded native generation qualification

`scripts/codex-worker-proof.js` is an explicit, local native exercise. Importing it and running the ordinary test suite never invokes a model. It requires clean committed source, an installed Codex CLI and an existing CLI-reported ChatGPT login; it does not install tools, initiate login, alter permissions or fall back to API credentials.

```sh
node scripts/codex-worker-proof.js --execute --output .tddswarm/worker-proof/new-run --timeout-ms 60000
```

Use a new output directory every time. Private receipts retain inputs, outputs, native audits, rejected attempts and independently executed outcomes. The fixed budget allows at most three controller role invocations—architect, author, reviewer—with no controller retries, a 60-second default per-role deadline and a 32 KiB response/event limit. CLI version and login-status probes consume the same role deadline. The model identity and provider billing remain unknown. Reported token counters are not a verified invoice or provider request count.

The exercise freezes one unsigned big-endian integer contract and three separately authored faults before generation. Reference tests demonstrate each fault in two native runs. The worker receives the correct source and behavior requirements; reference tests and fault payloads are excluded from its input and request directory. Generated tests must pass twice and catch each identical fault twice with stable named outcomes. A reviewer approval, more cases or a process exit code cannot substitute for those executions. Failed qualification has zero qualified detections; partial observations remain separately labeled.

The native adapter rejects reported tool attempts, malformed or incomplete events, missing terminal success, invalid role schemas, event/file disagreement, late results and launcher/schema/adapter drift. It preserves structured stdout compatibility and rejects preexisting response evidence. [Worker protocol](agents.md) explains the event and process-group guarantees. Auditing does not establish OS read confinement, complete nested-runtime identity or a verified provider model.

This is one constructed contract, not a production corpus or an independent leaderboard. It does not test a learning effect or fully qualify an agent's MCP execution permissions. [Frozen learning results](qualification-campaign.md) and native host outcomes remain separate evidence.
