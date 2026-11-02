// Builds the Claude Desktop extension (MCP Bundle): dist/factlot.mcpb
//   1. bundles the stdio MCP server (and all dependencies) into one file with esbuild
//   2. writes manifest.json from the tool catalog, so the listed tools never drift
//   3. validates and packs it with Anthropic's official `mcpb` CLI
// Run: npm run build:mcpb
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

import { SERVER_VERSION } from "@factlot/mcp";
import { tools } from "@factlot/tools";

const root = fileURLToPath(new URL("..", import.meta.url));
const stage = `${root}dist/mcpb/`;
rmSync(stage, { recursive: true, force: true });
mkdirSync(`${stage}server`, { recursive: true });

await build({
  entryPoints: [`${root}packages/mcp/src/bin.ts`],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  conditions: ["factlot-source"],
  outfile: `${stage}server/index.mjs`,
  banner: {
    js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
  },
  legalComments: "linked",
  logLevel: "warning",
});

const extra = [
  {
    name: "search",
    description:
      "Search FactLot's knowledge base (tools, inputs, CRE predicates, ID and fact specs).",
  },
  { name: "fetch", description: "Fetch a FactLot knowledge document by id." },
  {
    name: "schema_get",
    description: "Return the FactLot data model as JSON Schema.",
  },
];

const manifest = {
  manifest_version: "0.3",
  name: "factlot",
  display_name: "FactLot",
  version: SERVER_VERSION,
  description:
    "Deterministic commercial real estate calculators, canonical property IDs, and cited facts for Claude.",
  long_description:
    "FactLot gives Claude trusted tools for commercial real estate work: rent schedules, net effective rent, lease proposal comparison, CAM reconciliation with explicit cap methods, percentage rent, loan sizing, WALT, NPV, and IRR, each with a step-by-step audit trail and a versioned formula ID; canonical FactLot IDs for parcels, legal entities, suites, and documents; and validation of facts with source citations and AI-use rights. Everything runs locally on your computer: no account, no API key, and no data leaves your machine.",
  author: { name: "FactLot contributors", url: "https://factlot.com" },
  homepage: "https://factlot.com",
  documentation:
    "https://github.com/9mp96ygnbk-alt/factlot/blob/main/docs/agents.md",
  repository: { type: "git", url: "https://github.com/9mp96ygnbk-alt/factlot" },
  license: "Apache-2.0",
  keywords: [
    "commercial real estate",
    "CRE",
    "lease",
    "CAM",
    "underwriting",
    "net effective rent",
    "loan sizing",
  ],
  server: {
    type: "node",
    entry_point: "server/index.mjs",
    mcp_config: {
      command: "node",
      args: ["${__dirname}/server/index.mjs"],
      env: {},
    },
  },
  tools: [
    ...tools
      .filter((t) => !t.requires)
      .map((t) => ({ name: t.name, description: t.description })),
    ...extra,
  ],
  compatibility: {
    platforms: ["darwin", "win32", "linux"],
    runtimes: { node: ">=20.0.0" },
  },
};
writeFileSync(
  `${stage}manifest.json`,
  `${JSON.stringify(manifest, null, 2)}\n`,
);
writeFileSync(`${stage}LICENSE`, readFileSync(`${root}LICENSE`));

const mcpb = `${root}node_modules/.bin/mcpb`;
execFileSync(mcpb, ["validate", `${stage}manifest.json`], { stdio: "inherit" });
execFileSync(mcpb, ["pack", stage, `${root}dist/factlot.mcpb`], {
  stdio: "inherit",
});
console.log("built dist/factlot.mcpb");
