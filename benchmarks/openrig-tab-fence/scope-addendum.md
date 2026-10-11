# Frozen scope addendum — shipped Markdown resolver

Frozen before first script execution or any patch. The shipped loading-addressable-markdown resolve-markdown.mjs script exposes the same public section-selection contract. Apply the original specification.md opener/closer and LF/CRLF expectations to this reader as well. The original regression contract remains immutable. A daemon-only patch leaves this user-visible script defect unresolved. Preserve unrelated differences between readers. Regenerate recorded skill-edge digests according to upstream contribution instructions if changing the shipped script; do not edit unrelated skill content.

Expected real CLI behavior: with --root pointing at an isolated fixture directory, opener.md#sibling prints the actual sibling section and exits zero; closer.md#next prints the actual next section and exits zero. The frozen source currently claims these addresses missing. A normal fenced fixture clean.md#next must remain resolvable.
