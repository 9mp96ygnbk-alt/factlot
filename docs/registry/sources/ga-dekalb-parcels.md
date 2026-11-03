# ga-dekalb-parcels: DeKalb County, Georgia tax parcels ("Tax Parcels Current", CC0)

Reviewed 2026-11-03. Status: **verified** (CC0). FIPS 13089. Config:
[`registry/sources/ga/ga-dekalb-parcels.json`](../../../registry/sources/ga/ga-dekalb-parcels.json); adapter
`python/src/factlot/registry/adapters/ga_dekalb.py`; tests `python/tests/test_adapter_ga_dekalb.py`; account
system `dekalb_parcel_id`.

## Publisher and URLs

- Publisher: DeKalb County GIS Division, on its ArcGIS Hub site `https://dcgis-dekalbgis.hub.arcgis.com`
  (org `DeKalbGIS`). Data derive from the county's CAMA (Board of Assessors) and tax (Tax Commissioner) systems.
- Dataset used: "Tax Parcels Current", ArcGIS item `e383e80264c24402b5d5711b671acb56` (Hub licence field
  `CC0-1.0`), service `https://services2.arcgis.com/IxVN2oUE9EYLSnPE/arcgis/rest/services/TaxParcelsOD/FeatureServer/0`
  (246,494 rows on 2026-11-03; data last edited 2026-11-01). Snippet: "Tax Parcel Publishing layer, derived from
  production tax parcels to be used in distributed collaboration for Open Data." Description: "combined with
  assessing and tax information from CAMA and Tax systems ... contains redundant geometry in cases where there
  are multiple condominium units on a given tax parcel."
- Download used: the Hub download API,
  `https://dcgis-dekalbgis.hub.arcgis.com/api/download/v1/items/e383e80264c24402b5d5711b671acb56/csv?layers=0&where=CLASSDSCRP LIKE 'C%' OR CLASSDSCRP LIKE 'I%'`.
  The first call answers 202 with `status: ExportingData` and a progress percentage; a repeat serves the CSV
  (5,001,349 bytes, 11,352 rows).
- Other DeKalb items, not used: yearly layers "Tax Parcels 2021"-"2025" (`7aa40e49…` for 2025: no owner, no
  situs, licence text "provided for informational purposes only"); the older "DeKalb County Tax Parcels"
  (`4f5af990…`, "Creative Commons Attribution", 2020, with owner and use code, but its service no longer answers);
  `gis.dekalbcountyga.gov` (the county's ArcGIS Server; its TLS certificate had expired on 2026-11-03).

## Terms, license, robots

- Licence: the item's `licenseInfo` is "CC0" and the Hub catalogue lists `CC0-1.0`. CC0 places no condition on
  copying, redistribution or any use, including AI. Public records under the Georgia Open Records Act (O.C.G.A.
  50-18-70 et seq.).
- robots.txt: `dcgis-dekalbgis.hub.arcgis.com` and `hub.arcgis.com`: `Crawl-delay: 60`, disallow `/sites/`,
  `/admin/`, `/sessions/`, `/groups/`, `/people/`, `/workspace/`. `services2.arcgis.com` answers 403 to
  `/robots.txt` (no rules readable; the collector fetched the CSV from the Hub host).

## What the file contains

`csv`: UTF-8 with a BOM, 91 columns, one row per tax parcel (condominium units repeat the parcel number with
`BUILDING` and `UNIT`). Columns used: `PARCELID` (`06 248 01 003`), `CLASSDSCRP` (Georgia class: `C3`, `I4` …),
`SITEADDRESS` (full situs with city, state, ZIP; blank for 73 rows, then `ADDRESS_NUMBER`, `FULL_STREET_NAME`,
`CITY`, `STATE`, `ZIP`), `OWNERNME1`, `OWNERNME2`, `PSTLADDRESS`, `PSTLCITY`, `PSTLSTATE`, `PSTLZIP5`,
`PSTLZIP4`, `TOTAPR1` (total appraised value), `CNTASSDVAL` (40 % assessed value), `ACREAGE`, `BLDGAREA`,
`RESYRBLT`. `CLASSCD`, `USECD`, `USEDSCRP`, `STRCLASS`, `CLASSMOD`, `PRPRTYDSCRP`, `FLOORCOUNT`, `BLDGAREA` and `RESYRBLT` are empty
for every row of the downloaded file (`USECD` and `CLASSCD` also on the full 246,494-row layer). `LANDUSE` is filled for
4,717 of 11,352 rows with a planning designation (`CRC` 1,450, `TC` 857, `SUB` 643, `RC` 604, `LIND` 666, `NC` 339, `TN`
111, `IND` 38 …), not a parcel use, so it is not read.

Georgia digest classes (Ga. Comp. R. & Regs. 560-11-2-.21), counts in the downloaded file:

| Class                                            | Rows             | Category     |
| ------------------------------------------------ | ---------------- | ------------ |
| `C1` 78, `C3` 8,096, `C4` 737, `C5` 103, `C9` 86 | 9,100            | `F1`         |
| `I1` 9, `I3` 1,845, `I4` 321, `I5` 74, `I9` 3    | 2,252            | `F2`         |
| `R*`, `E*`, `U*`, `V*`, `H*`, `B*`, blank        | (not downloaded) | out of scope |

`local_use_code` keeps the class (`C3`). Strata digit: 1 improvements, 3 lots, 4 small tracts, 5 large tracts, 9 other.

## Gates

None. Optional follow-up for a person: ask the DeKalb County Board of Assessors for the land-use table (the
published layer has none), so apartments (`B`), hotels and vacant lots can be told apart inside class C.

## Real run

2026-11-03, `python -m factlot.collector snapshot --config registry/sources/ga/ga-dekalb-parcels.json`, then
`python -m factlot.registry.adapters.ga_dekalb <file> <db> --as-of 2026-11-01`:

- Snapshot `fl:document:sha256-6b569f0b50728ba3b2e9cdb171603439c6a37e717cd227aa0e8abb966e96d74c` (5,001,349
  bytes; `collected/ga-dekalb-parcels/6b569f0b50728ba3/csv`).
- Rows read 11,352 (one `PARCELID` repeated: 11,351 distinct); parcels kept 11,351: `F1` 9,099, `F2` 2,252, `B` 0.
- Facts written 97,473. Organisation owners stored 9,175; natural-person owners skipped 2,176. Situs address
  present for 11,279 parcels; market value for 11,230. Seconds: 2.4. Errors: none.

## Known gaps

- **No land use**: class `C` includes apartments, hotels and vacant commercial lots; all are `F1` here, and
  multifamily parcels are therefore missing from `B` and wrongly counted in `F1`. Treat DeKalb `F1` counts as
  "class C" until a land-use table is obtained.
- Building area and year built are empty for every class C and I row (`BLDGAREA`, `RESYRBLT`); the adapter reads them in case the county fills them.
- Each condominium unit is a row, but only the first row for a `PARCELID` is kept.
- The layer does not state its tax year; `parcel.tax_year` is empty.
- Owners that look tax exempt (a university, development authorities) appear in class `C` and stay in `F1`.
