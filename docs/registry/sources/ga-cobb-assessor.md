# ga-cobb-assessor: Cobb County, Georgia tax assessor parcels and ownership

Reviewed 2026-11-03. Status: **not verified (gated: purchase and terms)**; no adapter. FIPS 13067. Config:
[`registry/sources/ga/ga-cobb-assessor.json`](../../../registry/sources/ga/ga-cobb-assessor.json).

## Publisher and URLs

- Cobb County GIS (org `OpenData_CobbCountyGA`): Hub site `https://geo-cobbcountyga.hub.arcgis.com` (item
  `f0b894fb12444f26a0925ff41daed8b8`), "Get Data" page (Hub page item `9e9f789d5b2d4a26bbf091a50230d4d8`), ArcGIS
  Server `https://gis.cobbcounty.gov/gisserver/rest/services/` (folders `openData`, `cobbpublic`, `comdev`).
- Cobb County Board of Tax Assessors: `https://www.cobbassessor.org` (answers 403 to the collector; its
  `robots.txt` carries Cloudflare content signals).
- The Hub lists a Parcel Viewer web application (`e22d8c597b4e4762bcd2caa6127696e4`) but no parcel or ownership
  download. The open-data service folder holds roads, subdivisions, land lots, facilities, streams and future land use.
  A City of Smyrna copy of the 2023 parcels (`services2.arcgis.com/hE9igMm8RoNeQRbh/arcgis/rest/services/Cobb_Parcels/FeatureServer`)
  is third-party and was not reviewed.

## Terms, license, robots

- "Get Data" page (read from the page item): "Tax Assessor GIS Parcel Polygon Data. County parcels and subdivisions.
  Published annually (August) in accordance with the state-approved Tax Digest. Please Note Tabular Data (Ownership,
  Appraisal, Tax Bill, Etc. available by request)", priced "$54" to "$22,000" depending on the product line.
- Licence text on the same page: GIS data and imagery "are protected by United States copyright laws"; "You may not
  loan, rent, lease, sub-license or pledge Cobb County GIS data"; "You may not sell, trade, or bargain any computer
  files containing any of the GIS data"; "You may not reverse engineer, decompile, disassemble, or create derivative
  works without the express written permission of the Cobb County Government."
- AI use: not addressed. Redistribution: forbidden without written permission.
- robots.txt: `geo-cobbcountyga.hub.arcgis.com` `Crawl-delay: 60`; `gis.cobbcounty.gov` 404 (no rules);
  `www.cobbassessor.org` Cloudflare content signals, 403 to pages.

## What the file contains

Nothing was obtained. Georgia tax digests (class, land use, value, owner) are public under the Open Records Act, and
Cobb says the tabular ownership and appraisal data is "available by request"; the layout is unknown.

## Gates

- **Purchase and terms (a person).** Request the tabular digest (ownership, appraisal) from the Cobb Tax Assessor,
  and ask Cobb County GIS and the Tax Assessor for written permission to publish facts from it in an open registry.
  The assessor's site blocks automated clients, so any download is by hand.

## Real run

Not run.

## Known gaps

Everything: no file, no layout, no counts.
