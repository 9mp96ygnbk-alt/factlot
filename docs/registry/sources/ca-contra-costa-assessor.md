# ca-contra-costa-assessor — Contra Costa County, California (FIPS 06013)

Review record for the Assessor's free parcel file. **Result: the free file is real and current but
carries only APN and situs, so the commercial scope (B/F1/F2) cannot be derived from it. Status:
`verified: false`, no adapter. Nothing in the file was loaded into a registry.** Config:
`registry/sources/ca/ca-contra-costa-assessor.json`. Reviewed 2026-11-03.

## Publisher and URLs

- Publisher: Contra Costa County Assessor, files served by the county GIS group at
  https://gis.cccounty.us/Downloads/ (an IIS directory listing; folders `Assessor`, `AutoCAD Files`,
  `General County Data`, `Planning`).
- The Assessor's page "Maps & Property Information" (https://www.contracosta.ca.gov/552/Maps-Property-Information,
  quoted from a search-engine summary because the host blocks automated clients, see Gates) says the
  Assessor's Parcel shapefile "and other data is updated monthly and free to download" and links to this
  download site; it adds that online parcel maps are free and that property characteristics through
  ParcelQuest Lite cost $7.50 per parcel (same source).
- File: https://gis.cccounty.us/Downloads/Assessor/Parcels_Public_September2026.zip, 42,044,982 bytes,
  `Last-Modified: Fri, 02 Oct 2026 19:32:17 GMT`. Downloaded once (under the review's 50 MB limit) and
  inspected; not archived through the collector.
- Other folders: `General County Data` has `CCC_DOIT_AddressData.zip` (25 MB, 2025-10-31; address points)
  and base-map layers; `Planning` has city limits, general plan land-use element, zoning (2026-07-04). None
  carries assessor use codes.

## Terms, license, robots

- Terms: `Data Disclaimer.pdf` in each folder (read 2026-11-03), headed "Contra Costa County Disclaimer
  of Liability and Warranties". Operative sentence: "User agrees to take the data 'as is,' fully expecting
  that there may well be errors and omissions in the data obtained from County." It disclaims warranties and
  waives claims against the county. It neither grants nor restricts redistribution and does not address AI use.
- Licence: none stated. Redistribution and AI use: not addressed.
- robots.txt on `gis.cccounty.us`: `User-agent: * / Disallow: /arcgis/* / Disallow: /portal/*`; `/Downloads/`
  is allowed. `www.contracosta.ca.gov` (robots.txt included) answers HTTP 403 with a Cloudflare "Attention
  Required" page to the collector's user agent.

## What the file contains

`Parcels_Public.shp` (157.8 MB unpacked polygons, NAD 1983 StatePlane California III feet per the `.prj`) with `Parcels_Public.dbf`
of **387,936 records**, 387,593 distinct APNs, 386,520 with a street name. UTF-8. Ten attribute fields only:

| Field                                                                                           | Meaning                                                                   |
| ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `APN` (9 digits, `001011005`), `APN_CHECK`                                                      | parcel number and check digit                                             |
| `S_STR_NM`, `S_STR_SUF`, `S_STR_NBR`, `S_FRAC`, `S_APT_NBR`, `S_CTY_ABBR`, `S_ZIP`, `S_ZIP_EXT` | situs street name, suffix, number, fraction, unit, city abbreviation, ZIP |

No use code, no assessed values, no land or building area, no owner name or mailing address. Public record
fields such as owner names are not in any free file.

## Gates (need a person)

1. **No file with use codes is free.** The secured roll with use codes, or the property characteristics file,
   has to be requested from the Assessor (https://www.contracosta.ca.gov/assessor, which the collector cannot
   read: Cloudflare challenge), with its price and whether the county permits republication. The price and order
   route were not found in a public page reachable by the collector.
2. The statement quoted above, from the Assessor's "Maps & Property Information" page, needs a person in a browser to confirm.

## Real run

None. The free file was inspected only (record count, field list, distinct APNs, situs coverage). With no use
code, zero commercial parcels can be identified, so no registry was built.

## Known gaps

- Everything beyond APN and situs.
- Contra Costa has no county open-data portal listing assessor attributes; Hub search was not available.
