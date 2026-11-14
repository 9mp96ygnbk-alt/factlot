// Real lookups in the hosted regions that the hosted end-to-end suite (scripts/e2e/hosted.ts) makes, with the
// answers the hosted pack gives. Kept apart from the suite so they can be checked offline against the pack files
// (the registry Worker on a local copy of the pack) before a live run.
import { readFileSync } from "node:fs";

// What the hosted pack serves (site/_data/hosted.json, which scripts/site/gen-hosted.ts writes from the
// pack's manifest).
export const HOSTED = JSON.parse(
  readFileSync(
    new URL("../../site/_data/hosted.json", import.meta.url),
    "utf8",
  ),
) as {
  totals: { parcels: number; entities: number; counties: number };
  withheld: { fips: string }[];
  partial: { fips: string; area: string }[];
};
// Real lookups in the hosted regions. Values come from the registry files the hosted pack is built
// from; update them when the pack is rebuilt.
export const HOSTED_REGISTRY_CASES: {
  tool: string;
  arguments: Record<string, unknown>;
  expect?: Record<string, unknown>;
  /** Paths whose value must match the regular expression. */
  expect_match?: Record<string, string>;
  /** Fact predicates the answer's `facts` must carry, or must not carry. */
  has_predicates?: string[];
  no_predicates?: string[];
  expect_error?: string;
}[] = [
  {
    tool: "registry_coverage",
    arguments: {},
    expect: {
      "totals.parcels": HOSTED.totals.parcels,
      "totals.entities": HOSTED.totals.entities,
      "totals.counties": HOSTED.totals.counties,
      "hosted.withheld_counties.0.region": `us-${HOSTED.withheld[0]!.fips}`,
      // A county loaded in part (the City of Boston, in Suffolk County) is listed with its part.
      ...(HOSTED.partial.length
        ? {
            "hosted.partial_counties.0.region": `us-${HOSTED.partial[0]!.fips}`,
            "hosted.partial_counties.0.area": HOSTED.partial[0]!.area,
          }
        : {}),
    },
  },
  // Outside Texas the candidate tool is an input error (Texas-only), whatever regions are hosted.
  {
    tool: "registry_tx_equity_candidates",
    arguments: { urn: "fl:parcel:us-36061:1000010001" },
    expect_error: "InputError",
  },
  {
    tool: "registry_get",
    arguments: { urn: "fl:parcel:us-11001:02570824" },
    expect: { status: "current", kind: "parcel" },
  },
  {
    tool: "registry_resolve_parcel",
    arguments: { state_fips: "11", county_fips: "001", apn: "0257 0824" },
    expect: { urn: "fl:parcel:us-11001:02570824" },
  },
  {
    tool: "registry_resolve_external",
    arguments: { system: "dc_ssl", external_id: "0257 0824" },
    expect: { urn: "fl:parcel:us-11001:02570824" },
  },
  {
    tool: "registry_search_address",
    arguments: { query: "1300 Pennsylvania Ave NW", limit: 3 },
    expect: { "results.0.urn": "fl:parcel:us-11001:02570824" },
  },
  // Two parcels share the label "100 LIGHT ST, BALTIMORE MD 21202": the roll gives "-001a" an improvement area
  // (686,947 sq ft) and "-001" none, so "-001a" comes first (parcels of one label: largest improvement area first,
  // one with none after, then URN order).
  {
    tool: "registry_search_address",
    arguments: { query: "100 Light St", limit: 2 },
    expect: {
      "results.0.urn": "fl:parcel:us-24510:0304110671-001a",
      "results.1.urn": "fl:parcel:us-24510:0304110671-001",
    },
  },
  { tool: "registry_search_entities", arguments: { query: "LLC", limit: 5 } },
  {
    tool: "registry_owned_by",
    arguments: { entity_urn: "fl:entity:us-dc:c00008141728" },
  },
  // Texas. Values from the pack of 2026-11-10 (release-2026-11-10 tx.db with md.db, ut.db, dc.db;
  // Tarrant 48439 withheld): sixteen counties, Denton and Williamson 2027 preliminary rolls, the
  // Comptroller entities that own a hosted parcel. Expectations were computed with runTool on the
  // release copies.
  {
    tool: "registry_get",
    arguments: { urn: "fl:parcel:us-48201:0180580000001" },
    expect: {
      status: "current",
      kind: "parcel",
      "value_history.0.tax_year": 2026,
      "value_history.0.market_value": 2748333,
    },
  },
  {
    tool: "registry_get",
    arguments: { urn: "fl:parcel:us-48201:0011440000001" },
    expect: {
      status: "current",
      kind: "parcel",
      "value_history.0.tax_year": 2026,
      "value_history.0.market_value": 303755215,
    },
  },
  // Brazos holds eleven roll years (2016 to 2026): value_history runs newest first.
  {
    tool: "registry_get",
    arguments: { urn: "fl:parcel:us-48041:100022" },
    expect: {
      status: "current",
      kind: "parcel",
      "value_history.0.tax_year": 2026,
      "value_history.0.market_value": 1268807,
      "value_history.10.tax_year": 2016,
      "value_history.10.market_value": 521990,
    },
  },
  {
    tool: "registry_tx_equity_candidates",
    arguments: { urn: "fl:parcel:us-48041:100022" },
    expect: {
      "selection.tax_year": 2026,
      "selection.available_tax_years.0": 2026,
      "selection.available_tax_years.10": 2016,
      "selection.roll_sources.0": "tx-brazos-cad",
      "selection.returned": 38,
      "candidates.0.id": "fl:parcel:us-48041:96141",
      "sources.0.rights.attribution": "Brazos Central Appraisal District",
    },
  },
  // Midland: the parcel is held, its publisher's file has no values.
  {
    tool: "registry_get",
    arguments: { urn: "fl:parcel:us-48329:r000000017" },
    expect: { status: "current", kind: "parcel" },
  },
  {
    tool: "registry_resolve_parcel",
    arguments: {
      state_fips: "48",
      county_fips: "113",
      apn: "00000100057000000",
    },
    expect: { urn: "fl:parcel:us-48113:00000100057000000" },
  },
  {
    tool: "registry_search_address",
    arguments: { query: "1201 S Lamar Blvd", limit: 3 },
    expect: { "results.0.urn": "fl:parcel:us-48453:100008" },
  },
  {
    tool: "registry_search_address",
    arguments: { query: "1706 W University Dr", limit: 3 },
    expect: { "results.0.urn": "fl:parcel:us-48085:10000" },
  },
  {
    tool: "registry_search_entities",
    arguments: { query: "holdings", limit: 3 },
    // The national pack added the Connecticut entities: the first by label is now one of them.
    expect: { "results.0.urn": "fl:entity:us-ct:1267335" },
  },
  {
    tool: "registry_owned_by",
    arguments: { entity_urn: "fl:entity:us-tx:0000452810" },
    expect: { "results.0.urn": "fl:parcel:us-48453:126012" },
  },
  {
    tool: "registry_tx_equity_candidates",
    arguments: { urn: "fl:parcel:us-48201:0180580000001" },
    expect: {
      "selection.tax_year": 2026,
      "selection.roll_sources.0": "tx-harris-cad",
      "selection.building_class_sources.0": "tx-harris-cad-buildings",
      "selection.tiers.0.matched": 6,
      "selection.tiers.2.matched": 293,
      "selection.widened_to_county": true,
      "selection.returned": 50,
      "candidates.0.id": "fl:parcel:us-48201:0540160000008",
      "sources.0.rights.attribution": "Harris Central Appraisal District",
    },
  },
  {
    tool: "registry_tx_equity_candidates",
    arguments: {
      urn: "fl:parcel:us-48201:0180580000001",
      area_band: 0.2,
      year_band: 10,
      limit: 5,
    },
    expect: {
      "selection.returned": 5,
      "candidates.0.id": "fl:parcel:us-48201:0540160000008",
    },
  },
  {
    tool: "registry_tx_equity_candidates",
    arguments: { county_fips: "113", apn: "00000100057000000" },
    expect: {
      "selection.tax_year": 2026,
      "selection.matched": 54,
      "selection.returned": 50,
      "candidates.0.id": "fl:parcel:us-48113:000010001301a0000",
    },
  },
  // Denton: a 2027 preliminary roll, compared in that year only.
  {
    tool: "registry_tx_equity_candidates",
    arguments: { urn: "fl:parcel:us-48121:1002521" },
    expect: {
      "selection.tax_year": 2027,
      "selection.available_tax_years.0": 2027,
      "subject.value_history.0.tax_year": 2027,
      "selection.returned": 14,
      "candidates.0.id": "fl:parcel:us-48121:565139",
      "candidates.0.tax_year": 2027,
    },
  },
  // Tarrant is withheld: an input error from the candidate tool, a miss that says why elsewhere.
  {
    tool: "registry_tx_equity_candidates",
    arguments: { urn: "fl:parcel:us-48439:00001234" },
    expect_error: "InputError",
  },
  {
    tool: "registry_get",
    arguments: { urn: "fl:parcel:us-48439:00001234" },
    expect_error: "NotFound",
  },
  // A Texas parcel the registry does not hold (residential): a coverage miss, not a failure.
  {
    tool: "registry_tx_equity_candidates",
    arguments: { urn: "fl:parcel:us-48201:1" },
    expect_error: "NotFound",
  },
  // New York City, Los Angeles County, San Francisco, the City of Boston, Denver and Connecticut. Values
  // from the registry files of release-2026-11-12 (national/ny.db, ca.db, ma.db, co.db, ct.db); the tools'
  // own answers were read with runTool on read-only copies.
  {
    tool: "registry_resolve_parcel",
    arguments: { state_fips: "36", county_fips: "061", apn: "1000020002" },
    expect: { urn: "fl:parcel:us-36061:1000020002" },
  },
  {
    tool: "registry_resolve_external",
    arguments: { system: "nyc_bbl", external_id: "1009941201" },
    expect: { urn: "fl:parcel:us-36061:1009941201" },
  },
  // A New York address with an ordinal: the file writes "214 WEST 42 STREET", the search matches "42nd".
  {
    tool: "registry_search_address",
    arguments: { query: "214 W 42nd St", limit: 3 },
    expect: { "results.0.urn": "fl:parcel:us-36061:1010130039" },
  },
  {
    tool: "registry_get",
    arguments: { urn: "fl:parcel:us-36061:1010130039" },
    expect: {
      status: "current",
      kind: "parcel",
      "value_history.0.tax_year": 2027,
      "value_history.0.market_value": 30444000,
    },
    has_predicates: ["ownership.owner_of_record"],
  },
  // Los Angeles County and San Francisco: the public files carry no owner names, so no owner fact.
  {
    tool: "registry_resolve_external",
    arguments: { system: "la_ain", external_id: "5151015013" },
    expect: { urn: "fl:parcel:us-06037:5151015013" },
  },
  {
    tool: "registry_get",
    arguments: { urn: "fl:parcel:us-06037:5151015013" },
    expect: {
      status: "current",
      kind: "parcel",
      "value_history.0.tax_year": 2026,
      "value_history.0.appraised_value": 509842812,
    },
    has_predicates: ["parcel.situs_address"],
    no_predicates: ["ownership.owner_of_record"],
  },
  {
    tool: "registry_get",
    arguments: { urn: "fl:parcel:us-06075:0259026" },
    expect: {
      status: "current",
      kind: "parcel",
      "value_history.0.tax_year": 2025,
      "value_history.0.appraised_value": 1159518020,
    },
    no_predicates: ["ownership.owner_of_record"],
  },
  // The City of Boston: a hit, and a Suffolk County miss that says only the City is loaded.
  {
    tool: "registry_get",
    arguments: { urn: "fl:parcel:us-25025:0401037100" },
    expect: {
      status: "current",
      kind: "parcel",
      "value_history.0.tax_year": 2026,
      "value_history.0.market_value": 564317600,
    },
  },
  {
    tool: "registry_resolve_parcel",
    arguments: { state_fips: "25", county_fips: "025", apn: "0000000000" },
    expect: { urn: null, "coverage.county_area": "the City of Boston" },
    expect_match: { "coverage.message": "for the City of Boston only" },
  },
  {
    tool: "registry_resolve_external",
    arguments: { system: "denver_schednum", external_id: "0234513035000" },
    expect: { urn: "fl:parcel:us-08031:0234513035000" },
  },
  {
    tool: "registry_get",
    arguments: { urn: "fl:parcel:us-08031:0234513035000" },
    expect: {
      status: "current",
      kind: "parcel",
      "value_history.0.market_value": 16827500,
    },
    has_predicates: ["ownership.owner_of_record", "zoning.district"],
  },
  {
    tool: "registry_resolve_external",
    arguments: { system: "ct_cama_link", external_id: "37070-204534125" },
    expect: { urn: "fl:parcel:us-09003:37070-204534125" },
  },
  {
    tool: "registry_get",
    arguments: { urn: "fl:parcel:us-09003:37070-204534125" },
    expect: {
      status: "current",
      kind: "parcel",
      "value_history.0.tax_year": 2021,
      "value_history.0.market_value": 107600,
    },
    has_predicates: ["ownership.owner_of_record"],
  },
  // A city that lies wholly in counties the hosted registry does not hold (Bexar, Comal, Medina): a miss that says
  // so first. The search still ran over every Texas county held, so it is an answer that found nothing (counted
  // past the hourly guard), not a free one. A Houston address the registry holds only in Ector County: the result
  // is marked.
  {
    tool: "registry_search_address",
    arguments: { query: "4000 Medical Dr, San Antonio, TX", limit: 3 },
    expect: {
      "coverage.reason": "county_not_loaded",
      "coverage.state_loaded": true,
      "coverage.county_loaded": null,
      "coverage.place_counties.0": "48029",
    },
    expect_match: {
      "coverage.message": "SAN ANTONIO, TX lies in Bexar County",
    },
  },
  {
    tool: "registry_search_address",
    arguments: { query: "801 N Grant Ave, Houston, TX", limit: 3 },
    expect: {
      "results.0.urn": "fl:parcel:us-48135:06200-00050-00000",
      "results.0.place_differs": true,
      "place_counties.1": "48201",
    },
    expect_match: {
      note: "these matches are outside the counties HOUSTON, TX lies in",
    },
  },
  // Pro and Team only: without such a key each answers PlanRequired (isPaidOnlyCall), unmetered. Values from the
  // release-2026-11-13 files the pack of 2026-11-13 is built from (dc.db, work/tx.db), read with runTool.
  {
    tool: "registry_recorded_facts",
    arguments: { urn: "fl:parcel:us-11001:00020803" },
    expect: {
      urn: "fl:parcel:us-11001:00020803",
      total: 1,
      "facts.0.predicate": "transaction.sale",
      next_cursor: null,
    },
  },
  {
    tool: "registry_tx_equity_candidates_batch",
    arguments: { subjects: [{ id: "a", urn: "fl:parcel:us-48041:100022" }] },
    expect: {
      "results.0.id": "a",
      "results.0.selection.returned": 38,
      "results.0.candidates.0.id": "fl:parcel:us-48041:96141",
      "summary.answered": 1,
    },
  },
  {
    tool: "registry_lookup_batch",
    arguments: { items: [{ ref: "a", urn: "fl:parcel:us-11001:02570824" }] },
    expect: {
      "results.0.ref": "a",
      "results.0.status": "found",
      "results.0.parcel.urn": "fl:parcel:us-11001:02570824",
      "summary.found": 1,
    },
  },
];
