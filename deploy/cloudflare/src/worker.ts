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
import { handle } from "./router.ts";
import type { Env, Fetcher } from "./types.ts";

export { RateLimiterObject } from "./limiter.ts";

const PORT = 8787;
const handler = createHandler({ maxBodyBytes: 1024 * 1024, trustProxy: true });
createServer((req, res) => void handler(req, res)).listen(PORT);
const node = httpServerHandler({ port: PORT }) as {
  fetch(request: Request, env: unknown, ctx: unknown): Promise<Response>;
};

let boundRegistry: Fetcher | undefined;

type RawEnv = Omit<Env, "RL_ANON" | "RL_CLAIM" | "METER"> & {
  LIMITER: DurableObjectNamespaceLike;
};

function withBindings(raw: RawEnv): Env {
  return {
    ...raw,
    RL_ANON: objectLimiter(raw.LIMITER, "anon", ANONYMOUS_REQUESTS_PER_MINUTE),
    RL_CLAIM: objectLimiter(raw.LIMITER, "claim", 1, CLAIM_POLL_MS),
    METER: objectMeter(raw.LIMITER),
  };
}

export default {
  /**
   * The daily sweep of the lifecycle emails (lifecycle.ts). It runs only when a cron trigger is
   * configured for the Worker (none is in wrangler.jsonc yet) and does nothing unless
   * LIFECYCLE_EMAILS_ENABLED is "true".
   */
  async scheduled(
    _event: unknown,
    raw: RawEnv,
    ctx: { waitUntil(p: Promise<unknown>): void },
  ): Promise<void> {
    ctx.waitUntil(
      lifecycleSweep(withBindings(raw)).catch((err) => {
        console.error(
          JSON.stringify({
            msg: "lifecycle sweep failed",
            error: err instanceof Error ? err.name : typeof err,
          }),
        );
      }),
    );
  },
  async fetch(request: Request, raw: RawEnv, ctx: unknown): Promise<Response> {
    const env = withBindings(raw);
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
          headers: { "content-type": "application/json; charset=utf-8" },
        },
      );
    }
  },
};
