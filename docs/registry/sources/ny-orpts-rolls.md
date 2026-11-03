# ny-orpts-rolls: New York State assessment rolls (ORPTS, via Open NY)

Review record for data policy §5. Reviewed 2026-11-03. Machine-readable copy:
[`registry/sources/ny/ny-orpts-rolls.json`](../../../registry/sources/ny/ny-orpts-rolls.json).
Adapter: `python/src/factlot/registry/adapters/ny_orpts.py` (account system `ny_swis_printkey`);
tests: `python/tests/test_adapter_ny_orpts.py`.

One statewide dataset covers every New York county outside New York City, so one review clears
Suffolk (36103), Nassau (36059), Westchester (36119), Erie (36029) and Monroe (36055), and every
other upstate and Long Island county the same way. Since the statewide extension of 2026-11-03 the
config lists one file for each of the 57 counties (see that section below); the five boroughs are
never loaded from this source (they are `ny-nyc-dof`).

## Publisher and URLs

- Publisher: New York State Department of Taxation and Finance, Office of Real Property Tax
  Services (ORPTS), on Open NY (`data.ny.gov`, Socrata). Contact on the dataset:
  `Real.Property@tax.ny.gov`.
- Dataset: "Property Assessment Data from Local Assessment Rolls", id `7vem-aaz7`.
  Landing page: <https://data.ny.gov/Government-Finance/Property-Assessment-Data-from-Local-Assessment-Rolls/7vem-aaz7>;
  metadata: <https://data.ny.gov/api/views/7vem-aaz7.json>. Attachments on the dataset: an overview
  and a data dictionary (PDFs). Posting frequency: annually; last updated 2026-04-24.
- Size (SODA `count`, 2026-11-03): roll years 2021 to 2025 hold 4.68 to 4.73 million rows each; 2025
  has 4,727,130 rows. Whole-state download is not attempted. Confirmed files are filtered SODA CSVs,
  one per county, in `registry/sources/ny/ny-orpts-rolls.json`: `roll_year=2025`, one `county_name`,
  `property_class` 400 to 499 or 700 to 799, 31 of the 93 columns, `$order=swis_code,print_key_code`,
  `$limit=100000`. Each answers HTTP 200 (chunked, so no `Content-Length`; Monroe's is 3,208,024
  bytes). Commercial and industrial rows in 2025: Suffolk 42,709; Nassau 29,138; Westchester 37,533;
  Erie 25,800; Monroe 13,641 (148,821 rows, roughly 34 MB in all). When the 2026 rolls are posted,
  change `roll_year` in the URLs.
- Publisher's class list: <https://www.tax.ny.gov/research/property/assess/manuals/prclas.htm>
  ("Property type classification codes").

## Terms, license, robots

- Terms: OPEN-NY Terms of Use (<https://data.ny.gov/dataset/OPEN-NY-Terms-Of-Use/77gx-ii52>), the same
  terms reviewed for `ny-dos-entities` (see that record for the quoted sentences): a non-exclusive,
  revocable licence with no attribution, share-alike or pre-approval requirement; "so long as you are
  not doing anything malicious with NYS data, you may use it as you wish". The dataset has no
  license field. AI use is not addressed.
- The one clause flagged on `ny-dos-entities` applies here too: the prohibition on bots sits in the
  "Public Participation" (user upload) section, not in the licence to download data. A person should
  confirm that reading once for both sources (backlog A11), and read the portal platform's terms
  (socrata.com).
- robots.txt (`data.ny.gov`): `Crawl-delay: 1`; only `/browse` search URLs with `q=`, `category=` and
  similar parameters are disallowed. `/resource/` and `/api/` are allowed. The collector's discover
  step ran clean on the dataset page and the metadata API.
- Statutes, state by state question "does any statute restrict commercial use of assessment lists?":
  none found. The roll is a public record that must be filed for public inspection (Real Property
  Tax Law §516; text read on nysenate.gov, no restriction on use). FOIL (Public Officers Law
  §89(2)(b)(iii)) lists "sale or release of lists of names and addresses if such lists would be used
  for solicitation or fund-raising purposes" as an unwarranted invasion of personal privacy; that
  is a ground for an agency to withhold in answering a request, not a restriction on use of
  published open data, and it is one more reason natural-person owners are never stored.

## What the file contains

One row per parcel per roll year for every city and town outside New York City (996 local
governments; the publisher states village rolls are not included). Columns requested: `roll_year`, `county_name`,
`municipality_code`, `municipality_name`, `swis_code`, `tax_class`, `roll_section`, `property_class`,
`property_class_description`, `print_key_code`, `parcel_address_number`, `parcel_address_street`,
`parcel_address_suff`, `front`, `depth`, `primary_owner_first_name`, `primary_owner_mi`,
`primary_owner_last_name`, `primary_owner_suffix`, the mailing address columns (prefix, number,
street, suffix, city, state, zip, country, PO box), `full_market_value`, `assessment_land`,
`assessment_total`. The portal also has three additional owners, exemptions and taxable values
(not requested).

- **Parcel key.** The publisher: "combine the SWIS code and print key fields". The registry strips
  punctuation from an APN, and print keys differ only by punctuation within a municipality
  (Erie `101.27-6-11` and `101.27-6-1.1`; Suffolk `10.-1-22` and `10.1-2-2`; 24 pairs in the
  first 3,000 Suffolk rows alone), so `ny_orpts.apn()` writes `.`, `-` and `/` as `x` plus the hex
  code and a literal `x` as `xx` (`472003` + `10.-1-22` is `47200310x2ex2d1x2d22`). The readable
  `<swis>-<print key>` is the account and the crosswalk value.
- **Owners.** Present in every county, and not uniform: Suffolk writes the whole name ("LAST, FIRST")
  in the last-name column; Erie, Monroe and Westchester split persons across first and last
  columns; companies are in the last-name column. The adapter joins the non-blank parts and the
  registry keeps only organisations. There is no confidentiality flag; no owner is withheld in the
  rows read.
- **Use codes mapped** (publisher's page above; the roll also carries local codes 412 and 413 that
  the page does not list):

| ORPTS class                                               | FactLot | Note                                                           |
| --------------------------------------------------------- | ------- | -------------------------------------------------------------- |
| 411 Apartments, 413 Co-operative                          | B       | No unit count in the roll; see Known gaps                      |
| 400, 414-418, 420-499 (all other 4xx)                     | F1      | Hotels, motels, retail, offices, parking, storage, mixed       |
| 700, 710-715 manufacturing and processing, 720-729 mining | F2      |                                                                |
| 410 Living accommodations, 412 Condominium                | none    | Seasonal and single-family homes (Suffolk 410) and condo units |
| 3xx vacant land (incl. 330, 340), 2xx, 5xx, 6xx, 8xx, 9xx | none    | Vacant land is out of scope, as in `ny_nyc`                    |
| 730-749 wells and pipelines                               | none    | Production and transmission rights, not buildings              |

## Gates

None for the data. A person should do the two read-only confirmations above (the "Public
Participation" bot clause and the Socrata platform terms) before the first weekly run; they apply to
`ny-dos-entities` as well.

## Real run

Monroe County, the complete 2025 commercial and industrial extract, archived by the collector
(`python -m factlot.collector snapshot`): `fl:document:sha256-b38f57c1305654853edfbb09c7821f4a9707d1930492f18557782128ac3c76c8`,
3,208,024 bytes, 13,641 data rows, retrieved 2026-11-03T07:38:48Z. Loaded with
`python -m factlot.registry.adapters.ny_orpts ... --as-of 2026-04-24 --tax-year 2025` in 2.6 seconds:

- 13,601 parcels kept: B 2,972, F1 9,755, F2 874; 40 rows out of scope (class 744, 410, 734, 740,
  741).
- 100,553 facts written; 9,475 organisation owners stored; 4,126 owners that are natural persons
  not stored; 13,598 parcels with a market value; all with a situs.
- The class counts over the whole roll (SODA group-by, no download) give the same Monroe figures
  and these in-scope totals for the other counties: Suffolk 27,373 (B 6,933, F1 17,806, F2 2,634);
  Nassau 23,449 (B 3,428, F1 18,871, F2 1,150); Westchester 37,456 (B 26,053, F1 10,870, F2 533);
  Erie 24,108 (B 7,603, F1 15,341, F2 1,164).
- Samples of the first 3,000 commercial rows by SWIS and print key for the other four counties,
  fetched with the collector's user agent and loaded into the same scratch registry: Suffolk 1,217
  kept (the first rows are Babylon class 410, out of scope; 961 organisation owners); Nassau 2,338
  (B 1,256, F1 1,018, F2 64; 1,044 organisation owners); Westchester 2,995 (B 1,421, F1 1,247,
  F2 327; 1,587); Erie 3,000 (B 1,195, F1 1,732, F2 73; 1,458). The scratch registry holds 23,151
  parcels with no key collision.
- Full market value is reported on 19,991 of Suffolk's 42,709 commercial and industrial rows, 28,668
  of Nassau's 29,138, 21,793 of Westchester's 37,533, 25,394 of Erie's 25,800 and 13,632 of Monroe's
  13,641.

## Full load (2026-11-03)

Release `data-2026-11-03-41603209834` (draft, maintainers only) of `9mp96ygnbk-alt/factlot`. Each asset's sha256 was checked against the manifest and its first 16 hex characters against the name. Loaded into the Tier 2 scratch registry (one SQLite file shared by every Tier 2 source, `ct-sos-entities` first).

Assets (document id from the manifest):

- `ny-orpts-rolls__1e1010c25009dd71__7vem-aaz7.csv` (9,655,351 bytes): `fl:document:sha256-1e1010c25009dd71daee640b5e73920a59ff35db9a89551222c36beb7d303c72`
- `ny-orpts-rolls__8c7c38ccbbd2f56d__7vem-aaz7.csv` (6,838,782 bytes): `fl:document:sha256-8c7c38ccbbd2f56d81596317aec14143812401d4693f11178c3fd0a7936b80bd`
- `ny-orpts-rolls__4cc95600e3af42ea__7vem-aaz7.csv` (8,409,239 bytes): `fl:document:sha256-4cc95600e3af42ea36edacfa88a72ddd91bd96a7fde3327bf69035b6d2f17fcf`
- `ny-orpts-rolls__beceb1fbccf335d3__7vem-aaz7.csv` (5,880,903 bytes): `fl:document:sha256-beceb1fbccf335d3b1958f0ab588d756b6a5ad2218c0d8346b52155ff4773cc1`
- `ny-orpts-rolls__b38f57c130565485__7vem-aaz7.csv` (3,208,024 bytes): `fl:document:sha256-b38f57c1305654853edfbb09c7821f4a9707d1930492f18557782128ac3c76c8`

Command:

```
PYTHONPATH=python/src python3 -m factlot.registry.adapters.ny_orpts <county csv> registry.db --as-of 2026-04-24 --tax-year 2025 --retrieved-at <manifest checked_at>   # once per county file, no --full-roll
```

- Rows read: 148,821 data rows in the five county files (Suffolk 42,709, Nassau 29,138, Westchester 37,533, Erie 25,800, Monroe 13,641); the adapter drops classes 410, 412 and the 730-749 range at read time, so its records equal the parcels kept.
- Parcels kept: **125,987** distinct commercial parcels (`B` 46,989, `F1` 72,643, `F2` 6,355).
- By county:
  - Monroe (FIPS 36055): 13,601 parcels (`B` 2,972, `F1` 9,755, `F2` 874); organisation owners 9,468; ownership links 70.
  - Suffolk (FIPS 36103): 27,373 parcels (`B` 6,933, `F1` 17,806, `F2` 2,634); organisation owners 16,841; ownership links 53.
  - Nassau (FIPS 36059): 23,449 parcels (`B` 3,428, `F1` 18,871, `F2` 1,150); organisation owners 17,341; ownership links 48.
  - Westchester (FIPS 36119): 37,456 parcels (`B` 26,053, `F1` 10,870, `F2` 533); organisation owners 12,848; ownership links 110.
  - Erie (FIPS 36029): 24,108 parcels (`B` 7,603, `F1` 15,341, `F2` 1,164); organisation owners 13,011; ownership links 46.
- Facts written: 860,268. Seconds: 46.5. Invalid ids, errors, retired: 0, 0, 0.
- Organisation owners stored (current owner-of-record facts): 69,509; natural persons or withheld owners not stored (names not kept): 56,471.
- Ownership links to registered entities after `link_owners()`: 327 (the only entity registry in the scratch file is `ct-sos-entities`).
- Suffolk's roll holds many class-410 seasonal homes that are out of scope; the figures above are in-scope classes only. The counts equal the SODA class counts recorded in the review run above (Suffolk 27,373; Nassau 23,449; Westchester 37,456; Erie 24,108; Monroe 13,601).

## Statewide extension (2026-11-03)

The licence review above is statewide (the OPEN-NY terms cover the whole dataset), so the extension is
configuration and testing only. The config now lists 57 files: the five Tier 2 counties first, then the
other 52 counties alphabetically, each the same filtered SODA CSV with another `county_name`.

- **County list, from the publisher's own data.** SoQL `$select=roll_year,county_name,count(*)&$group=roll_year,county_name`
  on `7vem-aaz7` returns 57 `county_name` values, each with roll years 2021 to 2025 (plus one stray
  Steuben row with roll year `23`, outside the 2025 filter). None is a New York City borough. The names
  are spelled as in the config URLs (`St Lawrence` without a period). Every name maps to a county FIPS in
  the adapter's `COUNTY_FIPS`, which already held all 57; New York City's five county codes (005, 047,
  061, 081, 085) are not in it, so a borough row would be skipped even if one appeared.
- **Counties added (52):** Albany, Allegany, Broome, Cattaraugus, Cayuga, Chautauqua, Chemung, Chenango,
  Clinton, Columbia, Cortland, Delaware, Dutchess, Essex, Franklin, Fulton, Genesee, Greene, Hamilton,
  Herkimer, Jefferson, Lewis, Livingston, Madison, Montgomery, Niagara, Oneida, Onondaga, Ontario, Orange,
  Orleans, Oswego, Otsego, Putnam, Rensselaer, Rockland, St Lawrence, Saratoga, Schenectady, Schoharie,
  Schuyler, Seneca, Steuben, Sullivan, Tioga, Tompkins, Ulster, Warren, Washington, Wayne, Wyoming, Yates.
- **Codes.** SoQL group-by `county_name,property_class` for roll year 2025: every county uses the ORPTS
  three-digit classes; the only other values are blank (Suffolk 289, Oneida 19, Orleans 4, Westchester 2,
  Onondaga 1) and `0` (Westchester 40), which are out of scope. No county-specific mapping is needed.
- **URL check.** One request per new county file with `$limit=100000` replaced by `$limit=5`, sent
  through the collector's `PoliteFetcher` (its user agent, robots.txt read, `Crawl-delay: 1` and the
  2-second interval): all 52 answered HTTP 200 with the 31-column header and 5 rows of the right county.
  No full file was downloaded; the weekly collector workflow archives them.
- **In-scope counts** (SoQL `count(*)` grouped by county and class for roll year 2025, mapped with
  `ny_orpts.category()`; no download). The 52 new counties hold 157,400 class 4xx/7xx rows and
  **150,008** in-scope parcels (`B` 41,576, `F1` 101,063, `F2` 7,369); the state outside New York City
  275,995. The largest file (Suffolk, 42,709 rows) is well under the URL's `$limit=100000`.

| County (FIPS)       | Class 4xx/7xx rows |    In scope |        `B` |        `F1` |       `F2` | URL check (`$limit=5`)  |
| ------------------- | -----------------: | ----------: | ---------: | ----------: | ---------: | ----------------------- |
| Albany (36001)      |              8,320 |       8,310 |      2,502 |       5,666 |        142 | HTTP 200, 5 rows        |
| Allegany (36003)    |              1,326 |       1,138 |        133 |         917 |         88 | HTTP 200, 5 rows        |
| Broome (36007)      |              5,357 |       5,311 |      1,195 |       3,794 |        322 | HTTP 200, 5 rows        |
| Cattaraugus (36009) |              3,018 |       2,228 |        399 |       1,663 |        166 | HTTP 200, 5 rows        |
| Cayuga (36011)      |              1,602 |       1,578 |        260 |       1,222 |         96 | HTTP 200, 5 rows        |
| Chautauqua (36013)  |              8,216 |       4,155 |        555 |       3,296 |        304 | HTTP 200, 5 rows        |
| Chemung (36015)     |              2,249 |       2,179 |        380 |       1,656 |        143 | HTTP 200, 5 rows        |
| Chenango (36017)    |              1,373 |       1,303 |        189 |       1,004 |        110 | HTTP 200, 5 rows        |
| Clinton (36019)     |              2,158 |       2,158 |        451 |       1,603 |        104 | HTTP 200, 5 rows        |
| Columbia (36021)    |              1,812 |       1,805 |        255 |       1,476 |         74 | HTTP 200, 5 rows        |
| Cortland (36023)    |              1,422 |       1,406 |        303 |       1,002 |        101 | HTTP 200, 5 rows        |
| Delaware (36025)    |              1,526 |       1,520 |        205 |       1,219 |         96 | HTTP 200, 5 rows        |
| Dutchess (36027)    |              7,536 |       7,530 |      3,515 |       3,855 |        160 | HTTP 200, 5 rows        |
| Erie (36029)        |             25,800 |      24,108 |      7,603 |      15,341 |      1,164 | Tier 2 (already loaded) |
| Essex (36031)       |              1,312 |       1,311 |        159 |       1,066 |         86 | HTTP 200, 5 rows        |
| Franklin (36033)    |              1,359 |       1,211 |        188 |         958 |         65 | HTTP 200, 5 rows        |
| Fulton (36035)      |              1,588 |       1,578 |        200 |       1,271 |        107 | HTTP 200, 5 rows        |
| Genesee (36037)     |              2,067 |       1,528 |        185 |       1,196 |        147 | HTTP 200, 5 rows        |
| Greene (36039)      |              2,053 |       2,050 |        725 |       1,275 |         50 | HTTP 200, 5 rows        |
| Hamilton (36041)    |                276 |         276 |         13 |         247 |         16 | HTTP 200, 5 rows        |
| Herkimer (36043)    |              1,678 |       1,675 |        261 |       1,268 |        146 | HTTP 200, 5 rows        |
| Jefferson (36045)   |              2,878 |       2,872 |        454 |       2,230 |        188 | HTTP 200, 5 rows        |
| Lewis (36049)       |                572 |         567 |         63 |         454 |         50 | HTTP 200, 5 rows        |
| Livingston (36051)  |              1,548 |       1,403 |        232 |       1,082 |         89 | HTTP 200, 5 rows        |
| Madison (36053)     |              1,652 |       1,582 |        274 |       1,234 |         74 | HTTP 200, 5 rows        |
| Monroe (36055)      |             13,641 |      13,601 |      2,972 |       9,755 |        874 | Tier 2 (already loaded) |
| Montgomery (36057)  |              1,445 |       1,440 |        305 |       1,027 |        108 | HTTP 200, 5 rows        |
| Nassau (36059)      |             29,138 |      23,449 |      3,428 |      18,871 |      1,150 | Tier 2 (already loaded) |
| Niagara (36063)     |              5,834 |       5,781 |      1,389 |       4,009 |        383 | HTTP 200, 5 rows        |
| Oneida (36065)      |              6,240 |       6,222 |      1,441 |       4,473 |        308 | HTTP 200, 5 rows        |
| Onondaga (36067)    |             11,069 |      11,033 |      2,752 |       7,833 |        448 | HTTP 200, 5 rows        |
| Ontario (36069)     |              2,867 |       2,781 |        635 |       1,938 |        208 | HTTP 200, 5 rows        |
| Orange (36071)      |              7,756 |       7,727 |      1,577 |       5,862 |        288 | HTTP 200, 5 rows        |
| Orleans (36073)     |                831 |         827 |        168 |         590 |         69 | HTTP 200, 5 rows        |
| Oswego (36075)      |              2,641 |       2,637 |        368 |       2,086 |        183 | HTTP 200, 5 rows        |
| Otsego (36077)      |              1,644 |       1,637 |        283 |       1,299 |         55 | HTTP 200, 5 rows        |
| Putnam (36079)      |              1,321 |       1,314 |        147 |       1,128 |         39 | HTTP 200, 5 rows        |
| Rensselaer (36083)  |              3,669 |       3,649 |      1,079 |       2,447 |        123 | HTTP 200, 5 rows        |
| Rockland (36087)    |             14,444 |      14,438 |     11,024 |       3,253 |        161 | HTTP 200, 5 rows        |
| Saratoga (36091)    |              4,505 |       4,496 |      1,354 |       2,938 |        204 | HTTP 200, 5 rows        |
| Schenectady (36093) |              3,167 |       3,164 |        832 |       2,232 |        100 | HTTP 200, 5 rows        |
| Schoharie (36095)   |                793 |         793 |        142 |         585 |         66 | HTTP 200, 5 rows        |
| Schuyler (36097)    |                507 |         464 |         53 |         386 |         25 | HTTP 200, 5 rows        |
| Seneca (36099)      |                945 |         774 |         98 |         641 |         35 | HTTP 200, 5 rows        |
| St Lawrence (36089) |              3,104 |       3,096 |        339 |       2,211 |        546 | HTTP 200, 5 rows        |
| Steuben (36101)     |              2,534 |       2,344 |        355 |       1,847 |        142 | HTTP 200, 5 rows        |
| Suffolk (36103)     |             42,709 |      27,373 |      6,933 |      17,806 |      2,634 | Tier 2 (already loaded) |
| Sullivan (36105)    |              3,168 |       3,157 |      1,051 |       2,029 |         77 | HTTP 200, 5 rows        |
| Tioga (36107)       |              1,101 |       1,076 |        142 |         863 |         71 | HTTP 200, 5 rows        |
| Tompkins (36109)    |              2,531 |       2,511 |      1,042 |       1,381 |         88 | HTTP 200, 5 rows        |
| Ulster (36111)      |              4,553 |       4,540 |        934 |       3,429 |        177 | HTTP 200, 5 rows        |
| Warren (36113)      |              2,320 |       2,314 |        315 |       1,916 |         83 | HTTP 200, 5 rows        |
| Washington (36115)  |              1,486 |       1,486 |        227 |       1,084 |        175 | HTTP 200, 5 rows        |
| Wayne (36117)       |              2,113 |       2,093 |        228 |       1,691 |        174 | HTTP 200, 5 rows        |
| Westchester (36119) |             37,533 |      37,456 |     26,053 |      10,870 |        533 | Tier 2 (already loaded) |
| Wyoming (36121)     |              1,269 |         909 |        111 |         734 |         64 | HTTP 200, 5 rows        |
| Yates (36123)       |                645 |         631 |         89 |         497 |         45 | HTTP 200, 5 rows        |
| **All 57 counties** |        **306,221** | **275,995** | **88,565** | **173,706** | **13,724** |                         |

- **Multi-file loading.** Each county file is loaded without `--full-roll` (the adapter's default), so no
  county retires another's parcels (`test_county_files_do_not_retire_each_other`).
- **Tests added** (`python/tests/test_adapter_ny_orpts.py`): all 57 county names as the publisher spells
  them map to their FIPS codes and nothing else is in the table; borough names and codes never map; a
  borough row in a file is skipped while an upstate row loads.
- Rockland's in-scope count is dominated by class 411 and 413 (`B` 11,024 of 14,438), like
  Westchester's; see Known gaps.

## Statewide full load (2026-11-03)

Release `data-2026-11-03-41618090881` (draft, maintainers only) of `9mp96ygnbk-alt/factlot`: 52 county CSVs (`ny-orpts-rolls__<sha16>__7vem-aaz7.csv`, 36,036,217 bytes in all) and the source's manifest, downloaded with `gh release download` into an empty directory and read as untrusted data (`python3 -I`, scripts kept outside the directory). Each file's sha256 was checked against the manifest (and its byte size and document id), and its first 16 hex characters against the name: 52 of 52 matched. The manifest also lists 5 archived entries that are in the earlier release `data-2026-11-03-41603209834` (the Full load above), not in this one. A file's document id is `fl:document:sha256-` plus its sha256; its first 16 characters are the `sha16` column. Loaded into the same Tier 2 scratch registry as the Full load, after it; `purge_person_owners()` and `link_owners()` were then run once for all five statewide sources together.

Command, once per county file (no `--full-roll`, because the source is 57 files):

```
PYTHONPATH=python/src python3 -m factlot.registry.adapters.ny_orpts <county csv> registry.db --as-of 2026-04-24 --tax-year 2025 --retrieved-at <manifest checked_at>
```

- Rows read: 157,400 data rows in the 52 files (the publisher's class 4xx/7xx count for these counties, as recorded in the statewide extension); the adapter drops classes 410, 412 and the 730-749 range at read time, so its records equal the parcels kept.
- Parcels kept: **150,008** distinct commercial parcels in 52 counties (`B` 41,576, `F1` 101,063, `F2` 7,369). Every county's count equals the in-scope count recorded in the statewide extension.
- With the five Tier 2 counties the whole state outside New York City is loaded: 275,995 parcels in 57 counties (88,565 `B`, 173,706 `F1`, 13,724 `F2`), 151,710 with an organisation owner of record and 912 ownership links.
- Facts written: 1,062,937. Adapter seconds: 123.4. Invalid ids, errors, retired: 0, 0, 0.
- Organisation owners stored (parcels with a current owner-of-record fact): 82,201; natural persons or withheld owners not stored (names not kept): 67,806.
- Ownership links to registered entities after `link_owners()`: 585 (the only entity registry in the scratch file is `ct-sos-entities`).

By county (parcels are distinct commercial parcels; organisation owners are parcels with an organisation as owner of record; links are parcels linked to a registered entity):

| County (FIPS)       |     Parcels |        `B` |        `F1` |      `F2` | Organisation owners | Ownership links | Asset sha16        |
| ------------------- | ----------: | ---------: | ----------: | --------: | ------------------: | --------------: | ------------------ |
| Albany (36001)      |       8,310 |      2,502 |       5,666 |       142 |               5,106 |              26 | `47916b131d8ec16d` |
| Allegany (36003)    |       1,138 |        133 |         917 |        88 |                 484 |               2 | `cf7a1140c89765ee` |
| Broome (36007)      |       5,311 |      1,195 |       3,794 |       322 |               3,454 |              24 | `b708b559bf106f87` |
| Cattaraugus (36009) |       2,228 |        399 |       1,663 |       166 |               1,085 |               5 | `9a22d645e9d46536` |
| Cayuga (36011)      |       1,578 |        260 |       1,222 |        96 |                 875 |               3 | `84bc2806d8d731c8` |
| Chautauqua (36013)  |       4,155 |        555 |       3,296 |       304 |               2,163 |               8 | `c95db8504875c781` |
| Chemung (36015)     |       2,179 |        380 |       1,656 |       143 |               1,274 |               8 | `acf4f4e55a8c6399` |
| Chenango (36017)    |       1,303 |        189 |       1,004 |       110 |                 630 |               6 | `235aaab8d07084cb` |
| Clinton (36019)     |       2,158 |        451 |       1,603 |       104 |               1,203 |               0 | `c240c03b5a5210c0` |
| Columbia (36021)    |       1,805 |        255 |       1,476 |        74 |               1,139 |              19 | `ea9534b887881a1f` |
| Cortland (36023)    |       1,406 |        303 |       1,002 |       101 |                 893 |              26 | `bd53e9602fc9b2d2` |
| Delaware (36025)    |       1,520 |        205 |       1,219 |        96 |                 753 |              13 | `794911d7dee7d76d` |
| Dutchess (36027)    |       7,530 |      3,515 |       3,855 |       160 |               4,065 |              61 | `d5b24ae242be0a93` |
| Essex (36031)       |       1,311 |        159 |       1,066 |        86 |                 718 |               0 | `b50c6dff2d4f432d` |
| Franklin (36033)    |       1,211 |        188 |         958 |        65 |                 602 |               3 | `f1b3e6a44add3021` |
| Fulton (36035)      |       1,578 |        200 |       1,271 |       107 |                 780 |               6 | `5982c2adcabe510c` |
| Genesee (36037)     |       1,528 |        185 |       1,196 |       147 |                 988 |               2 | `f3ed25d66a5fa62f` |
| Greene (36039)      |       2,050 |        725 |       1,275 |        50 |                 986 |               7 | `d9338e92bef4dc72` |
| Hamilton (36041)    |         276 |         13 |         247 |        16 |                 134 |               1 | `1554a509708c850e` |
| Herkimer (36043)    |       1,675 |        261 |       1,268 |       146 |                 793 |               7 | `e2b5241693d806a3` |
| Jefferson (36045)   |       2,872 |        454 |       2,230 |       188 |               1,685 |               6 | `63a30771f4e137c1` |
| Lewis (36049)       |         567 |         63 |         454 |        50 |                 279 |               2 | `2669a8f73b1b875a` |
| Livingston (36051)  |       1,403 |        232 |       1,082 |        89 |                 797 |               8 | `c4e41b38ba0be695` |
| Madison (36053)     |       1,582 |        274 |       1,234 |        74 |                 875 |               7 | `623580039b6a56ed` |
| Montgomery (36057)  |       1,440 |        305 |       1,027 |       108 |                 747 |               6 | `42432bce16191b78` |
| Niagara (36063)     |       5,781 |      1,389 |       4,009 |       383 |               3,099 |              24 | `b74ee6238b1d7c64` |
| Oneida (36065)      |       6,222 |      1,441 |       4,473 |       308 |               3,182 |              21 | `9af99d122858fda4` |
| Onondaga (36067)    |      11,033 |      2,752 |       7,833 |       448 |               6,997 |              49 | `d290c75eeea65615` |
| Ontario (36069)     |       2,781 |        635 |       1,938 |       208 |               1,737 |              18 | `da1c1733f5143294` |
| Orange (36071)      |       7,727 |      1,577 |       5,862 |       288 |               5,207 |              35 | `b51e2f8398aa8fac` |
| Orleans (36073)     |         827 |        168 |         590 |        69 |                 430 |               0 | `a197a33e26b620d2` |
| Oswego (36075)      |       2,637 |        368 |       2,086 |       183 |               1,418 |               5 | `dfbc5864a2dd422c` |
| Otsego (36077)      |       1,637 |        283 |       1,299 |        55 |                 850 |               9 | `ca2a05b0253aed88` |
| Putnam (36079)      |       1,314 |        147 |       1,128 |        39 |                 987 |              11 | `881f292b972b6312` |
| Rensselaer (36083)  |       3,649 |      1,079 |       2,447 |       123 |               2,143 |              21 | `821c6f8bab82071e` |
| Rockland (36087)    |      14,438 |     11,024 |       3,253 |       161 |               4,501 |               7 | `4236cb1446cf5859` |
| St Lawrence (36089) |       3,096 |        339 |       2,211 |       546 |               1,533 |               3 | `17e6397a2964d0a0` |
| Saratoga (36091)    |       4,496 |      1,354 |       2,938 |       204 |               2,654 |              19 | `e5027e274cc5ad11` |
| Schenectady (36093) |       3,164 |        832 |       2,232 |       100 |               1,829 |              11 | `48d62a3c8d746712` |
| Schoharie (36095)   |         793 |        142 |         585 |        66 |                 408 |               5 | `6f086aea7b633ee3` |
| Schuyler (36097)    |         464 |         53 |         386 |        25 |                 264 |               1 | `432ebe9c061d8505` |
| Seneca (36099)      |         774 |         98 |         641 |        35 |                 409 |               1 | `06624bf5c7ef3429` |
| Steuben (36101)     |       2,344 |        355 |       1,847 |       142 |               1,190 |              20 | `5c40cfb01a3b6839` |
| Sullivan (36105)    |       3,157 |      1,051 |       2,029 |        77 |               1,646 |               7 | `4616fa024f6cb647` |
| Tioga (36107)       |       1,076 |        142 |         863 |        71 |                 534 |               7 | `1ab2f4fa4ffaa200` |
| Tompkins (36109)    |       2,511 |      1,042 |       1,381 |        88 |               1,553 |               8 | `c8eadd2ca0fcc8dd` |
| Ulster (36111)      |       4,540 |        934 |       3,429 |       177 |               2,836 |              10 | `4290060e45795921` |
| Warren (36113)      |       2,314 |        315 |       1,916 |        83 |               1,495 |              11 | `a28659e7536b40ba` |
| Washington (36115)  |       1,486 |        227 |       1,084 |       175 |                 786 |               9 | `a6ef3c08c7de0d43` |
| Wayne (36117)       |       2,093 |        228 |       1,691 |       174 |               1,206 |              13 | `2f53deae50f38c93` |
| Wyoming (36121)     |         909 |        111 |         734 |        64 |                 497 |               2 | `8e3097665b919574` |
| Yates (36123)       |         631 |         89 |         497 |        45 |                 302 |               2 | `5bf973e6d3240b4a` |
| **All 52 counties** | **150,008** | **41,576** | **101,063** | **7,369** |          **82,201** |         **585** |                    |

- Seconds are the adapter's wall time for the final pass over the 52 files. A first pass over the first six counties was cut short by a closed pipe in the loading wrapper, not by the adapter, and the files were loaded again in full; reloading is idempotent (no duplicate facts or snapshots), and the facts figure above is counted from the registry.

## Known gaps

- No building area, year built or lot area: the roll has `front` and `depth` only, which are not an
  area. Land area, improvement area and year built stay empty.
- `full_market_value` is zero or blank for many Suffolk rows and for some elsewhere; it is stored as
  no figure, not as zero. `assessment_total` is a fractional assessed value and is not stored.
- Class 411 has no unit count, so a small walk-up counts as multifamily; Westchester's 26,053 class
  411 and 413 parcels look high for apartment buildings and may include co-operative and condominium units.
  Check against an independent count before relying on Westchester's multifamily total. Rockland
  (11,024 class 411 and 413 parcels) has the same question.
- Situs has no ZIP and uses the assessing city or town (a village address carries the town name).
- Villages that assess separately and the five New York City boroughs are not in this dataset.
- Only the primary owner is read. Print-key equivalence across roll years is not checked.
