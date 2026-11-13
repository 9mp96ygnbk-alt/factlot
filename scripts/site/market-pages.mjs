// The market pages (/new-york-city/, /los-angeles/, /san-francisco/, /boston/, /denver/, /connecticut/): one
// factual page per hosted place beyond Texas. Pure renderers: counts, as-of dates and the entity totals come
// from site/_data/hosted.json (the pack's manifest), the sources' recorded terms and the worked example from
// site/_data/markets.json (scripts/site/gen-markets.ts, from the registry files), and what each place does not
// hold from the review records in docs/registry/sources/. build.mjs writes the pages and site.test.ts calls
// these same functions, so a page cannot say a number the data does not hold. A place the hosted pack does not
// serve gets no page.

import { esc, longDate } from "./texas-pages.mjs";

const int = new Intl.NumberFormat("en-US");
const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

/** The State of Colorado's disclaimer, word for word as data.colorado.gov/terms requires it on sites using its data. */
export const CO_DISCLAIMER =
  "The data made available here has been modified for use from its original source, which is the State of Colorado. THE STATE OF COLORADO MAKES NO REPRESENTATIONS OR WARRANTY AS TO THE COMPLETENESS, ACCURACY, TIMELINESS, OR CONTENT OF ANY DATA MADE AVAILABLE THROUGH THIS SITE. THE STATE OF COLORADO EXPRESSLY DISCLAIMS ALL WARRANTIES, WHETHER EXPRESS OR IMPLIED, INCLUDING ANY IMPLIED WARRANTIES OF MERCHANTABILITY, OR FITNESS FOR A PARTICULAR PURPOSE. The data is subject to change as modifications and updates are complete. It is understood that the information contained in the Web feed is being used at one's own risk.";

/** Denver's attribution under CC BY 3.0, with the change notice the licence asks for. */
export const DENVER_NOTICE =
  'Denver parcel data: "City and County of Denver", from the Denver Open Data Catalog, used under the <a href="https://creativecommons.org/licenses/by/3.0/">Creative Commons Attribution 3.0</a> licence. FactLot has changed it: filtered to commercial, industrial and multifamily parcels, normalised, and linked to the Colorado Secretary of State entity file. The City does not endorse FactLot.';

/**
 * The market pages, in the order the coverage page lists them. `place` is the hosted.json place key; `sources`
 * are the source ids whose terms the page quotes (parcels first, then the entity registry); `sample` is an
 * address the worked example searches; `limits` are what the place does not hold, from the review records.
 */
export const MARKETS = [
  {
    slug: "new-york-city",
    place: "nyc",
    db: "ny",
    name: "New York City",
    title: "New York City: commercial property data",
    sources: ["ny-nyc-dof", "ny-dos-entities"],
    sample: "214 W 42nd St",
    sampleUrnPrefix: "fl:parcel:us-36",
    entity: { jurisdiction: "us-ny", name: "New York Department of State" },
    idName: "Borough-block-lot (BBL)",
    idText:
      "The ID system <code>nyc_bbl</code> is the borough digit, the 5-digit block and the 4-digit lot, such as 1000020002. Manhattan is New York County (FIPS 36061), the Bronx 36005, Brooklyn (Kings) 36047, Queens 36081 and Staten Island (Richmond) 36085.",
    limits: [
      "One- to four-family homes, religious and cultural property and other categories outside commercial, industrial and apartment use are not loaded.",
      "A residential condominium building has no single parcel record here; its commercial units are separate lots, and a condominium building appears as its unit lots.",
      "Owners are the Department of Finance's primary owner of record, kept only where it is an organisation; the roll has no owner mailing address.",
    ],
  },
  {
    slug: "los-angeles",
    place: "la",
    db: "ca",
    name: "Los Angeles County",
    title: "Los Angeles County, California: commercial property data",
    sources: ["ca-los-angeles-assessor"],
    sample: "355 S Grand Ave",
    sampleUrnPrefix: "fl:parcel:us-06037:",
    idName: "Assessor's Identification Number (AIN)",
    idText:
      "The ID system <code>la_ain</code> is the Assessor's 10-digit Identification Number, such as 5151015013. Los Angeles County is FIPS 06037.",
    limits: [
      "The public file has no owner names, mailing addresses or entity links, so a parcel here has no owner-of-record fact. The Assessor sells an ownership roll separately; it is not in this registry.",
      "Some parcels have no situs address in the file; an address search cannot find them, but their AIN can.",
    ],
  },
  {
    slug: "san-francisco",
    place: "sf",
    db: "ca",
    name: "San Francisco",
    title: "San Francisco, California: commercial property data",
    sources: ["ca-san-francisco-assessor"],
    sample: "555 California St",
    sampleUrnPrefix: "fl:parcel:us-06075:",
    idName: "Block and lot",
    idText:
      "The ID system <code>sf_parcel</code> is the Assessor's block and lot joined, such as 0259026 for block 0259, lot 026. San Francisco is FIPS 06075.",
    limits: [
      "The public file has no owner names, so a parcel here has no owner-of-record fact.",
      "The values are from the 2025 roll year, the latest the City's open dataset held when the source was reviewed; the 2026 roll was not yet published there.",
      "Only the in-scope property classes (commercial, industrial and multifamily) are loaded, not the whole roll.",
    ],
  },
  {
    slug: "boston",
    place: "boston",
    db: "ma",
    name: "the City of Boston",
    title: "City of Boston, Massachusetts: commercial property data",
    sources: ["ma-boston-assessing"],
    sample: "800 Boylston St",
    sampleUrnPrefix: "fl:parcel:us-25025:",
    idName: "Parcel ID (PID)",
    idText:
      "The ID system <code>boston_pid</code> is the Assessing Department's 10-digit parcel number, whose first two digits are the ward, such as 0401037100. The City of Boston is in Suffolk County, Massachusetts (FIPS 25025).",
    limits: [
      "Only the City of Boston is loaded. Chelsea, Revere and Winthrop, the other municipalities of Suffolk County, assess separately and are not loaded; a lookup there is a coverage miss that says so.",
      "Values are fiscal-year 2026 values as of 2025-01-01, older than the other places on this site.",
      "No Massachusetts entity registry is loaded, so owners are not linked to registered entities.",
    ],
  },
  {
    slug: "denver",
    place: "denver",
    db: "co",
    name: "Denver",
    title: "Denver, Colorado: commercial property data",
    sources: ["co-denver-assessor", "co-sos-entities"],
    sample: "1801 California St",
    sampleUrnPrefix: "fl:parcel:us-08031:",
    entity: { jurisdiction: "us-co", name: "Colorado Secretary of State" },
    idName: "Schedule number",
    idText:
      "The ID system <code>denver_schednum</code> is the Assessor's schedule number, such as 0234513035000. Denver is the City and County of Denver (FIPS 08031).",
    limits: [
      "The Assessor's files carry no tax year on each record, so the registry holds the values as of the file's date, not a year-by-year history.",
      "Only commercial, industrial and apartment property is loaded; single-family homes, duplexes, vacant land, and exempt and agricultural property are not.",
    ],
    notices: [DENVER_NOTICE, `State of Colorado disclaimer: ${CO_DISCLAIMER}`],
  },
  {
    slug: "connecticut",
    place: "ct",
    db: "ct",
    name: "Connecticut",
    title: "Connecticut: commercial property data",
    sources: ["ct-parcel-cama-layer", "ct-sos-entities"],
    sample: "10 Putnam St",
    sampleUrnPrefix: "fl:parcel:us-09",
    entity: {
      jurisdiction: "us-ct",
      name: "Connecticut Secretary of the State",
    },
    idName: "CAMA link",
    idText:
      "The ID system <code>ct_cama_link</code> is the town and CAMA-record link of the statewide layer, such as 37070-204534125. Connecticut parcels carry the former county in their FIPS code (Hartford 09003, Fairfield 09001, and so on), because the layer does; the state replaced its counties with planning regions for Census purposes in 2022.",
    limits: [
      "The layer is statewide by town, but only parcels whose use description says commercial, industrial or apartment (of five or more units) are loaded; land, mixed-use and exempt property are not.",
      "The use codes are each town's own and differ between towns, so the registry maps the use description, not the code; a town that changes its software changes its words.",
      "A parcel's tax year is the valuation year its town reports in the layer, so values of different towns can be of different years.",
    ],
  },
];

const FACT_LABEL = {
  "parcel.apn": "parcel number",
  "parcel.situs_address": "situs address",
  "parcel.market_value": "market value",
  "parcel.appraised_value": "appraised value",
  "parcel.land_area_sf": "land area",
  "parcel.improvement_area_sf": "improvement area",
  "parcel.year_built": "year built",
  "parcel.state_property_category": "property category",
  "parcel.local_use_code": "local use code",
  "parcel.tax_year": "tax year",
  "ownership.owner_of_record": "owner of record",
  "ownership.owner_mailing_address": "owner mailing address",
  "zoning.district": "zoning district",
};

const table = (caption, rows) => `<table>
<caption class="visually-hidden">${esc(caption)}</caption>
<thead><tr><th scope="col">Item</th><th scope="col">As recorded</th></tr></thead>
<tbody>
${rows.map((r) => `<tr><th scope="row">${r[0]}</th><td>${r[1]}</td></tr>`).join("\n")}
</tbody>
</table>`;

const fill = (template, vars) =>
  template.replace(/\{\{([A-Z_]+)\}\}/g, (m, k) => {
    if (!(k in vars)) throw new Error(`no value for ${m}`);
    return vars[k];
  });

/** The markets whose place the hosted pack serves. */
export const hostedMarkets = (hosted) =>
  MARKETS.filter((m) => hosted.places.some((p) => p.key === m.place));

const placeOf = (m, hosted) => hosted.places.find((p) => p.key === m.place);

export function marketTitle(m) {
  return `${m.title} | FactLot`;
}

export function marketDescription(m, hosted) {
  const p = placeOf(m, hosted);
  return `What FactLot hosts for ${m.name}: ${int.format(p.parcels)} commercial parcels, data as of ${longDate(p.as_of)}, the sources and their recorded terms, the ID system, and what the tools answer there and do not.`;
}

/** `fieldsText`: what the place has and lacks, one paragraph from site/_data/fields.json (fields.mjs placeFieldsText). */
export function marketBody(m, d, hosted, template, fieldsText) {
  const p = placeOf(m, hosted);
  const parcelSource = d.sources[0];
  const reg = m.entity
    ? hosted.entity_registries.find(
        (r) => r.jurisdiction === m.entity.jurisdiction,
      )
    : undefined;
  const entities = reg
    ? reg.total !== undefined
      ? `${int.format(reg.entities)} of the ${esc(m.entity.name)} file's ${int.format(reg.total)} entities, the ones that own a hosted parcel`
      : `${int.format(reg.entities)} ${esc(m.entity.name)} entities`
    : "";
  const hostedHtml = `<p>${esc(m.name[0].toUpperCase() + m.name.slice(1))} holds <strong>${int.format(p.parcels)}</strong> commercial, industrial and multifamily parcels${p.buildings ? ` and ${int.format(p.buildings)} buildings` : ""} in the hosted registry, from ${esc(parcelSource.publisher)}, data as of ${longDate(p.as_of)}. Every fact cites the file it was read from, with that source's licence and attribution.${entities ? ` Owners that are organisations are linked to the entity file: the hosted registry serves ${entities}.` : ""}</p>`;
  const sources = d.sources
    .map((s) =>
      table(`Source ${s.source_id}`, [
        ["Source ID", `<code>${esc(s.source_id)}</code>`],
        ["Publisher", esc(s.publisher)],
        ["File", `${esc(s.title)}, <a href="${esc(s.url)}">${esc(s.url)}</a>`],
        ["Licence as recorded", esc(s.license)],
        ["AI use", esc(s.ai_use)],
        ["Redistribution", esc(s.redistribution)],
        ...(s.attribution ? [["Attribution", esc(s.attribution)]] : []),
        ["Terms last reviewed", longDate(s.terms_reviewed)],
      ]),
    )
    .join("\n");
  const s = d.sample;
  const value =
    s.market_value !== null
      ? `market value ${usd.format(s.market_value)}`
      : s.appraised_value !== null
        ? `appraised value ${usd.format(s.appraised_value)}`
        : "no value";
  const year = s.tax_year !== null ? `, tax year ${s.tax_year}` : "";
  const facts = s.predicates
    .filter((x) => x in FACT_LABEL)
    .map((x) => `<code>${esc(x)}</code>`)
    .join(", ");
  const tools = `<ul>
<li><code>registry_search_address</code>: <code>${esc(s.query)}</code> finds ${s.matches === 1 ? "one parcel" : "parcels"}, the first being <code>${esc(s.urn)}</code> (${esc(s.label)}).</li>
<li><code>registry_get</code> on it: ${value}${year}; facts <span class="try-wrap">${facts}</span>, each citing the file it came from.</li>
<li><code>registry_resolve_parcel</code> and <code>registry_resolve_external</code>: the URN from the county's own number (<code>${esc(s.external_id)}</code> in system <code>${esc(d.id_system)}</code>).</li>
${d.holds.owner_of_record ? "<li><code>registry_search_entities</code> and <code>registry_owned_by</code>: organisation owners and the parcels linked to them.</li>" : ""}
</ul>
<p>Try a lookup on the <a href="/try/">free tier</a>, no key.</p>`;
  const limits = [
    ...(d.holds.owner_of_record
      ? [
          "Owners that are natural persons are never returned; a parcel whose owner is a person shows no owner.",
        ]
      : []),
    ...m.limits,
    "Commercial, industrial and multifamily parcels only; a residential or exempt parcel is a coverage miss, not a sign the parcel does not exist.",
  ];
  const notices = (m.notices ?? [])
    .map(
      (n) =>
        `<p class="small">${n.startsWith("State of Colorado") ? esc(n) : n}</p>`,
    )
    .join("\n");
  return fill(template, {
    LEDE: `${esc(m.name[0].toUpperCase() + m.name.slice(1))}: ${int.format(p.parcels)} commercial parcels from ${esc(parcelSource.publisher)}, data as of ${longDate(p.as_of)}.`,
    HOSTED: fieldsText
      ? `${hostedHtml}\n<p>${esc(fieldsText)} <a href="/coverage/#fields">Every hosted county, field by field</a>.</p>`
      : hostedHtml,
    SOURCE: sources,
    ID_NAME: esc(m.idName),
    ID_TEXT: m.idText,
    TOOLS: tools,
    LIMITS: `<ul>\n${limits.map((l) => `<li>${esc(l)}</li>`).join("\n")}\n</ul>`,
    NOTICES: notices ? `<h2 id="notices">Source notices</h2>\n${notices}` : "",
  });
}

/** The coverage page's section on the places with a page of their own ("" when none). */
export function marketLinks(hosted) {
  const ms = hostedMarkets(hosted);
  if (!ms.length) return "";
  return `<h2 id="places">Places with their own page</h2>
<p>Texas has a <a href="/texas/">hub and a page per county</a>. These places have a page with what is loaded, the source and its recorded terms, the ID system and what is not there:</p>
<ul class="plain">
${ms
  .map(
    (m) =>
      `<li><a href="/${m.slug}/">${esc(m.name[0].toUpperCase() + m.name.slice(1))}</a>: ${int.format(placeOf(m, hosted).parcels)} parcels</li>`,
  )
  .join("\n")}
</ul>`;
}

/** The coverage page's source notices: what a source's terms require applications to show ("" when none). */
export function sourceNotices(hosted) {
  const places = new Set(hosted.places.map((p) => p.key));
  const out = [];
  if (places.has("denver")) {
    out.push(`<p>${DENVER_NOTICE}</p>`);
    out.push(
      `<p>State of Colorado disclaimer, which data.colorado.gov requires applications using its business-entity data to show: ${esc(CO_DISCLAIMER)}</p>`,
    );
  }
  if (!out.length) return "";
  return `<h2 id="notices">Source notices</h2>
<p>Each fact the hosted API returns carries its source's licence and any attribution the source asks for. Notices that a source's terms require:</p>
${out.join("\n")}`;
}
