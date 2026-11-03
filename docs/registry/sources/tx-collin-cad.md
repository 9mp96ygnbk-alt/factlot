# Collin County, Texas: CCAD appraisal data export (`tx-collin-cad`)

Review record for data policy §5. Reviewed 2026-11-02 (terms and files: `texas-sources.md` row 6;
adapter and real run: this file). **Verified**: the files are public downloads with no gate; a real
run was made on the archived zip. County FIPS 48085; account system `ccad_prop_id` (CCAD's integer
property id). Adapter `python/src/factlot/registry/adapters/tx_collin.py`, tests
`python/tests/test_adapter_tx_collin.py`.

## Publisher and URLs

- Publisher: Collin Central Appraisal District (McKinney, TX).
- Landing page: <https://collincad.org/category/appraisal-data-exports/> (posts announcing each
  export; the files sit on the district's file-share host `link.collincad.org`, which the config
  lists under `terms_url` <https://collincad.org/open-data-portal/>).
- Files (confirmed by the collector's `snapshot`, manifest `collected/tx-collin-cad/manifest.jsonl`),
  both under `https://link.collincad.org/public/folder/1j1vp-rhx06rqkh3vz2ipw/AppraisalData/`:
  - `LiteDatabaseCurrent.zip` — 85,252,802 bytes, Last-Modified 2026-11-02 12:04 UTC, document
    `fl:document:sha256-2181dacc20ec3c25d0233dbc7fad71563d22bec0213b02532709dde4f1450cff`. **This is
    the file the adapter loads.** (The review row says "50 MB"; the archived file is 81 MB.) The
    file is regenerated at the same URL, so each weekly snapshot is a new document.
  - `CodeFileLists.xls` — 146,944 bytes, document
    `fl:document:sha256-785784b2f965727fd4aa386256037f38b9d5361750ab6d58f0c276783e2f5c21`: the code
    tables, an Excel 97 workbook last saved 2012-10-09 with five sheets: Entity Codes (149), State
    Category Codes (75), Property Use Codes (178), Land Type Codes (40), Imprv Type Codes (42).

## Terms, license, robots

- Terms: none stated for the exports (recorded in `texas-sources.md` row 6). Public record under
  Tex. Gov't Code ch. 552.
- License: public record; no open-data license stated.
- AI use: not addressed by the publisher.
- Redistribution: not addressed by the publisher; public record.
- robots.txt: `collincad.org` has the standard WordPress rules; `link.collincad.org` has none.

## What the file contains

`LiteDatabaseCurrent.zip` holds two members: `AD_Public.mdb` (968,699,904 bytes, a Microsoft Access
Jet 4 database) and `AD_Public_FileLayout.pdf` (69,410 bytes, "Collin CAD Field Descriptions",
revised 2013-04-11, three pages listing the 94 columns). The database has one table, `AD_Public`,
one row per property, 511,549 rows on 2026-11-02 (`prop_type_cd` `R` 469,589, `P` 39,293, `MH`
2,667; `prop_id` is unique). Reading it needs **mdbtools** (`mdb-export`, `brew install mdbtools`);
the adapter extracts the `.mdb` to a temporary directory and streams `mdb-export -D %Y-%m-%d -T
"%Y-%m-%d %H:%M:%S" AD_Public.mdb AD_Public` (UTF-8 CSV, header row, text quoted, nulls blank;
`situs_display` holds a line break inside its quotes). It also reads a CSV exported that way
(`AD_Public.csv`) or a directory holding either file. mdbtools is the slow part: about 3 min 45 s
for the export on a laptop; the adapter's own work is seconds.

### Key columns (names as in the table; descriptions from the PDF)

| Column                                                                                                            | Description (publisher)                                                                    | Use                                                                                                                                                                                                         |
| ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `prop_id`                                                                                                         | Property ID (key#)                                                                         | parcel key (`apn`, `account`)                                                                                                                                                                               |
| `geo_id`                                                                                                          | Geographic ID (`R-0002-00A-0030-1`)                                                        | not stored                                                                                                                                                                                                  |
| `prop_type_cd`                                                                                                    | R=Residential (real), P=Business Personal Property, MH=Manufactured Home, MN=Mineral       | `R` kept (padded with spaces in the table)                                                                                                                                                                  |
| `file_as_name`                                                                                                    | Property Owner Name                                                                        | owner of record; `OWNER OF RECORD` (995 rows) is a placeholder → no owner                                                                                                                                   |
| `addr_line1`, `addr_line2`, `addr_line3`, `addr_city`, `addr_state`, `addr_zip`                                   | Mailing Address Line 1 / Additional Owner Name, lines 2–3, city, state, ZIP (`75201-2588`) | mailing address, lines joined with commas (`% HCA INC, PO BOX 1504, NASHVILLE, TN 37202-1504`)                                                                                                              |
| `situs_num`, `situs_street_prefx`, `situs_street`, `situs_street_sufix`, `situs_city`, `situs_state`, `situs_zip` | Property Address parts (`situs_display` is the same on two lines)                          | situs `"<num> <prefix> <street> <suffix>, <city> <state> <zip>"`; `situs_state` is `TX` or blank (4,938 real properties), blank reads as `TX`                                                               |
| `state_cd`                                                                                                        | State Property Classification Code (see "state code" list)                                 | `local_use_code`; mapped to the Comptroller category by the table below                                                                                                                                     |
| `commercial_flag`                                                                                                 | Commercial Property Indicator (t/f)                                                        | not used for scope (it is CCAD's division: `T` on all 12,593 F-coded and 1,926 of 5,442 B-coded properties, but also on all 17,313 EX-coded exempt, 2,249 C3–C6 vacant and 2,596 M5 common-area properties) |
| `land_total_sqft`; `eff_size_acres`, `legal_acreage`                                                              | Total Land Area in Square Feet (`land_sqft` is "DO NOT USE"); effective / legal acreage    | `land_area_sf`: the square feet, else effective acres × 43,560, else legal acres × 43,560                                                                                                                   |
| `living_area`                                                                                                     | Improvement Main Area SqFt Total (of all bldgs)                                            | `improvement_area_sf` (0 → none)                                                                                                                                                                            |
| `yr_blt` (`eff_yr_blt`)                                                                                           | Actual Year Built (Effective Year Built, used for appraisal)                               | `year_built` = actual (0 → none)                                                                                                                                                                            |
| `cert_val_yr`, `cert_market`, `cert_appraised_val`                                                                | Certified Appraisal Year, total Market Value, Appraised Value (Market − Ag Loss)           | `tax_year`, `market_value`, `appraised_value`                                                                                                                                                               |
| `curr_val_yr`, `curr_market`, `curr_appraised_val`, `property_status`                                             | Current year (2027, `InProgress`; values only in `Preliminary` status)                     | used only for an account with no certified year yet (7,897 real properties on 2026-11-02; 240 of them in scope, all with blank current values too, so they carry no values and no year)                     |
| `units`, `stories`, `beds`, `baths`, `pool`, `percent_complete`, `exemptions`, `all_entities`, deed columns       | informational                                                                              | not stored                                                                                                                                                                                                  |

No confidentiality flag and no withheld-owner marker exist in the table, so `owner_confidential`
is never set from this file (Tax Code §25.025 accounts are presumably omitted or shown as
`OWNER OF RECORD`; the file does not say).

### State code table

From the "State Category Codes" sheet of `CodeFileLists.xls` (code, name, description), transcribed
into the adapter's `_STATE_CATEGORY`; `state_category` is the Comptroller code at the front of the
sheet's description, `local_use_code` the CCAD code. The commercial-scope rows, with the 2026-11-02
counts of real properties:

| CCAD code | Name                                             | Sheet description                               | Count |
| --------- | ------------------------------------------------ | ----------------------------------------------- | ----- |
| B1        | Residential Multi-Family                         | B - Multi-Family Residential                    | 1,883 |
| B2        | Residential Duplex                               | B - Multi-Family Residential                    | 3,418 |
| B3        | Residential Triplex                              | B - Multi-Family Residential                    | 13    |
| B4        | Residential Quadplex                             | B - Multi-Family Residential                    | 70    |
| B6        | Residential Multi-Fam Imprv - Pct Complete       | B - Multi-Family Residential                    | 43    |
| B9        | Residential Multi-Fam Imprv - Next Yr (No Value) | B - Multi-Family Residential                    | 15    |
| F1        | Commercial - Real                                | F1 - Commercial Real Property                   | 7,172 |
| F2        | Industrial - Real                                | F2 - Industrial and Manufacturing Real Property | 236   |
| F3        | Office Commercial - Real                         | F1 - Commercial Real Property                   | 1,231 |
| F4        | Condominium Commercial - Real                    | F1 - Commercial Real Property                   | 3,270 |
| F6        | Commercial Imprv - Pct Complete                  | F1 - Commercial Real Property                   | 206   |
| F7        | Commercial Imprv - Shell Only 100%               | F1 - Commercial Real Property                   | 213   |
| F9        | Commercial Imprv - Next Yr (No Value)            | F1 - Commercial Real Property                   | 265   |

Out of scope: A1–A4, A6, A9 and M4 (HOA common area) → A; C1–C6, C9 and M5 → C1; D1; D2; D6,
E1–E4, E6, E9 → E; G1–G3; H1, H2; J1A/J1B … J7A/J7B → J1 … J7, J5, J8; L1, L2; L3 → X; M1, M2 → M2;
M3 → M1; N1 → N; O; S. **One deviation from the sheet:** it files the exempt codes EX1–EX10 (Govt
Owned - Federal/State/County/City/School, Cemetary, Public Charity, Church, Misc Total Exempt) and
X (Totally Exempt Property) under "F1 - Commercial Real Property", which would put 17,313 government
lots, churches and cemeteries into the commercial scope. The adapter maps them to the Comptroller's
X (totally exempt), which is what their own names say. A reviewer who disagrees changes
`_STATE_CATEGORY`.

## Gates (needs a person)

None for collection: the downloads are public, unauthenticated and robots-permitted. For the record:
a person should re-check the site before go-live (backlog A11, common to all Texas sources), and
confirm the EX/X decision above.

## Quality pass (2026-11-03)

Audited with `python -m factlot.registry.audit --reread`: the adapter yields exactly the 18,035 parcels the registry holds. Ten owner names the current person rule reads as natural persons were stored (partnerships written `L P` with no number or business word in the name, which the rule leaves unread); they were purged and
the file was loaded into the Texas registry file next to the Comptroller's entities. **13,165 organisation owners are stored and 11,244 (85.4%) link to a registered entity.**
149 parcels (0.8%) have no situs address in the source.

## Real run (2026-11-02)

`python -m factlot.registry.adapters.tx_collin collected/tx-collin-cad/2181dacc20ec3c25/LiteDatabaseCurrent.zip registry.db --as-of 2026-11-02 --retrieved-at 2026-11-02T23:56:09+00:00`

- Snapshot: `fl:document:sha256-2181dacc20ec3c25d0233dbc7fad71563d22bec0213b02532709dde4f1450cff`, as-of 2026-11-02.
- Rows read: 511,549 (`R` 469,589, `P` 39,293, `MH` 2,667). Real properties by CCAD code: A1 347,972,
  A2 5,241, A3 3,915, A4 11,494, B1 1,883, B2 3,418, B3 13, B4 70, B6 43, B9 15, C1 24,222, C2 13,620,
  C3 2,135, C4 106, C5 7, C6 1, C9 1, D1 6,141, D2 1,025, D6 8, E1 4,699, E2 1,072, E3 284, E4 978,
  EX1 1,053, EX2 3,611, EX3 1,546, EX4 9,212, EX5 555, EX6 153, EX7 319, EX9 811, EX10 53, F1 7,172,
  F2 236, F3 1,231, F4 3,270, F6 206, F7 213, F9 265, J1A–J6A 320, M3 941, M4 7,463, M5 2,596.
- Kept (commercial scope): **18,035** parcels: **B 5,442**, **F1 12,357**, **F2 236**. Skipped
  invalid 0; retired 0.
- Facts written: 200,175. Every parcel has `parcel.apn`, `parcel.state_property_category`,
  `parcel.local_use_code`; `parcel.situs_address` on 17,886; `parcel.market_value`,
  `parcel.appraised_value` and `parcel.tax_year` on 17,795 (certified 2026); `parcel.improvement_area_sf`
  on 17,125; `parcel.year_built` on 17,121; `parcel.land_area_sf` on 14,205.
- Owners: 13,174 organisation owners of record stored (with mailing address); 4,838 natural persons
  or placeholders not stored (`owners_person_or_withheld`).
- Time: 3 min 40 s wall (228.8 s user), of which the `mdb-export` of the 969 MB database is nearly all.

## Known gaps

- **mdbtools dependency.** The Python package has no dependencies, so the `.mdb` is read through
  the `mdb-export` command; without it `read_roll` raises with the install hint. A CSV exported
  once can be passed instead.
- 3,830 in-scope parcels (mostly the 3,270 commercial condos, F4) have no land figure: CCAD gives
  condos `land_total_sqft` 0 and no acreage.
- The code sheet is from 2012; the data uses codes it lists (every `state_cd` in the 2026-11-02
  file appears in the sheet), but its EX/X descriptions are wrong on their face (see the table).
- 240 in-scope parcels are new accounts with no certified year and no preliminary values yet: no
  values and no tax year are stored for them.
- No confidentiality information; see above.
- The ArcGIS Hub GIS data (`open-data-ccad.hub.arcgis.com`) is not catalogued (row 6 note).
