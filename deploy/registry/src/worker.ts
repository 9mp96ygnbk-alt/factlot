/**
 * factlot-registry: answers the registry_* tools for api.factlot.com from a precomputed pack, read from one of two
 * backends (PACK_BACKEND): "assets" (the default: the pack uploaded as the Worker's static assets, ASSETS binding)
 * or "r2" (the pack in an object-storage bucket, PACK_BUCKET binding, the live pack named by a pointer object;
 * r2_pack.ts).
 * It has no route and no workers.dev URL: factlot-api reaches it through a service binding, and the pack is never
 * served as files.
 *
 *   POST /run   {"tool": "registry_get", "input": {...}}  →  200 ToolOutcome
 *   POST /get-many {"urns": [...]} (1 to 50)              →  200 {built_at, outcomes: ToolOutcome[]}, each the
 *                                                             registry_get outcome of one URN, in order (watch lists:
 *                                                             one service-binding call reads many subjects)
 *   GET /health                                           →  {ok, pack: {built_at, regions, counts}} (and, on r2,
 *                                                            backend and pack id)
 * With the r2 backend, a missing or inconsistent pointer answers 503 PackUnavailable (fails closed).
 *   /pages/...                                            →  the property pages' enumeration (pages.ts)
 */
import { pagesRoute } from "./pages.ts";
import {
  PackResolver,
  PackUnavailable,
  POINTER_KEY,
  POINTER_TTL_SECONDS,
  bucketText,
  type R2BucketLike,
} from "./r2_pack.ts";
import { Pack, assetsSource, type AssetFetcher } from "./store.ts";
import { runRegistryTool } from "./tools.ts";

export interface Env {
  /** The static-assets backend (PACK_BACKEND unset or "assets"). */
  ASSETS?: AssetFetcher;
  /** The object-storage backend's bucket (PACK_BACKEND "r2"). */
  PACK_BUCKET?: R2BucketLike;
  /** "assets" (default) or "r2". */
  PACK_BACKEND?: string;
  /** The pointer object's key (default packs/current.json), e.g. a staging pointer for a non-production Worker. */
  PACK_POINTER?: string;
  /** Seconds an isolate keeps the pointer before reading it again (default 30). */
  PACK_POINTER_TTL_SECONDS?: string;
}

const MAX_BODY = 64 * 1024;
/** URNs one /get-many call may read. */
// Module-local: workerd accepts only handlers (functions, classes, handler objects) as named exports of the
// entry module, and refuses to start on any other value.
const GET_MANY_MAX = 50;

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });

const fail = (status: number, error: string, message: string): Response =>
  json({ error, message }, status);

let pack: { assets: AssetFetcher; pack: Pack } | undefined;
let resolver:
  | { bucket: R2BucketLike; key: string; ttl: number; resolver: PackResolver }
  | undefined;

function r2Resolver(env: Env): PackResolver {
  const bucket = env.PACK_BUCKET;
  if (!bucket)
    throw new PackUnavailable(
      "PACK_BACKEND is r2 but the Worker has no PACK_BUCKET binding",
    );
  const key = env.PACK_POINTER || POINTER_KEY;
  const seconds = Number(env.PACK_POINTER_TTL_SECONDS ?? POINTER_TTL_SECONDS);
  const ttl =
    (Number.isFinite(seconds) && seconds >= 0 ? seconds : POINTER_TTL_SECONDS) *
    1000;
  if (
    resolver?.bucket !== bucket ||
    resolver.key !== key ||
    resolver.ttl !== ttl
  )
    resolver = {
      bucket,
      key,
      ttl,
      resolver: new PackResolver(bucketText(bucket), {
        pointerKey: key,
        ttlMs: ttl,
        warn: (message) =>
          console.warn(JSON.stringify({ msg: "pack pointer", message })),
      }),
    };
  return resolver.resolver;
}

/** The pack this request answers from; every file of the request is read through it (one pack, never two). */
async function packFor(env: Env): Promise<Pack> {
  const backend = env.PACK_BACKEND || "assets";
  if (backend === "r2") return r2Resolver(env).pack();
  if (backend !== "assets")
    throw new PackUnavailable(
      `PACK_BACKEND is ${JSON.stringify(backend)}: expected "assets" or "r2"`,
    );
  if (!env.ASSETS)
    throw new PackUnavailable(
      "PACK_BACKEND is assets but the Worker has no ASSETS binding",
    );
  if (pack?.assets !== env.ASSETS)
    pack = { assets: env.ASSETS, pack: new Pack(assetsSource(env.ASSETS)) };
  return pack.pack;
}

export async function handle(request: Request, env: Env): Promise<Response> {
  const { pathname } = new URL(request.url);
  let p: Pack;
  try {
    p = await packFor(env);
  } catch (err) {
    if (!(err instanceof PackUnavailable)) throw err;
    console.error(
      JSON.stringify({ msg: "pack unavailable", message: err.message }),
    );
    return fail(503, "PackUnavailable", err.message);
  }
  if (pathname === "/health" && request.method === "GET") {
    const m = await p.manifest();
    const pointer =
      env.PACK_BACKEND === "r2" ? resolver?.resolver.pointer : undefined;
    return json({
      ok: true,
      pack: {
        built_at: m.built_at,
        regions: m.dbs.map((d) => d.name),
        counts: m.counts,
        ...(pointer ? { backend: "r2", pack_id: pointer.pack_id } : {}),
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
