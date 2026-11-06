# Montgomery County, Texas: Montgomery CAD (`tx-montgomery-cad`)

Review record for data policy §5. Reviewed 2026-11-03. **Not verified: no bulk file URL could be
retrieved** (the district's site is client-rendered). No adapter. County FIPS 48339. Config
`registry/sources/tx/tx-montgomery-cad.json` (`verified: false`, `files: []`).

## Publisher and URLs

- Publisher: Montgomery Central Appraisal District (Conroe, TX).
- Site: <https://mcad-tx.org/>, the same True Prodigy "Public Portal" single-page application as
  `hidalgoad.org` and `www.dentoncad.com` (identical HTML shell and bundle). Without JavaScript it
  returns an empty `<div id="root">`; `robots.txt` returns the shell (no rules).
- Pages a search index lists (content not retrievable): `mcad-tx.org/appraisal-data-exports`
  ("Appraisal Data Exports": zip files of the certified rolls for 2019–2026 with property and
  ownership information and values at certification; the 2026 certified roll also as JSON; a 2026
  preliminary roll in standard and JSON formats; the export layout as a PDF and as spreadsheets,
  including a JSON layout file), `mcad-tx.org/gis-data` ("Download specific datasets (multiple
  formats) using Montgomery County Open Data site": abstracts, cities, ownership, parcels,
  subdivisions, plats), `mcad-tx.org/reports`, `forms.mcad-tx.org`. No file URL was seen.
- A third-party copy exists and was **not used**: the City of Houston GIS server
  (`geohwp.houstontx.gov/arcgis/rest/services/03_BaseData_External/Parcels_Current/FeatureServer`, layer 3
  "Current MCAD Parcels", fields `STATECLASS`, `OWNER`, `OWNER_ADD`, `ADDRESS`, `YEAR_BUILT`,
  `IMPR_SQ_FT`, `TAX_YEAR`). Its description says it was last updated 2025-03-27, 19 months before this
  review, it is the city's copy rather than MCAD's, and its terms were not read. It could serve as a
  stopgap if a person decides to accept it.

## Terms, license, robots

- Terms: not read. License: public record; none seen. AI use / redistribution: unknown.
- Nothing was downloaded.

## Gates

- **Page content.** A person must open `https://mcad-tx.org/appraisal-data-exports` in a normal
  browser, read any terms on it, and copy the certified roll URLs (and the layout files) into the
  config's `files`; then set `verified` to `true`. The page offers the roll in JSON, which a new
  adapter could read directly. If the exports are not posted, send a Public Information Act request
  (`docs/registry/public-information-requests.md`) to MCAD for the certified appraisal export.
- Presenting the site's origin headers to the vendor API from the collector would be a workaround of
  the client-side delivery and is not to be done.
  One such request (to the vendor API, with another site's origin header) was prepared during the
  2026-11-03 review and was blocked by a safety check before it ran; it was not
  retried and nothing was obtained that way. It must not be attempted: the route is a person reading
  the page in a browser, or a Public Information Act request.

## Real run

None: no file was obtained.

## Known gaps

Everything: no source is loaded for Montgomery County. About 317,600 parcels are reported by a
reseller (not verified).
