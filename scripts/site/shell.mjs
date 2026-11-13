// The page shell every FactLot page shares: the mark, the head links, the header with its
// navigation and the footer with the site map. The static site (build.mjs) and the pages the
// Worker renders (deploy/cloudflare/src/pages.ts, property-pages.ts) all call these, so a page
// cannot carry a different header, footer or font than the rest. Plain strings in, HTML out; every
// label here is a constant, and callers escape anything they pass in.

export const REPO = "https://github.com/9mp96ygnbk-alt/factlot";
export const CONTACT = "contact@factlot.com";

/**
 * A source's title as a page prints it. Some publishers' titles, as recorded, end with the file
 * name twice ("... export (Real_acct_owner.zip) (Real_acct_owner.zip)"); a parenthesised name that
 * directly repeats is printed once. Nothing else changes.
 */
export const sourceTitle = (title) =>
  String(title).replace(/(\(([^()]+)\))(?:\s*\(\2\))+/g, "$1");

/** The site navigation, in order. The last entry is drawn as the button. */
export const NAV = [
  ["/calculators/", "Calculators"],
  ["/mcp-server/", "MCP server"],
  ["/connect/", "Connect"],
  ["/coverage/", "Coverage"],
  ["/texas/", "Texas"],
  ["/pricing/", "Pricing"],
  [`${REPO}/blob/main/docs/getting-started.md`, "Docs"],
  ["/try/", "Try it"],
];

/** The trust package, in reading order: how it is run, what is promised, how numbers are proven. */
export const TRUST = [
  ["/status/", "Status"],
  ["/security/", "Security"],
  ["/sla/", "Service levels"],
  ["/assurance/", "Assurance"],
];

/** The places with a page of their own, as the footer lists them. */
export const PLACES = [
  ["/texas/", "Texas"],
  ["/new-york-city/", "New York City"],
  ["/los-angeles/", "Los Angeles"],
  ["/san-francisco/", "San Francisco"],
  ["/boston/", "Boston"],
  ["/denver/", "Denver"],
  ["/connecticut/", "Connecticut"],
];

export const FONT_SANS = "/fonts/instrument-sans-latin-wght-normal.woff2";
export const FONT_MONO = "/fonts/geist-mono-latin-wght-normal.woff2";

/** The mark: a lot outline with a monument on one corner. */
export const MARK =
  '<svg class="mark" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
  '<path class="lot" d="M4.5 7 17.5 4 20 17.5 6 20.5Z"/>' +
  '<circle class="mon" cx="17.5" cy="4" r="3"/></svg>';

/** A site path under `base` ("" on the site itself, the site's origin on another host). */
const at = (base, href) => (href.startsWith("/") ? `${base}${href}` : href);

/** What a page's head adds before the stylesheet: the text face, preloaded, and the browser chrome colours. */
export function headLinks(base = "") {
  return `<link rel="preload" href="${at(base, FONT_SANS)}" as="font" type="font/woff2" crossorigin />
<meta name="theme-color" content="#f4f1ea" media="(prefers-color-scheme: light)" />
<meta name="theme-color" content="#0d1114" media="(prefers-color-scheme: dark)" />`;
}

/**
 * The header. `current`: the path of the page, marked in the navigation. `base`: prefix for site
 * paths. `brandHref`: where the name links (the site's home by default). `nav`: other links than
 * the site's own, as [href, label] pairs.
 */
export function siteHeader({
  base = "",
  current = "",
  brandHref,
  nav = NAV,
} = {}) {
  const items = nav
    .map(
      ([href, label]) =>
        `<li><a href="${at(base, href)}"${href === current ? ' aria-current="page"' : ""}>${label}</a></li>`,
    )
    .join("\n");
  return `<header class="site-header">
<div class="wrap row">
<a class="brand" href="${brandHref ?? `${base}/`}" aria-label="FactLot home">${MARK}<span>FactLot</span></a>
<input type="checkbox" id="nav-toggle" class="nav-toggle" aria-label="Site menu" aria-controls="site-nav" />
<label for="nav-toggle" class="nav-button" aria-hidden="true">Menu</label>
<nav id="site-nav" aria-label="Site">
<ul>
${items}
</ul>
</nav>
</div>
</header>`;
}

const column = (title, links, base) => `<nav aria-label="${title}">
<h2>${title}</h2>
<ul>
${links.map(([href, label]) => `<li><a href="${at(base, href)}">${label}</a></li>`).join("\n")}
</ul>
</nav>`;

/** The footer. `stories`: the site has data stories to link. */
export function siteFooter({ base = "", stories = false } = {}) {
  return `<footer class="site-footer">
<div class="wrap">
<div class="foot-grid">
<div class="foot-brand">
<a class="brand" href="${base}/" aria-label="FactLot home">${MARK}<span>FactLot</span></a>
</div>
${column(
  "Product",
  [
    ["/try/", "Try a lookup"],
    ["/calculators/", "Calculators"],
    ["/mcp-server/", "MCP server"],
    ["/connect/", "Connect"],
    ["/pricing/", "Pricing"],
  ],
  base,
)}
${column(
  "Data",
  [
    ["/coverage/", "Coverage"],
    ...PLACES,
    ...(stories ? [["/data/", "Data stories"]] : []),
  ],
  base,
)}
${column(
  "Trust",
  [...TRUST, ["/privacy", "Privacy"], ["/terms", "Terms"]],
  base,
)}
${column(
  "Project",
  [
    [REPO, "GitHub"],
    [`${REPO}/blob/main/docs/getting-started.md`, "Docs"],
    [`mailto:${CONTACT}`, CONTACT],
  ],
  base,
)}
</div>
<div class="foot-legal">
<p><a href="${REPO}/blob/main/LICENSE">Apache-2.0 (platform) and MIT (schema and SDKs)</a></p>
<p class="small">"FactLot" and the FactLot logo are trademarks of their owner. The open-source licences cover the code, not the name.</p>
</div>
</div>
</footer>`;
}
