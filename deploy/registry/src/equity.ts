/**
 * registry_tx_equity_candidates from a pack, with the SDK's rule (packages/tools/src/registry.ts: equityRule,
 * equityMatch, equityCompare, assembleTxEquity) applied to rows the pack stores.
 *
 * Every subject's record entry holds, per roll year, its shaped facts and the pool it is compared in. A pool is the
 * comparables one subject year can have (county, roll and building-file sources, category code and tax year),
 * kept only where the rule can accept them whatever the parameters: a positive improvement area and a value. A
 * pool is stored as sorted lists (by improvement area, then URN): the whole pool, and its rows by neighborhood
 * code ("N:"), by ZIP code ("Z:"), and the count of rows with both ("X:"). The tiers' counts come from list
 * counts within the area and year bands (neighborhood; ZIP code less neighborhood; the rest), and the rows
 * returned from each list nearest the subject's area. So every parameter value gives the SDK's answer.
 *
 * A sorted list is inline (rows, or for "X:" only areas and years) or split into area-ordered chunk files whose
 * bounds and year-built counts are in the list, so a count reads at most the two chunks at the band's edges.
 */
import {
  assembleTxEquity,
  equityCompare,
  equityComparable,
  equityMatch,
  equityRolls,
  equityRule,
  equityWidened,
  equityYearUsed,
  type EquityMatch,
  type EquityRule,
  type TxEquityParams,
} from "../../../packages/tools/src/registry.ts";

import { fnv1a, labeledHistory, type GetEntry } from "./format.ts";
import type { Pack } from "./store.ts";

type Row = Record<string, unknown>;

/** Rows of a list kept inline; a longer list is split into chunks of EQUITY_CHUNK_ROWS. */
export const EQUITY_INLINE_ROWS = 120;
export const EQUITY_CHUNK_ROWS = 500;
/** Areas and years of an "X:" list kept inline. */
export const EQUITY_INLINE_COUNTS = 3000;
/** A list longer than this also gets count chunks of EQUITY_COUNT_ROWS, so its row chunks need no year counts. */
export const EQUITY_COUNT_LIST = 20000;
export const EQUITY_COUNT_ROWS = 5000;
/** Target size of a pool's group bucket file. */
export const EQUITY_BUCKET_BYTES = 64 * 1024;

export interface EquityManifest {
  /** [document_id, its `sources` entry] by index: what an encoded row's documents point at. */
  docs: [string, Row][];
  pools: number;
}

/**
 * [fact_id, document index, locator, as_of]. A locator that is a prefix of the pool's `locs` followed by the URN
 * tail is stored as that prefix's index (the tail upper-cased) or -(index + 1) (the tail as is); an as_of equal to
 * the document's is stored as 0.
 */
export type EqCitation = [string, number, string | number | null, string | 0];
/**
 * An eligible comparable: [URN after the pool's prefix, market value, appraised value, improvement area, land area,
 * year built, neighborhood code, building class, situs address, citation, document indexes of its facts (0: only
 * the cited document)].
 */
export type EqRow = [
  string,
  number | null,
  number | null,
  number,
  number | null,
  number | null,
  string | null,
  string | null,
  string | null,
  EqCitation | null,
  number[] | 0,
];

/** Year built (null: unknown) → rows, for counting a chunk wholly inside the area band. */
export type YearCounts = [number | null, number][];
/** [smallest area, largest area, rows, year counts] */
export type ChunkBounds = [number, number, number, YearCounts?];

export type SortedList =
  | { n: number; r: EqRow[] }
  | { n: number; a: (number | null)[] }
  | { n: number; f: string; rc: ChunkBounds[]; cc?: ChunkBounds[] };

export interface PoolHeader {
  /** URN prefix, county FIPS, category code and tax year every row shares. */
  u: string;
  county: string;
  category: string;
  tax_year: number;
  /** Locator prefixes (see EqCitation). */
  locs: string[];
  all: SortedList;
  /** Group bucket files q/<pool>/b<i>.json. */
  buckets: number;
}

/**
 * A subject's candidate data: `y` its roll years ([source, tax year, valued], as equityRollYears gives them),
 * `e` per tax year [year, roll sources, building-file sources, shaped subject, document indexes, pool or null,
 * whether the subject is in its pool].
 */
export interface EquitySubject {
  y: [string, number, boolean][];
  e: [number, string[], string[], Row, number[], string | null, 0 | 1][];
}

// --- rows -------------------------------------------------------------------------------------------------------

export function encodeRow(
  prefix: string,
  c: Row,
  docs: number[],
  docIndex: (documentId: string) => number,
  m: EquityManifest,
  locs: string[],
): EqRow {
  const id = String(c.id);
  if (!id.startsWith(prefix)) throw new Error(`${id} is not under ${prefix}`);
  const tail = id.slice(prefix.length);
  const cite = c.citation as Row | null;
  let citation: EqCitation | null = null;
  if (cite) {
    const doc = docIndex(String(cite.document_id));
    const loc = cite.locator as string | null;
    let locator: string | number | null = loc;
    for (const [t, sign] of [
      [tail.toUpperCase(), 1],
      [tail, -1],
    ] as [string, number][])
      if (
        typeof locator === "string" &&
        loc!.endsWith(t) &&
        loc!.length > t.length
      ) {
        const head = loc!.slice(0, loc!.length - t.length);
        let i = locs.indexOf(head);
        if (i < 0) i = locs.push(head) - 1;
        locator = sign > 0 ? i : -(i + 1);
      }
    const asOf = String(cite.as_of);
    citation = [
      String(cite.fact_id),
      doc,
      locator,
      asOf === m.docs[doc]![1].as_of ? 0 : asOf,
    ];
  }
  return [
    tail,
    c.market_value as number | null,
    c.appraised_value as number | null,
    c.improvement_area_sf as number,
    c.land_area_sf as number | null,
    c.year_built as number | null,
    c.neighborhood_code as string | null,
    c.building_class as string | null,
    c.situs_address as string | null,
    citation,
    citation && docs.length === 1 && docs[0] === citation[1] ? 0 : docs,
  ];
}

/** The document indexes of an encoded row's facts. */
export function rowDocs(r: EqRow): number[] {
  return r[10] === 0 ? [r[9]![1]] : r[10];
}

/** The shaped comparable (equityComparable's object, key order included) of an encoded row. */
export function decodeRow(h: PoolHeader, m: EquityManifest, r: EqRow): Row {
  const [tail, market, appraised, area, land, year, nbhd, cls, situs, cite] = r;
  const basis =
    appraised !== null ? "appraised" : market !== null ? "market" : null;
  let citation: Row | null = null;
  if (cite) {
    const [factId, doc, loc, asOf] = cite;
    const [documentId, source] = m.docs[doc]!;
    citation = {
      fact_id: factId,
      document_id: documentId,
      locator:
        typeof loc !== "number"
          ? loc
          : loc >= 0
            ? h.locs[loc]! + tail.toUpperCase()
            : h.locs[-loc - 1]! + tail,
      as_of: asOf === 0 ? source.as_of : asOf,
    };
  }
  return {
    id: h.u + tail,
    county_fips: h.county,
    value: basis === "appraised" ? appraised : market,
    value_basis: basis,
    market_value: market,
    appraised_value: appraised,
    improvement_area_sf: area,
    land_area_sf: land,
    year_built: year,
    state_property_category: h.category,
    neighborhood_code: nbhd,
    building_class: cls,
    situs_address: situs,
    tax_year: h.tax_year,
    citation,
  };
}

// --- building sorted lists ---------------------------------------------------------------------------------------

/** Rows sorted by area, then URN: the order lists are stored in. */
export function byArea(a: EqRow, b: EqRow): number {
  return a[3] - b[3] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
}

function yearCounts(rows: (number | null)[]): YearCounts {
  const counts = new Map<number | null, number>();
  for (const y of rows) counts.set(y, (counts.get(y) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) =>
    a[0] === null ? -1 : b[0] === null ? 1 : a[0] - b[0],
  );
}

/**
 * A sorted list of `rows` (already in byArea order); `write(name, value)` writes a chunk file under the list's
 * prefix `f`. With `countsOnly`, only areas and years are kept.
 */
export function buildList(
  rows: EqRow[],
  f: string,
  write: (path: string, value: unknown) => void,
  countsOnly = false,
): SortedList {
  const n = rows.length;
  if (countsOnly && n <= EQUITY_INLINE_COUNTS)
    return { n, a: rows.flatMap((r) => [r[3], r[5]]) };
  if (!countsOnly && n <= EQUITY_INLINE_ROWS) return { n, r: rows };
  const withCounts = n > EQUITY_COUNT_LIST || countsOnly;
  const rc: ChunkBounds[] = [];
  if (!countsOnly)
    for (let i = 0, k = 0; i < n; i += EQUITY_CHUNK_ROWS, k++) {
      const chunk = rows.slice(i, i + EQUITY_CHUNK_ROWS);
      write(`${f}/r${k}.json`, chunk);
      rc.push([
        chunk[0]![3],
        chunk[chunk.length - 1]![3],
        chunk.length,
        ...(withCounts ? [] : [yearCounts(chunk.map((r) => r[5]))]),
      ] as ChunkBounds);
    }
  if (!withCounts) return { n, f, rc };
  const cc: ChunkBounds[] = [];
  for (let i = 0, k = 0; i < n; i += EQUITY_COUNT_ROWS, k++) {
    const chunk = rows.slice(i, i + EQUITY_COUNT_ROWS);
    write(
      `${f}/c${k}.json`,
      chunk.flatMap((r) => [r[3], r[5]]),
    );
    cc.push([
      chunk[0]![3],
      chunk[chunk.length - 1]![3],
      chunk.length,
      yearCounts(chunk.map((r) => r[5])),
    ]);
  }
  return { n, f, rc, cc };
}

/** A pool's file directory name: stable for the same pool key across builds. */
export function poolName(county: string, key: string): string {
  return `${county}-${fnv1a(key).toString(36)}`;
}

/** A group list's chunk directory within its pool. */
export function groupDir(pool: string, group: string): string {
  return `q/${pool}/g${fnv1a(group).toString(36)}`;
}

export const groupBucket = (group: string, buckets: number): number =>
  fnv1a(group) % buckets;

// --- answering ---------------------------------------------------------------------------------------------------

/** equityAccepts' area and year-built tests on an area and a year (the pool holds only rows passing the rest). */
function inBand(rule: EquityRule, area: number, year: number | null): boolean {
  if (!(rule.lo <= area && area <= rule.hi)) return false;
  return !(
    rule.year !== null &&
    year !== null &&
    Math.abs(year - rule.year) > rule.yearBand
  );
}

function countYears(rule: EquityRule, n: number, counts: YearCounts): number {
  if (rule.year === null) return n;
  let out = 0;
  for (const [y, c] of counts)
    if (y === null || !(Math.abs(y - rule.year) > rule.yearBand)) out += c;
  return out;
}

async function chunk<T>(pack: Pack, path: string): Promise<T> {
  const v = await pack.file<T>(path);
  if (v === undefined) throw new Error(`pack file ${path} is missing`);
  return v;
}

/** Rows of a list within the rule's area and year bands. */
export async function listCount(
  pack: Pack,
  list: SortedList | undefined,
  rule: EquityRule,
): Promise<number> {
  if (!list) return 0;
  if ("r" in list) return list.r.filter((r) => inBand(rule, r[3], r[5])).length;
  if ("a" in list) {
    let out = 0;
    for (let i = 0; i < list.a.length; i += 2)
      if (inBand(rule, list.a[i] as number, list.a[i + 1] as number | null))
        out += 1;
    return out;
  }
  const counted = list.cc ?? list.rc;
  let out = 0;
  for (let k = 0; k < counted.length; k++) {
    const [lo, hi, n, years] = counted[k]!;
    if (hi < rule.lo || lo > rule.hi) continue;
    if (rule.lo <= lo && hi <= rule.hi) {
      out += countYears(rule, n, years!);
      continue;
    }
    if (list.cc) {
      const a = await chunk<(number | null)[]>(pack, `${list.f}/c${k}.json`);
      for (let i = 0; i < a.length; i += 2)
        if (inBand(rule, a[i] as number, a[i + 1] as number | null)) out += 1;
    } else {
      const rows = await chunk<EqRow[]>(pack, `${list.f}/r${k}.json`);
      for (const r of rows) if (inBand(rule, r[3], r[5])) out += 1;
    }
  }
  return out;
}

/**
 * The `k` matches of tier `tier` in a list nearest the subject's area (equityCompare order). Chunks are read
 * outward from the subject's area until no unread chunk can hold a nearer row.
 */
export async function listNearest(
  pack: Pack,
  h: PoolHeader,
  m: EquityManifest,
  list: SortedList | undefined,
  rule: EquityRule,
  tier: number,
  k: number,
): Promise<EquityMatch[]> {
  if (!list || k <= 0) return [];
  let best: EquityMatch[] = [];
  const take = (rows: EqRow[]) => {
    for (const r of rows) {
      if (!inBand(rule, r[3], r[5])) continue;
      const match = equityMatch(rule, {
        urn: h.u + r[0],
        row: decodeRow(h, m, r),
        docs: rowDocs(r).map((i) => m.docs[i]![0]),
      });
      if (match && match.tier === tier) best.push(match);
    }
    best.sort(equityCompare);
    if (best.length > k) best = best.slice(0, k);
  };
  if ("r" in list) {
    take(list.r);
    return best;
  }
  if ("a" in list) throw new Error("a count-only list has no rows");
  const rc = list.rc;
  let right = rc.findIndex((c) => c[1] >= rule.area);
  if (right < 0) right = rc.length;
  let left = right - 1;
  const kth = () =>
    best.length < k ? Infinity : best[best.length - 1]!.distance;
  for (;;) {
    const dl =
      left >= 0 && rc[left]![1] >= rule.lo
        ? rule.area - rc[left]![1]
        : Infinity;
    const dr =
      right < rc.length && rc[right]![0] <= rule.hi
        ? Math.max(0, rc[right]![0] - rule.area)
        : Infinity;
    const d = Math.min(dl, dr);
    if (d === Infinity || d > kth()) break;
    const i = dr <= dl ? right++ : left--;
    // A chunk whose year counts leave no row within the year band holds no match.
    const years = rc[i]![3];
    if (years && countYears(rule, rc[i]![2], years) === 0) continue;
    take(await chunk<EqRow[]>(pack, `${list.f}/r${i}.json`));
  }
  return best;
}

/** registry_tx_equity_candidates for a subject the pack holds (its input already checked). */
export async function equityFromPack(
  pack: Pack,
  urn: string,
  entry: GetEntry,
  params: TxEquityParams,
): Promise<Row> {
  const manifest = await pack.manifest();
  const m = manifest.equity;
  const q = entry.q;
  if (!m || !q) throw new Error(`${urn}: the pack holds no candidate data`);
  const years = new Map<string, [number, boolean]>(
    q.y.map(([src, y, v]) => [src, [y, v]]),
  );
  const { yearUsed, available, warnings } = equityYearUsed(
    years,
    params.tax_year ?? null,
  );
  const stored = q.e.find((e) => e[0] === yearUsed);
  if (yearUsed !== null && !stored)
    throw new Error(`${urn}: no candidate data for tax year ${yearUsed}`);
  const rolls = stored ? stored[1] : equityRolls(years, yearUsed);
  const subject: Row = {
    ...(stored ? stored[3] : equityComparable(urn, new Map())),
    value_history:
      manifest.value_files && Array.isArray(entry.r.value_history)
        ? labeledHistory(entry.r.value_history as Row[], manifest.value_files)
        : entry.r.value_history,
  };
  const rule = equityRule(urn, subject, params);
  let counts = [0, 0, 0];
  let returned: EquityMatch[] = [];
  const pool = stored?.[5] ?? null;
  if (rule && pool !== null) {
    const h = await chunk<PoolHeader>(pack, `q/${pool}/h.json`);
    const group = async (key: string): Promise<SortedList | undefined> => {
      const b = await chunk<Record<string, SortedList>>(
        pack,
        `q/${pool}/b${groupBucket(key, h.buckets)}.json`,
      );
      return Object.hasOwn(b, key) ? b[key] : undefined;
    };
    const nb = rule.neighborhood;
    const zip = rule.zip;
    const listN = nb !== null ? await group(`N:${nb}`) : undefined;
    const listZ = zip !== null ? await group(`Z:${zip}`) : undefined;
    const listX =
      nb !== null && zip !== null
        ? await group(`X:${nb}\u0000${zip}`)
        : undefined;
    const cAll = await listCount(pack, h.all, rule);
    const cN = await listCount(pack, listN, rule);
    const cZ =
      (await listCount(pack, listZ, rule)) -
      (await listCount(pack, listX, rule));
    counts = [cN, cZ, cAll - cN - cZ];
    // The subject is in its own pool's lists, in its own tier, but is never its own candidate.
    if (stored![6]) counts[nb !== null ? 0 : zip !== null ? 1 : 2]! -= 1;
    const widened = equityWidened(counts, params.min_matches);
    const want = [Math.min(counts[0]!, params.limit), 0, 0];
    const t0 = await listNearest(pack, h, m, listN, rule, 0, want[0]!);
    want[1] = Math.min(counts[1]!, params.limit - t0.length);
    const t1 = await listNearest(pack, h, m, listZ, rule, 1, want[1]);
    want[2] = widened
      ? Math.min(counts[2]!, params.limit - t0.length - t1.length)
      : 0;
    const t2 = await listNearest(pack, h, m, h.all, rule, 2, want[2]);
    if (t0.length !== want[0] || t1.length !== want[1] || t2.length !== want[2])
      throw new Error(
        `${urn}: the pack's candidate lists disagree with their counts`,
      );
    returned = [...t0, ...t1, ...t2];
  }
  const sources = new Map(m.docs);
  return assembleTxEquity(
    {
      subject,
      subjectDocs: stored ? stored[4].map((i) => m.docs[i]![0]) : [],
      params,
      yearUsed,
      available,
      rolls,
      companions: stored ? stored[2] : [],
      warnings,
      counts,
      returned,
    },
    (docs) =>
      [...docs]
        .sort()
        .filter((d) => sources.has(d))
        .map((d) => sources.get(d)!),
  );
}
