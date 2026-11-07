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
import { ANONYMOUS_REQUESTS_PER_MINUTE } from "./plans.ts";
import { registryRunner } from "./registry.ts";
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

export default {
  async fetch(
    request: Request,
    raw: Omit<Env, "RL_ANON" | "METER"> & {
      LIMITER: DurableObjectNamespaceLike;
    },
    ctx: unknown,
  ): Promise<Response> {
    const env: Env = {
      ...raw,
      RL_ANON: objectLimiter(
        raw.LIMITER,
        "anon",
        ANONYMOUS_REQUESTS_PER_MINUTE,
      ),
      METER: objectMeter(raw.LIMITER),
    };
    // The binding is the same object on every request; the runner closes over it.
    if (raw.REGISTRY && raw.REGISTRY !== boundRegistry) {
      boundRegistry = raw.REGISTRY;
      configureRegistryRunner(registryRunner(raw.REGISTRY));
    }
    const api: Fetcher = { fetch: (r) => node.fetch(r, raw, ctx) };
    try {
      return await handle(request, env, api);
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
