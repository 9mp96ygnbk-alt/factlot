/**
 * factlot-registry: answers the registry_* tools for api.factlot.com from a precomputed pack (static assets).
 * It has no route and no workers.dev URL: factlot-api reaches it through a service binding, and the pack is never
 * served as files.
 *
 *   POST /run   {"tool": "registry_get", "input": {...}}  →  200 ToolOutcome
 *   GET /health                                           →  {ok, pack: {built_at, regions, counts}}
 *   /pages/...                                            →  the property pages' enumeration (pages.ts)
 */
import { pagesRoute } from "./pages.ts";
import { Pack, type AssetFetcher } from "./store.ts";
import { runRegistryTool } from "./tools.ts";

export interface Env {
  ASSETS: AssetFetcher;
}

const MAX_BODY = 64 * 1024;

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });

const fail = (status: number, error: string, message: string): Response =>
  json({ error, message }, status);

let pack: { assets: AssetFetcher; pack: Pack } | undefined;
function packFor(env: Env): Pack {
  if (pack?.assets !== env.ASSETS)
    pack = { assets: env.ASSETS, pack: new Pack(env.ASSETS) };
  return pack.pack;
}

export async function handle(request: Request, env: Env): Promise<Response> {
  const { pathname } = new URL(request.url);
  const p = packFor(env);
  if (pathname === "/health" && request.method === "GET") {
    const m = await p.manifest();
    return json({
      ok: true,
      pack: {
        built_at: m.built_at,
        regions: m.dbs.map((d) => d.name),
        counts: m.counts,
      },
    });
  }
  if (pathname.startsWith("/pages/")) return pagesRoute(request, p);
  if (pathname !== "/run") return fail(404, "NotFound", "not found");
  if (request.method !== "POST")
    return fail(405, "MethodNotAllowed", "POST a JSON body to /run");
  const text = await request.text();
  if (text.length > MAX_BODY)
    return fail(413, "PayloadTooLarge", "request body too large");
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return fail(400, "BadRequest", "the body is not JSON");
  }
  const { tool, input } = (body ?? {}) as { tool?: unknown; input?: unknown };
  if (typeof tool !== "string")
    return fail(
      400,
      "BadRequest",
      'expected {"tool": "<registry tool>", "input": {...}}',
    );
  return json(await runRegistryTool(p, tool, input ?? {}));
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      return await handle(request, env);
    } catch (err) {
      console.error(
        JSON.stringify({
          msg: "error",
          error: err instanceof Error ? err.name : typeof err,
        }),
      );
      return fail(500, "InternalError", "unexpected error");
    }
  },
};
