# Travis County, Texas: TCAD certified appraisal export (`tx-travis-cad`)

Review record for data policy §5. Reviewed 2026-11-02 (terms and files: `texas-sources.md` row 3;
adapter and real run: this file). **Verified**: the files are public downloads with no gate; a real
run was made on the archived certified export. County FIPS 48453; account system `tcad_prop_id`
(TCAD's integer property id, leading zeros stripped). Adapter
`python/src/factlot/registry/adapters/tx_travis.py`, tests `python/tests/test_adapter_tx_travis.py`.

## Publisher and URLs

- Publisher: Travis Central Appraisal District (Austin, TX).
- Landing page: <https://traviscad.org/publicinformation> ("Public Information"; the data exports
  are linked from it).
- Files (all under `https://traviscad.org/wp-content/largefiles/`, confirmed by the collector's
  `snapshot`, manifest `collected/tx-travis-cad/manifest.jsonl`):
  - `2026%20Certified%20Appraisal%20Export%20Supp%200_07182026.zip` — 557,228,168 bytes,
    Last-Modified 2026-07-22, document `fl:document:sha256-62d0d1cd22b03f31db8d3986160eb181c5d00044df98a303fce9e17a44e9aa02`.
    **This is the file the adapter loads.** Its `APPR_HDR.TXT` says run date 07/18/2026 16:27,
    "Appraisal Export - 2026", supplement 0, TP version 8.1.33.23, export version 8.0.0.33.
  - `travis_SUPP%20335_2026_WEBSITE%20EXPORT_Renamed.zip` — 511,099,040 bytes, Last-Modified
    2026-10-08, document `fl:document:sha256-63da76773f8a8652dffeb7432525a739205027ace4aeab1c0f2d9ac0f31388eb`.
    The supplemental roll export: the same 21 members and layout, run 10/06/2026, header supplement
    number 3. It is a **full re-export** of the roll as of that supplement (493,188 `PROP.TXT`
    records; `sup_num` 0 on 315,548 real-property records, 1–3 on the rest; `sup_action` blank on
    every record), not a delta. Its file name changes with each supplement.
  - `Website_Legacy8.0.33-AppraisalExportLayout_06182026.zip` — 248,399 bytes, document
    `fl:document:sha256-c51352d2eba2f436c82b88ad156ebcc9a1d9c7fd546aee06bcfc83e69d61535b`: the layout,
    as `Legacy8.0.33-AppraisalExportLayout.pdf` and `.xlsx` (one sheet per file, with the 1-based
    start and end column of every field).

## Terms, license, robots

- Terms: none stated for the exports. The site's [privacy policy](https://traviscad.org/privacy-policy/)
  covers website use only (recorded in `texas-sources.md` row 3). Public record under Tex. Gov't
  Code ch. 552.
- License: public record; no open-data license stated.
- AI use: not addressed by the publisher.
- Redistribution: not addressed by the publisher; public record.
- robots.txt: `Crawl-delay: 10`, which the collector honours (its `min_interval` is 2 s; the
  crawl delay overrides it for this host).

## What the file contains

A zip of 21 fixed-width text files with CRLF line endings and Latin-1 bytes, 17.99 GB unpacked,
in the True Prodigy "Legacy 8.0.33" appraisal export layout (the format TCAD's system generates for
tax offices). Members and sizes (2026 certified): `PROP.TXT` 4,895,747,376 bytes (9,922 characters

- CRLF per record; all 493,324 lines are exactly 9,924 bytes), `PROP_ENT.TXT` 9.84 GB (property ×
  taxing entity, not used), `IMP_DET.TXT` 2,065,539,840 bytes (622 + CRLF; 3,310,160 records),
  `IMP_INFO.TXT` 52,778,376 bytes (114 + CRLF; 454,986 records), `IMP_ATR.TXT` 232 MB, `LAND_DET.TXT`
  89,535,450 bytes (199 + CRLF; 445,450 records), `SKETCH_INFO.TXT` 758 MB, `SB12.TXT`,
  `MOBILE_HOME_INFO.TXT`, `ARB.TXT`, `ABS_SUBD.TXT`, `AGENT.TXT`, `LAWSUIT.TXT`, `ARBITRATION.TXT`,
  `TAX_DEFERRAL_INFO.TXT`, `TOTALS.TXT`, `ENTITY.TXT`, `COUNTRY.TXT`, `STATE_CD.TXT` (5,715 bytes),
  `APPR_HDR.TXT` (246 bytes), and an `exportTotals.pdf`. The adapter reads `PROP.TXT`, `STATE_CD.TXT`,
  `LAND_DET.TXT` and `IMP_DET.TXT`, streaming each from the zip once (about 14 s in all).

### Key columns (1-based start–end, from the layout spreadsheet)

`PROP.TXT` (file #2, "Property"), one record per property **and owner** (`prop_owner_sequence`
4051–4090 is the `prop_id` for the first owner and `prop_id-n` for the others; `partial_owner`
679 is `T` on those; 78 extra owner records in the 2026 file):

| Field                                                                                                             | Columns              | Use                                                                                                                                                                               |
| ----------------------------------------------------------------------------------------------------------------- | -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `prop_id`                                                                                                         | 1–12                 | parcel key (`apn`, `account`), leading zeros stripped                                                                                                                             |
| `prop_type_cd`                                                                                                    | 13–17                | `R` real (kept), `P` business personal property, `MH` mobile home, `MN` mineral (dropped)                                                                                         |
| `prop_val_yr`                                                                                                     | 18–22                | `tax_year`                                                                                                                                                                        |
| `sup_num`, `sup_action`                                                                                           | 23–34, 35–36         | a record with `sup_action` `D` is dropped (none in either 2026 file)                                                                                                              |
| `py_owner_name`                                                                                                   | 609–678              | owner of record for the appraisal year (`appr_owner_name` 4492–4561, the current owner, differs on 2 records; `jan1_owner_name` on 2,346 of the first 60,000)                     |
| `py_addr_line1..3`, `py_addr_city`, `py_addr_state`, `py_addr_country`, `py_addr_zip`, `py_addr_zip_cass`         | 694–987              | mailing address; ZIP and CASS add-on joined (`78676-2530`); country kept when not `US`/`USA` (ISO-2 codes such as `CA`, `MX`, `JP`)                                               |
| `py_confidential_flag`, `py_address_suppress_flag`                                                                | 990, 991             | `T` → `owner_confidential` (no name, no address) / no address. **`F` on all 441,961 real properties**: TCAD withholds §25.025 accounts from the export rather than flagging them  |
| `situs_street_prefx`, `situs_street`, `situs_street_suffix`, `situs_city`, `situs_zip`, `situs_num`, `situs_unit` | 1040–1149, 4460–4479 | situs `"<num> <prefix> <street> <suffix> <unit>, <city> TX <zip>"`. `situs_city` is blank on 260,376 of 441,961 real properties (then `"…, TX 78704"`); the street is blank on 25 |
| `appraised_val`                                                                                                   | 1916–1930            | `appraised_value` (market less productivity loss)                                                                                                                                 |
| `imprv_state_cd`, `land_state_cd`                                                                                 | 2732–2751            | TCAD state code: the improvement code, or the land code when there is no improvement (`local_use_code`); never both blank in the 2026 file                                        |
| `land_acres`                                                                                                      | 2772–2791            | acreage, four implied decimals; the fallback when the property has no land segment                                                                                                |
| `market_value`                                                                                                    | 4214–4227            | `market_value`                                                                                                                                                                    |

`STATE_CD.TXT` (file #6): `state_cd` 1–10, `ptd_state_cd` 61–70 (and descriptions, year).
`LAND_DET.TXT` (file #10): `prop_id` 1–12, `size_acres` 70–83 (four implied decimals),
`size_square_feet` 84–97; square feet per segment, acres × 43,560 where the segment has none, summed.
`IMP_DET.TXT` (file #8): `prop_id` 1–12, `imprv_det_type_cd` 41–50, `yr_built` 86–89,
`imprv_det_area` 94–108 (explicit decimals). Building area is the sum of the floor details (`1ST`,
`2ND`, `3RD`, `4TH`, `5TH`, `ADDL` additional floor, `1/2` half floor, `MEZZ` mezzanine, `FBSMT`,
`UBSMT` basements); canopies, paved area, parking garages, terraces, fences, pools, HVAC and
plumbing counts are not. `year_built` is the oldest floor's `yr_built`, or the oldest of any
detail when a parcel has no floor (a fenced lot). Values are whole dollars.

### State code table

TCAD's own table (`STATE_CD.TXT` in the export, 2026, 45 codes), which the adapter reads at run time
and also carries as a fallback. `state_category` is the Comptroller (PTD) code; the CAD code is
`local_use_code`. The commercial-scope rows:

| TCAD code | TCAD description                        | PTD code | PTD description          |
| --------- | --------------------------------------- | -------- | ------------------------ |
| B1        | MULTIFAMILY                             | B        | MULTIFAMILY RESIDENTIAL  |
| B2        | DUPLEX                                  | B        | MULTIFAMILY RESIDENTIAL  |
| B3        | TRI-PLEX                                | B        | MULTIFAMILY RESIDENTIAL  |
| B4        | FOUR-PLEX                               | B        | MULTIFAMILY RESIDENTIAL  |
| B5        | MULTIFAMILY WITH HS                     | B        | MULTIFAMILY RESIDENTIAL  |
| F1        | COMMERCIAL IMPROVED                     | F1       | COMMERCIAL REAL PROPERTY |
| F2        | INDUSTRIAL MAJOR MANUFACTURING IMPROVED | F2       | INDUSTRIAL REAL PROPERTY |
| F3        | COMMERCIAL DETAILS                      | F2       | INDUSTRIAL REAL PROPERTY |
| F4        | COMMERCIAL CONDO                        | F2       | INDUSTRIAL REAL PROPERTY |
| F5        | COMMERCIAL RES CONVERSION               | F2       | INDUSTRIAL REAL PROPERTY |

Out of scope: A1–A5, A9 → A; C1, C2; D1, D2, D3 → D2; E1–E3 → E; G1–G3; J1–J9; L1, L2; M1, M2;
N1, N2 → N; O1 → O; S1 → S; X. The mapping of F3 (commercial details), F4 (commercial condos) and
F5 (residential conversions) to the Comptroller's F2 "industrial" is TCAD's, as published; the
adapter follows it (so a downtown office condo is `F2` with `local_use_code` `F4`). A reviewer who
would rather file those under F1 changes `_STATE_CATEGORY` and ignores the file's table.

## Gates (needs a person)

None for collection: the downloads are public, unauthenticated and robots-permitted. For the
record: a person should re-read the privacy policy before go-live (backlog A11, common to all Texas
sources), and decide the F3/F4/F5 question above.

## Real run (2026-11-02)

`python -m factlot.registry.adapters.tx_travis collected/tx-travis-cad/62d0d1cd22b03f31/2026%20Certified%20Appraisal%20Export%20Supp%200_07182026.zip registry.db --as-of 2026-07-18 --retrieved-at 2026-11-02T23:20:27+00:00`

- Snapshot: `fl:document:sha256-62d0d1cd22b03f31db8d3986160eb181c5d00044df98a303fce9e17a44e9aa02`, as-of 2026-07-18.
- `PROP.TXT` records read: 493,324 (`R` 442,039, `P` 39,536, `MH` 11,744, `MN` 5), all appraisal
  year 2026, supplement 0. Unique real properties: 441,961 (78 repeated owner records collapsed).
  By TCAD code: A1 290,624, A2 6,006, A3 2,059, A4 54,675, A5 21, A9 15, B1 2,194, B2 9,689, B3 145,
  B4 1,105, C1 34,467, D1 3,047, D2 197, E1 6,394, E2 460, E3 334, F1 12,351, F2 61, F3 827, F4 2,892,
  F5 1,287, J1–J6 61, M1 5, O1 13,043, S1 1, X 1.
- Kept (commercial scope): **30,551** parcels: **B 13,133** (B1 2,194, B2 9,689, B3 145, B4 1,105),
  **F1 12,351**, **F2 5,067** (F2 61, F3 827, F4 2,892, F5 1,287). Skipped invalid 0; retired 0.
- Facts written: 339,297. Every parcel has `parcel.apn`, `parcel.state_property_category`,
  `parcel.local_use_code`, `parcel.situs_address`, `parcel.market_value`, `parcel.appraised_value`,
  `parcel.tax_year`; `parcel.land_area_sf` on 30,337; `parcel.year_built` on 30,065;
  `parcel.improvement_area_sf` on 29,150.
- Owners: 17,944 organisation owners of record stored (with mailing address); 12,607 natural persons
  not stored (`owners_person_or_withheld`; mostly duplexes and fourplexes). No confidential flags,
  no placeholder names (`UNKNOWN`, `CURRENT OWNER`, `OWNER OF RECORD` do not occur).
- Time: 14.1 s wall (12.3 s user) on the archived zip, including the 2 GB `IMP_DET.TXT`.

## Known gaps

- `situs_city` is blank on 59% of real properties, so most situs addresses read `"… , TX 78704"`.
  The ZIP is always present; a reviewer wanting a city could derive it from the ZIP or from
  `ENTITY.TXT`/`PROP_ENT.TXT` (city taxing unit), which the adapter does not do.
- Tax Code §25.025 accounts are not identifiable: every `py_confidential_flag` is `F`, so they are
  presumably absent from the export. `owner_confidential` is therefore never set from this file.
- Building area is the sum of floor details, which is close to gross building area but not TCAD's
  own figure (the export has none); parking garages and mezzanine storage (`328`) are excluded.
  29,150 of 30,551 parcels have a figure; the rest have no floor detail (vacant commercial land
  coded F1, lots with only paving or fences).
- TCAD reports F3/F4/F5 as F2; see the code table. `COMMERCIAL RES CONVERSION` (F5, 1,287 parcels)
  and commercial condos (F4, 2,892) therefore count as industrial in category totals.
- The supplemental export (a full roll as of a later supplement) can be loaded with the same
  adapter as a later snapshot; it was archived but not loaded. Nothing in it is a delta.
- `PROP_ENT.TXT` (9.8 GB, taxing entities per property), `IMP_ATR.TXT`, `SKETCH_INFO.TXT`, `SB12.TXT`
  and the ARB, lawsuit, agent, deferral and mobile-home files are not read.
