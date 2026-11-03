# ut-ugrc-lir: Utah statewide land information record (LIR) parcels (26 of 29 counties)

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
    Tooele, Uintah, Wasatch, Washington, Wayne and Weber. Only the first two were examined at first; the
    statewide extension (below) added 24 of them and left out Carbon, Emery and San Juan.
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
# since 2026-11-03 --partial is the default and may be left out
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

## Statewide extension (2026-11-03)

The item licence (CC BY 4.0) and the UGRC product page apply to every county's LIR layer, so the
extension is configuration, adapter changes and testing. The config now lists **26 county files**: Salt
Lake and Utah County first, then **24 added counties** alphabetically by layer name, each the Hub CSV of
the layer's `serviceItemId`. **Three counties are left out**: Carbon, Emery and San Juan (below).

- **County list, from the publisher's own service directory.** `services1.arcgis.com/99lidPhWCzftIe9K/ArcGIS/rest/services?f=json`
  lists 29 `Parcels_<County>_LIR` services, one for each Utah county (the product page says the same: an
  LIR layer "for most counties", all 29 linked). Each layer's `COUNTY_ID` (group-by statistics) is one
  value, 1 to 29, and maps through `2 * id - 1` to the right Census FIPS (Beaver 001 … Weber 057); the
  item id is the layer's `serviceItemId`.
- **Codes, from each layer's group-by statistics** (`COUNTY_ID`, `COUNTY_NAME`, `PROP_CLASS`,
  `TAXEXEMPT_TYPE`, counts; no download). Iron, Uintah and Davis use Salt Lake's `Commercial - …` subclasses;
  the other counties use plain `Commercial`; Box Elder adds `NON-FAA` and `FAA Mkt` (farmland), several
  add `Mixed Use`, `Vacant - Commercial`, `Centrally Assessed`, `Personal Property` or `Privilege Tax`, all out of
  scope as before. Eleven counties write `Unknown` (Millard `UNKNOWN`) as the exempt type of every
  commercial row; that is not an exempt owner, so those rows stay in scope. The existing table maps
  every county below; no county-specific entry was needed.
- **Left out, because their classes cannot be mapped from published definitions:**
  - **Carbon** (49007, item `d0e2d87667a246b397e35ac038a01eeb`, 26,736 features): its own vocabulary
    (`Single Family` 13,087, `Commercial` 6,471, `Land` 5,188, `Subsidized Housing` 1,112, `Vacant
Commercial` 301, `MIXED USE` 154, `Multi-Family` 152, `Apartments` 94, `DEFAULT` 5 …), no definitions
    on the layer or the product page, `Commercial` on 24% of the county's rows (2-6% elsewhere) and the
    sampled rows (8 per class, `resultRecordCount=8`) carry no market value. The adapter now lists Carbon in
    `UNMAPPED_COUNTIES`: its rows read, but none is in scope. A person could map it after reading Carbon
    County's class definitions.
  - **Emery** (49015, 18,691 features) and **San Juan** (49037, 9,401): no property class at all (every row
    `Unknown` or blank), so nothing would be in scope.
- **Parcel keys.** The distinct in-scope `PARCEL_ID`s of the 24 added counties were read
  (`returnDistinctValues`, `PARCEL_ID` only, 31,855 ids). Ids are digits only in five of them (Beaver, Box
  Elder, Davis, Uintah, Weber), digits and letters in Sanpete, and punctuated in the rest (`99-9999-9999`, `A-9999-9999-9999`, `AA99-9999-9` …); dropping punctuation, as the
  registry does, would merge three pairs in Sevier (`1-2-23` and `1-22-3`, `1-41-2` and `1-4-12`, `2-J11-6`
  and `2-J1-16`) and one in Kane (`K-3-11-ANNEX` and `K-3-1-1-ANNEX`). The APN is now `apn_for(Parcel ID)`
  (letters and digits as they are, any other character `x<hex>x`, a literal `x` `xx`, as in
  `ma-massgis-parcels`). A count query for `-`, `.`, space, `/`, `x`, `X`, `:`, `,`, `#`, `&`, `(` and `*` in Salt
  Lake's and Utah County's `PARCEL_ID` returned 0 for both (ids `01364000010000`…`35062000010000` and
  `010010004`…`710960003`), so their parcel ids do not change.
- **Command line.** `main()` used to retire parcels unless `--partial` was given, which is wrong for a
  26-file source. It now retires only with `--full-roll`; `--partial` is still accepted and changes nothing.
- **URL check.** One request per added file, `Range: bytes=0-4095`, through the collector's `PoliteFetcher`
  (user agent; `opendata.gis.utah.gov` robots.txt read and its `Crawl-delay: 60` kept): 21 were redirected to the
  Azure blob (`stg-arcgisazurecdataprod1.az.arcgis.com`) and answered HTTP 206 with the alias header and the right `County Name` and `County ID`. Davis,
  Sevier and Wasatch first answered HTTP 202 ("Up to date download file is being generated") and answered
  206 when asked once more. `Content-Range` gives the full sizes: 340,207,268 bytes for the 24 added
  counties (largest Weber, 53,030,720), so the weekly collector, not this review, archives them.
- **In-scope counts** (the layers' group-by statistics through the adapter's `category()`; distinct
  parcels from `returnDistinctValues` with `returnCountOnly`). The 24 added counties hold **46,048
  in-scope rows** (`B` 11,338, `F1` 34,247, `F2` 463) for **31,855 distinct parcels**; with Salt Lake and Utah
  County, 95,174 rows. Several rows per parcel are common (Davis 6,203 rows for 2,583 parcels).
  `CURRENT_ASOF` ranges from 2020-07-17 (Box Elder) to 2026-10-13; pass each layer's date as `--as-of`.

| County (FIPS)      | Layer item                         | Features | Current as of | In-scope rows |   `B` |   `F1` |  `F2` | Distinct in-scope parcels | Hub CSV bytes | URL check                                                       |
| ------------------ | ---------------------------------- | -------: | ------------- | ------------: | ----: | -----: | ----: | ------------------------: | ------------: | --------------------------------------------------------------- |
| Beaver (49001)     | `fcd55deadaed4fa4bf0cb119b8631b12` |   11,406 | 2025-10-23    |           208 |     0 |    208 |     0 |                       168 |     3,622,504 | HTTP 206 (Range 0-4095)                                         |
| Box Elder (49003)  | `bfda12ed550a4586916faf0db3e2a8a0` |   46,730 | 2020-07-17    |         1,019 |     0 |  1,019 |     0 |                     1,019 |    13,301,871 | HTTP 206 (Range 0-4095)                                         |
| Cache (49005)      | `c3f1604c134043348437d8cd04b9afb2` |   76,763 | 2026-10-13    |         2,759 |     0 |  2,759 |     0 |                     2,092 |    25,354,169 | HTTP 206 (Range 0-4095)                                         |
| Carbon (49007)     | `d0e2d87667a246b397e35ac038a01eeb` |   26,736 | 2025-11-26    |             0 |     0 |      0 |     0 |                         - |             - | left out: own class vocabulary, not mapped                      |
| Daggett (49009)    | `a1e2f3dc1619413f9ba98283940413a9` |    5,217 | 2024-07-17    |           229 |     0 |    229 |     0 |                        97 |     1,786,310 | HTTP 206 (Range 0-4095)                                         |
| Davis (49011)      | `a6e9c713822249129e060c4a26e1fb85` |  152,563 | 2025-11-26    |         6,203 | 1,200 |  5,001 |     2 |                     2,583 |    41,415,129 | HTTP 202 (export being generated), then HTTP 206 (Range 0-4095) |
| Duchesne (49013)   | `581761d051924e97afdd67715f917d83` |   46,443 | 2025-10-23    |           616 |     0 |    616 |     0 |                       546 |    17,494,426 | HTTP 206 (Range 0-4095)                                         |
| Emery (49015)      | `f0bef21aad044f6f94f2a01559f64633` |   18,691 | 2024-07-17    |             0 |     0 |      0 |     0 |                         - |             - | left out: no class (all Unknown or blank)                       |
| Garfield (49017)   | `0d2f76daf7d540edbefea6df6d7345d8` |   17,861 | 2025-10-23    |           197 |     0 |    197 |     0 |                       188 |     5,638,064 | HTTP 206 (Range 0-4095)                                         |
| Grand (49019)      | `b99abea67a144872bb16109f047b447c` |   12,029 | 2025-10-23    |            74 |     0 |     74 |     0 |                        62 |     4,201,292 | HTTP 206 (Range 0-4095)                                         |
| Iron (49021)       | `555d3282b06d44a1a1a2fb7571e200a1` |   68,965 | 2024-07-18    |         7,116 | 4,443 |  2,559 |   114 |                     6,239 |    24,518,863 | HTTP 206 (Range 0-4095)                                         |
| Juab (49023)       | `58eea1dc738f4c389890cf17effd10bf` |   15,259 | 2025-11-26    |           360 |     0 |    360 |     0 |                       359 |     3,543,416 | HTTP 206 (Range 0-4095)                                         |
| Kane (49025)       | `957c4cf3469040a996a8dc34eca0a49a` |   29,136 | 2026-10-13    |           521 |     0 |    521 |     0 |                       258 |     9,396,770 | HTTP 206 (Range 0-4095)                                         |
| Millard (49027)    | `ec382a8a177d4509867d8f920baa1237` |   27,255 | 2025-10-23    |           616 |     0 |    616 |     0 |                       368 |    10,787,287 | HTTP 206 (Range 0-4095)                                         |
| Morgan (49029)     | `c42241c8c58b425a8a971b4772dbcf61` |   14,072 | 2026-10-05    |           275 |     0 |    275 |     0 |                       160 |     4,875,699 | HTTP 206 (Range 0-4095)                                         |
| Piute (49031)      | `d75188a6edcc4af2a128001c89522b32` |    4,851 | 2026-10-13    |           108 |     0 |    108 |     0 |                        66 |     1,995,934 | HTTP 206 (Range 0-4095)                                         |
| Rich (49033)       | `d4b01011ef674732a8787825a14c1a61` |   18,027 | 2026-10-13    |           548 |     0 |    548 |     0 |                       281 |     4,763,516 | HTTP 206 (Range 0-4095)                                         |
| Salt Lake (49035)  | `6f900727e16d4ce1a83f2a1ec1d82e60` |  399,432 | 2026-09-29    |        30,877 | 6,437 | 20,683 | 3,757 |        30,756 (full load) |   163,852,405 | Tier 2 (already loaded)                                         |
| San Juan (49037)   | `2331a0f50ddc4162a0959ebf456d4f6a` |    9,401 | 2024-07-23    |             0 |     0 |      0 |     0 |                         - |             - | left out: no class (all Unknown or blank)                       |
| Sanpete (49039)    | `33e4b5432ba641de92a9e9446ca72d18` |   12,976 | 2025-10-23    |            33 |     0 |     33 |     0 |                        31 |     3,370,654 | HTTP 206 (Range 0-4095)                                         |
| Sevier (49041)     | `ed39f70f6c054ccf85a1e6947b52fec2` |   31,819 | 2025-10-23    |         1,037 |     0 |  1,037 |     0 |                       582 |    12,414,382 | HTTP 202 (export being generated), then HTTP 206 (Range 0-4095) |
| Summit (49043)     | `517326aa554244baabee9e1083086278` |   37,294 | 2025-11-26    |         1,169 |     0 |  1,169 |     0 |                     1,169 |    11,440,462 | HTTP 206 (Range 0-4095)                                         |
| Tooele (49045)     | `7e7839f486d14ff681a8755009d9e2b1` |   45,656 | 2025-10-23    |         1,176 |     0 |  1,176 |     0 |                       617 |    19,647,180 | HTTP 206 (Range 0-4095)                                         |
| Uintah (49047)     | `8d60384263fc4335a955a042091f3d89` |   24,059 | 2025-10-23    |         2,016 | 1,150 |    519 |   347 |                     1,937 |     8,729,102 | HTTP 206 (Range 0-4095)                                         |
| Utah (49049)       | `69477c1143924bc9990cdb930b033fb5` |  289,858 | 2026-09-30    |        18,249 | 5,193 | 13,056 |     0 |        13,639 (full load) |    88,971,898 | Tier 2 (already loaded)                                         |
| Wasatch (49051)    | `f6e1e6e25c304d31948b896d1ca8b980` |   31,843 | 2024-10-31    |           894 |     0 |    894 |     0 |                       887 |    10,353,232 | HTTP 202 (export being generated), then HTTP 206 (Range 0-4095) |
| Washington (49053) | `3685a5539be649079d6d4d3f229972c4` |  137,523 | 2026-09-30    |        12,704 | 4,545 |  8,159 |     0 |                     8,400 |    46,121,911 | HTTP 206 (Range 0-4095)                                         |
| Wayne (49055)      | `260da57dd7694c70bd795a6f1457dc12` |    6,746 | 2025-10-23    |           367 |     0 |    367 |     0 |                       117 |     2,404,375 | HTTP 206 (Range 0-4095)                                         |
| Weber (49057)      | `9d7e4ec3b1a64f6d8b5e7ad76339e703` |  153,163 | 2026-09-29    |         5,803 |     0 |  5,803 |     0 |                     3,629 |    53,030,720 | HTTP 206 (Range 0-4095)                                         |

- **Tests added** (`python/tests/test_adapter_ut_ugrc.py`): all 29 county ids map to their FIPS; the other
  counties' classes and exempt types; Carbon's classes stay unmapped while Weber's load; the APN escape
  (Sevier and Kane pairs, Salt Lake unchanged) and two Sevier ids loading as two parcels; the command line
  does not retire a county loaded earlier.

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
  (Davis's export was being regenerated on 2026-11-03 and still served a 2026-07-01 file.)
- Carbon, Emery and San Juan are not loaded (statewide extension above). Box Elder's layer dates from
  2020-07-17. Sanpete's layer leaves 9,620 of 12,976 rows without a class, so its 33 commercial parcels
  are a floor.
