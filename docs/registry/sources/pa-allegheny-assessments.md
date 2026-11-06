# pa-allegheny-assessments: Allegheny County Property Assessments (WPRDC)

Review record for the source `pa-allegheny-assessments` (data policy §5). Reviewed 2026-11-03.
Machine-readable copy:
[`registry/sources/pa/pa-allegheny-assessments.json`](../../../registry/sources/pa/pa-allegheny-assessments.json).
Adapter: `python/src/factlot/registry/adapters/pa_allegheny.py` (account system `allegheny_parid`,
FIPS 42003); tests: `python/tests/test_adapter_pa_allegheny.py`.

**The county excludes owner names** (dataset description: "Excludes name and contact information for
property owners, as required by Ordinance 3478-07"). The roll is CC0 and complete for the county's
parcels, but every parcel loads without an owner of record.

## Publisher and URLs

- Publisher: Allegheny County Office of Property Assessments, published by the Western Pennsylvania
  Regional Data Center (WPRDC, University of Pittsburgh), a CKAN portal.
- Dataset: "Allegheny County Property Assessments", package `property-assessments` (id
  `2b3df818-601e-4f06-b150-643557229491`), <https://data.wprdc.org/dataset/property-assessments>;
  update frequency monthly; `metadata_modified` 2026-11-02.
- File used: resource `9a1c60bd-f9f7-4aba-aeb7-af8c3aaa44e5` "Property Assessments Parcel Data (for
  downloads)", CSV,
  `https://data.wprdc.org/dataset/2b3df818-601e-4f06-b150-643557229491/resource/9a1c60bd-f9f7-4aba-aeb7-af8c3aaa44e5/download/data.csv`:
  **312,706,781 bytes** (header `Content-Length`), `Last-Modified: Mon, 02 Nov 2026 18:42:32 GMT`,
  `Accept-Ranges: bytes`. Over the 50 MB limit, so it was not downloaded; three ranged samples of
  3,000,000 bytes each (offsets 0, 150,000,000 and 300,000,000) were read, cut at line boundaries. Row
  count not counted (the sample averages about 540 bytes a row, which would put the file near 580,000
  parcels; an estimate only).
- Also in the config: the data dictionary `data-dictionary-open-data.csv` (20,293 bytes, read in full).
  Not used: the API-optimised twin `65855e14-549e-4992-b5be-d629afc676fa`, the 2016-2020 archives, and the
  User Guide PDF (335,628 bytes, linked from the dataset).

## Terms, license, robots

- License field: **Creative Commons CCZero** (`license_id` `cc-zero`,
  <http://www.opendefinition.org/licenses/cc-zero>). Dataset disclaimer: "Parcel information is
  provided from the Office of Property Assessments in Allegheny County. Content and availability are
  subject to change... Please take the dynamic nature of this information into consideration before
  using it."
- AI use: not addressed; CC0 places the data in the public domain. Redistribution: permitted. The
  registry attributes "Allegheny County Office of Property Assessments, via WPRDC".
- robots.txt (`data.wprdc.org`): `Crawl-delay: 10`; `Disallow` for search/facet URLs (`q=`, `tags=`, `sort=`,
  `res_format=` and similar), `/datastore/dump/`, `/api/`, `/dataset/activity/`, `/user/` and edit paths.
  The file's own comment says these rules are "NOT a usage policy": "You are welcome to use the CKAN API
  (/api/) and the DataStore dump downloads (/datastore/dump/) from your own code", and they are listed
  "only to prevent the heavy activity we see from crawlers". **Approach:** the collector config uses
  only the dataset page and `/dataset/.../download/data.csv`, which robots.txt allows. To find the
  resource ids, two CKAN API calls were made (`package_search`, `package_show`) with the collector's user
  agent, which the file's text invites for scripts; the collector itself never calls `/api/`.
- `verified: true`: terms and robots read and recorded; the file URL is confirmed by ranged downloads
  (`206 Partial Content`) and the collector's `discover` (three allowed links found on the dataset page);
  the licence is CC0 and does not restrict AI use.

## What the file contains

One CSV row per parcel, 86 columns, UTF-8; integer-looking columns can be written as floats
(`PROPERTYHOUSENUM` `1.0`, `PROPERTYZIP` `15222.0`); `ASOFDATE` like `30-OCT-26`. Columns used (definitions
in `data-dictionary-open-data.csv`):

| Column                                                                                                                    | Use                                                                                                      |
| ------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `PARID`                                                                                                                   | 16-character parcel id (APN); unique in the sample (16,690 rows, 16,690 ids)                             |
| `PROPERTYHOUSENUM`, `PROPERTYFRACTION`, `PROPERTYADDRESS`, `PROPERTYUNIT`, `PROPERTYCITY`, `PROPERTYSTATE`, `PROPERTYZIP` | Situs                                                                                                    |
| `CLASS`, `USECODE`, `USEDESC`, `TAXCODE`                                                                                  | Class letter, land use code, description, tax status (`T` taxable, `E` exempt, `P` PURTA)                |
| `LOTAREA`                                                                                                                 | Land square feet                                                                                         |
| `FAIRMARKETTOTAL`, `COUNTYTOTAL`, `TAXYEAR`                                                                               | Base-year (2012) fair market value → `market_value`; county assessed value → `appraised_value`; tax year |
| `YEARBLT`                                                                                                                 | Year the dwelling was built (blank for commercial parcels)                                               |
| `OWNERCODE`, `OWNERDESC`, `CHANGENOTICEADDRESS1-4`                                                                        | Owner type and mailing address: **not used** (see below)                                                 |

Class and land use mapping (`state_category`; the publisher's `USECODE` is kept in `local_use_code`):

| Publisher's class / code                                                    | Category | Notes                                                                                                                             |
| --------------------------------------------------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `CLASS C` and `TAXCODE T`, `USECODE` 401, 402, 403                          | `B`      | `APART: 5-19 UNITS`, `APART:20-39 UNITS`, `APART:40+ UNITS`                                                                       |
| `CLASS C` and `TAXCODE T`, any other code                                   | `F1`     | Includes vacant commercial land (`400`), retail/office/apartments over (`404`-`406`, `431`), commercial condominium units (`550`) |
| `CLASS I` and `TAXCODE T`                                                   | `F2`     | Manufacturing, warehouses (`350`-`352`), vacant industrial land (`300`)                                                           |
| every other class (`R`, `G`, `U`, `F`, `O`) or any `TAXCODE` other than `T` | none     | Four-family (`40`) and condominiums (`50`) are class `R`                                                                          |

Owners: the file has no owner name. It has `OWNERCODE`/`OWNERDESC` (owner type: `CORPORATION`, `REGULAR`,
`REGULAR-ETAL`...) and a "change notice" address that the data dictionary calls the "address of owner
of the property". Without a name, that address could belong to a person, so the adapter copies neither;
`owner_name` and `owner_mailing_address` are `None` and `owner_confidential` is `False` (the withholding
is a blanket ordinance, not a per-owner flag).

## Gates

None. No account, login, agreement, CAPTCHA, fee, or records request is needed. A person who wants Allegheny
owner names would have to look to another route: the county's Real Estate Portal search page
(`alleghenycounty.us/RealEstate/search.aspx`) is a form-driven site and was not read or scraped, and the
ordinance behind the exclusion suggests a records request would be refused for the owner field.

## Real run

On the three ranged samples only (16,690 rows, 16,690 distinct `PARID`s; windows of the file at 0%, 48% and
96% of its length, so they are not a random sample; the first starts at the 1st Ward of Pittsburgh).
Command, on the cleaned sample CSV with the same header:

```
python -m factlot.registry.adapters.pa_allegheny allegheny_sample.csv registry.db --as-of 2026-11-02 --partial
```

| Count                                                          | Value                                                                         |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Rows read                                                      | 16,690 (class `R` 14,062; `C` 1,581; `G` 839; `O` 84; `I` 45; `F` 44; `U` 35) |
| Parcels kept                                                   | 1,437 (`F1` 1,228; `B` 164 = `401` 100, `403` 43, `402` 21; `F2` 45)          |
| Rows out of scope                                              | 15,253 (residential 14,062; government 839; exempt class `C` 189; other 163)  |
| Facts written                                                  | 11,384                                                                        |
| Owners stored / natural persons or withheld                    | 0 / 0 (no owner in the source)                                                |
| Situs / land area / market value / assessed value / year built | 1,437 / 1,356 / 1,413 / 1,412 / 18                                            |
| Invalid ids, errors, retired                                   | 0, 0, 0                                                                       |

The full file was not loaded (rule: no download over 50 MB). The first load will come from GitHub's
network through the weekly collector workflow; the adapter streams the CSV row by row.

## Full load (2026-11-03)

Release `data-2026-11-03-41603209834` (draft, maintainers only) of `9mp96ygnbk-alt/factlot`. Each asset's sha256 was checked against the manifest and its first 16 hex characters against the name. Loaded into the Tier 2 scratch registry (one SQLite file shared by every Tier 2 source, `ct-sos-entities` first).

Assets (document id from the manifest):

- `pa-allegheny-assessments__acd7d834c5da1af1__data.csv` (312,706,781 bytes): `fl:document:sha256-acd7d834c5da1af1213dd36bf1c2d61e43fa3a85cf3b1488e28f402239fca413`
- `pa-allegheny-assessments__1a847c070b1a94ec__data-dictionary-open-data.csv` (20,293 bytes): `fl:document:sha256-1a847c070b1a94ec80de53db992050ef53121050af74de165778ad6b4c1346ca`

Command:

```
PYTHONPATH=python/src python3 -m factlot.registry.adapters.pa_allegheny <data.csv> registry.db --as-of 2026-11-02 --retrieved-at <manifest checked_at>
```

- Rows read: 584,995 data rows (the whole county assessment file).
- Parcels kept: **35,302** distinct commercial parcels (`B` 3,695, `F1` 28,130, `F2` 3,477).
- Facts written: 281,761. Seconds: 18.5. Invalid ids, errors, retired: 0, 0, 0.
- Organisation owners stored (current owner-of-record facts): 0; natural persons or withheld owners not stored (names not kept): 0. The source carries no owner.
- Ownership links to registered entities after `link_owners()`: 0 (the only entity registry in the scratch file is `ct-sos-entities`).
- The data dictionary asset (`data-dictionary-open-data.csv`) was archived with it and is not loaded.

## Known gaps

- **No owners.** See above. Allegheny parcels cannot be linked to registered entities from this source.
- **Base-year values.** Allegheny values everything at a 2012 base year: `FAIRMARKETTOTAL` is a 2012
  appraisal and `COUNTYTOTAL` the county assessed value after abatements and preferential assessments.
  Current market value is not in the file.
- **No building area or commercial year built.** `FINISHEDLIVINGAREA` and `YEARBLT` describe the
  dwelling only (year built is filled for 18 of 1,437 kept parcels).
- **Mixed use filed as commercial.** Retail or office over apartments (`404`-`406`, `431`) and residential
  conversions are `F1` because the county classes them commercial; four-unit buildings (`40` FOUR FAMILY)
  are residential and out of scope.
- **Land-use codes not seen.** The sample holds 105 distinct `USECODE` values (65 in classes `C` and `I`) of the roughly 200 the county describes; the mapping
  uses the class letter rather than the code (except the three apartment codes), so unseen codes need no
  mapping. A different apartment code outside `401`-`403` would be missed; the data dictionary does not
  list the codes.
- **Exempt parcels** (`TAXCODE E`: churches, charities, some `C` parcels) are out of scope, as in other
  sources; `TAXCODE P` (PURTA utilities) is out too.
- The numeric columns arrive as floats in this edition of the file; the adapter handles `1.0` and `15222.0`
  but a future edition that changes the layout must be re-checked against the data dictionary.
