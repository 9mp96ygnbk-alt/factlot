# factlot.com

The site is static HTML with no JavaScript, no framework, no external scripts or fonts, and no
tracking. The only `<script>` elements are `application/ld+json` blocks (schema.org data), which
the browser does not execute.

- `site/` holds the hand-written pages (`index.html`, `privacy.html`, `terms.html`, `404.html`),
  `styles.css`, icons, `robots.txt`, the IndexNow key file, and `llms.txt` (a copy of the
  repository's `llms.txt`; a test fails if they differ).
- `site/_content/` holds the prose for generated pages: `mcp.html`, `texas-protest-deadline.html`,
  and `calculators/` (one fragment per calculator page plus `manifest.json`).
- `scripts/site/build.mjs` copies `site/` without `_content/` and the `.md` notes, renders
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
