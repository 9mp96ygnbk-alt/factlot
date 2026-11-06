# ny-nyc-dof: New York City Department of Finance, Final Assessment Roll

Review record for the source `ny-nyc-dof` (data policy §5). Reviewed 2026-11-02. Machine-readable
copy: [`registry/sources/ny/ny-nyc-dof.json`](../../../registry/sources/ny/ny-nyc-dof.json).
Adapter: `python/src/factlot/registry/adapters/ny_nyc.py`; tests: `python/tests/test_adapter_ny_nyc.py`.

Covers the five boroughs: Manhattan (New York County, FIPS 36061), Bronx (36005), Brooklyn (Kings,
36047), Queens (36081), Staten Island (Richmond, 36085). Account system `nyc_bbl`: the
borough-block-lot (`1` + 5-digit block + 4-digit lot, plus the easement letter when the record is
an easement).

## Publisher and URLs

- Publisher: New York City Department of Finance (DOF), Property Division.
- Landing pages (read by the collector):
  - current roll: <https://www.nyc.gov/site/finance/property/property-assessments.page>
  - prior years (FY09–FY26): <https://www.nyc.gov/site/finance/property/property-assessment-roll-archives.page>
- Confirmed files (archived by the collector on 2026-11-02; status in `collected/ny-nyc-dof/manifest.jsonl`):
  - `https://www.nyc.gov/assets/finance/downloads/tar/fy27_tc234.zip` (47.8 MB): Final Assessment
    Roll FY2026/27, tax classes 2, 3 and 4.
  - `https://www.nyc.gov/assets/finance/downloads/tar/layout-pts-property-master.xlsx` (20 KB): the
    record layout (139 columns).
  - `https://www.nyc.gov/assets/finance/downloads/tar/tarfieldcodes.pdf` (31 KB): field codes
    (tax classes, easements, the building-class to tax-class rule).
- Also published, not archived: `fy27_tc1.zip` (tax class 1, 74.5 MB), `fy27_avroll1234.zip` (all
  classes, 122.8 MB), `fy27_reuc.zip` (Real Estate of Utility Corporation sub-idents, 914 KB),
  `supplemental_roll_tc2_2027.zip`, and the same set for each prior year.
- The same roll is on NYC Open Data as dataset `8y4t-faws` "Property Valuation and Assessment Data
  Tax Classes 1,2,3,4" (Socrata, <https://data.cityofnewyork.us/api/views/8y4t-faws.json>), five
  years (2023–2027) × periods, 11.7 million rows, same columns lower-cased, with the data dictionary
  `Property_Assessment_Data_Dictionary.xlsx` attached. A filtered export of one year
  (`/resource/8y4t-faws.csv?$where=year='2027' AND period='3'`) ran at about 80 rows per second on
  2026-11-02 (11,721 rows in 2.5 minutes), so the nyc.gov zip is the file used. The older dataset
  `yjxr-fw8i` "Property Valuation and Assessment Data" is historical (last updated 2020).
- PLUTO (Department of City Planning, dataset `64uk-42ks`, 26v2) was not loaded: the DOF roll already
  carries land area, gross building area, units, year built, building class and owner, so PLUTO
  would add zoning, land-use and floor-area detail only. It is now loaded as an enrichment source: see
  [ny-nyc-dcp-pluto](ny-nyc-dcp-pluto.md); the sales files as [ny-nyc-dof-sales](ny-nyc-dof-sales.md).
- Building class definitions: <https://www.nyc.gov/assets/finance/jump/hlpbldgcode.html>
  ("NYC Building Classifications", read 2026-11-02).

## Terms, license, robots

- **NYC Open Data terms.** The NYC Open Data FAQ (<https://www.nyc.gov/opendata/get-started/FAQs>,
  read 2026-11-02), under "Are there restrictions on how I can use Open Data?": "Open Data belongs to
  all New Yorkers. There are no restrictions on the use of Open Data." The FAQ also notes that the
  NYC Open Data Law requires all "public datasets" to be published and that records naming
  individuals are public under FOIL; removal requests go to the agency's Open Data Coordinator and
  Records Access Officer.
- **Open Data Law.** N.Y.C. Admin. Code §23-502 (Local Law 11 of 2012) requires public data sets to
  be made available without registration, license requirement, or restrictions on use, with the
  City able to require third parties to identify the source and version of the data set. The
  code text is hosted at codelibrary.amlegal.com, which answered the collector's request with a
  JavaScript challenge (HTTP 403), so the sentence could not be quoted from the live page; a person
  should confirm it (see Gates).
- **nyc.gov Terms of Use** (<https://www.nyc.gov/main/terms-of-use>, read 2026-11-02) govern use of
  the website that serves the zips. They require lawful use and state, in section IV, that the
  site's "design, information, text, graphics, images ... are the property of the City of New
  York. All rights are reserved." They state no data license and do not mention AI use. The
  assessment roll itself is a public record (N.Y. Real Property Tax Law §516 requires the final
  roll to be open for public inspection; Public Officers Law art. 6, FOIL) published under the
  Open Data Law's no-restrictions rule, so the facts are treated as redistributable with
  attribution to the Department of Finance.
- **AI use:** not addressed by the publisher; the "no restrictions on the use" statement is the
  operative one. The registry does not train models on the data.
- **Attribution:** New York City Department of Finance.
- **robots.txt:** `www.nyc.gov/robots.txt` disallows only `/html/misc/`; the landing pages and
  `/assets/finance/downloads/tar/` are allowed. `data.cityofnewyork.us/robots.txt` sets
  `Crawl-delay: 1` and disallows `/browse` search and filter pages only (not used).
- **License recorded:** public record; NYC Open Data "no restrictions on the use of Open Data";
  redistribution permitted with attribution; AI use not addressed. `verified: true`.

## What the file contains

`fy27_tc234.zip` holds one tab-delimited text file, `PROPMAST_TC234_T2027_FIN.TXT` (the member name
is confirmed in the Real run section), with a header row of column names, CRLF line endings,
Latin-1 bytes, a trailing tab on every line, and 139 columns in the order of
`layout-pts-property-master.xlsx` (transcribed as `ny_nyc.LAYOUT`; the real file's header matches
it column for column). Numbers
are signed and zero-padded (`+00185249000`); text columns are space-padded. The zip also carries a
`__MACOSX/._*` resource fork, which the adapter ignores.

Key columns (names from the layout):

| Column                                                  | Use                                                                                                                                                              |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PARID`, `BORO`, `BLOCK`, `LOT`, `EASE`                 | Borough-block-lot; the APN and `nyc_bbl` account is `BORO` + 5-digit `BLOCK` + 4-digit `LOT` + easement letter. `BORO` 1–5 → county FIPS 061, 005, 047, 081, 085 |
| `RECTYPE`                                               | 1 ordinary real estate (kept); 2, 3 Real Estate of Utility Corporation idents (skipped)                                                                          |
| `TAXYR`                                                 | 2027 = fiscal year 2026/27 → `tax_year`                                                                                                                          |
| `BLDG_CLASS`                                            | DOF building class → `local_use_code` and the FactLot category (table below)                                                                                     |
| `FINTAXCLASS`                                           | NYS tax class: 1, 1A–1D (1–3 family), 2, 2A–2C (apartments), 3 (utilities), 4 (all others). Not used for scope; the building class is finer                      |
| `OWNER`                                                 | Owner of record (80 characters) → `owner_name`. No mailing address, no confidentiality flag. Placeholders (`UNAVAILABLE OWNER`, `NOT ON FILE`, ...) → no owner   |
| `HOUSENUM_LO`, `HOUSENUM_HI`, `STREET_NAME`, `ZIP_CODE` | Situs: `34-50 WHITEHALL STREET, NEW YORK NY 10004` (postal city from the borough; Queens hyphenated ranges are written `37-10 TO 37-20`)                         |
| `LAND_AREA`, `GROSS_SQFT`                               | Square feet → `land_area_sf`, `improvement_area_sf` (0 = no figure)                                                                                              |
| `YRBUILT`, `UNITS`                                      | Year built (0 = unknown); total units (used for the small-apartment classes)                                                                                     |
| `FINMKTTOT`                                             | Final market value, total → `market_value`                                                                                                                       |
| `FINACTTOT`                                             | Final actual assessed value, total (45% of market value for classes 2 and 4; the taxable base before transition and exemptions) → `appraised_value`              |
| `EXTRACTDT`                                             | Data extract date (YYYYMMDD), the roll's as-of date                                                                                                              |

Building class → FactLot category (`ny_nyc.category`). Definitions are the publisher's, from the
building classification page; the tax-class rule is from `tarfieldcodes.pdf` ("there is a direct
correlation between the Building Class and the 1st position of the Tax Class": class 1 = A, B, C0,
G0, R3, R6, R7, S0–S2, V0, V2, V3, Z0; class 2 = C1–C9, D0–D9, R0–R2, R4, R8, R9, S3–S5, S9; class 3
= U1, U2, U4–U9; class 4 = all others).

| Category | Building classes                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `B`      | Walk-up apartments C1 (over six families without stores), C2 (five to six families), C4 (old law tenement), C5 (converted dwelling or rooming house), C6 (walk-up cooperative), C7 (walk-up over six families with stores), C8, C9 (garden apartments); elevator apartments D0–D9; S5 (primarily 5–6 family with one store); RR (condominium rentals). CB, CC, DB, DC ("less than 11 units") and S9 (single or multiple dwelling with stores) only when `UNITS` ≥ 5 |
| `F1`     | G garages and gas stations (except G0, the garage of a class 1 residence), H hotels, I hospitals and health facilities, J theatres, K store buildings, L lofts, O office buildings; commercial condominium units R5 (miscellaneous commercial), R8 (commercial unit of a 2–10 unit building), RB (office), RG (indoor parking), RH (hotel), RK (retail), RP (outdoor parking), RS (storage)                                                                         |
| `F2`     | E warehouses (E1 general, E2 contractors, E7 self-storage, E9), F factories and industrial buildings (F1, F2, F4, F5, F8, F9); RW (warehouse/factory/industrial condominium unit)                                                                                                                                                                                                                                                                                   |
| none     | A, B (one and two family), C0 (three families), C3 (four families), CM (trailer parks), M religious, N asylums and homes, P indoor public assembly and cultural, Q outdoor recreation, R0–R4, R6, R7, R9 (residential condo units, co-ops, billing lots), RA, RT (condo common areas), S0–S4 (1–4 family with a store), T transportation, U utilities, V vacant land, W educational, Y government, Z miscellaneous                                                  |

Lofts (L) are mapped to `F1` because DOF's classes describe the building type, not its current use;
many are offices today. The commercial condominium units are individual lots of a condominium
building and are kept as parcels in their own right; the building's residential units are not.

## Gates (anything that needs a person)

- No account, login, click-through, CAPTCHA, fee or records request was needed; the zips are plain
  downloads.
- `www.nyc.gov` served the 48 MB zip slowly to the collector (about 20 KB/s, with one
  "connection reset by peer" after two minutes on 2026-11-02; the small files downloaded at once).
  The weekly run should expect long downloads from this host or a retry.
- The Open Data Law text (Admin. Code §23-502) is on codelibrary.amlegal.com behind a JavaScript
  challenge, so its "no license requirement or restrictions on use" wording is cited from the FAQ
  and from memory of the statute; a person should read it once and confirm.
- The nyc.gov Terms of Use reserve all rights in the website's content; a person may want to
  confirm that the Open Data FAQ's "no restrictions" statement governs the DOF roll files served
  from nyc.gov (they are also published on the Open Data portal, where it clearly does).

### Platform terms read 2026-11-03

Tyler Technologies Terms of Use (served at <https://www.tylertech.com/terms/socrata-terms-of-service>, "Effective April 29, 2024"; HTTP 200, read 2026-11-03; matches the browser capture). Full notes: [`../requests/platform-terms/socrata.md`](../requests/platform-terms/socrata.md). Under "Restrictions on Use" the user may not:

> Use any computer code, data mining software, "robot," "bot," "spider," "scraper" or other automatic device, or program, algorithm or methodology having similar processes or functionality, or any manual process, to monitor or copy any of the Web pages, data or content found or accessed through the Services;

> Display, distribute, license, perform, publish, reproduce, duplicate, copy, create derivative works from, modify, sell, resell, exploit, transfer, or transmit for any commercial purposes, all or any portion of the Services

Read: these are Tyler's generic terms for its own "Services". The page refers to "the terms specific to a particular Service as applicable" and does not address a public agency's own dataset licence. Read literally, the scraper clause covers copying "data ... accessed through the Services", which is in tension with the collector's export downloads; the publisher's own dataset licence (recorded above) is what grants rights in the data. Open point: whether to rely on the agency licence and treat the Tyler page as platform boilerplate, or ask the agency (not Tyler) to confirm that its licence governs bulk exports. Nothing was accepted.

## Quality pass (2026-11-03)

The `OWNER` field holds a name of up to 80 characters as two 40-character halves joined by one space, and
the break falls inside a word when the name is longer than 40 characters: `BUILDERS LEASING LIMITED LIABILITY COMPA NY`,
`WEI WEI AND JIN CUI REVOCABLE LIVING TRU ST` (9,436 of 461,249 rows). An organisation written that way never matched
the entity registry (`... COMPA NY` is not `... COMPANY`). The adapter closes the break when the two fragments form a
word the unwrapped names of the same file use more often than the first fragment (`_owner`); where they do not (`U/A/D`
and `5/28/08`) the space stays. See [the Tier 1 quality report](../quality/tier1-2026-11-03.md) for the effect on the link rate.

## Real run (2026-11-03)

The full FY27 roll was archived by the collector once the shared connection was quiet
(`collected/ny-nyc-dof/c3d135953903eb22/fy27_tc234.zip`, 48,989,962 bytes, document `fl:document:sha256-c3d135953903eb223c4d866e1af891575de9e77b1be504f8dae5564f309ac85c`; the layout workbook and
`tarfieldcodes.pdf` as recorded in the Documents section). The adapter's first run read **zero
rows**: the published file has a header row and a trailing tab on every line, which the layout
documentation does not mention; the adapter now drops both (commit 2a1b900). Command:

```
python -m factlot.registry.adapters.ny_nyc collected/ny-nyc-dof/c3d135953903eb22/fy27_tc234.zip registry.db --as-of 2026-05-15
```

| Measure                                                                              | Count                                                                                                                                                                                                                             |
| ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| In-scope lots read and kept (`RECTYPE` 1, classes B/F1/F2)                           | 164,633 (the sum of the borough line below; the Tier 1 audit counts 164,633 parcels for this source, `quality/audit-2026-11-03/after-tier1.json`)                                                                                 |
| By borough                                                                           | Manhattan 42,087; Brooklyn 60,100; Queens 40,080; Bronx 17,331; Staten Island 5,035                                                                                                                                               |
| Facts written                                                                        | not recorded for this run (the table first printed 0 here in error)                                                                                                                                                               |
| Owners that are organisations (stored)                                               | 115,733 (Manhattan 31,906; Brooklyn 39,146; Queens 26,546; Bronx 14,404; Staten Island 3,731)                                                                                                                                     |
| Owners that are natural persons or placeholders (not stored)                         | 0                                                                                                                                                                                                                                 |
| Invalid, errors, retired                                                             | 0, 0, 0                                                                                                                                                                                                                           |
| Seconds (parse and ingest)                                                           | 8                                                                                                                                                                                                                                 |
| Owners linked to NY DOS entities (full file, exact name in a plausible jurisdiction) | 84,607 (73% of organisation owners; Manhattan 21,515; Brooklyn 30,215; Queens 20,224; Bronx 10,161; Staten Island 2,492; 82,694 before the jurisdiction rule of C23, which also resolved names that were ambiguous across states) |

Correction (2026-11-06): this table first printed 0 for lots kept and facts written beside the borough counts. The lots-kept
figure is the borough line's sum, which the Tier 1 audit's parcel count for this source confirms; the run's facts-written
figure was not recorded and is left blank rather than estimated.

## Known gaps

- No owner mailing address and no confidentiality marker in the roll; owner names are the primary
  owner only (`OWNER`), 80 characters, as DOF holds them (natural persons are dropped by the registry).
- No situs city column: the borough's postal city is used (`NEW YORK` for Manhattan, `QUEENS` for all
  of Queens rather than the USPS neighbourhood names).
- Condominium buildings appear as their unit lots; a residential condo building has no single parcel
  record in scope, and its commercial units are separate parcels.
- The tax class 1 file (`fy27_tc1.zip`) is not loaded: it contains no `B`, `F1` or `F2` classes
  except mixed-use 1–2 family stores (S0–S2), which are out of scope.
- PLUTO's zoning, land use and floor-area ratios are loaded separately ([ny-nyc-dcp-pluto](ny-nyc-dcp-pluto.md); geometry is not).
- The roll is annual (tentative in January, final in May); the Socrata copy adds change-by-notice
  and current values but is slow to export.
