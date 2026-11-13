// What a run of the hosted end-to-end suite (scripts/e2e/hosted.ts) spends, which of its calls a caller's plan
// answers with PlanRequired, and the stop when the free registry lookups run out. Pure, so it is tested offline
// (hosted_plan.test.ts); the suite itself runs only against a live deployment.

type Args = Record<string, unknown>;

/** The plans whose keys the paid registry calls answer (the x-factlot-tier response header). */
export const PAID_TIERS: ReadonlySet<string> = new Set(["pro", "team"]);

/**
 * Whether the hosted API answers this call only for a Pro or Team key (deploy/cloudflare/src/gating.ts): the
 * registry batch tools, registry_recorded_facts, registry_get with as_of and the candidates tool with tax_year. A
 * caller without such a key gets 403 PlanRequired, unmetered, whatever the input.
 */
export function isPaidOnlyCall(tool: string, args: unknown): boolean {
  const a = (typeof args === "object" && args !== null ? args : {}) as Args;
  return (
    (tool.startsWith("registry_") && tool.endsWith("_batch")) ||
    tool === "registry_recorded_facts" ||
    (tool === "registry_get" && a.as_of != null) ||
    (tool === "registry_tx_equity_candidates" && a.tax_year != null)
  );
}

/** One registry call the suite plans to make. */
export interface PlannedCall {
  tool: string;
  arguments: Args;
  /** The suite expects a parcel or entity found (not a miss or an error). */
  finds: boolean;
}

export interface Spend {
  /** Registry lookups the run is expected to count: calls that find something. */
  lookups: number;
  /** At most this many: calls whose hosted answer the suite does not know in advance may find something too. */
  lookups_max: number;
  /** Reports built (each counts against the month's reports). */
  reports: number;
  /** Calls to the model-backed tools. */
  model_calls: number;
}

/**
 * What a run spends. A call that finds nothing inside loaded coverage, a miss outside it, an input error and a
 * PlanRequired answer are not counted; a batch counts one lookup per item that finds a parcel.
 */
export function plannedSpend(
  calls: PlannedCall[],
  opts: { paid: boolean; keyed: boolean; reports: boolean; unknown: number },
): Spend {
  let lookups = 0;
  for (const c of calls) {
    if (!c.finds) continue;
    if (isPaidOnlyCall(c.tool, c.arguments) && !opts.paid) continue;
    const items = (c.arguments.subjects ?? c.arguments.items) as unknown;
    lookups += Array.isArray(items) ? items.length : 1;
  }
  return {
    lookups,
    lookups_max: lookups + opts.unknown,
    // One Texas evidence workbook.
    reports: opts.reports ? 1 : 0,
    // Two REST calls and two MCP calls, made only with a key (without one they answer PlanRequired, free).
    model_calls: opts.reports && opts.keyed ? 4 : 0,
  };
}

/**
 * The stop when the registry lookups run out. Once an answer says the allowance is used up (429
 * RegistryQuotaExceeded) or its quota header says none is left, every later registry call is skipped, and the
 * suite reports one failure that says so instead of one per skipped check.
 */
export class RegistryGate {
  /** Lookups left, from the last x-factlot-registry-quota-remaining header seen. */
  remaining: number | null = null;
  /** When the allowance resets, from x-factlot-registry-quota-reset. */
  resets: string | null = null;
  /** Why registry calls stopped, or null while they run. */
  stopped: string | null = null;
  /** Registry calls skipped after the stop. */
  skipped = 0;
  /** Registry calls answered before it. */
  answered = 0;

  /** Read a registry answer's status, error code and headers; true when the answer is usable. */
  observe(
    status: number,
    error: unknown,
    headers: { get(name: string): string | null },
  ): boolean {
    const left = headers.get("x-factlot-registry-quota-remaining");
    if (left !== null && left !== "" && Number.isFinite(Number(left)))
      this.remaining = Number(left);
    this.resets = headers.get("x-factlot-registry-quota-reset") ?? this.resets;
    if (status === 429 && error === "RegistryQuotaExceeded") {
      this.stopped = `the registry lookups ran out after ${this.answered} registry calls (429 RegistryQuotaExceeded)`;
      return false;
    }
    this.answered++;
    if (this.remaining === 0 && this.stopped === null)
      this.stopped = `the registry lookups ran out after ${this.answered} registry calls (none left in the quota header)`;
    return true;
  }

  /** Whether a registry call may be made; counts it as skipped when not. */
  open(): boolean {
    if (this.stopped === null) return true;
    this.skipped++;
    return false;
  }

  /** The one failure line for a stopped run, or null. */
  failure(): string | null {
    if (this.stopped === null) return null;
    return `${this.stopped}; the ${this.skipped} registry calls after it were not made${this.resets ? ` (the allowance resets at ${this.resets})` : ""}. Run again after the reset, or with FACTLOT_API_KEY set to a key with lookups left.`;
  }
}
