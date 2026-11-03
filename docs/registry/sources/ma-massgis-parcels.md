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

## Full load (2026-11-03)

Release `data-2026-11-03-41603209834` (draft, maintainers only) of `9mp96ygnbk-alt/factlot`: 176 town zips (`ma-massgis-parcels__<sha16>__L3_SHP_M###_NAME.zip`, 514,571,679 bytes in all) for Middlesex, Worcester, Essex and Norfolk. Each asset's sha256 was checked against the manifest and its first 16 hex characters against the name. The document id of a town is `fl:document:sha256-` plus the file's sha256; its first 16 characters are in the table. Loaded into the Tier 2 scratch registry.

Command, once per town zip (the as-of date comes from each file's fiscal year, so a town on FY2025 is dated 2024-01-01 and one on FY2027 2026-01-01; no `--full-roll`, because the source is 176 files):

```
PYTHONPATH=python/src python3 -m factlot.registry.adapters.ma_massgis <town zip> registry.db --retrieved-at <manifest checked_at>
```

- Rows read: 1,358,109 assessor records (parcels and condominium units) in the 176 towns.
- Records kept: 71,816, which are **71,800** distinct parcels (`B` 15,873, `F1` 41,362, `F2` 14,567); 16 records repeat a `PROP_ID` already loaded (the later replaces the earlier).
- By county:
  - Essex (MA) (FIPS 25009): 14,950 parcels (`B` 3,399, `F1` 8,895, `F2` 2,657); organisation owners 9,941; ownership links 218.
  - Middlesex (MA) (FIPS 25017): 26,930 parcels (`B` 5,831, `F1` 15,709, `F2` 5,391); organisation owners 17,882; ownership links 365.
  - Norfolk (FIPS 25021): 11,839 parcels (`B` 2,295, `F1` 7,125, `F2` 2,419); organisation owners 8,001; ownership links 127.
  - Worcester (FIPS 25027): 18,081 parcels (`B` 4,348, `F1` 9,633, `F2` 4,100); organisation owners 11,672; ownership links 408.
- As-of dates by town: 2021-01-01 1 towns, 2023-01-01 3 towns, 2024-01-01 30 towns, 2025-01-01 106 towns, 2026-01-01 36 towns.
- Facts written: 700,452. Seconds: 106.2 in all. Invalid ids, errors, retired: 0, 0, 0.
- Organisation owners stored (current owner-of-record facts): 47,496; natural persons or withheld owners not stored (names not kept): 23,826.
- Ownership links to registered entities after `link_owners()`: 1,118 (the only entity registry in the scratch file is `ct-sos-entities`).

| Town                   | County | As-of      | Records | Kept  | Asset sha16        |
| ---------------------- | ------ | ---------- | ------- | ----- | ------------------ |
| Acton (M002)           | 017    | 2025-01-01 | 9,372   | 462   | `7bdf0849abe93eb7` |
| Amesbury (M007)        | 009    | 2025-01-01 | 7,041   | 398   | `fb4ddfacdb477766` |
| Andover (M009)         | 009    | 2025-01-01 | 13,277  | 446   | `389df8466c302d50` |
| Arlington (M010)       | 017    | 2025-01-01 | 15,663  | 537   | `d87d7231fcb037ea` |
| Ashburnham (M011)      | 027    | 2024-01-01 | 3,963   | 67    | `da3c49dcfb2ea221` |
| Ashby (M012)           | 017    | 2026-01-01 | 1,773   | 28    | `9c9417f3267b61c0` |
| Ashland (M014)         | 017    | 2025-01-01 | 6,800   | 272   | `56c3078f38227bdc` |
| Athol (M015)           | 027    | 2025-01-01 | 5,685   | 359   | `9aca07dcfb503b96` |
| Auburn (M017)          | 027    | 2025-01-01 | 7,092   | 461   | `2b2641df0e4690d2` |
| Avon (M018)            | 021    | 2025-01-01 | 2,011   | 228   | `845fa3d49b4413b1` |
| Ayer (M019)            | 017    | 2025-01-01 | 3,391   | 358   | `9d3b881ab763da9f` |
| Barre (M021)           | 027    | 2025-01-01 | 3,116   | 128   | `8a593e906110d946` |
| Bedford (M023)         | 017    | 2024-01-01 | 5,047   | 190   | `c21c66da6e0623bb` |
| Bellingham (M025)      | 021    | 2025-01-01 | 6,999   | 299   | `5b3e222518bf6bd9` |
| Belmont (M026)         | 017    | 2023-01-01 | 8,648   | 244   | `90c63729976c6ebd` |
| Berlin (M028)          | 027    | 2025-01-01 | 1,748   | 77    | `5bd0efab115d6f52` |
| Beverly (M030)         | 009    | 2026-01-01 | 13,034  | 744   | `0d91425ccf61ff0a` |
| Billerica (M031)       | 017    | 2025-01-01 | 15,891  | 893   | `bd47850fd113ec57` |
| Blackstone (M032)      | 027    | 2025-01-01 | 3,703   | 187   | `dfaf697f5e1e0e48` |
| Bolton (M034)          | 027    | 2025-01-01 | 2,511   | 46    | `eac36f523bc1da76` |
| Boxborough (M037)      | 017    | 2026-01-01 | 2,613   | 126   | `8dfd898959fe6afd` |
| Boxford (M038)         | 009    | 2025-01-01 | 3,288   | 23    | `5f8ba68c9e2e5e26` |
| Boylston (M039)        | 027    | 2026-01-01 | 2,403   | 73    | `2b07d4e8551cef44` |
| Braintree (M040)       | 021    | 2024-01-01 | 13,497  | 675   | `334cfd601a7e7461` |
| Brookfield (M045)      | 027    | 2025-01-01 | 1,579   | 43    | `87562074aeaa56fe` |
| Brookline (M046)       | 021    | 2026-01-01 | 18,114  | 787   | `f8eea9c9f9888587` |
| Burlington (M048)      | 017    | 2025-01-01 | 8,338   | 508   | `3bf3b16b4eea9da0` |
| Cambridge (M049)       | 017    | 2025-01-01 | 28,812  | 1,987 | `fca6ceb1816f16bb` |
| Canton (M050)          | 021    | 2025-01-01 | 9,009   | 486   | `18b6ecaf494a0b75` |
| Carlisle (M051)        | 017    | 2025-01-01 | 2,240   | 12    | `352be73209583613` |
| Charlton (M054)        | 027    | 2025-01-01 | 6,484   | 266   | `1607f79e3b1ab399` |
| Chelmsford (M056)      | 017    | 2025-01-01 | 14,276  | 666   | `8b8665d7aae78bb6` |
| Clinton (M064)         | 027    | 2026-01-01 | 5,058   | 340   | `4e87c7d12106c26e` |
| Cohasset (M065)        | 021    | 2026-01-01 | 3,514   | 130   | `5eaaa9566a0cdfba` |
| Concord (M067)         | 017    | 2025-01-01 | 7,219   | 375   | `1c78d39a2a9b4164` |
| Danvers (M071)         | 009    | 2024-01-01 | 9,755   | 749   | `1ed6d449a3e16501` |
| Dedham (M073)          | 021    | 2025-01-01 | 9,414   | 367   | `d82112ba4a505438` |
| Douglas (M077)         | 027    | 2026-01-01 | 4,621   | 143   | `9442c4d1e579d6b3` |
| Dover (M078)           | 021    | 2026-01-01 | 2,594   | 29    | `de42c88efa1708a7` |
| Dracut (M079)          | 017    | 2024-01-01 | 12,178  | 499   | `4ace946c89c770ac` |
| Dudley (M080)          | 027    | 2025-01-01 | 5,214   | 236   | `fcf3837baddcb3a1` |
| Dunstable (M081)       | 017    | 2025-01-01 | 1,534   | 23    | `7b02d33e07a9cf31` |
| Eastbrookfield (M084)  | 027    | 2026-01-01 | 1,310   | 53    | `3bfeb99637b97cce` |
| Essex (M092)           | 009    | 2026-01-01 | 2,220   | 83    | `a21a005064edbc57` |
| Everett (M093)         | 017    | 2025-01-01 | 9,453   | 822   | `5c76e4246d531af9` |
| Fitchburg (M097)       | 027    | 2026-01-01 | 13,159  | 1,265 | `25930b434bb90bed` |
| Foxborough (M099)      | 021    | 2024-01-01 | 6,641   | 483   | `04d98e14fc331f1a` |
| Framingham (M100)      | 017    | 2024-01-01 | 20,888  | 1,195 | `22cfb686ef36cf07` |
| Franklin (M101)        | 021    | 2026-01-01 | 11,923  | 465   | `0b2a63ba80d894a3` |
| Gardner (M103)         | 027    | 2025-01-01 | 7,165   | 605   | `c29507ffa6ff1d74` |
| Georgetown (M105)      | 009    | 2025-01-01 | 3,339   | 155   | `7f25599ea31f4917` |
| Gloucester (M107)      | 009    | 2025-01-01 | 14,879  | 919   | `5488b74d32e92e90` |
| Grafton (M110)         | 027    | 2025-01-01 | 7,625   | 315   | `4acf887ce387d829` |
| Groton (M115)          | 017    | 2025-01-01 | 5,139   | 112   | `54823d8fec29286c` |
| Groveland (M116)       | 009    | 2025-01-01 | 2,684   | 83    | `61519ab3e193d247` |
| Hamilton (M119)        | 009    | 2025-01-01 | 3,024   | 55    | `f174cec61d10fca7` |
| Hardwick (M124)        | 027    | 2025-01-01 | 1,634   | 83    | `94488ccba45043fa` |
| Harvard (M125)         | 027    | 2026-01-01 | 2,715   | 60    | `cd32874ec0a891de` |
| Haverhill (M128)       | 009    | 2024-01-01 | 21,650  | 1,172 | `b8f79b029a1d811a` |
| Holbrook (M133)        | 021    | 2021-01-01 | 5,000   | 318   | `187f6650fb9d4072` |
| Holden (M134)          | 027    | 2025-01-01 | 8,754   | 178   | `d0c0e2129ce7747d` |
| Holliston (M136)       | 017    | 2024-01-01 | 6,380   | 298   | `603444b0c0f85232` |
| Hopedale (M138)        | 027    | 2026-01-01 | 2,522   | 161   | `4f6109831649658a` |
| Hopkinton (M139)       | 017    | 2024-01-01 | 7,315   | 162   | `2f39b46f30f3eb35` |
| Hubbardston (M140)     | 027    | 2026-01-01 | 2,601   | 44    | `e5647f3762ec9cf9` |
| Hudson (M141)          | 017    | 2025-01-01 | 7,447   | 432   | `74d40c0957843a0e` |
| Ipswich (M144)         | 009    | 2025-01-01 | 6,283   | 310   | `d2455b6fb73cf11e` |
| Lancaster (M147)       | 027    | 2025-01-01 | 3,205   | 181   | `02174eb680c6766e` |
| Lawrence (M149)        | 009    | 2025-01-01 | 13,830  | 1,868 | `53536d465b1a13dd` |
| Leicester (M151)       | 027    | 2025-01-01 | 5,147   | 213   | `9135ed0f80af9e1f` |
| Leominster (M153)      | 027    | 2025-01-01 | 14,584  | 1,195 | `9b0108c402bc9ce1` |
| Lexington (M155)       | 017    | 2025-01-01 | 12,755  | 481   | `323de212ca05e184` |
| Lincoln (M157)         | 017    | 2026-01-01 | 2,696   | 19    | `88de5f9652c5cf21` |
| Littleton (M158)       | 017    | 2025-01-01 | 4,529   | 206   | `cbaab34655fd3e91` |
| Lowell (M160)          | 017    | 2025-01-01 | 28,134  | 2,446 | `0bee224a3524bba6` |
| Lunenburg (M162)       | 027    | 2026-01-01 | 5,354   | 181   | `ef6d8582e9ee694a` |
| Lynn (M163)            | 009    | 2026-01-01 | 22,025  | 1,311 | `04b0f71da8ee5da9` |
| Lynnfield (M164)       | 009    | 2025-01-01 | 4,641   | 145   | `59d9064f42147a9d` |
| Malden (M165)          | 017    | 2025-01-01 | 13,517  | 760   | `69ccba4f8873bce8` |
| Manchester (M166)      | 009    | 2026-01-01 | 2,692   | 113   | `b75e8a736135e4c2` |
| Marblehead (M168)      | 009    | 2026-01-01 | 8,765   | 327   | `3e0b87a8db89a894` |
| Marlborough (M170)     | 017    | 2024-01-01 | 12,786  | 939   | `54be23c04b0530d7` |
| Maynard (M174)         | 017    | 2025-01-01 | 4,025   | 208   | `0366cc46978c0b7f` |
| Medfield (M175)        | 021    | 2025-01-01 | 4,809   | 177   | `b980c402aefecaa4` |
| Medford (M176)         | 017    | 2025-01-01 | 18,570  | 790   | `aef001adfd3e2f4c` |
| Medway (M177)          | 021    | 2025-01-01 | 5,168   | 245   | `d71d3abfcb8bbcd9` |
| Melrose (M178)         | 017    | 2025-01-01 | 9,489   | 326   | `c91a0147045e7a3c` |
| Mendon (M179)          | 027    | 2025-01-01 | 2,878   | 130   | `2c32aa9804382728` |
| Merrimac (M180)        | 009    | 2025-01-01 | 2,632   | 73    | `40e472143366a434` |
| Methuen (M181)         | 009    | 2024-01-01 | 17,220  | 740   | `4727ca0b86a5d01a` |
| Middleton (M184)       | 009    | 2025-01-01 | 4,029   | 234   | `f7bc0258aac7a0c8` |
| Milford (M185)         | 027    | 2025-01-01 | 10,606  | 727   | `eeb39e4584ce55bb` |
| Millbury (M186)        | 027    | 2024-01-01 | 5,853   | 270   | `564ed46db70297f8` |
| Millis (M187)          | 021    | 2025-01-01 | 4,084   | 148   | `e9398352b71a09de` |
| Millville (M188)       | 027    | 2025-01-01 | 1,345   | 37    | `2997f45020e21d42` |
| Milton (M189)          | 021    | 2024-01-01 | 8,904   | 134   | `fc38113405824b38` |
| Nahant (M196)          | 009    | 2026-01-01 | 1,494   | 15    | `222569b92ad6aa25` |
| Natick (M198)          | 017    | 2026-01-01 | 14,366  | 621   | `985f29140ec99d16` |
| Needham (M199)         | 021    | 2026-01-01 | 10,899  | 428   | `3d0a378dfadce528` |
| Newbraintree (M202)    | 027    | 2025-01-01 | 749     | 15    | `ce9805112f8d388c` |
| Newbury (M205)         | 009    | 2025-01-01 | 3,641   | 86    | `76cf2b399e2481bf` |
| Newburyport (M206)     | 009    | 2025-01-01 | 9,211   | 670   | `68d9b34fc7c0a206` |
| Newton (M207)          | 017    | 2025-01-01 | 30,165  | 890   | `5338ee105a315d23` |
| Norfolk (M208)         | 021    | 2025-01-01 | 4,456   | 143   | `62bdb866c1d36e55` |
| Northandover (M210)    | 009    | 2025-01-01 | 10,810  | 635   | `f3694983ce4b8bb8` |
| Northbrookfield (M212) | 027    | 2025-01-01 | 2,378   | 103   | `a5fb4db540ad7377` |
| Northreading (M213)    | 017    | 2025-01-01 | 6,750   | 317   | `a6a2590a26df9587` |
| Northborough (M215)    | 027    | 2025-01-01 | 5,866   | 320   | `f8697dd8ac584a7b` |
| Northbridge (M216)     | 027    | 2026-01-01 | 6,200   | 365   | `574ff31bd468a105` |
| Norwood (M220)         | 021    | 2024-01-01 | 9,367   | 730   | `ca116239272b40fa` |
| Oakham (M222)          | 027    | 2024-01-01 | 1,037   | 12    | `60b1f062b02d3859` |
| Oxford (M226)          | 027    | 2025-01-01 | 6,063   | 424   | `fe3e1d39bb2df2df` |
| Paxton (M228)          | 027    | 2024-01-01 | 1,995   | 34    | `19fdfa7f40e276bb` |
| Peabody (M229)         | 009    | 2025-01-01 | 16,625  | 915   | `9f5aeecf6fb83bdf` |
| Pepperell (M232)       | 017    | 2026-01-01 | 4,714   | 204   | `b2dc3aa5cab245d6` |
| Petersham (M234)       | 027    | 2025-01-01 | 1,097   | 14    | `245fa4ce426a773a` |
| Phillipston (M235)     | 027    | 2025-01-01 | 1,439   | 25    | `67a2fb02d73dab86` |
| Plainville (M238)      | 021    | 2025-01-01 | 3,311   | 265   | `d674c07c6aaa3a0e` |
| Princeton (M241)       | 027    | 2024-01-01 | 1,943   | 19    | `528bca353cf84341` |
| Quincy (M243)          | 021    | 2026-01-01 | 28,307  | 1,902 | `d771e2b609400aae` |
| Randolph (M244)        | 021    | 2026-01-01 | 10,392  | 350   | `5da4e1ab11201c5b` |
| Reading (M246)         | 017    | 2025-01-01 | 9,453   | 236   | `b9cda4ecb4e661ef` |
| Rockport (M252)        | 009    | 2025-01-01 | 4,503   | 175   | `5d144e7bc2a49d49` |
| Rowley (M254)          | 009    | 2025-01-01 | 3,001   | 145   | `1d0cd112a525a13f` |
| Royalston (M255)       | 027    | 2024-01-01 | 1,314   | 7     | `660ad7223e22ad56` |
| Rutland (M257)         | 027    | 2025-01-01 | 4,647   | 60    | `eb630d65935a1f54` |
| Salem (M258)           | 009    | 2025-01-01 | 13,943  | 1,103 | `b7666f3775faf022` |
| Salisbury (M259)       | 009    | 2025-01-01 | 5,586   | 419   | `f3031adb80cf22ce` |
| Saugus (M262)          | 009    | 2026-01-01 | 10,505  | 514   | `9758f6a4a5106224` |
| Sharon (M266)          | 021    | 2025-01-01 | 6,983   | 127   | `1f3fbe222c37d98b` |
| Sherborn (M269)        | 017    | 2024-01-01 | 2,034   | 27    | `b6ed6e57cf12faa9` |
| Shirley (M270)         | 017    | 2025-01-01 | 2,836   | 135   | `6c120e25ba9ce9d4` |
| Shrewsbury (M271)      | 027    | 2026-01-01 | 13,189  | 437   | `6623946b8eb2efa7` |
| Somerville (M274)      | 017    | 2024-01-01 | 19,013  | 1,332 | `e9992a59482163dc` |
| Southborough (M277)    | 027    | 2026-01-01 | 4,036   | 178   | `ee309b9c2d426baf` |
| Southbridge (M278)     | 027    | 2024-01-01 | 5,826   | 566   | `d97b39a0ace6ad4a` |
| Spencer (M280)         | 027    | 2025-01-01 | 5,300   | 249   | `00c65c88c4c465c5` |
| Sterling (M282)        | 027    | 2025-01-01 | 3,928   | 195   | `18a2fd6d99e45293` |
| Stoneham (M284)        | 017    | 2023-01-01 | 8,027   | 337   | `76671dd1318ec243` |
| Stoughton (M285)       | 021    | 2025-01-01 | 11,128  | 788   | `e266ba93b5064c3d` |
| Stow (M286)            | 017    | 2025-01-01 | 3,099   | 75    | `79e89331326dc539` |
| Sturbridge (M287)      | 027    | 2026-01-01 | 4,755   | 239   | `272bd81b50bc4a46` |
| Sudbury (M288)         | 017    | 2025-01-01 | 7,265   | 211   | `eaf0965241c66715` |
| Sutton (M290)          | 027    | 2025-01-01 | 4,861   | 177   | `a8c33ba9dfb20383` |
| Swampscott (M291)      | 009    | 2026-01-01 | 5,690   | 127   | `188973dd38e1b950` |
| Templeton (M294)       | 027    | 2025-01-01 | 4,203   | 317   | `029be52640c65d5e` |
| Tewksbury (M295)       | 017    | 2026-01-01 | 12,056  | 733   | `37f36607a3923287` |
| Topsfield (M298)       | 009    | 2025-01-01 | 2,560   | 150   | `7f5f57cab82e351b` |
| Townsend (M299)        | 017    | 2025-01-01 | 4,041   | 113   | `1fec2a0586b76d5d` |
| Tyngsborough (M301)    | 017    | 2024-01-01 | 5,281   | 367   | `b33382f5ff4b8eb4` |
| Upton (M303)           | 027    | 2025-01-01 | 3,487   | 94    | `7bae7aaadd58a96c` |
| Uxbridge (M304)        | 027    | 2025-01-01 | 6,426   | 310   | `2904695655a61f34` |
| Wakefield (M305)       | 017    | 2026-01-01 | 9,963   | 501   | `7887035bb164a57f` |
| Walpole (M307)         | 021    | 2025-01-01 | 10,036  | 510   | `dc4f2f6ce1951bab` |
| Waltham (M308)         | 017    | 2025-01-01 | 16,610  | 1,603 | `23e524148e456ded` |
| Warren (M311)          | 027    | 2026-01-01 | 2,589   | 110   | `7e7a0e07ae891890` |
| Watertown (M314)       | 017    | 2025-01-01 | 10,859  | 561   | `243f50fa060453d8` |
| Wayland (M315)         | 017    | 2023-01-01 | 5,714   | 117   | `150980371b05db63` |
| Webster (M316)         | 027    | 2024-01-01 | 6,674   | 559   | `8f08983a7193048b` |
| Wellesley (M317)       | 021    | 2025-01-01 | 9,051   | 257   | `844ea56f77fdde47` |
| Wenham (M320)          | 009    | 2024-01-01 | 1,553   | 21    | `4ad978d93a5f3cf2` |
| Westboylston (M321)    | 027    | 2025-01-01 | 3,275   | 164   | `37ce7b95dc7997cb` |
| Westbrookfield (M323)  | 027    | 2025-01-01 | 2,551   | 83    | `3671a7f52d54e6c5` |
| Westnewbury (M324)     | 009    | 2025-01-01 | 2,078   | 29    | `ed745857ac54df4f` |
| Westborough (M328)     | 027    | 2025-01-01 | 7,177   | 454   | `c5ff010038afcb19` |
| Westford (M330)        | 017    | 2024-01-01 | 9,653   | 403   | `9010f6866c0be6c9` |
| Westminster (M332)     | 027    | 2024-01-01 | 4,167   | 125   | `13c4eccae4a85461` |
| Weston (M333)          | 017    | 2025-01-01 | 4,356   | 57    | `fe09a4755bc179df` |
| Westwood (M335)        | 021    | 2024-01-01 | 5,361   | 149   | `c78660057a5f99c1` |
| Weymouth (M336)        | 021    | 2024-01-01 | 20,383  | 1,001 | `9185a7632c911aca` |
| Wilmington (M342)      | 017    | 2024-01-01 | 9,517   | 489   | `c4c8c68e25f80860` |
| Winchendon (M343)      | 027    | 2025-01-01 | 4,993   | 264   | `c1093e9bacd5ebb8` |
| Winchester (M344)      | 017    | 2025-01-01 | 8,146   | 227   | `f6a152427b94ce5b` |
| Woburn (M347)          | 017    | 2025-01-01 | 14,064  | 1,012 | `b9881b2a02d1af85` |
| Worcester (M348)       | 027    | 2025-01-01 | 47,675  | 4,038 | `8f92b7d358cd90dc` |
| Wrentham (M350)        | 021    | 2025-01-01 | 4,872   | 218   | `8c0165aa6dec98dc` |

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
