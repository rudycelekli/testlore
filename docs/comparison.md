# A reproducible routing comparison

TestLore caught every planted regression in this controlled dataset and executed fewer test callbacks. It was slower than the full suite on these tiny fixtures. The measurements support a bounded correctness result and a routing reduction; they do not prove that TestLore is the best testing system or that routing always saves time.

![Observed fault recall, callback execution file percentage, and median end-to-end time](../benchmarks/comparison/controlled-v1-2026-09-29-clarified/comparison.svg)

| Method | Observed failing-case recall | Files with test callbacks executed | Median end-to-end time |
| --- | ---: | ---: | ---: |
| Full native Node suite | 100% (63/63) | 100% (288/288) | 133 ms |
| TestLore routing | 100% (63/63) | 57.3% (165/288) | 559 ms |
| JS imports only, diagnostic | 42.9% (27/63) | 11.5% (33/288) | 2 ms |

The seven distinct regression scenarios were each repeated three times. Together they produced 63 failing-case observations, not 63 independent bugs. TestLore and the full suite detected all seven regression scenarios; the diagnostic detected two. Five control scenarios also contribute to the execution and timing denominators. No speedup is claimed: TestLore's median was about 4.2 times the full-suite median in this run.

## What was measured

`testlore-routing-controlled-v1` contains twelve deterministic changes across four fresh Node projects, each with eight test files. Each method actually executes its chosen tests. Failing-case recall compares observed case IDs with the failures from the changed project's full native suite. Selecting a file alone receives no correctness credit.

| Scenario | Project | Planted regression |
| --- | --- | --- |
| Leaf source comment | Modular imports | No |
| Leaf implementation defect | Modular imports | Yes |
| Shared dependency defect | Modular imports | Yes |
| Removed import, equivalent implementation | Modular imports | No |
| Paragraph metadata change | JSON asset contracts | No |
| Locale value defect | JSON asset contracts | Yes |
| Template value defect | JSON asset contracts | Yes |
| Previously unknown CSS input | Modular imports | No |
| Computed dynamic import defect | Runtime uncertainty | Yes |
| Deleted runtime JSON input | Runtime uncertainty | Yes |
| Node preload environment defect | Preloaded setup | Yes |
| Global routing configuration change | Modular imports | No |

The JSON project includes explicitly declared route input relationships. These declarations are setup assumptions. Its tests assert JSON values; they do not render a browser, validate paragraph appearance, or test CSS. The unknown CSS scenario verifies conservative routing, not CSS correctness.

Native Node has no dependency-based related-test selector, so its full suite is the native baseline here. The third method is a deliberately limited diagnostic implemented in the harness: it follows only literal relative JavaScript imports. It is not an existing competitor or a recommended production selector. Its low median includes real empty selections and missed regressions; that figure is not useful as a safe speed target. Separate [public repository benchmarks](public-benchmarks.md) compare supported native related-test selection where available.

The file percentage counts files whose test callbacks execute, including control scenarios. TestLore's native discovery probes still load all eight test modules on every invocation. Therefore the 42.7% callback-file reduction does not imply a matching reduction in module loading, process startup, or total cost. End-to-end timing includes discovery, Git and dependency planning, selected execution, and TestLore evidence retention. Baseline fixture preparation and installation are outside that interval for all methods.

## Reproduce and inspect

Use Node 22 or newer with JSON import attributes and Git. From a checkout with dependencies installed:

```sh
npm ci --ignore-scripts
node scripts/comparison-proof.js --output /tmp/testlore-comparison-new --repetitions 3
```

Choose a new output directory each time. The harness refuses an existing directory, retains raw trial reports as each method finishes, and removes only its own temporary fixture checkout. It first verifies every original suite passes, applies an exact mutation, rotates method order, clears run history before every measurement, and verifies the full suite detects each planted regression. Repetitions must be between one and nine. A TestLore miss or incomplete result makes the command fail.

The checked-in [clarified report](../benchmarks/comparison/controlled-v1-2026-09-29-clarified/comparison.json) records tool revision `48ebe5c4b93dc8b5ff19fcaea1aa0166cb441bb3`, Node `v22.19.0`, macOS arm64, and Apple M4 Pro. It contains the harness SHA-256, dataset SHA-256, method order, per-trial timing, observed failures, ground truth, misses, and links to raw argv, output, case outcomes, and provenance. [dataset.json](../benchmarks/comparison/controlled-v1-2026-09-29-clarified/dataset.json) preserves the exact fixtures and patches. Machine-specific paths are replaced with placeholders. The [report schema](../benchmarks/comparison/report.schema.json) describes the JSON contract.

The earlier [initial run](../benchmarks/comparison/controlled-v1-2026-09-29/comparison.json) is also retained. It reached the same correctness and callback-file counts, with medians of 135 ms full suite and 564 ms TestLore. The clarified run improves chart disclosures without discarding that receipt. Timestamps use UTC, so the September 29 local run is recorded as September 30 UTC.

## Limits of the claim

This is a constructed routing evaluation, not an independent community leaderboard. It measures neither agent generation quality, learning, persistent memory, LongMemEval performance, real browser regressions, external services, nor installation cost. The scenarios do not represent a population of all defects. Native discovery and planning overhead dominate these short test callbacks; larger suites with expensive callbacks need their own measured results before making an efficiency claim. Independent repositories, multiple runners, and additional planted or historical regressions are needed before a broader comparison.
