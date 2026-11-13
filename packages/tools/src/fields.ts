/**
 * Field availability: which groups of facts a registry file holds for each county, for what share of its parcels,
 * and which roll years it holds with the value type of each. Computed from the file's tables, never typed: the pack
 * builder (scripts/registry/pack.ts) puts it in the manifest, the hosted registry_coverage answer carries it, and
 * scripts/site/gen-fields.ts writes site/_data/fields.json from it for the coverage, market and Texas pages.
 *
 * A parcel counts for a group when the file holds at least one fact of the group for it (current or from an earlier
 * file), and for entity links when an `owns` link points at it. Roll years come from the `parcel.tax_year` facts of
 * each file (a file with values and no tax year makes a year of null); a file is "preliminary" when its name says so
 * (prelim, _current) or, for a Texas appraisal-district file, its tax year is later than the year of its as-of date
 * (a Texas roll values property as of January 1 of its tax year and is certified in that year), "certified" when its
 * name says certified, and dated "read" when its as-of date is the day the registry read it (snapshots.retrieved_at)
 * rather than a date the publisher gave.
 */

type Row = Record<string, unknown>;
interface Statement {
  all(...params: unknown[]): Row[];
}
export interface FieldsDatabase {
  prepare(sql: string): Statement;
}

/** The fact groups, each with the predicates that make it (a trailing "." is a prefix). */
export const FIELD_GROUPS = {
  owner_of_record: ["ownership.owner_of_record"],
  owner_mailing_address: ["ownership.owner_mailing_address"],
  market_value: ["parcel.market_value"],
  appraised_value: ["parcel.appraised_value"],
  building_facts: [
    "parcel.improvement_area_sf",
    "parcel.year_built",
    "parcel.num_floors",
    "parcel.num_buildings",
    "parcel.units_total",
    "parcel.units_residential",
    "parcel.year_altered",
    "parcel.area_by_use_sf",
    "parcel.built_far",
  ],
  neighborhood_and_class: ["parcel.neighborhood_code", "parcel.building_class"],
  zoning: ["zoning."],
  recorded_sales: ["transaction.sale"],
  deeds_and_mortgages: [
    "transaction.deed",
    "debt.mortgage_recorded",
    "debt.mortgage_satisfaction_recorded",
  ],
  energy_benchmarks: ["energy."],
} as const;

export type FactGroup = keyof typeof FIELD_GROUPS | "entity_links";
export const FACT_GROUPS: FactGroup[] = [
  ...(Object.keys(FIELD_GROUPS) as (keyof typeof FIELD_GROUPS)[]),
  "entity_links",
];

/** Plain words for each group, as the pages and the coverage answer name them. */
export const FACT_GROUP_LABELS: Record<FactGroup, string> = {
  owner_of_record: "owner of record",
  owner_mailing_address: "owner mailing address",
  market_value: "market value",
  appraised_value: "appraised value",
  building_facts: "building facts (area, year built, floors or units)",
  neighborhood_and_class: "neighborhood and building class codes",
  zoning: "zoning",
  recorded_sales: "recorded sales",
  deeds_and_mortgages: "recorded deeds and mortgages",
  energy_benchmarks: "energy benchmarks",
  entity_links: "links to a company registry",
};

export interface GroupShare {
  /** Parcels of the county with at least one fact of the group. */
  parcels: number;
  /** parcels / the county's parcels, rounded to 3 decimals (0 only when no parcel has it). */
  share: number;
}

export interface RollFile {
  source_id: string;
  filename: string | null;
  as_of: string;
  /** The date the registry read the file (snapshots.retrieved_at). */
  read_on: string;
  /** "read": the file's as-of date is the day the registry read it, not a date the publisher gave. */
  dated: "file" | "read";
  /** From the file name or dates, as the module comment says; null when neither says. */
  roll: "preliminary" | "certified" | null;
  parcels: number;
  market_value: number;
  appraised_value: number;
}

export interface RollYear {
  /** null: the file's values carry no tax year. */
  tax_year: number | null;
  /** Parcels with a value of this tax year in any file. */
  parcels: number;
  value_types: ("market" | "appraised")[];
  /** Every file of this year preliminary. */
  preliminary: boolean;
  files: RollFile[];
}

export interface CountyFields {
  region: string;
  parcels: number;
  groups: Record<FactGroup, GroupShare>;
  /** Newest year first. */
  roll_years: RollYear[];
}

export interface RegistryFields {
  counties: CountyFields[];
}

const share = (n: number, of: number): number =>
  of ? Math.round((n / of) * 1000) / 1000 : 0;

/**
 * "preliminary": "prelim" or "_current" in the file name, or a Texas file (source ID "tx-...") whose tax year is later
 * than the year of its as-of date; "certified": "certif", "certf" or "cert_" in the file name; else null.
 */
export function rollOf(
  sourceId: string,
  filename: string | null,
  taxYear: number | null,
  asOf: string,
): "preliminary" | "certified" | null {
  const name = filename ?? "";
  if (
    /prelim|_current/i.test(name) ||
    (sourceId.startsWith("tx-") &&
      taxYear !== null &&
      taxYear > Number(asOf.slice(0, 4)))
  )
    return "preliminary";
  if (/certif|certf|cert[_-]/i.test(name)) return "certified";
  return null;
}

function groupCase(): string {
  const arms: string[] = [];
  for (const [g, preds] of Object.entries(FIELD_GROUPS)) {
    const exact = preds.filter((p) => !p.endsWith("."));
    const prefixes = preds.filter((p) => p.endsWith("."));
    const conds = [
      ...(exact.length
        ? [`predicate IN (${exact.map((p) => `'${p}'`).join(", ")})`]
        : []),
      ...prefixes.map(
        (p) => `(predicate >= '${p}' AND predicate < '${p.slice(0, -1)}/')`,
      ),
    ];
    arms.push(`WHEN ${conds.join(" OR ")} THEN '${g}'`);
  }
  return `CASE ${arms.join(" ")} END`;
}

/** The field availability of a registry file, one entry per county that holds parcels, in region order. */
export function fieldAvailability(d: FieldsDatabase): RegistryFields {
  const parcels = new Map<string, number>();
  for (const r of d
    .prepare(
      "SELECT substr(urn, 11, 8) AS region, COUNT(*) AS n FROM subjects WHERE kind = 'parcel' GROUP BY region ORDER BY region",
    )
    .all())
    parcels.set(String(r.region), Number(r.n));
  const counts = new Map<string, Map<FactGroup, number>>();
  const add = (region: string, g: FactGroup, n: number) => {
    const m = counts.get(region) ?? new Map<FactGroup, number>();
    m.set(g, n);
    counts.set(region, m);
  };
  for (const r of d
    .prepare(
      `SELECT region, g, COUNT(*) AS n FROM (SELECT DISTINCT substr(subject, 11, 8) AS region, subject, ${groupCase()} AS g ` +
        "FROM facts WHERE subject >= 'fl:parcel:' AND subject < 'fl:parcel;') WHERE g IS NOT NULL GROUP BY region, g",
    )
    .all())
    add(String(r.region), String(r.g) as FactGroup, Number(r.n));
  for (const r of d
    .prepare(
      "SELECT substr(to_urn, 11, 8) AS region, COUNT(DISTINCT to_urn) AS n FROM relationships " +
        "WHERE type = 'owns' AND to_urn >= 'fl:parcel:' AND to_urn < 'fl:parcel;' GROUP BY region",
    )
    .all())
    add(String(r.region), "entity_links", Number(r.n));

  // Value facts by county, file and tax year.
  const snaps = new Map<string, Row>();
  for (const r of d
    .prepare(
      "SELECT document_id, source_id, filename, as_of, retrieved_at FROM snapshots",
    )
    .all())
    snaps.set(String(r.document_id), r);
  type DocCounts = {
    years: Map<number, number>;
    market: number;
    appraised: number;
  };
  const docs = new Map<string, Map<string, DocCounts>>();
  for (const r of d
    .prepare(
      "SELECT substr(subject, 11, 8) AS region, document_id, predicate, " +
        "CASE WHEN predicate = 'parcel.tax_year' THEN value_json END AS v, COUNT(DISTINCT subject) AS n FROM facts " +
        "WHERE subject >= 'fl:parcel:' AND subject < 'fl:parcel;' AND predicate IN " +
        "('parcel.tax_year', 'parcel.market_value', 'parcel.appraised_value') GROUP BY region, document_id, predicate, v",
    )
    .all()) {
    const region = String(r.region);
    const byDoc = docs.get(region) ?? new Map<string, DocCounts>();
    docs.set(region, byDoc);
    const doc = String(r.document_id);
    const c = byDoc.get(doc) ?? { years: new Map(), market: 0, appraised: 0 };
    byDoc.set(doc, c);
    const n = Number(r.n);
    if (r.predicate === "parcel.market_value") c.market += n;
    else if (r.predicate === "parcel.appraised_value") c.appraised += n;
    else {
      const y = Number(JSON.parse(String(r.v)));
      if (Number.isInteger(y)) c.years.set(y, (c.years.get(y) ?? 0) + n);
    }
  }

  const counties: CountyFields[] = [...parcels].map(([region, n]) => {
    const m = counts.get(region) ?? new Map<FactGroup, number>();
    const groups = Object.fromEntries(
      FACT_GROUPS.map((g) => {
        const k = m.get(g) ?? 0;
        return [g, { parcels: k, share: share(k, n) }];
      }),
    ) as Record<FactGroup, GroupShare>;
    const years = new Map<number | null, RollFile[]>();
    for (const [doc, c] of docs.get(region) ?? []) {
      if (!c.market && !c.appraised) continue;
      const s = snaps.get(doc);
      const byYear: [number | null, number][] = c.years.size
        ? [...c.years]
        : [[null, Math.max(c.market, c.appraised)]];
      for (const [y, k] of byYear) {
        const asOf = String(s?.as_of ?? "");
        const readOn = String(s?.retrieved_at ?? "").slice(0, 10);
        const filename =
          s?.filename === null || s?.filename === undefined
            ? null
            : String(s.filename);
        const sourceId = String(s?.source_id ?? "");
        const file: RollFile = {
          source_id: sourceId,
          filename,
          as_of: asOf,
          read_on: readOn,
          dated: asOf && asOf === readOn ? "read" : "file",
          roll: rollOf(sourceId, filename, y, asOf),
          parcels: k,
          market_value: Math.min(c.market, k),
          appraised_value: Math.min(c.appraised, k),
        };
        const list = years.get(y) ?? [];
        // One entry per file as a reader sees it: the pages of one query or download are summed.
        const same = list.find(
          (f) =>
            f.source_id === file.source_id &&
            f.filename === file.filename &&
            f.as_of === file.as_of &&
            f.read_on === file.read_on,
        );
        if (same) {
          same.parcels += file.parcels;
          same.market_value += file.market_value;
          same.appraised_value += file.appraised_value;
        } else list.push(file);
        years.set(y, list);
      }
    }
    const roll_years: RollYear[] = [...years]
      .sort((a, b) =>
        a[0] === null || b[0] === null
          ? (a[0] === null ? 1 : 0) - (b[0] === null ? 1 : 0)
          : b[0] - a[0],
      )
      .map(([tax_year, files]) => {
        files.sort(
          (a, b) =>
            (a.as_of < b.as_of ? 1 : a.as_of > b.as_of ? -1 : 0) ||
            (a.source_id < b.source_id
              ? -1
              : a.source_id > b.source_id
                ? 1
                : 0),
        );
        const types: ("market" | "appraised")[] = [];
        if (files.some((f) => f.market_value)) types.push("market");
        if (files.some((f) => f.appraised_value)) types.push("appraised");
        return {
          tax_year,
          parcels: Math.min(
            n,
            files.reduce((a, f) => Math.max(a, f.parcels), 0),
          ),
          value_types: types,
          preliminary: files.every((f) => f.roll === "preliminary"),
          files,
        };
      });
    return { region, parcels: n, groups, roll_years };
  });
  return { counties };
}

/** "2022 to 2025" for consecutive years, else "2016, 2018 and 2020". */
export function yearsText(years: number[]): string {
  const ys = [...new Set(years)].sort((a, b) => a - b);
  if (!ys.length) return "";
  if (ys.length === 1) return String(ys[0]);
  if (ys[ys.length - 1]! - ys[0]! === ys.length - 1)
    return `${ys[0]} to ${ys[ys.length - 1]}`;
  return `${ys.slice(0, -1).join(", ")} and ${ys[ys.length - 1]}`;
}

/**
 * The compact form registry_coverage carries per county: each group's share (1 every parcel, 0 none), and each roll
 * year with its value types, newest file as-of date and whether it is preliminary.
 */
export function compactFields(c: CountyFields): Row {
  return {
    shares: Object.fromEntries(FACT_GROUPS.map((g) => [g, c.groups[g].share])),
    roll_years: c.roll_years.map((y) => ({
      tax_year: y.tax_year,
      value_types: y.value_types,
      as_of: y.files[0]?.as_of ?? null,
      ...(y.preliminary ? { preliminary: true } : {}),
    })),
  };
}
