/**
 * Addresses factlot.com used to serve (/buildings/…, /markets/…, /questions/…) that crawlers
 * still request. Each maps to the most specific live page; nothing else is touched. The targets
 * are pages the site builds: the Texas hub and county pages, the market pages and /coverage/.
 */

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
  const [, family, slug = ""] = path.toLowerCase().split("/");
  if (family === "buildings") return COVERAGE;
  if (family === "markets" || family === "questions")
    return slug ? placeTarget(slug) : COVERAGE;
  return undefined;
}
