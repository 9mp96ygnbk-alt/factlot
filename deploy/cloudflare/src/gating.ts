/**
 * Paid gating (Worker variable GATING_ENABLED = "true"; off by default). Applied in this Worker,
 * on the registry's answer, so the registry Worker is unchanged.
 *
 * - Value history is for Pro and Team. A keyless or free-OAuth caller's registry_get answer keeps
 *   the current roll year's values only: `value_history` (parcels: market and appraised value by
 *   tax year) is cut to the newest tax year, and `history` (include_history: every fact from every
 *   snapshot) to the current facts. Coverage, misses and errors are not touched. The Texas equity
 *   candidates tool is not gated.
 * - Registry batch tools (names ending in _batch) are for Pro and Team: a free caller gets
 *   PlanRequired, and the call is not metered.
 */
import { GATING_PRICING_URL } from "./plans.ts";

type Json = Record<string, unknown>;

export const HISTORY_TOOL = "registry_get";

/** A registry batch tool: refused for free callers when gating is on. */
export function isBatchRegistryTool(name: unknown): name is string {
  return (
    typeof name === "string" &&
    name.startsWith("registry_") &&
    name.endsWith("_batch")
  );
}

const HISTORY_NOTE = `This answer was shortened because the call has no Pro or Team key: value_history (and history, if asked for) keep the current roll year only, and earlier years were left out. A Pro or Team key returns every year: ${GATING_PRICING_URL}`;

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

/**
 * A registry_get answer for a free caller: the current roll year's values only. Returns the
 * answer unchanged when it has neither value_history nor history (entities, buildings, misses).
 */
export function limitHistory(answer: unknown): unknown {
  if (typeof answer !== "object" || answer === null || Array.isArray(answer))
    return answer;
  const a = answer as Json;
  const hasValues = Array.isArray(a.value_history);
  const hasHistory = Array.isArray(a.history);
  if (!hasValues && !hasHistory) return answer;
  const out: Json = { ...a };
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
  }
  if (hasHistory) {
    const keep = new Set(
      (Array.isArray(a.facts) ? (a.facts as Json[]) : []).map((f) => f?.id),
    );
    out.history = (a.history as Json[]).filter((f) => keep.has(f?.id));
  }
  out.history_available = "pro";
  out.history_note = HISTORY_NOTE;
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
      c.params?.name === HISTORY_TOOL &&
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
