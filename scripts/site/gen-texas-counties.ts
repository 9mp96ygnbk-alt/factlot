// Writes site/_data/texas-counties.json: the figures on the /texas/<county>/ pages, for the Texas
// counties site/_data/hosted.json hosts, read from a built registry file (opened read-only) and from
// registry/sources. Only the small JSON
// is committed, never the database.
//
//   node --experimental-strip-types scripts/site/gen-texas-counties.ts /path/to/tx.db
//
// Run it after gen-hosted.ts has written hosted.json from the pack, then run gen-hosted.ts again
// (--text is not enough: the Texas order in hosted.json comes from this file).
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { writeResourceData } from "../mcp/gen-resources.ts";
import { TEXAS_ROLLS_FILES, renderTexasRolls } from "./texas-pages.mjs";

const dbPath = process.argv[2];
if (!dbPath) throw new Error("usage: gen-texas-counties.ts /path/to/tx.db");
const root = new URL("../../", import.meta.url);
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as {
  DatabaseSync: new (
    p: string,
    o: { readOnly: boolean },
  ) => {
    prepare(sql: string): { all(...a: unknown[]): Record<string, unknown>[] };
  };
};
const db = new DatabaseSync(dbPath, { readOnly: true });

// The hosted Texas counties are the pack's (site/_data/hosted.json, from its manifest; Tarrant is withheld
// there), largest first. Each one's roll source is its source without a year or "-buildings" suffix, and
// its ID system the crosswalk system its parcels carry in the registry file.
const hostedJson = JSON.parse(
  readFileSync(new URL("site/_data/hosted.json", root), "utf8"),
) as {
  counties: {
    fips: string;
    name: string;
    state: string;
    parcels: number;
    sources: string[];
  }[];
};
const HOSTED = hostedJson.counties
  .filter((c) => c.state === "TX")
  .sort((a, b) => b.parcels - a.parcels || a.name.localeCompare(b.name))
  .map((c) => {
    const name = c.name.replace(/ County$/, "");
    const sourceId = c.sources.find((s) => !/-(\d{4}|buildings)$/.test(s));
    if (!sourceId) throw new Error(`${c.name}: no roll source in hosted.json`);
    const system = String(
      db
        .prepare(
          "select system from crosswalk where urn glob ? group by system order by count(*) desc limit 1",
        )
        .all(`fl:parcel:us-${c.fips}:*`)[0]?.system ?? "",
    );
    if (!system) throw new Error(`${c.name}: no parcels in ${dbPath}`);
    return [
      name.toLowerCase().replace(/[^a-z]+/g, "-"),
      name,
      c.fips.slice(2),
      sourceId,
      system,
    ] as const;
  });

// registry/sources/texas.json holds the first counties; later ones have a file in tx/.
const readSources = (rel: string): Record<string, string>[] =>
  (
    JSON.parse(readFileSync(new URL(rel, root), "utf8")) as {
      sources: Record<string, string>[];
    }
  ).sources;
const texas = {
  sources: [
    ...readSources("registry/sources/texas.json"),
    ...readdirSync(new URL("registry/sources/tx/", root))
      .filter((f) => f.endsWith(".json"))
      .flatMap((f) => readSources(`registry/sources/tx/${f}`)),
  ],
};

const counties = HOSTED.map(([slug, name, fips, sourceId, system]) => {
  const src = texas.sources.find((s) => s.source_id === sourceId);
  if (!src) throw new Error(`no ${sourceId} in registry/sources`);
  const dbSrc = db
    .prepare("select url from sources where source_id = ?")
    .all(sourceId)[0];
  const hosted = Number(
    db
      .prepare("select count(*) n from crosswalk where system = ?")
      .all(system)[0]?.n,
  );
  // Current rolls, plus prior-year rolls loaded as value history only (Registry.ingest_value_history):
  // those write no coverage row, so their facts are never "current" and are counted from `facts`.
  const rolls = db
    .prepare(
      `select y, a, n from (
         select f.value_json y, f.as_of a, count(*) n from crosswalk c
         join current_facts f on f.subject = c.urn and f.predicate = 'parcel.tax_year'
         where c.system = ?1 group by 1, 2
         union all
         select f.value_json y, f.as_of a, count(*) n from crosswalk c
         join facts f on f.subject = c.urn and f.predicate = 'parcel.tax_year'
         where c.system = ?1 and f.document_id in (
           select document_id from snapshots where source_id glob ?2
           and document_id not in (select document_id from coverage))
         group by 1, 2
       ) order by 1, 2`,
    )
    .all(system, `${sourceId}-[0-9][0-9][0-9][0-9]`)
    .map((r) => {
      const tax_year = Number(r.y);
      const as_of = String(r.a);
      return {
        tax_year,
        as_of,
        parcels: Number(r.n),
        preliminary: tax_year > Number(as_of.slice(0, 4)),
      };
    });
  const nb = Number(
    db
      .prepare(
        `select count(*) n from crosswalk c join current_facts f on f.subject = c.urn
         and f.predicate = 'parcel.neighborhood_code' where c.system = ?`,
      )
      .all(system)[0]?.n,
  );
  const dataAsOf = String(
    db
      .prepare(
        `select max(f.as_of) a from crosswalk c join current_facts f on f.subject = c.urn
         and f.predicate = 'parcel.apn' where c.system = ?`,
      )
      .all(system)[0]?.a,
  );
  return {
    slug,
    name,
    county_fips: fips,
    source_id: sourceId,
    id_system: system,
    publisher: src.publisher,
    source_url: String(dbSrc?.url),
    terms_url: src.terms_url,
    license: src.license,
    ai_use: src.ai_use,
    redistribution: src.redistribution,
    terms_reviewed: src.reviewed,
    hosted_parcels: hosted,
    data_as_of: dataAsOf,
    rolls,
    neighborhood_code_parcels: nb,
    neighborhood_tier: nb > 0,
  };
});

const out = {
  about:
    "Figures for the /texas/<county>/ pages, generated by scripts/site/gen-texas-counties.ts from a built registry file and registry/sources.",
  total_hosted_parcels: counties.reduce((a, c) => a + c.hosted_parcels, 0),
  counties,
};
writeFileSync(
  new URL("site/_data/texas-counties.json", root),
  `${JSON.stringify(out, null, 2)}\n`,
);
console.log(counties.map((c) => `${c.slug} ${c.hosted_parcels}`).join(", "));

// README, the agent guide and llms.txt state the roll-year sentence (texas-pages.mjs texasRollsText).
for (const f of TEXAS_ROLLS_FILES) {
  const before = readFileSync(new URL(f, root), "utf8");
  const { text } = renderTexasRolls(before, counties);
  if (text !== before) writeFileSync(new URL(f, root), text);
}

// The MCP server's factlot:// resources carry these figures too (scripts/mcp/gen-resources.ts).
writeResourceData();
