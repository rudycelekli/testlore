# Historical correctness recipe transfer

This experiment turns three real public historical correctness changes into small, executable recipes. It then replays compatible contracts against pinned public modules from other repositories. An incompatible direct fork is retained as an explicit abstention control.

The result is **three reproduced historical failures, three passing fixed revisions, and no newly demonstrated target defect**. It establishes that these recipes execute and that the experiment can retain a clean result. It does not establish better AI repairs, learning effectiveness, general transfer, or a runtime advantage.

Run from a TestLore source checkout with its supported Node runtime:

```sh
node scripts/bug-transfer-proof.js run .tddswarm/my-transfer-proof
node scripts/bug-transfer-proof.js verify .tddswarm/my-transfer-proof
node --test test/bug-transfer-proof.test.js
```

The replay has no downloads, package installation, model calls or network calls. Source bytes, prospective expected outputs, module format/import adapters, and dependency files are included in [the frozen dataset](correctness-20261011/manifest.json). The verifier repeats execution and checks actual named observations against the recorded evidence. VM restrictions and Node filesystem permissions are limited execution controls, not an operating-system sandbox.

| Recipe | Historical source | Current target | Observed result |
| --- | --- | --- | --- |
| Reject whitespace as a number | [`is-number` issue #3 fix](https://github.com/jonschlinkert/is-number/commit/12749e3c411750f754d50f093471234c7ab270b0) | `validatorjs/validator.js` string numeric classification | Original mismatches; fixed passes. Target recipe probes and ordinary probes both pass. |
| Preserve literal plus signs | [`decode-uri-component` correction](https://github.com/SamVerschueren/decode-uri-component/commit/3bbc879717a58efa9d1173b3d701e6f731ec0de4) | `pillarjs/encodeurl` safe ASCII plus preservation | Original mismatches; fixed passes. Target recipe probes and ordinary probes both pass. Encoder/decoder overlap is limited to these literal-plus cases. |
| Reset Unicode decoding after an invalid sequence | [`safe-decode-uri-component` correction](https://github.com/jridgewell/safe-decode-uri-component/commit/641dec384f134062c0f85898569f4d4117e6350d) | `delvedor/fast-decode-uri-component` | Original mismatches; fixed passes. Transfer abstains: the target has direct fork ancestry and intentionally returns `null` for invalid escapes. Three ordinary valid-input control cases pass. |

Each comparable target arm executes three cases twice under the same 3,000 ms per-subprocess limit, without retries. The guided and ordinary arms each execute 12 comparable named cases in total. Six additional executions are excluded-target controls and are reported separately. Qualification includes 36 historical named case executions. The ordinary arm is a deterministic prospective set of common inputs, **not an AI-agent comparator**.

Specifications were frozen before the first execution and are unchanged: SHA-256 `e211f2279175b4cba22e40879e2ad3f71195b54fe7bdf2d712f35dd344f683f0`. Cases were constructed by the independent evaluator owner using documented behavior; they are not untouched maintainer suites or private holdouts. They are now observed evaluation data and must not be reused as unseen data after further tuning.

The [catalog](correctness-20261011/catalog.json) contains declaration and qualification references suitable for manual review. Historical module qualification grants no repair, routing-omission or learning-promotion authority. Users must establish the current module's own contract before executing a transferred recipe. A different repository name does not establish independent ancestry, and a similar function name does not establish compatible semantics.

Public upstream bytes and their licenses are archived for reproducibility. `is-number` requires `kind-of@3.0.2` and `is-buffer@1.1.4`; the exact captured dependency bytes are pinned. Its runtime adapter rewrites only those two bare imports to the explicit local closure. Other CommonJS files are renamed without implementation edits. Validator source files remain byte-identical, with an explicit ESM format manifest. Full native upstream suites were not installed or executed.

[Recorded proof and raw observations](correctness-20261011/run/proof.json) include hashes, actual output values, named results, environment and complete replay timing. No fresh defect, maintainer acceptance, autonomous repair, model cost, or causal improvement is claimed. The next useful evidence is a genuinely unrelated application with independently demonstrated failure-before/fix-after outcomes, followed by a protected matched-budget agent comparison.
