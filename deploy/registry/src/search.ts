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
 * ties in scan order. The name rows are scanned in full.
 */
import {
  ADDRESS_STREET_TYPES,
  addressQuery,
  addressSearchKeysFor,
  nameSearchKeyFor,
} from "../../../packages/tools/src/registry.ts";

import { shardOf, sqliteCompare, upperAscii, type Manifest } from "./format.ts";
import type { Pack } from "./store.ts";

/** [urn, label, key] */
export type AddressRow = [string, string | null, string];
/** Inline rows, or the count and page files of a long list. */
export type AddressList = AddressRow[] | { n: number; p: number[] };
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
  const fullKey = keys[0]!;
  const words = fullKey.split(" ");
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
      for (const page of list.p) {
        const rows = await pack.file<AddressRow[]>(`a/p/${page}.json`);
        if (!rows) throw new Error(`pack page a/p/${page}.json is missing`);
        if (take(rows)) break;
      }
  }
  return out.slice(0, limit);
}

/** [key, urn, label] in the file's scan order. */
export type NameRow = [string, string, string | null];

export async function searchEntities(
  pack: Pack,
  query: string,
  limit: number,
): Promise<Match[]> {
  const m = await pack.manifest();
  const key = nameSearchKeyFor(m.versions.name_key_version, query);
  const needle = upperAscii(key);
  const seen = new Set<string>();
  const hits: { urn: string; label: string | null; exact: boolean }[] = [];
  for (let c = 0; c < m.name_chunks; c++) {
    const rows = await pack.file<NameRow[]>(`n/${c}.json`);
    if (!rows) throw new Error(`pack chunk n/${c}.json is missing`);
    for (const [k, urn, label] of rows) {
      if (seen.has(urn) || !upperAscii(k).includes(needle)) continue;
      seen.add(urn);
      hits.push({ urn, label, exact: k === key });
    }
  }
  // A stable sort keeps scan order among ties, as SQLite's sorter does.
  hits.sort(
    (a, b) =>
      Number(b.exact) - Number(a.exact) || sqliteCompare(a.label, b.label),
  );
  return hits.slice(0, limit).map(({ urn, label }) => ({ urn, label }));
}
