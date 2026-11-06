// The landing page and llms.txt state tool counts and a release version by hand. These tests
// fail when either drifts from the tool catalog or the packages, so a new tool or a release
// cannot leave the site saying something untrue.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const root = new URL("../../", import.meta.url);
const read = (rel: string) => readFileSync(new URL(rel, root), "utf8");
const catalog = JSON.parse(read("spec/schemas/tools.json")) as
  { name: string }[] | { tools: { name: string }[] };
const tools = Array.isArray(catalog) ? catalog : catalog.tools;
const calculators = tools.filter((t) => t.name.startsWith("calc_")).length;
const version = (
  JSON.parse(read("packages/mcp/package.json")) as { version: string }
).version;

for (const file of ["site/index.html", "llms.txt", "site/llms.txt"]) {
  describe(file, () => {
    const text = read(file).replace(/\s+/g, " ");
    it(`states ${calculators} calculators wherever it counts them`, () => {
      const counts = [
        ...text.matchAll(/(\d+) (?:deterministic )?calculators/g),
      ].map((m) => Number(m[1]));
      assert.ok(counts.length > 0, "no calculator count found");
      assert.deepEqual([...new Set(counts)], [calculators]);
    });
    it(`links release v${version} only`, () => {
      const versions = new Set(
        [...text.matchAll(/releases\/download\/v(\d+\.\d+\.\d+)\//g)].map(
          (m) => m[1],
        ),
      );
      assert.deepEqual([...versions], versions.size ? [version] : []);
    });
  });
}

describe("site/llms.txt", () => {
  it("is a copy of llms.txt", () => {
    assert.equal(read("site/llms.txt"), read("llms.txt"));
  });
});
