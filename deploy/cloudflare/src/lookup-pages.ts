/**
 * Lookup pages: a commercial property's cited record at a web address, for a person with a browser, an
 * assistant that can only open a URL, or a crawler. No script, no key, no connector.
 *
 *   GET /lookup/?q=<address>[&state=&city=&zip=&county=]   search: the matches, or the one exact match's record
 *   GET /lookup/<county region>/<parcel id>                 the record of fl:parcel:<region>:<id> (the path scheme
 *                                                           of /property/, so the two differ in one word)
 *   GET /lookup/fl:parcel:<region>:<id>                     the same record by URN (redirects to the path above)
 *
 * Asked with `Accept: application/json` or `?format=json`, each answers the hosted API's own JSON instead.
 *
 * Every answer is the hosted API's own call, made as the caller: registry_search_address for a search and
 * registry_get for a record, sent back through the router with the caller's address and Authorization header
 * (`callApi`). So a lookup page is counted, given back, limited per minute and cut to the free view exactly as
 * that API call is, on the same meters: this module holds no meter and reads no record on its own. A search
 * that finds one parcel under the batch lookup's rule (`lookupItem` of @factlot/tools: one exact match, never
 * picked across counties) sends the browser to its record; any other lists what was found. A record that has
 * a public property page is sent there, uncounted: that page is free for everyone already. Whether it has
 * one is asked of the property pages' own route, on the caller's per-minute allowance of property pages;
 * when that is used up the record is looked up as any other is, and counted (never an under-charge).
 *
 * These pages are answers to a request, not published pages: `noindex`, `Cache-Control: no-store`, in no
 * sitemap. The address searched is in the page address, so every answer says `Referrer-Policy: no-referrer`,
 * the query is capped, and it is written into a page only through `escapeHtml`. A key is never read from a
 * page address: a request that carries one there is refused before anything is looked up.
 */
import { lookupItem, type LookupItem } from "@factlot/tools";

import {
  factsOf,
  parcelPageRefs,
  propertyPath,
  urnOfPropertyPath,
  type Fact,
  type PageRecord,
  type SourceRef,
} from "../../registry/src/page-rules.ts";

import { CONTACT } from "./contact.ts";
import { limitHistory, limitSales } from "./gating.ts";
import { escapeHtml } from "./html.ts";
import { innerRequest } from "./internal.ts";
import {
  ANONYMOUS_REGISTRY_LOOKUPS_PER_DAY,
  FREE_KEY_ADDRESS_LOOKUPS_PER_DAY,
  LOOKUP_RULE,
  PLANS,
  PRICING_URL,
} from "./plans.ts";
import {
  TRANSFER_PREDICATES,
  factRefs,
  headingAddress,
  renderPropertyPage,
} from "./property-pages.ts";
import { withheldCounty } from "./property-sheet.ts";
import {
  headLinks,
  siteFooter,
  siteHeader,
} from "../../../scripts/site/shell.mjs";

type Json = Record<string, unknown>;

/** The longest address a lookup page searches. */
export const LOOKUP_MAX_QUERY = 200;
/** The place fields a search takes, the registry_search_address input each fills, and its cap. */
const PLACE_FIELDS = [
  ["state", "state", 40],
  ["city", "city", 100],
  ["zip", "postal_code", 10],
  ["county", "county_fips", 5],
] as const;
/**
 * A query parameter whose name looks like a credential (key, x-api-key, access-token, client_secret,
 * auth, password, bearer, ...): a request carrying one is refused, and its value is never echoed.
 */
const CREDENTIAL_PARAM = /key|token|secret|auth|passw|bearer/i;
/** The query parameters a search reads, the only ones a link built from a request carries. */
const SEARCH_PARAMS = ["q", ...PLACE_FIELDS.map(([param]) => param)] as const;
/** The API's answer headers a lookup answer passes on. */
const PASSED_HEADERS = [
  "retry-after",
  "x-ratelimit-limit",
  "x-factlot-tier",
  "x-factlot-registry-quota-limit",
  "x-factlot-registry-quota-remaining",
  "x-factlot-registry-quota-reset",
];

/** No script and no inline style; the one form on these pages posts nowhere but /lookup/. */
export const LOOKUP_PAGE_CSP = [
  "default-src 'none'",
  "style-src 'self'",
  "font-src 'self'",
  "img-src 'self'",
  "script-src 'none'",
  "connect-src 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
].join("; ");

export interface LookupDeps {
  site: string;
  /** POST a registry REST path of the hosted API as this caller (the router, re-entered). */
  callApi: (path: string, input: unknown) => Promise<Response>;
  /** The path of a parcel's public property page, when it has one. */
  publicPage: (urn: string) => Promise<string | null>;
  /** County names and states by region, as registry_coverage gives them. */
  places: () => Promise<Map<string, { name: string; state: string }>>;
  /** The source id of each cited document, for the sources' own notices. */
  sourceIds: (refs: SourceRef[]) => Promise<Record<string, string | null>>;
  /** Whether a free key by email is on offer (FREE_KEY_ENABLED). */
  freeKey: boolean;
}

/**
 * A POST to a registry REST path of the hosted API carrying only what identifies the caller: their
 * Authorization header and Cloudflare's client address. The router answers it as theirs, as it
 * answers the property sheet's own call (property-sheet.ts). Built with innerRequest, so it has
 * the Host header a Request built in a Worker lacks.
 */
export function asLookupCaller(
  request: Request,
  apiBase: string,
  path: string,
  input: unknown,
): Request {
  const headers = new Headers({
    "content-type": "application/json",
    accept: "application/json",
  });
  for (const h of ["authorization", "cf-connecting-ip", "user-agent"]) {
    const v = request.headers.get(h);
    if (v !== null) headers.set(h, v);
  }
  return innerRequest(`${apiBase}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(input),
  });
}

export const isLookupPath = (path: string): boolean =>
  path === "/lookup" || path.startsWith("/lookup/");

/** /lookup/us-48201/0011440000001 for fl:parcel:us-48201:0011440000001. */
export function lookupPath(urn: string): string | null {
  const p = propertyPath(urn);
  return p ? `/lookup${p.slice("/property".length)}` : null;
}

const e = (v: unknown): string => escapeHtml(String(v));
const int = new Intl.NumberFormat("en-US");

function headersOf(type: string, extra: Record<string, string> = {}): Headers {
  return new Headers({
    "content-type": type,
    "cache-control": "no-store",
    "referrer-policy": "no-referrer",
    "x-robots-tag": "noindex",
    "x-content-type-options": "nosniff",
    ...extra,
  });
}

const htmlHeaders = (extra: Record<string, string> = {}): Headers =>
  headersOf("text/html; charset=utf-8", {
    "content-security-policy": LOOKUP_PAGE_CSP,
    "x-frame-options": "DENY",
    ...extra,
  });

/** The API's headers a lookup answer keeps (the quota and the retry time). */
function passed(res: Response): Record<string, string> {
  const out: Record<string, string> = {};
  for (const h of PASSED_HEADERS) {
    const v = res.headers.get(h);
    if (v !== null) out[h] = v;
  }
  return out;
}

function redirect(to: string): Response {
  const headers = headersOf("text/plain; charset=utf-8", { location: to });
  return new Response(`See ${to}\n`, { status: 303, headers });
}

function parse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** One line of text, trimmed, white space collapsed. */
const clean = (v: string | null): string =>
  (v ?? "").replace(/\s+/g, " ").trim();

// --- the page shell ----------------------------------------------------------------------------------

function shell(title: string, main: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="color-scheme" content="light dark" />
<title>${e(title)} · FactLot</title>
<meta name="robots" content="noindex" />
<link rel="icon" href="/favicon.svg" type="image/svg+xml" />
${headLinks()}
<link rel="stylesheet" href="/styles.css" />
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
${siteHeader()}
<main id="main">
<section aria-labelledby="page-title">
<div class="wrap doc lookup">
${main}
</div>
</section>
</main>
${siteFooter()}
</body>
</html>
`;
}

/** The search form: a GET to /lookup/, so it works with scripts off. */
function form(q = "", state = ""): string {
  return `<form class="try-form lookup-form" action="/lookup/" method="get">
<label for="lookup-q">Property address</label>
<div class="try-row">
<input id="lookup-q" name="q" type="text" value="${e(q)}" maxlength="${LOOKUP_MAX_QUERY}" required autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="1000 Louisiana St, Houston" aria-describedby="lookup-hint" />
<input class="try-state" name="state" type="text" value="${e(state)}" maxlength="40" autocomplete="off" placeholder="TX" aria-label="State (optional)" />
<button class="button primary" type="submit">Look up</button>
</div>
<p id="lookup-hint" class="small">A house number and street, with the city or ZIP code when you know it. Commercial, industrial and multifamily parcels only; a city alone matches nothing.</p>
</form>`;
}

const STANDING = `<p class="small">A record shown here is a public-record fact as its publisher released it. It is not an appraisal or an opinion of value, not legal or tax advice, and not a substitute for checking the source. If a record names you as a person, or is wrong, email <a href="mailto:${CONTACT}">${CONTACT}</a> and we will remove or correct it.</p>`;

const crumbs = (last: string): string =>
  `<p class="small breadcrumbs"><a href="/">FactLot</a> › <a href="/lookup/">Look up a property</a>${last ? ` › ${e(last)}` : ""}</p>`;

function htmlPage(
  status: number,
  title: string,
  main: string,
  extra: Record<string, string> = {},
): Response {
  return new Response(shell(title, main), {
    status,
    headers: htmlHeaders(extra),
  });
}

// --- what the API said, in a page's words ----------------------------------------------------------------

/**
 * Who a lookup was counted for, from the API's tier header and whether the request sent a key. The
 * tier is "anonymous" for a free key too; a free sign-in connection cannot reach these pages (its
 * token is honoured on /mcp only), so a key sent with an anonymous answer is a free key.
 */
type Caller = "no-key" | "free-key" | "paid";
const callerOf = (headers: Record<string, string>, keyed: boolean): Caller =>
  (headers["x-factlot-tier"] ?? "anonymous") !== "anonymous"
    ? "paid"
    : keyed
      ? "free-key"
      : "no-key";

/**
 * "12 of 25 free registry lookups left today for your IP address (they reset at …)", from the API's
 * headers, in the words of the allowance that caller is counted on (plans.ts: QUOTA_RULES.free,
 * FREE_KEY_NOTE, QUOTA_RULES.paid). For a free key the answer reports the key's own day count, or the
 * ceiling shared by the free keys of one address when that is the one that ran short.
 */
function quotaLine(headers: Record<string, string>, keyed: boolean): string {
  const left = Number(headers["x-factlot-registry-quota-remaining"]);
  const limit = Number(headers["x-factlot-registry-quota-limit"]);
  const reset = headers["x-factlot-registry-quota-reset"];
  if (!Number.isFinite(left) || !Number.isFinite(limit)) return "";
  const at = /^(\d{4}-\d\d-\d\d)T(\d\d:\d\d)/.exec(reset ?? "");
  const when = at ? `${at[2]} UTC on ${at[1]}` : reset;
  const caller = callerOf(headers, keyed);
  const whose =
    caller === "paid"
      ? "registry lookups left this month for this key's subscription, shared by all of its keys"
      : caller === "no-key"
        ? "free registry lookups left today for your IP address"
        : limit === FREE_KEY_ADDRESS_LOOKUPS_PER_DAY
          ? "free registry lookups left today for all the free keys used from your IP address together"
          : `free registry lookups left today for this free key (the free keys used from one IP address together are held to ${int.format(FREE_KEY_ADDRESS_LOOKUPS_PER_DAY)} a day)`;
  return `${e(int.format(left))} of ${e(int.format(limit))} ${e(whose)}${when ? ` (they reset at ${e(when)})` : ""}.`;
}

/** Whether an answer that found nothing was counted, as the API marked it. */
function countedLine(body: Json | undefined): string {
  if (body?.counted === false)
    return "This search found nothing and was not counted as a lookup.";
  if (body?.counted === true)
    return typeof body.counted_note === "string"
      ? e(body.counted_note)
      : "This search was counted as a lookup.";
  return "";
}

const jsonLine = (href: string, tool: string): string =>
  `The same answer as JSON, for a program that can open a web address: <a href="${e(href)}" rel="nofollow"><code>${e(href)}</code></a> (the hosted API's <code>${tool}</code> answer).`;

/**
 * The JSON address of a search: its own parameters (q and the place fields) and format=json, nothing
 * else of the request's address, so no other parameter is ever written into a page.
 */
function searchJsonHref(url: URL): string {
  const u = new URLSearchParams();
  for (const p of SEARCH_PARAMS) {
    const v = clean(url.searchParams.get(p));
    if (v !== "") u.set(p, v);
  }
  u.set("format", "json");
  return `/lookup/?${u.toString()}`;
}

/** The JSON address of a record: its path and format=json. */
const recordJsonHref = (urn: string): string =>
  `${lookupPath(urn)}?format=json`;

/** The answer to a request whose address carries a parameter named like a credential, else null. */
export function credentialInAddress(url: URL, json: boolean): Response | null {
  for (const k of url.searchParams.keys())
    if (CREDENTIAL_PARAM.test(k))
      return fail(
        json,
        400,
        "KeyInAddress",
        "A key does not go in a page address",
        "A FactLot key is sent in the Authorization header, never in a page address, where browsers and logs keep it. Nothing was looked up. If the key in that address is real, replace it from your account page.",
      );
  return null;
}

/**
 * A lookup address asked of the API host (a GET or HEAD): sent to the same address on the site host
 * with a 302 that carries the headers of every lookup answer (no-store, noindex, no-referrer). A
 * parameter named like a credential is refused first, so its value is never put in a Location header.
 */
export function lookupOnApiHost(
  request: Request,
  url: URL,
  site: string,
): Response {
  const refused = credentialInAddress(url, wantsJson(request, url));
  if (refused) return refused;
  const to = `${site}${url.pathname}${url.search}`;
  return new Response(null, {
    status: 302,
    headers: headersOf("text/plain; charset=utf-8", { location: to }),
  });
}

/** An answer of this module's own, as JSON or as a page. */
function fail(
  json: boolean,
  status: number,
  code: string,
  title: string,
  message: string,
  extra: Record<string, string> = {},
): Response {
  if (json)
    return new Response(
      JSON.stringify({
        error: code,
        code,
        message,
        next: "https://factlot.com/lookup/",
        issues: [],
      }),
      {
        status,
        headers: headersOf("application/json; charset=utf-8", extra),
      },
    );
  return htmlPage(
    status,
    title,
    `${crumbs("")}
<h1 id="page-title">${e(title)}</h1>
<p class="lede">${e(message)}</p>
${form()}
<p><a href="/coverage/">Coverage: every county and what is hosted</a></p>`,
    extra,
  );
}

/** The API refused or could not answer: its own words, and what to do, as a page with its status. */
function apiErrorPage(
  res: Response,
  body: Json | undefined,
  deps: LookupDeps,
  q: string,
  state: string,
  keyed: boolean,
): Response {
  const headers = passed(res);
  const code = String(body?.code ?? body?.error ?? "");
  const message =
    typeof body?.message === "string" && body.message !== ""
      ? body.message
      : `The lookup was answered with status ${res.status}.`;
  const anonymous = (headers["x-factlot-tier"] ?? "anonymous") === "anonymous";
  let title: string;
  let more = "";
  let status = res.status;
  if (code === "RegistryQuotaExceeded") {
    title = anonymous
      ? "Today's free lookups are used up"
      : "This month's lookups are used up";
    more = `<ul>
${
  callerOf(headers, keyed) === "no-key" && deps.freeKey
    ? `<li>A <a href="/account#free-key">free key by email</a> counts lookups on its own meter, ${e(int.format(ANONYMOUS_REGISTRY_LOOKUPS_PER_DAY))} a day for the key, instead of one shared by everyone at your IP address.</li>\n`
    : ""
}<li>A Pro key gives ${e(int.format(PLANS.pro.registryLookupsPerMonth))} registry lookups a month, and Team ${e(int.format(PLANS.team.registryLookupsPerMonth))}: <a href="${e(PRICING_URL)}">pricing</a>.</li>
<li>A key is sent in the <code>Authorization</code> header, never in a page address, so it is used from the API or from an assistant: <a href="/connect/">connect</a>.</li>
<li>Calculators and the other tools keep working, and so do the public property pages.</li>
</ul>`;
  } else if (res.status === 429) {
    title = "Too many requests this minute";
    more = `<p>Wait a minute, then load this page again.</p>`;
  } else if (res.status === 401 || res.status === 403) {
    title = "The key sent with this request was not accepted";
  } else if (res.status === 400) {
    title = "This address could not be searched";
    const issues = Array.isArray(body?.issues) ? (body.issues as Json[]) : [];
    more = issues.length
      ? `<ul>\n${issues
          .slice(0, 8)
          .map(
            (i) =>
              `<li>${i.path ? `<code>${e(i.path)}</code>: ` : ""}${e(i.message ?? "")}</li>`,
          )
          .join("\n")}\n</ul>`
      : "";
  } else if (res.status === 404) {
    title = "This parcel is not in the hosted registry";
  } else {
    title = "The registry did not answer";
    status = res.status >= 500 ? 503 : res.status;
    more = `<p>Nothing was counted. Retry in a few seconds.</p>`;
  }
  return htmlPage(
    status,
    title,
    `${crumbs("")}
<h1 id="page-title">${e(title)}</h1>
<p class="lede">${e(message)}</p>
${more}
${form(q, state)}
<p><a href="/coverage/">Coverage: every county and what is hosted</a> · <a href="/pricing/">Plans and limits</a></p>`,
    headers,
  );
}

/** The API's answer, as it gave it, for a caller that asked for JSON. */
async function passJson(res: Response): Promise<Response> {
  return new Response(await res.text(), {
    status: res.status,
    headers: headersOf("application/json; charset=utf-8", passed(res)),
  });
}

// --- search ----------------------------------------------------------------------------------------------

const REASON: Record<string, (n: string, counties: number) => string> = {
  several_places: (n, c) =>
    `${n} parcels in ${c} counties match this address, which names no city or ZIP code. Open the one you mean, or search again with the city, the ZIP code or the state.`,
  same_address: (n) =>
    `${n} parcels have this address exactly: separate accounts at one address. Open the one you mean.`,
  place_differs: () =>
    "The only parcel found at this street address is not shown in the place the address names. Open it if it is the one you mean, or check the address.",
  no_exact_match: (n) =>
    `${n} parcels match this address and none has it exactly. Open the one you mean, or search a fuller address.`,
};

function regionOf(urn: unknown): string {
  return /^fl:parcel:([a-z0-9-]+):/.exec(String(urn))?.[1] ?? "";
}

/** One match: its label as the heading, what tells it from its neighbours as readouts, a link to its record. */
function matchCard(
  r: Json,
  places: Map<string, { name: string; state: string }>,
): string {
  const region = regionOf(r.urn);
  const place = places.get(region);
  const where = place
    ? [place.name, place.state].filter(Boolean).join(", ")
    : region;
  const path = lookupPath(String(r.urn));
  // The label as a property page heads it (a nine-digit ZIP after the county's own state as ZIP+4).
  const label = e(
    typeof r.label === "string"
      ? (headingAddress(r.label, place?.state ?? "") ?? r.label)
      : r.urn,
  );
  const rows: [string, string][] = [["County", e(where)]];
  if (typeof r.account === "string" && r.account !== "")
    rows.push(["Account", `<code>${e(r.account)}</code>`]);
  if (typeof r.property_category === "string" && r.property_category !== "")
    rows.push(["Category", e(r.property_category)]);
  if (typeof r.use_code === "string" && r.use_code !== "")
    rows.push(["Use code", e(r.use_code)]);
  if (typeof r.improvement_area_sf === "number")
    rows.push([
      "Building area",
      `${e(int.format(Math.round(r.improvement_area_sf)))} sq ft`,
    ]);
  else if (r.land_only === true) rows.push(["Building area", "land only"]);
  if (typeof r.unit === "string" && r.unit !== "")
    rows.push(["Unit", e(r.unit)]);
  return `<li class="match">
<h2>${path ? `<a href="${e(path)}" rel="nofollow">${label}</a>` : label}</h2>
<p class="match-urn">${e(r.urn)}</p>
<dl>
${rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join("\n")}
</dl>
</li>`;
}

async function search(
  url: URL,
  json: boolean,
  keyed: boolean,
  deps: LookupDeps,
): Promise<Response> {
  const q = clean(url.searchParams.get("q"));
  const state = clean(url.searchParams.get("state"));
  if (q === "") {
    if (json)
      return fail(
        true,
        400,
        "InputError",
        "",
        "give the address as q, for example /lookup/?q=1000+Louisiana+St&state=TX",
      );
    return htmlPage(
      200,
      "Look up a property",
      `${crumbs("")}
<h1 id="page-title">Look up a commercial property</h1>
<p class="lede">Type an address in a hosted county and get the public record: the parcel, its roll values, its owner of record when that is an organisation, each with the file it was read from.</p>
${form()}
<p class="small">A search is one registry lookup and opening a record is another, of the ${e(int.format(ANONYMOUS_REGISTRY_LOOKUPS_PER_DAY))} a day the free tier allows per IP address. ${e(LOOKUP_RULE)} A record that has a public page costs nothing.</p>
<p class="small">For a program: the same addresses answer JSON with <code>?format=json</code> or <code>Accept: application/json</code>, for example <code>/lookup/?q=1000+Louisiana+St&amp;state=TX&amp;format=json</code>.</p>
<p><a href="/coverage/">Coverage: every county and what is hosted</a> · <a href="/try/">Try a lookup</a> · <a href="/connect/">Connect an assistant</a></p>`,
    );
  }
  if (q.length > LOOKUP_MAX_QUERY)
    return fail(
      json,
      400,
      "InputError",
      "That address is too long",
      `An address of at most ${LOOKUP_MAX_QUERY} characters can be searched.`,
    );
  const item: LookupItem = { address: q };
  for (const [param, field, max] of PLACE_FIELDS) {
    const v = clean(url.searchParams.get(param));
    if (v === "") continue;
    if (v.length > max)
      return fail(
        json,
        400,
        "InputError",
        "That search could not be read",
        `${param} can be at most ${max} characters.`,
      );
    item[field] = v;
  }

  // The batch lookup's rule for one address: it names the search to run, then says which parcel,
  // if any, the answer picks.
  const rule = lookupItem(item, 0);
  const first = rule.next();
  if (first.done)
    return fail(
      json,
      400,
      "InputError",
      "That search could not be read",
      String(
        ((first.value as Json).error as Json | undefined)?.message ??
          "check the address",
      ),
    );
  const res = await deps.callApi(
    "/v1/registry/search_address",
    first.value.input,
  );
  if (json) return passJson(res);
  const body = parse(await res.text()) as Json | undefined;
  if (res.status !== 200 || !body || typeof body !== "object")
    return apiErrorPage(res, body, deps, q, state, keyed);
  const headers = passed(res);
  const step = rule.next({ ok: true, result: body } as never);
  if (!step.done) {
    // One parcel under the rule: its record (the public page when it has one).
    const urn = String((step.value.input as Json).urn);
    const to = (await deps.publicPage(urn)) ?? lookupPath(urn);
    if (to) return new Response(null, redirectInit(to, headers));
  }
  const entry = (step.done ? step.value : {}) as Json;
  const results = (Array.isArray(body.results) ? body.results : []) as Json[];
  const quota = quotaLine(headers, keyed);
  const asJson = jsonLine(searchJsonHref(url), "registry_search_address");

  if (results.length === 0) {
    const cov = (body.coverage ?? {}) as Json;
    const message =
      typeof cov.message === "string" && cov.message !== ""
        ? cov.message
        : "no parcel matched";
    const nearest = (
      Array.isArray(cov.nearest_house_numbers) ? cov.nearest_house_numbers : []
    ).filter((n): n is number => typeof n === "number");
    const street = typeof cov.street === "string" ? cov.street : "";
    const covState = typeof cov.state === "string" ? cov.state : state;
    const again =
      nearest.length && street
        ? `<p>Nearest numbers held on ${e(street)}: ${nearest
            .slice(0, 6)
            .map((n) => {
              const u = new URLSearchParams({ q: `${n} ${street}` });
              if (covState) u.set("state", covState);
              return `<a href="/lookup/?${e(u.toString())}" rel="nofollow">${e(n)} ${e(street)}</a>`;
            })
            .join(", ")}.</p>`
        : "";
    const loaded = (
      Array.isArray(cov.loaded_states) ? cov.loaded_states : []
    ).filter((s): s is string => typeof s === "string");
    return htmlPage(
      200,
      `No parcel found for ${q}`,
      `${crumbs("No match")}
<h1 id="page-title">No parcel found for “${e(q)}”</h1>
<p class="lede">${e(message.charAt(0).toUpperCase() + message.slice(1))}.</p>
${again}
${loaded.length && cov.state_loaded === false ? `<p>States this registry holds: ${e(loaded.join(", "))}.</p>` : ""}
<p class="small lookup-note">${[countedLine(body), quota, asJson].filter(Boolean).join(" ")}</p>
${form(q, state)}
<p><a href="/coverage/">Coverage: every county and what is hosted</a></p>`,
      headers,
    );
  }

  const places = await deps.places();
  const more = results.length >= Number(first.value.input.limit ?? 20);
  const n = `${results.length}${more ? " or more" : ""}`;
  const counties = new Set(results.map((r) => regionOf(r.urn))).size;
  const why = REASON[String(entry.reason)]?.(n, counties) ?? "";
  return htmlPage(
    200,
    `Parcels matching ${q}`,
    `${crumbs("Matches")}
<h1 id="page-title">${e(n)} ${results.length === 1 ? "parcel matches" : "parcels match"} “${e(q)}”</h1>
<p class="lede">${e(why)}</p>
${form(q, state)}
<p class="small lookup-note">${["This search is one registry lookup; opening a record is another, unless the parcel has a public page.", quota, asJson].filter(Boolean).join(" ")}</p>
<ol class="matches">
${results.map((r) => matchCard(r, places)).join("\n")}
</ol>
${STANDING}`,
    headers,
  );
}

function redirectInit(to: string, extra: Record<string, string>): ResponseInit {
  return {
    status: 303,
    headers: headersOf("text/plain; charset=utf-8", { ...extra, location: to }),
  };
}

// --- a record --------------------------------------------------------------------------------------------

async function record(
  url: URL,
  urn: string,
  json: boolean,
  keyed: boolean,
  deps: LookupDeps,
): Promise<Response> {
  const reason = withheldCounty(urn);
  if (reason)
    return fail(
      json,
      404,
      "CountyWithheld",
      "This county is not served",
      `This parcel's county is not served by the hosted registry: ${reason}. Nothing was counted.`,
    );
  // A parcel with a public page is shown there, and nothing is counted: that page is free already.
  // (deps.publicPage answers null once the caller's property pages a minute are used up, so the
  // record is then looked up and counted below.)
  if (!json) {
    const to = await deps.publicPage(urn);
    if (to) return redirect(to);
  }
  const res = await deps.callApi("/v1/registry/get", { urn });
  if (json) return passJson(res);
  const body = parse(await res.text()) as Json | undefined;
  if (res.status !== 200 || !body || typeof body !== "object")
    return apiErrorPage(res, body, deps, "", "", keyed);
  // The page is the free view whoever asks: the current roll year and the newest sale or deed. No
  // value a paid key adds is ever written into a page. A free caller is told what a paid key adds;
  // a Pro or Team caller, whose key was charged for the full answer, is sent to its JSON address.
  const rec = limitSales(limitHistory(body)) as PageRecord;
  if (rec?.urn !== urn)
    return fail(
      false,
      502,
      "LookupUnreadable",
      "The registry did not answer",
      "The registry answered with something that is not this parcel's record. Retry in a few seconds.",
    );
  const headers = passed(res);
  const paid = callerOf(headers, keyed) === "paid";
  const region = regionOf(urn);
  const place = (await deps.places()).get(region) ?? {
    name: region,
    state: "",
  };
  const sale: Fact | undefined = factsOf(rec, TRANSFER_PREDICATES)[0];
  let sources: Record<string, string | null> = {};
  try {
    sources = await deps.sourceIds([
      ...parcelPageRefs(rec),
      ...(sale ? factRefs(sale, urn) : []),
    ]);
  } catch {
    sources = {};
  }
  const html = renderPropertyPage({
    site: deps.site,
    rec,
    place: { region, ...place },
    entity: null,
    otherCount: null,
    links: [],
    sourceOf: (doc) => sources[doc] ?? null,
    sale: sale ?? null,
    lookup: {
      note: [
        "This record is one registry lookup.",
        quotaLine(headers, keyed),
        paid
          ? `This page shows the free view; this key's full answer is at <a href="${e(recordJsonHref(urn))}" rel="nofollow"><code>${e(recordJsonHref(urn))}</code></a> (the hosted API's <code>registry_get</code> answer, with the key sent in the <code>Authorization</code> header).`
          : jsonLine(recordJsonHref(urn), "registry_get"),
      ]
        .filter(Boolean)
        .join(" "),
      paid,
    },
  });
  return new Response(html, { status: 200, headers: htmlHeaders(headers) });
}

// --- the route -------------------------------------------------------------------------------------------

/** Whether the caller asked for the API's JSON and not a page. */
export function wantsJson(request: Request, url: URL): boolean {
  if (url.searchParams.get("format") === "json") return true;
  const accept = (request.headers.get("accept") ?? "").toLowerCase();
  return accept.includes("application/json") && !accept.includes("text/html");
}

/** `path`: the router's path (no trailing slash), which `isLookupPath` matched. */
export async function lookupRoute(
  request: Request,
  url: URL,
  path: string,
  deps: LookupDeps,
): Promise<Response> {
  const json = wantsJson(request, url);
  // Whether the caller sent a key (in the Authorization header, the only place one is read).
  const keyed = request.headers.has("authorization");
  if (request.method !== "GET" && request.method !== "HEAD")
    return new Response("Use GET.\n", {
      status: 405,
      headers: headersOf("text/plain; charset=utf-8", { allow: "GET, HEAD" }),
    });
  // A key is never read from a page address, and one that arrives in it is not looked up with.
  const refused = credentialInAddress(url, json);
  if (refused) return refused;
  // A HEAD (a link preview, a prefetch) is told what a GET would be, and looks nothing up.
  if (request.method === "HEAD")
    return new Response(null, {
      status: 200,
      headers: json
        ? headersOf("application/json; charset=utf-8")
        : htmlHeaders(),
    });

  const rest = path.slice("/lookup".length);
  if (rest === "") return search(url, json, keyed, deps);
  // By URN: the same record at its path.
  let name = rest.slice(1);
  try {
    name = decodeURIComponent(name);
  } catch {
    name = "";
  }
  if (name.startsWith("fl:")) {
    const to = lookupPath(name.toLowerCase());
    if (to)
      return redirect(
        `${to}${url.searchParams.get("format") === "json" ? "?format=json" : ""}`,
      );
  }
  const urn = urnOfPropertyPath(`/property${rest}`);
  if (!urn)
    return fail(
      json,
      404,
      "NotFound",
      "No such record address",
      "A record's address is /lookup/<county>/<parcel id>, for example /lookup/us-48201/0011440000001, or /lookup/ followed by the parcel's FactLot ID (fl:parcel:us-48201:0011440000001). To find a parcel by its address, search below.",
    );
  return record(url, urn, json, keyed, deps);
}
