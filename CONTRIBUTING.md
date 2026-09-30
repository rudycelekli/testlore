# Contributing

Thanks for helping make test decisions understandable.

```sh
npm ci --ignore-scripts
npm test
npm run check
npm run demo
npm run benchmark
```

Use Node.js 22.19+; CI also exercises Node 24. For a selector bug, include a tiny repository, the exact base SHA, changed files, configuration, expected test set, and `tddswarm plan --json`. A deterministic regression that the full suite catches and the selected suite misses is especially valuable.

Tests should exercise observable behavior and meaningful failures. Add a minimal regression for a missed dependency or incorrect exit status. Do not improve a benchmark by shrinking its correctness scope, omitting failures, or relabeling synthetic outcomes as production results.

Real-tool quality and synthetic held-out controls run in CI. Public benchmarks pin upstream commits and retain native baselines, misses and overhead; live model proofs require an authenticated local worker and are optional.

Keep analysis and routing local and deterministic. Agent integrations must disclose context handling and cost controls, implement the JSON protocol, and preserve candidate review. Do not add telemetry by default.

Small focused pull requests are easiest to review. Discuss runner discovery, evidence formats, and new dependencies in an issue first when they change the public contract. Contributors retain copyright to their work and submit contributions under the MIT license.
