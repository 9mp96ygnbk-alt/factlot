/**
 * Registry tools on the hosted API: the catalog checks the input, then this runner asks the
 * registry service (Worker factlot-registry, reached only through a service binding) for the
 * outcome. The service answers with exactly what runTool would return against a registry file.
 *
 * registry_tx_equity_candidates_batch is answered subject by subject: one service call of
 * registry_tx_equity_candidates per subject (at most BATCH_CONCURRENCY at a time), assembled here
 * into the batch answer the catalog gives. One request for the whole batch would run every
 * subject inside one registry request and its CPU limit.
 *
 * registry_lookup_batch is answered the same way: each item's single-tool calls (registry_get,
 * registry_resolve_parcel, registry_search_address; see @factlot/tools lookup_batch.ts) go to the
 * service one by one, each first checked as runTool checks it, at most BATCH_CONCURRENCY items
 * at a time. The registry Worker needs no route of its own for it.
 */
import {
  TX_EQUITY_NOTICE,
  TX_EQUITY_RULE,
  checkToolInput,
  lookupBatchAsync,
  nameReadsAsPerson,
  type LookupItem,
  type RegistryRunner,
  type ToolOutcome,
} from "@factlot/tools";

import type { Fetcher } from "./types.ts";

/** The registry service's address inside the binding; it has no public route. */
export const REGISTRY_RUN_URL = "https://registry.internal/run";

/** The batch tool answered by fanning out, and the single-subject tool it calls. */
export const TX_EQUITY_BATCH_TOOL = "registry_tx_equity_candidates_batch";
const TX_EQUITY_TOOL = "registry_tx_equity_candidates";
/** The batch of parcel lookups, answered by fanning out its items' single-tool calls. */
export const LOOKUP_BATCH_TOOL = "registry_lookup_batch";

/** Most single-subject calls of one batch in flight at once. */
export const BATCH_CONCURRENCY = 4;

/** The rule parameters a batch shares with every subject (catalog.ts TxEquityParamFields). */
const TX_EQUITY_PARAMS = [
  "area_band",
  "year_band",
  "min_matches",
  "limit",
  "tax_year",
  "same_building_class",
  "same_local_use_code",
  "local_use_codes",
] as const;

type Run = (name: string, input: unknown) => Promise<ToolOutcome>;

/**
 * Facts the hosted API does not serve, whatever the registry file holds. A mailing address can carry a person's
 * name on its first line with no "ATTN" or "C/O" marker ("JANE DOE TRUSTEE, 1 MAIN ST, ..."), which the
 * ingest scrub does not catch; until the registry files are cleaned, no mailing address leaves the API.
 */
export const WITHHELD_PREDICATES: ReadonlySet<string> = new Set([
  "ownership.owner_mailing_address",
  "entity.mailing_address",
]);

/** Name lists on recorded documents (deeds, mortgages, satisfactions), as the registry stores them. */
const PARTY_ROLES = ["grantors", "grantees", "borrowers", "lenders"] as const;

type Fact = { predicate?: unknown; value?: unknown; document_id?: unknown };

/**
 * Contact and account markers after which a stored name often carries a person ("<CO> LLC C/O JANE DOE",
 * "EQUITY TRUST CO FBO JOHN DOE", "DOE JOHN IRA", "U/W/O JANE DOE", "ATTN JOHN DOE", "% JOHN DOE"). Until the
 * registry files are purged with the corrected rule, a name carrying one is withheld whole: this also hides some
 * organisations ("<CO> LLC C/O <MANAGER> LLC"), which is the price of not reading the name after the marker.
 */
const PERSON_MARKERS =
  /(\bC\s*\/\s*O\b|\bCARE OF\b|\bATTN\b|\bATTENTION\b|\bF\s*\/?\s*B\s*\/?\s*O\b|\bIRA\b|\bCUSTODIAN\b|\bU\s*\/\s*W\b|\bUWO\b|(?:^|[^\d.\s]\s*|\s)%\s*[A-Z])/i;

/** A name the API does not serve as an owner or a party: one the person rule reads as a person, or one with a marker. */
export function nameWithheld(name: string): boolean {
  return nameReadsAsPerson(name) || PERSON_MARKERS.test(name);
}

/** An owner of record the API does not serve ("DOE, JANE CO TRUST", "<CO> LLC C/O JANE DOE"). */
function personOwner(f: Fact): boolean {
  return (
    f.predicate === "ownership.owner_of_record" &&
    typeof f.value === "string" &&
    nameWithheld(f.value)
  );
}

function isWithheldFact(v: unknown): boolean {
  if (!v || typeof v !== "object") return false;
  const f = v as Fact;
  return WITHHELD_PREDICATES.has(f.predicate as string) || personOwner(f);
}

/** A recorded document's value without the party names that read as persons, each counted in `<role>_withheld`. */
function withholdParties(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const v = value as Record<string, unknown>;
  if (!PARTY_ROLES.some((r) => Array.isArray(v[r]))) return value;
  const out: Record<string, unknown> = { ...v };
  for (const role of PARTY_ROLES) {
    const names = v[role];
    if (!Array.isArray(names)) continue;
    const kept = names.filter(
      (n) => !(typeof n === "string" && nameWithheld(n)),
    );
    const dropped = names.length - kept.length;
    if (!dropped) continue;
    if (kept.length) out[role] = kept;
    else delete out[role];
    const key = `${role}_withheld`;
    const was = v[key] as { count?: unknown; kinds?: unknown } | undefined;
    const count = (typeof was?.count === "number" ? was.count : 0) + dropped;
    const kinds = Array.isArray(was?.kinds) ? [...was.kinds] : [];
    if (!kinds.includes("person")) kinds.push("person");
    out[key] = { count, kinds };
  }
  return out;
}

/** Document ids of the person owners an answer object holds, in its facts or history, at its own level. */
function personOwnerDocuments(o: Record<string, unknown>): Set<unknown> {
  const docs = new Set<unknown>();
  for (const k of ["facts", "history"])
    if (Array.isArray(o[k]))
      for (const f of o[k] as Fact[])
        if (f && typeof f === "object" && personOwner(f))
          docs.add(f.document_id);
  return docs;
}

/**
 * `value` without what the hosted API does not serve, at any depth: every fact of a withheld predicate, every owner
 * of record that reads as a natural person with the ownership link drawn from it, and every recorded-document party
 * name that reads as a person (counted in `<role>_withheld`). Until the registry files are purged with the corrected
 * rule, this is what keeps those names out of every answer.
 */
export function withholdFacts<T>(value: T): T {
  if (Array.isArray(value))
    return value
      .filter((v) => !isWithheldFact(v))
      .map((v) => withholdFacts(v)) as T;
  if (value && typeof value === "object") {
    const o = value as Record<string, unknown>;
    const docs = personOwnerDocuments(o);
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(o)) {
      if (k === "relationships" && Array.isArray(v) && docs.size) {
        out[k] = withholdFacts(
          v.filter(
            (r) =>
              !(
                r &&
                typeof r === "object" &&
                (r as { type?: unknown }).type === "owns" &&
                docs.has((r as { document_id?: unknown }).document_id)
              ),
          ),
        );
      } else if (k === "value" && typeof o.predicate === "string") {
        out[k] = withholdParties(v);
      } else out[k] = withholdFacts(v);
    }
    return out as T;
  }
  return value;
}

export function registryRunner(service: Fetcher): RegistryRunner {
  const one: Run = async (name, input) => {
    const response = await service.fetch(
      new Request(REGISTRY_RUN_URL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tool: name, input }),
      }),
    );
    if (!response.ok)
      throw new Error(`registry service answered ${response.status}`);
    const outcome = (await response.json()) as ToolOutcome;
    if (typeof outcome !== "object" || outcome === null || !("ok" in outcome))
      throw new Error("registry service answered without an outcome");
    return outcome.ok ? withholdFacts(outcome) : outcome;
  };
  // A registry Worker older than the narrowing parameters ignores them: its list would look narrowed and is not.
  const guarded: Run = async (name, input) => {
    const outcome = await one(name, input);
    if (
      name === TX_EQUITY_TOOL &&
      outcome.ok &&
      asksNarrowing(input) &&
      !Array.isArray(
        (outcome.result as { selection?: { narrowing?: unknown } } | null)
          ?.selection?.narrowing,
      )
    )
      return {
        ok: false,
        error: {
          error: "RegistryUnavailable",
          message: NARROWING_UNAVAILABLE,
          issues: [],
        },
      };
    return outcome;
  };
  // A single call of a lookup batch item, checked as runTool checks it before it is sent.
  const checked: Run = async (name, input) => {
    const c = checkToolInput(name, input);
    return c.ok ? guarded(name, c.input) : c;
  };
  return (name, input) =>
    name === TX_EQUITY_BATCH_TOOL
      ? txEquityBatch(guarded, input)
      : name === LOOKUP_BATCH_TOOL
        ? lookupBatchAsync(
            ((input as { items?: unknown } | null)?.items ??
              []) as LookupItem[],
            checked,
            BATCH_CONCURRENCY,
          )
        : guarded(name, input);
}

/** The answer when the registry service does not apply the narrowing parameters it was sent. */
export const NARROWING_UNAVAILABLE =
  "the registry service does not apply same_building_class, same_local_use_code or local_use_codes yet; call without them, or retry after the registry update";

/** Whether a candidates call asks for any narrowing (catalog defaults: false, absent). */
function asksNarrowing(input: unknown): boolean {
  const i = (input ?? {}) as Record<string, unknown>;
  return (
    i.same_building_class === true ||
    i.same_local_use_code === true ||
    Array.isArray(i.local_use_codes)
  );
}

/**
 * The catalog's registry_tx_equity_candidates_batch over single-subject calls. The input is the
 * batch input after the catalog's checks and defaults (1–50 subjects, unique ids, no unknown
 * fields). Each entry of results is the subject's single answer without its notice and selection
 * rule (given once at the top), or the subject's own error. As in the catalog, a subject the
 * registry cannot answer (RegistryUnavailable, or no answer from the service) fails the whole
 * call: no further subjects are sent, and the first such subject in input order decides the
 * outcome (a thrown error becomes the catalog's RegistryUnavailable).
 */
async function txEquityBatch(one: Run, input: unknown): Promise<ToolOutcome> {
  const i = input as Record<string, unknown>;
  const subjects = (Array.isArray(i.subjects) ? i.subjects : []) as Record<
    string,
    unknown
  >[];
  const params: Record<string, unknown> = {};
  for (const k of TX_EQUITY_PARAMS) if (i[k] !== undefined) params[k] = i[k];

  type Settled = { outcome: ToolOutcome } | { thrown: unknown };
  const settled: (Settled | undefined)[] = new Array(subjects.length);
  const unavailable = (s: Settled | undefined) =>
    s !== undefined &&
    ("thrown" in s ||
      (!s.outcome.ok && s.outcome.error.error === "RegistryUnavailable"));
  let next = 0;
  let failed = false;
  const lane = async () => {
    while (!failed && next < subjects.length) {
      const k = next++;
      const { id: _id, ...subject } = subjects[k]!;
      void _id;
      try {
        settled[k] = {
          outcome: await one(TX_EQUITY_TOOL, { ...subject, ...params }),
        };
      } catch (thrown) {
        settled[k] = { thrown };
      }
      if (unavailable(settled[k])) failed = true;
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(BATCH_CONCURRENCY, subjects.length) }, lane),
  );

  const first = settled.find(unavailable);
  if (first) {
    if ("thrown" in first) throw first.thrown;
    return first.outcome;
  }

  const results = subjects.map(({ id }, k) => {
    const { outcome } = settled[k] as { outcome: ToolOutcome };
    if (!outcome.ok) return { id, error: outcome.error };
    const {
      notice: _notice,
      selection,
      ...rest
    } = outcome.result as Record<string, unknown>;
    void _notice;
    if (typeof selection !== "object" || selection === null)
      return { id, ...rest, selection };
    const { rule: _rule, ...perSubject } = selection as Record<string, unknown>;
    void _rule;
    return { id, ...rest, selection: perSubject };
  });
  const errors = results.filter((r) => "error" in r).length;
  return {
    ok: true,
    result: {
      results,
      summary: {
        subjects: results.length,
        answered: results.length - errors,
        errors,
      },
      rule: TX_EQUITY_RULE,
      notice: TX_EQUITY_NOTICE,
    },
  };
}
