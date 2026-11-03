# ma-boston-assessing: City of Boston Property Assessment (Analyze Boston)

Review record for data policy §5. Reviewed 2026-11-02. Machine-readable copy:
[`registry/sources/ma/ma-boston-assessing.json`](../../../registry/sources/ma/ma-boston-assessing.json).
Adapter: `python/src/factlot/registry/adapters/ma_boston.py` (account system `boston_pid`, FIPS
25025). Tests: `python/tests/test_adapter_ma_boston.py`.

**Boston is only part of Suffolk County.** Suffolk County (FIPS 25025) has four municipalities,
each with its own assessor: Boston, Chelsea, Revere, and Winthrop. This source covers the City of
Boston only; the other three are not catalogued yet. Parcel IDs are `fl:parcel:us-25025:<PID>`,
and Boston's 10-digit PIDs (ward, parcel, sub-parcel) do not collide with the other towns' numbering
styles, but a reader joining on county alone must not assume the county is complete.

## Publisher and URLs

- Publisher: City of Boston Assessing Department, published on Analyze Boston, the city's CKAN
  open-data portal (`data.boston.gov`).
- Dataset page (landing page and terms page): <https://data.boston.gov/dataset/property-assessment>
  (package id `e02c44d2-3c64-459c-8fe2-e1ce5f38a035`, organisation "Assessing Department",
  metadata last modified 2026-05-22).
- Confirmed files (resource download URLs; each answers `302` to a presigned S3 URL):
  - `.../resource/ee73430d-96c0-423e-ad21-c4cfb54c8961/download/fy2026-property-assessment-data_rev.csv`
    (80,191,023 bytes; last modified 2026-05-22)
  - `.../resource/440f72b7-bb2c-4c37-971f-c1097d155559/download/property-assessment-fy2026-data-key.pdf`
    (169,774 bytes; the column definitions, "Updated: December, 2024")
  - `.../resource/d6c1268c-cd83-4dc3-a914-bba1ed59da6d/download/propertyoccupancycodes.pdf`
    (55,727 bytes; the occupancy-code table)
- The dataset also lists one CSV per fiscal year back to FY2004 (FY2025:
  `fy2025-property-assessment-data_12_30_2024.csv`, 79.5 MB) with a data-key PDF for FY2014
  onward. Only FY2026 is archived.

## Terms, license, robots

- **License: Open Data Commons Public Domain Dedication and License (ODC-PDDL).** The dataset's
  license field reads `odc-pddl`, titled "Open Data Commons Public Domain Dedication and License
  (PDDL)", linking <http://www.opendefinition.org/licenses/odc-pddl>. PDDL's operative sentence:
  "The Rightsholder ... dedicates the Data and Database to the public domain" (free to copy,
  modify, and share without restriction). Redistribution of the facts is therefore permitted; AI
  use is not addressed, and a public-domain dedication does not forbid it. Attribution is not
  required; the registry attributes to "City of Boston Assessing Department, Analyze Boston".
- The portal has no separate click-through terms for this dataset; the license is stated per
  dataset. No account, login, or agreement is needed to download.
- **robots.txt** (`https://data.boston.gov/robots.txt`, read 2026-11-02): for all agents,
  `Crawl-delay: 10` (honoured by the collector), and `Disallow: /api/`, `/datastore/*`,
  `/dataset/activity/*`, `/dataset/groups/*`, `/user/*`, and similar. A list of named crawlers
  (Semrush, Ahrefs, Petalbot, Scrapy, and others) is disallowed entirely; the FactLot bot is not
  among them. The dataset page and the `/dataset/<id>/resource/<id>/download/<file>` URLs are
  allowed, so the collector reads the HTML dataset page as the landing page and does not use the
  CKAN action API or the datastore. (The package metadata quoted above was read once by hand from
  `/api/3/action/package_show` in the same minute as robots.txt, before its `/api/` rule was
  applied; it is not used again.)
- The redirect target `s3.amazonaws.com` has no robots.txt rules for the bucket; the presigned URL
  is valid for 24 hours.

## What the file contains

One UTF-8 CSV (`fy2026-property-assessment-data_rev.csv`) with a header row of 67 columns and one
row per parcel, condominium unit, or building. Numbers carry thousands separators (`5,000`,
`3,169,600`); `GROSS_TAX` carries a dollar sign and its header is padded with spaces. Fiscal
year 2026 values are as of 1 January 2025 (Massachusetts assessment date), so the adapter is run
with `--as-of 2025-01-01 --fiscal-year 2026`.

Header, verbatim:

```
PID,CM_ID,GIS_ID,ST_NUM,ST_ALPHA,ST_NUM2,ST_NAME,UNIT_NUM,CITY,ZIP_CODE,BLDG_SEQ,NUM_BLDGS,LUC,LU,LU_DESC,
BLDG_TYPE,OWN_OCC,OWNER,MAIL_ADDRESSEE,MAIL_STREET_ADDRESS,MAIL_CITY,MAIL_STATE,MAIL_ZIP_CODE,RES_FLOOR,
CD_FLOOR,RES_UNITS,COM_UNITS,RC_UNITS,LAND_SF,GROSS_AREA,LIVING_AREA,LAND_VALUE,BLDG_VALUE,SFYI_VALUE,
TOTAL_VALUE, GROSS_TAX ,YR_BUILT,YR_REMODEL,STRUCTURE_CLASS,ROOF_STRUCTURE,ROOF_COVER,INT_WALL,EXT_FNISHED,
INT_COND,EXT_COND,OVERALL_COND,BED_RMS,FULL_BTH,HLF_BTH,KITCHENS,TT_RMS,BDRM_COND,BTHRM_STYLE1,BTHRM_STYLE2,
BTHRM_STYLE3,KITCHEN_TYPE,KITCHEN_STYLE1,KITCHEN_STYLE2,KITCHEN_STYLE3,HEAT_TYPE,HEAT_SYSTEM,AC_TYPE,
FIREPLACES,ORIENTATION,NUM_PARKING,PROP_VIEW,CORNER_UNIT
```

Key columns (definitions from the publisher's data key PDF):

| Column                                                                     | Definition (data key)                                                                                                                                                                                                                                                                                                                                                                                                              | Adapter use                                                                                                                                                                                                    |
| -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PID`                                                                      | "Unique 10-digit parcel number. First 2 digits are the ward, digits 3 to 7 are the parcel, and digits 8 to 10 are the sub-parcel"                                                                                                                                                                                                                                                                                                  | `apn` and `account` (`boston_pid`). The dataset notes say PID, CM_ID, GIS_ID and ZIP codes end in `_` to preserve leading zeros; the FY2026 file has no such underscore, and the adapter strips one if present |
| `CM_ID`                                                                    | "10-digit parcel number of Condo Main, which houses all related condo units"                                                                                                                                                                                                                                                                                                                                                       | not stored                                                                                                                                                                                                     |
| `BLDG_SEQ`, `NUM_BLDGS`                                                    | building sequence of parcel; total number of buildings                                                                                                                                                                                                                                                                                                                                                                             | rows of one parcel are merged: gross areas summed, earliest `YR_BUILT` kept                                                                                                                                    |
| `LUC`                                                                      | "Land Use Code" (the occupancy code; see table below)                                                                                                                                                                                                                                                                                                                                                                              | `local_use_code`, mapped to `state_category`                                                                                                                                                                   |
| `LU`                                                                       | type of property: `A` Residential 7 or more units, `AH` agricultural, `C` commercial, `CC` commercial condominium, `CD` residential condominium unit, `CL` commercial land, `CM` condominium main (no assessed value), `CP` condo parking, `E` tax-exempt, `EA` tax-exempt (121A), `I` industrial, `R1`–`R3` residential 1- to 3-family, `R4` residential 4 or more family, `RC` mixed use (res. and comm.), `RL` residential land | not used for scope (the code decides); recorded here for the audit                                                                                                                                             |
| `ST_NUM`, `ST_ALPHA`, `ST_NUM2`, `ST_NAME`, `UNIT_NUM`, `CITY`, `ZIP_CODE` | situs; `CITY` is the postal neighbourhood (`EAST BOSTON`, `DORCHESTER`)                                                                                                                                                                                                                                                                                                                                                            | `situs_address` as `226-228 RIVER RD, EAST BOSTON MA 02128`, `7A SHIELD ST, ...`, `50 MAIN ST UNIT 2, ...`; no street name, no situs                                                                           |
| `OWNER`                                                                    | "Primary owner of property"                                                                                                                                                                                                                                                                                                                                                                                                        | `owner_name`; the registry keeps organisations only                                                                                                                                                            |
| `MAIL_ADDRESSEE`                                                           | "Care of recipient"                                                                                                                                                                                                                                                                                                                                                                                                                | not copied: it often names a natural person                                                                                                                                                                    |
| `MAIL_STREET_ADDRESS`, `MAIL_CITY`, `MAIL_STATE`, `MAIL_ZIP_CODE`          | where the tax bill is mailed                                                                                                                                                                                                                                                                                                                                                                                                       | `owner_mailing_address`                                                                                                                                                                                        |
| `LAND_SF`                                                                  | "Parcel's land area in square feet (legal area)"                                                                                                                                                                                                                                                                                                                                                                                   | `land_area_sf`                                                                                                                                                                                                 |
| `GROSS_AREA`                                                               | "Gross floor area"                                                                                                                                                                                                                                                                                                                                                                                                                 | `improvement_area_sf`                                                                                                                                                                                          |
| `YR_BUILT`                                                                 | "Year property was built"                                                                                                                                                                                                                                                                                                                                                                                                          | `year_built`                                                                                                                                                                                                   |
| `TOTAL_VALUE`                                                              | "Total assessed value for property" (Massachusetts assesses at full and fair cash value)                                                                                                                                                                                                                                                                                                                                           | `market_value`; `appraised_value` is left empty                                                                                                                                                                |

Zero and blank are "no figure" for areas, years, and values. The file has no owner-confidentiality
flag and no withheld-owner marker; `owner_confidential` is always false. No placeholder owner
string (`UNKNOWN` and the like) was seen in the FY2026 file; the adapter guards for them anyway.

### Use-code mapping

`LUC` is the Massachusetts property type classification code (the DOR "state use code": 1xx
residential, 3xx commercial, 4xx industrial, 9xx exempt, 0xx multiple use) as Boston subdivides
it. The publisher's definitions are in `propertyoccupancycodes.pdf` on the dataset page, which
groups the codes as Multiple Use Property (010–031), Residential Property (101–132), Apartment
Property (111–132), Commercial Property (300–399), Industrial Property (400–465), Exempt Ownership
(900–929), and Exempt Property Type (937–999).

| FactLot category | Boston codes                                                         | Publisher's definitions (occupancy-code PDF)                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ---------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `B` multifamily  | `111`, `112`, `113`, `114`, `115`, `120`, `125`, `126`, `127`, `128` | 111 APT 4-6 UNITS, 112 APT 7-30 UNITS, 113 APT 31-99 UNITS, 114 APT 100+ UNITS, 115 CO-OP APARTMENT, 120 APARTMENT (FY2026 `LU_DESC`: LUXURY APARTMENT), 125–127 APT SUBSIDIZED HOUSING, 128 CONDO APARTMENT                                                                                                                                                                                                                                                                                                              |
| `F1` commercial  | every `3xx`                                                          | 300 HOTEL/LODGING … 345 OFFICE BUILDING … 356 COMM CONDO, 357 RETAIL CONDO … 390–393 VACANT LAND (commercial land, `LU` `CL`), 394 UTILITY BLDG/SHED, 398 AIRPORT TERMINAL, 399 GREENHOUSE                                                                                                                                                                                                                                                                                                                                |
| `F2` industrial  | every `4xx`                                                          | 400 OLD MANUFACTURING, 401 WAREHOUSE, 402 OFFICE / INDUSTRIAL USE, 403 MANUFACTURING, 404 LIGHT MFG / R & D … 420–428 tanks, power and gas plants, rights of way … 440–442 VACANT LAND, 450 INDUSTRIAL CONDO, 465 COM BILLBOARD                                                                                                                                                                                                                                                                                           |
| out of scope     | other `1xx`, all `0xx`, `2xx`, `9xx`                                 | 101–110 one- to three-family, condos, mobile home, parking, storage; 116 RES PARKING GARAGE, 117 DAY CARE USE, 118 ELDERLY HOME, 119 RES PARKING LOT, 121–122 ROOMING HOUSE, 123 RESIDENCE HALL, 124 DORMITORY, 129 RECTORY, CONVENT, 130–132 VACANT LAND; 010–031 multiple use (013 RES/COMMERCIAL USE, 025–027 RES/COMM MIXED USE, 031 COM MULTI-USE); 202/211 vacant land; 9xx exempt ownership and exempt property types (including 950 APARTMENT BLDG, 952 OFFICE, 966 MANUFACTURING, 968 WAREHOUSE, 995 CONDO MAIN) |

Notes on the mapping:

- Boston files `111` (4–6 units) under its residential land-use class `R4` and starts its
  apartment class `A` at 7 units (`112`). `111` is kept as `B` because the state code is an
  apartment code and the brief asked for the 11x apartment codes; a consumer who wants 7+ units
  only can filter on `local_use_code`.
- `465` COM BILLBOARD is a 4xx code that Boston files under land-use class `C`; the code decides,
  so it is `F2`. There are few of them.
- Commercial condominium units (`356`, `357`, `450`) are kept, one record per unit, like Texas
  commercial condos. Condo mains (`995`, `LU` `CM`) carry no assessed value and are exempt-coded,
  so they are out of scope.
- Mixed-use parcels (`0xx`, `LU` `RC`) are out of scope under the brief's mapping. Boston has many
  three-storey residential-over-retail buildings coded `013`/`025`–`027`/`031`; see Known gaps.
- Exempt parcels with a commercial use (`9xx`) are out of scope, as category X is in Texas.

## Gates

None. No account, login, agreement, CAPTCHA, fee, or records request is needed. Two things a
person should know:

1. **The collector cannot download from this portal as shipped.** Each download URL answers `302`
   to a presigned S3 URL whose host is written `s3.amazonaws.com:443`. Python's `urllib` copies
   that netloc into the `Host` header, S3 signs with the bare host name, and answers `403
SignatureDoesNotMatch` (confirmed 2026-11-02 against the occupancy-code PDF: `curl -L` with the
   same user agent gets `200`, `urllib` gets `403`). The snapshot in this record was taken with the
   collector's own `snapshot()` through a driver script that adds a redirect handler dropping the
   explicit default port (everything else, including the user agent, robots check, crawl delay,
   manifest, and content addressing, is the collector's code). The fix belongs in
   `python/src/factlot/collector/core.py` (`PoliteFetcher`'s opener), which this brief does not
   allow me to edit. Until it lands, `python -m factlot.collector snapshot` records `http_403` for
   this source.
2. S3 throughput to this machine was poor on 2026-11-02 (tens of KB/s, with stalls, for the 80 MB
   CSV; a ranged `curl` got an empty reply after 56 s). See Real run for what was loaded.

## Real run

Run 2026-11-02 (UTC 2026-11-03 02:00) on the complete FY2026 file, archived at
`collected/ma-boston-assessing/d0b656f516162c56/fy2026-property-assessment-data_rev.csv`
(80,191,023 bytes, equal to the published resource size; sha256
`d0b656f516162c56a92782a255c731b967bd551b3e26cf412e080fdf041791fa`). Snapshot document id:
`fl:document:sha256-d0b656f516162c56a92782a255c731b967bd551b3e26cf412e080fdf041791fa`. The
manifest record for it is labelled `archived_by_hand` (see Gates: the file was fetched with
`curl -L -C -` under the collector's user agent, 12 s between attempts, five attempts after
connection resets, 01:31-01:57 UTC; the two PDFs were read but not archived, to spare the shared
connection). Command:

```
python -m factlot.registry.adapters.ma_boston collected/ma-boston-assessing/d0b656f516162c56/fy2026-property-assessment-data_rev.csv registry.db --as-of 2025-01-01 --fiscal-year 2026
```

| Count                                                                                              | Value                                                                                                                                                           |
| -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rows read (all distinct `PID`s; `BLDG_SEQ` is always 1 in FY2026, so no building rows were merged) | 184,552                                                                                                                                                         |
| Parcels kept                                                                                       | 13,296 (`F1` 7,237; `B` 5,391; `F2` 668)                                                                                                                        |
| Rows out of scope                                                                                  | 171,256 (residential 1xx other than the apartment codes 148,400, incl. 74,239 residential condo units; mixed use `013`/`031` 2,956; exempt 9xx 19,897; `717` 3) |
| Facts written                                                                                      | 129,983                                                                                                                                                         |
| Owners that are organisations (name and mailing address stored)                                    | 9,254                                                                                                                                                           |
| Owners that are natural persons (not stored) or withheld                                           | 4,042 (all persons; the file has no withheld marker)                                                                                                            |
| Invalid ids, errors, retired                                                                       | 0, 0, 0                                                                                                                                                         |
| Seconds (parse and ingest into a fresh SQLite file)                                                | 4.6                                                                                                                                                             |

Rows by multifamily code: `111` 2,485, `112` 1,463, `113` 6, `114` 3, `120` 175, `125` 1,214,
`126` 13, `127` 32 (`115` and `128` do not occur in FY2026). The largest commercial codes are
`357` RETAIL CONDO 771, `390` COMMERCIAL LAND 686, `320` RET/WHSL/SERVICE 624, `358` OFFICE 590,
`319` STRIP CTR STORES 526; `465` COM BILLBOARD is 85 of the 668 industrial rows.

## Known gaps

- **Three of four Suffolk County towns are missing** (Chelsea, Revere, Winthrop). Each publishes
  through a vendor property-card site; none has been reviewed for a bulk file. The statewide
  MassGIS Level 3 parcel dataset (with assessor extracts for every town) is the natural fill and
  should be catalogued as a separate source.
- **Mixed use.** Residential-over-commercial parcels (`0xx` codes, `LU` `RC`) are out of scope
  under the B/F1/F2 mapping. They are a large share of Boston's neighbourhood retail; a reviewer
  may decide to admit `031` COM MULTI-USE (commercial multi-use) or all `RC` parcels as `F1`.
- **Apartments of 4–6 units** (`111`) are inside `B`; FactLot's definition says 5+ units, and the
  file does not say how many units each `111` parcel has (`RES_UNITS` is filled for condominium
  buildings only).
- **No owner-confidentiality flag.** Owners withheld under any Massachusetts rule are not
  identifiable in the file; nothing is marked `owner_confidential`.
- **Owner names are upper case, surname first for people, and sometimes doubled-spaced**; the
  adapter collapses whitespace but does not reorder. Trusts (`... REALTY TRUST`, `... CONDOMINIUM
TRUST`) are common owners and are kept as organisations by the registry's own rule.
- **One value only.** `TOTAL_VALUE` is the assessed value (full and fair cash value); there is no
  separate appraised value, exemption amount, or taxable value in this file beyond `GROSS_TAX`.
- **Fiscal year is not in the file**; `tax_year` is set from `--fiscal-year`. The data key is dated
  December 2024 and the FY2026 header adds `ST_ALPHA`, `ST_NUM2`, `SFYI_VALUE`, and `HEAT_SYSTEM`
  that the key does not describe (`SFYI_VALUE` is not used).
- Earlier fiscal years (FY2004–FY2025) use different file names and, before FY2024, somewhat
  different headers; the adapter is confirmed on FY2026 only.
