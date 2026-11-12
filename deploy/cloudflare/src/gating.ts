/**
 * Paid gating (Worker variable GATING_ENABLED = "true"; off by default). Applied in this Worker,
 * on the registry's answer, so the registry Worker is unchanged.
 *
 * - Value history is for Pro and Team (the candidates tool's `subject.value_history` is cut the same way). A keyless or free-OAuth caller's registry_get answer keeps
 *   the current roll year's values only: `value_history` (parcels: market and appraised value by
 *   tax year) is cut to the newest tax year, and `history` (include_history: every fact from every
 *   snapshot) to the current facts. Coverage, misses and errors are not touched. When something was
 *   actually removed, the answer adds `history_withheld` (the earlier tax years, newest first, and
 *   their count, and a count of earlier facts; never a value, citation, id or date), a one-sentence
 *   `history_note` saying the same in words, and `history_available: "pro"`. When nothing was
 *   removed (a parcel with one roll year) none of the three is added. The Texas equity
 *   candidates themselves are not gated; only the subject's value_history is cut.
 * - Registry batch tools (names ending in _batch) are for Pro and Team: a free caller gets
 *   PlanRequired, and the call is not metered.
 * - registry_tx_equity_candidates with tax_year values a whole pool of parcels on the roll year the
 *   caller names, so it is for Pro and Team as well: a free caller gets PlanRequired, unmetered.
 *   Without tax_year the tool uses the newest roll year with values, which stays free.
 * - registry_get with as_of (the record as it stood on an earlier date) is history too, so it is
 *   for Pro and Team: a free caller gets PlanRequired, and the call is not metered. Without this
 *   a free caller could read the earlier roll years one date at a time.
 * - An owner's portfolio (registry_owned_by) is for Pro and Team beyond its first
 *   FREE_PORTFOLIO_PARCELS parcels. Parcels are counted by distinct URN: the registry can return
 *   several rows for one parcel (one link per roll-year document, or per source), so a free
 *   caller's answer keeps every row of the first three distinct parcels in the registry's order and
 *   drops the rows of the others. `buildings` lists only the buildings of the parcels kept, with
 *   `owned_parcels` the distinct kept parcels in each. When parcels were removed, the answer adds
 *   `portfolio_withheld` ({ count, total }: distinct parcels left out, and distinct parcels the
 *   owner has; never a URN, label or building) and a one-sentence `portfolio_note`. A portfolio
 *   of three distinct parcels or fewer is unchanged, however many rows it has, and gets neither.
 *   The tool takes no paging argument (its input is entity_urn alone, and other arguments are
 *   dropped by its schema), so the cut is applied to every answer and there is nothing to refuse.
 * - The same portfolio is in registry_get on an entity URN: its `relationships` hold the "owns"
 *   rows from the entity to each parcel it owns (current links only, possibly several per parcel;
 *   include_history adds superseded facts, never ended links). A free caller's entity record keeps
 *   the owns rows of the first FREE_PORTFOLIO_PARCELS distinct parcels (by `to_urn`, in the
 *   registry's order) and drops the owns rows of the others; every other relationship (other
 *   types, rows to the entity, rows to anything but a parcel) stays, and a parcel or building
 *   record is not touched. When rows were dropped the record gets the same `portfolio_withheld`
 *   and `portfolio_note`, counted in distinct parcels, beside any history cut. The three parcels
 *   kept here need not be the three registry_owned_by keeps: registry_get orders the rows by link
 *   date and registry_owned_by by parcel label, and this Worker does not see the labels, so it
 *   does not try to match them.
 * - registry_recorded_facts (every recorded sale and document of a parcel, paged) is for Pro and
 *   Team: a free caller gets PlanRequired, and the call is not metered.
 * - Recorded sales and documents are for Pro and Team beyond the newest sale. A parcel's registry_get
 *   facts hold one fact per recorded sale (transaction.sale), deed (transaction.deed), mortgage
 *   (debt.mortgage_recorded) and mortgage satisfaction (debt.mortgage_satisfaction_recorded). A free
 *   caller's record keeps, of these, only the newest sale or deed (by recorded date, then amount,
 *   then fact id), whole and in its place, and drops the others from `facts` and from
 *   include_history's `history`; every other fact is unchanged. When something was dropped the
 *   record adds `sales_withheld` (transaction.sale) and `documents_withheld` (the three document
 *   predicates, with a count per predicate), each a count and the first and last year of the
 *   dropped facts' dates (never a price, party, document number, citation or full date), a
 *   one-sentence `sales_note`, and `history_available: "pro"`. A parcel with no recorded fact, or
 *   one sale or deed only (a roll's latest sale), is unchanged and gets none of them. The
 *   registry does not say whether a sale was at arm's length, and neither does this cut: the fact
 *   kept is the newest as recorded, at the price as recorded, zero or nominal included.
 */
import { GATING_PRICING_URL } from "./plans.ts";

type Json = Record<string, unknown>;

export const HISTORY_TOOL = "registry_get";
/** The candidates tool: its subject carries value_history, limited the same way. */
export const CANDIDATES_TOOL = "registry_tx_equity_candidates";
/** The portfolio tool: its results are cut to the first FREE_PORTFOLIO_PARCELS. */
export const PORTFOLIO_TOOL = "registry_owned_by";
/** Parcels of an owner's portfolio a free caller sees. */
export const FREE_PORTFOLIO_PARCELS = 3;
const LIMITED_TOOLS = new Set([HISTORY_TOOL, CANDIDATES_TOOL, PORTFOLIO_TOOL]);

/** A registry batch tool: refused for free callers when gating is on. */
export function isBatchRegistryTool(name: unknown): name is string {
  return (
    typeof name === "string" &&
    name.startsWith("registry_") &&
    name.endsWith("_batch")
  );
}

/** registry_get with as_of: the record on an earlier date. Refused for free callers when gating is on. */
export function isDatedGet(name: unknown, args: unknown): boolean {
  return (
    name === HISTORY_TOOL &&
    typeof args === "object" &&
    args !== null &&
    !Array.isArray(args) &&
    (args as Json).as_of != null
  );
}

/**
 * registry_tx_equity_candidates with tax_year: the subject and every candidate valued on the roll of
 * the year the caller names, which is value history for a whole pool of parcels. Refused for free
 * callers when gating is on; without tax_year the tool uses the newest roll year that has values.
 */
export function isYearedCandidates(name: unknown, args: unknown): boolean {
  return (
    name === CANDIDATES_TOOL &&
    typeof args === "object" &&
    args !== null &&
    !Array.isArray(args) &&
    (args as Json).tax_year != null
  );
}

/** The paged reader of a parcel's recorded sales and documents: for Pro and Team. */
export const RECORDED_TOOL = "registry_recorded_facts";

/**
 * A registry call a free caller is refused when gating is on: a batch tool, a dated registry_get, the
 * candidates tool asked for a roll year, or registry_recorded_facts.
 */
export function isPaidRegistryCall(
  name: unknown,
  args: unknown,
): name is string {
  return (
    isBatchRegistryTool(name) ||
    isDatedGet(name, args) ||
    isYearedCandidates(name, args) ||
    name === RECORDED_TOOL
  );
}

/** PlanRequired for registry_recorded_facts, in the same shape. */
export function recordedPlanRequired(): { status: 403; body: Json } {
  return {
    status: 403,
    body: {
      error: "PlanRequired",
      code: "PlanRequired",
      message: `${RECORDED_TOOL} returns every recorded sale and document of a parcel, which is part of the paid plans: Pro and Team. Nothing was counted. Without a key, ${HISTORY_TOOL} returns the newest recorded sale or deed and counts the rest within the free daily lookups.`,
      next: `send a Pro or Team key as Authorization: Bearer <key> (${GATING_PRICING_URL}), or call ${HISTORY_TOOL}`,
      upgrade: GATING_PRICING_URL,
    },
  };
}

/** What a free caller's answer had cut: distinct earlier tax years (newest first) and earlier facts. Never values. */
export interface HistoryWithheld {
  tax_years?: number[];
  count?: number;
  facts?: number;
}

function yearsInWords(years: number[]): string {
  const n = years.length;
  const asc = [...years].sort((x, y) => x - y);
  const contiguous = asc.every(
    (y, i) => i === 0 || y === (asc[i - 1] ?? Number.NaN) + 1,
  );
  const label = `${n} earlier roll ${n === 1 ? "year" : "years"}`;
  if (n === 1) return `${label}, ${asc[0]}`;
  if (contiguous && n > 2) return `${label}, ${asc[0]} to ${asc[n - 1]}`;
  if (n === 2) return `${label}, ${asc[0]} and ${asc[1]}`;
  return `${label}, ${asc.slice(0, -1).join(", ")} and ${asc[n - 1]}`;
}

/** The one-line note for what was withheld, saying only what was actually removed. */
export function historyNote(w: HistoryWithheld): string {
  const years = w.tax_years?.length ?? 0;
  const facts = w.facts ?? 0;
  const factsPhrase = `${facts} earlier ${facts === 1 ? "fact" : "facts"} in history`;
  const subject =
    years > 0
      ? `${yearsInWords(w.tax_years as number[])}${facts > 0 ? `, and ${factsPhrase}` : ""},`
      : factsPhrase;
  const single = facts > 0 ? years === 0 && facts === 1 : years === 1;
  return `${subject} ${single ? "is" : "are"} available with a Pro or Team key: ${GATING_PRICING_URL}`;
}

/** PlanRequired for a batch tool, in the shape the model-backed tools use. */
export function batchPlanRequired(tool: string): { status: 403; body: Json } {
  return {
    status: 403,
    body: {
      error: "PlanRequired",
      code: "PlanRequired",
      message: `${tool} answers many subjects in one call, so it is part of the paid plans: Pro and Team. Nothing was counted. The single-subject registry tools stay available within the free daily lookups.`,
      next: `send a Pro or Team key as Authorization: Bearer <key> (${GATING_PRICING_URL}), or call the single-subject tool once per subject`,
      upgrade: GATING_PRICING_URL,
    },
  };
}

/** PlanRequired for a dated registry_get (as_of), in the same shape. */
export function datedPlanRequired(): { status: 403; body: Json } {
  return {
    status: 403,
    body: {
      error: "PlanRequired",
      message: `${HISTORY_TOOL} with as_of returns the record as it stood on an earlier date, which is value history, so it is part of the paid plans: Pro and Team. Nothing was counted. Without as_of the same call returns the current record within the free daily lookups.`,
      next: `send a Pro or Team key as Authorization: Bearer <key> (${GATING_PRICING_URL}), or call ${HISTORY_TOOL} again without as_of`,
      upgrade: GATING_PRICING_URL,
    },
  };
}

/** PlanRequired for the candidates tool asked for a roll year (tax_year), in the same shape. */
export function yearedPlanRequired(): { status: 403; body: Json } {
  return {
    status: 403,
    body: {
      error: "PlanRequired",
      message: `${CANDIDATES_TOOL} with tax_year values the subject and every candidate on the roll of the year you name, which is value history, so it is part of the paid plans: Pro and Team. Nothing was counted. Without tax_year the same call uses the newest roll year that has values, within the free daily lookups.`,
      next: `send a Pro or Team key as Authorization: Bearer <key> (${GATING_PRICING_URL}), or call ${CANDIDATES_TOOL} again without tax_year`,
      upgrade: GATING_PRICING_URL,
    },
  };
}

/** PlanRequired for a call isPaidRegistryCall matched. */
export function planRequired(
  tool: string,
  args: unknown,
): { status: 403; body: Json } {
  if (tool === RECORDED_TOOL) return recordedPlanRequired();
  if (isDatedGet(tool, args)) return datedPlanRequired();
  if (isYearedCandidates(tool, args)) return yearedPlanRequired();
  return batchPlanRequired(tool);
}

/**
 * A registry_get answer for a free caller: the current roll year's values only. Returns the
 * answer unchanged when it has neither value_history nor history (entities, buildings, misses).
 */
export function limitHistory(answer: unknown): unknown {
  if (typeof answer !== "object" || answer === null || Array.isArray(answer))
    return answer;
  const a = answer as Json;
  const subject = a.subject;
  if (
    typeof subject === "object" &&
    subject !== null &&
    !Array.isArray(subject) &&
    Array.isArray((subject as Json).value_history)
  ) {
    // registry_tx_equity_candidates: the subject's series is cut; the candidates are untouched.
    const limited = limitHistory(subject) as Json;
    const { history_available, history_withheld, history_note, ...rest } =
      limited;
    if (history_withheld === undefined) return { ...a, subject: rest };
    return {
      ...a,
      subject: rest,
      history_available,
      history_withheld,
      history_note,
    };
  }
  const hasValues = Array.isArray(a.value_history);
  const hasHistory = Array.isArray(a.history);
  if (!hasValues && !hasHistory) return answer;
  const out: Json = { ...a };
  const withheld: HistoryWithheld = {};
  if (hasValues) {
    const entries = a.value_history as Json[];
    const years = entries
      .map((e) => e?.tax_year)
      .filter((y): y is number => typeof y === "number");
    const current = years.length > 0 ? Math.max(...years) : undefined;
    out.value_history =
      current === undefined
        ? entries.slice(0, 1)
        : entries.filter((e) => e?.tax_year === current);
    const removed = [...new Set(years)]
      .filter((y) => y !== current)
      .sort((x, y) => y - x);
    if (removed.length > 0) {
      withheld.tax_years = removed;
      withheld.count = removed.length;
    }
  }
  if (hasHistory) {
    const keep = new Set(
      (Array.isArray(a.facts) ? (a.facts as Json[]) : []).map((f) => f?.id),
    );
    const all = a.history as Json[];
    const kept = all.filter((f) => keep.has(f?.id));
    out.history = kept;
    if (all.length > kept.length) withheld.facts = all.length - kept.length;
  }
  if (withheld.tax_years === undefined && withheld.facts === undefined)
    return out;
  out.history_available = "pro";
  out.history_withheld = withheld;
  out.history_note = historyNote(withheld);
  return out;
}

/** A recorded sale (a publisher's sales file, or the latest sale on a roll). */
export const SALE_PREDICATE = "transaction.sale";
/** Recorded documents from a land-records index: deeds, mortgages and mortgage satisfactions. */
export const DOCUMENT_PREDICATES = [
  "transaction.deed",
  "debt.mortgage_recorded",
  "debt.mortgage_satisfaction_recorded",
] as const;
const RECORDED_PREDICATES: ReadonlySet<unknown> = new Set([
  SALE_PREDICATE,
  ...DOCUMENT_PREDICATES,
]);
/** The transfers a free caller keeps the newest of: a sale or a deed. */
const TRANSFER_PREDICATES: ReadonlySet<unknown> = new Set([
  SALE_PREDICATE,
  "transaction.deed",
]);

/** What a free caller's answer had cut of the recorded sales or documents: a count and the years they span. Never a value. */
export interface RecordsWithheld {
  count: number;
  from_year?: number;
  to_year?: number;
  /** documents_withheld only: the count per predicate. */
  by_predicate?: Record<string, number>;
}

const DOCUMENT_NOUNS: Record<string, [string, string]> = {
  "transaction.deed": ["deed", "deeds"],
  "debt.mortgage_recorded": ["mortgage", "mortgages"],
  "debt.mortgage_satisfaction_recorded": [
    "mortgage satisfaction",
    "mortgage satisfactions",
  ],
};

function yearSpan(w: RecordsWithheld): string {
  if (w.from_year === undefined || w.to_year === undefined) return "";
  return w.from_year === w.to_year
    ? `, ${w.from_year}`
    : `, ${w.from_year} to ${w.to_year}`;
}

/** "3 more recorded sales, 2018 to 2024, and 7 recorded documents (deeds and mortgages), 2013 to 2026": counts and years only. */
export function recordsInWords(
  sales: RecordsWithheld | undefined,
  documents: RecordsWithheld | undefined,
): string {
  const parts: string[] = [];
  if (sales && sales.count > 0)
    parts.push(
      `${sales.count} more recorded ${sales.count === 1 ? "sale" : "sales"}${yearSpan(sales)}`,
    );
  if (documents && documents.count > 0) {
    const kinds = DOCUMENT_PREDICATES.filter(
      (p) => (documents.by_predicate?.[p] ?? 0) > 0,
    );
    const n = documents.count;
    const what =
      kinds.length === 1
        ? DOCUMENT_NOUNS[kinds[0]!]![n === 1 ? 0 : 1]
        : `documents (${kinds
            .map((p) => DOCUMENT_NOUNS[p]![1])
            .join(", ")
            .replace(/, ([^,]*)$/, " and $1")})`;
    parts.push(`${n} recorded ${what}${yearSpan(documents)}`);
  }
  return parts.join(", and ");
}

/** The one-sentence note for withheld sales and documents, saying only what was removed. */
export function salesNote(
  sales: RecordsWithheld | undefined,
  documents: RecordsWithheld | undefined,
  keptLatest: boolean,
): string {
  const single = (sales?.count ?? 0) + (documents?.count ?? 0) === 1;
  const lead = keptLatest
    ? "This answer keeps the newest recorded sale or deed only; "
    : "";
  // As history_note: a closing year span takes a comma before the verb.
  const last = documents && documents.count > 0 ? documents : sales;
  const comma = last && yearSpan(last) ? "," : "";
  return `${lead}${recordsInWords(sales, documents)}${comma} ${single ? "is" : "are"} available with a Pro or Team key: ${GATING_PRICING_URL}`;
}

const dateOf = (f: Json): string => {
  const d = (f.value as Json | null)?.date;
  return typeof d === "string" ? d : "";
};
const amountOf = (f: Json): number => {
  const v = (f.value ?? {}) as Json;
  const a = v.price_usd ?? v.amount_usd;
  return typeof a === "number" ? a : -1;
};

/** The newest of `facts` by recorded date, then amount, then fact id (the order registry_get lists them in). */
function newestTransfer(facts: Json[]): Json | undefined {
  let best: Json | undefined;
  for (const f of facts) {
    if (!TRANSFER_PREDICATES.has(f.predicate)) continue;
    if (best === undefined) {
      best = f;
      continue;
    }
    const [da, db] = [dateOf(f), dateOf(best)];
    if (da !== db) {
      if (da > db) best = f;
      continue;
    }
    const [pa, pb] = [amountOf(f), amountOf(best)];
    if (pa !== pb) {
      if (pa > pb) best = f;
      continue;
    }
    if (String(f.id) > String(best.id)) best = f;
  }
  return best;
}

/** The registry's summary of the recorded facts a capped record left out (recorded_facts_truncated.by_predicate). */
type Omitted = Record<
  string,
  { kept?: unknown; total?: unknown; from_year?: unknown; to_year?: unknown }
>;

/**
 * What was withheld of `predicates`: the facts the answer had and the cut removed, plus the ones the registry had
 * already left out of a capped record (counted from its summary, so the totals are the parcel's true totals).
 */
function withheldOf(
  facts: Json[],
  predicates: readonly string[],
  omitted: Omitted,
  byPredicate: boolean,
): RecordsWithheld | undefined {
  const years = facts
    .filter((f) => predicates.includes(String(f.predicate)))
    .map((f) => /^(\d{4})/.exec(dateOf(f))?.[1])
    .filter((y): y is string => y !== undefined)
    .map(Number);
  const counts: Record<string, number> = {};
  let count = 0;
  for (const p of predicates) {
    const o = Object.hasOwn(omitted, p) ? omitted[p]! : {};
    const left =
      typeof o.total === "number" && typeof o.kept === "number"
        ? Math.max(0, o.total - o.kept)
        : 0;
    if (left > 0) {
      for (const y of [o.from_year, o.to_year])
        if (typeof y === "number") years.push(y);
    }
    const n = facts.filter((f) => f.predicate === p).length + left;
    if (n > 0) counts[p] = n;
    count += n;
  }
  if (count === 0) return undefined;
  const out: RecordsWithheld = { count };
  if (years.length > 0) {
    out.from_year = Math.min(...years);
    out.to_year = Math.max(...years);
  }
  if (byPredicate) out.by_predicate = counts;
  return out;
}

/**
 * A registry_get answer for a free caller: of its recorded sales and documents (SALE_PREDICATE and
 * DOCUMENT_PREDICATES, one fact per event) the newest sale or deed only. Every other fact is kept, in
 * place. `history` loses the same facts (run limitHistory first: it cuts history to the current
 * facts). A record the registry capped (`recorded_facts_truncated`) is counted from that summary, so
 * the withheld counts and years are the parcel's true totals, and the summary itself is dropped
 * (the withheld blocks say the same for a free caller); a Pro caller keeps it. Returns the answer unchanged when it has no facts array, or at most one recorded fact and
 * that one a sale or deed.
 */
export function limitSales(answer: unknown): unknown {
  if (typeof answer !== "object" || answer === null || Array.isArray(answer))
    return answer;
  const a = answer as Json;
  if (!Array.isArray(a.facts)) return answer;
  const facts = a.facts as Json[];
  const recorded = facts.filter((f) => RECORDED_PREDICATES.has(f?.predicate));
  const kept = newestTransfer(recorded);
  const removed = recorded.filter((f) => f !== kept);
  // A record the registry capped (more recorded facts than it keeps) says what it left out.
  const truncated = a.recorded_facts_truncated as Json | undefined;
  const omitted = (truncated?.by_predicate ?? {}) as Omitted;
  if (removed.length === 0 && truncated === undefined) return answer;
  const { recorded_facts_truncated: _summary, ...rest } = a;
  void _summary;
  const out: Json = {
    ...rest,
    facts: facts.filter(
      (f) => !RECORDED_PREDICATES.has(f?.predicate) || f === kept,
    ),
  };
  if (Array.isArray(a.history))
    out.history = (a.history as Json[]).filter(
      (f) =>
        !RECORDED_PREDICATES.has(f?.predicate) ||
        (kept?.id !== undefined && f?.id === kept.id),
    );
  const salesWithheld = withheldOf(removed, [SALE_PREDICATE], omitted, false);
  const documentsWithheld = withheldOf(
    removed,
    DOCUMENT_PREDICATES,
    omitted,
    true,
  );
  out.history_available = "pro";
  if (salesWithheld) out.sales_withheld = salesWithheld;
  if (documentsWithheld) out.documents_withheld = documentsWithheld;
  out.sales_note = salesNote(
    salesWithheld,
    documentsWithheld,
    kept !== undefined,
  );
  return out;
}

/** What a free caller's registry_owned_by answer had cut: parcels left out, and the portfolio's size. */
export interface PortfolioWithheld {
  count: number;
  total: number;
}

/** The one-line note for the parcels withheld from a portfolio. */
export function portfolioNote(w: PortfolioWithheld): string {
  const one = w.count === 1;
  return `${w.count} more ${one ? "parcel" : "parcels"} of this owner ${one ? "is" : "are"} available with a Pro or Team key: ${GATING_PRICING_URL}`;
}

/**
 * The first FREE_PORTFOLIO_PARCELS distinct parcels of `parcels` (one entry per row, in the
 * registry's order; a parcel can have several rows) and how many distinct parcels there are, or
 * undefined when there are that many or fewer and nothing is cut.
 */
function firstParcels(
  parcels: unknown[],
): { kept: Set<unknown>; total: number } | undefined {
  const distinct = [...new Set(parcels)];
  if (distinct.length <= FREE_PORTFOLIO_PARCELS) return undefined;
  return {
    kept: new Set(distinct.slice(0, FREE_PORTFOLIO_PARCELS)),
    total: distinct.length,
  };
}

/**
 * A registry_owned_by answer for a free caller: every row of the first FREE_PORTFOLIO_PARCELS
 * distinct parcels, and the buildings of those parcels only. Returns the answer unchanged when it
 * holds that many distinct parcels or fewer.
 */
export function limitPortfolio(answer: unknown): unknown {
  if (typeof answer !== "object" || answer === null || Array.isArray(answer))
    return answer;
  const a = answer as Json;
  if (!Array.isArray(a.results)) return answer;
  const all = a.results as unknown[];
  const parcelOf = (r: unknown) => (r as Json | null)?.urn ?? r;
  const cut = firstParcels(all.map(parcelOf));
  if (cut === undefined) return answer;
  const kept = all.filter((r) => cut.kept.has(parcelOf(r)));
  const out: Json = { ...a, results: kept };
  if (Array.isArray(a.buildings)) {
    // Distinct kept parcels per building: a parcel with several link rows counts once.
    const parcels = new Map<unknown, Set<unknown>>();
    for (const p of kept) {
      const b = (p as Json | null)?.building;
      if (b != null)
        parcels.set(b, (parcels.get(b) ?? new Set()).add(parcelOf(p)));
    }
    const owned = new Map([...parcels].map(([b, ps]) => [b, ps.size]));
    out.buildings = (a.buildings as unknown[])
      .filter((b) => owned.has((b as Json | null)?.urn))
      .map((b): Json => ({
        ...(b as Json),
        owned_parcels: owned.get((b as Json).urn) ?? 0,
      }))
      .sort(
        (x, y) =>
          (y.owned_parcels as number) - (x.owned_parcels as number) ||
          (String(x.urn) < String(y.urn)
            ? -1
            : String(x.urn) > String(y.urn)
              ? 1
              : 0),
      );
  }
  const withheld: PortfolioWithheld = {
    count: cut.total - cut.kept.size,
    total: cut.total,
  };
  out.portfolio_withheld = withheld;
  out.portfolio_note = portfolioNote(withheld);
  return out;
}

/**
 * A registry_get answer on an entity for a free caller: every "owns" relationship from the entity
 * to the first FREE_PORTFOLIO_PARCELS distinct parcels, in the registry's order; the owns rows to
 * other parcels are dropped and every other row is unchanged. Returns the answer unchanged for any
 * other record, or when the entity owns that many distinct parcels or fewer.
 */
export function limitEntityPortfolio(answer: unknown): unknown {
  if (typeof answer !== "object" || answer === null || Array.isArray(answer))
    return answer;
  const a = answer as Json;
  if (a.kind !== "entity" || !Array.isArray(a.relationships)) return answer;
  const owns = (r: unknown) => {
    const row = r as Json | null;
    return (
      row?.type === "owns" &&
      row.from_urn === a.urn &&
      typeof row.to_urn === "string" &&
      row.to_urn.startsWith("fl:parcel:")
    );
  };
  const rows = a.relationships as unknown[];
  const parcelOf = (r: unknown) => (r as Json).to_urn;
  const cut = firstParcels(rows.filter(owns).map(parcelOf));
  if (cut === undefined) return answer;
  const kept = rows.filter((r) => !owns(r) || cut.kept.has(parcelOf(r)));
  const withheld: PortfolioWithheld = {
    count: cut.total - cut.kept.size,
    total: cut.total,
  };
  return {
    ...a,
    relationships: kept,
    portfolio_withheld: withheld,
    portfolio_note: portfolioNote(withheld),
  };
}

/**
 * A free caller's answer from `tool`: the portfolio cut for registry_owned_by; for registry_get the
 * history cut, the sales cut and, on an entity, the portfolio cut; else the history cut.
 */
export function limitFreeAnswer(tool: unknown, answer: unknown): unknown {
  if (tool === PORTFOLIO_TOOL) return limitPortfolio(answer);
  if (tool === HISTORY_TOOL)
    return limitEntityPortfolio(limitSales(limitHistory(answer)));
  return limitHistory(answer);
}

/** Apply the free cut for `tool` to one MCP tool result (text and structuredContent), when it is not an error. */
function limitMcpResult(tool: unknown, result: Json): Json {
  if (result.isError === true) return result;
  const out: Json = { ...result };
  if (result.structuredContent !== undefined)
    out.structuredContent = limitFreeAnswer(tool, result.structuredContent);
  const content = result.content;
  if (Array.isArray(content))
    out.content = content.map((c) => {
      const item = c as { type?: unknown; text?: unknown };
      if (item?.type !== "text" || typeof item.text !== "string") return c;
      try {
        const limited = limitFreeAnswer(tool, JSON.parse(item.text));
        return { ...item, text: JSON.stringify(limited, null, 2) };
      } catch {
        return c;
      }
    });
  return out;
}

function rewrite(res: Response, body: unknown): Response {
  const headers = new Headers(res.headers);
  headers.delete("content-length");
  return new Response(JSON.stringify(body), {
    status: res.status,
    statusText: res.statusText,
    headers,
  });
}

/** A REST answer (200 JSON) from `tool` for a free caller (registry_get, the candidates tool or registry_owned_by). */
export async function limitRestResponse(
  res: Response,
  tool: string = HISTORY_TOOL,
): Promise<Response> {
  if (
    res.status !== 200 ||
    !(res.headers.get("content-type") ?? "").includes("application/json")
  )
    return res;
  const text = await res.text();
  try {
    return rewrite(res, limitFreeAnswer(tool, JSON.parse(text)));
  } catch {
    return new Response(text, res);
  }
}

/** An MCP answer for a free caller: the limited tools' results, matched to their calls by id. */
export async function limitMcpResponse(
  res: Response,
  body: unknown,
): Promise<Response> {
  const ids = new Map<unknown, string>();
  for (const m of Array.isArray(body) ? body : [body]) {
    const c = m as {
      id?: unknown;
      method?: unknown;
      params?: { name?: unknown };
    };
    if (
      c?.method === "tools/call" &&
      typeof c.params?.name === "string" &&
      LIMITED_TOOLS.has(c.params.name) &&
      c.id !== undefined &&
      c.id !== null
    )
      ids.set(c.id, c.params.name);
  }
  if (
    ids.size === 0 ||
    res.status !== 200 ||
    !(res.headers.get("content-type") ?? "").includes("application/json")
  )
    return res;
  const text = await res.text();
  try {
    const parsed: unknown = JSON.parse(text);
    const fix = (m: unknown) => {
      const r = m as { id?: unknown; result?: Json } | null;
      return r && ids.has(r.id) && r.result && typeof r.result === "object"
        ? { ...r, result: limitMcpResult(ids.get(r.id), r.result) }
        : m;
    };
    return rewrite(res, Array.isArray(parsed) ? parsed.map(fix) : fix(parsed));
  } catch {
    return new Response(text, res);
  }
}
