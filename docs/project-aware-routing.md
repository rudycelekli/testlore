# Fresh project routing and controlled replay

These changes are source candidates following the retained negative REA campaign. The npm `0.1.0` archive is unchanged. They do not establish general speed, better generation, learning gains, or superiority over another quality-engineering system.

## Routing contract

The fresh Vitest 4.1/5 context now observes the CLI-selected projects, their test memberships, setup inputs, isolation policy, and import resolutions. Repeated `--project` arguments retain native exact/glob/exclusion behavior. Resolution retains the union of possible paths across the selected projects; one project's failure to resolve an import remains uncertainty.

Project-specific setup inputs connect to their own test consumers. When a selected project's `isolate` is false, selection retains every test file in that project. The live execution worker checks that closure again before running. Every additional retained file reports `shared-project-isolation`, its project, and a selected peer. Unsupported runtimes, ambiguous file membership across projects, unknown plugins and incomplete dependencies retain conservative rejection or full fallback. File overlap is deliberately unqualified until native outcomes carry reliable project identities.

Executable configuration is evaluated fresh. The controller does not cache a running framework or configuration result. The new argv exception recognizes only the exact pure expression `process.argv.some(arg => arg.startsWith('literal'))`. Only inactive `--coverage` and `--shard=` queries can pass. Other prefixes, indexed/aliased/computed reads, side-effecting callbacks, active flags and observed intrinsic mutation reject the shared path. This restricted recognition is not a sandbox or a general proof about arbitrary executable configuration.

Native adversarial tests challenge independent setup regressions, alias changes, isolated and shared project groups, exact and glob project scopes, overlapping memberships, configuration changes, plugins and argv behavior. Their executable results must pass alongside the full source and browser scope before merge.

Native traversal starts from discovered tests, setup files, executable configuration and declared source dependencies. It avoids resolving unrelated repository sources through every selected project. Every source still receives syntax and uncertainty analysis. Runtime evidence enables broad source resolution because its extra dependency edges attach after graph construction. Declared sources remain separate from global configuration: adding a local contract does not make every test depend on it. No executable configuration or live resolver is cached between invocations.

## Separate property replay profile

`pilot` accepts an optional project-level declaration:

```json
{
  "propertyReplay": {
    "schemaVersion": 1,
    "seed": 104729,
    "originalConfig": "vitest.config.ts"
  }
}
```

This experimental profile writes a wrapper and a supported `fast-check.configureGlobal` setup only in disposable copies. The original tracked tests, configuration and dependency lock remain unchanged. The generated files and original configuration hashes enter the receipt and baseline commit. Existing global run budgets are retained; conflicting defaults, overlay collisions and unsupported setup sequencing reject the profile.

The wrapper changes the execution profile: it is not the original unmodified configuration campaign. Every arm retains its actual property-test title and seed. Explicit test seed overrides or missing expected property cases reject the comparison. Matching seeds do not certify every generated input, external entropy or unchanged test-local run budgets. Ordinary randomized testing remains separate.

The candidate REA workflow preregisters **104729, 130363 and 155921**, with three rotating full/TestLore/native repetitions per seed and the same independent source-reversion bug. Each seed publishes its own verdict, raw failures, omissions, fallback reasons and total timings. Successful evidence collection can retain a negative qualification; the workflow status is never a product-quality score. Candidate archive hashes and source revisions distinguish these runs from the immutable npm release.

## Evidence and promotion

The [original REA evidence](rea-public-qualification.md) remains frozen and rejected. New controlled results must be assessed independently; changing the measurement profile cannot retroactively qualify old trials. Improvements to routing need complete full/subset outcomes, retained skips and failures, fresh inputs and useful complete timings. A one-seed pass does not certify the three-seed campaign. See the [Agentic QE comparison and equal-scope experiment](agentic-qe-comparison.md) before making comparative claims.

The [first complete three-seed candidate measurement](../benchmarks/rea-projects-20261008/README.md) remains negative: all eighteen executions fell back to all 261 files, and TestLore was slower than native selection. Runtime filesystem access in configuration remains unresolved evidence. Matching property seeds did not eliminate schema-title drift. The follow-up traversal optimization must be evaluated separately; this archive records the pre-optimization candidate and never claims its timings for newer source.
