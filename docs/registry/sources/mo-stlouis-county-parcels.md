# mo-stlouis-county-parcels: St. Louis County, Missouri (FIPS 29189) Assessor tax parcels

Review date: 2026-11-03. Verdict: **gated: terms ("All rights reserved"; data requests go to the GIS Service Center). The public layer has owners, class, land use and values; `verified: false`; no adapter.**
Config: [`registry/sources/mo/mo-stlouis-county-parcels.json`](../../../registry/sources/mo/mo-stlouis-county-parcels.json).

## Publisher and URLs

- St. Louis County Assessor's Office and GIS Service Center (314-615-4GIS, `gis@stlouisco.com`). Geospatial Data Center (ArcGIS Hub): <https://gis.stlouiscountymo.gov/> (also `data.stlouisco.com`; robots `Crawl-delay: 60`).
  The hub lists 61 items; the parcel data appears only as apps ("Property Lookup", "Parcel Notification"), not as a downloadable dataset.
- Services: `https://maps.stlouisco.com/hosting/rest/services/Maps/AGS_OpenData/MapServer/7` ("Tax Parcels", 401,631 parcels, `maxRecordCount` 2000, copyright "St. Louis County GIS Service Center") and
  `.../Maps/AGS_Parcels/MapServer/0` (same fields, `maxRecordCount` 6000). A planning layer `STLCO_STC_Parcels_IND_` (services2.arcgis.com, 400,787 parcels) has land use and values but **no owner names**. `maps.stlouisco.com` has no robots.txt.
- The county website `www.stlouiscountymo.gov` (including `/robots.txt`) answers the collector with a Cloudflare "Just a moment..." challenge (HTTP 403); not worked around.

## Terms, license, robots

The licence text on every hub item: "St. Louis County makes no warranty for fitness of use for a particular purpose express or implied ... Do not make business decisions based on this data before validating your decision with the appropriate agency.
**Please direct all requests for St. Louis County GIS data to the GIS Service Center: 314-615-4GIS (4447) or gis@stlouisco.com. Copyright 2026 St. Louis County. All rights reserved.**" No licence to copy or redistribute is granted. AI use is not addressed.

## What the file contains

Fields: `LOCATOR` (parcel locator), `PARENT_LOC`, `TAXYR`, `OWNER_NAME` (present), `CAREOF`, `PROP_ADRNUM`, `PROP_ADD`, `PROP_ZIP`, `OWN_ADD`, `OWN_CITY`, `OWN_STATE`, `OWN_ZIP`, `ASSTLANDVAL`/`ASSTIMPVAL`/`TOTASSMT` (assessed), `APPLANDVAL`/`APPIMPVAL`/`TOTAPVAL`
(appraised), `PROPCLASS`, `LUC`/`LUCODE` (land use), `LANDUSE2/3`, `LIVUNIT`, `YEARBLT`, `RESQFT`, `COMSTRUC`, `ACRES`, `DEEDBKPG`, `RECDATEDAILY`, zoning and districts.
`PROPCLASS` counts: R 381,573; C 17,446; A 857; X 658; W 548; Y 99; Z 21; blank 429. The class and land-use code tables were not found, so none is mapped; whether multi-unit apartments are class R or C was not checked.
Only a count, the statistics and the field list were read; no records were archived.

## Gates

A person must write to the GIS Service Center (`gis@stlouisco.com`) for permission to archive and redistribute the Tax Parcels layer and for the PROPCLASS and LUC code tables; alternatively file a Missouri Sunshine Law request (RSMo ch. 610) with the Assessor for the real property file
(see [public-information-requests.md](../public-information-requests.md)). Ask for the Cloudflare challenge on `www.stlouiscountymo.gov` to be lifted for `FactLotRegistryBot`.

## Real run

None. No adapter.

## Known gaps

Code tables, B/F1/F2 mapping, sample counts. St. Louis City (not in the top 100 by county) is a separate source. Missouri entity data: `mo-sos-entities` (no bulk file).
