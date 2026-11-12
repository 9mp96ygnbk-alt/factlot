/**
 * Internal routes behind the public property pages (deploy/cloudflare/src/property-pages.ts). Like /run they are
 * reachable only through the REGISTRY service binding; they read the pack's existing files and never return pack
 * files or facts beyond what a page shows.
 *
 *   POST /pages/sources  {refs: [{document_id, subject, as_of}]}  →  {sources: {document_id: source_id | null}}
 *   GET  /pages/index?extra=<ids>                                  →  {built_at, files: [{db, group}]}
 *   GET  /pages/sitemap?db=<name>&group=<n>&extra=<ids>            →  {built_at, urls: [{urn, lastmod}]}
 *
 * Enumeration reads the record shards (g/<db>/<i>.json): their keys are every subject the pack answers, each once,
 * and decoding only each parcel's record (not its dated variants) gives the exact page rule of page-rules.ts. One
 * child sitemap is SITEMAP_SHARDS_PER_FILE consecutive shards of one region file (about 1,300 parcels for 1.5 MB
 * read). The index reads the manifest only: it lists every group of every region file except one whose sources
 * the manifest records as not redistributable (and not listed in `extra`), such as the Texas appraisal districts.
 */
import { hostedWithheldCounties } from "../../../packages/tools/src/registry.ts";

import {
  decodeEntryField,
  type EncodedShard,
  type Manifest,
} from "./format.ts";
import {
  SITEMAP_SHARDS_PER_FILE,
  SourceIndex,
  newestAsOf,
  parcelPageRefs,
  parseSourceList,
  refsAllowed,
  situsAddress,
  type PageRecord,
  type SourceManifest,
} from "./page-rules.ts";
import type { Pack } from "./store.ts";

const WITHHELD = hostedWithheldCounties();
const MAX_REFS = 500;
const OPEN = new Set(["permitted", "attribution_required"]);

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });

let indexFor: { manifest: Manifest; index: SourceIndex } | undefined;
function sourceIndex(m: Manifest): SourceIndex {
  if (indexFor?.manifest !== m)
    indexFor = {
      manifest: m,
      index: new SourceIndex(m as unknown as SourceManifest),
    };
  return indexFor.index;
}

function withheld(m: Manifest, region: string): boolean {
  const county = region.replace(/^us-/, "");
  return (
    Object.hasOwn(m.withheld ?? {}, county) || Object.hasOwn(WITHHELD, county)
  );
}

/**
 * Whether a region file may hold an eligible parcel: false only when every source of every county it holds is
 * recorded by the manifest as not redistributable and is not listed in `extra`.
 */
export function regionMayList(
  m: Manifest,
  db: number,
  extra: ReadonlySet<string>,
): boolean {
  if ((m.dbs[db]?.parcels ?? 0) === 0) return false;
  const idx = sourceIndex(m);
  const regions = Object.entries(m.counties)
    .filter(([region, i]) => i === db && !withheld(m, region))
    .map(([region]) => region);
  if (regions.length === 0) return false;
  for (const region of regions)
    for (const s of idx.scopeSources(`fl:parcel:${region}:x`)) {
      const red = idx.redistribution.get(s.source_id);
      if (red === undefined || OPEN.has(red) || extra.has(s.source_id))
        return true;
    }
  return false;
}

/** The eligible parcel URNs (with lastmod) of one child sitemap. */
export async function sitemapUrls(
  pack: Pack,
  db: number,
  group: number,
  extra: ReadonlySet<string>,
): Promise<{ urn: string; lastmod: string | null }[]> {
  const m = await pack.manifest();
  const d = m.dbs[db]!;
  const idx = sourceIndex(m);
  const sourceOf = idx.sourceOf.bind(idx);
  const from = group * SITEMAP_SHARDS_PER_FILE;
  const to = Math.min(d.shards, from + SITEMAP_SHARDS_PER_FILE);
  const out: { urn: string; lastmod: string | null }[] = [];
  for (let i = from; i < to; i++) {
    const shard = await pack.file<EncodedShard>(`g/${db}/${i}.json`);
    if (!shard) continue;
    for (const key of Object.keys(shard.e)) {
      const region = /^fl:parcel:(us-\d{5}):/.exec(key)?.[1];
      if (!region || withheld(m, region)) continue;
      const rec = decodeEntryField(shard, key, "r") as PageRecord | undefined;
      if (!rec || situsAddress(rec) === null) continue;
      const refs = parcelPageRefs(rec);
      if (!refsAllowed(refs, sourceOf, extra)) continue;
      out.push({ urn: key, lastmod: newestAsOf(refs) });
    }
  }
  return out.sort((a, b) => (a.urn < b.urn ? -1 : a.urn > b.urn ? 1 : 0));
}

export async function pagesRoute(
  request: Request,
  pack: Pack,
): Promise<Response> {
  const url = new URL(request.url);
  const m = await pack.manifest();
  const extra = parseSourceList(url.searchParams.get("extra"));
  if (url.pathname === "/pages/sources" && request.method === "POST") {
    let body: unknown;
    try {
      body = JSON.parse(await request.text());
    } catch {
      return json(
        { error: "BadRequest", message: "the body is not JSON" },
        400,
      );
    }
    const refs = (body as { refs?: unknown })?.refs;
    if (!Array.isArray(refs) || refs.length > MAX_REFS)
      return json(
        {
          error: "BadRequest",
          message: `expected {refs: [...]} (at most ${MAX_REFS})`,
        },
        400,
      );
    const idx = sourceIndex(m);
    const sources: Record<string, string | null> = {};
    for (const r of refs as Record<string, unknown>[]) {
      const ref = {
        document_id: String(r?.document_id ?? ""),
        subject: String(r?.subject ?? ""),
        as_of: String(r?.as_of ?? ""),
      };
      if (!ref.document_id || Object.hasOwn(sources, ref.document_id)) continue;
      sources[ref.document_id] = idx.sourceOf(ref);
    }
    return json({ sources });
  }
  if (request.method !== "GET")
    return json({ error: "MethodNotAllowed", message: "not allowed" }, 405);
  if (url.pathname === "/pages/index") {
    const files: { db: string; group: number }[] = [];
    m.dbs.forEach((d, i) => {
      if (!regionMayList(m, i, extra)) return;
      const groups = Math.ceil(d.shards / SITEMAP_SHARDS_PER_FILE);
      for (let g = 0; g < groups; g++) files.push({ db: d.name, group: g });
    });
    return json({ built_at: m.built_at, files });
  }
  if (url.pathname === "/pages/sitemap") {
    const db = m.dbs.findIndex((d) => d.name === url.searchParams.get("db"));
    const group = Number(url.searchParams.get("group"));
    if (
      db < 0 ||
      !Number.isInteger(group) ||
      group < 0 ||
      group * SITEMAP_SHARDS_PER_FILE >= m.dbs[db]!.shards ||
      !regionMayList(m, db, extra)
    )
      return json({ error: "NotFound", message: "no such sitemap" }, 404);
    return json({
      built_at: m.built_at,
      urls: await sitemapUrls(pack, db, group, extra),
    });
  }
  return json({ error: "NotFound", message: "not found" }, 404);
}
