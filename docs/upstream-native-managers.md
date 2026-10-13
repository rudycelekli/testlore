# Genuine package-manager qualification

TestLore's explicit public-corpus installer uses the package manager pinned by the upstream `package.json`, an isolated npm bootstrap cache, the original frozen lockfile and native lifecycle defaults. It does not replace an upstream installation with TestLore's own dependencies.

Older pnpm packages declare a JavaScript executable. pnpm 12.3.4 declares a native executable named `pnpm`. Assuming `bin/pnpm.cjs` prevented the genuine unimport installation from starting. The installer now resolves the exact pinned package's `bin.pnpm` declaration, rejects ambiguous or escaping entries, and distinguishes Node entry points from bounded executable ELF/Mach-O binaries. It runs the resolved entry's version command and binds its bytes, mode and package manifest before and after installation and final dependency inventory. Native managers are bounded to 128 MiB; other public runtime identities retain their existing 2 MiB bound.

The installer also checks the actual cloned checkout before bootstrapping. A partial Git clone may lack historical blobs even when the source has the needed current revision. An incomplete checkout cannot continue into qualification.

Reproduce the constructed compatibility controls:

```sh
node scripts/upstream-manager-proof.js --output .tddswarm/new-manager-proof
```

This explicitly installs pinned pnpm 10.33.0 and 12.3.4 into private caches, executes their actual frozen installations on small dependency-free fixtures, observes a real project lifecycle script and runs an independent native assertion. It retains raw bootstrap, direct version, installation and native-test receipts. These fixtures qualify installer compatibility, not upstream applications or package-manager security. POSIX is the supported native profile; Windows remains unsupported. Metadata, hashes and version output are not cryptographic package provenance or a complete transitive runtime attestation.

## Observed historical application replay

The [bounded recorded measurements](../benchmarks/type-history/unimport-0efa812/replay.json) retain source/SDK/configuration hashes, transport hashes, repeat outcomes, reported runtime totals and rejected claims. They are recorded observations, not a standalone authentication token or complete reproduction of the original installation.

A local isolated replay used [unimport's genuine typecheck fix](https://github.com/unjs/unimport/commit/0efa8122b4cff4af044ddfd77dd6522d21bcfee1), restoring exactly the prior bytes of `src/detect-acorn.ts` while retaining the fixed revision's configuration and tests. The fix adds an optional `id` parameter; its parent is `fdf98b5aef3c2f6d5a6519d5dbb69631347b62fb`.

Both source states passed all **252 reported native Vitest assertions** in one full run per state. In two compiler repeats per state, the owner `vue-tsc --noEmit` and standalone installed TypeScript passed the fixed state and reported **TS2554** for the prior state. TestLore checked **75 implementation files**, passed the fixed state and preserved the same type failure in both prior exposures. The native file/name/status multisets match across states, but repeated parser cases produce only 235 distinct keys. This does not qualify unique parameter identities or authorize routing omissions. This is a real historical complementary-detection example; the owner already had a compiler check that detects it. It establishes no newly discovered bug, superiority, routing speed advantage or learning gain.

The attempted fresh pinned installation was stopped at the unchanged 450 MiB disk-growth limit. That failure remains unqualified. The historical replay relocated an existing complete dependency tree with the same original upstream lock/workspace bytes into a separate checkout; it is **not a fresh original-installation qualification**. Native Vitest changed its `.vite` result cache between states; the compiler inputs and cache changes are separately bound and retained. Excluded fixtures, declared `skipLibCheck`, framework-specific inputs and package-manager workspace links remain scope limitations.

A prior experiment nested under a home directory encountered an actual ancestor `node_modules` package during TypeScript resolution. TestLore refused that external closure. Relocating the checkout removed that ambient lookup; this does not justify reading or trusting arbitrary external dependencies. Full upstream installation, workspace-aware dependency inventory and routing qualification remain separate next steps.
