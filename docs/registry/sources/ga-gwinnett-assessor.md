# ga-gwinnett-assessor: Gwinnett County, Georgia Tax Master Table and parcels

Reviewed 2026-11-03. Status: **not verified (gated: terms)**; no adapter. FIPS 13135. Config:
[`registry/sources/ga/ga-gwinnett-assessor.json`](../../../registry/sources/ga/ga-gwinnett-assessor.json).

## Publisher and URLs

- Publisher: Gwinnett County GIS (org `GwinnettCountyGIS`), serving the Tax Assessors Office's data on the Gwinnett
  County Open Data Portal, `https://gcgis-gwinnettcountyga.hub.arcgis.com` (Hub site item `8ef19395d08f42c495d53ce6bfbb3850`).
- Service: `https://services3.arcgis.com/RfpmnkSAQleRbndX/arcgis/rest/services/Property_and_Tax/FeatureServer`
  ("Property and Tax layers used for Gwinnett County Open Data Site"): Parcels (layer 0, 309,585), County-owned
  Property (5), Zoning (1), Subdivisions (2), LandLots (6), **Tax Master Table (3, 316,086 rows)**, Tax Owner Address
  Table (4, 316,819), Property Improvements Table (8), Land Value Table (10). Item for the Tax Master Table:
  `c76183c341cd4e0495c4faa781f9f270` (Hub licence field "custom"). `maxRecordCount` 2,000. A joined layer
  "FYT_Owner_Data" (`67eb72963c1c49628857d85fa1f48b43`, "Parcel layer joined with Tax data to show parcel and owner
  information together") also exists.
- The county's Tax Assessors property search is on qPublic (Schneider Geospatial); not used.

## Terms, license, robots

- The Tax Master Table item's `licenseInfo` (the operative sentences): "All data access via this map, program,
  website or file distribution is under the copyright of Gwinnett County, Georgia. So as not to conflict or interfere
  with the data sales of Gwinnett County government, the copyrighted data **shall be used for internal purposes by
  recipient only and may not be distributed or sold in any way to any person or entity**." Data is provided "AS IS".
  The Property and Tax service item itself carries an empty licence, so the table item's text governs.
- Public records under the Georgia Open Records Act (O.C.G.A. 50-18-70 et seq.); the county sells data products.
- AI use: not addressed. Redistribution: forbidden by the text above, so this source cannot feed the open registry.
- robots.txt: `gcgis-gwinnettcountyga.hub.arcgis.com` `Crawl-delay: 60`, disallow `/sites/`, `/admin/`, `/sessions/`,
  `/groups/`, `/people/`, `/workspace/`; `services3.arcgis.com` answers 403 to `/robots.txt`.

## What the file would contain

Tax Master Table columns: `LRSN`, `RPIN`, `PIN`, `LOCADDR`, `LOCCITY`, `LOCSTATE`, `LOCZIP`, `OWNER1`, `OWNER2`,
`MAILADDR`, `MAILCITY`, `MAILSTAT`, `MAILZIP`, `STRNUM`, `STRNAME`, `LEGALAC`, `ZONING`, `DWLGVAL1`, `LANDVAL1`,
`TOTVAL1`, `TAXTOT1`, `PROPCLAS`, `PCDESC`, `ZONEDESC`, `LEGAL1`, `DISTNUM`, `RT_NUM`, `DOC1REF`-`DOC3REF`,
`GRANTOR1`-`3`, `PUBLIC_NEINUM`. Owner names are present. `PROPCLAS`/`PCDESC` is the county's property-class table
(100 distinct values; counts from a group-by query on 2026-11-03, nothing loaded): `101` residential SFR 247,405 ...
`211` apartments (3 stories or under) 326, `212` apartments high rise 67, `214` LIHTC apartments 52, `252`-`257`
hotels and motels 113, `3xx` commercial (restaurant 321, strip center 344, office low rise 353, office high rise 354,
warehouse 398, prefab warehouse 399 ...), `401` manufacturing/processing 136, `299`/`300`/`301`/`500` tie-back and vacant
commercial land. A mapping would be `B` for 211, 212, 214; `F2` for 392, 395, 401, 459; `F1` for the other
`252`-`399` classes, excluding vacant, tie-back, common-area and auxiliary classes. By those class counts about 445
apartment rows and about 9,450 commercial and industrial rows would be in scope (estimate; not loaded).

## Gates

- **Terms.** The licence text forbids distribution. A person asks Gwinnett County (GIS Division or the Tax Assessors
  Office) for written permission to publish facts derived from the Tax Master Table (owner of record, class, value,
  address) in an open registry, or files an Open Records Act request for the tax digest stating that use. Then set
  `verified` true and add the file URL.

## Real run

Not run (no download). Sample counts above are the service's own group-by counts, not a load.

## Known gaps

No building area or year built in the Tax Master Table (the Property Improvements Table, layer 8, has structures).
