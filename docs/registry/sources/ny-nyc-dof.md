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
  would add zoning, land-use and floor-area detail only. Candidate for a later source.
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
  and from memory of the statute; a person should read it once and confirm (backlog A11 style).
- The nyc.gov Terms of Use reserve all rights in the website's content; a person may want to
  confirm that the Open Data FAQ's "no restrictions" statement governs the DOF roll files served
  from nyc.gov (they are also published on the Open Data portal, where it clearly does).

## Real run

**Not completed on 2026-11-02.** The adapter was not run on the real roll because the collector
could not finish downloading `fy27_tc234.zip` within the session: the machine's network was shared
by about fifteen concurrent collector runs (a speed-test endpoint measured 16 KB/s), and
`www.nyc.gov` reset or stalled the connection three times (connection reset after 2 minutes;
read timeout after stalling at 1 MB; a harness-killed attempt at 14.7 MB). The two small files
were archived:

- `layout-pts-property-master.xlsx`: `fl:document:sha256-c4abced2e55b5aaeccc02e8c9d8f639a1e324fb81bb3915e72ad5feb7599d1fe` (20,172 bytes)
- `tarfieldcodes.pdf`: `fl:document:sha256-4d176d775f183a765c0cfd3ce35d188105c9f8453dd7c8ce9f2a0c53c2088059` (30,908 bytes)

A detached retry loop (`nyc_retry.sh` in the session scratchpad, up to 8 collector runs) was left
running; its outcome is in `collected/ny-nyc-dof/manifest.jsonl`. No counts are reported here
because none were produced by a real run (brief: no invented data). To finish:

```
python -m factlot.collector snapshot --config registry/sources/ny/ny-nyc-dof.json --out collected
python -m factlot.registry.adapters.ny_nyc collected/ny-nyc-dof/<sha16>/fy27_tc234.zip registry.db --as-of 2026-05-15
```

`main()` prints the ingest stats plus `read_by_county_and_category` (records read per county FIPS
and category, i.e. per borough), which is what this section should record: rows read, parcels kept
by category and borough, facts written, organisation owners, seconds, and the zip's document id.
The as-of date should be taken from the file's `EXTRACTDT` column (the FY27 final roll was
published in May 2026; the Socrata copy shows `extracrdt` 2026-05-15).

What was checked against real data: the layout (139 columns, confirmed against the Socrata copy's
column list and the first rows of `fy26_reuc.zip`, which is the same Property Master format: no
header, tab-delimited, signed zero-padded numbers, space-padded text, a `__MACOSX` member); the
building-class population of the FY27 final roll from Socrata (214 distinct classes; e.g. D4 3,546,
O4 407, K1 7,607, E1 3,730, R4 198,585 condo units); and tax-class counts (class 2 258,099; 2A
40,339; 2B 15,905; 2C 22,708; 3 4,426; 4 119,772 lots). The owner placeholder list in the adapter
is from DOF convention and should be checked against the real file's most frequent owner strings
once it is downloaded.

## Known gaps

- No owner mailing address and no confidentiality marker in the roll; owner names are the primary
  owner only (`OWNER`), 80 characters, as DOF holds them (natural persons are dropped by the registry).
- No situs city column: the borough's postal city is used (`NEW YORK` for Manhattan, `QUEENS` for all
  of Queens rather than the USPS neighbourhood names).
- Condominium buildings appear as their unit lots; a residential condo building has no single parcel
  record in scope, and its commercial units are separate parcels.
- The tax class 1 file (`fy27_tc1.zip`) is not loaded: it contains no `B`, `F1` or `F2` classes
  except mixed-use 1–2 family stores (S0–S2), which are out of scope.
- PLUTO (zoning, land use, floor-area ratios, geometry) is not loaded.
- The roll is annual (tentative in January, final in May); the Socrata copy adds change-by-notice
  and current values but is slow to export.
