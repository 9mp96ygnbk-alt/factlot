# nc-wake-parcels: Wake County (Raleigh), North Carolina parcels, from the NC OneMap statewide layer

Reviewed 2026-11-03. Status: **verified** (NC OneMap's free and unrestricted use policy). FIPS 37183.
Config: [`registry/sources/nc/nc-wake-parcels.json`](../../../registry/sources/nc/nc-wake-parcels.json); adapter
`python/src/factlot/registry/adapters/nc_wake.py`; tests `python/tests/test_adapter_nc_wake.py`; account system
`wake_reid`.

This review also answers the Tier 2 question "does NC OneMap cover the other North Carolina counties?" It does:
the layer holds all 100 counties with owner, value and a use code. The use code is the county's own, so each
county needs its own mapping (Wake is done here; Mecklenburg is `nc-mecklenburg-assessor`).

## Publisher and URLs

- Publisher: NC OneMap, run by the NC Department of Information Technology, Government Data Analytics Center,
  Center for Geographic Information and Analysis (CGIA). The Wake attributes come from the Wake County Assessor
  (`sourceagnt` = "Wake County Assessor") through the NC Integrated Cadastral Data Exchange project, funded by the
  US EPA Environmental Information Exchange Network.
- Dataset: "North Carolina Parcels (Polygons)", ArcGIS item `1de3d7d828ce4813b838ddf055b40317`
  (`https://www.arcgis.com/sharing/rest/content/items/1de3d7d828ce4813b838ddf055b40317?f=json`), service
  `https://services.nconemap.gov/secure/rest/services/NC1Map_Parcels/FeatureServer/1` (5,938,804 parcels in 100
  counties on 2026-11-03; `maxRecordCount` 5,000). A centroid copy is layer 0 (item `943c5690…`).
- Download used: the Hub download API with a filter,
  `https://www.nconemap.gov/api/download/v1/items/1de3d7d828ce4813b838ddf055b40317/csv?layers=1&where=cntyfips='183' AND parusecode IN ('COM','IND','APT')`.
  The first call answers 202 ("Up to date download file is being generated"); a repeat after about two minutes
  serves the CSV (4,930,961 bytes, 9,722 rows). The statewide file is a File Geodatabase / GeoPackage of
  several GB; the same layer for Wake alone is 435,380 parcels (about 220 MB as CSV).
- Layer metadata and data dictionary: the item's PDF `nc-parcels-data-definitions` (item `5cdbfd25…`, not fetched).
- Wake County's own extract, not used: `https://services.wake.gov/realdata_extracts/` (linked from
  <https://www.wake.gov/departments-government/tax-administration/data-files-statistics-and-reports/real-estate-property-data-files>;
  `RealEstData10132026.zip` 42,471,934 bytes, `.txt` 337,794,445, daily refresh, with building detail). The
  host's robots.txt is `User-agent: *` / `Disallow: /`, so the collector may not fetch it (see Gates).
- Wake's code lists: `CodeDescriptions.pdf` and `Record Layout.pdf` on
  `s3.us-west-1.amazonaws.com/wakegov.com.if-us-west-1/s3fs-public/documents/2020-10/` (read; the S3 host has no
  readable robots.txt: 403).

## Terms, license, robots

- Licence pointer: the dataset item's `licenseInfo` is `https://www.nconemap.gov/pages/terms`. That page (a Hub
  page, item `e60514c3b78542ef9902e3d7f7a671c1`) says: "committed to offering access to current State geospatial
  information at no charge. By sharing their content, all partner organizations understand this free and
  unrestricted use policy." and "Written release agreements to authorize use of the geospatial data, web
  services, and applications found on the NC OneMap website are not required and will not be issued." It adds:
  "Any sale of this data must not violate applicable state laws or regulations." and asks for the citation "NC
  OneMap (2019). North Carolina Department of Information Technology, Government Data Analytics Center, Center
  for Geographic Information and Analysis. Available at www.nconemap.gov."
- AI use: not addressed. Redistribution: permitted by the free and unrestricted use policy. The underlying
  records are public records (N.C. Gen. Stat. ch. 132). The layer's own notice sends users to the county data
  stewards for authoritative data.
- robots.txt: `www.nconemap.gov` and `hub.arcgis.com`: `User-agent: *`, `Crawl-delay: 60`, disallow `/sites/`,
  `/admin/`, `/sessions/`, `/groups/`, `/people/`, `/workspace/` (the download API and item JSON are allowed; the
  collector waits 60 s between requests to those hosts). `services.nconemap.gov`: 404 (no rules).
  `services.wake.gov`: blocks everything (see Gates).

## What the file contains

`North_Carolina_Parcels_(Polygons).csv`: UTF-8 with a BOM, 70 lower-case columns, one row per parcel polygon.
Key columns: `parno` (10-digit PIN), `altparno` (7-digit real estate ID), `ownname`, `mailadd`/`munit`/`mcity`/
`mstate`/`mzip`, `siteadd`/`sunit`/`scity`, `gisacres`, `recareano`, `parusecode`/`parusedesc`/`parusecd2`/
`parusedsc2`, `parval`/`landval`/`improvval`, `parvaltype` (all rows "Assessed"), `structyear`, `cntyfips`,
`sourceagnt`, `transfdate`. Layout details are in the adapter docstring.

Wake's `parusecode` is NC OneMap's three-letter name for the Wake County **land class** (`parusedesc` is the
county's one-letter class). Mapping verified against Wake's `CodeDescriptions.pdf` ("LAND CLASS") and the
sample rows:

| `parusecode`                                                                                                                                                                | Wake class (parcels in Wake, 2026-11-03)                                                                                                                            | FactLot category                                                                         |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `COM`                                                                                                                                                                       | `C` commercial (6,515)                                                                                                                                              | `F1`                                                                                     |
| `IND`                                                                                                                                                                       | `D` industrial (2,158)                                                                                                                                              | `F2`                                                                                     |
| `APT`                                                                                                                                                                       | `G` apartment (1,049)                                                                                                                                               | `B`, except main building type-and-use `01`-`04` (one- to four-family house; 88 parcels) |
| `RHS` 361,038, `AHS` 878, `AWI` 1,028                                                                                                                                       | `R` residential under 10 acres with homesite, `B` over 10 acres with homesite, `A` acreage with improvements                                                        | out of scope                                                                             |
| `VAC` 30,834, `HOA` 15,251, `XMT` 6,699, `PTX` 2,610, `AGR` 2,154, `FOR` 786, `WSS` 692, `CEM` 437, `STA` 405, `MHP` 121, `HRT` 115, `GOL` 75, `HIS` 62, `RET` 59, `CON` 50 | vacant, HOA, exempt, part exempt, farm, forest, water/sewer, cemetery, state-assessed, mobile home park, horticulture, golf, historic, retirement home, condominium | out of scope                                                                             |
| `MFG` 480                                                                                                                                                                   | `M` manufactured home (not manufacturing)                                                                                                                           | out of scope                                                                             |
| `COX` 1,064                                                                                                                                                                 | `O` "MA+CONDO": condominium master accounts (sampled rows have value 0)                                                                                             | out of scope                                                                             |
| blank 820                                                                                                                                                                   | no class                                                                                                                                                            | out of scope                                                                             |

`parusecd2` is Wake's "type and use" code of the main building (CodeDescriptions.pdf: 34 typical office, 47
single tenant retail, 48 multi tenant, 83 warehouse, 85 flex warehouse, 07 garden apartments, 09 elevator
apartments, 100 student apartments …). It is used only to drop one- to four-family houses from class `G`; the
publisher's code goes into `local_use_code` as `<parusecode>/<parusecd2>` (`COM/34`).

## Gates

None for the loaded source. Notes for a person:

- **Wake County's own extract is robots-blocked.** `https://services.wake.gov/robots.txt` disallows all paths.
  A person could download `RealEstData<MMDDYYYY>.zip` (42 MB) by hand, but the collector may not. The extract has
  building area, year built, sale data and the full type-and-use detail; using it needs Wake
  County Tax Administration to lift the robots rule for the FactLotRegistryBot user agent
  (contact on the Wake page), or a person to place the file in `collected/` by hand.
- The statewide layer is refreshed when each county re-submits (Wake's `transfdate` is 2026-05-17), so it can lag
  Wake's daily extract by months.

## Real run

2026-11-03, `python -m factlot.collector snapshot --config registry/sources/nc/nc-wake-parcels.json`, then
`python -m factlot.registry.adapters.nc_wake <file> <db> --as-of 2026-05-17`:

- Snapshot `fl:document:sha256-5afadddd9253fb82cce064cac710d99cfc0b4457feae206c85fa7298942e805e` (4,930,961
  bytes; collector path `collected/nc-wake-parcels/5afadddd9253fb82/North_Carolina_Parcels_(Polygons).csv`).
- Rows read 9,722 (`COM` 6,515, `IND` 2,158, `APT` 1,049); parcels kept 9,634 (88 apartment-class parcels with a
  one- to four-family main building dropped): `F1` 6,515, `F2` 2,158, `B` 961.
- Facts written 84,188. Organisation owners stored 8,378; natural-person owners skipped 1,256 (no owner was blank).
  Seconds: 2.4. Errors: none.

## Full load (2026-11-03)

Release `data-2026-11-03-41603209834` (draft, maintainers only) of `9mp96ygnbk-alt/factlot`. Each asset's sha256 was checked against the manifest and its first 16 hex characters against the name. Loaded into the Tier 2 scratch registry (one SQLite file shared by every Tier 2 source, `ct-sos-entities` first).

Assets (document id from the manifest):

- `nc-wake-parcels__5afadddd9253fb82__North_Carolina_Parcels_.Polygons.csv` (4,930,961 bytes): `fl:document:sha256-5afadddd9253fb82cce064cac710d99cfc0b4457feae206c85fa7298942e805e`

Command:

```
PYTHONPATH=python/src python3 -m factlot.registry.adapters.nc_wake <csv> registry.db --as-of 2026-05-17 --retrieved-at <manifest checked_at>
```

- Rows read: 9,722 data rows (88 apartment-class parcels with a one- to four-family main building dropped).
- Parcels kept: **9,634** distinct commercial parcels (`B` 961, `F1` 6,515, `F2` 2,158).
- Facts written: 84,176. Seconds: 6.1. Invalid ids, errors, retired: 0, 0, 0.
- Organisation owners stored (current owner-of-record facts): 8,372; natural persons or withheld owners not stored (names not kept): 1,262.
- Ownership links to registered entities after `link_owners()`: 87 (the only entity registry in the scratch file is `ct-sos-entities`).

## Known gaps

- No building area and no tax year in the layer; year built is `structyear` (set for 9,628 of 9,634 parcels).
- One value (`Assessed`) is stored as `appraised_value`; `market_value` is left empty.
- Acreage with improvements (`AWI`, `AHS`) is out of scope even where it carries a commercial use. Condominium
  master accounts (`COX`, 1,064 parcels) are out of scope because the sampled ones have no value of their own; the
  classes of the individual condominium units were not reviewed.
- Class `D` includes some kennels and stables (type-and-use 93, 97), kept as `F2` because the county classes them industrial.
- Only the three commercial classes were downloaded; the other 425,658 Wake parcels were not.

## Statewide follow-up (2026-11-03)

`nc_wake.py` is now a thin wrapper over `nc_onemap.py` (the per-county mapping table for the NC OneMap layer), with the
same source id, account system, config and tests. The other North Carolina counties taken from the same layer are in
[nc-onemap-parcels](nc-onemap-parcels.md).
