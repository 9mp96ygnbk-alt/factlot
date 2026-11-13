/**
 * registry_lookup_batch: many parcels in one call, each identified by a FactLot URN, an account
 * number with its county, or an address, answered with a compact row per parcel.
 *
 * The batch is made of the single registry tools only, so every surface answers it alike: each
 * item is one call of registry_get (a URN), registry_resolve_parcel (an account) or
 * registry_search_address (an address), and for a parcel found by account or address one more
 * call of registry_get on its URN. `lookupItem` is that sequence as a generator: it yields each
 * single call and receives the call's outcome, as runTool returns it. The SDK drives it with
 * runTool; the hosted API with its registry service (deploy/cloudflare/src/registry.ts); Python's
 * `_lookup_batch` (python/src/factlot/tools.py) is the same steps.
 *
 * The row is read from registry_get's answer: the current facts as registry_get returns them to
 * the caller, and the newest entry of value_history (the current roll year, which is also what
 * a caller without a Pro or Team key sees there). Owners of record are what registry_get gives:
 * organisations only, as the registry stores them.
 */
import { FactLotIdError, parse } from "@factlot/id";

import type { ToolError, ToolOutcome } from "./catalog.ts";
import {
  addressPlaceRank,
  addressPlaceWith,
  addressQueryWithPlace,
  addressUnit,
  normalizeAddress,
  stateCode,
  stateFipsOf,
  type AddressPlace,
} from "./registry.ts";

/** Most items in one registry_lookup_batch call (the same cap as registry_tx_equity_candidates_batch). */
export const LOOKUP_BATCH_MAX_ITEMS = 50;
/** Results an address item's search reads (registry_search_address's default limit). */
export const LOOKUP_BATCH_SEARCH_LIMIT = 20;
/** Candidates an ambiguous address item lists. */
export const LOOKUP_BATCH_CANDIDATES = 5;

export const LOOKUP_BATCH_NOTICE =
  "Each row is the parcel's current facts as its sources publish them, each cited: not an appraisal, a valuation opinion or advice. Owners of record are organisations as the source names them; natural persons are not stored. Relay each source's rights (ai_use, redistribution) with its facts.";

/** The three ways an item names its parcel, and the fields each one takes besides `ref`. */
const MODES = {
  urn: [] as string[],
  apn: ["state_fips", "county_fips"],
  address: ["state", "city", "postal_code", "county_fips"],
} as const;
type Mode = keyof typeof MODES;
const BY: Record<Mode, "urn" | "account" | "address"> = {
  urn: "urn",
  apn: "account",
  address: "address",
};
const ITEM_FIELDS = new Set([
  "urn",
  "apn",
  "address",
  "state_fips",
  "county_fips",
  "state",
  "city",
  "postal_code",
]);

export const LOOKUP_WHICH_PARCEL =
  "give exactly one of urn, apn (with state_fips and county_fips, or a 5-digit county_fips) or address";

type Json = Record<string, unknown>;
export type LookupItem = { ref?: string } & Record<string, unknown>;
/** One single-tool call of an item. */
export interface LookupCall {
  tool: "registry_get" | "registry_resolve_parcel" | "registry_search_address";
  input: Json;
}

/** An input error of one item, worded as the catalog words them. */
function inputError(issues: { path: string; message: string }[]): ToolError {
  return {
    error: "InputError",
    message: `invalid input: ${issues.map((i) => `${i.path || "(root)"}: ${i.message}`).join("; ")}`,
    issues,
  };
}

/** The registry could not answer an item's call (RegistryUnavailable): that item is an error. */
export function lookupUnavailable(outcome: ToolOutcome): boolean {
  return !outcome.ok && outcome.error.error === "RegistryUnavailable";
}

function text(v: unknown): string | null {
  return typeof v === "string" && v !== ""
    ? v
    : typeof v === "number" && Number.isFinite(v)
      ? String(v)
      : null;
}

function finite(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** The words of an address's street line (before the first comma), normalized as the address index keys it. */
function streetWords(address: string): string[] {
  return normalizeAddress(address.split(",")[0] ?? "")
    .split(" ")
    .filter((w) => w !== "");
}

/** A unit written as a bare number after the street ("700 BAYOU DRIVE 1001 ..."). */
const BARE_UNIT = /^[0-9][0-9A-Z-]*$/;

/**
 * Words after the street on a line with no comma that are only its place: city words, a state, and
 * optionally a ZIP code ("EXAMPLE CITY TX 77999", "77999 1234" being ZIP+4 split by normalizing).
 */
function placeTail(words: string[]): boolean {
  const w = [...words];
  if (
    w.length >= 2 &&
    /^[0-9]{4}$/.test(w[w.length - 1]!) &&
    /^[0-9]{5}$/.test(w[w.length - 2]!)
  )
    w.pop();
  if (w.length && /^[0-9]{5}$/.test(w[w.length - 1]!)) w.pop();
  const st = w.pop();
  if (st === undefined || st.length !== 2 || stateCode(st) !== st) return false;
  return w.every((x) => /^[A-Z]+$/.test(x));
}

/**
 * Whether two addresses name the same street address and unit: one street line's normalized words
 * (`normalizeAddress`: "Street" = "St", a unit designator and its value dropped) begin the other's,
 * and what the longer one has after them, on a line with no comma, is only a bare unit number and
 * its place ("700 Bayou Drive 1001 Example City TX 77999"); then both name the same unit
 * (`addressUnit`, or the bare number), or neither names one. The query is read as the search reads
 * it (`addressQueryWithPlace`).
 */
export function lookupSameStreet(query: string, label: unknown): boolean {
  if (typeof label !== "string") return false;
  const q = addressQueryWithPlace(query);
  const sides = [
    { text: q, words: streetWords(q), unit: addressUnit(query) },
    { text: label, words: streetWords(label), unit: addressUnit(label) },
  ];
  const [a, b] = sides;
  if (!a!.words.length || !b!.words.length) return false;
  const [short, long] =
    a!.words.length <= b!.words.length ? [a!, b!] : [b!, a!];
  if (!short.words.every((w, i) => long.words[i] === w)) return false;
  let rest = long.words.slice(short.words.length);
  if (rest.length) {
    if (long.text.includes(",")) return false;
    if (long.unit === null && BARE_UNIT.test(rest[0]!)) {
      long.unit = rest[0]!;
      rest = rest.slice(1);
    }
    if (rest.length && !placeTail(rest)) return false;
  }
  return a!.unit === b!.unit;
}

/**
 * Whether a search result is in the place an address item names: always, when the item names no
 * city and no ZIP code (in its text or its city and postal_code fields); else when the result's
 * label has that ZIP code or is in that city (`addressPlaceRank` 0 or 1, as the search ranks it).
 */
export function lookupPlaceAgrees(
  place: AddressPlace,
  urn: unknown,
  label: unknown,
): boolean {
  if (place.city === null && place.zip === null) return true;
  const rank = addressPlaceRank(place, String(urn), label);
  return rank === 0 || rank === 1;
}

/** The place an address item names, read as the search reads it. */
export function lookupPlace(item: LookupItem): AddressPlace {
  const where: Record<string, string> = {};
  for (const k of ["state", "city", "postal_code", "county_fips"])
    if (typeof item[k] === "string") where[k] = item[k] as string;
  return addressPlaceWith(addressQueryWithPlace(String(item.address)), where);
}

/** A result's county (5-digit FIPS from its URN), or the URN itself. */
function countyOf(urn: unknown): string {
  const m = /^fl:[a-z]+:us-([0-9]{5})/.exec(String(urn));
  return m ? m[1]! : String(urn);
}

/**
 * The state (2-digit FIPS) an item names, for usage by region when no parcel was found: from its
 * URN, its state_fips or 5-digit county_fips, or an address's place; else null.
 */
export function lookupItemStateFips(item: LookupItem): string | null {
  if (typeof item.urn === "string") {
    const m = /^fl:[a-z]+:us-([0-9]{2})/.exec(item.urn);
    return m ? m[1]! : null;
  }
  if (typeof item.state_fips === "string" && /^[0-9]{2}$/.test(item.state_fips))
    return item.state_fips;
  if (
    typeof item.county_fips === "string" &&
    /^[0-9]{5}$/.test(item.county_fips)
  )
    return item.county_fips.slice(0, 2);
  if (typeof item.address === "string") {
    const st = lookupPlace(item).state;
    return st === null ? null : stateFipsOf(st);
  }
  return null;
}

interface Fact {
  id?: unknown;
  predicate?: unknown;
  value?: unknown;
  as_of?: unknown;
  provenance?: { sources?: Json[] };
  rights?: Json;
}

/** The predicates a row reads, by the row's field name. */
const ROW_FACTS = [
  ["account", "parcel.apn"],
  ["property_category", "parcel.state_property_category"],
  ["use_code", "parcel.local_use_code"],
  ["improvement_area_sf", "parcel.improvement_area_sf"],
  ["year_built", "parcel.year_built"],
  ["owner_of_record", "ownership.owner_of_record"],
] as const;

function citation(f: Fact): Json {
  const s = f.provenance?.sources?.[0] ?? {};
  return {
    fact_id: f.id ?? null,
    document_id: s.document_id ?? null,
    locator: s.section ?? null,
    as_of: f.as_of ?? null,
  };
}

/** A source document a row cites: title, address, read date and rights, from a fact citing it. */
function sourceOf(documentId: unknown, facts: Fact[]): Json {
  const f = facts.find(
    (x) => x.provenance?.sources?.[0]?.document_id === documentId,
  );
  if (!f) return { document_id: documentId };
  const s = f.provenance!.sources![0]!;
  const out: Json = {
    document_id: documentId,
    title: s.title ?? null,
    uri: s.uri ?? null,
    retrieved_at: s.retrieved_at ?? null,
    as_of: f.as_of ?? null,
    license: f.rights?.license ?? null,
    ai_use: f.rights?.ai_use ?? null,
    redistribution: f.rights?.redistribution ?? null,
  };
  if (f.rights?.attribution !== undefined)
    out.attribution = f.rights.attribution;
  return out;
}

/**
 * The compact row of a parcel from registry_get's answer: URN, label, the roll's account,
 * category, use code, improvement area and year built, the newest value_history entry (current
 * roll year, cited), the owner of record as registry_get gives it with its linked entity, each
 * field's citation, the source documents cited, and registry_get's warnings.
 */
export function lookupRow(record: Json): Json {
  const facts = (Array.isArray(record.facts) ? record.facts : []) as Fact[];
  const first = (p: string) => facts.find((f) => f.predicate === p);
  const citations: Json = {};
  const docs: unknown[] = [];
  const cite = (field: string, f: Fact | undefined) => {
    if (!f) return;
    const c = citation(f);
    citations[field] = c;
    if (c.document_id !== null && !docs.includes(c.document_id))
      docs.push(c.document_id);
  };
  for (const [field, p] of ROW_FACTS) cite(field, first(p));
  const history = Array.isArray(record.value_history)
    ? (record.value_history as Json[])
    : [];
  const value = history[0] ?? null;
  for (const c of Object.values(
    ((value?.citations ?? {}) as Record<string, Json | null>) ?? {},
  ))
    if (c && c.document_id != null && !docs.includes(c.document_id))
      docs.push(c.document_id);
  const owner = first("ownership.owner_of_record");
  const link = (
    (Array.isArray(record.relationships) ? record.relationships : []) as Json[]
  ).find((r) => r.type === "owns" && r.to_urn === record.urn);
  return {
    urn: record.urn,
    label: record.label ?? null,
    record_status: record.status ?? null,
    account: text(first("parcel.apn")?.value),
    property_category: text(first("parcel.state_property_category")?.value),
    use_code: text(first("parcel.local_use_code")?.value),
    improvement_area_sf: finite(first("parcel.improvement_area_sf")?.value),
    year_built: finite(first("parcel.year_built")?.value),
    value,
    owner_of_record: owner
      ? {
          name: owner.value,
          entity_urn: typeof link?.from_urn === "string" ? link.from_urn : null,
        }
      : null,
    citations,
    sources: docs.map((d) => sourceOf(d, facts)),
    warnings: Array.isArray(record.warnings) ? record.warnings : [],
  };
}

/** What every entry of an item starts with: its index, its ref when sent, and how it names its parcel. */
export function lookupHead(item: LookupItem, index: number): Json {
  const head: Json = { index };
  if (item.ref !== undefined) head.ref = item.ref;
  const modes = (Object.keys(MODES) as Mode[]).filter(
    (k) => item[k] !== undefined,
  );
  if (modes.length === 1) head.by = BY[modes[0]!];
  return head;
}

/**
 * One item of the batch: yields its single-tool calls, receives each outcome, and returns the
 * item's entry (the drivers handle an outcome `lookupUnavailable` matches). Entry fields: index (in
 * the input), ref (when sent), by (urn, account or address), status, and per status: found →
 * parcel (and for an address, match); not_found → message and coverage, as the single call gave
 * them; ambiguous (an address) → reason, matches, candidates and message; error → error.
 * A not_found entry whose last call answered NotFound (registry_get on a URN not in the registry)
 * also carries that error: its coverage is the parcel miss registry_resolve_parcel gives for the
 * same county, and it is counted the same way.
 *
 * An address is `found` when exactly one search result is exact (same street address and unit,
 * `lookupSameStreet`, in the place the item names, `lookupPlaceAgrees`), or when the search
 * returned one parcel that is in that place; never across counties when the item names no city or
 * ZIP code. Otherwise it is `ambiguous`, with reason several_places (results in more than one
 * county, no city or ZIP code named), same_address (several exact: separate accounts at one
 * address), place_differs (the one parcel found is not shown in the place named) or
 * no_exact_match.
 */
export function* lookupItem(
  item: LookupItem,
  index: number,
): Generator<LookupCall, Json, ToolOutcome> {
  const head = lookupHead(item, index);
  const given = (k: string) => item[k] !== undefined;
  const modes = (Object.keys(MODES) as Mode[]).filter(given);
  if (modes.length !== 1)
    return {
      ...head,
      status: "error",
      error: inputError([{ path: "", message: LOOKUP_WHICH_PARCEL }]),
    };
  const mode = modes[0]!;
  const allowed = new Set<string>([mode, ...MODES[mode]]);
  const stray = [...ITEM_FIELDS].filter((k) => given(k) && !allowed.has(k));
  if (stray.length)
    return {
      ...head,
      status: "error",
      error: inputError(
        stray.map((k) => ({
          path: k,
          message: `not used with ${mode}; ${mode} takes ${MODES[mode].length ? MODES[mode].join(", ") : "nothing else"}`,
        })),
      ),
    };
  const fail = (error: ToolError): Json => ({
    ...head,
    status: "error",
    error,
  });
  const miss = (coverage: unknown, error?: ToolError): Json => ({
    ...head,
    status: "not_found",
    message: String((coverage as Json | null)?.message ?? error?.message ?? ""),
    coverage: coverage ?? null,
    ...(error ? { error } : {}),
  });

  let urn: string;
  let match: Json | undefined;
  if (mode === "urn") {
    urn = String(item.urn);
    try {
      const { kind } = parse(urn);
      if (kind !== "parcel")
        throw new FactLotIdError(
          `"${urn}" is a ${kind} URN; registry_lookup_batch needs a parcel URN`,
        );
    } catch (err) {
      if (!(err instanceof FactLotIdError)) throw err;
      return fail({
        error: "FactLotIdError",
        message: err.message,
        issues: [],
      });
    }
  } else if (mode === "apn") {
    const county = item.county_fips;
    if (county === undefined)
      return fail(
        inputError([
          {
            path: "county_fips",
            message:
              "required with apn: a 3-digit county_fips with state_fips, or a 5-digit county_fips",
          },
        ]),
      );
    let input: Json;
    if (given("state_fips"))
      input = {
        state_fips: item.state_fips,
        county_fips: county,
        apn: item.apn,
      };
    else if (typeof county === "string" && /^[0-9]{5}$/.test(county))
      input = {
        state_fips: county.slice(0, 2),
        county_fips: county.slice(2),
        apn: item.apn,
      };
    else
      return fail(
        inputError([
          {
            path: "state_fips",
            message:
              "required with a 3-digit county_fips; or give a 5-digit county_fips alone",
          },
        ]),
      );
    const outcome = yield { tool: "registry_resolve_parcel", input };
    if (!outcome.ok) return fail(outcome.error);
    const r = outcome.result as Json;
    if (typeof r.urn !== "string") return miss(r.coverage);
    urn = r.urn;
  } else {
    const input: Json = { address: item.address };
    for (const k of MODES.address) if (given(k)) input[k] = item[k];
    input.limit = LOOKUP_BATCH_SEARCH_LIMIT;
    const outcome = yield { tool: "registry_search_address", input };
    if (!outcome.ok) return fail(outcome.error);
    const r = outcome.result as Json;
    const results = (Array.isArray(r.results) ? r.results : []) as Json[];
    if (results.length === 0) return miss(r.coverage);
    const query = String(item.address);
    const place = lookupPlace(item);
    const named = place.city !== null || place.zip !== null;
    const agrees = (x: Json) => lookupPlaceAgrees(place, x.urn, x.label);
    const exact = results.filter(
      (x) => lookupSameStreet(query, x.label) && agrees(x),
    );
    const more = results.length >= LOOKUP_BATCH_SEARCH_LIMIT ? " or more" : "";
    const counties = new Set(results.map((x) => countyOf(x.urn))).size;
    const ambiguous = (reason: string, message: string): Json => ({
      ...head,
      status: "ambiguous",
      reason,
      matches: results.length,
      candidates: [
        ...exact,
        ...results.filter((x) => !exact.includes(x)),
      ].slice(0, LOOKUP_BATCH_CANDIDATES),
      message,
    });
    const which =
      "send the urn, or the apn with its county, of the one you mean";
    if (!named && counties > 1)
      return ambiguous(
        "several_places",
        `${results.length}${more} parcels in ${counties} counties match this address, which names no city or ZIP code; add the city, ZIP code, state or county_fips, or ${which}`,
      );
    if (exact.length > 1)
      return ambiguous(
        "same_address",
        `${exact.length} parcels have this address exactly (separate accounts at one address); ${which}`,
      );
    if (exact.length === 0 && results.length === 1 && !agrees(results[0]!))
      return ambiguous(
        "place_differs",
        `the only parcel found at this street address is not shown in the place the address names (its label does not have that city or ZIP code); check the address, or ${which} if it is this parcel`,
      );
    if (exact.length === 0 && results.length > 1)
      return ambiguous(
        "no_exact_match",
        `${results.length}${more} parcels match this address and none has it exactly; ${which}, or a fuller address`,
      );
    const chosen = exact[0] ?? results[0]!;
    urn = String(chosen.urn);
    match = { exact: exact.length === 1, matches: results.length };
  }

  const got = yield { tool: "registry_get", input: { urn } };
  if (!got.ok)
    return got.error.error === "NotFound"
      ? miss(got.error.coverage, {
          error: "NotFound",
          message: got.error.message,
          issues: got.error.issues,
        })
      : fail(got.error);
  return {
    ...head,
    status: "found",
    parcel: lookupRow(got.result as Json),
    ...(match ? { match } : {}),
  };
}

/** The batch answer from the items' entries, in input order. */
export function lookupBatchAnswer(entries: Json[]): Json {
  const count = (s: string) => entries.filter((e) => e.status === s).length;
  return {
    results: entries,
    summary: {
      items: entries.length,
      found: count("found"),
      not_found: count("not_found"),
      ambiguous: count("ambiguous"),
      errors: count("error"),
    },
    notice: LOOKUP_BATCH_NOTICE,
  };
}

/** Items whose registry calls fail before the rest of a batch is no longer sent. */
export const LOOKUP_UNAVAILABLE_ITEMS_MAX = 5;

/** The message a call that threw (no answer from the registry service) leaves on its item. */
export const LOOKUP_NO_ANSWER =
  "the registry service did not answer; retry in a moment";

/** An item the registry could not answer: an error of its own, not counted. */
function unavailableEntry(
  item: LookupItem,
  index: number,
  message: string,
): Json {
  return {
    ...lookupHead(item, index),
    status: "error",
    error: { error: "RegistryUnavailable", message, issues: [] },
  };
}

function notAttempted(item: LookupItem, index: number): Json {
  return unavailableEntry(
    item,
    index,
    `not attempted: ${LOOKUP_UNAVAILABLE_ITEMS_MAX} items of this batch could not be answered by the registry, so the rest were not sent and nothing was counted for them; send them again`,
  );
}

/**
 * The batch over a synchronous single-tool runner (the SDK's runTool). An item whose call gets
 * RegistryUnavailable is an error of its own; after LOOKUP_UNAVAILABLE_ITEMS_MAX such items the
 * rest are not attempted. When no call of any item was answered and one was unavailable, the whole
 * call fails with the first such outcome, as the single tools do (a registry not loaded).
 */
export function lookupBatchSync(
  items: LookupItem[],
  run: (tool: string, input: Json) => ToolOutcome,
): ToolOutcome {
  const entries: Json[] = [];
  let failures = 0;
  let answered = false;
  let first: ToolOutcome | undefined;
  for (const [k, item] of items.entries()) {
    if (failures >= LOOKUP_UNAVAILABLE_ITEMS_MAX) {
      entries.push(notAttempted(item, k));
      continue;
    }
    const steps = lookupItem(item, k);
    let step = steps.next(undefined as unknown as ToolOutcome);
    let entry: Json | undefined;
    while (!step.done) {
      const outcome = run(step.value.tool, step.value.input);
      if (lookupUnavailable(outcome)) {
        failures++;
        first ??= outcome;
        entry = unavailableEntry(
          item,
          k,
          (outcome as { error: ToolError }).error.message,
        );
        break;
      }
      answered = true;
      step = steps.next(outcome);
    }
    entries.push(entry ?? (step.value as Json));
  }
  if (first && !answered) return first;
  return { ok: true, result: lookupBatchAnswer(entries) };
}

/**
 * The batch over an asynchronous single-tool runner (the hosted registry service), at most
 * `concurrency` items in flight. An item whose call gets RegistryUnavailable, or whose call throws
 * (no answer from the service), is an error of its own; once LOOKUP_UNAVAILABLE_ITEMS_MAX items have
 * failed so, no further item is started and those left are not attempted. When no call of any item
 * was answered, the whole call fails: with the first failed item's outcome in input order, or its
 * throw rethrown.
 */
export async function lookupBatchAsync(
  items: LookupItem[],
  run: (tool: string, input: Json) => Promise<ToolOutcome>,
  concurrency: number,
): Promise<ToolOutcome> {
  type Failure = { outcome: ToolOutcome } | { thrown: unknown };
  const entries: (Json | undefined)[] = new Array(items.length);
  const failed: (Failure | undefined)[] = new Array(items.length);
  let next = 0;
  let failures = 0;
  let answered = false;
  const lane = async () => {
    while (failures < LOOKUP_UNAVAILABLE_ITEMS_MAX && next < items.length) {
      const k = next++;
      const item = items[k]!;
      const steps = lookupItem(item, k);
      let step = steps.next(undefined as unknown as ToolOutcome);
      try {
        while (!step.done) {
          const outcome = await run(step.value.tool, step.value.input);
          if (lookupUnavailable(outcome)) {
            failures++;
            failed[k] = { outcome };
            entries[k] = unavailableEntry(
              item,
              k,
              (outcome as { error: ToolError }).error.message,
            );
            break;
          }
          answered = true;
          step = steps.next(outcome);
        }
        if (step.done) entries[k] = step.value;
      } catch (thrown) {
        failures++;
        failed[k] = { thrown };
        entries[k] = unavailableEntry(item, k, LOOKUP_NO_ANSWER);
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, lane),
  );
  const first = failed.find((f) => f !== undefined);
  if (first && !answered) {
    if ("thrown" in first) throw first.thrown;
    return first.outcome;
  }
  return {
    ok: true,
    result: lookupBatchAnswer(
      items.map((item, k) => entries[k] ?? notAttempted(item, k)),
    ),
  };
}
