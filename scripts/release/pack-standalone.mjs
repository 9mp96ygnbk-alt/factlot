#!/usr/bin/env node
// Packs the stdio MCP server as one self-contained npm tarball with no dependencies, so it runs
// from a URL before (or without) the npm registry:
//
//   npx -y https://github.com/9mp96ygnbk-alt/factlot/releases/download/vX.Y.Z/factlot-mcp-standalone-X.Y.Z.tgz
//
// It reuses the esbuild bundle that `npm run build:mcpb` writes to dist/mcpb/server/index.mjs
// (the same file the Claude Desktop extension runs), so run that first.
//
//   node scripts/release/pack-standalone.mjs [out-dir]     (default: dist)
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const out = resolve(process.argv[2] ?? join(root, "dist"));
const bundle = join(root, "dist", "mcpb", "server", "index.mjs");
if (!existsSync(bundle)) {
  console.error(`error: ${bundle} not found; run npm run build:mcpb first`);
  process.exit(1);
}
const mcp = JSON.parse(
  readFileSync(join(root, "packages", "mcp", "package.json"), "utf8"),
);

const stage = join(root, "dist", "standalone");
rmSync(stage, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });
copyFileSync(bundle, join(stage, "index.mjs"));
chmodSync(join(stage, "index.mjs"), 0o755);
copyFileSync(join(root, "LICENSE"), join(stage, "LICENSE"));

const pkg = {
  name: "factlot-mcp-standalone",
  version: mcp.version,
  description: `${mcp.description} Self-contained build of @factlot/mcp ${mcp.version} with every dependency bundled.`,
  license: mcp.license,
  type: "module",
  engines: { node: ">=20" },
  repository: { ...mcp.repository },
  homepage: mcp.homepage,
  bin: { "factlot-mcp": "index.mjs" },
  files: ["index.mjs", "LICENSE", "README.md"],
};
writeFileSync(join(stage, "package.json"), `${JSON.stringify(pkg, null, 2)}\n`);
writeFileSync(
  join(stage, "README.md"),
  [
    `# factlot-mcp-standalone ${mcp.version}`,
    "",
    "The FactLot stdio MCP server (`@factlot/mcp`) in one file, with every dependency bundled.",
    "It is attached to each GitHub release so MCP clients can run it before the npm packages",
    "are published:",
    "",
    "```bash",
    `npx -y https://github.com/9mp96ygnbk-alt/factlot/releases/download/v${mcp.version}/factlot-mcp-standalone-${mcp.version}.tgz`,
    "```",
    "",
    "Source and documentation: https://github.com/9mp96ygnbk-alt/factlot",
    "",
  ].join("\n"),
);

mkdirSync(out, { recursive: true });
const file = execFileSync(
  "npm",
  ["pack", stage, "--pack-destination", out, "--silent"],
  { encoding: "utf8" },
).trim();
console.log(join(out, file));
