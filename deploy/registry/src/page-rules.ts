/**
 * Which hosted parcels get a public property page, and from which facts. Shared by the registry Worker (the
 * sitemap enumeration, pages.ts) and the API Worker (the page itself, deploy/cloudflare/src/property-pages.ts), so
 * a URL is listed in a sitemap exactly when its page renders. Plain TypeScript with no imports: both Workers
 * bundle it.
 *
 * The rule: a page shows a fixed set of parcel facts and the current roll year's values. Every source that
 * contributes one of them must record `redistribution` as `permitted` or `attribution_required`; a source recorded
 * otherwise (`unknown`) blocks the page unless its source id is listed explicitly (PROPERTY_PAGES_EXTRA_SOURCES).
 * A fact or value whose rights cannot be read blocks the page too.
 */

export interface Rights {
  ai_use?: string;
  redistribution?: string;
  license?: string;
  attribution?: string;
}

export interface FactSource {
  document_id: string;
  title?: string;
  uri?: string;
  retrieved_at?: string;
  section?: string;
}

export interface Fact {
  id?: string;
  subject?: string;
  predicate: string;
  value: unknown;
  as_of?: string;
  unit?: string;
  provenance?: { sources?: FactSource[] };
  rights?: Rights;
}

export interface Citation {
  fact_id?: string;
  document_id?: string;
  locator?: string;
  as_of?: string;
}

export interface ValueEntry {
  tax_year?: number;
  market_value?: number | null;
  appraised_value?: number | null;
  as_of?: string;
  citations?: Record<string, Citation | undefined>;
  /** "preliminary" or "certified" where the registry marks the roll (value_history's `roll`). */
  roll?: string | null;
  /** The file the values were read from (value_history's `file`). */
  file?: { as_of?: string; read_on?: string; filename?: string | null } | null;
}

export interface PageRecord {
  urn: string;
  facts?: Fact[];
  relationships?: Record<string, unknown>[];
  crosswalk?: { system: string; external_id: string }[];
  value_history?: ValueEntry[];
  [k: string]: unknown;
}

/** The parcel facts a page shows (besides the roll values, which come from value_history). */
export const PAGE_PARCEL_PREDICATES = [
  "parcel.situs_address",
  "parcel.apn",
  "parcel.state_property_category",
  "parcel.local_use_code",
  "parcel.land_area_sf",
  "parcel.improvement_area_sf",
  "parcel.year_built",
  "parcel.building_class",
  "parcel.neighborhood_code",
  "parcel.tax_year",
  "ownership.owner_of_record",
] as const;

/** The value facts a page shows when the record has no value_history. */
export const VALUE_PREDICATES = [
  "parcel.market_value",
  "parcel.appraised_value",
] as const;

/** The entity facts a page shows for a linked owner. */
export const PAGE_ENTITY_PREDICATES = ["entity.legal_name"] as const;

const OPEN_REDISTRIBUTION = new Set(["permitted", "attribution_required"]);

/** One source document behind a shown fact or value, with the rights recorded on it (null when unreadable). */
export interface SourceRef {
  document_id: string;
  subject: string;
  as_of: string;
  rights: Rights | null;
}

/** The value_history entries a keyless caller keeps (the newest tax year; the first entry when none has a year). */
export function currentValueEntries(vh: unknown): ValueEntry[] {
  if (!Array.isArray(vh) || vh.length === 0) return [];
  const entries = vh as ValueEntry[];
  const years = entries
    .map((e) => e?.tax_year)
    .filter((y): y is number => typeof y === "number");
  if (years.length === 0) return entries.slice(0, 1);
  const current = Math.max(...years);
  return entries.filter((e) => e?.tax_year === current);
}

/** The record's facts of the given predicates (the record holds current facts only). */
export function factsOf(
  rec: PageRecord,
  predicates: readonly string[],
): Fact[] {
  const want = new Set(predicates);
  return (rec.facts ?? []).filter((f) => f && want.has(f.predicate));
}

function refsOfFact(f: Fact, subject: string): SourceRef[] {
  const sources = f.provenance?.sources ?? [];
  if (sources.length === 0)
    return [{ document_id: "", subject, as_of: f.as_of ?? "", rights: null }];
  return sources.map((s) => ({
    document_id: s.document_id,
    subject,
    as_of: f.as_of ?? "",
    rights: f.rights ?? null,
  }));
}

/**
 * The source documents behind what a parcel page shows: its PAGE_PARCEL_PREDICATES facts and the current roll
 * values. A value's rights are the rights of the fact it cites (or of another fact citing the same document).
 */
export function parcelPageRefs(rec: PageRecord): SourceRef[] {
  const refs: SourceRef[] = [];
  for (const f of factsOf(rec, PAGE_PARCEL_PREDICATES))
    refs.push(...refsOfFact(f, rec.urn));
  const byFact = new Map<string, Fact>();
  const byDoc = new Map<string, Rights>();
  for (const f of rec.facts ?? []) {
    if (f?.id) byFact.set(f.id, f);
    for (const s of f?.provenance?.sources ?? [])
      if (f.rights && !byDoc.has(s.document_id))
        byDoc.set(s.document_id, f.rights);
  }
  const entries = currentValueEntries(rec.value_history);
  // Without value_history a page shows the current value facts instead.
  if (entries.length === 0)
    for (const f of factsOf(rec, VALUE_PREDICATES))
      refs.push(...refsOfFact(f, rec.urn));
  for (const e of entries)
    for (const field of ["market_value", "appraised_value"] as const) {
      if (typeof e[field] !== "number") continue;
      const c = e.citations?.[field];
      const doc = c?.document_id ?? "";
      const rights =
        (c?.fact_id ? byFact.get(c.fact_id)?.rights : undefined) ??
        byDoc.get(doc) ??
        null;
      refs.push({
        document_id: doc,
        subject: rec.urn,
        as_of: c?.as_of ?? e.as_of ?? "",
        rights,
      });
    }
  return refs;
}

/** The source documents behind the entity facts a page shows for a linked owner. */
export function entityPageRefs(rec: PageRecord): SourceRef[] {
  return factsOf(rec, PAGE_ENTITY_PREDICATES).flatMap((f) =>
    refsOfFact(f, rec.urn),
  );
}

/** Whether every ref's source may be redistributed (or is listed in `extra` by source id). */
export function refsAllowed(
  refs: SourceRef[],
  sourceOf: (ref: SourceRef) => string | null,
  extra: ReadonlySet<string>,
): boolean {
  if (refs.length === 0) return false;
  return refs.every((r) => {
    if (!r.document_id) return false;
    if (r.rights && OPEN_REDISTRIBUTION.has(r.rights.redistribution ?? ""))
      return true;
    const id = sourceOf(r);
    return id !== null && extra.has(id);
  });
}

/** The situs address a page is titled by, or null (a page without one is noindex and left out of sitemaps). */
export function situsAddress(rec: PageRecord): string | null {
  const f = factsOf(rec, ["parcel.situs_address"])[0];
  return f && typeof f.value === "string" && f.value.trim() !== ""
    ? f.value
    : null;
}

/** The newest as_of among the refs (a sitemap's lastmod), or null. */
export function newestAsOf(refs: SourceRef[]): string | null {
  let best: string | null = null;
  for (const r of refs)
    if (/^\d{4}-\d{2}-\d{2}/.test(r.as_of) && (best === null || r.as_of > best))
      best = r.as_of.slice(0, 10);
  return best;
}

/** PROPERTY_PAGES_EXTRA_SOURCES ("tx-harris-cad, tx-dallas-cad") as a set of source ids. */
export function parseSourceList(v: string | null | undefined): Set<string> {
  return new Set(
    (v ?? "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter((s) => /^[a-z0-9][a-z0-9-]{0,80}$/.test(s))
      .slice(0, 200),
  );
}

// --- source ids --------------------------------------------------------------------------------
//
// A fact names its document, not its source. The pack maps documents to sources only for Texas (the equity
// candidates' `docs`), so for other places a document's source is read from coverage: the one source the
// parcel's county (or the entity's registry) has, or the one whose as_of equals the fact's. A manifest
// `documents` map (document id → source id), when a pack carries one, answers first.

/** The parts of the pack manifest the source index reads. */
export interface SourceManifest {
  documents?: Record<string, string>;
  coverage?: {
    counties?: {
      region: string;
      sources?: { source_id: string; as_of?: string }[];
    }[];
    entity_registries?: {
      jurisdiction: string;
      sources?: { source_id: string; as_of?: string }[];
    }[];
  };
  equity?: { docs?: [string, Record<string, unknown>][] } | null;
}

/** document id → source id, and the redistribution recorded for a source when the pack says. */
export class SourceIndex {
  private readonly docs = new Map<string, string>();
  private readonly scopes = new Map<
    string,
    { source_id: string; as_of?: string }[]
  >();
  /** Source id → recorded redistribution, for the sources whose rights the manifest carries. */
  readonly redistribution = new Map<string, string>();

  constructor(m: SourceManifest) {
    for (const [doc, src] of Object.entries(m.documents ?? {}))
      this.docs.set(doc, src);
    for (const [doc, row] of m.equity?.docs ?? []) {
      const src = row?.source_id;
      if (typeof src !== "string") continue;
      if (!this.docs.has(doc)) this.docs.set(doc, src);
      const red = (row.rights as Rights | undefined)?.redistribution;
      if (typeof red === "string" && !this.redistribution.has(src))
        this.redistribution.set(src, red);
    }
    for (const c of m.coverage?.counties ?? [])
      this.scopes.set(c.region, c.sources ?? []);
    for (const r of m.coverage?.entity_registries ?? [])
      this.scopes.set(r.jurisdiction, r.sources ?? []);
  }

  /** The sources coverage lists for a parcel's county or an entity's registry. */
  scopeSources(subject: string): { source_id: string; as_of?: string }[] {
    const m = /^fl:(?:parcel|entity):([a-z0-9-]+):/.exec(subject);
    return (m && this.scopes.get(m[1]!)) ?? [];
  }

  sourceOf(ref: {
    document_id: string;
    subject: string;
    as_of: string;
  }): string | null {
    const known = this.docs.get(ref.document_id);
    if (known) return known;
    const candidates = this.scopeSources(ref.subject);
    if (candidates.length === 1) return candidates[0]!.source_id;
    const dated = candidates.filter((s) => s.as_of && s.as_of === ref.as_of);
    return dated.length === 1 ? dated[0]!.source_id : null;
  }
}

// --- URLs ----------------------------------------------------------------------------------------

/** /property/us-11001/03760068 for fl:parcel:us-11001:03760068 (and back): the URN's own parts, nothing added. */
export const PROPERTY_PATH =
  /^\/property\/(us-\d{5})\/([a-z0-9]+(?:-[a-z0-9]+)*)$/;

export function propertyPath(urn: string): string | null {
  const m = /^fl:parcel:(us-\d{5}):([a-z0-9]+(?:-[a-z0-9]+)*)$/.exec(urn);
  return m ? `/property/${m[1]}/${m[2]}` : null;
}

export function urnOfPropertyPath(path: string): string | null {
  const m = PROPERTY_PATH.exec(path);
  return m ? `fl:parcel:${m[1]}:${m[2]}` : null;
}

/** Record shards per child sitemap: one child reads this many g/<db>/<i>.json files. */
export const SITEMAP_SHARDS_PER_FILE = 16;
/** The sitemaps protocol's limits per file. */
export const SITEMAP_MAX_URLS = 50_000;
