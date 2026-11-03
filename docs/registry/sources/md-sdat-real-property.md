# md-sdat-real-property: Maryland Real Property Assessments (SDAT and MDP, statewide)

Review record for the source `md-sdat-real-property` (data policy §5). Reviewed 2026-11-03.
Machine-readable copy:
[`registry/sources/md/md-sdat-real-property.json`](../../../registry/sources/md/md-sdat-real-property.json).
Adapter: `python/src/factlot/registry/adapters/md_sdat.py` (account system `sdat_account`); tests:
`python/tests/test_adapter_md_sdat.py`.

**One statewide dataset covers all three Tier 2 Maryland counties** (Montgomery 24031, Prince
George's 24033, Baltimore County 24005) and the other 21 jurisdictions, including Baltimore City
(24510). **The publisher withholds owner names**: the dataset is titled "Hidden Property Owner Names",
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
