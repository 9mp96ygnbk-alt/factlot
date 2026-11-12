/**
 * registry_search_address and registry_search_entities over the pack's indexes, with the semantics of the SQL in
 * packages/tools/src/registry.ts (registrySearchAddress, registrySearchEntities):
 *
 * Address: SQLite LIKE (ASCII case-folding) on whole words of the address key. With a house number, a key whose
 * first word is that number and that holds every other word; otherwise the words in a row, which always include a
 * street type. One row per URN; exact key matches first, then label, then URN; at most `limit`.
 *
 * Every row a query can match is in one list the query names: "F:<first word>" (house number), "U:<street type>"
 * (a one-word street query), "B:<word> <street type>" or "A:<street type> <word>" (the word pair around a street
 * type in the query). Lists are sorted by label then URN, so a scan stops once it has `limit` URNs; "E:<key>"
 * gives the URNs whose key equals the query's key exactly, which go first.
 *
 * Entities: SQLite LIKE '%key%' on name keys, DISTINCT URN in scan (rowid) order, then exact key first, then label,
 * ties in scan order (of each entity's first matching row). Rows are found through posting lists of the 1- to
 * 3-character grams of the upper-cased keys (n/df.json gives each gram's row count, n/b/ and n/p/ the lists), or,
 * for a query whose grams are all very common, read in label order (n/l/) after its exact matches (n/e/).
 */
import {
  ADDRESS_STREET_TYPES,
  addressQuery,
  addressSearchKeysFor,
  addressWordsWithoutOrdinals,
  nameSearchKeyFor,
} from "../../../packages/tools/src/registry.ts";

import {
  NAME_PAGE_ROWS,
  PAGE_ROWS,
  listPages,
  shardOf,
  sqliteCompare,
  upperAscii,
  type Manifest,
  type PagedList,
} from "./format.ts";
import type { Pack } from "./store.ts";

/** [urn, label, key] */
export type AddressRow = [string, string | null, string];
/** Inline rows, or where a long list is in the shared pages. */
export type AddressList = AddressRow[] | PagedList;
/** [urn, label] of each URN whose address key is exactly the list's key. */
export type ExactList = [string, string | null][];

export interface Match {
  urn: string;
  label: string | null;
}

/** The list a query's matches all appear in, or null for a query no row can match. */
export function addressListKey(
  mode: "house_number" | "street",
  words: string[],
): string | null {
  if (!words.length || words.some((w) => w === "")) return null;
  if (mode === "house_number") return `F:${words[0]}`;
  if (words.length === 1) return `U:${words[0]}`;
  for (let i = 1; i < words.length; i++)
    if (ADDRESS_STREET_TYPES.has(words[i]!))
      return `B:${words[i - 1]} ${words[i]}`;
  return ADDRESS_STREET_TYPES.has(words[0]!)
    ? `A:${words[0]} ${words[1]}`
    : null;
}

/** The SQL WHERE of registrySearchAddress for one row's key. */
export function addressRowMatches(
  mode: "house_number" | "street",
  words: string[],
  key: string,
): boolean {
  const k = upperAscii(key);
  const spaced = ` ${k} `;
  if (mode === "street") return spaced.includes(` ${words.join(" ")} `);
  if (!`${k} `.startsWith(`${words[0]} `)) return false;
  for (let i = 1; i < words.length; i++)
    if (!spaced.includes(` ${words[i]} `)) return false;
  return true;
}

async function dictionary<T>(
  pack: Pack,
  m: Manifest,
  key: string,
): Promise<T | undefined> {
  const shard = await pack.file<Record<string, T>>(
    `a/${shardOf(key, m.address_shards)}.json`,
  );
  return shard && Object.hasOwn(shard, key) ? shard[key] : undefined;
}

export async function searchAddress(
  pack: Pack,
  query: string,
  limit: number,
): Promise<Match[]> {
  const m = await pack.manifest();
  const { mode } = addressQuery(query);
  if (mode === null) return [];
  const line = query.split(",")[0] ?? "";
  const keys = addressSearchKeysFor(m.versions.address_key_version, line);
  if (keys.length !== 1)
    throw new Error("the pack holds version 1 address keys");
  const words = keys[0]!.split(" ");
  const found = await searchAddressWords(pack, m, mode, words, limit);
  if (found.length) return found;
  // Nothing matched: once more with ordinal endings dropped (registrySearchAddress in the SDK).
  const bare = addressWordsWithoutOrdinals(words);
  return bare ? searchAddressWords(pack, m, mode, bare, limit) : found;
}

async function searchAddressWords(
  pack: Pack,
  m: Manifest,
  mode: "house_number" | "street",
  words: string[],
  limit: number,
): Promise<Match[]> {
  const fullKey = words.join(" ");
  const listKey = addressListKey(mode, words);
  if (listKey === null) return [];
  const exact = (await dictionary<ExactList>(pack, m, `E:${fullKey}`)) ?? [];
  const exactUrns = new Set(exact.map(([urn]) => urn));
  const out: Match[] = exact.map(([urn, label]) => ({ urn, label }));
  const list = await dictionary<AddressList>(pack, m, listKey);
  if (list && out.length < limit) {
    let last: string | undefined;
    const take = (rows: AddressRow[]): boolean => {
      for (const [urn, label, key] of rows) {
        if (urn === last || exactUrns.has(urn)) continue;
        if (!addressRowMatches(mode, words, key)) continue;
        last = urn;
        out.push({ urn, label });
        if (out.length >= limit) return true;
      }
      return false;
    };
    if (Array.isArray(list)) take(list);
    else
      for await (const rows of listPages<AddressRow>(
        pack,
        "a/p",
        PAGE_ROWS,
        list,
      ))
        if (take(rows)) break;
  }
  return out.slice(0, limit);
}

/** [key, urn, label] in the file's scan order. */
export type NameRow = [string, string, string | null];
/** A name row with its position in scan order, and its upper-cased key when that differs from the key. */
export type PostedRow =
  | [string, string, string | null, number]
  | [string, string, string | null, number, string];
/** Inline posting rows, or the count and page files of a long list. */
export type Posting = PostedRow[] | PagedList;
/** [urn, label, position] of each entity whose first row matching a key is that key exactly, by label. */
export type ExactNames = [string, string | null, number][];

/** The grams of an upper-cased name key the index holds: every substring of 1 to 3 characters. */
export function nameGrams(upper: string, n?: number): Set<string> {
  const out = new Set<string>();
  for (const len of n === undefined ? [1, 2, 3] : [n])
    for (let i = 0; i + len <= upper.length; i++)
      out.add(upper.slice(i, i + len));
  return out;
}

interface Hit {
  urn: string;
  label: string | null;
  exact: boolean;
}

// A stable sort keeps scan order (of each entity's first matching row) among ties, as SQLite's sorter does.
const byExactThenLabel = (a: Hit, b: Hit): number =>
  Number(b.exact) - Number(a.exact) || sqliteCompare(a.label, b.label);

/**
 * Entity search. Every row the query can match holds each of the query's grams, so the rows of its least
 * common gram, checked with the LIKE rule, are every match. A query whose grams are all too common to have a
 * posting list matches many rows: those come from the label-ordered list, after the entities whose first matching
 * row is the key itself.
 */
export async function searchEntities(
  pack: Pack,
  query: string,
  limit: number,
): Promise<Match[]> {
  const m = await pack.manifest();
  const key = nameSearchKeyFor(m.versions.name_key_version, query);
  const needle = upperAscii(key);
  if (!m.names.rows) return [];
  const n = Math.min(3, needle.length);
  let rarest: string | undefined;
  if (n > 0) {
    const df = await pack.file<Record<string, number>>("n/df.json", true);
    if (!df) throw new Error("pack file n/df.json is missing");
    let best = Infinity;
    for (const g of nameGrams(needle, n)) {
      const c = Object.hasOwn(df, g) ? df[g]! : 0;
      if (c === 0) return [];
      if (c < best) {
        best = c;
        rarest = g;
      }
    }
    if (best > m.names.posting_max) rarest = undefined;
  }
  if (rarest !== undefined) {
    const shard = await pack.file<Record<string, Posting>>(
      `n/b/${shardOf(rarest, m.names.gram_buckets)}.json`,
    );
    const posting = shard && Object.hasOwn(shard, rarest) ? shard[rarest]! : [];
    const pages: PostedRow[][] = [];
    if (Array.isArray(posting)) pages.push(posting);
    else
      for await (const rows of listPages<PostedRow>(
        pack,
        "n/p",
        NAME_PAGE_ROWS,
        posting,
      ))
        pages.push(rows);
    // Rows in scan order; the first matching row of each entity decides whether it is an exact match.
    const seen = new Set<string>();
    const hits: Hit[] = [];
    for (const rows of pages)
      for (const row of rows) {
        const urn = row[1];
        if (seen.has(urn) || !(row[4] ?? row[0]).includes(needle)) continue;
        seen.add(urn);
        hits.push({ urn, label: row[2], exact: row[0] === key });
      }
    hits.sort(byExactThenLabel);
    return hits.slice(0, limit).map(({ urn, label }) => ({ urn, label }));
  }
  // A common query: the exact matches, then the label-ordered rows.
  const eshard = await pack.file<Record<string, ExactNames>>(
    `n/e/${shardOf(key, m.names.exact_buckets)}.json`,
  );
  const exact = eshard && Object.hasOwn(eshard, key) ? eshard[key]! : [];
  const out: Match[] = exact
    .slice(0, limit)
    .map(([urn, label]) => ({ urn, label }));
  const seen = new Set<string>();
  for (let c = 0; c < m.names.label_chunks && out.length < limit; c++) {
    const rows = await pack.file<PostedRow[]>(`n/l/${c}.json`);
    if (!rows) throw new Error(`pack chunk n/l/${c}.json is missing`);
    for (const row of rows) {
      const urn = row[1];
      if (seen.has(urn) || !(row[4] ?? row[0]).includes(needle)) continue;
      seen.add(urn);
      if (row[0] === key) continue; // listed with the exact matches
      out.push({ urn, label: row[2] });
      if (out.length >= limit) break;
    }
  }
  return out;
}
