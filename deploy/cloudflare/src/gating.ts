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
 */
import { GATING_PRICING_URL } from "./plans.ts";

type Json = Record<string, unknown>;

export const HISTORY_TOOL = "registry_get";
/** The candidates tool: its subject carries value_history, limited the same way. */
export const CANDIDATES_TOOL = "registry_tx_equity_candidates";
const LIMITED_TOOLS = new Set([HISTORY_TOOL, CANDIDATES_TOOL]);

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

/**
 * A registry call a free caller is refused when gating is on: a batch tool, a dated registry_get, or
 * the candidates tool asked for a roll year.
 */
export function isPaidRegistryCall(
  name: unknown,
  args: unknown,
): name is string {
  return (
    isBatchRegistryTool(name) ||
    isDatedGet(name, args) ||
    isYearedCandidates(name, args)
  );
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

/** Apply limitHistory to one MCP tool result (text and structuredContent), when it is not an error. */
function limitMcpResult(result: Json): Json {
  if (result.isError === true) return result;
  const out: Json = { ...result };
  if (result.structuredContent !== undefined)
    out.structuredContent = limitHistory(result.structuredContent);
  const content = result.content;
  if (Array.isArray(content))
    out.content = content.map((c) => {
      const item = c as { type?: unknown; text?: unknown };
      if (item?.type !== "text" || typeof item.text !== "string") return c;
      try {
        const limited = limitHistory(JSON.parse(item.text));
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

/** A REST registry_get answer (200 JSON) for a free caller. */
export async function limitRestResponse(res: Response): Promise<Response> {
  if (
    res.status !== 200 ||
    !(res.headers.get("content-type") ?? "").includes("application/json")
  )
    return res;
  const text = await res.text();
  try {
    return rewrite(res, limitHistory(JSON.parse(text)));
  } catch {
    return new Response(text, res);
  }
}

/** An MCP answer for a free caller: registry_get results, matched to their calls by id. */
export async function limitMcpResponse(
  res: Response,
  body: unknown,
): Promise<Response> {
  const ids = new Set<unknown>();
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
      ids.add(c.id);
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
        ? { ...r, result: limitMcpResult(r.result) }
        : m;
    };
    return rewrite(res, Array.isArray(parsed) ? parsed.map(fix) : fix(parsed));
  } catch {
    return new Response(text, res);
  }
}
