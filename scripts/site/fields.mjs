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

/** The two sentences llms.txt carries (both copies), and the coverage page's lead to its table. */
export const FIELDS_LEAD =
  "Fields differ by region: Los Angeles and San Francisco have no owner of record, for example.";
export const FIELDS_SENTENCES = `${FIELDS_LEAD} The share of parcels with each fact, and the roll years, per county: https://factlot.com/coverage/#fields and \`registry_coverage\`.`;

/** Short column headings, in fields.json's group order. */
export const SHORT = {
  owner_of_record: "Owner of record",
  owner_mailing_address: "Mailing address",
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

const pct = (share) => Math.min(99, Math.max(1, Math.round(share * 100)));

/** "yes" (every parcel, to the nearest half percent), "no", or "partial (64%)". */
export function cellText(share) {
  if (share <= 0) return "no";
  if (share >= 0.995) return "yes";
  return `partial (${pct(share)}%)`;
}

/** The groups of several counties together: parcels with the group over all their parcels. */
export function combinedShares(counties) {
  const total = counties.reduce((a, c) => a + c.parcels, 0);
  const out = {};
  for (const g of Object.keys(counties[0]?.groups ?? {})) {
    const n = counties.reduce((a, c) => a + c.groups[g].parcels, 0);
    out[g] = total ? n / total : 0;
  }
  return out;
}

const typeText = (types) =>
  types.length === 2
    ? "market and appraised value"
    : types[0] === "market"
      ? "market value only"
      : "appraised value only";

/**
 * The roll years of a county in words: "2026: market and appraised value; 2022 to 2025: market value only".
 * Consecutive years with the same value types are joined; a year that covers fewer than 90% of the county's
 * parcels says its share; a preliminary year says so.
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
        ? [`${pct(y.parcels / county.parcels)}% of parcels`]
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
  return runs
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
  const shares = combinedShares(counties);
  const has = [];
  const lacks = [];
  const part = [];
  // Prose drops a label's parenthesis ("building facts (area, ...)" reads "building facts").
  const word = (g) => labels[g].replace(/ \(.*\)$/, "");
  for (const [g, s] of Object.entries(shares)) {
    if (s <= 0) lacks.push(word(g));
    else if (s >= 0.995) has.push(word(g));
    else part.push(`${word(g)} (${pct(s)}%)`);
  }
  const holds = [
    ...(has.length ? [`${andList(has)} for every parcel`] : []),
    ...(part.length ? [`${andList(part)} for part of its parcels`] : []),
  ];
  const rolls = [...new Set(counties.map((c) => rollYearsText(c)))];
  const rollText =
    rolls.length === 1
      ? `Roll years held: ${rolls[0]}.`
      : `Roll years held differ by county; the table on the coverage page lists them.`;
  const owners =
    shares.owner_of_record > 0
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
          const t = cellText(c.groups[g].share);
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
<thead><tr><th scope="col">County</th><th scope="col">Parcels</th>${groups.map((g) => `<th scope="col">${esc(SHORT[g] ?? g)}</th>`).join("")}<th scope="col">Roll years held</th></tr></thead>
<tbody>
${rows}
</tbody>
</table></div>`;
}
