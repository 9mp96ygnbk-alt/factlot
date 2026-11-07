# mi-oakland-parcels: Oakland County, Michigan (FIPS 26125) open-data tax parcels

Reviewed 2026-11-03. Machine-readable copy: [`registry/sources/mi/mi-oakland-parcels.json`](../../../registry/sources/mi/mi-oakland-parcels.json).
Adapter: `factlot.registry.adapters.mi_oakland` (account system `oakland_pin`, the 10-digit parcel number).

**Status: `verified: true`, but the open layer has no owner names.** Unlike Wayne County (`mi-wayne-parcels`, portal terms limit saved
materials to personal, non-commercial use), Oakland's Open Data Terms of Use expressly permit reuse and distribution for any lawful purpose.

## Publisher and URLs

- Publisher: Oakland County, Michigan (Access Oakland Open Data; Oakland County GIS and Equalization).
- ArcGIS Online item `e2910cc3a8f84549ab7f0f8e8f99817b` "OC Tax Parcels (Public)"
  (<https://www.arcgis.com/home/item.html?id=e2910cc3a8f84549ab7f0f8e8f99817b>), published on the county's Access Oakland open-data portal.
- Service: `https://gisservices.oakgov.com/arcgis/rest/services/Enterprise/EnterpriseOpenParcelDataMapService/MapServer/1`
  ("Tax Parcel Plus", 490,784 parcels, `maxRecordCount` 2000).
- Not used: item `f9085f6af2514b97ac7beefc84918145` "OC Tax Parcel - Stacked 101" (Oakland County Enhanced Access Policy and GIS Data Policy).

## Terms, license, robots

- **Terms.** The item's `licenseInfo` is the "OPEN DATA TERMS OF USE AGREEMENT". Section 3: "You may retrieve, download, copy, modify,
  translate, adapt, distribute, sort, search, and reuse Open Data for any lawful purpose." Section 1 says accessing or downloading the
  data accepts the terms (browse-wrap; there is no click-through in front of the service). Sections 4-9: indemnification, as-is
  disclaimers, limits of liability; "THE OPEN DATA IS PROVIDED TO THE PUBLIC FREE OF CHARGE". No attribution requirement and no AI clause were
  found in the text read (the first 5,000 characters, sections 1-9).
- **robots.txt.** `gisservices.oakgov.com`: none (404 page). `discover` reported the item page `ok`.

## What the file contains

14 pages (`returnGeometry=false`, `OBJECTID_12` order, 2,000 features each) of the parcels with a Michigan class code beginning 2 or 3 (26,128).
Columns: `KEYPIN`, `PIN`, `REVISIONDATE`, `CVTTAXCODE`/`CVTTAXDESCRIPTION` (municipality), `CLASSCODE`, `NAME1`, `NAME2`, `SITEADDRESS`,
`SITECITY`, `SITESTATE`, `SITEZIP5`, `POSTALADDRESS` (owner mailing street line), `ASSESSEDVALUE`, `TAXABLEVALUE`, `NUM_BEDS`, `NUM_BATHS`,
`STRUCTURE_DESC`, `LIVING_AREA_SQFT`.

| `CLASSCODE` (Michigan STC, MCL 211.34c)                                                                                            | Count (county) | FactLot      |
| ---------------------------------------------------------------------------------------------------------------------------------- | -------------- | ------------ |
| 201 commercial improved (17,442), 202 vacant (3,347), 203 (168), 205 (1), 207 commercial condominium (501), 210 on leased land (4) | 21,463         | F1           |
| 301 industrial improved (3,261), 302 vacant (1,337), 303 (32), 307 (32), 310 (3)                                                   | 4,665          | F2           |
| 101/102 agricultural, 401/402/403/407 residential (345,773 / 27,336 / 3,888 / 86,186), 001/002/006/007 county special classes      |                | out of scope |

Michigan has no multifamily class (apartments of more than four units are commercial, 2xx) and this layer has no unit or occupancy column, so
apartments load as F1. **`NAME1` and `NAME2` are NULL on all 490,784 rows**; the county does not publish owner names in this layer. `POSTALADDRESS`
is filled but is stored only when an owner name exists, so it is not loaded.

## Gates

None for the layer. For owner names: the "Stacked 101" layer under the Enhanced Access Policy, or an Oakland County FOIA request for the
equalization file with owner names (see [public-information-requests.md](../public-information-requests.md)), is the route; neither was tried.

## Real run

`snapshot` on 2026-11-03: 14 pages, 11,691,525 bytes (first page `fl:document:sha256-d7ed305c4637a47d0dc251b044ec263ea3cbdb897be3f0f60dee1c40ac8bbdd8`),
then `mi_oakland.build` (4.0 s):

- Rows read: 26,128 features; parcels kept **26,124** (four repeated PINs dropped): F1 21,459, F2 4,665, B 0.
- Facts written: 124,858. Owner-of-record facts: 0. Situs 21,912; assessed value 24,340; living area 234.

## Full load (2026-11-03)

Release `data-2026-11-03-41603209834` (draft, maintainers only) of `9mp96ygnbk-alt/factlot`. Each asset's sha256 was checked against the manifest and its first 16 hex characters against the name. Loaded into the Tier 2 scratch registry (one SQLite file shared by every Tier 2 source, `ct-sos-entities` first).

Assets (document id from the manifest):

- `mi-oakland-parcels__d7ed305c4637a47d__query` (877,278 bytes): `fl:document:sha256-d7ed305c4637a47d0dc251b044ec263ea3cbdb897be3f0f60dee1c40ac8bbdd8`
- `mi-oakland-parcels__e2e6a9bf6544854f__query` (890,735 bytes): `fl:document:sha256-e2e6a9bf6544854f34dfd3c1b93db76102c659002dfdc70cf76a7f072cc0d2e6`
- `mi-oakland-parcels__72be90ef27f74019__query` (894,489 bytes): `fl:document:sha256-72be90ef27f7401961623709f422a1e1967b37cb23f9e3f7595fc7df4860c3b0`
- `mi-oakland-parcels__b70ebe23491da46b__query` (904,866 bytes): `fl:document:sha256-b70ebe23491da46b00c10011560c64eaed18e73e0135b81d161758d2da60eb9b`
- `mi-oakland-parcels__3dd0148907c56c3a__query` (895,463 bytes): `fl:document:sha256-3dd0148907c56c3a82e152637273f30c3aaff730b1c09bd21f46e0cfe18b4d34`
- `mi-oakland-parcels__876ba59702b5dddd__query` (883,867 bytes): `fl:document:sha256-876ba59702b5dddd585def0f0102136125bd29b4fb7729b504fd94749eaaba7e`
- `mi-oakland-parcels__28f724bdd3c8affc__query` (882,558 bytes): `fl:document:sha256-28f724bdd3c8affcf5376d689fe2ce94c7449d2dc8f214943c06db9f334f5d95`
- `mi-oakland-parcels__e3304e32fd1abc47__query` (917,003 bytes): `fl:document:sha256-e3304e32fd1abc47ccc8ec443656e4713e40b9fb209695a1fb7560a658aec2c2`
- `mi-oakland-parcels__9a69f90f41955c8c__query` (903,332 bytes): `fl:document:sha256-9a69f90f41955c8c3f32ea582d4da00e645100d550ea3e353ad2f6f38716884e`
- `mi-oakland-parcels__447e8c3c71cfd9c3__query` (872,962 bytes): `fl:document:sha256-447e8c3c71cfd9c332831fdd04a664f044929851d0f264da45bb0f2c62ec87ac`
- `mi-oakland-parcels__b9fa9b0c1dfdefcf__query` (896,443 bytes): `fl:document:sha256-b9fa9b0c1dfdefcfa7d1170cc5f9d70c7b3fc78f46b6f13ac540662bdaa83742`
- `mi-oakland-parcels__dddc696eb974ffce__query` (908,903 bytes): `fl:document:sha256-dddc696eb974ffce66760dbd52f9bdd82c724557646d2c8a5fb4c695fd9ad8ca`
- `mi-oakland-parcels__15001da4f1df84c1__query` (904,658 bytes): `fl:document:sha256-15001da4f1df84c10bbaa83bc2d81a8cf519ed00de21b949c6e861f569f76e6c`
- `mi-oakland-parcels__54230facf144b0b2__query` (58,968 bytes): `fl:document:sha256-54230facf144b0b2191c1be500552ff748bf7c114deedcda3d679d8dea4bdb6e`

Command:

```
PYTHONPATH=python/src python3 -m factlot.registry.adapters.mi_oakland <14 page files in manifest order> registry.db --as-of 2026-11-03 --retrieved-at <manifest checked_at>
```

- Rows read: 26,128 features in 14 pages; four repeated PINs dropped.
- Parcels kept: **26,124** distinct commercial parcels (`B` 0, `F1` 21,459, `F2` 4,665).
- Facts written: 124,858. Seconds: 15.5. Invalid ids, errors, retired: 0, 0, 0.
- Organisation owners stored (current owner-of-record facts): 0; natural persons or withheld owners not stored (names not kept): 0. The owner column is blank in the file.
- Ownership links to registered entities after `link_owners()`: 0 (the only entity registry in the scratch file is `ct-sos-entities`).

## Known gaps

- No owners, so no entity linking for Oakland; no land area (no acreage column), year built, or roll year.
- `ASSESSEDVALUE` is the Michigan assessed value (50 % of true cash value); no market value is published, none is inferred.
- Apartments are F1 (no occupancy field). The Michigan LARA entity register has no bulk file (`mi-sos-entities`), so owners could not link even if present.

## Tier 1 audit (2026-11-06)

The 14 configured pages were collected again. The layer's count query returned 26,126 features with a Michigan class code beginning 2 or 3 (the whole layer was 490,821). Distinct PINs kept: **26,122** (F1 21,455, F2 4,667), four repeated PINs dropped. The 2026-11-03 load above was 26,124 parcels from 26,128 features. `--as-of` for this retrieval is **2026-11-06** (the layer publishes no single roll date; the newest `REVISIONDATE` in the commercial pages is 2026-10-21). Audit violations 0, person-like owner facts 0. Evidence: [mi-oakland-parcels.md](../quality/audit-2026-11-06/mi-oakland-parcels.md) and [mi-oakland-parcels-audit.json](../quality/audit-2026-11-06/mi-oakland-parcels-audit.json). Section 3 of the open-data terms, re-read the same day, is unchanged.
