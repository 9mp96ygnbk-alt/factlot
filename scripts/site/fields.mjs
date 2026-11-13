// What each hosted county has and lacks, in words and as a table, rendered from site/_data/fields.json (which
// scripts/site/gen-fields.ts computes from the registry files). The coverage page, the market pages and the Texas
// county pages call these, and site.test.ts calls the same functions, so no page states a field the data does not
// hold.

const esc = (s) =>
  String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
const int = new Intl.NumberFormat("en-US");

/**
 * What llms.txt says of field availability (both copies), and the coverage page's lead to its table. It points to the
 * coverage page, which holds the table whatever the hosted pack carries.
 */
export const FIELDS_LEAD =
  "Fields differ by county (Los Angeles and San Francisco have no owners).";
export const FIELDS_SENTENCES =
  "Fields differ by county (Los Angeles and San Francisco have no owners): shares and roll years at https://factlot.com/coverage/#fields.";

/** Short column headings, in fields.json's group order. */
export const SHORT = {
  owner_of_record: "Owner of record",
  owner_mailing_address: "Owner mailing address (organisations)",
  market_value: "Market value",
  appraised_value: "Appraised value",
  building_facts: "Building facts",
  neighborhood_and_class: "Neighborhood or class code",
  zoning: "Zoning",
  recorded_sales: "Recorded sales",
  deeds_and_mortgages: "Deeds, mortgages",
  energy_benchmarks: "Energy",
  entity_links: "Company registry link",
};

/** Sources whose roll years are each town's grand list year, so one county lists several. */
export const TOWN_LIST_SOURCES = new Set(["ct-parcel-cama-layer"]);

/** Missing parcels up to which a part is said as "all but N parcels" rather than a percentage. */
export const ALL_BUT_MAX = 10;

/**
 * How many of `total` parcels `n` is, for a part (0 < n < total): "all but 3 parcels", "<1%", "64%" or ">99%".
 * A non-zero part is never rounded to 0% or 1% from below, nor to 100%.
 */
export function partText(n, total) {
  const missing = total - n;
  if (missing <= ALL_BUT_MAX)
    return `all but ${missing} parcel${missing === 1 ? "" : "s"}`;
  const share = n / total;
  if (share < 0.01) return "<1%";
  const p = Math.round(share * 100);
  return p >= 100 ? ">99%" : `${p}%`;
}

/** "yes" only when every parcel has it, "no" when none does, else "partial (64%)" and the like. */
export function cellText(n, total) {
  if (n <= 0) return "no";
  if (n >= total) return "yes";
  return `partial (${partText(n, total)})`;
}

/** The groups of several counties together: parcels with the group, and all their parcels. */
export function combinedCounts(counties) {
  const total = counties.reduce((a, c) => a + c.parcels, 0);
  const out = {};
  for (const g of Object.keys(counties[0]?.groups ?? {}))
    out[g] = counties.reduce((a, c) => a + c.groups[g].parcels, 0);
  return { total, counts: out };
}

const typeText = (types) =>
  types.length === 2
    ? "market and appraised value"
    : types[0] === "market"
      ? "market value only"
      : "appraised value only";

/** Whether every roll year of a county comes from a town grand list source (Connecticut). */
export const townListYears = (county) =>
  county.roll_years.length > 0 &&
  county.roll_years.every((y) =>
    y.files.every((f) => TOWN_LIST_SOURCES.has(f.source_id)),
  );

/**
 * The roll years of a county in words: "2026: market and appraised value; 2022 to 2025: market value only".
 * Consecutive years with the same value types are joined; a year that fewer than 90% of the county's parcels have a
 * value for says how many do; a preliminary year says so. Town grand list years (Connecticut) say what they are.
 */
export function rollYearsText(county) {
  const years = county.roll_years;
  if (!years.length) return "no values";
  const items = years.map((y) => ({
    year: y.tax_year,
    text: typeText(y.value_types),
    note: [
      ...(y.preliminary ? ["preliminary roll"] : []),
      ...(y.parcels < 0.9 * county.parcels
        ? [`${partText(y.parcels, county.parcels)} of parcels`]
        : []),
    ].join(", "),
  }));
  const runs = [];
  for (const it of items) {
    const last = runs[runs.length - 1];
    if (
      last &&
      it.year !== null &&
      last.to !== null &&
      it.year === last.to - 1 &&
      it.text === last.text &&
      it.note === last.note &&
      !it.note
    )
      last.to = it.year;
    else
      runs.push({ from: it.year, to: it.year, text: it.text, note: it.note });
  }
  const text = runs
    .map((r) => {
      const span =
        r.from === null
          ? "no tax year in the file"
          : r.from === r.to
            ? String(r.from)
            : `${r.to} to ${r.from}`;
      return `${span}: ${r.text}${r.note ? ` (${r.note})` : ""}`;
    })
    .join("; ");
  return townListYears(county)
    ? `town grand list years, each town's own (towns in a county list different years): ${text}`
    : text;
}

/** "a or b", "a, b or c". */
const orList = (xs) =>
  xs.length <= 1
    ? (xs[0] ?? "")
    : `${xs.slice(0, -1).join(", ")} or ${xs[xs.length - 1]}`;

/** "a and b", "a, b and c". */
const andList = (xs) =>
  xs.length <= 1
    ? (xs[0] ?? "")
    : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`;

/**
 * One short paragraph (plain text) on what a place holds and lacks, from its counties' rows of fields.json, for a
 * market page or a Texas county page. `labels`: fields.json's group labels by key.
 */
export function placeFieldsText(name, counties, labels) {
  const { total, counts } = combinedCounts(counties);
  const has = [];
  const lacks = [];
  const part = [];
  // Prose drops a label's parenthesis ("building facts (area, ...)" reads "building facts").
  const word = (g) => labels[g].replace(/ \(.*\)$/, "");
  for (const [g, n] of Object.entries(counts)) {
    if (n <= 0) lacks.push(word(g));
    else if (n >= total) has.push(word(g));
    else part.push(`${word(g)} (${partText(n, total)})`);
  }
  const holds = [
    ...(has.length ? [`${andList(has)} for every parcel`] : []),
    ...(part.length ? [`${andList(part)} for part of its parcels`] : []),
  ];
  const rolls = [...new Set(counties.map((c) => rollYearsText(c)))];
  const rollText = counties.every(townListYears)
    ? "Roll years held: each is a town's grand list year, and towns in one county list different years; the table on the coverage page lists them."
    : rolls.length === 1
      ? `Roll years held: ${rolls[0]}.`
      : "Roll years held differ by county; the table on the coverage page lists them.";
  const owners =
    counts.owner_of_record > 0
      ? " Owners of record are kept for organisations only, so a parcel owned by a person shows none."
      : "";
  return [
    holds.length
      ? `${name} holds ${holds.join("; and ")}.`
      : `${name} holds no fact group beyond the parcel's identity and address.`,
    ...(lacks.length ? [`It holds no ${orList(lacks)}.`] : []),
    `${rollText}${owners}`,
  ].join(" ");
}

/** The coverage page's table: one row per hosted county, a column per fact group, and the roll years. */
export function hostedFieldsTable(data) {
  const groups = data.groups.map((g) => g.key);
  const rows = [...data.counties]
    .sort(
      (a, b) => a.state.localeCompare(b.state) || a.name.localeCompare(b.name),
    )
    .map((c) => {
      const cells = groups
        .map((g) => {
          const t = cellText(c.groups[g].parcels, c.parcels);
          const cls = t === "yes" ? "f-yes" : t === "no" ? "f-no" : "f-part";
          return `<td class="${cls}">${esc(t)}</td>`;
        })
        .join("");
      const name = `${esc(c.name)}, ${esc(c.state)}${c.area ? ` <span class="small">(${esc(c.area)} only)</span>` : ""}`;
      return `<tr><th scope="row">${name}</th><td>${int.format(c.parcels)}</td>${cells}<td class="small">${esc(rollYearsText(c))}</td></tr>`;
    })
    .join("\n");
  return `<div class="covscroll"><table class="covtable fieldtable">
<caption class="visually-hidden">Fact groups and roll years held for each hosted county</caption>
<thead><tr><th scope="col">County</th><th scope="col">Parcels</th>${groups.map((g) => `<th scope="col">${esc(SHORT[g] ?? g)}</th>`).join("")}<th scope="col">Roll years held (parcels with a value, where under 90%)</th></tr></thead>
<tbody>
${rows}
</tbody>
</table></div>`;
}
