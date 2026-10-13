# Independent development type-contract examples

Five seeded healthy/fault pairs show why ordinary runtime checks and static type checking complement each other. Each pair keeps the same native assertions, configuration and shared contracts; one TypeScript source differs. A separate project-reference fixture remains explicitly unsupported/unqualified.

These are original DEVELOPMENT examples. They are not untouched maintainer specifications, historical upstream bugs, learned repairs, or a gold-standard claim. Public export makes them inspectable; they must not be called future holdouts.

Use Node22.19.0 and the pinned original TypeScript6.0.3 installation. Every probe.mjs executes real top-level node:assert/strict checks: six positive assertions across five ordinary probes, plus one in the separate reference probe. Each runs unchanged against healthy and fault states. Runtime checks intentionally exercise partial ordinary inputs.

Read manifest.json for exact source hashes, diagnostic categories, original checker arguments and explicit reference limitations. Capture actual installed SDK closure and complete process costs during reproduction; no SDK is shipped here and the recorded closure checksum grants no authority.

Derived public manifest SHA256: b4130e918e9d6a91edace4eb46e7a227aff46c88212a07760a85ed90942f0b39
Original private frozen manifest SHA256: 16b34a7b750805b6c1b2b8b0988a7e2fd204ae5ce285c630f149111bd2b7b09c
