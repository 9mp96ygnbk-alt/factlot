# ut-ugrc-lir: Utah statewide land information record (LIR) parcels (Salt Lake 49035, Utah 49049, any other Utah county)

Review record for the FactLot Registry (data policy §5). Reviewed 2026-11-03. Machine-readable copy:
[`registry/sources/ut/ut-ugrc-lir.json`](../../../registry/sources/ut/ut-ugrc-lir.json).
Adapter: `python/src/factlot/registry/adapters/ut_ugrc.py` (account system `ugrc_lir`, account
`<county FIPS>:<parcel id>`); tests: `python/tests/test_adapter_ut_ugrc.py`. Tier 2, west region
([`../tier2/west.md`](../tier2/west.md)).

## Publisher and URLs

- Publisher: Utah Geospatial Resource Center (UGRC), part of the Utah Department of Technology
  Services, which maintains the State Geographic Information Database (SGID). Counties supply the
  data: "The SGID contains parcel boundaries for each of the 29 counties in Utah and is updated as
  new data is provided from the data steward in each county."
- Product page: <https://gis.utah.gov/products/sgid/cadastre/parcels/> (category Cadastre, "Utah
  Parcels"). For every county it lists a basic parcel layer (boundary, id, address) and a **land
  information record (LIR)** layer "with county tax roll attributes for most counties".
- LIR layers are ArcGIS Online feature services owned by `UtahAGRC`, named `Parcels_<County>_LIR`
  (`https://services1.arcgis.com/99lidPhWCzftIe9K/ArcGIS/rest/services/Parcels_<County>_LIR/FeatureServer/0`):
  - Salt Lake: item `6f900727e16d4ce1a83f2a1ec1d82e60`, 399,432 features; the page says "Last update
    September 2026" for basic parcels, 2026 for LIR; `CURRENT_ASOF` 2026-09-29 in the data.
  - Utah County: item `69477c1143924bc9990cdb930b033fb5`, 289,858 features; `CURRENT_ASOF` 2026-09-30.
  - The page also lists LIR layers for Beaver, Box Elder, Cache, Carbon, Daggett, Davis, Duchesne, Emery,
    Garfield, Grand, Iron, Juab, Kane, Millard, Morgan, Piute, Rich, San Juan, Sanpete, Sevier, Summit,
    Tooele, Uintah, Wasatch, Washington, Wayne and Weber. Only the first two were examined; the adapter
    reads any of them (`County ID` decides the FIPS code).
- Bulk files: the Hub download API, <https://opendata.gis.utah.gov/api/download/v1/items/6f900727e16d4ce1a83f2a1ec1d82e60/csv?layers=0>
  (Salt Lake; `Content-Range: bytes 0-6000/163852405`, i.e. 163,852,405 bytes, `Last-Modified`
  2026-10-14) and the same path with `69477c1143924bc9990cdb930b033fb5` (Utah County). Each answers `302` to
  `services1.arcgis.com/.../FeatureServer/replicafilescache/<name>.csv`, then `302` to a signed Azure blob that
  serves the CSV and honours `Range`.

## Terms, license, robots

- ArcGIS item `licenseInfo` (both layers, read 2026-11-03): "The data ... are provided "as is" and "as
  available", with no guarantees relating to the availability, completeness, or accuracy of data ... You
  agree to hold the State of Utah harmless for any claims, liability, costs, and damages relating to your
  use of the data ... This work is licensed under a Creative Commons Attribution 4.0 International License."
- UGRC product page, "Data Disclaimer": "There are no constraints or warranties with regard to the use of
  this dataset. Users are encouraged to attribute content to: State of Utah, SGID."
- Each row's `Disclaimer URL` points to the Utah.gov disclaimer (<https://www.utah.gov/support/disclaimer.html>):
  "AS IS", no warranties; it makes no use restriction on data.
- CC BY 4.0 permits redistribution and commercial use with attribution and does not restrict AI use. The
  "hold harmless" sentence is a disclaimer, not a restriction.
- robots.txt: `gis.utah.gov` `User-agent: * Allow: *`, `Crawl-delay: 1`; `opendata.gis.utah.gov` `Crawl-delay: 60`,
  disallows `/sites/`, `/admin/`, `/sessions/`, `/groups/`, `/people/`, `/workspace/` (not the download API);
  `services1.arcgis.com` has none (HTTP 403 "Invalid URL").
- Esri/ArcGIS Hub platform terms: see the note in [co-denver-assessor.md](co-denver-assessor.md) (they bind
  the publisher, not a downloader).

## What the file contains

One row per tax parcel (UGRC's goal is "one tax parcel record per unique tax notice"). The Hub CSV is UTF-8
with a byte-order mark, quoted, header row of field **aliases**; the feature service uses field names. The
fields are the LIR standard (the layer description reproduces the full work-group recommendation):

`OBJECTID`, `County Name` / `COUNTY_NAME`, `County ID` / `COUNTY_ID`, `County Assessor Info URL`, `County Recorder
Info URL`, `Disclaimer URL`, `Current As Of` / `CURRENT_ASOF`, `Parcel ID` / `PARCEL_ID`, `Serial Number`, `Parcel
Address` / `PARCEL_ADD`, `Parcel City`, `Tax Exempt Type` / `TAXEXEMPT_TYPE`, `Tax District`, `Total Market Value` /
`TOTAL_MKT_VALUE`, `Land Market Value`, `Parcel Acres`, `Property Class` / `PROP_CLASS`, `Primary Residence`, `Number of
Housing Units` / `HOUSE_CNT`, `Subdivision Name`, `Square Footage` / `BLDG_SQFT` (primary buildings), `Square Footage
Note`, `Number of Floors`, `Number of Floors Note`, `Year Built` / `BUILT_YR`, `Effective Year Built`, `Construction
Material`, `Property Type` / `PROP_TYPE` (Salt Lake only, and empty in all 399,432 rows), `Shape__Area`, `Shape__Length`.

**There is no owner column** in the LIR standard; the county websites have owners but no bulk file was
found (see Known gaps). Values are market values; no assessed value is given.

### Class table mapped

`Property Class` is each county's own class (the standard says "Residential, Commercial, Industrial, Mixed,
Agricultural, Vacant, Open Space, Other"; Salt Lake adds the county code list "R Residential / Condo, C
Commercial, I Industrial, RE Recreational, A Agricultural, MH Multi Housing" in the layer description, and
points to `slco.org/assessor/new/queryproptyp.cfm` for the definitions, which was not read). Counts are from
the live layers' group-by statistics on 2026-11-03 (not from a download):

| Property Class                               | Salt Lake | Utah County | FactLot category |
| -------------------------------------------- | --------: | ----------: | ---------------- |
| Commercial                                   |    12,345 |      13,060 | F1               |
| Commercial - Office Space                    |     5,861 |           - | F1               |
| Commercial - Retail                          |     3,379 |           - | F1               |
| Commercial - Industrial                      |     3,147 |           - | F2               |
| Industrial                                   |       714 |           - | F2               |
| Commercial - Apartment & Condo               |     6,548 |       5,195 | B                |
| Residential                                  |   339,728 |     213,651 | out of scope     |
| Vacant, Undeveloped, Greenbelt, Recreational |     8,340 |           - | out of scope     |
| Tax Exempt (all variants)                    |    13,675 |      32,374 | out of scope     |
| (blank) / Unknown                            |     5,695 |      25,578 | out of scope     |

Commercial classes whose `Tax Exempt Type` begins "Local Government", "State Government", "Federal Government"
or "Non Profit" are also dropped by the adapter. Salt Lake's own `Tax Exempt Type` values include "Other" (5,466
rows in the 74,145-row sample), which the adapter does not treat as exempt.

## Gates

None for the download: no account, login, click-through, fee or CAPTCHA. For a person:

1. Confirm the reading of the license (CC BY 4.0 on the items plus the UGRC "no constraints" sentence) and
   that the "hold harmless" clause in the item license is acceptable.
2. Decide whether `Commercial - Apartment & Condo` should map wholly to `B`. In Salt Lake it includes some
   commercial condominiums and small buildings (in the sample, 1,399 of 1,585 rows have a unit count of 1; the
   field is described only as "Number of Housing Units"). The adapter keeps the class verbatim in
   `local_use_code`, so a later split is a re-run, not a re-download.
3. Read Salt Lake's class definitions (`slco.org/assessor/new/queryproptyp.cfm`) and Utah County's, which this
   review did not open.

## Real run (2026-11-03)

The full CSVs exceed the 50 MB limit of the Tier 2 brief (Salt Lake 163,852,405 bytes), so each county was
sampled with a ranged read of the Hub export (a prefix of 30 MB and 25 MB, cut at the last complete row;
the collector's weekly workflow takes the full files). The prefixes were loaded into a scratch registry
outside the repository.

```
python -m factlot.registry.adapters.ut_ugrc ut_salt_lake_lir_prefix.csv scratch.db --as-of 2026-09-29 --partial
python -m factlot.registry.adapters.ut_ugrc ut_utah_lir_prefix.csv     scratch.db --as-of 2026-09-30 --partial
```

- Salt Lake sample (document `fl:document:sha256-df7fdfdb56a897838904c66d2ae5439ac9438192b38c789b8b6af5de263b97ae`,
  29,999,649 bytes): rows read 74,145; kept 8,777 (F1 5,475, F2 1,746, B 1,556); out of scope 65,368; invalid 0;
  facts written 66,063; organisation owners 0 (no owner column); 2 s.
- Utah County sample (document `fl:document:sha256-5258d5053ab61520dcfe2ce9abd00e43a830f3885c8396330042f1d2679f3689`,
  24,999,670 bytes): rows read 88,458; kept 8,118 (F1 6,095, B 2,023); out of scope 80,340; invalid 0; facts
  written 43,419; 2 s.
- Scratch registry: 14,546 Utah parcels. Expected size of a full load, from the class table before the
  exempt-owner filter: about 31,994 Salt Lake and 18,255 Utah County parcels.

These sample documents are partial files and are not archived by the collector; the registry facts of the
scratch run are not published.

## Full load (2026-11-03)

Release `data-2026-11-03-41603209834` (draft, maintainers only) of `9mp96ygnbk-alt/factlot`. Each asset's sha256 was checked against the manifest and its first 16 hex characters against the name. Loaded into the Tier 2 scratch registry (one SQLite file shared by every Tier 2 source, `ct-sos-entities` first).

Assets (document id from the manifest):

- `ut-ugrc-lir__1c68bdd434a16b1f__csv` (163,852,405 bytes): `fl:document:sha256-1c68bdd434a16b1f7f08db2083df6cfe69ccb5c3745e597a262342ccf587c877`
- `ut-ugrc-lir__1ce0bbc78d389e32__csv` (88,971,898 bytes): `fl:document:sha256-1ce0bbc78d389e3264e66297866978935ef615f4fc40bc6dcb7db8b18df94a44`

Command:

```
PYTHONPATH=python/src python3 -m factlot.registry.adapters.ut_ugrc <Salt Lake csv> registry.db --as-of 2026-09-29 --partial --retrieved-at <manifest checked_at>
PYTHONPATH=python/src python3 -m factlot.registry.adapters.ut_ugrc <Utah County csv> registry.db --as-of 2026-09-30 --partial --retrieved-at <manifest checked_at>
```

- Rows read: 399,432 (Salt Lake) + 289,858 (Utah County) = 689,290 data rows; out of scope 640,164.
- Parcels kept: **44,395** distinct commercial parcels (`B` 10,080, `F1` 30,576, `F2` 3,739); the adapter reported 49,126 kept records (4,731 repeated parcel ids).
- By county:
  - Salt Lake (FIPS 49035): 30,756 parcels (`B` 6,399, `F1` 20,618, `F2` 3,739); organisation owners 0; ownership links 0.
  - Utah County (FIPS 49049): 13,639 parcels (`B` 3,681, `F1` 9,958, `F2` 0); organisation owners 0; ownership links 0.
- Facts written: 336,753. Seconds: 27.1. Invalid ids, errors, retired: 0, 0, 0.
- Organisation owners stored (current owner-of-record facts): 0; natural persons or withheld owners not stored (names not kept): 0. The LIR schema carries no owner.
- Ownership links to registered entities after `link_owners()`: 0 (the only entity registry in the scratch file is `ct-sos-entities`).
- The LIR file has several rows for one `Parcel ID` where a parcel has more than one building or part: Salt Lake 30,877 in-scope rows for 30,756 parcels, Utah County 18,249 rows for 13,639 parcels (an in-scope parcel with several rows gets one fact per distinct value). Parcel counts above are distinct parcels.

## Known gaps

- No owner of record. Owner names are on the counties' own web searches (Utah County also exposes a map
  service, `maps.utahcounty.gov/arcgis/rest/services/Parcels/TaxParcels/MapServer`, whose description says
  it shows owner names; it is a map-viewing service with no terms found, not a bulk file, and is not used).
  Until an owner source is found, UGRC parcels cannot be linked to the Utah entity registry.
- No assessed value, no land use detail, no unit count that can be trusted (`HOUSE_CNT` means something
  county-specific), and no building area for exempt or vacant parcels. Utah County has no `Property Type`
  and lumps industrial parcels into `Commercial` (all F1 here).
- No tax year column; `CURRENT_ASOF` is the snapshot date. Parcels are one per tax notice, so a condominium
  complex can be one record.
- The Hub export can be stale relative to the layer; compare its `Last-Modified` to the item's `modified`.
