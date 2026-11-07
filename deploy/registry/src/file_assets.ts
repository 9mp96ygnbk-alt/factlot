/**
 * A pack directory read through the same interface as the Worker's ASSETS binding (Node only: the tests and
 * scripts/registry/check_pack.ts use it; the Worker never imports it).
 */
import { readFileSync } from "node:fs";
import { join, normalize } from "node:path";

import type { AssetFetcher } from "./store.ts";

export function fileAssets(dir: string): AssetFetcher {
  return {
    async fetch(request: Request | string): Promise<Response> {
      const url = new URL(typeof request === "string" ? request : request.url);
      const path = normalize(decodeURIComponent(url.pathname)).replace(
        /^\/+/,
        "",
      );
      if (path.startsWith(".."))
        return new Response("not found", { status: 404 });
      try {
        return new Response(readFileSync(join(dir, path)), {
          headers: { "content-type": "application/json" },
        });
      } catch {
        return new Response("not found", { status: 404 });
      }
    },
  };
}
