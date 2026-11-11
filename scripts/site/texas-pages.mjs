// Pure renderers for the /texas/<county>/ and /texas/<county>/example/ pages. They take the
// committed data (site/_data/texas-counties.json, texas-examples.json) and the fragments in
// site/_content, and return the page body. build.mjs writes the pages; site.test.ts calls these
// same functions, so a page cannot say a number the data files do not hold.

export const esc = (s) =>
  String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

const int = new Intl.NumberFormat("en-US");
const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});
const usd2 = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

export const longDate = (iso) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });

export const OTHER_DISTRICTS = [
  "Cameron",
  "Nueces",
  "Galveston",
  "Jefferson",
  "Brazos",
  "Midland",
  "Ector",
  "Grayson",
  "Guadalupe",
  "Kaufman",
];

const fill = (template, vars) =>
  template.replace(/\{\{([A-Z_]+)\}\}/g, (m, k) => {
    if (!(k in vars)) throw new Error(`no value for ${m}`);
    return vars[k];
  });

const table = (caption, head, rows) => `<table>
<caption class="visually-hidden">${esc(caption)}</caption>
<thead><tr>${head.map((h) => `<th scope="col">${esc(h)}</th>`).join("")}</tr></thead>
<tbody>
${rows
  .map(
    (r) =>
      `<tr><th scope="row">${r[0]}</th>${r
        .slice(1)
        .map((c) => `<td>${c}</td>`)
        .join("")}</tr>`,
  )
  .join("\n")}
</tbody>
</table>`;

export function countyTitle(c) {
  return `${c.name} County, Texas: commercial property data | FactLot`;
}

export function countyDescription(c) {
  const r = c.rolls[0];
  return `What FactLot hosts for ${c.name} County, Texas: ${int.format(c.hosted_parcels)} commercial parcels from the ${c.publisher} roll (tax year ${r.tax_year}, as of ${longDate(r.as_of)}), the source and its terms, and the tools that answer for the county.`;
}

export function countyBody(c, template, hasExample) {
  const rolls = c.rolls
    .map(
      (r) =>
        `<tr><th scope="row">${r.tax_year}${r.preliminary ? " (preliminary)" : ""}</th><td>${longDate(r.as_of)}</td><td>${int.format(r.parcels)}</td></tr>`,
    )
    .join("\n");
  const hosted = `<p>${esc(c.name)} County holds <strong>${int.format(c.hosted_parcels)}</strong> commercial parcels in the hosted registry. Every fact cites the roll file it was read from.</p>
<table>
<caption class="visually-hidden">Roll years held for ${esc(c.name)} County</caption>
<thead><tr><th scope="col">Roll (tax year)</th><th scope="col">Data as of</th><th scope="col">Parcels with a tax-year fact</th></tr></thead>
<tbody>
${rolls}
</tbody>
</table>`;
  const source = table(
    `Source of the ${c.name} County roll`,
    ["", ""],
    [
      ["Appraisal district", esc(c.publisher)],
      [
        "Publisher URL",
        `<a href="${esc(c.source_url)}">${esc(c.source_url)}</a>`,
      ],
      [
        "Terms page reviewed",
        `<a href="${esc(c.terms_url)}">${esc(c.terms_url)}</a>`,
      ],
      ["Licence as recorded", esc(c.license)],
      ["AI use", esc(c.ai_use)],
      ["Redistribution", esc(c.redistribution)],
      ["Terms last reviewed", longDate(c.terms_reviewed)],
    ],
  ).replace(
    '<th scope="col"></th><th scope="col"></th>',
    '<th scope="col">Item</th><th scope="col">As recorded</th>',
  );
  const tiers = c.neighborhood_tier
    ? `<li>Neighborhood code: the roll gives ${int.format(c.neighborhood_code_parcels)} of this county's parcels a neighborhood code, so candidates sharing the subject's code come first, then its ZIP code, then the rest of the county only if fewer than 10 are found.</li>`
    : `<li>Neighborhood code: not available for ${esc(c.name)} County, so the first tier is skipped. Candidates share the subject's ZIP code first, then the rest of the county only if fewer than 10 are found.</li>`;
  const tools = `<ul>
<li><code>registry_get</code>: a parcel in ${esc(c.name)} County by FactLot ID, with its cited roll facts.</li>
<li><code>registry_tx_equity_candidates</code> and its batch form: candidates under FactLot's default rule, for a person to review. Tiers here:
<ul>
${tiers}
</ul>
</li>
<li><code>calc_tx_unequal_appraisal</code>: the arithmetic over comparables the person chose.</li>
<li><code>rules_tx_property_tax_protest_deadline</code>: the deadline, which is the same in every county.</li>
</ul>`;
  const example = hasExample
    ? `<h2 id="example">Worked example</h2>
<p>One ${esc(c.name)} County commercial parcel shown end to end, as an agent would receive it: <a href="/texas/${c.slug}/example/">${esc(c.name)} County worked example</a>.</p>`
    : "";
  return fill(template, {
    LEDE: `${esc(c.name)} County, Texas: ${int.format(c.hosted_parcels)} commercial parcels from the ${esc(c.publisher)} roll, tax year ${c.rolls[0].tax_year}, as of ${longDate(c.rolls[0].as_of)}.`,
    HOSTED: hosted,
    SOURCE: source,
    TOOLS: tools,
    EXAMPLE: example,
  });
}

export function exampleTitle(c) {
  return `${c.name} County worked example: Texas parcel facts and candidates | FactLot`;
}

export function exampleDescription(c) {
  return `A ${c.name} County commercial parcel end to end: cited roll facts, the default-rule candidates, and the unequal-appraisal arithmetic on five of them with no adjustments. Evidence arithmetic only, not an appraisal.`;
}

const FACT_LABEL = {
  "parcel.apn": "Account number",
  "parcel.situs_address": "Situs address",
  "parcel.tax_year": "Tax year",
  "parcel.market_value": "Market value",
  "parcel.appraised_value": "Appraised value",
  "parcel.improvement_area_sf": "Improvement area",
  "parcel.land_area_sf": "Land area",
  "parcel.year_built": "Year built",
  "parcel.neighborhood_code": "Neighborhood code",
  "parcel.state_property_category": "State property category",
  "parcel.building_class": "Building class",
  "parcel.local_use_code": "Local use code",
};

function factValue(f) {
  if (f.unit === "USD") return usd.format(f.value);
  if (f.unit === "sf") return `${int.format(f.value)} SF`;
  return esc(f.value);
}

export function exampleBody(c, e, template) {
  const docs = Object.entries(e.documents);
  const docNo = new Map(docs.map(([id], i) => [id, i + 1]));
  const facts = e.parcel_facts.filter((f) => f.predicate in FACT_LABEL);
  if (e.parcel_facts.some((f) => !f.predicate.startsWith("parcel.")))
    throw new Error("example holds a non-parcel fact");
  const factsTable = `<table>
<caption class="visually-hidden">Cited roll facts</caption>
<thead><tr><th scope="col">Fact</th><th scope="col">Value</th><th scope="col">As of</th><th scope="col">Citation</th></tr></thead>
<tbody>
${facts.map((f) => `<tr><th scope="row"><code>${esc(f.predicate)}</code></th><td>${factValue(f)}</td><td>${f.as_of}</td><td>source ${docNo.get(f.document_id)}, <code>${esc(f.locator)}</code></td></tr>`).join("\n")}
</tbody>
</table>`;
  const sources = `<ol>
${docs.map(([, d]) => `<li>${esc(d.title)}, <a href="${esc(d.uri)}">${esc(d.uri)}</a>, retrieved ${esc(d.retrieved_at.slice(0, 10))}. Licence as recorded: ${esc(d.license)}. AI use: ${esc(d.ai_use)}. Redistribution: ${esc(d.redistribution)}.</li>`).join("\n")}
</ol>`;
  const r = e.selection_rule;
  const tierRows = r.tiers
    .map(
      (t) =>
        `<tr><th scope="row">${esc(t.tier)}</th><td>${esc(t.key)}</td><td>${int.format(t.matched)}</td><td>${int.format(t.returned)}</td></tr>`,
    )
    .join("\n");
  const rule = `<table>
<caption class="visually-hidden">selection_rule as returned</caption>
<thead><tr><th scope="col">Parameter</th><th scope="col">Value</th></tr></thead>
<tbody>
<tr><th scope="row">Tax year</th><td>${r.tax_year}</td></tr>
<tr><th scope="row">State property category</th><td>${esc(r.state_property_category)}</td></tr>
<tr><th scope="row">Improvement area band</th><td>within ${r.area_band.share * 100}% of the subject's: ${int.format(Math.round(r.area_band.min_sf))} to ${int.format(Math.round(r.area_band.max_sf))} SF</td></tr>
<tr><th scope="row">Year built band</th><td>within ${r.year_band.years} years: ${r.year_band.min} to ${r.year_band.max}</td></tr>
<tr><th scope="row">Minimum matches before widening</th><td>${r.min_matches}</td></tr>
<tr><th scope="row">Limit</th><td>${r.limit}</td></tr>
<tr><th scope="row">Widened to the county</th><td>${r.widened_to_county ? "yes" : "no"}</td></tr>
</tbody>
</table>
<table>
<caption class="visually-hidden">Candidates per tier</caption>
<thead><tr><th scope="col">Tier</th><th scope="col">Key</th><th scope="col">Matched</th><th scope="col">Returned</th></tr></thead>
<tbody>
${tierRows}
</tbody>
</table>
<p class="small">${esc(r.notice)}</p>`;
  const cands = `<table>
<caption class="visually-hidden">First ten candidates under the default rule</caption>
<thead><tr><th scope="col">#</th><th scope="col">Parcel URN</th><th scope="col">Situs address</th><th scope="col">Tier</th><th scope="col">Value</th><th scope="col">Improvement area</th><th scope="col">Value per SF</th></tr></thead>
<tbody>
${e.candidates.map((x, i) => `<tr><th scope="row">${i + 1}</th><td><code>${esc(x.id)}</code></td><td>${esc(x.situs_address)}</td><td>${esc(x.tier)}</td><td>${usd.format(x.value)}</td><td>${int.format(x.improvement_area_sf)} SF</td><td>${usd2.format(x.value_per_sf)}</td></tr>`).join("\n")}
</tbody>
</table>`;
  const calcArgs = `<pre><code>${esc(JSON.stringify(e.calc_args, null, 2))}</code></pre>`;
  return fill(template, {
    COUNTY: esc(c.name),
    SLUG: c.slug,
    FACTS: factsTable,
    SOURCES: sources,
    RULE: rule,
    CANDIDATES: cands,
    CANDIDATE_COUNT: String(e.candidates_total_returned),
    CALC_ARGS: calcArgs,
    URN: esc(e.urn),
  });
}

/** The status table on the hub: Tarrant withheld, ten districts built but not hosted. */
export function otherDistrictsTable() {
  const row = (name, status) =>
    `<tr><th scope="row">${name}</th><td>${status}</td></tr>`;
  return `<table>
<caption class="visually-hidden">Other Texas appraisal districts</caption>
<thead><tr><th scope="col">District</th><th scope="col">Status</th></tr></thead>
<tbody>
${row("Tarrant", "Withheld: not served by the hosted registry while the publisher's terms for AI use are unclear.")}
${OTHER_DISTRICTS.map((n) => row(n, "Built, not yet hosted. Coming to the hosted registry.")).join("\n")}
</tbody>
</table>`;
}
