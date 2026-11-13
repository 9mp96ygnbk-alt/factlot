// What the hosted registry serves, in words: the places, the totals and the llms.txt paragraph, rendered from
// site/_data/hosted.json (which scripts/site/gen-hosted.ts writes from a built pack's manifest). The pages and
// documents that state these hold them between markers, <!-- hosted:<id> --> ... <!-- /hosted:<id> -->, and
// llms.txt holds them as its line that starts "Hosted registry: ". gen-hosted.ts rewrites those spans and
// site.test.ts fails when one differs from the data, so no page states a hosted figure the pack does not hold.

const int = new Intl.NumberFormat("en-US");
const N = (n) => int.format(n);

const WORDS = [
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
  "thirteen",
  "fourteen",
  "fifteen",
  "sixteen",
  "seventeen",
  "eighteen",
  "nineteen",
  "twenty",
];
const word = (n) => WORDS[n] ?? String(n);
const txCounties = (n) => `${word(n)} Texas ${n === 1 ? "county" : "counties"}`;
/** Maryland has 24 county-level jurisdictions (23 counties and Baltimore City). */
const mdJurisdictions = (n) =>
  n === 24 ? "all 24 jurisdictions" : `${n} of its 24 jurisdictions`;

/** "a and b", "a, b and c" (names inside one place). */
export const andList = (xs) =>
  xs.length <= 1
    ? (xs[0] ?? "")
    : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`;
/** "a and b", "a, b, and c" (the places, as the pages list them). */
const serialList = (xs) =>
  xs.length <= 2
    ? andList(xs)
    : `${xs.slice(0, -1).join(", ")}, and ${xs[xs.length - 1]}`;

const bare = (name) => name.replace(/ County$/, "");

/** The served entities of a jurisdiction, and whether that is the registry's part that owns a hosted parcel. */
function entities(data, jurisdiction) {
  return data.entity_registries.find((r) => r.jurisdiction === jurisdiction);
}

function ownersOf(data, jurisdiction, registry) {
  const r = entities(data, jurisdiction);
  if (!r) return "";
  return r.total !== undefined
    ? `, and the ${N(r.entities)} ${registry} entities that own a hosted parcel`
    : `, and ${N(r.entities)} ${registry} entities`;
}

const NYC = {
  36005: "the Bronx",
  36047: "Brooklyn",
  36061: "Manhattan",
  36081: "Queens",
  36085: "Staten Island",
};

const TX_NOTE =
  "Denton and Williamson from 2027 preliminary rolls as of 2026-11-07; Midland has no values because its publisher's file has none";

/**
 * The places the hosted registry is described by, in the order the pages list them. A place takes the hosted
 * counties of a state (`state`) or the listed counties (`fips`); `label` names it in the llms.txt paragraph,
 * `short` on the pages, and `detail` says what it holds (numbers from the data, the rest from its sources'
 * terms and adapters). A hosted county no place takes is listed by its Census name.
 */
export const PLACES = [
  {
    key: "md",
    state: "24",
    label: () => "Maryland",
    short: (p) => `Maryland (${mdJurisdictions(p.counties.length)})`,
    detail: (p) =>
      `${mdJurisdictions(p.counties.length)}; ${N(p.parcels)} commercial parcels and ${N(p.buildings)} buildings from SDAT data as of ${p.as_of}, public domain`,
  },
  {
    key: "dc",
    state: "11",
    label: () => "the District of Columbia",
    short: () => "the District of Columbia",
    detail: (p, d) =>
      `${N(p.parcels)} commercial parcels, ${N(entities(d, "us-dc")?.entities ?? 0)} registered business entities and ${N(p.buildings)} buildings, with owners of record that are organisations, zoning and recorded sales; CC BY 4.0`,
  },
  {
    key: "ut",
    state: "49",
    label: (p) => `${andList(p.names.map(bare))} counties in Utah`,
    short: (p) => `${andList(p.names.map(bare))} counties in Utah`,
    detail: (p) =>
      `${N(p.parcels)} parcels, snapshot as of ${p.as_of}; CC BY 4.0, "State of Utah, SGID"`,
  },
  {
    key: "tx",
    state: "48",
    label: (p) => txCounties(p.counties.length),
    short: (p, d) =>
      `${txCounties(p.counties.length)} (${andList(texasNames(p, d))})`,
    detail: (p, d) => {
      const by = new Map(d.counties.map((c) => [bare(c.name), c]));
      const each = texasNames(p, d).map((n) => {
        const c = by.get(n);
        return c.buildings
          ? `${n} ${N(c.parcels)} with ${N(c.buildings)} buildings`
          : `${n} ${N(c.parcels)}`;
      });
      return `${N(p.parcels)} commercial parcels: ${andList(each)}; ${TX_NOTE}; value history by tax year, organisation owners only${ownersOf(d, "us-tx", "Texas Comptroller")}; \`registry_tx_equity_candidates\` and its batch form answer for these counties; appraisal-district rolls are public record with no licence stated, cited per fact with each source's rights`;
    },
  },
  {
    key: "nyc",
    fips: Object.keys(NYC),
    label: () => "New York City",
    short: (p) =>
      p.counties.length === 5
        ? "New York City (all five boroughs)"
        : `New York City (${andList(p.counties.map((f) => NYC[f]))})`,
    detail: (p, d) =>
      `${p.counties.length === 5 ? "all five boroughs" : andList(p.counties.map((f) => NYC[f]))}; ${N(p.parcels)} commercial parcels${p.buildings ? ` and ${N(p.buildings)} buildings` : ""} from the Department of Finance final assessment roll as of ${p.as_of}, public record with no restrictions on use, with owners of record that are organisations${ownersOf(d, "us-ny", "New York Department of State")}`,
  },
  {
    key: "la",
    fips: ["06037"],
    label: () => "Los Angeles County",
    short: () => "Los Angeles County",
    detail: (p) =>
      `${N(p.parcels)} commercial parcels from the Assessor's parcel data roll as of ${p.as_of}; no owner names, which the public file does not carry; the County's open-data terms allow commercial use`,
  },
  {
    key: "sf",
    fips: ["06075"],
    label: () => "San Francisco",
    short: () => "San Francisco",
    detail: (p) =>
      `${N(p.parcels)} commercial parcels from the Assessor's secured roll (the 2025 roll year, the latest published; file as of ${p.as_of}); no owner names, which the public file does not carry; public domain (PDDL)`,
  },
  {
    key: "boston",
    fips: ["25025"],
    label: () => "the City of Boston",
    short: () => "the City of Boston",
    detail: (p) =>
      `the City of Boston only, not Chelsea, Revere or Winthrop, the rest of Suffolk County; ${N(p.parcels)} commercial parcels from the Assessing Department's fiscal-year 2026 file, with values as of ${p.as_of}, older than the other regions; public domain (ODC-PDDL)`,
  },
  {
    key: "denver",
    fips: ["08031"],
    label: () => "Denver",
    short: () => "Denver",
    detail: (p, d) =>
      `${N(p.parcels)} commercial parcels from the Assessor's file as of ${p.as_of}; CC BY 3.0, "City and County of Denver"${ownersOf(d, "us-co", "Colorado Secretary of State")}`,
  },
  {
    key: "ct",
    state: "09",
    label: () => "Connecticut",
    short: () => "Connecticut (statewide, by town)",
    detail: (p, d) =>
      `${N(p.parcels)} commercial parcels in ${word(p.counties.length)} former counties, from the towns' grand lists in the statewide parcel and CAMA layer as of ${p.as_of}; CC0${ownersOf(d, "us-ct", "Connecticut Secretary of the State")}`,
  },
];

function texasNames(p, d) {
  const hosted = new Set(
    d.counties
      .filter((c) => p.counties.includes(c.fips))
      .map((c) => bare(c.name)),
  );
  const order = (d.texas_order ?? []).filter((n) => hosted.has(n));
  return [...order, ...[...hosted].filter((n) => !order.includes(n)).sort()];
}

/**
 * The hosted counties grouped into PLACES (and one place per county no place takes), each with its counties,
 * names, parcels, buildings and latest source date. `counties`: [{fips, name, state, parcels, buildings, as_of}].
 */
export function groupPlaces(counties) {
  const left = new Map(counties.map((c) => [c.fips, c]));
  const out = [];
  const take = (key, list) => {
    if (!list.length) return;
    for (const c of list) left.delete(c.fips);
    out.push({
      key,
      counties: list.map((c) => c.fips),
      names: list.map((c) => c.name),
      parcels: list.reduce((a, c) => a + c.parcels, 0),
      buildings: list.reduce((a, c) => a + c.buildings, 0),
      as_of: list.reduce((a, c) => (c.as_of > a ? c.as_of : a), ""),
    });
  };
  for (const p of PLACES)
    take(
      p.key,
      [...left.values()].filter((c) =>
        p.state ? c.fips.startsWith(p.state) : p.fips.includes(c.fips),
      ),
    );
  for (const c of [...left.values()]) take(`county-${c.fips}`, [c]);
  return out;
}

const config = (p) =>
  PLACES.find((x) => x.key === p.key) ?? {
    label: () => `${p.names[0]}, ${p.state}`,
    short: () => `${p.names[0]}, ${p.state}`,
    detail: (q) => `${N(q.parcels)} commercial parcels as of ${q.as_of}`,
  };

/** The name of a place (a `places` entry of the data) as the llms.txt paragraph gives it, for example "Maryland" or "sixteen Texas counties". */
export const placeLabel = (data, p) =>
  config({ ...p, state: stateOf(data, p) }).label(p, data);

/** "Maryland (all 24 jurisdictions), the District of Columbia, ..., and sixteen Texas counties (Harris, ...)". */
export function placesText(data) {
  return serialList(
    data.places.map((p) =>
      config({ ...p, state: stateOf(data, p) }).short(p, data),
    ),
  );
}

const stateOf = (data, p) =>
  data.counties.find((c) => c.fips === p.counties[0])?.state ?? "";

/** "434,538 parcels in 43 counties". */
export function totalsText(data) {
  return `${N(data.totals.parcels)} parcels in ${data.totals.counties} counties`;
}

/** "Tarrant County is not served by the hosted registry while ...", or "" when nothing is withheld. */
export function withheldText(data) {
  if (!data.withheld.length) return "";
  return `${andList(data.withheld.map((w) => w.name))} ${data.withheld.length === 1 ? "is" : "are"} not served by the hosted registry while the publisher's terms for AI use are unclear.`;
}

/** The llms.txt line that starts "Hosted registry: ". */
export function llmsHostedLine(data, freeLookupsPerDay) {
  const places = andList(
    data.places.map((p) => {
      const c = config({ ...p, state: stateOf(data, p) });
      return `${c.label(p, data)} (${c.detail(p, data)})`;
    }),
  );
  const withheld = withheldText(data);
  return (
    `Hosted registry: the hosted API answers the \`registry_*\` tools for ${places}: ${totalsText(data)}, on every plan including the free tier (${freeLookupsPerDay} lookups a day per IP address). ` +
    "Call `registry_coverage` first to see exactly what is hosted. Every answer cites its source file and licence or attribution. " +
    "Other regions in the project's pipeline run only on a self-hosted FactLot with a registry file; more hosted regions open as their terms allow." +
    (withheld ? ` ${withheld}` : "")
  );
}

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/** A markdown table of the hosted places: what each holds, from the same details the llms.txt paragraph uses. */
export function tableText(data) {
  const rows = data.places.map((p) => {
    const c = config({ ...p, state: stateOf(data, p) });
    return `| ${cap(c.label(p, data))} | ${cap(c.detail(p, data))} |`;
  });
  return `\n\n| Region | Hosted data |\n| --- | --- |\n${rows.join("\n")}\n\n`;
}

/** The text of each marked span: <!-- hosted:<id> -->text<!-- /hosted:<id> -->. */
export function blockText(id, data) {
  switch (id) {
    case "places":
      return placesText(data);
    case "totals":
      return totalsText(data);
    case "table":
      return tableText(data);
    case "parcels":
      return N(data.totals.parcels);
    case "counties":
      return String(data.totals.counties);
    case "texas-counties":
      return String(
        data.counties.filter((c) => c.fips.startsWith("48")).length,
      );
    case "withheld":
      return withheldText(data);
  }
  throw new Error(`no hosted text named "${id}"`);
}

/** Files that state what is hosted; each holds marked spans, and the llms.txt files their "Hosted registry" line. */
export const HOSTED_FILES = [
  "site/index.html",
  "site/_content/coverage.html",
  "site/_content/mcp.html",
  "site/_content/try.html",
  "README.md",
  "docs/getting-started.md",
  "docs/agents.md",
  "docs/registry/README.md",
  "connectors/README.md",
  "llms.txt",
  "site/llms.txt",
];

// Whitespace and the dash runs of a markdown table's rule row (prettier pads them) are the formatter's.
const flat = (s) => s.replace(/\s+/g, " ").replace(/-{3,}/g, "---").trim();

const BLOCK = /<!-- hosted:([a-z-]+) -->([\s\S]*?)<!-- \/hosted:\1 -->/g;
const LLMS = /^Hosted registry: .*$/m;

/**
 * A file's text with its hosted spans (and llms.txt line) rendered from `data`; `found` counts what was
 * replaced. Whitespace inside a span is the renderer's, so run prettier after writing an HTML file.
 */
export function renderHosted(text, data, freeLookupsPerDay) {
  let found = 0;
  let out = text.replace(BLOCK, (m, id, inner) => {
    found += 1;
    const want = blockText(id, data);
    // Keep a span that already says it (prettier may have wrapped it).
    return flat(inner) === flat(want)
      ? m
      : `<!-- hosted:${id} -->${want}<!-- /hosted:${id} -->`;
  });
  if (LLMS.test(out)) {
    found += 1;
    out = out.replace(LLMS, () => llmsHostedLine(data, freeLookupsPerDay));
  }
  return { text: out, found };
}

/** The spans of a file that do not say what `data` says (whitespace aside), as "id: file text". */
export function hostedDifferences(text, data, freeLookupsPerDay) {
  const bad = [];
  for (const [, id, inner] of text.matchAll(BLOCK))
    if (flat(inner) !== flat(blockText(id, data)))
      bad.push(`${id}: ${flat(inner)}`);
  const line = LLMS.exec(text)?.[0];
  if (line !== undefined && line !== llmsHostedLine(data, freeLookupsPerDay))
    bad.push(`llms line: ${line.slice(0, 120)}...`);
  return bad;
}
