# Exact configuration filesystem inputs

TestLore can opt into one deliberately narrow, source-bound profile: a root Vitest configuration that performs `const value = realpathSync(tmpdir())`. The configuration bytes are approved by SHA-256; a fresh AST check must find exactly one named `node:fs` import and one direct, top-level constant call. Arbitrary reads, aliases, callbacks, extra filesystem imports, dynamic imports and recognized runtime operations retain rejection. This is not a general filesystem coverage or closed-world assertion.

```json
{
  "configurationInputs": [
    {
      "file": "vitest.config.ts",
      "kind": "canonical-temp-directory",
      "sourceSha256": "REPLACE_WITH_EXACT_CONFIGURATION_BYTE_SHA256"
    }
  ]
}
```

Fresh observations bind the original source digest, effective POSIX temporary-directory environment, requested path, canonical path, device and inode. Controller and native worker compare them before planning and execution and after execution. Only the already observed canonicalization of `TMPDIR` is permitted in the worker. A changed source, target, unresolved input, unexpected project environment or unsupported platform removes omission authority. Windows is currently unsupported. Directory contents are not observed: the admitted operation returns a path and does not read contents. Other configuration and test-closure warnings remain conservative.

The REA candidate campaign exposes this as `--configuration-inputs`, requiring an explicit candidate archive. This is a separate controlled profile; original upstream configuration, tests and lockfile bytes remain intact. Existing frozen negative campaigns remain unchanged. It does not solve unstable parameter display names, certify property inputs, or establish a speed advantage.

Vitest's [reporter lifecycle](https://vitest.dev/api/advanced/reporters.html) provides case metadata, but declaration locations and framework registration indices alone cannot prove equivalent parameterized inputs. Comparable REA cases still need independent registration-input evidence; raw names, seeds, statuses and original rejection reasons are retained until that evidence exists. fast-check's [configuration documentation](https://fast-check.dev/docs/configuration/) explains seed control; controlling a global seed is not proof of every external input.
