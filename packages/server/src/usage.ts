/**
 * Usage metering: calls per key per tool, bucketed by hour in memory, and optionally
 * appended one JSON line per call to a file (`FACTLOT_USAGE_LOG`) for a billing job.
 *
 * File line format (one object per line, UTF-8, `\n` terminated):
 *   {"time":"2026-11-02T14:03:07.412Z","key":"tenant-a","tool":"calc_debt_sizing",
 *    "surface":"rest","status":200,"duration_ms":3}
 *   time        ISO 8601 UTC, when the request started
 *   key         key name (tenant), or "anonymous" when no API keys are configured
 *   tool        catalog tool name; MCP non-tool methods appear as "mcp:<method>"
 *   surface     "rest" (POST /v1/...) or "mcp" (POST /mcp)
 *   status      HTTP status of the response (MCP tool errors are reported inside a 200)
 *   duration_ms whole milliseconds from request start to response close
 */
import { appendFile } from "node:fs/promises";

export type UsageSurface = "rest" | "mcp";

export interface UsageEvent {
  /** Request start, ms since epoch. */
  time: number;
  key: string;
  tool: string;
  surface: UsageSurface;
  status: number;
  durationMs: number;
}

export interface ToolUsage {
  calls: number;
  /** Calls that returned an HTTP status of 400 or above. */
  errors: number;
  duration_ms: number;
}

export interface KeyUsage extends ToolUsage {
  tools: Record<string, ToolUsage>;
}

export interface UsageWindow {
  start: string;
  end: string;
  keys: Record<string, KeyUsage>;
}

export interface UsageReport {
  /** The key name the report was filtered to, or null for all keys. */
  key: string | null;
  generated_at: string;
  /** The current UTC clock hour. */
  hour: UsageWindow;
  /** The current UTC day. */
  day: UsageWindow;
}

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

export interface UsageMeterOptions {
  /** Append one JSON line per call to this file. */
  file?: string;
  /** Hour buckets to keep in memory (default 48; the day report needs at most 24). */
  retainHours?: number;
}

type Bucket = Map<string, Map<string, ToolUsage>>;

export class UsageMeter {
  readonly #file: string | undefined;
  readonly #retainHours: number;
  /** hour index (ms / 3_600_000) -> key name -> tool -> counts */
  readonly #buckets = new Map<number, Bucket>();
  #queue: Promise<void> = Promise.resolve();

  constructor(opts: UsageMeterOptions = {}) {
    this.#file = opts.file;
    this.#retainHours = opts.retainHours ?? 48;
  }

  get file(): string | undefined {
    return this.#file;
  }

  record(event: UsageEvent): void {
    const hour = Math.floor(event.time / HOUR_MS);
    let bucket = this.#buckets.get(hour);
    if (!bucket) {
      bucket = new Map();
      this.#buckets.set(hour, bucket);
      for (const h of this.#buckets.keys())
        if (h < hour - this.#retainHours) this.#buckets.delete(h);
    }
    let byTool = bucket.get(event.key);
    if (!byTool) {
      byTool = new Map();
      bucket.set(event.key, byTool);
    }
    const counts = byTool.get(event.tool) ?? {
      calls: 0,
      errors: 0,
      duration_ms: 0,
    };
    counts.calls += 1;
    if (event.status >= 400) counts.errors += 1;
    counts.duration_ms += event.durationMs;
    byTool.set(event.tool, counts);

    const file = this.#file;
    if (file) {
      const line = `${JSON.stringify({
        time: new Date(event.time).toISOString(),
        key: event.key,
        tool: event.tool,
        surface: event.surface,
        status: event.status,
        duration_ms: event.durationMs,
      })}\n`;
      this.#queue = this.#queue
        .then(() => appendFile(file, line, "utf8"))
        .catch((err: unknown) => {
          process.stderr.write(
            `factlot-server: cannot append to usage log ${file}: ${String(err)}\n`,
          );
        });
    }
  }

  /** Resolves once every line recorded so far has been written to the file. */
  flush(): Promise<void> {
    return this.#queue;
  }

  /** Counts for the current hour and day at `now`, optionally for one key name. */
  report(now: number, key?: string): UsageReport {
    const hour = Math.floor(now / HOUR_MS);
    const day = Math.floor(now / DAY_MS);
    const hourStart = hour * HOUR_MS;
    const dayStart = day * DAY_MS;
    return {
      key: key ?? null,
      generated_at: new Date(now).toISOString(),
      hour: this.#window(hourStart, hourStart + HOUR_MS, key),
      day: this.#window(dayStart, dayStart + DAY_MS, key),
    };
  }

  #window(startMs: number, endMs: number, key?: string): UsageWindow {
    const keys: Record<string, KeyUsage> = {};
    for (const [hour, bucket] of this.#buckets) {
      const hourStart = hour * HOUR_MS;
      if (hourStart < startMs || hourStart >= endMs) continue;
      for (const [name, byTool] of bucket) {
        if (key !== undefined && name !== key) continue;
        const total = (keys[name] ??= {
          calls: 0,
          errors: 0,
          duration_ms: 0,
          tools: {},
        });
        for (const [tool, counts] of byTool) {
          const t = (total.tools[tool] ??= {
            calls: 0,
            errors: 0,
            duration_ms: 0,
          });
          t.calls += counts.calls;
          t.errors += counts.errors;
          t.duration_ms += counts.duration_ms;
          total.calls += counts.calls;
          total.errors += counts.errors;
          total.duration_ms += counts.duration_ms;
        }
      }
    }
    return {
      start: new Date(startMs).toISOString(),
      end: new Date(endMs).toISOString(),
      keys,
    };
  }
}
