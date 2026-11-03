# Hidalgo County, Texas: Hidalgo CAD (`tx-hidalgo-cad`)

Review record for data policy §5. Reviewed 2026-11-03. **Not verified: no bulk file URL could be
retrieved** (the district's site is client-rendered). No adapter. County FIPS 48215. Config
`registry/sources/tx/tx-hidalgo-cad.json` (`verified: false`, `files: []`).

## Publisher and URLs

- Publisher: Hidalgo County Appraisal District (Edinburg, TX); customer service cs@hidalgoad.org,
  956-381-8466 (from a search-index copy of the Public Information Act page).
- Site: <https://www.hidalgoad.org/> (redirects to `hidalgoad.org`), a True Prodigy "Public Portal":
  the same single-page application (webpack bundle `index.35c0d8f9.js`, title "Public Portal") that
  serves `www.dentoncad.com` and `mcad-tx.org`. Fetched without JavaScript it returns an empty
  `<div id="root">`; in the desktop browser pane `/` and `/data-downloads` rendered blank after
  14 s, with no calls to a data API. The bundle's `config.json` says `{"env": "prod"}`, and the
  pages' content is loaded from a vendor API (`prod-container.trueprodigyapi.com`) that is keyed to the
  requesting site; no endpoint that lists downloads is documented.
- A search index lists `www.hidalgoad.org/data-downloads` ("Hidalgo County Appraisal District -
  Data Downloads"): Hidalgo CAD shapefiles, GIS data, school district and city map files; parcel
  and subdivision data exported monthly, joined to appraisal data, with a standalone appraisal
  DBF table and a schema reference; "Download Certified Exports" with a TYP mineral export that
  includes the appraisal roll. No file URL was seen. `hidalgoad.org/the-public-information-act/` and
  `esearch.hidalgoad.org` (Harris Govern eSearch at `propaccess.hidalgoad.org`) exist; property
  search is not a bulk source.

## Terms, license, robots

- Terms: not read (the page content cannot be retrieved). License: public record; none seen.
- robots.txt: `hidalgoad.org/robots.txt` returns the application shell (HTML), so there are no
  rules to apply.
- No data policy conflict arose; nothing was downloaded.

## Gates

- **Records access / page content.** A person must open `https://www.hidalgoad.org/data-downloads`
  in a normal browser, read any terms on it, and copy the download URLs (certified export, the
  monthly appraisal DBF, the TYP export) into the config's `files`; then set `verified` to `true`
  and the layout can be reviewed. If no certified roll is posted, send a Public Information Act
  request (`docs/registry/public-information-requests.md`) to cs@hidalgoad.org for the certified
  appraisal export in the district's native layout.
- Reaching the portal's API by presenting the site's own origin headers from the collector would be a
  workaround of the client-side delivery and is not to be done.
  One such request (to the vendor API, with another site's origin header) was prepared during the
  2026-11-03 review and was blocked by the session's own safety check before it ran; it was not
  retried and nothing was obtained that way. It must not be attempted: the route is a person reading
  the page in a browser, or a Public Information Act request.

## Real run

None: no file was obtained. Expected format: the TYP and DBF names suggest True Automation
exports; if the certified export is the "Appraisal Export Layout 8.0.x" family used by Travis,
Tarrant and El Paso, `tx_travis` (fixed-width Legacy 8.0.33) will probably read it, unconfirmed.

## Known gaps

Everything: no source is loaded for Hidalgo County, and its commercial parcel count is unknown.
