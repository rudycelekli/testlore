import assert from "node:assert/strict";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import path from "node:path";
const upstream = process.env.TESTLORE_PILOT_UPSTREAM;
if (!upstream) throw new Error("TESTLORE_PILOT_UPSTREAM must identify the pinned checkout");
const daemon = await import(pathToFileURL(path.join(upstream, "packages/daemon/src/domain/markdown-address.ts")).href);
const shipped = await import(pathToFileURL(path.join(upstream, "packages/daemon/assets/plugins/openrig-core/skills/loading-addressable-markdown/scripts/resolve-markdown.mjs")).href);
for (const [reader, api] of [["daemon", daemon], ["shipped", shipped]]) {
const { parseMarkdownSections, resolveAddress } = api;
for (const marker of ["```", "~~~"]) {
  for (const ending of ["\n", "\r\n"]) {
    test(`${reader}: tab-indented ${marker} opener keeps sibling address (${JSON.stringify(ending)})`, () => {
      const text = ["## Selected", "", `\t${marker}js`, "\tconst example = true;", "", "## Sibling", "reachable"].join(ending);
      assert.deepEqual(parseMarkdownSections(text).map(s => s.headerPath), [["selected"], ["sibling"]]);
      assert.match(resolveAddress(text, ["sibling"]).text, /reachable/);
      if ("validateMarkdownAddressability" in api) assert.deepEqual(api.validateMarkdownAddressability(text), []);
    });
    test(`${reader}: tab-indented ${marker} closer keeps example heading hidden (${JSON.stringify(ending)})`, () => {
      const text = ["## Actual", `${marker}md`, `\t${marker}`, "## Still example", marker, "## Next", "reachable"].join(ending);
      assert.deepEqual(parseMarkdownSections(text).map(s => s.headerPath), [["actual"], ["next"]]);
      assert.throws(() => resolveAddress(text, ["still-example"]));
      assert.match(resolveAddress(text, ["next"]).text, /reachable/);
      if ("validateMarkdownAddressability" in api) assert.deepEqual(api.validateMarkdownAddressability(text), []);
    });
  }
}
}
