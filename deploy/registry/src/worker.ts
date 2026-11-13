/**
 * factlot-registry: answers the registry_* tools for api.factlot.com from a precomputed pack (static assets).
 * It has no route and no workers.dev URL: factlot-api reaches it through a service binding, and the pack is never
 * served as files.
 *
 *   POST /run   {"tool": "registry_get", "input": {...}}  →  200 ToolOutcome
 *   POST /get-many {"urns": [...]} (1 to 50)              →  200 {built_at, outcomes: ToolOutcome[]}, each the
 *                                                             registry_get outcome of one URN, in order (watch lists:
 *                                                             one service-binding call reads many subjects)
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
/** URNs one /get-many call may read. */
export const GET_MANY_MAX = 50;

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
  if (pathname === "/get-many") return getMany(request, p);
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

/** registry_get for up to GET_MANY_MAX URNs in one request, with the pack's built_at. */
async function getMany(request: Request, p: Pack): Promise<Response> {
  if (request.method !== "POST")
    return fail(405, "MethodNotAllowed", "POST a JSON body to /get-many");
  const text = await request.text();
  if (text.length > MAX_BODY)
    return fail(413, "PayloadTooLarge", "request body too large");
  let urns: unknown;
  try {
    urns = (JSON.parse(text) as { urns?: unknown } | null)?.urns;
  } catch {
    return fail(400, "BadRequest", "the body is not JSON");
  }
  if (
    !Array.isArray(urns) ||
    urns.length === 0 ||
    urns.length > GET_MANY_MAX ||
    urns.some((u) => typeof u !== "string")
  )
    return fail(
      400,
      "BadRequest",
      `expected {"urns": [...]} with 1 to ${GET_MANY_MAX} strings`,
    );
  const m = await p.manifest();
  const outcomes = [];
  for (const urn of urns as string[])
    outcomes.push(await runRegistryTool(p, "registry_get", { urn }));
  return json({ built_at: m.built_at, outcomes });
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
