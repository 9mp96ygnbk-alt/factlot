/**
 * Cloudflare Worker entry. The unchanged @factlot/server Node handler runs behind
 * `httpServerHandler` (Workers' node:http compatibility); router.ts decides access first.
 */
import { createServer } from "node:http";
import { httpServerHandler } from "cloudflare:node";
import { createHandler } from "@factlot/server";
import { configureRegistryRunner } from "@factlot/tools";

import {
  objectLimiter,
  objectMeter,
  type DurableObjectNamespaceLike,
} from "./limiter.ts";
import { CLAIM_POLL_MS } from "./claim.ts";
import { ANONYMOUS_REQUESTS_PER_MINUTE } from "./plans.ts";
import { registryRunner } from "./registry.ts";
import { lifecycleSweep } from "./lifecycle.ts";
import { CONTENT_SIGNAL, handle } from "./router.ts";
import { scheduledJobs } from "./scheduled.ts";
import type { Env, Fetcher } from "./types.ts";
import { objectWatch, runWatchCheck } from "./watch-check.ts";

export { RateLimiterObject } from "./limiter.ts";

const PORT = 8787;
const handler = createHandler({
  maxBodyBytes: 1024 * 1024,
  trustProxy: true,
  hosted: true,
});
createServer((req, res) => void handler(req, res)).listen(PORT);
const node = httpServerHandler({ port: PORT }) as {
  fetch(request: Request, env: unknown, ctx: unknown): Promise<Response>;
};

let boundRegistry: Fetcher | undefined;

type RawEnv = Omit<Env, "RL_ANON" | "RL_CLAIM" | "METER" | "WATCH"> & {
  LIMITER: DurableObjectNamespaceLike;
};

function workerEnv(raw: RawEnv): Env {
  return {
    ...raw,
    RL_ANON: objectLimiter(raw.LIMITER, "anon", ANONYMOUS_REQUESTS_PER_MINUTE),
    RL_CLAIM: objectLimiter(raw.LIMITER, "claim", 1, CLAIM_POLL_MS),
    METER: objectMeter(raw.LIMITER),
    WATCH: objectWatch(raw.LIMITER),
  };
}

export default {
  /** Cron triggers (none is configured): scheduled.ts dispatches on the cron string. */
  async scheduled(
    controller: { cron?: string } | undefined,
    raw: RawEnv,
    ctx: { waitUntil(p: Promise<unknown>): void },
  ): Promise<void> {
    const env = workerEnv(raw);
    for (const job of scheduledJobs(controller?.cron, {
      watch: () =>
        runWatchCheck(env).then((r) => {
          if (r.state === "run")
            console.log(JSON.stringify({ msg: "watch check", ...r }));
        }),
      lifecycle: () => lifecycleSweep(env),
    }))
      ctx.waitUntil(job);
  },

  async fetch(request: Request, raw: RawEnv, ctx: unknown): Promise<Response> {
    const env = workerEnv(raw);
    // The binding is the same object on every request; the runner closes over it.
    if (raw.REGISTRY && raw.REGISTRY !== boundRegistry) {
      boundRegistry = raw.REGISTRY;
      configureRegistryRunner(registryRunner(raw.REGISTRY));
    }
    const api: Fetcher = { fetch: (r) => node.fetch(r, raw, ctx) };
    try {
      const waitUntil = (ctx as { waitUntil?: (p: Promise<unknown>) => void })
        ?.waitUntil;
      return await handle(request, env, api, {
        waitUntil: waitUntil ? (p) => waitUntil.call(ctx, p) : undefined,
      });
    } catch (err) {
      // The error name only: messages can carry request content.
      console.error(
        JSON.stringify({
          msg: "error",
          error: err instanceof Error ? err.name : typeof err,
        }),
      );
      return new Response(
        JSON.stringify({ error: "InternalError", message: "unexpected error" }),
        {
          status: 500,
          headers: {
            "content-type": "application/json; charset=utf-8",
            "content-signal": CONTENT_SIGNAL,
          },
        },
      );
    }
  },
};
