# Precise routing with conservative uncertainty

TestLore separates repository inventory from the graph that native tests can reach. Native Jest/Vitest imports resolve from discovered test files and configuration roots, then follow local transitive imports using one framework configuration/server. Unrelated lint tools and benchmark scripts do not enter that resolver queue. Every source is still inventoried and analyzed; no ignore pattern conceals an unknown input.

Each graph warning has an explicit scope:

- `global`: incomplete collection/configuration, unsupported native context, registration hooks, missing declarations, invalid package/compiler metadata, or a warning in configuration or an imported global helper. Active changes run the full suite.
- `test-closure`: an unknown edge in a test or a source reachable by that test. Every consumer of that uncertain source runs on **every active change**, including changes outside its known dependency paths. A dynamic loader therefore cannot make a hidden consumer omittable.
- `unreachable-source`: an unknown edge in source outside the known test/configuration closure. The warning remains visible but does not widen an independently mapped change. Changing that unmapped source still runs the full suite.

The plan exposes `uncertainty` counters/test lists and each retained test explains `uncertain-dependency-closure`. Existing baseline import edges remain included when a change removes an import. New, deleted, or unmapped inputs; package/lock/compiler changes; opaque global helpers; missing reports; stale observations; and unsupported project contexts retain their conservative fallback.

Native built-in Node/jsdom/happy-dom Vitest contexts resolve both client and SSR candidate edges. Arbitrary environments, Vitest project/workspace/browser contexts and `isolate: false` require full fallback until a complete native context graph is available. Configured setup files and their imported local helpers are global inputs, including setup names that do not contain “setup.” Node `--import`, `--require` and loader arguments are global configuration roots. Package boundaries do not hide a cross-package import: the transitive graph follows local resolved source across workspace directories; package/lock metadata changes remain global.

## Review-only mappings

`routingProposals(root)` returns bounded provenance-backed mapping candidates for existing literal filesystem paths and `new URL('./asset', import.meta.url)` calls in a reachable source. It does not write configuration. Candidates contain a proposed `dependencies` patch, source/test paths, and review limitations. Symlinks, paths outside the project, directories, missing paths and computed expressions are not proposed. A same-named function may be another API, and a literal call may be unreachable: accepting a proposal adds an edge, never certifies a closed world or clears runtime uncertainty.

Browser/runtime observations and declarations may add edges; observation alone never removes an uncertain static consumer. Selection works at test-file granularity and does not imply deployment safety or time savings. Full/subset execution and end-to-end timings must qualify each real repository before enabling selective CI execution.
