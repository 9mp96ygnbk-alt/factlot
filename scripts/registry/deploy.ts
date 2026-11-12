/**
 * Deploy the factlot-registry Worker (deploy/registry) with a pack built by scripts/registry/pack.ts.
 *
 *   npm run deploy:registry -- <pack dir> [--dry-run]
 *
 * Refuses a missing or malformed pack, one over the Workers static-assets limits on the Workers Paid plan (100,000
 * files, 25 MiB each), or one that serves a county of hostedWithheldCounties().
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  PACK_FORMAT,
  PACK_MAX_FILES as MAX_FILES,
  PACK_MAX_FILE_BYTES as MAX_FILE_BYTES,
  type Manifest,
} from "../../deploy/registry/src/format.ts";
import { hostedWithheldCounties } from "../../packages/tools/src/registry.ts";

/** The files a pack holds: manifest, records, crosswalk, address and name indexes, candidate pools. */
const PACK_PATH =
  /^(manifest\.json|n\/df\.json|[gxan](\/[0-9a-z]+)*\/[0-9]+\.json|q\/[0-9]{5}-[0-9a-z]+(-[0-9]+)?\/(h|b[0-9]+|(all|g[0-9a-z]+)\/[rc][0-9]+)\.json)$/;

export function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

/**
 * Problems that make a pack directory unfit to deploy (empty when it is fine). `maxFiles`: the file-count cap
 * (default the static-assets limit; the object-storage backend has none and passes Infinity).
 */
export function packProblems(
  dir: string,
  o: { maxFiles?: number } = {},
): string[] {
  if (!existsSync(join(dir, "manifest.json")))
    return [
      `${dir} has no manifest.json: build the pack first (npm run pack:registry)`,
    ];
  const problems: string[] = [];
  const m = JSON.parse(
    readFileSync(join(dir, "manifest.json"), "utf8"),
  ) as Manifest;
  const files = walk(dir);
  const maxFiles = o.maxFiles ?? MAX_FILES;
  if (files.length > maxFiles)
    problems.push(
      `${files.length} files, more than the ${maxFiles} a Worker version may hold`,
    );
  for (const f of files) {
    const rel = relative(dir, f);
    if (statSync(f).size > MAX_FILE_BYTES)
      problems.push(`${rel} is over 25 MiB`);
    if (!PACK_PATH.test(rel)) problems.push(`${rel} is not a pack file`);
  }
  problems.push(...manifestProblems(m));
  for (let k = 0; k < m.dbs.length; k++)
    if (!existsSync(join(dir, "g", String(k))))
      problems.push(`records of ${m.dbs[k]!.name} are missing`);
  return problems;
}

/**
 * Problems of a pack's manifest alone: its format, and any county of hostedWithheldCounties() it serves or does not
 * record as withheld. The object-storage sync tool runs these again on the stored manifest before any pointer switch.
 */
export function manifestProblems(m: Manifest): string[] {
  const problems: string[] = [];
  if (m.format !== PACK_FORMAT)
    problems.push(`pack format ${m.format}, this Worker reads ${PACK_FORMAT}`);
  for (const fips of Object.keys(hostedWithheldCounties())) {
    const served =
      Object.hasOwn(m.counties, `us-${fips}`) ||
      Object.keys(m.prefixes).some((p) => p.endsWith(`:us-${fips}`));
    if (served)
      problems.push(
        `the pack serves county ${fips}, which the hosted registry withholds (hostedWithheldCounties); rebuild it`,
      );
    else if (!Object.hasOwn(m.withheld ?? {}, fips))
      problems.push(
        `the pack does not record county ${fips} as withheld; rebuild it with the current pack.ts`,
      );
  }
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
