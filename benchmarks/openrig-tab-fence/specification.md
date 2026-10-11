# Frozen independent contract — tab-indented Markdown marker lines

Frozen before any candidate patch or repair agent. Author: separate investigator.

OpenRig addressable Markdown resolution must retain actual H2/H3 sections after an indented code example. CommonMark 0.31.2 section 2.2 gives tabs four-column indentation stops; section 4.5 permits code fences only through three columns of indentation. A marker line beginning with a tab at column zero is thus indented code, not a fence opener or closer.

Sources:
- https://spec.commonmark.org/0.31.2/#tabs
- https://spec.commonmark.org/0.31.2/#fenced-code-blocks
- Upstream module: headers inside code fences never become addresses or terminate spans; missing real address fails composition.
- Existing maintainer indentation tests explicitly keep four-space code examples from becoming addresses.

Expected behavior:
1. With either backtick or tilde markers, an indented code example containing a marker line beginning with a tab must leave a following unindented `## Sibling` address resolvable; parsed section paths are selected, sibling; validator has no unterminated fence.
2. Within a real fenced example, a tab-indented matching marker line must not terminate the block. Example headings remain non-addressable until a legal closing fence; parsed section paths are actual, next; validator has no unterminated fence.
3. Both LF and CRLF line endings preserve these results.

Preserve existing cases and the public address grammar. No new dependencies needed. This specification makes no general CommonMark conformance claim. Full native suite and duplicate review are still prerequisites for submission qualification.
