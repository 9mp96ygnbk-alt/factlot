/**
 * Addresses factlot.com used to serve (/buildings/…, /markets/…, /questions/…, /search, /for-ai)
 * that crawlers still request. Nothing else is touched.
 *
 * The rent pages those addresses carried are now on the sister site FactLease, so an address whose
 * page exists there goes there: the three section pages (as the earlier site sent them), and the
 * city and ZIP pages in legacy-factlease.ts, a list read from FactLease's sitemaps. /search and
 * /for-ai go to the pages that took their place. Every other old address goes to the most
 * specific page this site builds: a Texas county page, the Texas hub, a market page or /coverage/.
 *
 * A target is a fixed string or an entry of that list, looked up, never text taken from the
 * request, so no address can be made to redirect anywhere else.
 */
import { FACTLEASE_PAGES } from "./legacy-factlease.ts";

const FACTLEASE = "https://factlease.com";

/** The old section pages, and where the earlier site sent each. */
const SECTION = new Map([
  ["buildings", `${FACTLEASE}/buildings`],
  ["questions", `${FACTLEASE}/questions`],
  ["markets", `${FACTLEASE}/`],
]);

/** Old utility pages and the pages that took their place. */
const REPLACED = new Map([
  ["search", "/try/"],
  ["for-ai", "/connect/"],
]);

/** FactLease's city and ZIP pages, each under the old factlot.com path that named it. */
const SISTER = new Map<string, string>(
  FACTLEASE_PAGES.urls.map((url) => [
    `/markets${url.slice(FACTLEASE.length)}`,
    url,
  ]),
);

const COVERAGE = "/coverage/";
const TEXAS = "/texas/";

/** Old place names that have a county page. */
const TEXAS_COUNTY_PAGE: Record<string, string> = {
  houston: "/texas/harris/",
  harris: "/texas/harris/",
  dallas: "/texas/dallas/",
  austin: "/texas/travis/",
  travis: "/texas/travis/",
};

/** Other Texas places (cities and counties) an old address may name. */
const TEXAS_PLACES = new Set([
  "texas",
  "tx",
  "san-antonio",
  "fort-worth",
  "el-paso",
  "plano",
  "irving",
  "arlington",
  "frisco",
  "mckinney",
  "denton",
  "collin",
  "williamson",
  "round-rock",
  "georgetown",
  "cameron",
  "brownsville",
  "nueces",
  "corpus-christi",
  "galveston",
  "jefferson",
  "beaumont",
  "brazos",
  "college-station",
  "bryan",
  "midland",
  "ector",
  "odessa",
  "grayson",
  "sherman",
  "guadalupe",
  "seguin",
  "kaufman",
  "bexar",
  "tarrant",
  "richardson",
  "the-woodlands",
  "sugar-land",
  "katy",
  "pasadena",
]);

/** Old place names that have a market page outside Texas. */
const MARKET_PAGE: Record<string, string> = {
  "new-york": "/new-york-city/",
  "new-york-city": "/new-york-city/",
  nyc: "/new-york-city/",
  manhattan: "/new-york-city/",
  brooklyn: "/new-york-city/",
  "los-angeles": "/los-angeles/",
  "san-francisco": "/san-francisco/",
  boston: "/boston/",
  denver: "/denver/",
  connecticut: "/connecticut/",
};

const has = (slug: string, place: string) => `-${slug}-`.includes(`-${place}-`);

/** The most specific live page for a place or question slug. */
function placeTarget(slug: string): string {
  for (const [place, target] of Object.entries(TEXAS_COUNTY_PAGE))
    if (has(slug, place)) return target;
  for (const place of TEXAS_PLACES) if (has(slug, place)) return TEXAS;
  for (const [place, target] of Object.entries(MARKET_PAGE))
    if (has(slug, place)) return target;
  return COVERAGE;
}

/** Where a retired address now lives, or undefined when the path is not a retired family. */
export function legacyRedirect(path: string): string | undefined {
  const lower = path.toLowerCase();
  const whole = lower.replace(/\/$/, "");
  const [, family, slug = ""] = lower.split("/");
  // A page by its whole address: a section page, a replaced page, or a page FactLease has.
  if (whole === `/${family}`) {
    const to = SECTION.get(family ?? "") ?? REPLACED.get(family ?? "");
    if (to) return to;
  }
  const sister = SISTER.get(whole);
  if (sister) return sister;
  if (family === "buildings") return COVERAGE;
  if (family === "markets" || family === "questions")
    return slug ? placeTarget(slug) : COVERAGE;
  return undefined;
}
