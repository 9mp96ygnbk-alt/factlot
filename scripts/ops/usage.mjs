#!/usr/bin/env node
// Prints yesterday's and the last seven days' usage of the hosted FactLot service (UTC days).
//
//   npm run ops:usage                       read the counters from the production KV namespace
//   npm run ops:usage -- --json             the same numbers as JSON
//   npm run ops:usage -- --fixture <dir>    read records (*.json) from a directory instead
//   npm run ops:usage -- --today 2026-11-12 pretend it is that UTC date
//   npm run ops:usage -- --namespace-id <id> read another KV namespace
//
// Credential: none of its own. It runs read-only `wrangler kv` commands (`key list`, `bulk get`)
// from deploy/cloudflare, so `npx wrangler login` must be done on this machine and the login
// needs the Workers KV permission (the standard `wrangler login` has it). It never writes.
// Set WRANGLER to use another wrangler command (default: npx --yes wrangler@4).
//
// The counters are written by the Worker only while USAGE_COUNTERS_ENABLED is "true"
// (deploy/cloudflare/README.md). Days with no record print "no data", not zero.
import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildReport,
  formatReport,
  parseRecords,
  windowDays,
} from "./usage-lib.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const worker = join(here, "../../deploy/cloudflare");
const PREFIX = "usage:v1:";

function args(argv) {
  const out = { json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--json") out.json = true;
    else if (["--fixture", "--today", "--namespace-id"].includes(a))
      out[a.slice(2)] = argv[++i];
    else throw new Error(`unknown argument: ${a}`);
  }
  return out;
}

/** The KEYS namespace id from wrangler.jsonc (comments stripped). */
export function namespaceId(text) {
  const m = /"binding"\s*:\s*"KEYS"\s*,\s*"id"\s*:\s*"([0-9a-f]{32})"/.exec(
    text.replace(/\/\/[^\n]*/g, ""),
  );
  return m?.[1];
}

function wrangler(rest) {
  const [cmd, ...pre] = (process.env.WRANGLER ?? "npx --yes wrangler@4").split(
    " ",
  );
  return execFileSync(cmd, [...pre, ...rest], {
    cwd: worker,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

/** The JSON document in wrangler's output (it may print warnings first). */
export function jsonOf(text) {
  const at = text.search(/^[[{]/m);
  return JSON.parse(at < 0 ? text : text.slice(at));
}

function fetchRecords(namespace, days) {
  const values = [];
  for (const day of days) {
    const listed = jsonOf(
      wrangler([
        "kv",
        "key",
        "list",
        "--remote",
        "--namespace-id",
        namespace,
        "--prefix",
        `${PREFIX}${day}:`,
      ]),
    );
    const names = listed.map((k) => k.name);
    for (let i = 0; i < names.length; i += 50) {
      const dir = mkdtempSync(join(tmpdir(), "factlot-usage-"));
      const file = join(dir, "keys.json");
      writeFileSync(file, JSON.stringify(names.slice(i, i + 50)));
      try {
        const got = jsonOf(
          wrangler([
            "kv",
            "bulk",
            "get",
            file,
            "--remote",
            "--namespace-id",
            namespace,
          ]),
        );
        for (const v of Object.values(got))
          if (typeof v === "string") values.push(v);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  }
  return parseRecords(values);
}

function fixtureRecords(dir) {
  return parseRecords(
    readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => readFileSync(join(dir, f), "utf8")),
  );
}

export function main(argv) {
  const a = args(argv);
  const today = a.today ?? new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today))
    throw new Error("--today must be YYYY-MM-DD");
  let records;
  if (a.fixture) records = fixtureRecords(a.fixture);
  else {
    const namespace =
      a["namespace-id"] ??
      namespaceId(readFileSync(join(worker, "wrangler.jsonc"), "utf8"));
    if (!namespace)
      throw new Error("no KEYS namespace id found; pass --namespace-id");
    records = fetchRecords(namespace, windowDays(today).week);
  }
  const report = buildReport(records, today);
  console.log(a.json ? JSON.stringify(report, null, 2) : formatReport(report));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    main(process.argv.slice(2));
  } catch (err) {
    console.error(`usage: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}
