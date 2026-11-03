# nc-mecklenburg-assessor: Mecklenburg County (Charlotte), North Carolina tax parcel CAMA data

Reviewed 2026-11-02. Status: **verified** (open data with an explicit right to redistribute; see
the caveat under Terms). FIPS 37119. Config:
[`registry/sources/nc/nc-mecklenburg-assessor.json`](../../../registry/sources/nc/nc-mecklenburg-assessor.json);
adapter `python/src/factlot/registry/adapters/nc_mecklenburg.py`; account system `meck_parcel_id`.

## Publisher and URLs

- Publisher: Mecklenburg County Geospatial Information Services (GIS), publishing the County
  Assessor's Office CAMA data. Data center: <https://gis.mecknc.gov/data-center>; Open Mapping
  data page: <https://maps.mecklenburgcountync.gov/openmapping/data.html> (a JavaScript app that
  reads the JSON listing <https://maps.mecklenburgcountync.gov/opendata/data.json>, which the
  collector uses as its landing page).
- Files (bare names in the listing, served from `https://maps.mecklenburgcountync.gov/opendata/`):
  - `Cama_Table.zip` ("Tax Parcel CAMA Data", 87,620,621 bytes, last-modified 2026-11-02): one CSV,
    `Cama_Table.csv`, 372,799,261 bytes uncompressed, one row per parcel and building. The
    listing says it "contains 2025 real estate assessed values, owner, and building information.
    Be aware of multiple buildings per parcel; like apartment complexes."
  - `OwnerInfo_Table.zip` ("Tax Parcel Ownership Data", 44,333,737 bytes): one CSV,
    `OwnerInfo_Table.csv`, 151,898,408 bytes, one row per parcel (owner, mailing address, values,
    last sale, situs). The publisher says to use this one "for deriving property value summaries";
    it has no land-use code, so the adapter reads `Cama_Table` and this file is archived only.
  - `Parcel_LandUseCodes.pdf` (157,464 bytes, 2018): the land-use code table.
- Also published, not used: ArcGIS feature services
  (`https://meckgis.mecklenburgcountync.gov/server/rest/services/TaxParcel_camadata/FeatureServer/0`,
  same columns, `maxRecordCount` 2000), a historical parcel archive on
  `mecksusftp001.blob.core.windows.net`, and the metadata pages
  <https://maps.mecklenburgcountync.gov/metadata/item/tax-parcels-with-cama-data> and
  <https://maps.mecklenburgcountync.gov/metadata/item/tax-parcel-ownership-data>.

## Terms, license, robots

- License: the data-center page states the County's open-data terms: "Open data has four key
  attributes: The data is accessible to everyone. The data is available in open, non-proprietary
  formats. **You have the right to redistribute the data. You have the right to modify and make
  derivative data and works.**" Tax records are public records under N.C. Gen. Stat. ch. 132.
- Caveat for a human read: the same page's liability disclaimer ends "Mecklenburg County does not
  support secondary distribution of this data" (read here as "no support", next to the explicit
  right to redistribute), and the legacy FGDC metadata (2004, still attached to both datasets)
  says "Access Constraints: Requestor must sign a waiver/release form" and "These data cannot be
  resold in their present form" and quotes a $100 fee for a mailed copy, which the free download
  has superseded. The registry does not resell the file; it publishes facts derived from it with
  attribution to Mecklenburg County.
- AI use: `https://maps.mecklenburgcountync.gov/robots.txt` is Cloudflare-managed:
  `User-agent: *` / `Content-Signal: search=yes,ai-train=no,use=reference` / `Allow: /`, then a list
  of named AI training crawlers that are disallowed (the FactLot bot is not among them). The
  publisher reserves rights against AI training; use as reference input is signalled as allowed.
  The registry does not train models on source data.
- robots.txt on `gis.mecknc.gov`: standard Drupal rules, the data-center page is allowed.
- Attribution: Mecklenburg County GIS / Mecklenburg County Assessor's Office.

## What the file contains

`Cama_Table.csv`: UTF-8 with a BOM, header row, 97 columns, CRLF. Key columns:

| Column                                                   | Use                                                                                                                                                                                                          |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `parcelid` (= `gispid`)                                  | parcel key (`06121412`); condominium units have their own `parcelid` and a `commonpid` like `12106C97` for the complex                                                                                       |
| `lusecode`, `landuse_description`                        | the Assessor's land-use code and a description; the description tracks the building use and often disagrees with the code (`C700` "MULTI FAMILY", `R100` "MULTI FAMILY DUPLEX/TRIPLEX"), so the code decides |
| `ownrlstnme`, `ownrfrstnme`                              | owner of record; organisations have the whole name in the last-name column; `UNKNOWN` is a placeholder (no confidentiality flag exists)                                                                      |
| `mailaddr1`, `mailaddr2`, `mailcity`, `state`, `zipcode` | owner mailing address                                                                                                                                                                                        |
| `address`, `loccity`                                     | situs (`2115 SOUTHEND DR, 103 CHARLOTTE NC`; no ZIP except a few stray `-28205` tails; `UNINC` = unincorporated)                                                                                             |
| `legalacres`, `gisacres`                                 | legal acreage (blank for condominium units) and polygon acreage (the whole complex for a condominium unit)                                                                                                   |
| `totalarea`, `finisharea`, `heatedarea`                  | per building row: total and finished area; `heatedarea` is the parcel total of finished area                                                                                                                 |
| `yearbuilt`                                              | per building; `0` when unknown                                                                                                                                                                               |
| `totalvalue`, `totmarkval`, `totlandval`, `totalbldgval` | total assessed value, market value, land, building                                                                                                                                                           |
| `yearid`                                                 | assessment year (2026 on this file)                                                                                                                                                                          |

Mapping: `apn`/`account` = `parcelid`; `land_area_sf` = `legalacres` × 43560, else `gisacres` ×
43560 for non-condominium parcels; `improvement_area_sf` = sum of `totalarea` over the parcel's
building rows, where repeated identical rows (the file sometimes lists one building three or four
times; `heatedarea` tells the cases apart) count once; `year_built` = oldest building;
`market_value` = `totmarkval`; `appraised_value` = `totalvalue`; `tax_year` = `yearid`;
`local_use_code` = `lusecode`.

Land-use code table (`Parcel_LandUseCodes.pdf`, 2018) and the mapping, by code family:

| Family / code                                          | Publisher's definition                                                                                                                                                    | FactLot |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| `A500`–`A563`                                          | MULTI FAMILY (garden, townhouse, duplex/triplex, high rise, water/golf frontage)                                                                                          | `B`     |
| `AF60` (not in the PDF)                                | MULTI FAMILY AFFORDABLE HOUSING                                                                                                                                           | `B`     |
| `C700`–`C783`                                          | COMMERCIAL (stores, restaurants, banks, hotels, parking, commercial condominium; `C782` cell tower and `C783` billboard are newer than the PDF)                           | `F1`    |
| `O400`–`O431`                                          | OFFICE (high rise, medical, office/medical condominium, day care)                                                                                                         | `F1`    |
| `I600`–`I655`                                          | INDUSTRIAL (manufacturing, warehousing, mini warehouse, warehouse condominium, truck terminal, cold storage, stadium/arena)                                               | `F2`    |
| `A501`, `C703`, `C731`, `I603`, `I640`, `O421`, `O425` | COMMON AREA parcels of a complex                                                                                                                                          | out     |
| `R100`–`R384`, `AF01`, `AF04`, `AF09`, `HABT`          | single family, patio home, mobile home, condominium, townhouse, affordable residential                                                                                    | out     |
| `GC01`–`GC04`                                          | GOLF COURSE                                                                                                                                                               | out     |
| `1000`–`9910`                                          | rural/agricultural, institutional (church, school, hospital, nursing home, club), public, utility, right of way, waste, mineral rights, OWNER UNKNOWN, new/deleted parcel | out     |

Codes seen on the sample but not in the PDF: `AF01`, `AF04`, `AF09`, `AF60`, `C782`, `C783`, `HABT`,
`R134`, `9404`, `9410`, `9602`. Unlisted codes follow their family letter.

## Gates (needs a person)

None for access. For a human read before go-live: the "does not support secondary distribution"
sentence and the stale FGDC access constraints quoted above.

## Real run

The host serves about 10–20 KB/s to the collector (3 MB of `Cama_Table.zip` took 313 s), so the
full 87 MB file takes about two hours; per the brief the adapter was run on a **sample**: the
first 3,000,001 bytes of `Cama_Table.zip` (HTTP range request, 2026-11-02), inflated to the first
15,649 complete rows of `Cama_Table.csv` (13,194,730 bytes, document
`fl:document:sha256-762fb0ab363796c1e3db9d041a84cff2664d28efa94a412738ee3207d0558bd6`), into a
scratch registry:

- rows read: 15,649 (15,161 distinct parcels; 195 parcels with more than one building row)
- parcels kept: 983 (`F1` 590, `F2` 268, `B` 125); top codes `C700` 254, `I600` 201, `O424` 200,
  `A500` 99, `I647` 59, `O400` 54, `C735` 34, `A562` 17, `AF60` 9
- with situs 922, with land area 674, with improvement area 768, with year built 769
- facts written: 10,647; owners stored (organisations): 808; owners that were natural persons: 175;
  withheld: 0 (the file has no marker); skipped invalid: 0
- `link_owners()` after loading `nc-sos-entities`: **0 linked, 0 ambiguous, 808 unmatched**,
  because no North Carolina entity data could be loaded (the SOS file is sold by subscription; see
  `nc-sos-entities.md`). Linking across the two sources is exercised only by the synthetic test
  `test_adapter_nc_sos_entities.test_build_links_owners_to_entities`.
- seconds: 0.8 for the sample (the full file is about 28 times larger)

The collector's full `snapshot` run was started on 2026-11-02 (`collected/nc-mecklenburg-assessor/`)
and left running; its manifest records the archived documents when it completes.

## Known gaps

- Land-use codes outside the lettered families (for example `7401` NURSING HOME, `7300` private
  hospital, `R210` MOBILE HOME PARK, `GC0x` golf courses) are out of scope even where Texas districts
  would class them F1; revisit if the registry wants them.
- `heatedarea` is `0` for some industrial parcels with several buildings, so the duplicate-row
  heuristic cannot apply there and every row counts.
- No situs ZIP; condominium units have no land area; no confidentiality marker, so any withheld
  owner (N.C. Gen. Stat. §132-1.7) is indistinguishable from a blank.
- `OwnerInfo_Table.zip` (one row per parcel with `full_owner_name` and the last sale) is archived
  but not read; it could supply sale date and price (`dte_dateofsale`, `amt_price`) later.
