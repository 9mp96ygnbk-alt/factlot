// Writes packages/mcp/src/resource-data.ts: the data behind the MCP server's factlot:// resources and prompts
// that the published package cannot read from the repository at run time. Everything in it is copied from
// generated or reviewed files, never typed by hand:
//
//   hosted    site/_data/hosted.json (gen-hosted.ts, from the hosted pack's manifest)
//   markets   site/_data/markets.json (gen-markets.ts, from the registry files) with the page facts of
//             MARKETS in scripts/site/market-pages.mjs (name, ID system text, what each place does not hold)
//   sources   registry/sources/**/*.json, the reviewed source configs (licence, AI use, redistribution, ...)
//   roll_years  site/_data/texas-counties.json (gen-texas-counties.ts): the roll years of each hosted Texas county
//   id_spec   docs/id-spec.md
//   plans     deploy/cloudflare/src/plans.ts (allowances, prices, gating rules)
//
// gen-hosted.ts and gen-markets.ts run it after writing their data, so a data release refreshes it.
//
//   node --experimental-strip-types --conditions=factlot-source scripts/mcp/gen-resources.ts           (write)
//   node --experimental-strip-types --conditions=factlot-source scripts/mcp/gen-resources.ts --check   (fail if stale)
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  ANONYMOUS_REGISTRY_LOOKUPS_PER_DAY,
  ANONYMOUS_REQUESTS_PER_MINUTE,
  GATING_INFO,
  PLANS,
  PRICING_URL,
  PRO_YEARLY,
  QUOTA_RULES,
  REPORTS_PER_MONTH,
} from "../../deploy/cloudflare/src/plans.ts";
import type {
  ResourceData,
  SourceEntry,
} from "../../packages/mcp/src/resources.ts";
import { catalogSourceId } from "../../packages/mcp/src/source-ids.ts";
import { MARKETS } from "../site/market-pages.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
export const DATA_FILE = "packages/mcp/src/resource-data.ts";
const REPO = "https://github.com/9mp96ygnbk-alt/factlot/blob/main";

const readJson = (rel: string): unknown =>
  JSON.parse(readFileSync(join(root, rel), "utf8"));

/** HTML of the market page facts as plain text: a link keeps its address in brackets. */
function plain(html: string): string {
  return html
    .replace(/<a href="([^"]+)">([^<]*)<\/a>/g, "$2 ($1)")
    .replace(/<[^>]+>/g, "")
    .replaceAll("&quot;", '"')
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
}

const squash = (s: string) => s.replace(/\s+/g, " ").trim();

/** The credit line of a source's terms, read as scripts/registry/gen_coverage_docs.py reads it for rights.md. */
function attributionFromTerms(s: Record<string, unknown>): string | null {
  for (const field of ["redistribution", "license"]) {
    const t = typeof s[field] === "string" ? (s[field] as string) : "";
    let m = /[Aa]ttribution:\s*(.+?)(?:\s*$|;\s)/.exec(t);
    if (m) return squash(m[1]!).replace(/\.$/, "");
    m =
      /[Aa]ttribution(?: is)? not required[^;.]*[;.]?\s*(credit [^;.]*)?/.exec(
        t,
      );
    if (m) return `not required${m[1] ? `; ${squash(m[1])}` : ""}`;
    m = /([Cc]redit [^;.]+)/.exec(t);
    if (m && t.includes("ttribution")) return squash(m[1]!);
  }
  return null;
}

/** Order by UTF-16 code units, the same on every machine (localeCompare follows the ICU locale). */
const byCodeUnit = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

function configFiles(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...configFiles(p));
    else if (e.name.endsWith(".json")) out.push(p);
  }
  return out.sort();
}

function sources(
  hosted: ResourceData["hosted"],
  marketSources: Map<string, Record<string, unknown>>,
): SourceEntry[] {
  const dir = join(root, "registry/sources");
  const out: SourceEntry[] = [];
  for (const file of configFiles(dir)) {
    const rel = relative(dir, file);
    const state =
      rel === "texas.json" ? "TX" : rel.split("/")[0]!.toUpperCase();
    const config = JSON.parse(readFileSync(file, "utf8")) as {
      sources: Record<string, unknown>[];
    };
    for (const s of config.sources) {
      const id = String(s.source_id);
      const record = `docs/registry/sources/${id}.md`;
      const str = (k: string) =>
        typeof s[k] === "string" ? (s[k] as string) : null;
      out.push({
        source_id: id,
        state,
        publisher: String(s.publisher),
        status: s.verified ? "verified" : s.gate ? "gated" : "not verified",
        license: str("license"),
        ai_use: str("ai_use"),
        redistribution: str("redistribution"),
        attribution:
          str("attribution") ??
          (marketSources.get(id)?.attribution as string | null | undefined) ??
          attributionFromTerms(s),
        terms_url: str("terms_url"),
        reviewed: str("reviewed"),
        review_record: existsSync(join(root, record))
          ? `${REPO}/${record}`
          : `${REPO}/docs/registry/rights.md`,
        config: `${REPO}/${relative(root, file)}`,
        hosted_counties: [],
      });
    }
  }
  // A hosted county cites a source by its own id or a snapshot id extending it (tx-brazos-cad-2016).
  const ids = out.map((s) => s.source_id);
  for (const s of out)
    s.hosted_counties = hosted.counties
      .filter((c) =>
        c.sources.some((x) => catalogSourceId(ids, x) === s.source_id),
      )
      .map((c) => c.fips);
  return out.sort((a, b) =>
    a.state === b.state
      ? byCodeUnit(a.source_id, b.source_id)
      : byCodeUnit(a.state, b.state),
  );
}

/** The content of DATA_FILE's RESOURCE_DATA, from the files named at the top. */
export function resourceData(): ResourceData {
  const hosted = readJson("site/_data/hosted.json") as ResourceData["hosted"];
  const marketsJson = readJson("site/_data/markets.json") as {
    markets: Record<string, unknown>[];
  };
  const marketSources = new Map<string, Record<string, unknown>>();
  const markets = marketsJson.markets.map((d) => {
    const m = MARKETS.find((x) => x.slug === d.slug);
    if (!m) throw new Error(`markets.json: no MARKETS entry for ${d.slug}`);
    for (const s of d.sources as Record<string, unknown>[])
      marketSources.set(String(s.source_id), s);
    return {
      slug: m.slug,
      place: m.place,
      name: m.name,
      id_name: m.idName,
      id_text: plain(m.idText),
      entity: m.entity ?? null,
      limits: m.limits,
      notices: (m.notices ?? []).map(plain),
      id_system: String(d.id_system),
      sources: d.sources as ResourceData["markets"][number]["sources"],
      sample: d.sample as ResourceData["markets"][number]["sample"],
      holds: d.holds as ResourceData["markets"][number]["holds"],
    };
  });
  const texas = readJson("site/_data/texas-counties.json") as {
    counties: {
      county_fips: string;
      rolls: { tax_year: number; preliminary: boolean }[];
    }[];
  };
  const hostedFips = new Set(hosted.counties.map((c) => c.fips));
  return {
    hosted,
    roll_years: Object.fromEntries(
      texas.counties
        .map((c) => [
          `48${c.county_fips}`,
          c.rolls.map((r) => ({
            tax_year: r.tax_year,
            preliminary: r.preliminary,
          })),
        ])
        .filter(([fips]) => hostedFips.has(fips as string)),
    ),
    markets,
    sources: sources(hosted, marketSources),
    id_spec: readFileSync(join(root, "docs/id-spec.md"), "utf8"),
    plans: {
      pricing_url: PRICING_URL,
      free: {
        requests_per_minute: ANONYMOUS_REQUESTS_PER_MINUTE,
        registry_lookups_per_day: ANONYMOUS_REGISTRY_LOOKUPS_PER_DAY,
        reports_per_month: REPORTS_PER_MONTH.anonymous,
      },
      paid: Object.values(PLANS).map((p) => ({
        id: p.id,
        name: p.name,
        usd_per_month: p.monthlyCents / 100,
        ...(p.id === PRO_YEARLY.plan
          ? { usd_per_year: PRO_YEARLY.cents / 100 }
          : {}),
        requests_per_minute: p.requestsPerMinute,
        registry_lookups_per_month: p.registryLookupsPerMonth,
        keys: p.maxKeys,
        reports_per_month: REPORTS_PER_MONTH[p.id],
        summary: p.summary,
      })),
      gating: {
        free_history: GATING_INFO.free_history,
        batch: GATING_INFO.batch,
        dated_get: GATING_INFO.dated_get,
      },
      quota_rules: { ...QUOTA_RULES },
    },
  };
}

/** The text of DATA_FILE. */
export function resourceDataSource(data = resourceData()): string {
  return [
    "// Generated by scripts/mcp/gen-resources.ts from site/_data/hosted.json, markets.json, texas-counties.json,",
    "// registry/sources/**/*.json, docs/id-spec.md and deploy/cloudflare/src/plans.ts; do not edit.",
    'import type { ResourceData } from "./resources.ts";',
    "",
    `export const RESOURCE_DATA: ResourceData = ${JSON.stringify(data, null, 2)};`,
    "",
  ].join("\n");
}

/** Write DATA_FILE from the current data (gen-hosted.ts and gen-markets.ts call this too). */
export function writeResourceData(): void {
  writeFileSync(join(root, DATA_FILE), resourceDataSource());
  const r = spawnSync("npx", ["prettier", "--write", DATA_FILE], {
    cwd: root,
    stdio: ["ignore", "ignore", "inherit"],
  });
  if (r.status !== 0)
    throw new Error(
      `prettier could not format ${DATA_FILE} (${r.error?.message ?? `exit ${r.status}`}); the file is written but not formatted`,
    );
}

/** Whether DATA_FILE holds what the current data gives. */
export async function mcpDataCurrent(): Promise<boolean> {
  const { RESOURCE_DATA } =
    await import("../../packages/mcp/src/resource-data.ts");
  return JSON.stringify(RESOURCE_DATA) === JSON.stringify(resourceData());
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  if (process.argv.includes("--check")) {
    if (!(await mcpDataCurrent())) {
      console.error(
        `${DATA_FILE} is out of date: run scripts/mcp/gen-resources.ts`,
      );
      process.exit(1);
    }
  } else {
    writeResourceData();
    console.log(`wrote ${DATA_FILE}`);
  }
}
