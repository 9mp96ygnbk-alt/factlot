// The machine-readable coverage catalog served at https://factlot.com/coverage.json: for each place the
// hosted registry answers for, its region codes, counties, parcel counts and as-of dates, the sources
// behind it with their licence, AI-use and redistribution status, the ID systems an agent can resolve
// there, and which tools answer. Every figure comes from site/_data/hosted.json (written from the served
// pack's manifest) and every rights field from the source configs in registry/sources/; nothing is typed
// here except the ID-system names, which are the crosswalk systems the registry adapters write.
import fs from "node:fs";
import path from "node:path";

import { placeLabel } from "./hosted.mjs";

export const CATALOG_URL = "https://factlot.com/coverage.json";
const API = "https://api.factlot.com";

/** Crosswalk system (what `registry_resolve_external` takes) by county FIPS, from the registry adapters. */
export const ID_SYSTEMS = {
  11001: "dc_ssl",
  36005: "nyc_bbl",
  36047: "nyc_bbl",
  36061: "nyc_bbl",
  36081: "nyc_bbl",
  36085: "nyc_bbl",
  "06037": "la_ain",
  "06075": "sf_parcel",
  25025: "boston_pid",
  "08031": "denver_schednum",
  48027: "bellcad_prop_id",
  48041: "brazoscad_prop_id",
  48061: "cameron_prop_id",
  48085: "ccad_prop_id",
  48113: "dcad_account",
  48121: "dcad_prop_id",
  48135: "ector_account_number",
  48167: "gcad_prop_id",
  48181: "grayson_prop_id",
  48187: "gcad_gco_prop_id",
  48201: "hcad_account",
  48245: "jcad_prop_id",
  48251: "johnsoncad_account",
  48257: "kaufman_prop_id",
  48329: "midland_webprop_id",
  48355: "ncad_prop_id",
  48453: "tcad_prop_id",
  48491: "wcad_property_id",
};
/** State-wide systems, used for a county with no entry above. */
const STATE_ID_SYSTEMS = {
  24: "sdat_account",
  49: "ugrc_lir",
  9: "ct_cama_link",
};

/**
 * Worked examples of an external ID and the FactLot parcel ID it resolves to, taken from the ID spec
 * (docs/id-spec.md) and the `registry_get` tool description. A test recomputes each URN with the ID library.
 */
export const ID_EXAMPLES = {
  nyc_bbl: {
    external_id: "3-1234-56",
    state_fips: "36",
    county_fips: "047",
    apn: "3-1234-56",
    note: "A borough-block-lot; hyphenated and fixed-width forms give the same ID.",
  },
  la_ain: {
    external_id: "5432-1-12",
    state_fips: "06",
    county_fips: "037",
    apn: "5432-1-12",
    note: "An Assessor ID number; hyphenated and fixed-width forms give the same ID.",
  },
  dc_ssl: {
    external_id: "0442 0842",
    state_fips: "11",
    county_fips: "001",
    apn: "0442 0842",
    note: "Square, suffix and lot; spaced and hyphenated forms give the same ID.",
  },
  hcad_account: {
    external_id: "0011440000001",
    state_fips: "48",
    county_fips: "201",
    apn: "0011440000001",
    note: "A Harris CAD account number, as in the registry_get tool description.",
  },
};

/** The source config a hosted source id belongs to, and the id with a trailing -YYYY (a roll year) removed. */
export function sourceFamily(id) {
  return id.replace(/-(?:19|20)\d\d$/, "");
}

/**
 * The config record whose rights a hosted source id carries: the id itself, then (dropping a trailing roll year
 * or word, such as -2024 or -buildings, one segment at a time) an exact record, then that record's latest year.
 */
export function resolveSource(id, configs) {
  let fam = id;
  for (;;) {
    if (configs.has(fam)) return configs.get(fam);
    const years = [...configs.keys()]
      .filter((k) => k.startsWith(`${fam}-`) && /-(?:19|20)\d\d$/.test(k))
      .sort();
    if (years.length) return configs.get(years.at(-1));
    const cut = fam.lastIndexOf("-");
    if (cut < 0) return undefined;
    fam = fam.slice(0, cut);
  }
}

const REGISTRY_TOOLS = [
  "registry_coverage",
  "registry_get",
  "registry_resolve_parcel",
  "registry_resolve_external",
  "registry_search_address",
  "registry_lookup_batch",
];
const ENTITY_TOOLS = ["registry_search_entities", "registry_owned_by"];
const TX_TOOLS = [
  "registry_tx_equity_candidates",
  "registry_tx_equity_candidates_batch",
  "rules_tx_property_tax_protest_deadline",
  "rules_tx_property_tax_protest_deadline_batch",
];

/**
 * @param {{hosted: object, fields?: object, configs: Map<string, object>, toolNames: string[], version: string, idExampleUrn: (e: object) => string}} input
 *
 * `fields`: site/_data/fields.json; each county then carries `fields` (the share of its parcels with each fact group,
 * and its roll years with the value types of each), as registry_coverage does.
 */
export function buildCoverageCatalog({
  hosted,
  fields,
  configs,
  toolNames,
  version,
  idExampleUrn,
}) {
  const known = new Set(toolNames);
  const countyByFips = new Map(hosted.counties.map((c) => [c.fips, c]));
  const fieldsByFips = new Map(
    (fields?.counties ?? []).map((c) => [c.fips, c]),
  );
  const fieldsOf = (fips) => {
    const f = fieldsByFips.get(fips);
    if (!f) return {};
    return {
      fields: {
        shares: Object.fromEntries(
          Object.entries(f.groups).map(([g, s]) => [g, s.share]),
        ),
        roll_years: f.roll_years.map((y) => ({
          tax_year: y.tax_year,
          value_types: y.value_types,
          parcels: y.parcels,
          as_of: y.files[0]?.as_of ?? null,
          ...(y.preliminary ? { preliminary: true } : {}),
        })),
      },
    };
  };
  const entityJurisdictions = new Set(
    hosted.entity_registries.map((r) => r.jurisdiction),
  );
  const places = hosted.places.map((p) => {
    const counties = p.counties.map((f) => countyByFips.get(f));
    const states = [...new Set(counties.map((c) => c.state))].sort();
    const families = new Map();
    for (const c of counties)
      for (const id of c.sources) {
        const fam = sourceFamily(id);
        if (!families.has(fam)) families.set(fam, new Set());
        families.get(fam).add(id);
      }
    const sources = [...families.entries()].sort().map(([fam, ids]) => {
      const cfg = resolveSource([...ids][0], configs);
      return {
        source_id: fam,
        hosted_source_ids: [...ids].sort(),
        publisher: cfg?.publisher ?? null,
        terms_url: cfg?.terms_url ?? null,
        license: cfg?.license ?? null,
        ai_use: cfg?.ai_use ?? null,
        redistribution: cfg?.redistribution ?? null,
        rights_reviewed: cfg?.reviewed ?? null,
        rights_record:
          cfg === undefined
            ? null
            : `https://github.com/9mp96ygnbk-alt/factlot/blob/main/registry/sources/${cfg.dir}/${cfg.file}`,
      };
    });
    const idSystems = [];
    for (const c of counties) {
      // null: no external crosswalk system is recorded here; the FactLot parcel URN (county FIPS and APN) still resolves.
      const system =
        ID_SYSTEMS[c.fips] ??
        STATE_ID_SYSTEMS[Number(c.fips.slice(0, 2))] ??
        null;
      if (!idSystems.some((s) => s.system === system))
        idSystems.push({ system, county_fips: [] });
      idSystems.find((s) => s.system === system).county_fips.push(c.fips);
    }
    for (const s of idSystems) {
      const e = ID_EXAMPLES[s.system ?? ""];
      s.example = e
        ? {
            external_id: e.external_id,
            parcel_urn: idExampleUrn(e),
            note: e.note,
          }
        : null;
    }
    const hasEntities = states.some((s) =>
      entityJurisdictions.has(`us-${s.toLowerCase()}`),
    );
    const tools = [
      ...REGISTRY_TOOLS,
      ...(hasEntities ? ENTITY_TOOLS : []),
      ...(states.includes("TX") ? TX_TOOLS : []),
    ].filter((t) => known.has(t));
    return {
      id: p.key,
      name: placeLabel(hosted, p),
      region_codes: states.map((s) => `US-${s}`),
      state_fips: [...new Set(p.counties.map((f) => f.slice(0, 2)))].sort(),
      parcels: p.parcels,
      buildings: p.buildings,
      as_of: p.as_of,
      counties: counties.map((c) => ({
        fips: c.fips,
        name: c.name,
        state: c.state,
        parcels: c.parcels,
        buildings: c.buildings,
        as_of: c.as_of,
        sources: [...c.sources].sort(),
        ...fieldsOf(c.fips),
      })),
      sources,
      id_systems: idSystems,
      tools,
    };
  });
  return {
    name: "FactLot hosted registry coverage",
    description:
      "The places the FactLot hosted registry answers for (registry_* tools on https://api.factlot.com), with sources, rights and ID systems. A miss outside these places means not loaded, not absent; registry_coverage on the API is the live answer for the pack being served.",
    catalog_url: CATALOG_URL,
    version,
    generated_from: [
      "site/_data/hosted.json",
      ...(fields ? ["site/_data/fields.json"] : []),
      "registry/sources/*/*.json",
      "spec/schemas/tools.json",
    ],
    pack_built_at: hosted.pack_built_at,
    links: {
      mcp: `${API}/mcp`,
      openapi: `${API}/openapi.json`,
      llms_txt: "https://factlot.com/llms.txt",
      coverage_page: "https://factlot.com/coverage/",
      coverage_by_county: "https://factlot.com/coverage/counties.json",
      rights_table:
        "https://github.com/9mp96ygnbk-alt/factlot/blob/main/docs/registry/rights.md",
      pricing: "https://factlot.com/pricing/",
    },
    totals: hosted.totals,
    ...(fields
      ? {
          fields_note:
            "Fields differ by county. Each county's fields.shares gives, per fact group, the share of its parcels with at least one fact of that group (1: every parcel, 0: none); fields.roll_years lists the tax years held with their value types, parcels and newest file date, and preliminary: true where the roll is preliminary. Owners of record are organisations only.",
          fact_groups: fields.groups,
        }
      : {}),
    places,
    entity_registries: hosted.entity_registries,
    withheld: hosted.withheld,
    withheld_note: hosted.text.withheld,
    partial: hosted.partial,
  };
}

/** Every source record under registry/sources/<dir>/*.json, by source_id, with the file it came from. */
export function loadSourceConfigs(root) {
  const base = path.join(root, "registry/sources");
  const out = new Map();
  for (const dir of fs.readdirSync(base).sort()) {
    const d = path.join(base, dir);
    if (!fs.statSync(d).isDirectory()) continue;
    for (const file of fs
      .readdirSync(d)
      .filter((f) => f.endsWith(".json"))
      .sort())
      for (const s of JSON.parse(fs.readFileSync(path.join(d, file), "utf8"))
        .sources ?? [])
        out.set(s.source_id, { ...s, dir, file });
  }
  return out;
}
