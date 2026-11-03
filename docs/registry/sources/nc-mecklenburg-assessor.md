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

## Real run (2026-11-03)

The full `Cama_Table.zip` was archived by the collector on its second sequential attempt
(`collected/nc-mecklenburg-assessor/cc46ea8721837914/Cama_Table.zip`, 87,620,621 bytes, document `fl:document:sha256-cc46ea87218379144e4d3082fca6bdb7e871c06f86d8b87166bdaa629f883aff`; the first attempt timed out while twenty
collectors shared the link), together with `OwnerInfo_Table.zip` (`collected/nc-mecklenburg-assessor/bd5e04f936b1af14/OwnerInfo_Table.zip`, 44,333,737 bytes,
document `fl:document:sha256-bd5e04f936b1af147a2055dd7d2f02951ef7cb1492fba8b4ef5f1ce32b030038`) and the land-use code PDF. Command:

```
python -m factlot.registry.adapters.nc_mecklenburg collected/nc-mecklenburg-assessor/cc46ea8721837914/Cama_Table.zip registry.db --as-of 2026-11-02
```

- parcels kept: **23,686**; facts written 257,142; organisation owners
  19,696; natural persons (not stored) 3,990;
  withheld 0 (no marker in the file); invalid 0; 30 s.
- Owner linking: no North Carolina entity source (the SOS file is sold by subscription; see
  `nc-sos-entities.md`). 1,535 owners matched an entity registered in New York,
  Colorado, Pennsylvania or DC by exact name; those are cross-state matches of uncertain value
  (backlog C23).

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
