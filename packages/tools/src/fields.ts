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
  neighborhood_and_class: "neighborhood or building class codes",
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
  /** Parcels this file gives a value of the year: any value, market value, appraised value. */
  parcels: number;
  market_value: number;
  appraised_value: number;
}

export interface RollYear {
  /** null: the file's values carry no tax year. */
  tax_year: number | null;
  /**
   * Parcels with a market or appraised value of this tax year in any file (a value in the same file as the parcel's
   * tax-year fact). For a year of null: the most parcels one such file gives a value for.
   */
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
  /**
   * Region → parcels of a county this file holds no parcel of that an `owns` link in this file points at (an entity
   * file whose owners' parcels are in another file). The pack builder adds them to that county's entity_links.
   */
  entity_links_elsewhere: Record<string, number>;
}

const share = (n: number, of: number): number =>
  of ? Math.round((n / of) * 1000) / 1000 : 0;

/** A file's as-of date as a year, or null when it is not a YYYY-MM-DD date. */
function asOfYear(asOf: string): number | null {
  return /^\d{4}-\d{2}-\d{2}/.test(asOf) ? Number(asOf.slice(0, 4)) : null;
}

/**
 * What a file says about its roll (`value_roll` in Python). Null when the as-of date is not a date. "preliminary":
 * "prelim" in the file name, or a Texas file (source ID "tx-...") whose tax year is later than the year of its as-of
 * date (a Texas roll values property as of January 1 of its tax year and is certified in that year). Otherwise null
 * when the name says pre-certified, uncertified, non-certified or estimate; "certified" when a word of the name
 * starts with "certif" or the name holds "certf"; else null.
 */
export function rollOf(
  sourceId: string,
  filename: string | null,
  taxYear: number | null,
  asOf: string,
): "preliminary" | "certified" | null {
  const y = asOfYear(asOf);
  if (y === null) return null;
  const name = filename ?? "";
  if (
    /prelim/i.test(name) ||
    (sourceId.startsWith("tx-") && taxYear !== null && taxYear > y)
  )
    return "preliminary";
  if (/pre-?cert|un-?cert|non-?cert|estimate/i.test(name)) return null;
  if (/(?:^|[^a-z])certif|certf/i.test(name)) return "certified";
  return null;
}

/** A file name as it is shown: URL-decoded when it holds only valid escapes, else as stored. */
export function displayFilename(name: string | null): string | null {
  if (name === null || !name.includes("%")) return name;
  if (/%(?![0-9A-Fa-f]{2})/.test(name)) return name;
  try {
    return decodeURIComponent(name);
  } catch {
    return name;
  }
}

/** A snapshot as value-history labels use it (manifest `value_files`, or the snapshots table). */
export interface ValueFile {
  source_id: string;
  filename: string | null;
  as_of: string;
  /** The date the registry read the file (the date part of snapshots.retrieved_at). */
  read_on: string;
}

const LABEL_KEYS = ["value_types", "file", "roll", "notes"];

/** Value-history entries without their labels: what a pack stores (labelValueHistory puts them back). */
export function unlabelValueHistory(entries: unknown): unknown {
  if (!Array.isArray(entries)) return entries;
  return entries.map((e: Row) =>
    Object.fromEntries(
      Object.entries(e).filter(([k]) => !LABEL_KEYS.includes(k)),
    ),
  );
}

const span = (a: number, b: number) => (a === b ? String(a) : `${a} to ${b}`);

/**
 * Value-history entries (newest first) with their labels (`label_value_history` in Python): the value types present,
 * the file the values were read from (its name URL-decoded for display), the roll as rollOf reads it, and notes that
 * state only what the file and the entries show: a file whose as-of date is the day the registry read it, a file
 * dated after the year following its roll year, and, on the older of two entries, tax years between them with no
 * value. An entry's notes name no file or date of another entry. `fileOf` gives the file of a document ID.
 */
export function labelValueHistory(
  entries: Row[],
  fileOf: (documentId: string) => ValueFile | undefined,
): Row[] {
  const out = entries.map((e) => {
    const cites = (e.citations ?? {}) as Record<string, Row | null>;
    const cite = cites.market_value ?? cites.appraised_value ?? null;
    const f = cite ? fileOf(String(cite.document_id)) : undefined;
    const ty = typeof e.tax_year === "number" ? e.tax_year : null;
    const types: string[] = [];
    if (e.market_value !== null && e.market_value !== undefined)
      types.push("market");
    if (e.appraised_value !== null && e.appraised_value !== undefined)
      types.push("appraised");
    const notes: string[] = [];
    if (f) {
      const y = asOfYear(f.as_of);
      if (y !== null && f.as_of === f.read_on)
        notes.push(
          `${f.as_of}, this file's as-of date, is the day the registry read it.`,
        );
      if (y !== null && ty !== null && y > ty + 1)
        notes.push(
          `This ${ty} value comes from a file dated ${f.as_of}, after the ${ty} roll year: it is the roll as the publisher held it on that date, which can differ from the roll as certified.`,
        );
    }
    return {
      ...e,
      value_types: types,
      file: f
        ? {
            source_id: f.source_id,
            filename: displayFilename(f.filename),
            as_of: f.as_of,
            read_on: f.read_on,
          }
        : null,
      roll: f ? rollOf(f.source_id, f.filename, ty, f.as_of) : null,
      notes,
    } as Row;
  });
  out.forEach((e, i) => {
    const ty = e.tax_year;
    if (typeof ty !== "number") return;
    const newer = out
      .slice(0, i)
      .reverse()
      .find((x) => typeof x.tax_year === "number" && x.tax_year !== ty);
    const ny = newer?.tax_year as number | undefined;
    if (ny !== undefined && ny > ty + 1)
      (e.notes as string[]).push(
        `The registry holds no value of this parcel for ${span(ty + 1, ny - 1)}, between this ${ty} entry and the ${ny} entry.`,
      );
  });
  return out;
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

  // Value facts by county, file and tax year. A tax year's counts are the parcels with a value in the same file as
  // their tax-year fact; a file with values and no tax-year fact at all makes a year of null.
  const snaps = new Map<string, Row>();
  for (const r of d
    .prepare(
      "SELECT document_id, source_id, filename, as_of, retrieved_at FROM snapshots",
    )
    .all())
    snaps.set(String(r.document_id), r);
  interface Counts {
    parcels: number;
    market: number;
    appraised: number;
  }
  // region → document → tax year (null: none in the file) → counts
  const docs = new Map<string, Map<string, Map<number | null, Counts>>>();
  // region → tax year → parcels with a value of that year in any file
  const valued = new Map<string, Map<number, number>>();
  const at = (region: string, doc: string) => {
    const byDoc = docs.get(region) ?? new Map();
    docs.set(region, byDoc);
    const byYear = byDoc.get(doc) ?? new Map<number | null, Counts>();
    byDoc.set(doc, byYear);
    return byYear as Map<number | null, Counts>;
  };
  const year = (v: unknown): number | null => {
    const y = Number(JSON.parse(String(v)));
    return Number.isInteger(y) ? y : null;
  };
  const has = (predicate: string) =>
    `EXISTS (SELECT 1 FROM facts m WHERE m.subject = t.subject AND m.predicate = '${predicate}' AND m.document_id = t.document_id)`;
  for (const r of d
    .prepare(
      "WITH ty AS (SELECT substr(subject, 11, 8) AS region, subject, document_id, value_json AS v, " +
        `${has("parcel.market_value")} AS mk, ${has("parcel.appraised_value")} AS ap FROM facts t ` +
        "WHERE subject >= 'fl:parcel:' AND subject < 'fl:parcel;' AND predicate = 'parcel.tax_year') " +
        "SELECT region, document_id, v, SUM(mk OR ap) AS n, SUM(mk) AS mk, SUM(ap) AS ap FROM ty GROUP BY region, document_id, v " +
        "UNION ALL SELECT region, NULL, v, COUNT(DISTINCT subject), 0, 0 FROM ty WHERE mk OR ap GROUP BY region, v",
    )
    .all()) {
    const region = String(r.region);
    const y = year(r.v);
    if (y === null) continue;
    if (r.document_id === null) {
      const m = valued.get(region) ?? new Map<number, number>();
      m.set(y, Number(r.n));
      valued.set(region, m);
      continue;
    }
    if (!Number(r.n)) continue;
    const byYear = at(region, String(r.document_id));
    const c = byYear.get(y) ?? { parcels: 0, market: 0, appraised: 0 };
    c.parcels += Number(r.n);
    c.market += Number(r.mk);
    c.appraised += Number(r.ap);
    byYear.set(y, c);
  }
  // Files with values and no tax-year fact.
  for (const r of d
    .prepare(
      "SELECT substr(subject, 11, 8) AS region, document_id, COUNT(DISTINCT subject) AS n, " +
        "COUNT(DISTINCT CASE WHEN predicate = 'parcel.market_value' THEN subject END) AS mk, " +
        "COUNT(DISTINCT CASE WHEN predicate = 'parcel.appraised_value' THEN subject END) AS ap FROM facts " +
        "WHERE subject >= 'fl:parcel:' AND subject < 'fl:parcel;' AND predicate IN ('parcel.market_value', 'parcel.appraised_value') " +
        "GROUP BY region, document_id",
    )
    .all()) {
    const byDoc = docs.get(String(r.region));
    if (byDoc?.has(String(r.document_id))) continue;
    at(String(r.region), String(r.document_id)).set(null, {
      parcels: Number(r.n),
      market: Number(r.mk),
      appraised: Number(r.ap),
    });
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
    for (const [doc, byYear] of docs.get(region) ?? []) {
      const s = snaps.get(doc);
      for (const [y, c] of byYear) {
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
          parcels: c.parcels,
          market_value: c.market,
          appraised_value: c.appraised,
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
          parcels:
            tax_year === null
              ? files.reduce((a, f) => Math.max(a, f.parcels), 0)
              : (valued.get(region)?.get(tax_year) ?? 0),
          value_types: types,
          preliminary: files.every((f) => f.roll === "preliminary"),
          files,
        };
      });
    return { region, parcels: n, groups, roll_years };
  });
  const entity_links_elsewhere: Record<string, number> = {};
  for (const [region, m] of counts) {
    const k = m.get("entity_links");
    if (k && !parcels.has(region)) entity_links_elsewhere[region] = k;
  }
  return { counties, entity_links_elsewhere };
}

/**
 * Counties' field availability from several files of one pack: each county's own, with the `owns` links other files
 * hold to its parcels added to entity_links (at most its parcels).
 */
export function mergeFieldLinks(
  counties: CountyFields[],
  elsewhere: Record<string, number>[],
): CountyFields[] {
  return counties.map((c) => {
    const more = elsewhere.reduce((a, e) => a + (e[c.region] ?? 0), 0);
    if (!more) return c;
    const k = Math.min(c.parcels, c.groups.entity_links.parcels + more);
    return {
      ...c,
      groups: {
        ...c.groups,
        entity_links: { parcels: k, share: share(k, c.parcels) },
      },
    };
  });
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
 * The compact form registry_coverage carries per county: the share of each fact group the county holds (1 every
 * parcel; a group not listed: no parcel has it), and each roll year with its value types, newest file as-of date and
 * whether it is preliminary.
 */
export function compactFields(c: CountyFields): Row {
  return {
    shares: Object.fromEntries(
      FACT_GROUPS.filter((g) => c.groups[g].share > 0).map((g) => [
        g,
        c.groups[g].share,
      ]),
    ),
    roll_years: c.roll_years.map((y) => ({
      tax_year: y.tax_year,
      value_types: y.value_types,
      as_of: y.files[0]?.as_of ?? null,
      ...(y.preliminary ? { preliminary: true } : {}),
    })),
  };
}
