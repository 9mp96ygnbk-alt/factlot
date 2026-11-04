// Usage: node run_ts.mjs CASES.json OUT.json   (requires `npm run build` first)
import { readFileSync, writeFileSync } from "node:fs";

import { calculators, rulePacks } from "../../packages/calc/dist/index.js";
import { runTool } from "../../packages/tools/dist/index.js";

const cases = JSON.parse(readFileSync(process.argv[2], "utf8"));
const results = cases.map((c) => {
  if (c.tool) {
    const o = runTool(c.tool, c.arguments);
    return o.ok
      ? { result: o.result }
      : { error: o.error.error, issues: o.error.issues.map((i) => i.path) };
  }
  try {
    return c.rule
      ? rulePacks[c.rule].run(c.input)
      : calculators[c.calc].run(c.input);
  } catch (e) {
    return { error: e.name };
  }
});
writeFileSync(process.argv[3], JSON.stringify(results));
