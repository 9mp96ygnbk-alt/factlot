/**
 * The hosted registry pack format, shared by the pack builder (scripts/registry/pack.ts) and the Worker.
 *
 * A pack is a directory of JSON files built from one or more registry SQLite files. Answers that only the SDK
 * can make (records, history, ownership) are stored as the SDK made them; searches are answered from indexes
 * that follow the SQL in packages/tools/src/registry.ts. Everything here is plain TypeScript, so the Worker and
 * the builder run the same code.
 */
import type { RegistryCoverage } from "../../../packages/tools/src/registry.ts";

import type { EquityManifest, EquitySubject } from "./equity.ts";
import type { PartialCounty } from "./hosted.ts";

export const PACK_FORMAT = 2;

/** Workers Paid: 100,000 static-asset files per Worker version (the free plan allows 20,000). */
export const PACK_MAX_FILES = 100_000;
/** Workers static assets: 25 MiB per file. */
export const PACK_MAX_FILE_BYTES = 25 * 1024 * 1024;

/** Target size of one shard file, in bytes (the builder sizes shard counts from it). */
export const SHARD_TARGET_BYTES = 96 * 1024;
/** Rows per page of the long address lists, which follow each other through the pages. */
export const PAGE_ROWS = 700;
/** Rows kept inline in an address dictionary shard before a list moves to its own pages. */
export const INLINE_ROWS = 120;
/** Entity name rows per chunk of the label-ordered list. */
export const NAME_CHUNK_ROWS = 1400;
/**
 * A name gram (1 to 3 characters of an upper-cased name key) held by more rows than this has no posting list: a
 * query whose every gram is that common matches so many rows that the label-ordered list answers it in a chunk
 * or two.
 */
export const NAME_POSTING_MAX = 8000;
/** Rows per page of the long posting lists (one after another through the pages), and the longest list kept inline in a bucket. */
export const NAME_PAGE_ROWS = 1600;
export const NAME_INLINE_ROWS = 160;
/** Target size of a name posting or exact-key bucket file. */
export const NAME_BUCKET_BYTES = 128 * 1024;
/** The largest `limit` a registry search accepts (the catalog's schema). */
export const MAX_LIMIT = 100;

export interface PackDb {
  /** Region name given on the command line (e.g. "md"). */
  name: string;
  /** Meta `parcel_rule` of the file, or null when unset (parcel rule 1). */
  parcel_rule: string | null;
  /** Every distinct as_of in its facts, coverage and relationships, ascending: where a dated answer changes. */
  dates: string[];
  /** Number of record shards (files g/<db>/<i>.json). */
  shards: number;
  parcels: number;
  entities: number;
  buildings: number;
  subjects: number;
}

export interface Manifest {
  format: number;
  built_at: string;
  dbs: PackDb[];
  /** "fl:<kind>:<region>" → index into dbs, for every subject prefix the pack holds. */
  prefixes: Record<string, number>;
  /** County region ("us-24005") → index into dbs, for the parcel rule of resolve_parcel. */
  counties: Record<string, number>;
  versions: {
    name_key_version: string | null;
    address_key_version: string | null;
  };
  coverage: RegistryCoverage;
  /** The registry_coverage result, made by the SDK's coverageReport at build time. */
  coverage_result: unknown;
  crosswalk_shards: number;
  address_shards: number;
  /** The entity name index (search.ts): bucket and chunk counts. */
  names: {
    rows: number;
    /** The most rows a gram's posting list holds (NAME_POSTING_MAX unless the build set another). */
    posting_max: number;
    gram_buckets: number;
    exact_buckets: number;
    label_chunks: number;
  };
  /** Counties withheld from the hosted registry (5-digit FIPS → reason); see hosted.ts. */
  withheld: Record<string, string>;
  /** Entity registries served in part (jurisdiction → served and total entities); see hosted.ts. */
  entity_scope: Record<string, { served: number; total: number }>;
  /** Counties loaded only in part (5-digit FIPS → the part); see hosted.ts. Absent in packs built before it. */
  partial_counties?: Record<string, PartialCounty>;
  /** Texas unequal-appraisal candidate data (equity.ts), or null when the pack holds no Texas parcel. */
  equity: EquityManifest | null;
  counts: Record<string, number>;
}

/** FNV-1a over UTF-16 code units: the shard of a key. */
export function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function shardOf(key: string, n: number): number {
  return fnv1a(key) % n;
}

/** SQLite BINARY collation (UTF-8 byte order, which is code point order); NULL sorts first. */
export function sqliteCompare(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (a === null) return -1;
  if (b === null) return 1;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const x = a.charCodeAt(i);
    const y = b.charCodeAt(i);
    if (x === y) continue;
    return fixup(x) - fixup(y);
  }
  return a.length - b.length;
}

function fixup(c: number): number {
  return c >= 0xd800 && c <= 0xdfff ? c + 0x2000 : c >= 0xe000 ? c - 0x800 : c;
}

/** What SQLite's LIKE folds: ASCII letters only. */
export function upperAscii(s: string): string {
  return s.replace(/[a-z]+/g, (m) => m.toUpperCase());
}

/** "fl:parcel:us-24005" for "fl:parcel:us-24005:…": which file of the pack holds a URN. */
export function urnPrefix(urn: string): string {
  return urn.split(":", 3).join(":");
}

// --- shared pages ------------------------------------------------------------------------------
//
// Long lists are written one after another into one sequence of rows, cut into pages of a fixed number of rows
// (<prefix>/<page>.json), so a list just over the inline size does not take a file of its own. A list is { n, s }:
// its n rows start at row s of the sequence.

/** A long list's place in its pages. */
export interface PagedList {
  n: number;
  s: number;
}

/** Collects long lists into shared pages (the pack builder). */
export class SharedPages<T> {
  private readonly rows: T[] = [];
  add(list: T[]): PagedList {
    const s = this.rows.length;
    for (const r of list) this.rows.push(r);
    return { n: list.length, s };
  }
  /** Write the pages; returns how many. */
  write(
    prefix: string,
    perPage: number,
    write: (path: string, value: unknown) => void,
  ): number {
    let page = 0;
    for (let i = 0; i < this.rows.length; i += perPage)
      write(`${prefix}/${page++}.json`, this.rows.slice(i, i + perPage));
    return page;
  }
}

/** The pages of a list, in order, each cut to the list's rows. */
export async function* listPages<T>(
  pack: { file<V>(path: string): Promise<V | undefined> },
  prefix: string,
  perPage: number,
  list: PagedList,
): AsyncGenerator<T[]> {
  const end = list.s + list.n;
  for (let page = Math.floor(list.s / perPage); page * perPage < end; page++) {
    const rows = await pack.file<T[]>(`${prefix}/${page}.json`);
    if (!rows) throw new Error(`pack page ${prefix}/${page}.json is missing`);
    const from = Math.max(0, list.s - page * perPage);
    const to = Math.min(rows.length, end - page * perPage);
    yield from === 0 && to === rows.length ? rows : rows.slice(from, to);
  }
}

// --- shard encoding -----------------------------------------------------------------------------
//
// A shard is { s: shapes, t: table, e: entries }. A value is encoded as itself when it is a string, number,
// boolean or null; as [0, ...items] for an array; as [k, ...values] for an object whose key list is s[k - 1];
// and as [-(i + 1)] for a reference to t[i] (a string, or an encoded array or object that occurs more than once
// in the shard). Decoding gives back the same JSON, key order included.

type Node =
  | { kind: "p"; value: null | boolean | number | string; size: number }
  | { kind: "a"; children: number[]; size: number }
  | { kind: "o"; keys: string; children: number[]; size: number };

export interface EncodedShard {
  s: string[][];
  t: unknown[];
  e: Record<string, unknown>;
}

export class ShardEncoder {
  private readonly nodes: Node[] = [];
  private readonly ids = new Map<string, number>();
  private readonly counts: number[] = [];
  private readonly entries: [string, number][] = [];

  add(key: string, value: unknown): void {
    this.entries.push([key, this.intern(value)]);
  }

  private node(sig: string, make: () => Node): number {
    let id = this.ids.get(sig);
    if (id === undefined) {
      id = this.nodes.length;
      this.nodes.push(make());
      this.counts.push(0);
      this.ids.set(sig, id);
    }
    this.counts[id]! += 1;
    return id;
  }

  private intern(v: unknown): number {
    if (v === null || typeof v === "boolean" || typeof v === "number") {
      const value = v as null | boolean | number;
      return this.node(`p${JSON.stringify(value)}`, () => ({
        kind: "p",
        value,
        size: JSON.stringify(value).length,
      }));
    }
    if (typeof v === "string")
      return this.node(`s${v}`, () => ({
        kind: "p",
        value: v,
        size: JSON.stringify(v).length,
      }));
    if (Array.isArray(v)) {
      const children = v.map((x) => this.intern(x));
      return this.node(`a${children.join(",")}`, () => ({
        kind: "a",
        children,
        size: 4 + children.reduce((a, c) => a + this.nodes[c]!.size + 1, 0),
      }));
    }
    if (typeof v === "object") {
      const o = v as Record<string, unknown>;
      const keys = Object.keys(o);
      const children = keys.map((k) => this.intern(o[k]));
      const shape = JSON.stringify(keys);
      return this.node(`o${shape}${children.join(",")}`, () => ({
        kind: "o",
        keys: shape,
        children,
        size: 4 + children.reduce((a, c) => a + this.nodes[c]!.size + 1, 0),
      }));
    }
    throw new Error(`cannot encode a ${typeof v}`);
  }

  encode(): EncodedShard {
    const shapes: string[][] = [];
    const shapeIndex = new Map<string, number>();
    const table: unknown[] = [];
    const tableIndex = new Map<number, number>();
    const shared = (id: number): boolean => {
      const n = this.nodes[id]!;
      if (this.counts[id]! < 2) return false;
      if (n.kind === "p") return typeof n.value === "string" && n.size > 9;
      return n.size > 8;
    };
    const enc = (id: number): unknown => {
      if (shared(id)) {
        let i = tableIndex.get(id);
        if (i === undefined) {
          i = table.length;
          table.push(null);
          tableIndex.set(id, i);
          table[i] = inner(id);
        }
        return [-(i + 1)];
      }
      return inner(id);
    };
    const inner = (id: number): unknown => {
      const n = this.nodes[id]!;
      if (n.kind === "p") return n.value;
      if (n.kind === "a") return [0, ...n.children.map(enc)];
      let k = shapeIndex.get(n.keys);
      if (k === undefined) {
        k = shapes.length;
        shapes.push(JSON.parse(n.keys) as string[]);
        shapeIndex.set(n.keys, k);
      }
      return [k + 1, ...n.children.map(enc)];
    };
    const e: Record<string, unknown> = {};
    for (const [key, id] of this.entries) e[key] = enc(id);
    return { s: shapes, t: table, e };
  }
}

/**
 * One field of an entry (an encoded object) without decoding the others: `r` of a record entry, skipping its
 * dated variants. Undefined when the shard has no such entry or the entry no such field.
 */
export function decodeEntryField(
  shard: EncodedShard,
  key: string,
  field: string,
): unknown {
  if (!Object.hasOwn(shard.e, key)) return undefined;
  let top = shard.e[key];
  if (Array.isArray(top) && (top[0] as number) < 0)
    top = shard.t[-(top[0] as number) - 1];
  if (!Array.isArray(top) || (top[0] as number) < 1) return undefined;
  const i = shard.s[(top[0] as number) - 1]!.indexOf(field);
  if (i < 0) return undefined;
  return decodeEntry({ s: shard.s, t: shard.t, e: { v: top[i + 1] } }, "v");
}

/** Decode one entry of a shard (undefined when the shard has none under that key). */
export function decodeEntry(shard: EncodedShard, key: string): unknown {
  if (!Object.hasOwn(shard.e, key)) return undefined;
  const memo = new Map<number, unknown>();
  const dec = (v: unknown): unknown => {
    if (v === null || typeof v !== "object") return v;
    const a = v as unknown[];
    const tag = a[0] as number;
    if (tag < 0) {
      const i = -tag - 1;
      if (memo.has(i)) return memo.get(i);
      const t = shard.t[i];
      const out = typeof t === "string" ? t : dec(t);
      memo.set(i, out);
      return out;
    }
    if (tag === 0) return a.slice(1).map(dec);
    const keys = shard.s[tag - 1]!;
    return Object.fromEntries(keys.map((k, j) => [k, dec(a[j + 1])]));
  };
  return dec(shard.e[key]);
}

// --- record entries -----------------------------------------------------------------------------

type Rec = Record<string, unknown>;

/**
 * A subject's stored answers. `r` is registry_get's record; `h` its history when that is not `r.facts`; `v` one
 * variant per interval of the file's dates (before the first date, then from each date on): 0 when the dated
 * record and history are the undated ones, else [record or 0, history: 0 same as undated, 1 same as the
 * variant's facts, or the list]. A dated record is stored without its `as_of`, which echoes the input. `o` is
 * registry_owned_by's results and buildings when the entity owns any parcel.
 */
export interface GetEntry {
  k: number;
  r: Rec;
  h?: unknown[];
  v: (0 | [Rec | 0, 0 | 1 | unknown[]])[];
  o?: { results: unknown[]; buildings: unknown[] };
  /** A Texas parcel's registry_tx_equity_candidates data (equity.ts). */
  q?: EquitySubject;
}

/** Index into GetEntry.v for a dated lookup: the interval of `dates` that `asOf` falls in. */
export function variantIndex(dates: string[], asOf: string): number {
  let i = 0;
  while (i < dates.length && dates[i]! <= asOf) i++;
  return i;
}

/** registry_get's record with the `as_of` input echoed after `label`, where registryGet puts it. */
export function withAsOf(rec: Rec, asOf: string): Rec {
  const out: Rec = {};
  for (const [k, v] of Object.entries(rec)) {
    out[k] = v;
    if (k === "label") out.as_of = asOf;
  }
  return out;
}

/** The registry_get result an entry gives, as runTool returns it. */
export function getResult(
  entry: GetEntry,
  dates: string[],
  includeHistory: boolean,
  asOf: string | undefined,
): Rec {
  const baseHistory = entry.h ?? (entry.r.facts as unknown[]);
  let rec = entry.r;
  let history = baseHistory;
  if (asOf !== undefined) {
    const v = entry.v[variantIndex(dates, asOf)] ?? 0;
    if (v !== 0) {
      const [rv, hv] = v;
      if (rv !== 0) rec = rv;
      history =
        hv === 0 ? baseHistory : hv === 1 ? (rec.facts as unknown[]) : hv;
    }
    rec = withAsOf(rec, asOf);
  }
  return includeHistory ? { ...rec, history } : rec;
}
