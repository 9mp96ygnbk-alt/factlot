# ma-massgis-parcels: MassGIS Level 3 assessors' parcels, Assess table (every town but Boston)

Review record for the source `ma-massgis-parcels` (data policy §5). Reviewed 2026-11-03. Machine-readable
copy: [`registry/sources/ma/ma-massgis-parcels.json`](../../../registry/sources/ma/ma-massgis-parcels.json).
Adapter: `python/src/factlot/registry/adapters/ma_massgis.py` (account system `massgis_prop_id`);
tests: `python/tests/test_adapter_ma_massgis.py`.

**One review clears all four Massachusetts Tier 2 counties** (Middlesex 25017, Worcester 25027, Essex
25009, Norfolk 25021: 176 municipalities, 54 + 60 + 34 + 28). **Owner names are present** (`OWNER1`,
with the owner's mailing address). The same MassGIS release covers the other 175 towns, including
Suffolk County's Boston, Chelsea, Revere and Winthrop; Boston keeps its own source
([ma-boston-assessing](ma-boston-assessing.md)). Since the statewide extension of 2026-11-03 the config
lists all 350 towns except Boston (see that section).

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
- AI use: not addressed. Redistribution: permitted (public domain). **Licence point:** the "not
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

## Statewide extension (2026-11-03)

The licence (the public-domain statement in every town's layer metadata) is the same for every town, so
the extension is configuration, adapter generalisation and testing. The config now lists **350 town
files**, every municipality but Boston, in MassGIS town-id order (`M001` Abington to `M351` Yarmouth): the
176 Tier 2 towns and **174 added towns** in the other ten counties, including Suffolk County's Chelsea
(`M057`), Revere (`M248`) and Winthrop (`M346`).

- **Town list, from the publisher's bucket listing.** `?list-type=2&prefix=shapefiles/l3parcels/L3_SHP_M` on
  the public bucket (one page, `IsTruncated` false) lists exactly 351 zips, one for each town id 1 to 351,
  934,157,232 bytes in all (dates 2021-09-08 to 2026-10-30). The 350 files in the config are 903,134,135
  bytes; the 174 added are 388,562,456.
- **Town to county, from the publisher's town layer.** MassGIS's `shapefiles/state/towns.zip` (2,031,500
  bytes, downloaded once) holds `TOWNS_POLYM.dbf`: 351 rows with `TOWN_ID`, `TOWN` and `FIPS_STCO`. Its
  names match every bucket file name, and its counties match all 176 entries of the old `TOWN_COUNTY`.
  `TOWN_COUNTY` now holds all 350 towns from that table; Boston (35) is in `EXCLUDED_TOWNS`, and the
  adapter raises an error for a Boston file (even with `--county-fips`), so Boston is never loaded twice.
- **Layout and codes, from the files themselves (ranged reads, no full download).** For each added town:
  one `Range: bytes=-65536` request for the zip's central directory, one ranged read of the `M###UC_LUT`
  use-code table, and one ranged read of the first 48 KB of the `M###Assess` table (its dBase header and
  first records). All 174 answered HTTP 206. Every town has one Assess table with the same 37 fields as the
  Tier 2 towns, a `TOWN_ID` equal to its file's id, and a use-code table (`TOWN_ID`, `USE_CODE`,
  `USE_DESC`) whose local codes are the three-digit DOR code plus a local character, as the adapter
  expects; the DOR rows (`TOWN_ID` 0) are the same statewide table. Fiscal years in the Assess file names:
  FY2026 109 towns, FY2027 30, FY2025 26, FY2024 5, FY2022 2; Chatham (`M055`, FY2018) and Pelham (`M230`,
  FY2019) are 2021 files whose table names carry no year. No town needed a mapping change. A few local
  codes sit outside the DOR scheme and stay out of scope: `110` in eleven towns (trailer or mobile-home
  park in most; "APT 4-8 RES" in Middleborough, "Residence, multiunit" in Lanesborough and North Adams),
  `109C` (multiple houses; "Multiple Commercial Apartments on one parcel" in Stockbridge), `1132` "MULTI USE
  COMMERCIAL" in Dennis; and one is inside it: Abington's `302M` "Mixed Use - Store with Single Family
  Home" loads as `F1` (DOR 302, inns and resorts).
- **URL check.** The ranged reads above are the check: every added file answered (206, with a
  `Content-Range` total equal to the listed size), through the collector's `PoliteFetcher` (user agent;
  the S3 endpoint answers `/robots.txt` with 403, which the collector reads as no rules; 2-second
  interval). 523 ranged requests read 21.9 MB in all; no file was read in full.
- **Counts.** The bucket offers no query service, so no in-scope count can be had without the files. The
  Assess tables' dBase headers give the record counts (parcels and condominium units, all classes):
  **1,015,459 records in the 174 added towns**. In-scope counts come with the first full load.

| County (FIPS)      | Towns in config | Towns added |     Bytes added | Assessor records added |
| ------------------ | --------------: | ----------: | --------------: | ---------------------: |
| Barnstable (25001) |              15 |          15 |      72,733,196 |                182,804 |
| Berkshire (25003)  |              32 |          32 |      31,479,849 |                 76,063 |
| Bristol (25005)    |              20 |          20 |      74,783,456 |                202,894 |
| Dukes (25007)      |               7 |           7 |      12,447,520 |                 21,889 |
| Essex (25009)      |              34 |           0 |               0 |                      0 |
| Franklin (25011)   |              26 |          26 |      20,768,455 |                 42,341 |
| Hampden (25013)    |              23 |          23 |      52,887,797 |                165,449 |
| Hampshire (25015)  |              20 |          20 |      24,437,359 |                 65,702 |
| Middlesex (25017)  |              54 |           0 |               0 |                      0 |
| Nantucket (25019)  |               1 |           1 |       3,854,563 |                 14,367 |
| Norfolk (25021)    |              28 |           0 |               0 |                      0 |
| Plymouth (25023)   |              27 |          27 |      88,165,580 |                215,720 |
| Suffolk (25025)    |               3 |           3 |       7,004,681 |                 28,230 |
| Worcester (25027)  |              60 |           0 |               0 |                      0 |
| **All**            |         **350** |     **174** | **388,562,456** |          **1,015,459** |

- **Multi-file loading.** Each town file is loaded without `--full-roll` (the adapter's default), so no
  town retires another's parcels.
- **Tests added** (`python/tests/test_adapter_ma_massgis.py`): the table has all 350 towns and the 14
  counties' town counts; sample towns in every county map to the right FIPS (Chelsea, Revere, Winthrop to
  25025); a Boston file is refused; Chelsea and Springfield files load with their counties.

Added towns (bucket date, Assess member, dBase record count):

| Town (MassGIS id)        | County     | File bytes | Bucket date | Assess table               | Records |
| ------------------------ | ---------- | ---------: | ----------- | -------------------------- | ------: |
| Abington (M001)          | Plymouth   |  1,655,640 | 2026-06-25  | `M001Assess_CY26_FY26.dbf` |   5,877 |
| Acushnet (M003)          | Bristol    |  2,139,339 | 2026-08-27  | `M003Assess_CY26_FY27.dbf` |   4,685 |
| Adams (M004)             | Berkshire  |  1,200,061 | 2026-06-25  | `M004Assess_CY26_FY26.dbf` |   3,654 |
| Agawam (M005)            | Hampden    |  3,558,864 | 2026-05-22  | `M005Assess_CY26_FY26.dbf` |  11,589 |
| Alford (M006)            | Berkshire  |    297,883 | 2026-07-22  | `M006Assess_CY26_FY27.dbf` |     537 |
| Amherst (M008)           | Hampshire  |  3,612,549 | 2026-05-22  | `M008Assess_CY26_FY26.dbf` |   7,317 |
| Ashfield (M013)          | Franklin   |    835,381 | 2025-03-25  | `M013Assess_CY25_FY24.dbf` |   1,334 |
| Attleboro (M016)         | Bristol    |  5,916,622 | 2026-07-22  | `M016Assess_CY26_FY26.dbf` |  15,875 |
| Barnstable (M020)        | Barnstable | 10,526,434 | 2026-03-31  | `M020Assess_CY26_FY26.dbf` |  29,262 |
| Becket (M022)            | Berkshire  |  1,720,424 | 2025-08-19  | `M022Assess_CY25_FY26.dbf` |   4,064 |
| Belchertown (M024)       | Hampshire  |  2,510,215 | 2026-01-29  | `M024Assess_CY26_FY26.dbf` |   6,802 |
| Berkley (M027)           | Bristol    |  1,762,089 | 2025-12-24  | `M027Assess_CY25_FY26.dbf` |   2,920 |
| Bernardston (M029)       | Franklin   |    619,724 | 2026-06-25  | `M029Assess_CY26_FY26.dbf` |   1,365 |
| Blandford (M033)         | Hampden    |    647,496 | 2026-07-22  | `M033Assess_CY26_FY27.dbf` |   1,156 |
| Bourne (M036)            | Barnstable |  4,059,772 | 2025-03-25  | `M036Assess_CY24_FY24.dbf` |  11,879 |
| Brewster (M041)          | Barnstable |  5,103,629 | 2026-10-30  | `M041Assess_CY26_FY27.dbf` |   9,069 |
| Bridgewater (M042)       | Plymouth   |  3,706,755 | 2026-05-22  | `M042Assess_CY26_FY26.dbf` |   9,038 |
| Brimfield (M043)         | Hampden    |  1,188,080 | 2026-05-22  | `M043Assess_CY26_FY26.dbf` |   2,311 |
| Brockton (M044)          | Plymouth   |  7,395,434 | 2025-08-19  | `M044Assess_CY25_FY25.dbf` |  27,085 |
| Buckland (M047)          | Franklin   |    698,528 | 2026-06-25  | `M047Assess_CY26_FY26.dbf` |   1,131 |
| Carver (M052)            | Plymouth   |  1,886,735 | 2025-07-28  | `M052Assess_CY25_FY25.dbf` |   4,724 |
| Charlemont (M053)        | Franklin   |    702,968 | 2026-05-22  | `M053Assess_CY26_FY26.dbf` |     983 |
| Chatham (M055)           | Barnstable |  2,855,409 | 2021-09-08  | `M055Assess.dbf`           |   8,389 |
| Chelsea (M057)           | Suffolk    |  1,408,845 | 2026-09-29  | `M057Assess_CY26_FY26.dbf` |   6,942 |
| Cheshire (M058)          | Berkshire  |    990,788 | 2026-05-22  | `M058Assess_CY26_FY26.dbf` |   1,737 |
| Chester (M059)           | Hampden    |    667,150 | 2026-08-27  | `M059Assess_CY26_FY27.dbf` |   1,154 |
| Chesterfield (M060)      | Hampshire  |    623,333 | 2026-05-22  | `M060Assess_CY26_FY26.dbf` |     972 |
| Chicopee (M061)          | Hampden    |  5,254,544 | 2026-04-28  | `M061Assess_CY26_FY26.dbf` |  18,533 |
| Chilmark (M062)          | Dukes      |  1,865,177 | 2026-05-22  | `M062Assess_CY26_FY26.dbf` |   2,392 |
| Clarksburg (M063)        | Berkshire  |    415,786 | 2025-05-30  | `M063Assess_CY25_FY25.dbf` |     854 |
| Colrain (M066)           | Franklin   |  1,053,352 | 2026-03-31  | `M066Assess_CY26_FY26.dbf` |   1,474 |
| Conway (M068)            | Franklin   |    853,467 | 2025-11-24  | `M068Assess_CY25_FY26.dbf` |   1,415 |
| Cummington (M069)        | Hampshire  |    565,190 | 2026-04-28  | `M069Assess_CY26_FY26.dbf` |     838 |
| Dalton (M070)            | Berkshire  |    836,024 | 2026-02-27  | `M070Assess_CY26_FY26.dbf` |   2,783 |
| Dartmouth (M072)         | Bristol    |  6,705,435 | 2025-10-22  | `M072Assess_CY25_FY26.dbf` |  14,681 |
| Deerfield (M074)         | Franklin   |  1,191,278 | 2026-03-31  | `M074Assess_CY26_FY26.dbf` |   3,266 |
| Dennis (M075)            | Barnstable |  4,266,208 | 2026-09-29  | `M075Assess_CY26_FY26.dbf` |  17,478 |
| Dighton (M076)           | Bristol    |  1,379,027 | 2026-06-25  | `M076Assess_CY26_FY25.dbf` |   3,699 |
| Duxbury (M082)           | Plymouth   |  5,530,630 | 2026-05-22  | `M082Assess_CY26_FY26.dbf` |   6,770 |
| Eastbridgewater (M083)   | Plymouth   |  5,234,101 | 2026-05-22  | `M083Assess_CY26_FY26.dbf` |   5,750 |
| Eastlongmeadow (M085)    | Hampden    |  2,622,308 | 2025-07-28  | `M085Assess_CY25_FY26.dbf` |   6,935 |
| Eastham (M086)           | Barnstable |  6,819,385 | 2026-10-30  | `M086Assess_CY23_FY24.dbf` |   6,765 |
| Easthampton (M087)       | Hampshire  |  2,042,703 | 2026-05-22  | `M087Assess_CY26_FY26.dbf` |   6,373 |
| Easton (M088)            | Bristol    |  3,676,367 | 2026-04-28  | `M088Assess_CY26_FY26.dbf` |   9,385 |
| Edgartown (M089)         | Dukes      |  4,199,085 | 2026-09-29  | `M089Assess_CY26_FY27.dbf` |   6,685 |
| Egremont (M090)          | Berkshire  |    493,071 | 2025-02-28  | `M090Assess_CY25_FY25.dbf` |   1,289 |
| Erving (M091)            | Franklin   |    478,013 | 2026-04-28  | `M091Assess_CY26_FY26.dbf` |     953 |
| Fairhaven (M094)         | Bristol    |  2,928,079 | 2025-02-28  | `M094Assess_CY25_FY25.dbf` |   7,981 |
| Fallriver (M095)         | Bristol    |  5,330,159 | 2026-01-29  | `M095Assess_CY25_FY26.dbf` |  22,060 |
| Falmouth (M096)          | Barnstable | 10,826,754 | 2026-08-17  | `M096Assess_CY22_FY22.dbf` |  24,989 |
| Florida (M098)           | Berkshire  |    575,160 | 2025-11-24  | `M098Assess_CY25_FY25.dbf` |     710 |
| Freetown (M102)          | Bristol    |  1,640,954 | 2026-03-31  | `M102Assess_CY26_FY26.dbf` |   4,188 |
| Aquinnah (M104)          | Dukes      |    580,926 | 2025-05-30  | `M104Assess_CY25_FY25.dbf` |     990 |
| Gill (M106)              | Franklin   |  1,199,542 | 2026-09-29  | `M106Assess_CY26_FY26.dbf` |     879 |
| Goshen (M108)            | Hampshire  |    458,046 | 2025-11-24  | `M108Assess_CY25_FY26.dbf` |   1,036 |
| Gosnold (M109)           | Dukes      |    216,380 | 2026-03-31  | `M109Assess_CY26_FY26.dbf` |     275 |
| Granby (M111)            | Hampshire  |  1,330,677 | 2026-06-25  | `M111Assess_CY26_FY26.dbf` |   3,340 |
| Granville (M112)         | Hampden    |    720,459 | 2025-07-28  | `M112Assess_CY25_FY25.dbf` |   1,001 |
| Greatbarrington (M113)   | Berkshire  |  1,292,799 | 2026-07-22  | `M113Assess_CY26_FY27.dbf` |   4,199 |
| Greenfield (M114)        | Franklin   |  2,126,657 | 2026-08-27  | `M114Assess_CY26_FY27.dbf` |   7,028 |
| Hadley (M117)            | Hampshire  |  1,165,375 | 2026-07-22  | `M117Assess_CY26_FY26.dbf` |   3,146 |
| Halifax (M118)           | Plymouth   |  1,809,540 | 2026-09-29  | `M118Assess_CY26_FY26.dbf` |   3,346 |
| Hampden (M120)           | Hampden    |  1,125,389 | 2026-05-22  | `M120Assess_CY26_FY26.dbf` |   2,400 |
| Hancock (M121)           | Berkshire  |    341,698 | 2026-03-31  | `M121Assess_CY26_FY26.dbf` |   1,003 |
| Hanover (M122)           | Plymouth   |  3,144,341 | 2024-11-26  | `M122Assess_CY24_FY25.dbf` |   5,592 |
| Hanson (M123)            | Plymouth   |  1,676,870 | 2026-08-27  | `M123Assess_CY26_FY26.dbf` |   4,505 |
| Harwich (M126)           | Barnstable |  4,037,553 | 2026-06-25  | `M126Assess_CY25_FY26.dbf` |  12,354 |
| Hatfield (M127)          | Hampshire  |    904,800 | 2026-08-27  | `M127Assess_CY26_FY27.dbf` |   2,182 |
| Hawley (M129)            | Franklin   |    500,171 | 2025-11-24  | `M129Assess_CY25_FY26.dbf` |     357 |
| Heath (M130)             | Franklin   |    581,974 | 2026-04-28  | `M130Assess_CY26_FY26.dbf` |   1,167 |
| Hingham (M131)           | Plymouth   |  5,977,262 | 2026-08-27  | `M131Assess_CY26_FY27.dbf` |   8,886 |
| Hinsdale (M132)          | Berkshire  |    776,988 | 2026-05-22  | `M132Assess_CY26_FY26.dbf` |   1,606 |
| Holland (M135)           | Hampden    |    903,074 | 2026-05-22  | `M135Assess_CY26_FY26.dbf` |   2,346 |
| Holyoke (M137)           | Hampden    |  2,225,745 | 2026-04-28  | `M137Assess_CY26_FY26.dbf` |  10,523 |
| Hull (M142)              | Plymouth   |  1,470,277 | 2026-07-22  | `M142Assess_CY26_FY27.dbf` |   5,683 |
| Huntington (M143)        | Hampshire  |    553,464 | 2026-02-27  | `M143Assess_CY26_FY26.dbf` |   1,459 |
| Kingston (M145)          | Plymouth   |  2,344,780 | 2026-08-27  | `M145Assess_CY26_FY26.dbf` |   5,692 |
| Lakeville (M146)         | Plymouth   |  2,277,703 | 2026-08-27  | `M146Assess_CY26_FY27.dbf` |   5,424 |
| Lanesborough (M148)      | Berkshire  |    827,476 | 2026-04-28  | `M148Assess_CY26_FY26.dbf` |   2,037 |
| Lee (M150)               | Berkshire  |  1,208,780 | 2026-05-22  | `M150Assess_CY26_FY26.dbf` |   3,075 |
| Lenox (M152)             | Berkshire  |  1,128,909 | 2026-04-28  | `M152Assess_CY26_FY26.dbf` |   2,974 |
| Leverett (M154)          | Franklin   |    536,905 | 2026-06-25  | `M154Assess_CY26_FY26.dbf` |   1,214 |
| Leyden (M156)            | Franklin   |    349,399 | 2024-11-26  | `M156Assess_CY24_FY25.dbf` |     704 |
| Longmeadow (M159)        | Hampden    |  1,627,288 | 2026-08-31  | `M159Assess_CY26_FY26.dbf` |   5,885 |
| Ludlow (M161)            | Hampden    |  2,475,413 | 2026-06-25  | `M161Assess_CY26_FY26.dbf` |   9,148 |
| Mansfield (M167)         | Bristol    |  3,267,358 | 2026-02-27  | `M167Assess_CY26_FY26.dbf` |   8,124 |
| Marion (M169)            | Plymouth   |  1,267,349 | 2026-01-29  | `M169Assess_CY25_FY26.dbf` |   3,523 |
| Marshfield (M171)        | Plymouth   |  3,823,711 | 2025-09-18  | `M171Assess_CY25_FY26.dbf` |  12,659 |
| Mashpee (M172)           | Barnstable |  3,551,265 | 2026-10-30  | `M172Assess_CY26_FY27.dbf` |  12,531 |
| Mattapoisett (M173)      | Plymouth   |  1,591,972 | 2026-09-29  | `M173Assess_CY26_FY27.dbf` |   4,661 |
| Middleborough (M182)     | Plymouth   |  3,063,288 | 2026-05-22  | `M182Assess_CY26_FY26.dbf` |   9,882 |
| Middlefield (M183)       | Hampshire  |    433,407 | 2025-11-24  | `M183Assess_CY25_FY26.dbf` |     588 |
| Monroe (M190)            | Franklin   |    189,757 | 2025-04-28  | `M190Assess_CY25_FY25.dbf` |     196 |
| Monson (M191)            | Hampden    |  1,391,568 | 2026-02-27  | `M191Assess_CY26_FY26.dbf` |   4,058 |
| Montague (M192)          | Franklin   |  1,242,321 | 2026-03-31  | `M192Assess_CY26_FY26.dbf` |   4,476 |
| Monterey (M193)          | Berkshire  |    671,011 | 2026-06-25  | `M193Assess_CY26_FY26.dbf` |   1,308 |
| Montgomery (M194)        | Hampden    |    384,285 | 2024-09-19  | `M194Assess_CY24_FY25.dbf` |     521 |
| Mountwashington (M195)   | Berkshire  |    344,350 | 2022-04-24  | `M195Assess_CY22_FY22.dbf` |     291 |
| Nantucket (M197)         | Nantucket  |  3,854,563 | 2026-06-25  | `M197Assess_CY26_FY26.dbf` |  14,367 |
| Newashford (M200)        | Berkshire  |    213,432 | 2026-05-22  | `M200Assess_CY26_FY26.dbf` |     194 |
| Newbedford (M201)        | Bristol    |  6,655,548 | 2026-09-29  | `M201Assess_CY26_FY27.dbf` |  26,677 |
| Newmarlborough (M203)    | Berkshire  |    859,479 | 2025-06-24  | `M203Assess_CY25_FY25.dbf` |   1,931 |
| Newsalem (M204)          | Franklin   |    753,280 | 2026-10-30  | `M204Assess_CY26_FY27.dbf` |     842 |
| Northadams (M209)        | Berkshire  |  1,487,081 | 2025-06-24  | `M209Assess_CY25_FY25.dbf` |   5,402 |
| Northattleborough (M211) | Bristol    |  5,087,874 | 2026-08-28  | `M211Assess_CY26_FY27.dbf` |  11,096 |
| Northampton (M214)       | Hampshire  |  2,976,457 | 2026-02-27  | `M214Assess_CY26_FY26.dbf` |  11,415 |
| Northfield (M217)        | Franklin   |  1,170,610 | 2025-04-28  | `M217Assess_CY25_FY25.dbf` |   2,259 |
| Norton (M218)            | Bristol    |  3,754,917 | 2026-07-22  | `M218Assess_CY26_FY26.dbf` |   7,653 |
| Norwell (M219)           | Plymouth   |  1,685,614 | 2025-08-19  | `M219Assess_CY25_FY26.dbf` |   4,782 |
| Oakbluffs (M221)         | Dukes      |  1,792,075 | 2026-06-25  | `M221Assess_CY26_FY26.dbf` |   5,189 |
| Orange (M223)            | Franklin   |  1,287,528 | 2026-10-30  | `M223Assess_CY26_FY27.dbf` |   3,743 |
| Orleans (M224)           | Barnstable |  2,548,317 | 2026-09-29  | `M224Assess_CY26_FY27.dbf` |   6,367 |
| Otis (M225)              | Berkshire  |  1,312,235 | 2025-09-18  | `M225Assess_CY25_FY25.dbf` |   3,049 |
| Palmer (M227)            | Hampden    |  1,459,948 | 2026-05-22  | `M227Assess_CY26_FY26.dbf` |   5,823 |
| Pelham (M230)            | Hampshire  |    337,964 | 2021-09-08  | `M230Assess.dbf`           |     768 |
| Pembroke (M231)          | Plymouth   |  2,374,124 | 2026-05-22  | `M231Assess_CY26_FY26.dbf` |   7,242 |
| Peru (M233)              | Berkshire  |    367,784 | 2026-07-22  | `M233Assess_CY26_FY26.dbf` |     810 |
| Pittsfield (M236)        | Berkshire  |  6,005,685 | 2025-11-24  | `M236Assess_CY25_FY25.dbf` |  18,341 |
| Plainfield (M237)        | Hampshire  |    456,914 | 2025-11-24  | `M237Assess_CY25_FY25.dbf` |     703 |
| Plymouth (M239)          | Plymouth   | 12,192,403 | 2026-03-31  | `M239Assess_CY26_FY26.dbf` |  30,903 |
| Plympton (M240)          | Plymouth   |  2,971,562 | 2025-07-28  | `M240Assess_CY25_FY25.dbf` |   1,446 |
| Provincetown (M242)      | Barnstable |  1,188,034 | 2026-05-22  | `M242Assess_CY26_FY26.dbf` |   4,984 |
| Raynham (M245)           | Bristol    |  3,067,926 | 2026-01-29  | `M245Assess_CY26_FY26.dbf` |   5,639 |
| Rehoboth (M247)          | Bristol    |  3,583,827 | 2026-09-29  | `M247Assess_CY26_FY27.dbf` |   6,201 |
| Revere (M248)            | Suffolk    |  4,015,583 | 2026-03-31  | `M248Assess_CY26_FY26.dbf` |  15,305 |
| Richmond (M249)          | Berkshire  |    560,358 | 2026-03-31  | `M249Assess_CY26_FY26.dbf` |   1,260 |
| Rochester (M250)         | Plymouth   |  1,057,826 | 2026-04-28  | `M250Assess_CY26_FY26.dbf` |   3,010 |
| Rockland (M251)          | Plymouth   |  1,499,532 | 2026-08-27  | `M251Assess_CY26_FY26.dbf` |   6,182 |
| Rowe (M253)              | Franklin   |    473,296 | 2026-02-27  | `M253Assess_CY26_FY26.dbf` |     675 |
| Russell (M256)           | Hampden    |    725,467 | 2026-08-27  | `M256Assess_CY26_FY26.dbf` |     842 |
| Sandisfield (M260)       | Berkshire  |    651,234 | 2026-04-28  | `M260Assess_CY26_FY26.dbf` |   1,299 |
| Sandwich (M261)          | Barnstable |  3,739,057 | 2026-06-25  | `M261Assess_CY26_FY26.dbf` |  11,353 |
| Savoy (M263)             | Berkshire  |    531,327 | 2025-04-28  | `M263Assess_CY25_FY25.dbf` |     590 |
| Scituate (M264)          | Plymouth   |  3,192,446 | 2025-11-24  | `M264Assess_CY25_FY26.dbf` |   9,471 |
| Seekonk (M265)           | Bristol    |  3,454,261 | 2026-07-22  | `M265Assess_CY26_FY27.dbf` |   6,636 |
| Sheffield (M267)         | Berkshire  |  1,570,812 | 2026-03-31  | `M267Assess_CY26_FY26.dbf` |   2,826 |
| Shelburne (M268)         | Franklin   |    731,914 | 2026-06-25  | `M268Assess_CY26_FY26.dbf` |   1,145 |
| Shutesbury (M272)        | Franklin   |    669,460 | 2026-06-25  | `M272Assess_CY26_FY26.dbf` |   1,374 |
| Somerset (M273)          | Bristol    |  1,924,453 | 2026-09-29  | `M273Assess_CY26_FY27.dbf` |   7,287 |
| Southhadley (M275)       | Hampshire  |  1,896,592 | 2026-04-28  | `M275Assess_CY26_FY26.dbf` |   7,608 |
| Southampton (M276)       | Hampshire  |  1,139,596 | 2026-05-22  | `M276Assess_CY26_FY26.dbf` |   3,085 |
| Southwick (M279)         | Hampden    |  1,426,930 | 2025-04-28  | `M279Assess_CY25_FY25.dbf` |   4,522 |
| Springfield (M281)       | Hampden    | 13,385,348 | 2026-01-29  | `M281Assess_CY26_FY26.dbf` |  44,319 |
| Stockbridge (M283)       | Berkshire  |  1,009,204 | 2026-06-25  | `M283Assess_CY26_FY26.dbf` |   1,958 |
| Sunderland (M289)        | Franklin   |    591,224 | 2025-09-18  | `M289Assess_CY25_FY26.dbf` |   1,536 |
| Swansea (M292)           | Bristol    |  2,181,782 | 2026-09-29  | `M292Assess_CY26_FY26.dbf` |   7,992 |
| Taunton (M293)           | Bristol    |  6,305,719 | 2025-11-24  | `M293Assess_CY25_FY26.dbf` |  20,923 |
| Tisbury (M296)           | Dukes      |  1,154,069 | 2025-05-30  | `M296Assess_CY25_FY25.dbf` |   3,556 |
| Tolland (M297)           | Hampden    |    630,218 | 2026-02-27  | `M297Assess_CY26_FY26.dbf` |   1,121 |
| Truro (M300)             | Barnstable |  2,211,628 | 2026-10-30  | `M300Assess_CY26_FY27.dbf` |   3,966 |
| Tyringham (M302)         | Berkshire  |    354,133 | 2025-10-22  | `M302Assess_CY25_FY25.dbf` |     574 |
| Wales (M306)             | Hampden    |    467,531 | 2025-04-28  | `M306Assess_CY25_FY25.dbf` |   1,232 |
| Ware (M309)              | Hampshire  |  1,594,374 | 2026-08-27  | `M309Assess_CY26_FY27.dbf` |   4,573 |
| Wareham (M310)           | Plymouth   |  6,631,364 | 2026-08-27  | `M310Assess_CY26_FY27.dbf` |  14,902 |
| Warwick (M312)           | Franklin   |    462,171 | 2026-08-27  | `M312Assess_CY26_FY27.dbf` |     786 |
| Washington (M313)        | Berkshire  |    711,872 | 2026-04-28  | `M313Assess_CY26_FY26.dbf` |     603 |
| Wellfleet (M318)         | Barnstable |  3,086,132 | 2026-08-27  | `M318Assess_CY26_FY27.dbf` |   5,332 |
| Wendell (M319)           | Franklin   |    684,153 | 2026-10-30  | `M319Assess_CY26_FY27.dbf` |     847 |
| Westbridgewater (M322)   | Plymouth   |  1,289,747 | 2026-08-27  | `M322Assess_CY26_FY27.dbf` |   3,320 |
| Westspringfield (M325)   | Hampden    |  3,458,386 | 2026-08-27  | `M325Assess_CY23_FY24.dbf` |   9,724 |
| Weststockbridge (M326)   | Berkshire  |    617,951 | 2026-05-22  | `M326Assess_CY26_FY26.dbf` |   1,148 |
| Westtisbury (M327)       | Dukes      |  2,639,808 | 2026-09-29  | `M327Assess_CY26_FY27.dbf` |   2,802 |
| Westfield (M329)         | Hampden    |  3,949,195 | 2025-11-24  | `M329Assess_CY25_FY25.dbf` |  14,108 |
| Westhampton (M331)       | Hampshire  |    492,597 | 2024-05-21  | `M331Assess_CY24_FY24.dbf` |   1,239 |
| Westport (M334)          | Bristol    |  4,021,720 | 2026-01-29  | `M334Assess_CY26_FY26.dbf` |   9,192 |
| Whately (M337)           | Franklin   |    785,382 | 2025-12-24  | `M337Assess_CY25_FY26.dbf` |   1,192 |
| Whitman (M338)           | Plymouth   |  1,414,574 | 2025-08-19  | `M338Assess_CY25_FY26.dbf` |   5,365 |
| Wilbraham (M339)         | Hampden    |  2,593,111 | 2025-11-24  | `M339Assess_CY25_FY26.dbf` |   6,198 |
| Williamsburg (M340)      | Hampshire  |    722,374 | 2026-09-03  | `M340Assess_CY26_FY26.dbf` |   1,380 |
| Williamstown (M341)      | Berkshire  |  1,519,589 | 2026-04-28  | `M341Assess_CY26_FY26.dbf` |   3,080 |
| Windsor (M345)           | Berkshire  |    586,465 | 2026-04-28  | `M345Assess_CY26_FY26.dbf` |     877 |
| Winthrop (M346)          | Suffolk    |  1,580,253 | 2026-06-25  | `M346Assess_CY26_FY26.dbf` |   5,983 |
| Worthington (M349)       | Hampshire  |    620,732 | 2026-03-31  | `M349Assess_CY26_FY26.dbf` |     878 |
| Yarmouth (M351)          | Barnstable |  7,913,619 | 2026-05-22  | `M351Assess_CY26_FY26.dbf` |  18,086 |

## Statewide full load (2026-11-03)

Release `data-2026-11-03-41618090881` (draft, maintainers only) of `9mp96ygnbk-alt/factlot`: 174 town zips (`ma-massgis-parcels__<sha16>__L3_SHP_M###_NAME.zip`, 388,562,456 bytes in all) and the source's manifest, downloaded with `gh release download` into an empty directory and read as untrusted data (`python3 -I`, scripts kept outside the directory). Each file's sha256 was checked against the manifest (and its byte size and document id), and its first 16 hex characters against the name: 174 of 174 matched. The manifest also lists 176 archived entries that are in the earlier release `data-2026-11-03-41603209834` (the Full load above), not in this one. A file's document id is `fl:document:sha256-` plus its sha256; its first 16 characters are the `sha16` column. Loaded into the same Tier 2 scratch registry as the Full load, after it; `purge_person_owners()` and `link_owners()` were then run once for all five statewide sources together.

Command, once per town zip (the as-of date comes from each file's fiscal year, so a town on FY2026 is dated 2025-01-01; no `--full-roll`, because the source is 350 files):

```
PYTHONPATH=python/src python3 -m factlot.registry.adapters.ma_massgis <town zip> registry.db --retrieved-at <manifest checked_at>
```

- Records read: 56,124 assessor records (parcels and condominium units) of the 1,015,459 in the 174 towns' Assess tables (all classes, per the statewide extension); in-scope records kept 56,124, which are **56,122** distinct parcels (`B` 10,316, `F1` 36,319, `F2` 9,487); 2 records repeat a `PROP_ID` already loaded (the later replaces the earlier).
- With the four Tier 2 counties every town but Boston is loaded: 127,922 parcels in 14 counties (26,189 `B`, 77,681 `F1`, 24,054 `F2`), 82,558 with an organisation owner of record and 2,079 ownership links. Boston is loaded from its own Tier 1 source and is refused by this adapter.
- As-of dates by town: 2017-01-01 1 town, 2018-01-01 1 town, 2021-01-01 2 towns, 2023-01-01 5 towns, 2024-01-01 26 towns, 2025-01-01 109 towns, 2026-01-01 30 towns.
- Facts written: 537,254. Adapter seconds: 99.0. Invalid ids, errors, retired: 0, 0, 0.
- Organisation owners stored (parcels with a current owner-of-record fact): 35,062; natural persons or withheld owners not stored (names not kept): 21,049.
- Ownership links to registered entities after `link_owners()`: 961 (the only entity registry in the scratch file is `ct-sos-entities`).

Essex, Middlesex, Norfolk and Worcester gained no towns (their 176 towns are in the Full load above). By county for the ten counties that gained towns (Suffolk is only Chelsea, Revere and Winthrop):

| County (FIPS)       | Towns loaded |    Records |    Parcels |        `B` |       `F1` |      `F2` | Organisation owners | Ownership links |
| ------------------- | -----------: | ---------: | ---------: | ---------: | ---------: | --------: | ------------------: | --------------: |
| Barnstable (25001)  |           15 |      8,600 |      8,600 |        365 |      7,331 |       904 |               5,082 |              72 |
| Berkshire (25003)   |           32 |      3,990 |      3,990 |        904 |      2,298 |       788 |               2,570 |              44 |
| Bristol (25005)     |           20 |     13,148 |     13,148 |      4,087 |      6,966 |     2,095 |               7,548 |             257 |
| Dukes (25007)       |            7 |      1,024 |      1,024 |         19 |        954 |        51 |                 543 |               6 |
| Franklin (25011)    |           26 |      2,443 |      2,443 |        368 |      1,333 |       742 |               1,540 |             100 |
| Hampden (25013)     |           23 |     10,140 |     10,140 |      1,948 |      6,258 |     1,934 |               7,160 |             326 |
| Hampshire (25015)   |           20 |      3,675 |      3,673 |        594 |      2,458 |       621 |               2,178 |              76 |
| Nantucket (25019)   |            1 |        686 |        686 |         35 |        625 |        26 |                 505 |               0 |
| Plymouth (25023)    |           27 |     10,313 |     10,313 |      1,188 |      6,971 |     2,154 |               6,609 |              78 |
| Suffolk (25025)     |            3 |      2,105 |      2,105 |        808 |      1,125 |       172 |               1,327 |               2 |
| **All 10 counties** |      **174** | **56,124** | **56,122** | **10,316** | **36,319** | **9,487** |          **35,062** |         **961** |

By town (`County` is the 3-digit county FIPS; `Kept` is in-scope records):

| Town (MassGIS id)        | County | As-of      | Records |  Kept | Asset sha16        |
| ------------------------ | ------ | ---------- | ------: | ----: | ------------------ |
| Abington (M001)          | 023    | 2025-01-01 |     329 |   329 | `0a8fa003102d5a39` |
| Acushnet (M003)          | 005    | 2026-01-01 |     113 |   113 | `9aef79150fe1ecbc` |
| Adams (M004)             | 003    | 2025-01-01 |     328 |   328 | `c315aad625c8fb37` |
| Agawam (M005)            | 013    | 2025-01-01 |     543 |   543 | `34836b3fe0f4a40c` |
| Alford (M006)            | 003    | 2026-01-01 |       1 |     1 | `81b7739a725877ef` |
| Amherst (M008)           | 015    | 2025-01-01 |     351 |   351 | `1ac11cd6b10693cb` |
| Ashfield (M013)          | 011    | 2023-01-01 |      23 |    23 | `5dbcbb2743056930` |
| Attleboro (M016)         | 005    | 2025-01-01 |     967 |   967 | `426decc97a9daf0d` |
| Barnstable (M020)        | 001    | 2025-01-01 |   1,844 | 1,844 | `be4956a9a43e9764` |
| Becket (M022)            | 003    | 2025-01-01 |      23 |    23 | `0dcaf4def8ff7f2e` |
| Belchertown (M024)       | 015    | 2025-01-01 |     179 |   179 | `5d013d7112bcac49` |
| Berkley (M027)           | 005    | 2025-01-01 |      50 |    50 | `1a0dd0e6e1f19046` |
| Bernardston (M029)       | 011    | 2025-01-01 |      52 |    52 | `96cb11a65f66ad46` |
| Blandford (M033)         | 013    | 2026-01-01 |      10 |    10 | `4ea09caf3cd20002` |
| Bourne (M036)            | 001    | 2023-01-01 |     728 |   728 | `776f5fedff3fa14e` |
| Brewster (M041)          | 001    | 2026-01-01 |     212 |   212 | `0711afef42ee2d3e` |
| Bridgewater (M042)       | 023    | 2025-01-01 |     437 |   437 | `2b985efaa3a71ca7` |
| Brimfield (M043)         | 013    | 2025-01-01 |      89 |    89 | `d2ccd49595ff9560` |
| Brockton (M044)          | 023    | 2024-01-01 |   2,072 | 2,072 | `c5ae50b98b8312b0` |
| Buckland (M047)          | 011    | 2025-01-01 |      54 |    54 | `f412c2802a12417f` |
| Carver (M052)            | 023    | 2024-01-01 |     228 |   228 | `e6a8f8da502b280a` |
| Charlemont (M053)        | 011    | 2025-01-01 |      36 |    36 | `c090b33bfdc60b31` |
| Chatham (M055)           | 001    | 2017-01-01 |     454 |   454 | `8f329d3f2fbb1639` |
| Chelsea (M057)           | 025    | 2025-01-01 |     875 |   875 | `8d97fb5745f3ca39` |
| Cheshire (M058)          | 003    | 2025-01-01 |      48 |    48 | `2d3f1b5f1eb007c0` |
| Chester (M059)           | 013    | 2026-01-01 |      28 |    28 | `35335f95555660cf` |
| Chesterfield (M060)      | 015    | 2025-01-01 |      11 |    11 | `df3528e6533ae2b5` |
| Chicopee (M061)          | 013    | 2025-01-01 |   1,378 | 1,378 | `3bba4a64240babd7` |
| Chilmark (M062)          | 007    | 2025-01-01 |      22 |    22 | `571805c606f58ab0` |
| Clarksburg (M063)        | 003    | 2024-01-01 |      14 |    14 | `16c7b34e994333b2` |
| Colrain (M066)           | 011    | 2025-01-01 |      30 |    30 | `3b9b4443e5efc830` |
| Conway (M068)            | 011    | 2025-01-01 |      30 |    30 | `419fea6c60eca978` |
| Cummington (M069)        | 015    | 2025-01-01 |      18 |    18 | `dfae61e0200368c6` |
| Dalton (M070)            | 003    | 2025-01-01 |     131 |   131 | `5e19b377ec5b8742` |
| Dartmouth (M072)         | 005    | 2025-01-01 |     682 |   682 | `efed977e018402c1` |
| Deerfield (M074)         | 011    | 2025-01-01 |     247 |   247 | `bf1a2fff1d20bc5a` |
| Dennis (M075)            | 001    | 2025-01-01 |     746 |   746 | `b62f4c9d2325ec67` |
| Dighton (M076)           | 005    | 2024-01-01 |     105 |   105 | `7d1a46294e6930e0` |
| Duxbury (M082)           | 023    | 2025-01-01 |     124 |   124 | `9c66f6e5011f5f08` |
| Eastbridgewater (M083)   | 023    | 2025-01-01 |     304 |   304 | `0c6a5aeaf5a3fd0b` |
| Eastlongmeadow (M085)    | 013    | 2025-01-01 |     373 |   373 | `45210bd54c2ac51a` |
| Eastham (M086)           | 001    | 2023-01-01 |     176 |   176 | `8539b267756d32e7` |
| Easthampton (M087)       | 015    | 2025-01-01 |     439 |   439 | `3f7fb654adf23f79` |
| Easton (M088)            | 005    | 2025-01-01 |     429 |   429 | `49c10d310b18cfa6` |
| Edgartown (M089)         | 007    | 2026-01-01 |     383 |   383 | `76abe33bcbe9ecf0` |
| Egremont (M090)          | 003    | 2024-01-01 |      16 |    16 | `36042f7f64c6af2c` |
| Erving (M091)            | 011    | 2025-01-01 |      94 |    94 | `6f495c4288a03770` |
| Fairhaven (M094)         | 005    | 2024-01-01 |     346 |   346 | `d57326de58ccd4e5` |
| Fallriver (M095)         | 005    | 2025-01-01 |   3,168 | 3,168 | `6667667ea81b5b55` |
| Falmouth (M096)          | 001    | 2021-01-01 |     846 |   846 | `3f34b7813c555f6b` |
| Florida (M098)           | 003    | 2024-01-01 |      21 |    21 | `fd5faffb3f9fdc94` |
| Freetown (M102)          | 005    | 2025-01-01 |     147 |   147 | `8b8691cc0126ef97` |
| Aquinnah (M104)          | 007    | 2024-01-01 |      18 |    18 | `f45b1208d03d89d5` |
| Gill (M106)              | 011    | 2025-01-01 |      75 |    75 | `a08e9df08b684812` |
| Goshen (M108)            | 015    | 2025-01-01 |      22 |    22 | `04746722bc3596f9` |
| Gosnold (M109)           | 007    | 2025-01-01 |       5 |     5 | `2a1c04614e79d070` |
| Granby (M111)            | 015    | 2025-01-01 |      96 |    96 | `ca0d46925dcabd0e` |
| Granville (M112)         | 013    | 2024-01-01 |      27 |    27 | `5af90dcec62951cc` |
| Greatbarrington (M113)   | 003    | 2026-01-01 |     346 |   346 | `a6b4095b417a3d22` |
| Greenfield (M114)        | 011    | 2026-01-01 |     641 |   641 | `0e863b8d6c42665d` |
| Hadley (M117)            | 015    | 2025-01-01 |     379 |   379 | `199869889e7fc842` |
| Halifax (M118)           | 023    | 2025-01-01 |      88 |    88 | `17b0028f885d0c8e` |
| Hampden (M120)           | 013    | 2025-01-01 |      62 |    62 | `f1e3642a630de05e` |
| Hancock (M121)           | 003    | 2025-01-01 |      40 |    40 | `95a1f2a8968f8713` |
| Hanover (M122)           | 023    | 2024-01-01 |     431 |   431 | `360f014c1ff8efc0` |
| Hanson (M123)            | 023    | 2025-01-01 |     148 |   148 | `9c83ffbc30e64e2e` |
| Harwich (M126)           | 001    | 2025-01-01 |     411 |   411 | `6ce32f5b07018122` |
| Hatfield (M127)          | 015    | 2026-01-01 |     268 |   268 | `e3a0e1c6fc254058` |
| Hawley (M129)            | 011    | 2025-01-01 |       0 |     0 | `3c695e1a27dc479a` |
| Heath (M130)             | 011    | 2025-01-01 |       6 |     6 | `bc5cc91252e67bfd` |
| Hingham (M131)           | 023    | 2026-01-01 |     404 |   404 | `e6e935995e69518a` |
| Hinsdale (M132)          | 003    | 2025-01-01 |      64 |    64 | `684c17f7d0d0789d` |
| Holland (M135)           | 013    | 2025-01-01 |      21 |    21 | `00c547bfc8f82aec` |
| Holyoke (M137)           | 013    | 2025-01-01 |   1,176 | 1,176 | `d43f304ac6a6c1cf` |
| Hull (M142)              | 023    | 2026-01-01 |     133 |   133 | `0fa87c6877a01cef` |
| Huntington (M143)        | 015    | 2025-01-01 |      31 |    31 | `9138c9cc9d3db93d` |
| Kingston (M145)          | 023    | 2025-01-01 |     250 |   250 | `462d0a35024e9179` |
| Lakeville (M146)         | 023    | 2026-01-01 |     154 |   154 | `2453fbcbd81d15d5` |
| Lanesborough (M148)      | 003    | 2025-01-01 |     104 |   104 | `68f1b4912ad5a1d6` |
| Lee (M150)               | 003    | 2025-01-01 |     248 |   248 | `3ff267ed4c2e6ed4` |
| Lenox (M152)             | 003    | 2025-01-01 |     166 |   166 | `cfe183832f0ef986` |
| Leverett (M154)          | 011    | 2025-01-01 |      16 |    16 | `6ea73c66965a1165` |
| Leyden (M156)            | 011    | 2024-01-01 |       4 |     4 | `be422bac7b04299f` |
| Longmeadow (M159)        | 013    | 2025-01-01 |      39 |    39 | `d95590f46a6115b8` |
| Ludlow (M161)            | 013    | 2025-01-01 |     470 |   470 | `7d85cc1845cd104a` |
| Mansfield (M167)         | 005    | 2025-01-01 |     402 |   402 | `0a052cf78a9c8619` |
| Marion (M169)            | 023    | 2025-01-01 |     150 |   150 | `077f326c265a864e` |
| Marshfield (M171)        | 023    | 2025-01-01 |     424 |   424 | `ffb2263eebd177d5` |
| Mashpee (M172)           | 001    | 2026-01-01 |     470 |   470 | `49ec81dd4682aaa8` |
| Mattapoisett (M173)      | 023    | 2026-01-01 |     166 |   166 | `e542fb0bd1adb2b0` |
| Middleborough (M182)     | 023    | 2025-01-01 |     681 |   681 | `2f07ffcab8b54aae` |
| Middlefield (M183)       | 015    | 2025-01-01 |       7 |     7 | `bf54ed9b242cd680` |
| Monroe (M190)            | 011    | 2024-01-01 |      14 |    14 | `227b12c2f51a29c8` |
| Monson (M191)            | 013    | 2025-01-01 |     156 |   156 | `5c25043b819fbffb` |
| Montague (M192)          | 011    | 2025-01-01 |     393 |   393 | `9af3ce6425f2ad19` |
| Monterey (M193)          | 003    | 2025-01-01 |      10 |    10 | `7dd19811f22027cf` |
| Montgomery (M194)        | 013    | 2024-01-01 |       5 |     5 | `560d407fe2397cd8` |
| Mountwashington (M195)   | 003    | 2021-01-01 |       2 |     2 | `dd24c2c92a15867d` |
| Nantucket (M197)         | 019    | 2025-01-01 |     686 |   686 | `afc1ac0dd9a04c62` |
| Newashford (M200)        | 003    | 2025-01-01 |       7 |     7 | `1afd0b0332d1c3d7` |
| Newbedford (M201)        | 005    | 2026-01-01 |   2,820 | 2,820 | `6463e481ec2aa7bc` |
| Newmarlborough (M203)    | 003    | 2024-01-01 |      34 |    34 | `5b4370ca95211891` |
| Newsalem (M204)          | 011    | 2026-01-01 |      10 |    10 | `c3460747b853a9da` |
| Northadams (M209)        | 003    | 2024-01-01 |     495 |   495 | `65b4b5df64bbf284` |
| Northattleborough (M211) | 005    | 2026-01-01 |     625 |   625 | `bdb35d8cf97c5748` |
| Northampton (M214)       | 015    | 2025-01-01 |   1,104 | 1,104 | `c8009b81f1595f62` |
| Northfield (M217)        | 011    | 2024-01-01 |     106 |   106 | `60df509d95bb5226` |
| Norton (M218)            | 005    | 2025-01-01 |     326 |   326 | `c74e4a45a86ab203` |
| Norwell (M219)           | 023    | 2025-01-01 |     290 |   290 | `66a0ca72384d0da6` |
| Oakbluffs (M221)         | 007    | 2025-01-01 |     183 |   183 | `08344ac200e19cf9` |
| Orange (M223)            | 011    | 2026-01-01 |     256 |   256 | `a1a1dd1044dd0ef9` |
| Orleans (M224)           | 001    | 2026-01-01 |     485 |   485 | `887a09a6cc801018` |
| Otis (M225)              | 003    | 2024-01-01 |      48 |    48 | `237c38748d194017` |
| Palmer (M227)            | 013    | 2025-01-01 |     475 |   475 | `c560688d0e796d14` |
| Pelham (M230)            | 015    | 2018-01-01 |      16 |    16 | `74d9f4cbcf63edec` |
| Pembroke (M231)          | 023    | 2025-01-01 |     285 |   285 | `69f777083bc890c3` |
| Peru (M233)              | 003    | 2025-01-01 |       3 |     3 | `760cbdbf2b60e942` |
| Pittsfield (M236)        | 003    | 2024-01-01 |   1,405 | 1,405 | `99da5deba47c50b3` |
| Plainfield (M237)        | 015    | 2024-01-01 |      30 |    30 | `6b9faa8d491aad39` |
| Plymouth (M239)          | 023    | 2025-01-01 |   1,192 | 1,192 | `3fdf6378c1cec4d0` |
| Plympton (M240)          | 023    | 2024-01-01 |      59 |    59 | `ae7ba1093df275eb` |
| Provincetown (M242)      | 001    | 2025-01-01 |     431 |   431 | `9cf54e9b4e26c6e1` |
| Raynham (M245)           | 005    | 2025-01-01 |     313 |   313 | `cf1e1cadd6192adb` |
| Rehoboth (M247)          | 005    | 2026-01-01 |     137 |   137 | `0cb6556c050d9247` |
| Revere (M248)            | 025    | 2025-01-01 |     942 |   942 | `12b763147d8d727e` |
| Richmond (M249)          | 003    | 2025-01-01 |      14 |    14 | `3584d528fe57841c` |
| Rochester (M250)         | 023    | 2025-01-01 |      88 |    88 | `26cbc84b2caa49ea` |
| Rockland (M251)          | 023    | 2025-01-01 |     419 |   419 | `0a8f7b6ef3cf0654` |
| Rowe (M253)              | 011    | 2025-01-01 |      83 |    83 | `cbc4d1ea9bf2dfbe` |
| Russell (M256)           | 013    | 2025-01-01 |      54 |    54 | `a819cc01e96cc781` |
| Sandisfield (M260)       | 003    | 2025-01-01 |      11 |    11 | `712aeaa1a09e3ff9` |
| Sandwich (M261)          | 001    | 2025-01-01 |     483 |   483 | `e4e32c4989d561ee` |
| Savoy (M263)             | 003    | 2024-01-01 |       1 |     1 | `d3ca5713fb545dd8` |
| Scituate (M264)          | 023    | 2025-01-01 |     163 |   163 | `6a573d9242031cde` |
| Seekonk (M265)           | 005    | 2026-01-01 |     451 |   451 | `1dbb42dd7e4555f4` |
| Sheffield (M267)         | 003    | 2025-01-01 |     134 |   134 | `9bcb70c646ddd529` |
| Shelburne (M268)         | 011    | 2025-01-01 |      94 |    94 | `0114fdfae7e96a26` |
| Shutesbury (M272)        | 011    | 2025-01-01 |       9 |     9 | `5963d4acb1cc4ffd` |
| Somerset (M273)          | 005    | 2026-01-01 |     258 |   258 | `4be730917fe10543` |
| Southhadley (M275)       | 015    | 2025-01-01 |     291 |   291 | `88830a32dee24682` |
| Southampton (M276)       | 015    | 2025-01-01 |      81 |    81 | `b1238bb1a96fbcdc` |
| Southwick (M279)         | 013    | 2024-01-01 |     175 |   175 | `60d956bc68972f92` |
| Springfield (M281)       | 013    | 2025-01-01 |   3,017 | 3,017 | `9a9ab6d63c3644f2` |
| Stockbridge (M283)       | 003    | 2025-01-01 |      51 |    51 | `a50acb1c240f3052` |
| Sunderland (M289)        | 011    | 2025-01-01 |      87 |    87 | `f7e90dbe5c57324a` |
| Swansea (M292)           | 005    | 2025-01-01 |     306 |   306 | `bcdf7bf400034b36` |
| Taunton (M293)           | 005    | 2025-01-01 |   1,166 | 1,166 | `c4979bab548f86c6` |
| Tisbury (M296)           | 007    | 2024-01-01 |     337 |   337 | `7510f739a6f237fd` |
| Tolland (M297)           | 013    | 2025-01-01 |      15 |    15 | `c5ca52f47162f1a5` |
| Truro (M300)             | 001    | 2026-01-01 |      90 |    90 | `4ab2e1fa63ff66d0` |
| Tyringham (M302)         | 003    | 2024-01-01 |       1 |     1 | `b63d45a01a3931e7` |
| Wales (M306)             | 013    | 2024-01-01 |      11 |    11 | `f5febe05b3e12f74` |
| Ware (M309)              | 015    | 2026-01-01 |     275 |   275 | `e61c17ecac8bb5c5` |
| Wareham (M310)           | 023    | 2026-01-01 |     682 |   682 | `2b2d99300c93d4b1` |
| Warwick (M312)           | 011    | 2026-01-01 |       1 |     1 | `241e60b86c881a1e` |
| Washington (M313)        | 003    | 2025-01-01 |      10 |    10 | `56de891d80eb3cde` |
| Wellfleet (M318)         | 001    | 2026-01-01 |     104 |   104 | `97f29055175c886f` |
| Wendell (M319)           | 011    | 2026-01-01 |      15 |    15 | `f78642a31b0275af` |
| Westbridgewater (M322)   | 023    | 2026-01-01 |     310 |   310 | `9cc390c9b9e75252` |
| Westspringfield (M325)   | 013    | 2023-01-01 |     918 |   918 | `5f2dac64bb55cb0e` |
| Weststockbridge (M326)   | 003    | 2025-01-01 |      55 |    55 | `5d5243fe48818a85` |
| Westtisbury (M327)       | 007    | 2026-01-01 |      76 |    76 | `8bb7a4efaca0ef4e` |
| Westfield (M329)         | 013    | 2024-01-01 |     863 |   863 | `d0a3037dee8d3275` |
| Westhampton (M331)       | 015    | 2023-01-01 |      17 |    17 | `b71d19f5ae29cc0b` |
| Westport (M334)          | 005    | 2025-01-01 |     337 |   337 | `670cf96c7d5d1297` |
| Whately (M337)           | 011    | 2025-01-01 |      67 |    67 | `1aa32ed8b66f72d6` |
| Whitman (M338)           | 023    | 2025-01-01 |     302 |   302 | `83fa5fddc4f5f240` |
| Wilbraham (M339)         | 013    | 2025-01-01 |     235 |   235 | `aebcbd2ef426a0ef` |
| Williamsburg (M340)      | 015    | 2025-01-01 |      55 |    55 | `1f0424e74e90ef21` |
| Williamstown (M341)      | 003    | 2025-01-01 |     140 |   140 | `d7d08d79645abc5c` |
| Windsor (M345)           | 003    | 2025-01-01 |      19 |    19 | `456723e1ad2cb31f` |
| Winthrop (M346)          | 025    | 2025-01-01 |     288 |   288 | `b66a173d2a080e33` |
| Worthington (M349)       | 015    | 2025-01-01 |       5 |     5 | `2d4645c3eefb2ba9` |
| Yarmouth (M351)          | 001    | 2025-01-01 |   1,120 | 1,120 | `e3c8cf47115e822d` |

## Known gaps

- **The 174 towns added on 2026-11-03 are loaded.** The sentence that they were not loaded yet was overtaken
  the same day by the statewide full load above, and the 2026-11-06 collection below archived the same 350
  files again. Chatham and Pelham remain the old files (FY2018, as-of 2017-01-01; FY2019, as-of 2018-01-01).
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
- `TOWN_COUNTY` covers every town but Boston; Boston raises an error (it is `ma-boston-assessing`), and a
  town id outside 1-351 raises one unless `--county-fips` is given.
- Local codes outside the DOR scheme (`110`, `109C`, `1132`; see the statewide extension) stay out of scope,
  including Middleborough's "APT 4-8 RES".

## Release collected 2026-11-06

The S3 listing was read again on 2026-11-06 (`list-type=2`, prefix `shapefiles/l3parcels/L3_SHP_M`,
`IsTruncated` false): 351 zips, 934,157,232 bytes, `Last-Modified` from 2021-09-08 through 2026-10-30,
the same byte total as the 2026-11-03 listing. `L3_SHP_M035_BOSTON.zip` (31,023,097 bytes, modified
2026-10-30) was left in the bucket. The collector archived the other 350 files (903,134,135 bytes, every
size matching the listing, every `sha16` matching the November 3 paths). The registry built from that
archive holds the same 127,922 parcels. The Tier 1 audit and the pass/fail by county
are in [ma-massgis-parcels.md](../quality/audit-2026-11-06/ma-massgis-parcels.md). No county passes: the audit
has one violation (57 extra facts where a repeated `PROP_ID` kept two values), and every county includes a
town whose assessment as-of is more than 400 days before 2026-11-06.

The as-of date is 1 January of the year before the file's `FY` column, which matches the `FY##` in the
Assess filename wherever the filename has one. Sixty-six towns are FY2027 (as-of 2026-01-01, 309 days
before 2026-11-06). The other 284 are older: FY2026 215 towns, FY2025 56, FY2024 8, FY2022 3, FY2019 1
(Pelham), FY2018 1 (Chatham).

Each zip's Assess table metadata still contains the recorded public-domain sentence, read 2026-11-06 in all
350 files. The Massachusetts DOR use-code mapping used for the counts is documented in the quality note. A
published commercial-parcel total is unavailable (the mass.gov page returns 403 and the zips have no
summary count). Counted from these Assess tables, the publisher's commercial series 300–393 is 77,695
records, the industrial series 400–452 is 24,055, and apartment codes 111, 112 and 114 are 26,190.
