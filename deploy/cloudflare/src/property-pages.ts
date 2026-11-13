/**
 * Public property pages: one server-rendered page per hosted parcel whose sources allow redistribution, and the
 * sitemaps that list them. Off unless the Worker variable PROPERTY_PAGES_ENABLED is exactly "true"; with it off
 * none of these routes exists (the site answers 404).
 *
 *   /property/<county region>/<parcel id part of the URN>   the page of fl:parcel:<region>:<id> (GET, HEAD)
 *   /sitemaps/properties.xml                                the sitemap index
 *   /sitemaps/properties/<region file>-<n>.xml              one child sitemap
 *   /robots.txt                                             the site's file plus a Sitemap line for the index
 *
 * A page shows what a keyless registry_get caller gets (value history cut to the current roll year, as
 * gating.ts's limitHistory does), the owner of record when the registry has one, the linked entity, and every
 * fact's citation with its source's licence and attribution. Which parcels get a page is page-rules.ts (shared
 * with the registry's sitemap enumeration): every source behind a shown fact records `redistribution` as
 * `permitted` or `attribution_required`, or is listed in PROPERTY_PAGES_EXTRA_SOURCES. Withheld counties never
 * render. A parcel without a situs address renders with noindex and is left out of the sitemaps.
 *
 * Page views use no registry lookups of the visitor's quota. Each address (hashed as limiter.ts does) may open
 * PROPERTY_PAGES_PER_MINUTE pages and sitemaps a minute; beyond that the answer is 429 with Retry-After. Answers
 * are kept in the Cache API under a key holding the pack's built_at, so a new pack starts a new cache.
 */
import { hostedWithheldCounties, ownerNamesAPerson } from "@factlot/tools";

import {
  SITEMAP_MAX_URLS,
  currentValueEntries,
  entityPageRefs,
  factsOf,
  parcelPageRefs,
  parseSourceList,
  propertyPath,
  refsAllowed,
  situsAddress,
  urnOfPropertyPath,
  type Fact,
  type PageRecord,
  type SourceRef,
  type ValueEntry,
} from "../../registry/src/page-rules.ts";

import { siteUrl } from "./billing.ts";
import { CONTACT, REPO } from "./contact.ts";
import { limitHistory, type HistoryWithheld } from "./gating.ts";
import { escapeHtml } from "./html.ts";
import { addressSubject } from "./limiter.ts";
import { REGISTRY_RUN_URL } from "./registry.ts";
import { noticesFor } from "./source-notices.ts";
import type { Env, Fetcher } from "./types.ts";

/** The Worker variables this feature reads (kept out of types.ts so the shared Env stays as it is). */
export type PagesEnv = Env & {
  /** "true" turns the pages and sitemaps on; anything else (or unset) keeps every route 404. */
  PROPERTY_PAGES_ENABLED?: string;
  /** Source ids recorded `unknown` that may still get pages, comma-separated ("tx-harris-cad,tx-dallas-cad"). */
  PROPERTY_PAGES_EXTRA_SOURCES?: string;
};

/** Pages and sitemaps per minute per address. A crawler fetching one page a second stays well inside it. */
export const PROPERTY_PAGES_PER_MINUTE = 120;
/** Bumped when the page's HTML changes, so cached pages are not served across a renderer change. */
export const PAGE_RENDER_VERSION = "1";
export const SITEMAP_INDEX_PATH = "/sitemaps/properties.xml";
const SITEMAP_CHILD = /^\/sitemaps\/properties\/([a-z0-9]+)-(\d{1,6})\.xml$/;
/** Pages carry no script and no inline style: only the site's stylesheet loads. */
export const PROPERTY_PAGE_CSP = [
  "default-src 'none'",
  "style-src 'self'",
  "img-src 'self'",
  "script-src 'none'",
  "connect-src 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
].join("; ");
/** A page or sitemap changes only with the pack; the cache key holds its built_at. */
export const CACHE_OK = "public, max-age=3600, s-maxage=604800";
export const CACHE_MISS = "public, max-age=600, s-maxage=3600";
/** How long one isolate trusts the pack version it read from the registry. */
const PACK_VERSION_TTL_MS = 60_000;
/** Other parcels of the same owner linked from a page. */
const OTHER_LINKS = 3;

const WITHHELD = hostedWithheldCounties();

export interface CacheLike {
  match(request: Request): Promise<Response | undefined>;
  put(request: Request, response: Response): Promise<void>;
}

export interface PropertyPageOptions {
  now?: () => number;
  waitUntil?: (work: Promise<unknown>) => void;
  /** The cache (default: the Workers Cache API's default cache, when the runtime has one; null: none). */
  cache?: CacheLike | null;
}

export function propertyPagesEnabled(env: PagesEnv): boolean {
  return env.PROPERTY_PAGES_ENABLED === "true";
}

type Kind =
  | { kind: "robots" }
  | { kind: "index" }
  | { kind: "child"; db: string; group: number }
  | { kind: "page"; urn: string };

function kindOf(path: string): Kind | undefined {
  if (path === "/robots.txt") return { kind: "robots" };
  if (path === SITEMAP_INDEX_PATH) return { kind: "index" };
  const child = SITEMAP_CHILD.exec(path);
  if (child) return { kind: "child", db: child[1]!, group: Number(child[2]) };
  const urn = urnOfPropertyPath(path);
  return urn ? { kind: "page", urn } : undefined;
}

class Unavailable extends Error {}

const defaultCache = (): CacheLike | null =>
  (globalThis as { caches?: { default?: CacheLike } }).caches?.default ?? null;

/**
 * The property pages' routes on the site hosts, or undefined when the path is not one of them or the feature is
 * off (the caller then serves the site, which answers 404). `path` is the router's path (no trailing slash).
 */
export async function propertyPagesRoute(
  request: Request,
  env: PagesEnv,
  path: string,
  opts: PropertyPageOptions = {},
): Promise<Response | undefined> {
  if (!propertyPagesEnabled(env)) return undefined;
  const k = kindOf(path);
  if (!k) return undefined;
  const site = siteUrl(env);
  if (k.kind === "robots") return robots(request, env, site);
  if (request.method !== "GET" && request.method !== "HEAD")
    return text(405, "Use GET or HEAD.\n", { allow: "GET, HEAD" });
  const head = request.method === "HEAD";
  const registry = env.REGISTRY;
  if (!registry) return bodyless(head, notFoundPage(site));
  const now = opts.now ?? Date.now;

  // The per-address limit, before anything else is read. The subject is the salted daily hash of the address
  // bucket (never the address), under its own prefix: no registry lookup quota is touched.
  let allowed: boolean;
  try {
    const subject = await addressSubject(
      request.headers.get("cf-connecting-ip") ?? "unknown",
      now(),
      env.IP_HASH_SALT,
    );
    allowed = (
      await env.METER.hit(`pages:${subject}`, PROPERTY_PAGES_PER_MINUTE)
    ).ok;
  } catch {
    return unavailable(head, 5);
  }
  if (!allowed)
    return bodyless(
      head,
      text(
        429,
        `Too many pages from one address: at most ${PROPERTY_PAGES_PER_MINUTE} a minute. Retry in 60 seconds.\n`,
        {
          "retry-after": "60",
          "x-ratelimit-limit": String(PROPERTY_PAGES_PER_MINUTE),
        },
      ),
    );

  const extra = parseSourceList(env.PROPERTY_PAGES_EXTRA_SOURCES);
  try {
    const builtAt = await packVersion(registry, now());
    const cache = opts.cache === undefined ? defaultCache() : opts.cache;
    const url = new URL(request.url);
    const key = new Request(
      `${url.origin}${path}?render=${PAGE_RENDER_VERSION}&pack=${encodeURIComponent(builtAt)}&extra=${encodeURIComponent([...extra].sort().join(","))}`,
    );
    const hit = cache ? await cache.match(key) : undefined;
    if (hit) return bodyless(head, hit);
    const res =
      k.kind === "page"
        ? await pageResponse(registry, k.urn, site, extra, builtAt)
        : k.kind === "index"
          ? await indexResponse(registry, site, extra)
          : await childResponse(registry, k.db, k.group, site, extra);
    if (cache && (res.status === 200 || res.status === 404)) {
      const put = cache.put(key, res.clone()).catch(() => {});
      if (opts.waitUntil) opts.waitUntil(put);
      else await put;
    }
    return bodyless(head, res);
  } catch (err) {
    if (err instanceof Unavailable) return unavailable(head, 30);
    throw err;
  }
}

// --- responses -----------------------------------------------------------------------------------

function text(
  status: number,
  body: string,
  headers: Record<string, string> = {},
): Response {
  return new Response(body, {
    status,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
      ...headers,
    },
  });
}

function bodyless(head: boolean, res: Response): Response {
  return head
    ? new Response(null, { status: res.status, headers: res.headers })
    : res;
}

function unavailable(head: boolean, seconds: number): Response {
  return bodyless(
    head,
    text(
      503,
      `The property pages are briefly unavailable. Retry in ${seconds} seconds.\n`,
      { "retry-after": String(seconds) },
    ),
  );
}

function htmlResponse(status: number, html: string): Response {
  return new Response(html, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": status === 200 ? CACHE_OK : CACHE_MISS,
      "content-security-policy": PROPERTY_PAGE_CSP,
      "referrer-policy": "strict-origin-when-cross-origin",
      "x-content-type-options": "nosniff",
      "x-frame-options": "DENY",
    },
  });
}

function xmlResponse(xml: string): Response {
  return new Response(xml, {
    status: 200,
    headers: {
      "content-type": "application/xml; charset=utf-8",
      "cache-control": CACHE_OK,
      "x-content-type-options": "nosniff",
    },
  });
}

async function robots(
  request: Request,
  env: PagesEnv,
  site: string,
): Promise<Response | undefined> {
  if (!env.ASSETS || (request.method !== "GET" && request.method !== "HEAD"))
    return undefined;
  const res = await env.ASSETS.fetch(
    new Request(request.url, { method: "GET" }),
  );
  if (!res.ok) return undefined;
  const body = await res.text();
  const line = `Sitemap: ${site}${SITEMAP_INDEX_PATH}`;
  const out = body.includes(line)
    ? body
    : `${body.replace(/\n*$/, "\n")}${line}\n`;
  const headers = new Headers(res.headers);
  headers.delete("content-length");
  headers.set("content-type", "text/plain; charset=utf-8");
  return bodyless(
    request.method === "HEAD",
    new Response(out, { status: 200, headers }),
  );
}

// --- the registry ----------------------------------------------------------------------------------

type Outcome =
  | { ok: true; result: unknown }
  | { ok: false; error: { error: string; message?: string } };

async function call(
  registry: Fetcher,
  path: string,
  init?: { body: unknown },
): Promise<{ status: number; body: unknown }> {
  let res: Response;
  try {
    res = await registry.fetch(
      new Request(`https://registry.internal${path}`, {
        method: init ? "POST" : "GET",
        headers: init ? { "content-type": "application/json" } : undefined,
        body: init ? JSON.stringify(init.body) : undefined,
      }),
    );
  } catch {
    throw new Unavailable("registry");
  }
  if (res.status >= 500) throw new Unavailable("registry");
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    if (res.ok) throw new Unavailable("registry");
  }
  return { status: res.status, body };
}

async function run(
  registry: Fetcher,
  tool: string,
  input: unknown,
): Promise<Outcome> {
  const { status, body } = await call(
    registry,
    new URL(REGISTRY_RUN_URL).pathname,
    { body: { tool, input } },
  );
  const o = body as Outcome | null;
  if (status !== 200 || !o || typeof o !== "object" || !("ok" in o))
    throw new Unavailable("registry");
  if (!o.ok && o.error?.error === "RegistryUnavailable")
    throw new Unavailable("registry");
  return o;
}

let version: { registry: Fetcher; at: number; builtAt: string } | undefined;
let coverage:
  | { builtAt: string; counties: Map<string, { name: string; state: string }> }
  | undefined;

/** Forget the cached pack version and coverage (tests). */
export function resetPropertyPagesState(): void {
  version = undefined;
  coverage = undefined;
}

async function packVersion(registry: Fetcher, now: number): Promise<string> {
  if (
    version &&
    version.registry === registry &&
    now - version.at < PACK_VERSION_TTL_MS
  )
    return version.builtAt;
  const { status, body } = await call(registry, "/health");
  const builtAt = (body as { pack?: { built_at?: unknown } } | null)?.pack
    ?.built_at;
  if (status !== 200 || typeof builtAt !== "string")
    throw new Unavailable("registry");
  version = { registry, at: now, builtAt };
  return builtAt;
}

async function countyNames(
  registry: Fetcher,
  builtAt: string,
): Promise<Map<string, { name: string; state: string }>> {
  if (coverage?.builtAt === builtAt) return coverage.counties;
  const o = await run(registry, "registry_coverage", {});
  const counties = new Map<string, { name: string; state: string }>();
  if (o.ok)
    for (const c of ((o.result as { counties?: unknown[] })?.counties ??
      []) as Record<string, unknown>[])
      if (typeof c.region === "string")
        counties.set(c.region, {
          name: typeof c.name === "string" ? c.name : c.region,
          state: typeof c.state === "string" ? c.state : "",
        });
  coverage = { builtAt, counties };
  return counties;
}

async function sourceIds(
  registry: Fetcher,
  refs: SourceRef[],
): Promise<Record<string, string | null>> {
  const unique = new Map<string, SourceRef>();
  for (const r of refs)
    if (r.document_id && !unique.has(r.document_id))
      unique.set(r.document_id, r);
  if (unique.size === 0) return {};
  const { status, body } = await call(registry, "/pages/sources", {
    body: {
      refs: [...unique.values()].map(({ document_id, subject, as_of }) => ({
        document_id,
        subject,
        as_of,
      })),
    },
  });
  if (status !== 200) throw new Unavailable("registry");
  return ((body as { sources?: Record<string, string | null> })?.sources ??
    {}) as Record<string, string | null>;
}

// --- the page --------------------------------------------------------------------------------------

const regionOf = (urn: string): string =>
  /^fl:(?:parcel|entity):([a-z0-9-]+):/.exec(urn)?.[1] ?? "";
const withheldRegion = (region: string): boolean =>
  Object.hasOwn(WITHHELD, region.replace(/^us-/, ""));

// The person rule (an owner written like a person's estate or trust) lives in @factlot/tools so the
// property sheet applies the same function; the page shows no owner, entity or other parcels for such a parcel.
export { ownerNamesAPerson };

/** The entity a parcel's `owns` relationship links its owner of record to, or null. */
export function ownerEntity(rec: PageRecord): string | null {
  for (const r of rec.relationships ?? [])
    if (
      r?.type === "owns" &&
      r.to_urn === rec.urn &&
      typeof r.from_urn === "string" &&
      r.from_urn.startsWith("fl:entity:")
    )
      return r.from_urn;
  return null;
}

type LimitedRecord = PageRecord & { history_withheld?: HistoryWithheld };

async function pageResponse(
  registry: Fetcher,
  urn: string,
  site: string,
  extra: ReadonlySet<string>,
  builtAt: string,
): Promise<Response> {
  const region = regionOf(urn);
  if (withheldRegion(region)) return notFoundPage(site);
  const [got, counties] = await Promise.all([
    run(registry, "registry_get", { urn }),
    countyNames(registry, builtAt),
  ]);
  if (!got.ok) return notFoundPage(site);
  const rec = limitHistory(got.result) as LimitedRecord;
  if (rec?.urn !== urn) return notFoundPage(site);

  // The owner's registered entity and its other parcels (only what a free caller could read).
  // None of it for an owner written like a person's estate or trust (ownerNamesAPerson).
  const ownerValue = factsOf(rec, ["ownership.owner_of_record"])[0]?.value;
  const entityUrn =
    typeof ownerValue === "string" && ownerNamesAPerson(ownerValue)
      ? null
      : ownerEntity(rec);
  let entity: PageRecord | null = null;
  let owned: string[] = [];
  if (entityUrn) {
    const [e, o] = await Promise.all([
      run(registry, "registry_get", { urn: entityUrn }),
      run(registry, "registry_owned_by", { entity_urn: entityUrn }),
    ]);
    if (e.ok) entity = e.result as PageRecord;
    if (o.ok)
      owned = (
        ((o.result as { results?: unknown[] })?.results ?? []) as {
          urn?: unknown;
        }[]
      )
        .map((r) => r?.urn)
        .filter(
          (u): u is string =>
            typeof u === "string" &&
            u.startsWith("fl:parcel:") &&
            u !== urn &&
            !withheldRegion(regionOf(u)),
        );
    // One row per link document can repeat a parcel; the page counts and links parcels.
    owned = [...new Set(owned)];
  }
  const sameCounty = owned.filter((u) => regionOf(u) === region);
  const candidates = [
    ...sameCounty,
    ...owned.filter((u) => regionOf(u) !== region),
  ].slice(0, OTHER_LINKS);
  const others = (
    await Promise.all(
      candidates.map((u) => run(registry, "registry_get", { urn: u })),
    )
  ).flatMap((o) => (o.ok ? [limitHistory(o.result) as PageRecord] : []));

  const refs = parcelPageRefs(rec);
  const entityRefs = entity ? entityPageRefs(entity) : [];
  const sources = await sourceIds(registry, [
    ...refs,
    ...entityRefs,
    ...others.flatMap((r) => parcelPageRefs(r)),
  ]);
  const sourceOf = (r: SourceRef) => sources[r.document_id] ?? null;
  if (!refsAllowed(refs, sourceOf, extra)) return notFoundPage(site);
  const showEntity =
    entity !== null && refsAllowed(entityRefs, sourceOf, extra);
  const links = others
    .filter((r) => refsAllowed(parcelPageRefs(r), sourceOf, extra))
    .map((r) => ({
      path: propertyPath(r.urn)!,
      label: situsAddress(r) ?? `Parcel ${apnOf(r) ?? r.urn}`,
    }));

  const place = counties.get(region) ?? { name: region, state: "" };
  const html = renderPropertyPage({
    site,
    rec,
    place: { region, ...place },
    entity: showEntity ? entity : null,
    otherCount: showEntity ? owned.length : null,
    links: showEntity ? links : [],
    sourceOf: (doc) => sources[doc] ?? null,
  });
  return htmlResponse(200, html);
}

function apnOf(rec: PageRecord): string | null {
  const v = factsOf(rec, ["parcel.apn"])[0]?.value;
  return typeof v === "string" && v.trim() !== "" ? v : null;
}

// --- rendering ---------------------------------------------------------------------------------------

const int = new Intl.NumberFormat("en-US");
const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

const NAV: [string, string][] = [
  ["/try/", "Try it"],
  ["/calculators/", "Calculators"],
  ["/mcp-server/", "MCP server"],
  ["/texas/", "Texas"],
  ["/coverage/", "Coverage"],
  [`${REPO}/blob/main/docs/getting-started.md`, "Docs"],
  ["/pricing/", "Pricing"],
];

/** The site page for a county or market, when the site has one; else the coverage page. */
const MARKET_PAGES: Record<string, string> = {
  "us-36005": "/new-york-city/",
  "us-36047": "/new-york-city/",
  "us-36061": "/new-york-city/",
  "us-36081": "/new-york-city/",
  "us-36085": "/new-york-city/",
  "us-06037": "/los-angeles/",
  "us-06075": "/san-francisco/",
  "us-25025": "/boston/",
  "us-08031": "/denver/",
};

export function placePage(
  region: string,
  name: string,
): { href: string; label: string } {
  if (region.startsWith("us-48") && name)
    return {
      href: `/texas/${name
        .replace(/ County$/, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")}/`,
      label: `${name}, Texas`,
    };
  if (MARKET_PAGES[region])
    return { href: MARKET_PAGES[region]!, label: name || region };
  if (region.startsWith("us-09"))
    return { href: "/connecticut/", label: "Connecticut" };
  return { href: "/coverage/", label: "Coverage: every hosted county" };
}

function yearsInWords(years: number[]): string {
  const n = years.length;
  const asc = [...years].sort((x, y) => x - y);
  const contiguous = asc.every(
    (y, i) => i === 0 || y === (asc[i - 1] ?? Number.NaN) + 1,
  );
  const label = `${n} earlier roll ${n === 1 ? "year" : "years"}`;
  if (n === 1) return `${label}, ${asc[0]}`;
  if (contiguous && n > 2) return `${label}, ${asc[0]} to ${asc[n - 1]}`;
  if (n === 2) return `${label}, ${asc[0]} and ${asc[1]}`;
  return `${label}, ${asc.slice(0, -1).join(", ")} and ${asc[n - 1]}`;
}

const e = (v: unknown): string => escapeHtml(String(v));
const safeHref = (u: unknown): string | null =>
  typeof u === "string" && /^https?:\/\/[^\s"<>]+$/.test(u) ? u : null;

interface Doc {
  n: number;
  document_id: string;
  title: string;
  uri: string | null;
  retrieved_at: string;
  rights: Fact["rights"];
  source_id: string | null;
}

export interface RenderInput {
  site: string;
  /** The parcel's registry_get answer, already cut to the free view (limitHistory). */
  rec: LimitedRecord;
  place: { region: string; name: string; state: string };
  /** The linked entity's record, when its facts may be shown. */
  entity: PageRecord | null;
  /** Other hosted parcels of the same entity (null when no entity is shown). */
  otherCount: number | null;
  links: { path: string; label: string }[];
  sourceOf: (documentId: string) => string | null;
}

/** The page's HTML (pure: tests call it directly). Every value from the registry is escaped. */
export function renderPropertyPage(input: RenderInput): string {
  const { site, rec, place, entity } = input;
  const docs = new Map<string, Doc>();
  const cite = (
    documentId: string | undefined,
    f: Fact | undefined,
    locator: string | undefined,
    asOf: string | undefined,
  ): string => {
    if (!documentId) return "";
    let d = docs.get(documentId);
    if (!d) {
      const src = f?.provenance?.sources?.find(
        (s) => s.document_id === documentId,
      );
      const any =
        src ??
        (rec.facts ?? [])
          .flatMap((x) => x.provenance?.sources ?? [])
          .find((s) => s.document_id === documentId);
      const holder =
        f ??
        (rec.facts ?? []).find((x) =>
          (x.provenance?.sources ?? []).some(
            (s) => s.document_id === documentId,
          ),
        );
      d = {
        n: docs.size + 1,
        document_id: documentId,
        title: any?.title ?? documentId,
        uri: safeHref(any?.uri),
        retrieved_at: any?.retrieved_at ?? "",
        rights: holder?.rights,
        source_id: input.sourceOf(documentId),
      };
      docs.set(documentId, d);
    }
    const bits = [locator ? e(locator) : "", asOf ? `as of ${e(asOf)}` : ""]
      .filter(Boolean)
      .join(", ");
    return `<a href="#source-${d.n}">[${d.n}]</a>${bits ? ` ${bits}` : ""}`;
  };
  const factCite = (f: Fact): string =>
    (f.provenance?.sources ?? [])
      .map((s) => cite(s.document_id, f, s.section, f.as_of))
      .join("; ");

  const one = (p: string) => factsOf(rec, [p])[0];
  const address = situsAddress(rec);
  const apn = one("parcel.apn");
  const placeText = [place.name, place.state].filter(Boolean).join(", ");
  const rows: string[] = [];
  const row = (label: string, value: string, source: string) =>
    rows.push(
      `<tr><th scope="row">${e(label)}</th><td>${value}</td><td class="small">${source}</td></tr>`,
    );
  const factRow = (
    label: string,
    p: string,
    fmt: (v: unknown, f: Fact) => string = (v) => e(v),
  ) => {
    const f = one(p);
    if (f && f.value !== null && f.value !== undefined && f.value !== "")
      row(label, fmt(f.value, f), factCite(f));
  };
  const area = (v: unknown, f: Fact) =>
    typeof v === "number"
      ? `${int.format(Math.round(v))} ${f.unit === "sf" || !f.unit ? "sq ft" : e(f.unit)}`
      : e(v);

  factRow("Situs address (as the publisher wrote it)", "parcel.situs_address");
  factRow("Parcel ID (the county's own system)", "parcel.apn");
  row(
    "County and state",
    `${e(placeText || place.region)} <span class="small">(${e(place.region)})</span>`,
    "",
  );
  factRow("State property category code", "parcel.state_property_category");
  factRow("Local use code", "parcel.local_use_code");
  factRow("Land area", "parcel.land_area_sf", area);
  factRow("Building area", "parcel.improvement_area_sf", area);
  factRow("Year built", "parcel.year_built", (v) => e(v));
  factRow("Building class", "parcel.building_class");
  factRow("Neighbourhood code", "parcel.neighborhood_code");

  // Values: the current roll year only (the free view). Without value_history, the current value facts.
  const entries = currentValueEntries(rec.value_history);
  const valueRows: string[] = [];
  const vEntry: ValueEntry | undefined = entries[0];
  const taxYearFact = one("parcel.tax_year");
  for (const [field, label] of [
    ["market_value", "Market value"],
    ["appraised_value", "Appraised value"],
  ] as const) {
    let amount: number | undefined;
    let year: unknown;
    let asOf: string | undefined;
    let source: string;
    if (vEntry) {
      if (typeof vEntry[field] !== "number") continue;
      amount = vEntry[field] as number;
      year = vEntry.tax_year;
      const c = vEntry.citations?.[field];
      asOf = c?.as_of ?? vEntry.as_of;
      const f = (rec.facts ?? []).find((x) => x.id && x.id === c?.fact_id);
      source = cite(c?.document_id, f, c?.locator, asOf);
    } else {
      const f = one(`parcel.${field}`);
      if (!f || typeof f.value !== "number") continue;
      amount = f.value;
      year = taxYearFact?.value;
      asOf = f.as_of;
      source = factCite(f);
    }
    const roll =
      typeof year === "number"
        ? `the publisher's ${year} roll`
        : "the publisher's roll";
    valueRows.push(
      `<tr><th scope="row">${e(label)}</th><td>${e(usd.format(amount))}<br><span class="small">${e(`figure from ${roll}${asOf ? `, as of ${asOf}` : ""}`)}</span></td><td class="small">${source}</td></tr>`,
    );
  }

  const owner = one("ownership.owner_of_record");
  const ownerHtml: string[] = [];
  let entityShown = false;
  if (
    owner &&
    typeof owner.value === "string" &&
    owner.value.trim() !== "" &&
    !ownerNamesAPerson(owner.value)
  ) {
    ownerHtml.push(
      `<tr><th scope="row">Owner of record</th><td>${e(owner.value)}</td><td class="small">${factCite(owner)}</td></tr>`,
    );
    const name = entity ? factsOf(entity, ["entity.legal_name"])[0] : undefined;
    if (entity && name && typeof name.value === "string") {
      const jurisdiction = regionOf(entity.urn);
      entityShown = true;
      ownerHtml.push(
        `<tr><th scope="row">Registered entity</th><td>${e(name.value)}<br><span class="small">${e(`registry ${jurisdiction} (${jurisdiction.replace(/^us-/, "").toUpperCase()})`)}</span></td><td class="small">${factCite(name)}</td></tr>`,
      );
    }
    if (input.otherCount !== null) {
      const n = input.otherCount;
      const list = input.links.length
        ? `<ul class="plain">${input.links.map((l) => `<li><a href="${e(l.path)}">${e(l.label)}</a></li>`).join("")}</ul>`
        : "";
      ownerHtml.push(
        `<tr><th scope="row">Other hosted parcels of this entity</th><td>${e(int.format(n))}${list}</td><td class="small"></td></tr>`,
      );
    }
  }

  const withheld = rec.history_withheld;
  const years = withheld?.tax_years ?? [];
  const pro = years.length
    ? `<h2 id="pro">What a Pro or Team key adds for this parcel</h2>
<p>${e(yearsInWords(years))}: the publisher's roll values for each, with the same citations, through <code>registry_get</code> on the hosted API. See <a href="/pricing/">pricing</a>.</p>`
    : "";

  const shownIds = new Set(
    [...docs.values()]
      .map((d) => d.source_id)
      .filter((s): s is string => s !== null),
  );
  const scopes = new Set([place.region]);
  if (entity && entityShown) scopes.add(regionOf(entity.urn));
  const notices = noticesFor(shownIds, scopes);

  const sourcesHtml = [...docs.values()]
    .map((d) => {
      const r = d.rights ?? {};
      const publisher = d.title.includes(": ")
        ? d.title.slice(0, d.title.indexOf(": "))
        : "";
      const items = [
        [
          "Source",
          d.uri ? `<a href="${e(d.uri)}">${e(d.title)}</a>` : e(d.title),
        ],
        ...(publisher ? [["Publisher", e(publisher)]] : []),
        ...(d.source_id
          ? [["Source ID", `<code>${e(d.source_id)}</code>`]]
          : []),
        ["Document", `<code>${e(d.document_id)}</code>`],
        ...(d.retrieved_at ? [["Retrieved", e(d.retrieved_at)]] : []),
        ["Licence as recorded", e(r.license ?? "not recorded")],
        ...(r.attribution ? [["Attribution", e(r.attribution)]] : []),
        ["Redistribution", e(r.redistribution ?? "not recorded")],
        ["AI use", e(r.ai_use ?? "not recorded")],
      ];
      return `<h3 id="source-${d.n}">[${d.n}] ${e(publisher || d.title)}</h3>
<table><tbody>${items.map(([k, v]) => `<tr><th scope="row">${k}</th><td>${v}</td></tr>`).join("")}</tbody></table>`;
    })
    .join("\n");

  const market = placePage(place.region, place.name);
  const path = propertyPath(rec.urn)!;
  const canonical = `${site}${path}`;
  const h1 =
    address ?? `Parcel ${typeof apn?.value === "string" ? apn.value : rec.urn}`;
  const title = `${h1} · ${placeText || place.region} · FactLot`;
  const year =
    typeof vEntry?.tax_year === "number" ? `${vEntry.tax_year} ` : "";
  const description = `Public-record facts for ${h1}${placeText ? `, ${placeText}` : ""}: parcel ID, property category, areas, year built and the publisher's ${year}roll values, each cited to its source. Not an appraisal.`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="color-scheme" content="light dark" />
<title>${e(title)}</title>
<meta name="description" content="${e(description)}" />
${address ? "" : '<meta name="robots" content="noindex" />\n'}<link rel="canonical" href="${e(canonical)}" />
<link rel="icon" href="/favicon.svg" type="image/svg+xml" />
<link rel="stylesheet" href="/styles.css" />
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
<header class="site-header">
<div class="wrap row">
<a class="brand" href="/" aria-label="FactLot home">FactLot</a>
<nav aria-label="Site">
<ul>
${NAV.map(([href, label]) => `<li><a href="${e(href)}">${e(label)}</a></li>`).join("\n")}
</ul>
</nav>
</div>
</header>
<main id="main">
<section aria-labelledby="page-title">
<div class="wrap">
<p class="small breadcrumbs"><a href="/">FactLot</a> › <a href="${e(market.href)}">${e(market.label)}</a> › Property</p>
<h1 id="page-title">${e(h1)}</h1>
<p class="lede">A commercial parcel in ${e(placeText || place.region)}, as its public records describe it. FactLot ID <code>${e(rec.urn)}</code>.</p>
<h2 id="facts">Parcel</h2>
<table><thead><tr><th scope="col">Fact</th><th scope="col">Value</th><th scope="col">Source</th></tr></thead><tbody>
${rows.join("\n")}
</tbody></table>
${valueRows.length ? `<h2 id="values">Roll values</h2>\n<p class="small">The publisher's own roll figures for the current roll year, as released.</p>\n<table><tbody>\n${valueRows.join("\n")}\n</tbody></table>` : ""}
${ownerHtml.length ? `<h2 id="owner">Owner</h2>\n<table><tbody>\n${ownerHtml.join("\n")}\n</tbody></table>` : ""}
${pro}
<h2 id="sources">Sources</h2>
<p class="small">Each fact above cites the file it was read from. Licence, attribution, redistribution and AI use are as recorded for that source.</p>
${sourcesHtml}
${notices.length ? `<h2 id="notices">Source notices</h2>\n${notices.map((n) => `<p class="small">${n}</p>`).join("\n")}` : ""}
<h2 id="more">More</h2>
<ul>
${market.href === "/coverage/" ? "" : `<li><a href="${e(market.href)}">${e(market.label)}</a></li>\n`}<li><a href="/try/">Try a lookup</a></li>
<li><a href="/coverage/">Coverage: every county and what is hosted</a></li>
<li><a href="/mcp-server/">Connect your agent (MCP server)</a></li>
</ul>
<p class="small">A record shown here is a public-record fact as its publisher released it. It is not an appraisal or an opinion of value, not legal or tax advice, and not a substitute for checking the source. If a record names you as a person, or is wrong, email <a href="mailto:${CONTACT}">${CONTACT}</a> and we will remove or correct it.</p>
</div>
</section>
</main>
<footer class="site-footer">
<div class="wrap">
<p>
<a href="${REPO}">GitHub</a> ·
<a href="mailto:${CONTACT}">${CONTACT}</a> ·
<a href="/privacy">Privacy</a> ·
<a href="/terms">Terms</a>
</p>
</div>
</footer>
</body>
</html>
`;
}

export function notFoundPage(site: string): Response {
  return htmlResponse(
    404,
    `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex" />
<title>No page for this parcel · FactLot</title>
<link rel="stylesheet" href="/styles.css" />
</head>
<body>
<main id="main">
<section>
<div class="wrap">
<h1>No page for this parcel</h1>
<p>FactLot has no public page at this address. A parcel gets a page only when it is hosted and its sources allow their data to be republished. <a href="${e(site)}/coverage/">Coverage</a> lists what is hosted; <a href="${e(site)}/try/">Try a lookup</a> searches it.</p>
</div>
</section>
</main>
</body>
</html>
`,
  );
}

// --- sitemaps --------------------------------------------------------------------------------------

const xmlEscape = (s: string): string => escapeHtml(s);

async function indexResponse(
  registry: Fetcher,
  site: string,
  extra: ReadonlySet<string>,
): Promise<Response> {
  const q = extra.size
    ? `?extra=${encodeURIComponent([...extra].join(","))}`
    : "";
  const { status, body } = await call(registry, `/pages/index${q}`);
  if (status !== 200) throw new Unavailable("registry");
  const b = body as {
    built_at?: string;
    files?: { db: string; group: number }[];
  };
  const lastmod = (b.built_at ?? "").slice(0, 10);
  const files = (b.files ?? []).slice(0, SITEMAP_MAX_URLS);
  return xmlResponse(`<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${files
  .map(
    (f) =>
      `  <sitemap><loc>${xmlEscape(`${site}/sitemaps/properties/${f.db}-${f.group}.xml`)}</loc>${/^\d{4}-\d{2}-\d{2}$/.test(lastmod) ? `<lastmod>${lastmod}</lastmod>` : ""}</sitemap>`,
  )
  .join("\n")}
</sitemapindex>
`);
}

async function childResponse(
  registry: Fetcher,
  db: string,
  group: number,
  site: string,
  extra: ReadonlySet<string>,
): Promise<Response> {
  const q = new URLSearchParams({ db, group: String(group) });
  if (extra.size) q.set("extra", [...extra].join(","));
  const { status, body } = await call(registry, `/pages/sitemap?${q}`);
  if (status === 404) return notFoundPage(site);
  if (status !== 200) throw new Unavailable("registry");
  const urls = (
    ((body as { urls?: unknown[] })?.urls ?? []) as {
      urn?: string;
      lastmod?: string | null;
    }[]
  )
    .flatMap((u) => {
      const path = typeof u.urn === "string" ? propertyPath(u.urn) : null;
      return path && !withheldRegion(regionOf(u.urn!))
        ? [{ path, lastmod: u.lastmod ?? null }]
        : [];
    })
    .slice(0, SITEMAP_MAX_URLS);
  return xmlResponse(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls
  .map(
    (u) =>
      `  <url><loc>${xmlEscape(site + u.path)}</loc>${u.lastmod && /^\d{4}-\d{2}-\d{2}$/.test(u.lastmod) ? `<lastmod>${u.lastmod}</lastmod>` : ""}</url>`,
  )
  .join("\n")}
</urlset>
`);
}
