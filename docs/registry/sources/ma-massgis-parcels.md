# ma-massgis-parcels: MassGIS Level 3 assessors' parcels, Assess table (Middlesex, Worcester, Essex, Norfolk)

Review record for the source `ma-massgis-parcels` (data policy §5). Reviewed 2026-11-03. Machine-readable
copy: [`registry/sources/ma/ma-massgis-parcels.json`](../../../registry/sources/ma/ma-massgis-parcels.json).
Adapter: `python/src/factlot/registry/adapters/ma_massgis.py` (account system `massgis_prop_id`);
tests: `python/tests/test_adapter_ma_massgis.py`.

**One review clears all four Massachusetts Tier 2 counties** (Middlesex 25017, Worcester 25027, Essex
25009, Norfolk 25021: 176 municipalities, 54 + 60 + 34 + 28). **Owner names are present** (`OWNER1`,
with the owner's mailing address). The same MassGIS release covers the other 175 towns, including
Suffolk County's Boston, Chelsea, Revere and Winthrop; Boston keeps its own source
([ma-boston-assessing](ma-boston-assessing.md)) and the other towns can be added by extending
`TOWN_COUNTY` in the adapter and the file list in the config.

## Publisher and URLs

- Publisher: MassGIS, the Commonwealth's Bureau of Geographic Information, which collects each
  municipality's assessor-maintained parcel map and a standardized extract of its assessing database
  ("Level 3" under the MassGIS Standard for Digital Parcels). Data page (terms page):
  <https://www.mass.gov/info-details/massgis-data-property-tax-parcels>. **mass.gov answers the
  collector with 403 "Not allowed"** (its robots.txt could not be read either), so that page was not read
  by the collector; the licence text below comes from the metadata packed in the downloads.
- Downloads: the public bucket `download.massgis.digital.mass.gov`, read through the S3 REST endpoint
  (the website alias does not answer HTTPS):
  `https://s3.us-east-1.amazonaws.com/download.massgis.digital.mass.gov/shapefiles/l3parcels/L3_SHP_M###_NAME.zip`,
  one zip per municipality (351 in the bucket, 935 MB in all, listed with
  `?list-type=2&prefix=shapefiles/l3parcels/L3_SHP_M`). The four counties' 176 files total 514,571,679
  bytes (Middlesex 178.4 MB, Worcester 132.2 MB, Essex 112.5 MB, Norfolk 91.5 MB); the largest is 13.5
  MB (Boston's, not used, is 31 MB), so no file nears the 50 MB limit. The same bucket also holds
  per-town file geodatabases (`gdbs/l3parcels/M###_parcels_gdb.zip`) and statewide aggregates
  (`L3_AGGREGATE_FGDB_*.zip` 7.2-8.5 GB, `L3_AGGREGATE_SHP_*.zip` 6.6-7.8 GB; not used).
- Each town zip holds `M###Assess_CY##_FY##.dbf` (the assessor table), `M###UC_LUT_*.dbf` (use-code
  lookup), `M###_LUT_*.dbf`, the parcel shapefiles (`TaxPar`, `Misc`, `OthLeg`), and per-file ISO metadata
  (`*.xml`). The shapefile edition was chosen over the geodatabase because its Assess table is a plain
  `.dbf` that Python's standard library can read; the geodatabase needs GDAL.

## Terms, license, robots

- Licence, read in the file metadata `M049TaxPar_CY25_FY26.shp.xml` (Cambridge; same text in the other
  towns' layer metadata), elements `useLimit` and `resConst`: "This parcel data is in the public domain
  and should not be redistributed for a fee beyond reproduction costs." and "This data may be
  appropriate for planning purposes. It should not be utilized where legal and surveyed property
  boundaries are required." The abstract adds: "This data enters the public domain as a valuable
  resource for mapping, planning, and analysis at all levels."
- AI use: not addressed. Redistribution: permitted (public domain). **Flag for the founder:** the "not
  redistributed for a fee beyond reproduction costs" sentence limits selling the parcel data itself. The
  open registry is free, so `verified: true`; a paid tier that resells these facts needs a reading of
  that sentence (or MassGIS's view) first.
- Attribution given anyway: "MassGIS and the municipal assessing departments". The layer metadata
  credits each municipality (for Cambridge: "City of Cambridge, MA").
- robots.txt: the S3 endpoint answers `403 AccessDenied` to `/robots.txt` (the collector reads a 4xx as
  no rules); `maps.massgis.digital.mass.gov` disallows only the `gsa-crawler` agent. mass.gov could not
  be read (above).
- `verified: true`: licence read and recorded; file URLs confirmed by real downloads through the
  collector (10 towns, all `archived`); the licence is a public-domain statement and does not restrict AI
  use.

## What the file contains

`M###Assess_CY##_FY##.dbf`: dBase III, UTF-8 (per its `.cpg`), 37 fields, one record per assessor
record (a parcel, or a condominium unit). Key columns (widths from the file header):

| Column                                                   | Use                                                                                                      |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `PROP_ID` (30)                                           | Assessor's parcel id, unique within a town only (`7-115`). Becomes the APN, with the town id (`apn_for`) |
| `LOC_ID` (18)                                            | Join key to the parcel polygons; not used                                                                |
| `USE_CODE` (4)                                           | DOR property type code (3 digits) plus a local digit; the table below                                    |
| `OWNER1`, `OWN_ADDR`, `OWN_CITY`, `OWN_STATE`, `OWN_ZIP` | Owner of record and mailing address. `OWN_CO` (care-of) is not copied                                    |
| `SITE_ADDR`, `ADDR_NUM`, `FULL_STR`, `CITY`, `ZIP`       | Situs (`SITE_ADDR` first; `ZIP` is often blank)                                                          |
| `LOT_SIZE`, `LOT_UNITS` (`A`/`S`)                        | Land area (acres or square feet)                                                                         |
| `BLD_AREA`, `YEAR_BUILT`, `UNITS`                        | Building area, year built, units (`UNITS` not used)                                                      |
| `TOTAL_VAL`, `BLDG_VAL`, `LAND_VAL`, `OTHER_VAL`         | Full and fair cash value (`TOTAL_VAL` → `market_value`)                                                  |
| `FY`                                                     | Fiscal year (→ `tax_year`); the town's own: FY2025, FY2026 and FY2027 files are current together         |
| `TOWN_ID`                                                | MassGIS town id, mapped to county FIPS in `TOWN_COUNTY`                                                  |

Parcel-key note: `PROP_ID` values contain `-`, `/`, `.` and spaces, and the registry reduces an APN to
lower-case letters and digits, so `7-115` and `71-15` would be the same parcel. Cambridge alone has 485
such colliding pairs. The adapter's APN is the 3-digit town id plus the id with every other character
escaped (`7-115` in Cambridge is `0497x2dx115`); the raw id is kept in the crosswalk (`M049:7-115`) and the
locator.

Use-code mapping (`state_category`; the publisher's table is `M###UC_LUT`, `TOWN_ID` 0 rows; the code
stays in `local_use_code`):

| State code (first 3 characters) | Publisher's description                                                                        | Category |
| ------------------------------- | ---------------------------------------------------------------------------------------------- | -------- |
| `111`                           | Apartments with four to eight units                                                            | `B`      |
| `112`                           | Apartments with more than eight units                                                          | `B`      |
| `114`                           | Affordable Housing Units (greater than 50% of the units qualify)                               | `B`      |
| `300`-`393`                     | Commercial: hotels (`300`) through commercial land (`390`-`392`)                               | `F1`     |
| `400`-`452`                     | Industrial: manufacturing (`400`), warehouses (`401`), R&D, mining, utilities, industrial land | `F2`     |
| `0xx`                           | Mixed use                                                                                      | none     |
| `101`-`109`, `121`-`140`, `199` | Other residential (`102` condominiums), congregate housing, land                               | none     |
| `9xx`                           | Tax-exempt                                                                                     | none     |

## Gates

None for the downloads. Two things a person should know:

1. **mass.gov blocks automated clients**, so the data page, the Standard for Digital Parcels and the
   MassGIS FAQ were not read; nothing in this source needs them, but a person confirming the licence
   would find the same sentence on the data page.
2. **The fee clause** under Terms (above).

## Real run

Run 2026-11-03 on 10 towns across the four counties, archived by the collector's own `snapshot` from the
config (`collected/ma-massgis-parcels/<sha16>/L3_SHP_M###_NAME.zip`, 67.9 MB in all, 6 minutes). Each
town was loaded with `python -m factlot.registry.adapters.ma_massgis <zip> registry.db` (the as-of
date comes from the file's fiscal year) into a fresh SQLite file:

| Town (county FIPS)   | Fiscal year / as-of | Records | Kept   | `F1`  | `F2`  | `B`   | Owners (organisations stored) |
| -------------------- | ------------------- | ------- | ------ | ----- | ----- | ----- | ----------------------------- |
| Cambridge (25017)    | FY2026 / 2025-01-01 | 28,812  | 1,987  | 1,004 | 184   | 799   | 1,987 (1,213)                 |
| Lowell (25017)       | FY2026 / 2025-01-01 | 28,134  | 2,446  | 1,145 | 409   | 892   | 2,445 (1,773)                 |
| Newton (25017)       | FY2026 / 2025-01-01 | 30,165  | 890    | 682   | 73    | 135   | 890 (554)                     |
| Framingham (25017)   | FY2025 / 2024-01-01 | 20,888  | 1,195  | 819   | 108   | 268   | 1,195 (815)                   |
| Worcester (25027)    | FY2026 / 2025-01-01 | 47,675  | 4,038  | 2,115 | 509   | 1,414 | 4,037 (2,658)                 |
| Fitchburg (25027)    | FY2027 / 2026-01-01 | 13,159  | 1,265  | 700   | 218   | 347   | 1,265 (674)                   |
| Lynn (25009)         | FY2027 / 2026-01-01 | 22,025  | 1,311  | 675   | 126   | 510   | 1,311 (944)                   |
| Salem (25009)        | FY2026 / 2025-01-01 | 13,943  | 1,103  | 663   | 98    | 342   | 1,103 (769)                   |
| Quincy (25021)       | FY2027 / 2026-01-01 | 28,307  | 1,902  | 899   | 83    | 920   | 1,902 (992)                   |
| Brookline (25021)    | FY2027 / 2026-01-01 | 18,114  | 787    | 447   | 7     | 333   | 787 (524)                     |
| **Total (10 towns)** |                     | 251,222 | 16,924 | 9,149 | 1,815 | 5,960 | 16,922 (10,916)               |

- By county: Middlesex 6,518 kept (`B` 2,094, `F1` 3,650, `F2` 774); Worcester 5,303 (1,761, 2,815,
  727); Essex 2,414 (852, 1,338, 224); Norfolk 2,689 (1,253, 1,346, 90).
- Facts written 166,309; organisation owners stored 10,916; natural persons or withheld (names not
  stored) 6,006; invalid ids, errors, retired: 0, 0, 0. All 10 towns parse and load in 6.3 seconds
  together. Situs present on every kept record; market value on all but 16; land area on 15,133;
  building area on 13,405 (Framingham's table has no building area).
- Apartment codes among the kept records: `111` 4,366, `112` 1,354, `114` 240 (all 10 towns,
  counted by code). Largest commercial codes: `325` small retail 1,327, `340` general office 1,279, `337`
  parking lots 1,001, `316` other storage 652, `332` auto repair 619.
- Parcel-key collisions after the escape: 0; 32 repeated `PROP_ID`s inside the 10 tables (one record is
  kept; the later one replaces the earlier).
- Snapshot ids (`fl:document:sha256-` + the sha256 of the town zip, first 16 characters): Cambridge
  `fca6ceb1816f16bb`, Lowell `0bee224a3524bba6`, Newton `5338ee105a315d23`, Framingham `22cfb686ef36cf07`,
  Worcester `8f92b7d358cd90dc`, Fitchburg `25930b434bb90bed`, Lynn `04b0f71da8ee5da9`, Salem
  `b7666f3775faf022`, Quincy `d771e2b609400aae`, Brookline `f8eea9c9f9888587`.

## Known gaps

- **166 more towns were not loaded**; they are in the config and follow the same layout. Their counts
  are unknown (the 10 loaded towns range from 787 to 4,038 records).
- **Towns update on their own schedules**: file dates in the bucket run from 2021 to 2026, and a town's
  fiscal year may be a year behind (Framingham is FY2025). Each snapshot carries its own as-of date; no
  statewide "current" date exists.
- **Apartments of four to eight units** (`111`, 4,366 of the 5,960 `B` records here) are inside `B` as in
  the Boston source; the table has a `UNITS` column that was not used to test for five or more. Mixed
  use (`0xx`) is out of scope as in Boston, a large share of town-centre retail.
- **Condominium units**: commercial condominiums appear as separate records (one `PROP_ID` per unit)
  and are kept; the parcel polygon is shared (`LOC_ID`), so unit-level and parcel-level facts cannot be
  told apart from this table.
- **Owners**: no confidentiality flag; upper-case, sometimes with a trailing comma (the adapter trims
  `, `); trusts are kept as organisations by the registry's own rule.
- **Only `TOTAL_VAL`** is used; there is no separate appraised value. `tax_year` is the town's `FY`.
- The geodatabase edition is not read (it would need GDAL); the town zips already hold the same table.
- `TOWN_COUNTY` covers only the four counties; an unlisted town raises an error unless `--county-fips` is
  given.
