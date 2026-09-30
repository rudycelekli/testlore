# Optional RuVector recall

TestLore can use [RuVector's native core](https://github.com/ruvnet/ruvector/tree/main/npm/packages/core) to search its validated local test memories. RuVector complements TestLore's review and execution evidence; retrieval never changes candidate acceptance, test selection, or deployment authority.

Install the optional package in the project where TestLore runs:

```sh
npm install --save-dev --save-exact @ruvector/core@0.1.32
```

Enable it in `tddswarm.config.json`:

```json
{
  "plugins": {
    "ruvector": {
      "enabled": true,
      "dimensions": 128,
      "timeoutMs": 10000,
      "embedding": { "mode": "feature-vectors" }
    }
  }
}
```

`dimensions` accepts integers 16–2048; `timeoutMs` accepts integers 100–60000. Omitted values use the example defaults. `learning.enabled: false` overrides the plugin. Disabled plugins do not load the SDK or create a vector cache. The SDK must be installed under this project's `node_modules`; an improvement worktree's dependency symlink is supported. TestLore does not add a mandatory RuVector dependency.

Run `testlore recall --query "zero boundary" --json`. Existing generation automatically passes bounded recall results to its architect and authors. The independent reviewer receives no recalled examples.

The default is **lexical-vector retrieval**: deterministic hashed word features, normalized into vectors, searched by the real native engine. The core package exports vector storage/search and does not bundle an embedding model. This mode is not semantic embeddings, neural training, or a Hindsight implementation. Exact word overlap is still required in this mode to prevent hash collisions from introducing unrelated patterns. Accepted evidence receives more ranking weight than rejected warning episodes; rejected examples contain no test snippets.

## Local embedding command

For a separately installed local embedding model, explicitly choose a trusted executable:

```json
{
  "plugins": {
    "ruvector": {
      "enabled": true,
      "dimensions": 384,
      "timeoutMs": 20000,
      "embedding": {
        "mode": "command",
        "argv": ["python3", "tools/embed.py"],
        "identity": "local-model-name-and-version"
      }
    }
  }
}
```

TestLore launches the argv without a shell, sending one JSON request on stdin:

```json
{"schemaVersion":1,"dimensions":384,"texts":["bounded redacted historical example","query"]}
```

Return a single JSON object on stdout:

```json
{"schemaVersion":1,"vectors":[[0.1,0.2],[0.3,0.4]]}
```

The abbreviated vectors above illustrate the format; each actual vector must contain exactly `dimensions` finite numbers, have a nonzero norm, and correspond to one input text in order. TestLore normalizes vectors and rejects invalid counts, shapes, values, output, or timeouts. A rebuilt index embeds all eligible episodes plus the query; a reused index embeds only the query. The result reports `external-embedding`. Whether this is semantic depends on the configured provider. TestLore does not automatically train model weights.

`argv` accepts 1–32 nonempty strings, each at most 4096 characters; `identity` is required, nonblank, and at most 128 characters. Local argv file changes invalidate the cache. Change `identity` whenever model weights or other provider dependencies change. The command receives bounded local memory text and queries. It is trusted project code: use a local provider to retain local processing, or apply your own process/container restrictions. The worker does not prevent a configured executable or installed SDK from making network requests, reading other files, or inheriting environment variables. The default feature-vector path invokes no remote embedding service.

## Evidence and failure behavior

`.tddswarm/learning/index.json` remains the sealed canonical episode store, bounded to 200 records and 4 MiB. The vector database under `.tddswarm/learning/ruvector/` is a derived cache containing opaque episode IDs and vectors; its metadata contains digests and SDK/provider identity, without source snippets or query text. Each returned ID is joined to currently intact canonical records and the current framework filter. Removed episodes, incompatible frameworks, and corrupt canonical records cannot enter recall through a cached native result. Rejected evidence stays labeled as rejected. Source changes preserve historical examples with `sourceCompatible: false`; all results remain advisory.

Cache keys include eligible episode contents, dimensions, provider identity, SDK version, and wrapper digest. Database bytes are capped at 16 MiB and checked against sealed metadata before native loading. Cache paths reject symlink traversal. A missing SDK, native crash, timeout, invalid vectors, fabricated IDs, corruption, or empty native results returns deterministic lexical recall with an explicit fallback warning. A corrupt cache is retained for inspection; remove only the derived `ruvector` directory to rebuild it. The canonical memory is never repaired or rewritten by retrieval. Native calls run in a child process with a bounded timeout and SIGKILL; this limits failure impact but is not a security sandbox. Concurrent cache writers may also produce a safe fallback.

A successful result includes `retrieval: "ruvector"` and `retrievalDetails` with engine, actual mode, SDK version, and `built`/`reused`. Very small character budgets may omit SDK version/cache metadata while retaining engine, mode, and advisory labeling. Fallback uses `retrieval: "deterministic-lexical"`. Recall continues to honor caller limits and character budgets, including authority labeling.

## Reproduce the native proof

```sh
mkdir /tmp/testlore-ruvector-sdk
npm install --prefix /tmp/testlore-ruvector-sdk --no-audit --no-fund --save-exact @ruvector/core@0.1.32
node scripts/ruvector-proof.js --sdk-root /tmp/testlore-ruvector-sdk
node --test test/learning.test.js test/ruvector.test.js
```

The proof creates a disposable arithmetic project, stages and genuinely executes accepted and rejected candidates, recalls canonical memories through the real installed native package, and exercises the CLI, persistence, history, framework filtering, disable override, and corruption fallback. Its sanitized receipt is [benchmarks/ruvector-verification.json](../benchmarks/ruvector-verification.json). The pinned package's actual native binding requires `distanceMetric: "Cosine"`; `search().score` is cosine **distance**, so lower scores are converted to higher recall similarity. Protocol fixtures in unit tests do not substitute for the retained native proof. This controlled verification makes no generated-test quality or performance improvement claim.
