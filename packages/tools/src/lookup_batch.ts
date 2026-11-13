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
  addressQueryWithPlace,
  addressUnit,
  normalizeAddress,
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

/** The registry service could not answer: the whole batch fails, as the single tools do. */
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

/** The street line of an address (before the first comma), normalized as the address index keys it. */
function streetLine(address: string): string {
  return normalizeAddress(address.split(",")[0] ?? "");
}

/**
 * Whether a search result has the item's address exactly: its label's street line normalized
 * (`normalizeAddress`: "Street" = "St", a unit dropped) is the query's, and its label names the
 * same unit as the query (or neither names one). The query is read as the search reads it
 * (`addressQueryWithPlace`: a city and state after the street with no comma are the place).
 */
export function lookupExact(query: string, label: unknown): boolean {
  if (typeof label !== "string") return false;
  return (
    streetLine(addressQueryWithPlace(query)) === streetLine(label) &&
    addressUnit(query) === addressUnit(label)
  );
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

/**
 * One item of the batch: yields its single-tool calls, receives each outcome, and returns the
 * item's entry. The caller stops at an outcome `lookupUnavailable` matches (the whole batch
 * fails). Entry fields: index (in the input), ref (when sent), by (urn, account or address),
 * status, and per status: found → parcel (and for an address, match); not_found → message and
 * coverage, as the single call gave them; ambiguous → matches, candidates and message; error →
 * error. An entry whose single call answered with an error carries that error (`error`): an
 * input error (status error) or registry_get's NotFound for a URN not in the registry (status
 * not_found).
 */
export function* lookupItem(
  item: LookupItem,
  index: number,
): Generator<LookupCall, Json, ToolOutcome> {
  const head: Json = { index };
  if (item.ref !== undefined) head.ref = item.ref;
  const given = (k: string) => item[k] !== undefined;
  const modes = (Object.keys(MODES) as Mode[]).filter(given);
  if (modes.length !== 1)
    return {
      ...head,
      status: "error",
      error: inputError([{ path: "", message: LOOKUP_WHICH_PARCEL }]),
    };
  const mode = modes[0]!;
  head.by = BY[mode];
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
    const exact = results.filter((x) => lookupExact(query, x.label));
    if (results.length > 1 && exact.length !== 1) {
      const rest = results.filter((x) => !exact.includes(x));
      const more =
        results.length >= LOOKUP_BATCH_SEARCH_LIMIT ? " or more" : "";
      return {
        ...head,
        status: "ambiguous",
        matches: results.length,
        candidates: [...exact, ...rest].slice(0, LOOKUP_BATCH_CANDIDATES),
        message:
          exact.length > 1
            ? `${exact.length} parcels have this address exactly (separate accounts at one address); send the urn, or the apn with its county, of the one you mean`
            : `${results.length}${more} parcels match this address and none has it exactly; send the urn, or the apn with its county, of the one you mean, or a fuller address`,
      };
    }
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

/**
 * The batch over a synchronous single-tool runner (the SDK's runTool). Returns the first
 * RegistryUnavailable outcome instead of an answer when one item's call gets it.
 */
export function lookupBatchSync(
  items: LookupItem[],
  run: (tool: string, input: Json) => ToolOutcome,
): ToolOutcome {
  const entries: Json[] = [];
  for (const [k, item] of items.entries()) {
    const steps = lookupItem(item, k);
    let step = steps.next(undefined as unknown as ToolOutcome);
    while (!step.done) {
      const outcome = run(step.value.tool, step.value.input);
      if (lookupUnavailable(outcome)) return outcome;
      step = steps.next(outcome);
    }
    entries.push(step.value);
  }
  return { ok: true, result: lookupBatchAnswer(entries) };
}

/**
 * The batch over an asynchronous single-tool runner (the hosted registry service), at most
 * `concurrency` items in flight. As in the synchronous batch, an item whose call gets
 * RegistryUnavailable (or whose call throws) fails the whole batch: no further items are
 * started, and the first such item in input order decides the outcome (a throw is rethrown).
 */
export async function lookupBatchAsync(
  items: LookupItem[],
  run: (tool: string, input: Json) => Promise<ToolOutcome>,
  concurrency: number,
): Promise<ToolOutcome> {
  type Settled =
    { entry: Json } | { outcome: ToolOutcome } | { thrown: unknown };
  const settled: (Settled | undefined)[] = new Array(items.length);
  let next = 0;
  let failed = false;
  const lane = async () => {
    while (!failed && next < items.length) {
      const k = next++;
      const steps = lookupItem(items[k]!, k);
      let step = steps.next(undefined as unknown as ToolOutcome);
      try {
        while (!step.done) {
          const outcome = await run(step.value.tool, step.value.input);
          if (lookupUnavailable(outcome)) {
            settled[k] = { outcome };
            failed = true;
            break;
          }
          step = steps.next(outcome);
        }
        if (step.done) settled[k] = { entry: step.value };
      } catch (thrown) {
        settled[k] = { thrown };
        failed = true;
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, lane),
  );
  const first = settled.find((s) => s !== undefined && !("entry" in s));
  if (first) {
    if ("thrown" in first) throw first.thrown;
    return (first as { outcome: ToolOutcome }).outcome;
  }
  return {
    ok: true,
    result: lookupBatchAnswer(settled.map((s) => (s as { entry: Json }).entry)),
  };
}
