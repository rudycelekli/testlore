# npm 0.1.0 release evidence

TestLore 0.1.0 is publicly available on [npm](https://www.npmjs.com/package/testlore/v/0.1.0), owned by `rudycelekli`. It remains an experimental alpha. The version is immutable; commands below pin it rather than relying on a moving channel.

```sh
npm exec --yes --package=testlore@0.1.0 -- testlore setup --verify --json
```

This configures the quality layer and executes the project's full native suite in shadow mode. Inspect the resulting report and generated files. Generation workers, optional SDKs and project services have separate prerequisites. For persistent project imports, including `testlore/playwright`, install `npm install --save-dev testlore@0.1.0`.

## Exact release identity

| Field | Recorded value |
| --- | --- |
| Source commit | `1f12728e325f13527b63f4023376debcb9270f8c` |
| Archive SHA-256 | `4fa6b36c17aeae3bf1e56f6100ce1ad73d69d6e498f9deb82f8001c32569806a` |
| Archive bytes | 334,643 |
| Qualified source inventory | 663 passing cases; zero skipped, failed, cancelled or todo; three required native Chromium cases |
| Source and archive qualification | [Hosted run 37761758668](https://github.com/rudycelekli/testlore/actions/runs/37761758668), with publication disabled |
| Requested channel | `alpha`; observed public tags also include `latest: 0.1.0` |
| Bootstrap authentication | Short-lived local credential; no OIDC or provenance attestation claimed |

[Original release candidate](../benchmarks/releases/0.1.0/release-candidate.json), [original archive installation proof](../benchmarks/releases/0.1.0/packed-proof.json), and [actual registry-byte verification](../benchmarks/releases/0.1.0/registry-proof.json) are retained independently. Original qualification receipts preserve their historical limitations; subsequent registry evidence does not rewrite them.

The registry briefly exposed only a `0.0.0-stage` placeholder while processing the upload. A later unauthenticated registry request returned 0.1.0; the downloaded SHA-256 and npm SHA-512 integrity match the sealed archive exactly. No second publication or replacement archive was submitted. No stage approval was performed by this verification.

## Fresh installation qualification

The [registry verification workflow](../.github/workflows/npm-registry-verification.yml) checks the immutable released source against permanently retained receipts. It downloads public registry bytes, requires the qualified archive hash, installs that archive production-only without lifecycle scripts, and exercises the installed CLI, MCP, shadow defect detection, mappings and isolated improvement branch. A separate clean project executes the documented npm command and requires two passing native cases, shadow mode and the exact source-pinned generated workflow.

The local fresh-install attempt was stopped when available disk crossed the retained 2 GiB reserve. Its result is not a successful installation claim. The [clean hosted verification run](https://github.com/rudycelekli/testlore/actions/runs/37779877055) passed. Its [fresh production installation](../benchmarks/releases/0.1.0/registry-production-install.json), [one-command shadow setup](../benchmarks/releases/0.1.0/one-command-setup.json) and [root-reviewed release record](../benchmarks/releases/0.1.0/release.json) are retained. The archive-install proof preserves its generic local-artifact limitation text; the separate registry download and hash receipts establish where those exact input bytes came from. These controlled checks establish installation behavior, not broad framework compatibility, performance superiority or production safety.

## Next release

Configure the protected `npm-alpha` GitHub environment and npm trusted publisher with direct publish permission before claiming OIDC publication. Setup requires account-level 2FA and a local interactive challenge. Each subsequent version needs a reviewed source/lockfile change, fresh exact-source qualification and independent registry verification. Never republish an existing version. [Operational steps](launch.md).
