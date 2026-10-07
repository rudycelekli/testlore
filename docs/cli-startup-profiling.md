# Profile the complete CLI path

The CLI loads the requested command's implementation after parsing help, version
and options. Help and version avoid the analysis/compiler, provider, browser and
MCP graphs. Planning and execution still import their analysis and native runner
code; startup reduction alone does not establish an advantage over native
selectors. Public API exports in `src/index.js` remain unchanged.

Executable project configuration is evaluated through the existing fresh native
contexts. Source snapshots, Git discovery, service comparisons and full-suite
fallbacks retain their current authority. There is no cache of executable
configuration or of reviewed dependency closure.

`node scripts/cli-profile.js private-profile-settings.json` records complete
uninstrumented Node/CLI process spans and separate import, child-process and hash
diagnostics. Use an isolated project copy, a pinned Node executable on `PATH`,
and an immutable archived baseline. The output directory must not exist; raw
stdout, stderr, failures and timeouts are retained, with source identities before
and after the experiment. The controller never installs dependencies or removes
project caches.

Example private settings:

```json
{
  "entrypoints": [
    {"id": "baseline", "path": "/absolute/baseline/src/cli.js"},
    {"id": "candidate", "path": "/absolute/candidate/src/cli.js"}
  ],
  "root": "/absolute/disposable-project",
  "args": ["run", "--unified-native", "--shadow", "--base", "HEAD", "--json"],
  "repetitions": 5,
  "expectedExit": 1,
  "timeoutMs": 30000,
  "output": "/absolute/private-evidence/new-attempt"
}
```

Use the same arguments, runner flags, installed dependencies and project inputs
for both arms. Run quiet measurements sequentially after other qualification
workers stop. Each timing sample launches a fresh CLI; arm order rotates across
repetitions. State the initial analysis/history cache conditions explicitly.
The controller does not establish a fully cold OS or dependency cache.

Import diagnostics count actual loaded modules. Their hook spans measure source
loading, rather than total compilation or evaluation. Child-process spans include
native startup and work together; they do not isolate resolver startup. Reported
planning/execution phase timings are retained when the CLI returns JSON, but they
exclude costs covered only by the outer span. Hash diagnostics count parent
operations and bytes; child hashing is excluded. Instrumented probes are excluded
from timing samples.

`complete` means the expected process statuses and diagnostic traces were retained
and CLI source stayed stable. It is **not** a qualification verdict. Independently
seal the project inputs and installed dependencies, compare named full/subset
cases, and challenge mappings with genuine faults before crediting any speed
improvement. Publish unsuccessful attempts and native-selector comparisons too.
On POSIX the controller kills the disposable CLI process group after each arm,
including timed-out workers; Windows has no equivalent descendant guarantee.
