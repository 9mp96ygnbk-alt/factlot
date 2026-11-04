// Draft rules packs are not tools: the catalog serves verified rules only (docs/rules.md).
import assert from "node:assert/strict";
import test from "node:test";

import { draftRulePacks, rulePacks } from "@factlot/calc";

import { runTool, tools } from "./index.ts";

test("the catalog exposes verified rules packs only", () => {
  const ruleTools = tools.filter((t) => t.name.startsWith("rules_"));
  assert.deepEqual(
    ruleTools.map((t) => t.name).sort(),
    Object.keys(rulePacks)
      .map((n) => `rules_${n}`)
      .sort(),
  );
  for (const r of Object.values(rulePacks))
    assert.equal(r.verification.status, "verified", r.id);
  for (const name of Object.keys(draftRulePacks)) {
    assert.ok(!tools.some((t) => t.name.includes(name)), name);
    const out = runTool(`rules_${name}`, {});
    assert.equal(out.ok, false);
    assert.equal(!out.ok && out.error.error, "UnknownTool");
  }
});
