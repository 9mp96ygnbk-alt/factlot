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

/** Districts that are neither hosted nor withheld and are listed on the hub with a status. */
export const OTHER_DISTRICTS = [];

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

const latestRoll = (c) => c.rolls[c.rolls.length - 1];
const hasValues = (c) => c.rolls.length > 0;
const rollSpan = (c) => {
  const first = c.rolls[0].tax_year;
  const last = latestRoll(c).tax_year;
  return first === last ? `tax year ${last}` : `tax years ${first} to ${last}`;
};

export function countyDescription(c) {
  if (!hasValues(c))
    return `What FactLot hosts for ${c.name} County, Texas: ${int.format(c.hosted_parcels)} commercial parcels from the ${c.publisher} roll (data as of ${longDate(c.data_as_of)}; the publisher's file has no values), the source and its terms, and the tools that answer for the county.`;
  const r = latestRoll(c);
  return `What FactLot hosts for ${c.name} County, Texas: ${int.format(c.hosted_parcels)} commercial parcels from the ${c.publisher} roll (${rollSpan(c)}, latest as of ${longDate(r.as_of)}), the source and its terms, and the tools that answer for the county.`;
}

/**
 * `fieldsText`: what the county has and lacks, one paragraph from site/_data/fields.json (fields.mjs
 * placeFieldsText); shown after what is hosted when given.
 */
export function countyBody(c, template, hasExample, fieldsText) {
  const rolls = c.rolls
    .map(
      (r) =>
        `<tr><th scope="row">${r.tax_year}${r.preliminary ? " (preliminary)" : ""}</th><td>${longDate(r.as_of)}</td><td>${int.format(r.parcels)}</td></tr>`,
    )
    .join("\n");
  const hosted = hasValues(c)
    ? `<p>${esc(c.name)} County holds <strong>${int.format(c.hosted_parcels)}</strong> commercial parcels in the hosted registry${c.rolls.length > 1 ? `, with ${c.rolls.length} roll years of values (${rollSpan(c)})` : ""}. Every fact cites the roll file it was read from.</p>
<table>
<caption class="visually-hidden">Roll years held for ${esc(c.name)} County</caption>
<thead><tr><th scope="col">Roll (tax year)</th><th scope="col">Data as of</th><th scope="col">Parcels with a tax-year fact</th></tr></thead>
<tbody>
${rolls}
</tbody>
</table>`
    : `<p>${esc(c.name)} County holds <strong>${int.format(c.hosted_parcels)}</strong> commercial parcels in the hosted registry, from the roll file as of ${longDate(c.data_as_of)}. Values are not in the publisher's file, so the registry holds no market value, appraised value or tax year for these parcels. It holds the account number, situs address, state property category, local use code and, where the file names an organisation, the owner of record. Every fact cites the roll file it was read from.</p>`;
  const fieldsHtml = fieldsText
    ? `\n<p>${esc(fieldsText)} <a href="/coverage/#fields">Every hosted county, field by field</a>.</p>`
    : "";
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
  const tiers = !hasValues(c)
    ? `<li>Not available for ${esc(c.name)} County: candidates need market values and improvement areas, which the publisher's file does not carry.</li>`
    : c.neighborhood_tier
      ? `<li>Neighborhood code: the roll gives ${int.format(c.neighborhood_code_parcels)} of this county's parcels a neighborhood code, so candidates sharing the subject's code come first, then its ZIP code, then the rest of the county only if fewer than 10 are found.</li>`
      : `<li>Neighborhood code: not available for ${esc(c.name)} County, so the first tier is skipped. Candidates share the subject's ZIP code first, then the rest of the county only if fewer than 10 are found.</li>`;
  const tools = `<ul>
<li><code>registry_get</code>: a parcel in ${esc(c.name)} County by FactLot ID, with its cited roll facts. Value history by tax year: every year with a Pro or Team key, the current roll year without one.</li>
<li><code>registry_tx_equity_candidates</code> and its batch form (Pro and Team): candidates under FactLot's default rule, for a person to review; one parcel per call is within the free lookups. Tiers here:
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
    LEDE: hasValues(c)
      ? `${esc(c.name)} County, Texas: ${int.format(c.hosted_parcels)} commercial parcels from the ${esc(c.publisher)} roll, ${rollSpan(c)}, latest as of ${longDate(latestRoll(c).as_of)}.`
      : `${esc(c.name)} County, Texas: ${int.format(c.hosted_parcels)} commercial parcels from the ${esc(c.publisher)} roll as of ${longDate(c.data_as_of)}. Values are not in the publisher's file.`,
    HOSTED: hosted + fieldsHtml,
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

/** The status table on the hub: Tarrant withheld, plus any district listed in OTHER_DISTRICTS. */
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
</table>`.replace("\n\n</tbody>", "\n</tbody>");
}

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
export const countWord = (n) => WORDS[n] ?? String(n);

const rollText = (c) => {
  if (!hasValues(c)) return "no values in the publisher's file";
  const n = c.rolls.length;
  const last = latestRoll(c);
  const prelim = last.preliminary ? " (2027 preliminary)" : "";
  return n === 1
    ? `one roll year${prelim}`
    : `${countWord(n)} roll years, ${rollSpan(c).replace("tax years ", "")}`;
};

/** The hub's table of hosted counties, from texas-counties.json. */
export function hubHostedTable(counties) {
  const total = counties.reduce((a, c) => a + c.hosted_parcels, 0);
  const rows = [
    ...counties.map(
      (c) =>
        `    <tr>\n      <th scope="row">${esc(c.name)}</th>\n      <td>${int.format(c.hosted_parcels)}</td>\n      <td>${rollText(c)}</td>\n    </tr>`,
    ),
    `    <tr>\n      <th scope="row">Total</th>\n      <td>${int.format(total)}</td>\n      <td></td>\n    </tr>`,
  ];
  return `<table>
  <caption class="visually-hidden">
    Hosted Texas counties
  </caption>
  <thead>
    <tr>
      <th scope="col">County</th>
      <th scope="col">Commercial parcels</th>
      <th scope="col">Roll</th>
    </tr>
  </thead>
  <tbody>
${rows.join("\n")}
  </tbody>
</table>`;
}

/** The hub's sentence about roll years, derived from the data. */
export function hubRollSentence(counties) {
  const multi = counties.filter((c) => c.rolls.length > 1);
  const single = counties.filter((c) => c.rolls.length === 1);
  const none = counties.filter((c) => !hasValues(c));
  const parts = [
    `${countWord(multi.length)} of the ${countWord(counties.length)} counties hold more than one roll year (${multi.map((c) => `${c.name} ${rollSpan(c).replace("tax years ", "")}`).join(", ")}), ${countWord(single.length)} hold one`,
  ];
  if (none.length)
    parts[0] += `, and ${none.map((c) => c.name).join(" and ")} has no values because the publisher's file has none`;
  return `${parts[0].charAt(0).toUpperCase()}${parts[0].slice(1)}.`;
}

/** The hub's list of county pages. */
export function hubCountyLinks(counties, exampleSlugs) {
  return `<ul>
${counties
  .map(
    (c) =>
      `  <li><a href="/texas/${c.slug}/">${esc(c.name)}</a>${exampleSlugs.includes(c.slug) ? ` (<a href="/texas/${c.slug}/example/">worked example</a>)` : ""}</li>`,
  )
  .join("\n")}
</ul>`;
}

/**
 * The links /try/ shows after a Texas parcel loads, one entry per hosted county that holds values:
 * the county's worked example where one exists, otherwise the Texas hub. try.js reads them by the
 * county's five-digit FIPS code (the parcel's ID carries it), so no county is named in the script.
 */
export function tryTexasLinks(counties, exampleSlugs) {
  return `<ul id="try-texas-links" hidden>
${counties
  .filter(hasValues)
  .map((c) => {
    const example = exampleSlugs.includes(c.slug);
    const href = example ? `/texas/${c.slug}/example/` : "/texas/";
    const text = example ? `${c.name} County worked example` : "Texas tools";
    return `  <li data-fips="48${esc(c.county_fips)}"><a href="${href}">${esc(text)}</a></li>`;
  })
  .join("\n")}
</ul>`;
}

/** The hub's count of hosted counties whose roll carries values, in words. */
export const valueCountyCount = (counties) =>
  countWord(counties.filter(hasValues).length);

/** The hub's list of worked examples. */
export function hubExampleLinks(counties, exampleSlugs) {
  return `<ul>
${counties
  .filter((c) => exampleSlugs.includes(c.slug))
  .map(
    (c) =>
      `  <li><a href="/texas/${c.slug}/example/">${esc(c.name)} County worked example</a></li>`,
  )
  .join("\n")}
</ul>`;
}
