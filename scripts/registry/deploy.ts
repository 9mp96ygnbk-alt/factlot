/**
 * Deploy the factlot-registry Worker (deploy/registry) with a pack built by scripts/registry/pack.ts.
 *
 *   npm run deploy:registry -- <pack dir> [--dry-run]
 *
 * Refuses a missing or malformed pack, or one over the Workers static-assets limits (20,000 files, 25 MiB each).
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  PACK_FORMAT,
  type Manifest,
} from "../../deploy/registry/src/format.ts";

const MAX_FILES = 20_000;
const MAX_FILE_BYTES = 25 * 1024 * 1024;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

/** Problems that make a pack directory unfit to deploy (empty when it is fine). */
export function packProblems(dir: string): string[] {
  if (!existsSync(join(dir, "manifest.json")))
    return [
      `${dir} has no manifest.json: build the pack first (npm run pack:registry)`,
    ];
  const problems: string[] = [];
  const m = JSON.parse(
    readFileSync(join(dir, "manifest.json"), "utf8"),
  ) as Manifest;
  if (m.format !== PACK_FORMAT)
    problems.push(`pack format ${m.format}, this Worker reads ${PACK_FORMAT}`);
  const files = walk(dir);
  if (files.length > MAX_FILES)
    problems.push(
      `${files.length} files, more than the ${MAX_FILES} a Worker version may hold`,
    );
  for (const f of files) {
    const rel = relative(dir, f);
    if (statSync(f).size > MAX_FILE_BYTES)
      problems.push(`${rel} is over 25 MiB`);
    if (!/^(manifest\.json|[gxan](\/[0-9a-z]+)*\/[0-9]+\.json)$/.test(rel))
      problems.push(`${rel} is not a pack file`);
  }
  for (let k = 0; k < m.dbs.length; k++)
    if (!existsSync(join(dir, "g", String(k))))
      problems.push(`records of ${m.dbs[k]!.name} are missing`);
  return problems;
}

function main(argv: string[]): void {
  const dryRun = argv.includes("--dry-run");
  const dir =
    argv.find((a) => !a.startsWith("--")) ?? process.env.FACTLOT_REGISTRY_PACK;
  if (!dir) {
    console.error("usage: npm run deploy:registry -- <pack dir> [--dry-run]");
    process.exit(2);
  }
  const pack = resolve(dir);
  const problems = packProblems(pack);
  if (problems.length) {
    console.error(
      `refusing to deploy ${pack}:\n  ${problems.slice(0, 20).join("\n  ")}`,
    );
    process.exit(1);
  }
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const args = [
    "-y",
    "wrangler@4",
    "deploy",
    "--config",
    join(root, "deploy/registry/wrangler.jsonc"),
    "--assets",
    pack,
    ...(dryRun
      ? [
          "--dry-run",
          "--outdir",
          join(root, "deploy/registry/.wrangler/dry-run"),
        ]
      : []),
  ];
  const r = spawnSync("npx", args, {
    stdio: "inherit",
    cwd: join(root, "deploy/registry"),
  });
  process.exit(r.status ?? 1);
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main(process.argv.slice(2));
