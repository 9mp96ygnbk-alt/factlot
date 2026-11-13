# factlot.com

The site is static HTML with no framework, no external scripts, stylesheets or fonts, and no
tracking. Its two typefaces are served from the site itself: Instrument Sans and Geist Mono, as
variable Latin `woff2` files in `site/fonts/`, each under the SIL Open Font License 1.1 with its
licence text beside it. The
`<script>` elements are `application/ld+json` blocks (schema.org data), which the browser does not
execute, and one same-origin file, `/try/try.js`, on the Try a lookup page (`/try/`). That page posts
to the Worker's own `/v1/registry/search_address` and `/v1/registry/get` routes on the page's origin,
and, when a visitor asks for the one-page sheet, to `/v1/reports`; it asks `/property/...` with
HEAD whether a parcel has a public page. It needs no CORS and no key, and the free tier meters it
like any other keyless caller. The build fails on any other script.

- `site/` holds the hand-written pages (`index.html`, `privacy.html`, `terms.html`, `404.html`),
  `styles.css`, `fonts/`, icons, `robots.txt`, the IndexNow key file, and `llms.txt` (a copy of the
  repository's `llms.txt`; a test fails if they differ).
- `scripts/site/shell.mjs` is the header, navigation and footer of every page. The build calls it,
  and so do the pages the Worker renders (account, onboarding and property pages), so they cannot
  differ. Those pages load the same `styles.css`; none carries a style of its own.
- `scripts/site/coverage-maps.mjs` draws the inset maps and `coverage/map-mini.svg` from the same
  county boundaries as the coverage map.
- `docs/assets/` holds the sources of `social-preview.png` (1200 by 630) and the README images.
  The icons are rasterised from `favicon.svg`.
- `site/_content/` holds the prose for generated pages: `mcp.html`, `try.html`, `texas-protest-deadline.html`,
  and `calculators/` (one fragment per calculator page plus `manifest.json`).
- `scripts/site/build.mjs` copies `site/` without `_content/` and the `.md` notes (and writes
  `styles.css` without its comments and indentation, which must come to 60,000 bytes or less), renders
  `/mcp/`, `/calculators/`, the calculator pages and the Texas deadline page, and writes
  `sitemap.xml` with each page's last commit date. Every number on a generated page is computed by
  the built packages and checked against a shared test vector. The build fails on a broken
  internal link, an external script or stylesheet, JSON-LD that does not parse, or a number that
  differs from its vector.

## Build and preview

```bash
npm run build && npm run build:site -- /tmp/factlot-site
python3 -m http.server 8000 --directory /tmp/factlot-site
# then open http://localhost:8000/
```

## Deploy

`npm run deploy:cloudflare` builds the packages and the site into `deploy/cloudflare/public`,
deploys the Worker that serves factlot.com and api.factlot.com, and then tells IndexNow which URLs
changed (`scripts/site/indexnow.mjs`). The old GitHub Pages address serves only a redirect to
factlot.com (`.github/workflows/pages.yml`).

## Adding a calculator page

1. Add an entry to `site/_content/calculators/manifest.json`: slug, tool, title, h1, description,
   the vector case to use as the worked example, the reconciliation workbook if one covers it, and
   related pages.
2. Write `site/_content/calculators/<slug>.html`: what it computes, method and conventions, inputs
   that matter, and limits, for a person rather than an agent.
3. Run the build. It fails if the case, the workbook or a related page does not exist.

## Checks

`npm test` includes `scripts/site/site.test.ts`, which fails when a calculator count or release
version written in `index.html` or `llms.txt` differs from the tool catalog or the packages. CI
runs the site build. Formatting is covered by `npm run format:check`.
