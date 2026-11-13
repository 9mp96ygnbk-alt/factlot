/**
 * registry_search_address and registry_search_entities over the pack's indexes, with the semantics of the SQL in
 * packages/tools/src/registry.ts (registrySearchAddress, registrySearchEntities):
 *
 * Address: SQLite LIKE (ASCII case-folding) on whole words of the address key, for each spelling of the street line
 * (addressSearchForms), and with a house number each parcel whose house-number range holds it (addressRangeMatches).
 * One row per URN, in place group (addressPlaceRank: in the named state and county only; same ZIP code, then same
 * city, then the rest), the words as written, then other spellings, then ranges, exact key first, then label, then
 * URN; parcels sharing a label ordered by their cards (addressCardCompare); at most `limit`.
 *
 * Every row a query can match is in a list the query names: "F:<first word>" (house number), "U:<street type>"
 * (a one-word street query), "B:<word> <street type>" or "A:<street type> <word>" (the word pair around a street
 * type in the query), and "R:<first street word>" for the rows whose label starts with a house-number range
 * (addressRangeListKey; packs built before 2026-11-12 have none, and there a number inside a range matches nothing).
 * Lists are sorted by label then URN, so a scan of the list of the words as written stops once the first group
 * the place can fill holds `limit` of them and the last one's label is done; "E:<key>" gives the URNs whose key
 * equals the query's key exactly, which go first. A "U:" list keeps only its first MAX_LIMIT URNs besides the exact
 * ones, so the SDK places a one-word query among those (ADDRESS_ONE_WORD_CANDIDATES). Each result's card comes from
 * the parcel's stored registry_get record (its current facts).
 *
 * Entities: SQLite LIKE '%key%' on name keys, DISTINCT URN in scan (rowid) order, then exact key first, then label,
 * ties in scan order (of each entity's first matching row). Rows are found through posting lists of the 1- to
 * 3-character grams of the upper-cased keys (n/df.json gives each gram's row count, n/b/ and n/p/ the lists), or,
 * for a query whose grams are all very common, read in label order (n/l/) after its exact matches (n/e/).
 */
import {
  ADDRESS_STREET_HINT_ROWS,
  addressCard,
  addressForms,
  addressHintStreets,
  addressKeyMatches,
  addressListKey,
  addressMatchCompare,
  addressPlaceRank,
  addressPlaceTop,
  addressPlaceWith,
  addressQuery,
  addressQueryWithPlace,
  addressRangeListKey,
  addressResultRows,
  addressRowTier,
  addressSearchKeysFor,
  addressStreetHintFrom,
  addressUnit,
  addressWindowEnd,
  nameSearchKeyFor,
  type AddressCard,
  type AddressForms,
  type AddressMatch,
  type AddressPlace,
  type AddressStreetHint,
  type AddressWhere,
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

export { addressListKey };

/** The SQL WHERE of registrySearchAddress for one row's key (addressKeyMatches). */
export function addressRowMatches(
  mode: "house_number" | "street",
  words: string[],
  key: string,
): boolean {
  return addressKeyMatches(mode, words, upperAscii(key));
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

/** Every row of a list, page by page. */
async function* listRows(
  pack: Pack,
  list: AddressList,
): AsyncGenerator<AddressRow[]> {
  if (Array.isArray(list)) yield list;
  else yield* listPages<AddressRow>(pack, "a/p", PAGE_ROWS, list);
}

/** A parcel's card from its stored registry_get record. */
async function cardOf(
  pack: Pack,
  urn: string,
  label: string | null,
): Promise<AddressCard> {
  const entry = await pack.entry(urn);
  const facts = (entry?.r.facts ?? []) as {
    predicate: unknown;
    value: unknown;
  }[];
  return addressCard(label, facts);
}

export interface AddressAnswer {
  results: Record<string, unknown>[];
  /** What the search found on the query's street, when nothing matched. */
  hint: AddressStreetHint | null;
}

export async function searchAddress(
  pack: Pack,
  asked: string,
  limit: number,
  where: AddressWhere = {},
): Promise<AddressAnswer> {
  const none: AddressAnswer = { results: [], hint: null };
  const query = addressQueryWithPlace(asked);
  const m = await pack.manifest();
  const { mode } = addressQuery(query);
  if (mode === null) return none;
  const line = query.split(",")[0] ?? "";
  const place = addressPlaceWith(query, where);
  // A state or county the pack holds no parcel in: nothing can match there, so no list is read.
  if (place.state !== null && !m.coverage.totals.states.includes(place.state))
    return none;
  if (
    place.county != null &&
    !m.coverage.counties.some(
      (c) => `${c.state_fips}${c.county_fips}` === place.county,
    )
  )
    return none;
  const keys = addressSearchKeysFor(m.versions.address_key_version, line);
  if (keys.length !== 1)
    throw new Error("the pack holds version 1 address keys");
  const words = keys[0]!.split(" ");
  if (mode === "street" && words.length === 1) {
    const found = await searchOneWord(pack, m, words, limit, place);
    const results: Record<string, unknown>[] = [];
    for (const r of found)
      results.push({ ...r, ...(await cardOf(pack, r.urn, r.label)) });
    return { results, hint: null };
  }
  // A query rebuilt with a comma still finds the address it was, exactly, first.
  const forms = addressForms(
    [words],
    query === asked
      ? []
      : addressSearchKeysFor(
          m.versions.address_key_version,
          asked.split(",")[0] ?? "",
        ),
  );
  const sorted = await addressMatches(
    pack,
    m,
    mode,
    forms,
    limit,
    place,
    // The unit as asked: rebuilding a query without a comma leaves the unit out of its street line.
    addressUnit(asked),
  );
  const end = addressWindowEnd(sorted, limit);
  const items: { match: AddressMatch; card: AddressCard }[] = [];
  for (const match of sorted.slice(0, end))
    items.push({ match, card: await cardOf(pack, match.urn, match.label) });
  const results = addressResultRows(items, limit);
  if (results.length) return { results, hint: null };
  const number = words[0] ?? "";
  if (!/^[0-9]+$/.test(number)) return none;
  const lists: {
    street: string[];
    count: number;
    rows: AddressRow[] | null;
  }[] = [];
  for (const { street, list } of addressHintStreets(mode, forms)) {
    const l = await dictionary<AddressList>(pack, m, list);
    const count = l === undefined ? 0 : Array.isArray(l) ? l.length : l.n;
    let rows: AddressRow[] | null = null;
    if (count <= ADDRESS_STREET_HINT_ROWS) {
      rows = [];
      if (l) for await (const page of listRows(pack, l)) rows.push(...page);
    }
    lists.push({ street, count, rows });
  }
  return { results, hint: addressStreetHintFrom(number, place, lists) };
}

/**
 * Every match of a search with a house number or a street of two or more words, sorted by addressMatchCompare,
 * read from its lists. The list of the words as written is read first, its exact rows (the "E:" list) before it;
 * once the first group the place can fill holds `limit` matches of the words as written and the last one's label
 * is done, nothing later can come before them, so the scan stops and the other lists are not read.
 */
async function addressMatches(
  pack: Pack,
  m: Manifest,
  mode: "house_number" | "street",
  forms: AddressForms,
  limit: number,
  place: AddressPlace,
  unit: string | null,
): Promise<AddressMatch[]> {
  const first = forms.first[0]!;
  const byUrn = new Map<string, AddressMatch>();
  const top = addressPlaceTop(place);
  let full = 0; // matches of the words as written in the top group
  const put = (urn: string, label: string | null, key: string | null) => {
    const t: [0 | 1 | 2, boolean] | null =
      key === null ? [0, true] : addressRowTier(mode, forms, urn, label, key);
    if (!t) return false;
    const rank = addressPlaceRank(place, urn, label);
    if (rank < 0) return false;
    const was = byUrn.get(urn);
    if (!was || t[0] < was.tier) {
      if (was && was.rank === top && was.tier === 0) full--;
      byUrn.set(urn, {
        urn,
        label,
        rank,
        tier: t[0],
        exact: t[1],
        unit: unit !== null && addressUnit(label) === unit,
      });
      if (rank === top && t[0] === 0) full++;
      return rank === top && t[0] === 0;
    }
    if (t[0] === was.tier && t[1]) was.exact = true;
    return false;
  };
  for (const key of [first.join(" "), ...forms.exact]) {
    const exact = (await dictionary<ExactList>(pack, m, `E:${key}`)) ?? [];
    for (const [urn, label] of exact) put(urn, label, null);
  }
  let done = unit === null && full >= limit;
  const written = addressListKey(mode, first);
  const lists: string[] = [];
  if (written !== null) lists.push(written);
  for (const f of forms.other) {
    const k = addressListKey(mode, f);
    if (k !== null && !lists.includes(k)) lists.push(k);
  }
  if (mode === "house_number")
    for (const f of [...forms.first, ...forms.other]) {
      const k =
        /^[0-9]+$/.test(f[0] ?? "") && f.length > 1
          ? addressRangeListKey(f, 1)
          : null;
      if (k !== null && !lists.includes(k)) lists.push(k);
    }
  for (const key of lists) {
    if (done) break;
    const list = await dictionary<AddressList>(pack, m, key);
    if (!list) continue;
    const isWritten = key === written;
    let boundary: string | null | undefined;
    scan: for await (const rows of listRows(pack, list))
      for (const [urn, label, k] of rows) {
        if (isWritten && boundary !== undefined && label !== boundary) {
          done = true;
          break scan;
        }
        // A query naming a unit reads the whole list: the parcel naming that unit may come later in label order.
        if (put(urn, label, k) && isWritten && unit === null && full >= limit)
          boundary = label;
      }
  }
  return [...byUrn.values()].sort(addressMatchCompare);
}

/**
 * A street-type word alone: the matches in list order (exact key first, then label, then URN), grouped by
 * addressPlaceRank: with a place, only those in its state, and those with its ZIP code, then those in its city, then
 * the rest. The scan stops once the first group the place can fill holds `limit` matches; otherwise it reads the
 * whole (truncated) list.
 */
async function searchOneWord(
  pack: Pack,
  m: Manifest,
  words: string[],
  limit: number,
  place: AddressPlace,
): Promise<Match[]> {
  const fullKey = words.join(" ");
  const listKey = addressListKey("street", words);
  if (listKey === null) return [];
  const exact = (await dictionary<ExactList>(pack, m, `E:${fullKey}`)) ?? [];
  const exactUrns = new Set(exact.map(([urn]) => urn));
  const top = addressPlaceTop(place);
  const groups: Match[][] = [[], [], []];
  // True once the first group the place can fill is full: no later match can come before it.
  const put = (urn: string, label: string | null): boolean => {
    const rank = addressPlaceRank(place, urn, label);
    if (rank >= 0) groups[rank]!.push({ urn, label });
    return groups[top]!.length >= limit;
  };
  let full = false;
  for (const [urn, label] of exact) if ((full = put(urn, label))) break;
  const list = full
    ? undefined
    : await dictionary<AddressList>(pack, m, listKey);
  if (list) {
    let last: string | undefined;
    scan: for await (const rows of listRows(pack, list))
      for (const [urn, label, key] of rows) {
        if (urn === last || exactUrns.has(urn)) continue;
        if (!addressRowMatches("street", words, key)) continue;
        last = urn;
        if (put(urn, label)) break scan;
      }
  }
  return groups.flat().slice(0, limit);
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
