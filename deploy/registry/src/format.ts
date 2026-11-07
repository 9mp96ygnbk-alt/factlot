/**
 * The hosted registry pack format, shared by the pack builder (scripts/registry/pack.ts) and the Worker.
 *
 * A pack is a directory of JSON files built from one or more registry SQLite files. Answers that only the SDK
 * can make (records, history, ownership) are stored as the SDK made them; searches are answered from indexes
 * that follow the SQL in packages/tools/src/registry.ts. Everything here is plain TypeScript, so the Worker and
 * the builder run the same code.
 */
import type { RegistryCoverage } from "../../../packages/tools/src/registry.ts";

export const PACK_FORMAT = 1;

/** Target size of one shard file, in bytes (the builder sizes shard counts from it). */
export const SHARD_TARGET_BYTES = 96 * 1024;
/** Rows per page of a long address list. */
export const PAGE_ROWS = 700;
/** Rows kept inline in an address dictionary shard before a list moves to its own pages. */
export const INLINE_ROWS = 120;
/** Entity name rows per chunk file. */
export const NAME_CHUNK_ROWS = 1400;
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
  name_chunks: number;
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
