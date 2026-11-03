# mi-oakland-parcels: Oakland County, Michigan (FIPS 26125) open-data tax parcels

Reviewed 2026-11-03. Machine-readable copy: [`registry/sources/mi/mi-oakland-parcels.json`](../../../registry/sources/mi/mi-oakland-parcels.json).
Adapter: `factlot.registry.adapters.mi_oakland` (account system `oakland_pin`, the 10-digit parcel number).

**Status: `verified: true`, but the open layer has no owner names.** Unlike Wayne County (`mi-wayne-parcels`, portal terms limit saved
materials to personal, non-commercial use), Oakland's Open Data Terms of Use expressly permit reuse and distribution for any lawful purpose.

## Publisher and URLs

- Publisher: Oakland County, Michigan (Access Oakland Open Data; Oakland County GIS and Equalization).
- ArcGIS Online item `e2910cc3a8f84549ab7f0f8e8f99817b` "OC Tax Parcels (Public)"
  (<https://www.arcgis.com/home/item.html?id=e2910cc3a8f84549ab7f0f8e8f99817b>), published on the county's Access Oakland open-data portal.
- Service: `https://gisservices.oakgov.com/arcgis/rest/services/Enterprise/EnterpriseOpenParcelDataMapService/MapServer/1`
  ("Tax Parcel Plus", 490,784 parcels, `maxRecordCount` 2000).
- Not used: item `f9085f6af2514b97ac7beefc84918145` "OC Tax Parcel - Stacked 101" (Oakland County Enhanced Access Policy and GIS Data Policy).

## Terms, license, robots

- **Terms.** The item's `licenseInfo` is the "OPEN DATA TERMS OF USE AGREEMENT". Section 3: "You may retrieve, download, copy, modify,
  translate, adapt, distribute, sort, search, and reuse Open Data for any lawful purpose." Section 1 says accessing or downloading the
  data accepts the terms (browse-wrap; there is no click-through in front of the service). Sections 4-9: indemnification, as-is
  disclaimers, limits of liability; "THE OPEN DATA IS PROVIDED TO THE PUBLIC FREE OF CHARGE". No attribution requirement and no AI clause were
  found in the text read (the first 5,000 characters, sections 1-9).
- **robots.txt.** `gisservices.oakgov.com`: none (404 page). `discover` reported the item page `ok`.

## What the file contains

14 pages (`returnGeometry=false`, `OBJECTID_12` order, 2,000 features each) of the parcels with a Michigan class code beginning 2 or 3 (26,128).
Columns: `KEYPIN`, `PIN`, `REVISIONDATE`, `CVTTAXCODE`/`CVTTAXDESCRIPTION` (municipality), `CLASSCODE`, `NAME1`, `NAME2`, `SITEADDRESS`,
`SITECITY`, `SITESTATE`, `SITEZIP5`, `POSTALADDRESS` (owner mailing street line), `ASSESSEDVALUE`, `TAXABLEVALUE`, `NUM_BEDS`, `NUM_BATHS`,
`STRUCTURE_DESC`, `LIVING_AREA_SQFT`.

| `CLASSCODE` (Michigan STC, MCL 211.34c)                                                                                            | Count (county) | FactLot      |
| ---------------------------------------------------------------------------------------------------------------------------------- | -------------- | ------------ |
| 201 commercial improved (17,442), 202 vacant (3,347), 203 (168), 205 (1), 207 commercial condominium (501), 210 on leased land (4) | 21,463         | F1           |
| 301 industrial improved (3,261), 302 vacant (1,337), 303 (32), 307 (32), 310 (3)                                                   | 4,665          | F2           |
| 101/102 agricultural, 401/402/403/407 residential (345,773 / 27,336 / 3,888 / 86,186), 001/002/006/007 county special classes      |                | out of scope |

Michigan has no multifamily class (apartments of more than four units are commercial, 2xx) and this layer has no unit or occupancy column, so
apartments load as F1. **`NAME1` and `NAME2` are NULL on all 490,784 rows**; the county does not publish owner names in this layer. `POSTALADDRESS`
is filled but is stored only when an owner name exists, so it is not loaded.

## Gates

None for the layer. For owner names: the "Stacked 101" layer under the Enhanced Access Policy, or an Oakland County FOIA request for the
equalization file with owner names (see [public-information-requests.md](../public-information-requests.md)), is the route; neither was tried.

## Real run

`snapshot` on 2026-11-03: 14 pages, 11,691,525 bytes (first page `fl:document:sha256-d7ed305c4637a47d0dc251b044ec263ea3cbdb897be3f0f60dee1c40ac8bbdd8`),
then `mi_oakland.build` (4.0 s):

- Rows read: 26,128 features; parcels kept **26,124** (four repeated PINs dropped): F1 21,459, F2 4,665, B 0.
- Facts written: 124,858. Owner-of-record facts: 0. Situs 21,912; assessed value 24,340; living area 234.

## Known gaps

- No owners, so no entity linking for Oakland; no land area (no acreage column), year built, or roll year.
- `ASSESSEDVALUE` is the Michigan assessed value (50 % of true cash value); no market value is published, none is inferred.
- Apartments are F1 (no occupancy field). The Michigan LARA entity register has no bulk file (`mi-sos-entities`), so owners could not link even if present.
