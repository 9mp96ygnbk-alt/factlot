# Denton County, Texas: DCAD roll as published by Denton County GIS (`tx-denton-cad`)

Review record for data policy §5. Reviewed 2026-11-03. **Verified**, with one caveat for a person
(see Gates): the layer is public, anonymous and has no stated terms; DCAD's own "Data Extracts"
page could not be read. County FIPS 48121; account system `dcad_prop_id` (DCAD's integer property
id). Config `registry/sources/tx/tx-denton-cad.json`; adapter
`python/src/factlot/registry/adapters/tx_denton.py`; tests `python/tests/test_adapter_tx_denton.py`.

## Publisher and URLs

- Publisher: Denton Central Appraisal District; the data is served by Denton County GIS.
- Layer: <https://gis.dentoncounty.gov/arcgis/rest/services/Parcels_FC/MapServer/0> (ArcGIS Server
  11.5, Query capability, anonymous, `maxRecordCount` 2,000, 72 attributes plus geometry,
  384,308 parcels on 2026-11-03). The county's GIS Hub lists it as the item "Parcels" ("Parcel data
  for Denton County, provided by Denton Central Appraisal District (DCAD)", tag Open Data, access
  public, owner `DentonCountyGIS`).
- Files (confirmed by the collector's `snapshot`, manifest `collected/tx-denton-cad/manifest.jsonl`): seven
  query pages, `.../Parcels_FC/MapServer/0/query?where=stateCodes like '%B%' OR stateCodes like '%F%'
&outFields=<24 attributes>&returnGeometry=false&orderByFields=OBJECTID&resultOffset=<0..12000>
&resultRecordCount=2000&f=json`, 1.12–1.31 MB each, 8,925,795 bytes in all. Documents (offset
  order): `fl:document:sha256-889b5c652a0033583839d7226875872de44d48ff12d537e16fb74458d2455235`,
  `…ac76d1ea9dd0024d55515a11bbd01b56a7b48cebb2e277f41becec68619588ec`,
  `…999764effd26afcdedae6e60f7499167a4c3973277b0a1d7f8e147b675e84b5c`,
  `…3021872ed5e04dc3f8f8198c3333140348a0679ae5ae546c1a29d5322cecbcda`,
  `…2c5f5ca0d193e64aed0cd2b13faa5d0415abea7101931c5c8353ef9449eb18a6`,
  `…513eb3bb2a4ef5240101daa9de7f6d713695710b2ec13c40833eac9275d46e65`,
  `…1e9392f818acf7526d9b6a134efe417b840dfc5c68bb75fa006488301927f48c`.
  The `where` clause matched 13,732 of the 384,308 parcels (count query, 2026-11-03).
- Other routes seen: the service `CAD/MapServer/0` carries older attribute names for the same
  roll (not used); the district's own **Data Extracts** page (`dentoncad.com/?p=2815` in a search
  index: a weekly file geodatabase, a standalone appraisal table as CSV and DBF, a "DCAD data
  schema" document, extract sets for 2021–2024) could not be retrieved: `dentoncad.com` does not
  resolve any more and `www.dentoncad.com` serves the True Prodigy "Public Portal", a
  client-rendered single-page app that returns an empty shell without JavaScript.

## Terms, license, robots

- Terms: none stated on the layer or its Hub item (`licenseInfo` empty, `accessInformation`
  empty, license `none`). Public record under Tex. Gov't Code ch. 552.
- License: public record; no open-data license stated.
- AI use: not addressed. Redistribution: not addressed; public record.
- robots.txt: `gis.dentoncounty.gov/robots.txt` answers 404 (no rules). The Hub host
  (`data-dentoncounty.hub.arcgis.com`) has `Crawl-delay: 60` and disallows `/sites/`, `/admin/`
  and the like; it was read once for the item record and is not a landing page of the config.
- From a search snippet of the Data Extracts page (not read): DCAD "cannot offer technical support"
  for the extracts and the GIS extracts are "for informational purposes", not for legal,
  engineering or surveying use. Neither is a redistribution term.

## What the layer contains

One feature per parcel polygon; an account with several polygons repeats (13,732 rows for 13,446
distinct `pid` in the pages; the adapter keeps the first row of each, which differs from its
twins only in situs). `propType` is `R` on every row requested. Attributes the adapter reads:

| Attribute                                                     | Meaning (from the layer's names and sample rows)                                   | Use                                                             |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `pid`                                                         | DCAD property id                                                                   | parcel key (`apn`, `account`)                                   |
| `stateCodes`                                                  | comma-separated state codes of the account's improvements and land (`F1`, `A1,F1`) | category; the whole string is `local_use_code`                  |
| `name`, `confidential`                                        | owner of record; 1 = Tax Code §25.025 election                                     | owner; confidential rows keep no name or situs and set the flag |
| `situs_street_address`, `situsCity`, `situsState`, `situsZip` | situs                                                                              | `"<street>, <city> <state> <zip>"`                              |
| `addrDeliveryLine`, `addrUnitDesignator`, `addrFreeForm3`     | mailing address (`CITY, ST ZIP` in the last)                                       | mailing address, lines joined with commas                       |
| `landTotalSqft` (`land_sqft`, `legalAcreage`)                 | land area                                                                          | square feet, else `land_sqft`, else acres × 43,560              |
| `imprvMainArea` (`imprvTotalArea` not used)                   | main area of all buildings (total also counts porches, pavement)                   | `improvement_area_sf`                                           |
| `imprvActualYearBuilt`                                        | actual year built                                                                  | `year_built`                                                    |
| `ownerMarketValue`, `ownerAppraisedValue`, `pYear`            | the owner's market and appraised values; the appraisal year of the record (2027)   | `market_value`, `appraised_value`, `tax_year`                   |

### State code mapping

DCAD's code table is in its "DCAD data schema" document, which was not read. Mapped: `F1` → F1,
`F2` → F2, `B`+digits (`B1` multifamily, `B2` duplex in the sample; `B3`/`B4` follow the Comptroller
numbering) → B. A multi-code account takes F2, then F1, then B, so an `A1,F1` account (a house with
a commercial improvement: 120 in the sample) is F1. The 2026-11-03 distribution of the requested
pages (rows, by `stateCodes`): `F1` 8,766, `B2` 2,621, `B1` 1,409, `A1,F1` 127, `F3` 86, `D1,F1` 73,
`A4,B1` 65, `C2,F1` 64, `E4,F1` 62, `F2` 58, `B1,F1` 53, `C2,F010` 27, `F4` 10, and a long tail of
combinations (all codes: 265 distinct `stateCodes` strings in the layer).

## Gates

- **Terms.** Nothing blocks the download. A person should find DCAD's current Data Extracts page
  (on the district's own site, not the portal) and, if it states a licence or terms, record them
  here and in the config; the layer is a county republication of DCAD data and DCAD's terms
  govern.
- The layer is also the only route found that works for an automated client: the portal at
  `www.dentoncad.com` is client-rendered.

## Real run

Collector `snapshot` on 2026-11-03 (7 files, 8,925,795 bytes, about 53 s at 2 s per request), then
`tx_denton.build` on the archived pages into a scratch registry (4 s):

- Rows read: 13,732 (13,446 distinct accounts); **parcels kept: 13,304**: F1 9,088, B 4,143
  (B1 1,401 and B2 2,610 as the largest sub-codes), F2 73. Out of scope: 142 accounts whose codes
  match the `where` clause but map to no B/F1/F2: `F3` (86 accounts, plus `D1,F3` and similar),
  `F4` (10), `F010` (29 as `C2,F010` and `C1,F010`).
- Facts written: 150,785. Snapshots: 7 (one per page).
- Owner names present: 13,296 (13,141 parcels have a situs; 12,572 an improvement area; 12,956 a
  year built; 13,156 a market value). Confidential owners: 8 (all in scope; name and situs
  withheld). Owners that are organisations (stored as owner of record): **9,498**; persons and
  withheld owners not stored: 3,806. Owner linking to the Comptroller entity file was not run on
  the scratch registry.

## Known gaps

- `F3`, `F4`, `F010` accounts (about 140) are out of scope until DCAD's code table is read; the
  Collin and Travis tables treat `F3` and `F4` as commercial (F1), so Denton's likely do too.
- A mixed `A1,F1` account is reported as F1 although much of the value may be residential.
- No pagination guard: if the matching count passes 14,000 the config needs an eighth page.
- A page set is not a complete roll, so the adapter retires nothing; parcels that leave scope
  stay current until a full-roll pass is added.
- The layer holds values by owner (`ownerPct` is not requested); a divided interest shows only
  the first row's owner.
- DCAD's weekly file geodatabase (with building details by improvement) is the official bulk
  route and is not read.
