# md-sdat-real-property: Maryland Real Property Assessments (SDAT and MDP, statewide)

Review record for the source `md-sdat-real-property` (data policy §5). Reviewed 2026-11-03.
Machine-readable copy:
[`registry/sources/md/md-sdat-real-property.json`](../../../registry/sources/md/md-sdat-real-property.json).
Adapter: `python/src/factlot/registry/adapters/md_sdat.py` (account system `sdat_account`); tests:
`python/tests/test_adapter_md_sdat.py`.

**One statewide dataset covers all three Tier 2 Maryland counties** (Montgomery 24031, Prince
George's 24033, Baltimore County 24005) and the other 21 jurisdictions, including Baltimore City
(24510); since the statewide extension of 2026-11-03 the config lists all 24. **The publisher withholds owner names**: the dataset is titled "Hidden Property Owner Names",
and none of its 223 columns carries an owner name or an owner address. Every parcel this source
loads has no owner of record.

## Publisher and URLs

- Publisher: Maryland State Department of Assessments and Taxation (SDAT, the primary data) and the
  Maryland Department of Planning (MDP, the parcel geography and cleaned street addresses), published
  by the Department of Information Technology on the state's Socrata portal `opendata.maryland.gov`.
- Dataset: "Maryland Real Property Assessments_Hidden Property Owner Names", id `ed4q-f8tm`,
  <https://opendata.maryland.gov/d/ed4q-f8tm>; metadata <https://opendata.maryland.gov/api/views/ed4q-f8tm.json>.
  Category "Business and Economy"; update frequency monthly ("on or about the 3rd day of each month");
  `rowsUpdatedAt` 2026-10-05.
- Per-county filtered views exist on the portal (Montgomery `kb22-is2w`, Prince George's `w3eb-4mzd`,
  Baltimore County `jpfc-qkxp`, and one for each other county); they are views of the same data and are
  not used. Companion datasets: "Maryland Real Property Assessments: Fields Reference" `w8th-47fz` (every
  column with its SDAT field number) and the documentation PDF attached to `ed4q-f8tm`
  (`Real_Property_Records_Documentation.pdf`, last edited November 2022).
- Rows per jurisdiction on 2026-11-03 (SoQL `count(*)` grouped by `county_name_mdp_field_cntyname`,
  all land uses): Montgomery 355,455; Prince George's 315,543; Baltimore (County) 306,537; Baltimore
  City 241,663; the state about 2.5 million accounts.
- Files archived (SoQL `.csv` exports of the resource endpoint, server-side filtered to land use C, CC,
  I, M and to the 33 columns the adapter reads; one URL per county, see the config):

  | County           | Rows   | Bytes     | Document id (sha256 prefix) |
  | ---------------- | ------ | --------- | --------------------------- |
  | Montgomery       | 11,580 | 3,204,693 | `b8c5022b78753b6c`          |
  | Prince George's  | 13,023 | 3,656,990 | `6d2b09239ae981be`          |
  | Baltimore County | 14,494 | 3,774,152 | `7fca9ba1d85d6008`          |

  The unfiltered export of all 223 columns for about 2.5 million accounts is far over the 50 MB limit and was not downloaded.

## Terms, license, robots

- Portal license field: **Public Domain** (`licenseId` `PUBLIC_DOMAIN`). Attribution field: "SDAT (State
  Department of Assessments and Taxation) and MDP (Maryland Department of Planning)", attribution
  link `http://www.dat.state.md.us/`.
- The documentation PDF carries only an accuracy disclaimer. Operative sentence (MDP legal disclaimer
  applied to all MDP content in the dataset): "MDP does not provide any guaranty of accuracy or
  completeness regarding the map information." It also warns that the dataset joins SDAT records
  (updated daily) with MDP parcel records (updated about annually) "and therefore property records
  shown in this opendata.maryland.gov dataset may not exactly match external property records".
- AI use: not addressed, not restricted. Redistribution: permitted (public domain); the registry
  attributes "Maryland State Department of Assessments and Taxation and Maryland Department of
  Planning, via opendata.maryland.gov".
- robots.txt (`opendata.maryland.gov`): `User-agent: *`, `Crawl-delay: 1`; `Disallow` only for browse and
  catalog URLs carrying `q=`, `category=`, `sortBy=`, `tags=`, `limitTo=`, `federation_filter=`,
  `view_type=`, plus `/OData.svc/`, `/api/odata/`, `/login`, `/reset_password/`, `/tiles/`, `*/alt?`,
  `/api/collocate*`. The resource endpoint (`/resource/ed4q-f8tm.csv`), `/api/views/` and
  `/api/catalog/v1` are allowed.
- `verified: true`: terms and robots read and recorded; the file URLs are confirmed by real downloads
  through the collector (all three `archived`); the license is public domain and does not restrict AI
  use.

## What the file contains

One CSV row per real-property tax account. Header: the portal's API field names (long, lower case,
ending in the SDAT field number). The 33 requested columns are listed in the config URL; the
adapter reads these:

| Column (shortened)                                                 | Use                                                                                                       |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| `account_id_mdp_field_acctid`                                      | Parcel key. SDAT county code (2) + district (2) + account number; 11, 12 or 14 characters by county       |
| `county_name_mdp_field_cntyname`                                   | Jurisdiction, mapped to county FIPS in `COUNTY_FIPS`                                                      |
| `land_use_code_mdp_field_lu_desclu_sdat_field_50`                  | Land use, written `Commercial (C)`: the table below                                                       |
| `premise_address_*_sdat_field_20` to `_28`                         | Situs: number (leading zeros, `00000` = none), suffix, direction, name, type, city, ZIP, condominium unit |
| `mdp_street_address_*`                                             | MDP's cleaned address, used only when the premise has no street name                                      |
| `current_cycle_data_land_value_..._field_164`, `..._165`           | Current cycle land and improvements value; their sum is `market_value` (full cash value)                  |
| `current_assessment_year_total_assessment_sdat_field_172`          | `appraised_value` (the three-year phase-in assessment)                                                    |
| `c_a_m_a_system_data_year_built_..._235`, `..._241`, `..._242/243` | Year built (`0000` = none), structure area, land area with unit (`S` sq ft, `A` acres, blank = unknown)   |
| `record_deletion_date_..._398`                                     | Accounts with a deletion date are skipped (two Montgomery rows)                                           |

Not read, but requested for the audit trail or later use: owner-occupancy code (`ooi`, field 6),
zoning, exempt class, county system property code (field 56), tax class, BPRUC public use code,
dwelling units, cycle year, last activity date.

Land use table mapped (`CATEGORY_BY_LU`; the publisher's code is kept in `local_use_code`; definitions
from the documentation PDF and the Fields Reference):

| SDAT land use | Description                                                                                                                                                                                                       | FactLot category    |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| `C`           | Commercial                                                                                                                                                                                                        | `F1`                |
| `CC`          | Commercial Condominium                                                                                                                                                                                            | `F1`                |
| `I`           | Industrial                                                                                                                                                                                                        | `F2`                |
| `M`           | Apartments                                                                                                                                                                                                        | `B`                 |
| others        | `R` Residential, `U` Residential Condominium, `TH` Town House, `E` Exempt, `EC` Exempt Commercial, `A` Agricultural, `CR` Commercial Residential, `RC` Residential Commercial, `CA` Country Club, `MA` Marsh Land | none (out of scope) |

Land use mix of the three counties on 2026-11-03 (all accounts): in scope C 18,100, CC 7,802, I
7,892, M 5,303; out of scope: E 47,589, EC 8,158; CR 1,194, RC
69, A 7,564, CA 133, MA 9.

## Gates

None. No account, login, agreement, CAPTCHA, fee, or records request is needed. One thing a person
should know: **there is no free source of Maryland owner names.** SDAT withholds them from the open
data on purpose, and its Real Property Data Search (a form-driven site) is not scraped. SDAT sells a
"Real Property Public Data Record" (with ownership information) and a corporate charter file through
its contractor SpecPrint, Inc.; see [md-sdat-entities](md-sdat-entities.md) for the charter file and
its contact. The same purchase would be the route to Maryland owners of record, and its licence terms
would need the same review.

## Real run

Run 2026-11-03 on the three archived county files (`collected/md-sdat-real-property/<sha16>/ed4q-f8tm.csv`),
each loaded with `python -m factlot.registry.adapters.md_sdat <file> registry.db --as-of 2026-10-05`
(the portal's record-update date) into a fresh SQLite file:

| County (FIPS)            | Rows read / parcels kept | `F1`   | `F2`  | `B`   | Facts written | Seconds |
| ------------------------ | ------------------------ | ------ | ----- | ----- | ------------- | ------- |
| Montgomery (24031)       | 11,580 rows; 11,578 kept | 8,826  | 1,470 | 1,282 | 91,785        | 2.9     |
| Prince George's (24033)  | 13,023; 13,023           | 8,615  | 3,269 | 1,139 | 108,191       | 2.6     |
| Baltimore County (24005) | 14,494; 14,494           | 8,461  | 3,151 | 2,882 | 112,343       | 3.3     |
| **Total**                | **39,097; 39,095**       | 25,902 | 7,890 | 5,303 | 312,319       | 8.8     |

- Skipped: the two Montgomery accounts with a deletion date (`2026.08.06`). Out-of-scope rows: none
  (the export is pre-filtered). Invalid ids, errors, retired: 0, 0, 0.
- Owners: none in the source, so none stored and none counted as withheld. Organisation owners: 0.
- Fields present among the kept parcels (Montgomery / Prince George's / Baltimore County): situs
  11,572 / 12,999 / 14,417; land area 9,973 / 12,977 / 12,780; structure area 8,577 / 8,730 / 9,024;
  year built 5,030 / 8,666 / 5,634; market value 10,950 / 12,875 / 13,503; assessed value 10,949 /
  12,875 / 13,503.
- Snapshot document ids (`fl:document:sha256-` plus the sha256 of the file): Montgomery
  `b8c5022b78753b6c…`, Prince George's `6d2b09239ae981be…`, Baltimore County `7fca9ba1d85d6008…`; the full
  ids are in the collector manifest (`manifest.jsonl`) and in the scratch registry's `snapshots` table.

## Full load (2026-11-03)

Release `data-2026-11-03-41603209834` (draft, maintainers only) of `9mp96ygnbk-alt/factlot`. Each asset's sha256 was checked against the manifest and its first 16 hex characters against the name. Loaded into the Tier 2 scratch registry (one SQLite file shared by every Tier 2 source, `ct-sos-entities` first).

Assets (document id from the manifest):

- `md-sdat-real-property__b8c5022b78753b6c__ed4q-f8tm.csv` (3,204,693 bytes): `fl:document:sha256-b8c5022b78753b6c2b7ac89907a69ed7c1ff47b9342f699fde7346619fc5c980`
- `md-sdat-real-property__6d2b09239ae981be__ed4q-f8tm.csv` (3,656,990 bytes): `fl:document:sha256-6d2b09239ae981beb2bc61eaf3d0bd6fa8bf8550d4b299f1f2a240f9d7970d5d`
- `md-sdat-real-property__7fca9ba1d85d6008__ed4q-f8tm.csv` (3,774,152 bytes): `fl:document:sha256-7fca9ba1d85d6008f21cb191cc6c35382f4e4f8b50129ccef6277b20763bae8e`

Command:

```
PYTHONPATH=python/src python3 -m factlot.registry.adapters.md_sdat <county csv> registry.db --as-of 2026-10-05 --retrieved-at <manifest checked_at>   # once per file, no --full-roll
```

- Rows read: 11,580 (Montgomery) + 13,023 (Prince George's) + 14,494 (Baltimore County) = 39,097 data rows; the two Montgomery accounts with a deletion date are skipped.
- Parcels kept: **39,095** distinct commercial parcels (`B` 5,303, `F1` 25,902, `F2` 7,890).
- By county:
  - Montgomery (MD) (FIPS 24031): 11,578 parcels (`B` 1,282, `F1` 8,826, `F2` 1,470); organisation owners 0; ownership links 0.
  - Prince George's (FIPS 24033): 13,023 parcels (`B` 1,139, `F1` 8,615, `F2` 3,269); organisation owners 0; ownership links 0.
  - Baltimore County (FIPS 24005): 14,494 parcels (`B` 2,882, `F1` 8,461, `F2` 3,151); organisation owners 0; ownership links 0.
- Facts written: 312,319. Seconds: 16.3. Invalid ids, errors, retired: 0, 0, 0.
- Organisation owners stored (current owner-of-record facts): 0; natural persons or withheld owners not stored (names not kept): 0. The source carries no owner, so none is stored or counted as withheld.
- Ownership links to registered entities after `link_owners()`: 0 (the only entity registry in the scratch file is `ct-sos-entities`).

## Statewide extension (2026-11-03)

The licence (public domain, portal licence field) covers the whole statewide dataset, so the extension is
configuration and testing only. The config now lists 24 files, one per jurisdiction: the three Tier 2
counties first, then the other 20 counties and Baltimore City alphabetically, each the same SoQL CSV
(land use C, CC, I, M; the same 33 columns) with another `county_name_mdp_field_cntyname`.

- **Jurisdiction list, from the publisher's own data.** SoQL `count(*)` grouped by
  `county_name_mdp_field_cntyname`, `jurisdiction_code_mdp_field_jurscode` and land use on `ed4q-f8tm`
  returns 24 names, each with one four-letter MDP jurisdiction code (`ALLE`, `ANNE`, `BACO`, `BACI`, …,
  `WORC`). The portal spells them `Prince George's`, `Queen Anne's`, `St. Mary's`, `Baltimore` (the
  county) and `Baltimore City`; all 24 map to their FIPS codes in the adapter's `COUNTY_FIPS`, which
  already held every jurisdiction. Every row carries the same record-update date (`20261005`).
- **Jurisdictions added (21):** Allegany, Anne Arundel, Baltimore City, Calvert, Caroline, Carroll, Cecil,
  Charles, Dorchester, Frederick, Garrett, Harford, Howard, Kent, Queen Anne's, Somerset, St. Mary's,
  Talbot, Washington, Wicomico, Worcester.
- **Codes.** The land use field uses the same SDAT values in every jurisdiction (`Commercial (C)` …
  `Marsh Land (MA)`; one account statewide has none). No jurisdiction-specific mapping is needed.
- **Account ids.** The in-scope account ids of every jurisdiction were read (`$select` of the account and
  county only, 3.07 MB) to check that the registry's alphanumeric APN keeps them apart. Twenty-three
  jurisdictions use digits only, in one fixed length each (10 digits; Anne Arundel 15, Baltimore County
  14, Montgomery 12, Prince George's 11). Baltimore City's ids carry a space or a letter in the block and
  lot (`9999999999 999` 10,721; `9999999999A999` 2,367; `9999999999 999A` 1,291; `9999999999A999A`
  453; `999999AAA9 999` 5). Dropping the space leaves 0 collisions among the 109,255 in-scope accounts, so
  the adapter keeps the account id as the APN; the raw id (with its space) is the crosswalk value.
- **URL check.** One request per new file with `%24limit=200000` replaced by `%24limit=5`, through the
  collector's `PoliteFetcher` (user agent, robots.txt, `Crawl-delay: 1`, 2-second interval): all 21
  answered HTTP 200 with the 33-column header and 5 rows of the right jurisdiction. A separate count query
  that used `IS NOT NULL` was answered with a Cloudflare block page (HTTP 403, "Sorry, you have been
  blocked"); it was not retried in another form, and its figure (deleted accounts per county) is not
  needed. No full file was downloaded.
- **In-scope counts** (SoQL `count(*)` by jurisdiction and land use, 2026-11-03; no download; the counts
  include accounts with a deletion date, which the adapter skips, e.g. Montgomery's two). The 21 new
  jurisdictions hold **70,158** in-scope accounts (`B` 6,449, `F1` 55,613, `F2` 8,096); the state 109,255.
  The largest file is Baltimore City's (14,837 rows).

| Jurisdiction (FIPS)      |  All accounts |    In scope |        `B` |       `F1` |       `F2` | URL check (`$limit=5`)  |
| ------------------------ | ------------: | ----------: | ---------: | ---------: | ---------: | ----------------------- |
| Allegany (24001)         |        41,474 |       3,433 |        385 |      2,703 |        345 | HTTP 200, 5 rows        |
| Anne Arundel (24003)     |       229,245 |       9,049 |        277 |      7,672 |      1,100 | HTTP 200, 5 rows        |
| Baltimore County (24005) |       306,537 |      14,494 |      2,882 |      8,461 |      3,151 | Tier 2 (already loaded) |
| Baltimore City (24510)   |       241,663 |      14,837 |      2,495 |      9,974 |      2,368 | HTTP 200, 5 rows        |
| Calvert (24009)          |        43,332 |       1,042 |         25 |        867 |        150 | HTTP 200, 5 rows        |
| Caroline (24011)         |        16,708 |         891 |         90 |        669 |        132 | HTTP 200, 5 rows        |
| Carroll (24013)          |        69,323 |       3,318 |        474 |      2,517 |        327 | HTTP 200, 5 rows        |
| Cecil (24015)            |        48,466 |       2,605 |        112 |      2,274 |        219 | HTTP 200, 5 rows        |
| Charles (24017)          |        75,796 |       3,044 |         95 |      2,586 |        363 | HTTP 200, 5 rows        |
| Dorchester (24019)       |        22,818 |       1,131 |         25 |        925 |        181 | HTTP 200, 5 rows        |
| Frederick (24021)        |       112,759 |       4,353 |        353 |      3,440 |        560 | HTTP 200, 5 rows        |
| Garrett (24023)          |        30,637 |       1,445 |         46 |      1,377 |         22 | HTTP 200, 5 rows        |
| Harford (24025)          |       103,496 |       3,735 |        243 |      3,130 |        362 | HTTP 200, 5 rows        |
| Howard (24027)           |       112,796 |       4,226 |        198 |      3,238 |        790 | HTTP 200, 5 rows        |
| Kent (24029)             |        13,622 |         676 |         22 |        649 |          5 | HTTP 200, 5 rows        |
| Montgomery (24031)       |       355,455 |      11,580 |      1,282 |      8,826 |      1,472 | Tier 2 (already loaded) |
| Prince George's (24033)  |       315,543 |      13,023 |      1,139 |      8,615 |      3,269 | Tier 2 (already loaded) |
| Queen Anne's (24035)     |        27,776 |       1,528 |         46 |      1,472 |         10 | HTTP 200, 5 rows        |
| Somerset (24039)         |        16,890 |         994 |         46 |        948 |          0 | HTTP 200, 5 rows        |
| St. Mary's (24037)       |        51,187 |       1,945 |        169 |      1,681 |         95 | HTTP 200, 5 rows        |
| Talbot (24041)           |        22,177 |       1,418 |         89 |      1,260 |         69 | HTTP 200, 5 rows        |
| Washington (24043)       |        61,110 |       3,690 |        660 |      2,670 |        360 | HTTP 200, 5 rows        |
| Wicomico (24045)         |        48,470 |       3,204 |        303 |      2,452 |        449 | HTTP 200, 5 rows        |
| Worcester (24047)        |        66,725 |       3,594 |        296 |      3,109 |        189 | HTTP 200, 5 rows        |
| **All 24 jurisdictions** | **2,434,005** | **109,255** | **11,752** | **81,515** | **15,988** |                         |

- **Multi-file loading.** Each file is loaded without `--full-roll` (the adapter's default), so no
  jurisdiction retires another's accounts.
- **Tests added** (`python/tests/test_adapter_md_sdat.py`): all 24 portal names map to their FIPS codes;
  Baltimore City ids with a space or a letter, and St. Mary's and Queen Anne's rows, load as distinct
  parcels in the right county.

## Statewide full load (2026-11-03)

Release `data-2026-11-03-41618090881` (draft, maintainers only) of `9mp96ygnbk-alt/factlot`: 21 jurisdiction CSVs (`md-sdat-real-property__<sha16>__ed4q-f8tm.csv`, 18,527,445 bytes in all) and the source's manifest, downloaded with `gh release download` into an empty directory and read as untrusted data (`python3 -I`, scripts kept outside the directory). Each file's sha256 was checked against the manifest (and its byte size and document id), and its first 16 hex characters against the name: 21 of 21 matched. The manifest also lists 3 archived entries that are in the earlier release `data-2026-11-03-41603209834` (the Full load above), not in this one. A file's document id is `fl:document:sha256-` plus its sha256; its first 16 characters are the `sha16` column. Loaded into the same Tier 2 scratch registry as the Full load, after it; `purge_person_owners()` and `link_owners()` were then run once for all five statewide sources together.

Command, once per file (no `--full-roll`):

```
PYTHONPATH=python/src python3 -m factlot.registry.adapters.md_sdat <jurisdiction csv> registry.db --as-of 2026-10-05 --retrieved-at <manifest checked_at>
```

- Rows read: 70,158 data rows in the 21 files; 8 accounts with a deletion date are skipped (Baltimore City 5, Anne Arundel 3), which is the whole difference from the publisher's in-scope counts recorded in the statewide extension (Baltimore City 14,837, Anne Arundel 9,049); every other jurisdiction equals its publisher count.
- Parcels kept: **70,150** distinct commercial parcels in 21 jurisdictions (`B` 6,449, `F1` 55,608, `F2` 8,093).
- With the three Tier 2 counties the whole state is loaded: 109,245 parcels in 24 jurisdictions (11,752 `B`, 81,510 `F1`, 15,983 `F2`), against the publisher's 109,255 accounts (10 deletions skipped: the 8 above and Montgomery's 2).
- Facts written: 566,190. Adapter seconds: 82.8. Invalid ids, errors, retired: 0, 0, 0.
- Organisation owners stored: 0; natural persons or withheld owners not stored: 0. The source carries no owner, so none is stored or counted as withheld.
- Ownership links to registered entities after `link_owners()`: 0.
- Baltimore City's ids with a space or a letter loaded as distinct parcels (the 14,832 parcels equal its kept records).

By jurisdiction:

| County (FIPS)          |    Parcels |       `B` |       `F1` |      `F2` | Organisation owners | Ownership links | Asset sha16        |
| ---------------------- | ---------: | --------: | ---------: | --------: | ------------------: | --------------: | ------------------ |
| Allegany (24001)       |      3,433 |       385 |      2,703 |       345 |                   0 |               0 | `ae1202c3c38b5778` |
| Anne Arundel (24003)   |      9,046 |       277 |      7,671 |     1,098 |                   0 |               0 | `a00e23770a65a971` |
| Calvert (24009)        |      1,042 |        25 |        867 |       150 |                   0 |               0 | `d8051a8ebc382092` |
| Caroline (24011)       |        891 |        90 |        669 |       132 |                   0 |               0 | `fddc2a6bda1544d1` |
| Carroll (24013)        |      3,318 |       474 |      2,517 |       327 |                   0 |               0 | `9445b060eb92e0cd` |
| Cecil (24015)          |      2,605 |       112 |      2,274 |       219 |                   0 |               0 | `1add8195ffc047aa` |
| Charles (24017)        |      3,044 |        95 |      2,586 |       363 |                   0 |               0 | `6c8c5f2d4c4420ee` |
| Dorchester (24019)     |      1,131 |        25 |        925 |       181 |                   0 |               0 | `9bd93c07dbef29d8` |
| Frederick (24021)      |      4,353 |       353 |      3,440 |       560 |                   0 |               0 | `5f2f461fc4d7b47e` |
| Garrett (24023)        |      1,445 |        46 |      1,377 |        22 |                   0 |               0 | `0ddceaad742803be` |
| Harford (24025)        |      3,735 |       243 |      3,130 |       362 |                   0 |               0 | `85ca0a47df53a90b` |
| Howard (24027)         |      4,226 |       198 |      3,238 |       790 |                   0 |               0 | `5473251dac200338` |
| Kent (24029)           |        676 |        22 |        649 |         5 |                   0 |               0 | `32539cbbb7b390f7` |
| Queen Anne's (24035)   |      1,528 |        46 |      1,472 |        10 |                   0 |               0 | `0005064ae3fc02a4` |
| St. Mary's (24037)     |      1,945 |       169 |      1,681 |        95 |                   0 |               0 | `d1022ebf21e56a6a` |
| Somerset (24039)       |        994 |        46 |        948 |         0 |                   0 |               0 | `e9594a4026b7e06c` |
| Talbot (24041)         |      1,418 |        89 |      1,260 |        69 |                   0 |               0 | `442ae0fd1b50171b` |
| Washington (24043)     |      3,690 |       660 |      2,670 |       360 |                   0 |               0 | `66f7a584704e5f46` |
| Wicomico (24045)       |      3,204 |       303 |      2,452 |       449 |                   0 |               0 | `2ef90ca2527d5bb3` |
| Worcester (24047)      |      3,594 |       296 |      3,109 |       189 |                   0 |               0 | `09117ee71a92fcc4` |
| Baltimore City (24510) |     14,832 |     2,495 |      9,970 |     2,367 |                   0 |               0 | `6c4ba70b4ff75d7f` |
| **All 21 counties**    | **70,150** | **6,449** | **55,608** | **8,093** |               **0** |           **0** |                    |

## Known gaps

- **No owners.** See Gates. Maryland parcels cannot be linked to entities from this source, so the
  entity registry for Maryland (gated) would only link Maryland companies that own parcels elsewhere.
- **`M` Apartments is the publisher's class, not a 5+ unit test.** The dwelling-unit count field
  (field 239) is recorded as fewer than five on 541 of 1,282 Montgomery, 319 of 1,139 Prince George's
  and 2,301 of 2,882 Baltimore County `M` accounts (1,873 of those Baltimore County accounts say one
  unit, 419 say zero). The count is a CAMA field that may describe a building rather than the
  account; the file does not say. All `M` accounts are kept as `B`; a reviewer may want to require
  five or more units where the count is filled, which would remove about 40% of `M` in Baltimore County.
- **Mixed use and exempt commercial are out of scope** (`CR`, `RC`, `EC`), as in the Boston and
  Cambridge sources. `CR` (1,194 accounts in the three counties) is mostly commercial; a reviewer may
  admit it as `F1`.
- **Values are SDAT's.** `market_value` is land plus improvements of the current cycle (full cash
  value, which Maryland assesses at 100%); `appraised_value` is the phase-in total, which lags a rising
  full value by up to three years. Land is recorded in the unit SDAT uses; 46 Prince George's, 1,605
  Montgomery and 1,714 Baltimore County rows have a blank unit, so their land area is not recorded.
- **`tax_year` is not set.** The file's cycle year (`assessment_cycle_year`, 2027 for every row) names
  the SDAT reassessment cycle group, not the tax year; pass `--tax-year` to record one.
- **Premise address versus owner address.** MDP's street address column is filled from the owner's
  address for some owner-occupied accounts (documentation PDF, MdProperty View notes); the adapter uses
  the premise columns first and the MDP address only when the premise has no street name, and
  commercial accounts are rarely owner-occupied.
- **The file does not carry coordinates or geometry** (`mappable_latitude_and_longitude` exists in the
  dataset but is not requested).

## Correction (2026-11-06)

The sections above are the 2026-11-03 load at `--as-of 2026-10-05` (109,245 parcels kept: `B` 11,752, `F1` 81,510, `F2` 15,983). Those tables are unchanged.

Terms re-read the same day from <https://opendata.maryland.gov/api/views/ed4q-f8tm.json> (HTTP 200, `Fri, 06 Nov 2026 22:55:26 GMT`): `licenseId` `PUBLIC_DOMAIN`, `license.name` `Public Domain`, attribution `SDAT (State Department of Assessments and Taxation) and MDP (Maryland Department of Planning)`. The documentation PDF disclaimer is still "MDP does not provide any guaranty of accuracy or completeness regarding the map information." robots.txt is unchanged (`User-agent: *`, `Crawl-delay: 1`). No new redistribution, commercial-use, or AI-use restriction was in that metadata or the PDF. A separate asset, `9xq5-z8s2` ("Includes Property Owner Names"), is described on the portal data story as requiring a signed user license agreement. That asset was not requested. Evidence and the verbatim sentences: `docs/registry/quality/surge-2026-11/md-sdat-real-property.md`.

Freshness moved. `rowsUpdatedAt` is 1793936319 (2026-11-06T03:38:39Z). A SoQL group of `date_of_most_recent_open_data_portal_record_update` on `ed4q-f8tm` returned `20261105` for 2,434,580 accounts and `20261005` for 45. The scratch load's as-of date is 2026-11-05. The `--as-of` commands in the sections above stay 2026-10-05; the coverage generator reads those commands, and regenerating the county file is the integrator's step.

Kept on that load, all 24 jurisdiction files, deletion-dated accounts skipped (Montgomery 3, Anne Arundel 4, Baltimore City 5): **109,249** parcels (`B` 11,746, `F1` 81,561, `F2` 15,942). Facts written: 878,548. Person-like owner facts: 0. Owner-of-record facts: 0. Calvert (1,042) and Garrett (1,445) match the 2026-11-03 kept counts. The Tier 1 re-read matched the registry in every county (0 audit violations). Audit warnings, which do not fail the bar: 4 implausible years built and 7 implausible areas.

| County (FIPS)            | Parcels kept |        `B` |       `F1` |       `F2` |
| ------------------------ | -----------: | ---------: | ---------: | ---------: |
| Allegany (24001)         |        3,434 |        385 |      2,704 |        345 |
| Anne Arundel (24003)     |        9,049 |        273 |      7,679 |      1,097 |
| Baltimore County (24005) |       14,490 |      2,878 |      8,459 |      3,153 |
| Calvert (24009)          |        1,042 |         25 |        867 |        150 |
| Caroline (24011)         |          887 |         90 |        671 |        126 |
| Carroll (24013)          |        3,327 |        475 |      2,525 |        327 |
| Cecil (24015)            |        2,606 |        112 |      2,274 |        220 |
| Charles (24017)          |        3,043 |         95 |      2,585 |        363 |
| Dorchester (24019)       |        1,132 |         25 |        926 |        181 |
| Frederick (24021)        |        4,351 |        352 |      3,437 |        562 |
| Garrett (24023)          |        1,445 |         46 |      1,378 |         21 |
| Harford (24025)          |        3,738 |        243 |      3,133 |        362 |
| Howard (24027)           |        4,225 |        198 |      3,237 |        790 |
| Kent (24029)             |          677 |         22 |        650 |          5 |
| Montgomery (24031)       |       11,579 |      1,283 |      8,826 |      1,470 |
| Prince George's (24033)  |       13,029 |      1,143 |      8,621 |      3,265 |
| Queen Anne's (24035)     |        1,530 |         46 |      1,474 |         10 |
| St. Mary's (24037)       |        1,944 |        168 |      1,681 |         95 |
| Somerset (24039)         |          995 |         46 |        949 |          0 |
| Talbot (24041)           |        1,416 |         89 |      1,258 |         69 |
| Washington (24043)       |        3,716 |        660 |      2,696 |        360 |
| Wicomico (24045)         |        3,201 |        303 |      2,451 |        447 |
| Worcester (24047)        |        3,592 |        294 |      3,109 |        189 |
| Baltimore City (24510)   |       14,801 |      2,495 |      9,971 |      2,335 |
| **All 24**               |  **109,249** | **11,746** | **81,561** | **15,942** |

On the kept `M` accounts, field 239 is under 5 for 541 of 1,283 Montgomery, 320 of 1,143 Prince George's, and 2,301 of 2,878 Baltimore County (1,873 of those say one unit and 419 say zero). Statewide, 6,042 of 11,746. The 2026-11-03 known-gaps sentences stay as that day's measurement.
