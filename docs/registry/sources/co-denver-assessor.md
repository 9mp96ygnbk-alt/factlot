# co-denver-assessor: City and County of Denver, Colorado (FIPS 08031)

Review record for the FactLot Registry (data policy §5). Reviewed 2026-11-02. Machine-readable copy:
[`registry/sources/co/co-denver-assessor.json`](../../../registry/sources/co/co-denver-assessor.json).
Adapter: `python/src/factlot/registry/adapters/co_denver.py` (account system `denver_schednum`);
tests: `python/tests/test_adapter_co_denver.py`.

## Publisher and URLs

- Publisher: City and County of Denver, Assessor's Office, through the Denver Open Data Catalog.
  The catalog is an ArcGIS Hub, <https://opendata-geospatialdenver.hub.arcgis.com/> ("geospatialDENVER");
  the old addresses `denvergov.org/opendata` and `data.denvergov.org` redirect there (301).
- Datasets (ArcGIS Online items owned by `The_City_and_County_of_Denver`, both tagged `ODC`):
  - "Real Property Apartment and Commercial Characteristics", item `b41d9d86334b44538bb8c7d83c7c2728`,
    feature service `ODC_real_property_apartment_and_commercial_characteristics`, layer 49:
    <https://opendata-geospatialdenver.hub.arcgis.com/datasets/geospatialDenver::real-property-apartment-and-commercial-characteristics>.
    28,213 rows at review (`returnCountOnly` on the layer); data last edited 2026-10-29.
  - "Real Property Residential Characteristics", item `db01da756e144b7490139d553a747bc6`, feature
    service `ODC_real_property_residential_characteristics`, layer 50:
    <https://opendata-geospatialdenver.hub.arcgis.com/datasets/geospatialDenver::real-property-residential-characteristics>.
    212,870 rows; data last edited 2026-10-29.
  - "Real Property Sales and Transfers" (item `55040dd1…`, layer 51) exists as well; not used.
- Bulk files (the hub's download API, listed in the hub's DCAT feed
  <https://opendata-geospatialdenver.hub.arcgis.com/api/feed/dcat-us/1.1.json>, which the collector reads as
  the landing page):
  - <https://opendata-geospatialdenver.hub.arcgis.com/api/download/v1/items/b41d9d86334b44538bb8c7d83c7c2728/csv?layers=49>
  - <https://opendata-geospatialdenver.hub.arcgis.com/api/download/v1/items/db01da756e144b7490139d553a747bc6/csv?layers=50>

  Each answers `302` to `services1.arcgis.com/…/FeatureServer/replicafilescache/<name>.csv`, which
  answers `302` to a time-limited Azure blob URL that serves the CSV (about 11 MB for the
  commercial file). A download request for an export the hub has not generated recently can be
  slow or drop the connection on the first try; a second request gets the cached file.

## Terms, license, robots

- Open-data license: the City's GIS page
  (<https://www.denvergov.org/Government/Agencies-Departments-Offices/Agencies-Departments-Offices-Directory/Technology-Services/Functions/GIS>)
  says of the Open Data Catalog: "You are free to copy, distribute, transmit and adapt the data in
  this catalog under an open license, the Creative Commons Attribution 3.0 license (CC BY 3.0)."
  CC BY 3.0 permits redistribution and commercial use with attribution and does not restrict AI use.
- Dataset metadata (`licenseInfo` on both items, also the DCAT `license` field): "USE CONSTRAINTS —
  The City and County of Denver is not responsible and shall not be liable to any user or recipient
  for damages of any kind arising out of the use of data or information provided by the City and
  County of Denver … ANY DATA OR INFORMATION PROVIDED BY THE City and County of Denver IS PROVIDED AS
  IS WITHOUT WARRANTY OF ANY KIND … the user agrees to indemnify and hold harmless the City and
  County of Denver … from any liability arising out of the use, reproduction or dissemination of
  the data/information provided. NOT FOR ENGINEERING PURPOSES." A disclaimer, not a restriction.
- The City's general website Terms of Use (<https://www.denvergov.org/Terms-of-Use>) say the City
  "retains copyright on all text, graphic images and other content" and that "Commercial use of the
  materials is prohibited without the written permission of the City." Those terms cover the website's
  content; the GIS page's CC BY 3.0 statement is the specific statement for the catalog data, and
  assessment records are public records under the Colorado Open Records Act (C.R.S. 24-72-201 et
  seq.). A person should confirm this reading before publication (see Gates).
- robots.txt:
  - `opendata-geospatialdenver.hub.arcgis.com`: `User-agent: *`, `Crawl-delay: 60`, disallows
    `/sites/`, `/admin/`, `/sessions/`, `/groups/`, `/people/`, `/workspace/`. The DCAT feed and the
    download API are allowed. The collector honours the 60 s crawl delay, so each request to the
    hub waits a minute.
  - `services1.arcgis.com` (the redirect target): no robots.txt (HTTP 400 "Invalid URL").
  - `www.arcgis.com` (item metadata): `User-agent: *` with no rules.
  - `www.denvergov.org`: a long list of disallowed site paths, none of them the GIS or open-data pages.

## What the file contains

Both exports are quoted CSV, UTF-8 with a byte-order mark, header row, one row per parcel
(`PARID` is unique: 28,213 rows and 28,213 distinct `PARID` in the commercial file). The columns are
the feature-service fields:

- Keys: `OBJECTID`, `PARID` (the 13-digit Denver schedule number, e.g. `0003100025000`; the parcel
  key and the `denver_schednum` crosswalk), `CD` / `OFCARD` (card number and number of cards; the
  export carries card 1 only).
- Owner of record: `OWNER`, `CO_OWNER`; mailing address `OWNER_NUM`, `OWNER_DIR`, `OWNER_ST`,
  `OWNER_TYPE`, `OWNER_APT`, `OWNER_CITY`, `OWNER_STATE`, `OWNER_ZIP`. Owner names are included for
  every parcel (persons and organisations); the registry keeps organisations only.
- Situs: `SITE_NBR`, `SITE_DIR`, `SITE_NAME`, `SITE_MODE` (street type), `SITE_MORE` (unit). There is
  no situs city or ZIP column; the adapter writes `…, DENVER CO`.
- Class: `PROP_CLASS_LAND` and `PROP_CLASS_IMPS`, the Colorado Division of Property Taxation
  four-digit abstract subclass codes of the land and of the improvements; `PROPERTY_CLASS_DESC`
  (commercial file) / `PROP_CLASS` (residential file), the description of the land code;
  `D_CLASS_CN`, Denver's own class name ("COMMERCIAL-HOTEL", "RESIDENTIAL-MULTI UNIT APTS",
  "OTHER COMMERCIAL P.I."); `ZONE10` zoning; `TAX_DIST`.
- Size and age (commercial file): `GROSS_AREA`, `NET_AREA`, `BSMT_AREA`, `FBSMT_SQFT`, `NO_FLOORS`,
  `TOTL_SQFT`, `ORIG_YOC` (year of construction), `REMODEL`, `TOT_UNITS`, `BLD_NAME`. Apartment rows
  usually have `NET_AREA` and no `GROSS_AREA`; `NET_AREA` is unreliable on some hotel rows
  (14,772,992 sf for a 4-storey hotel), so the adapter takes `GROSS_AREA` first and `NET_AREA`
  only when there is no gross area. `TOTL_SQFT` is larger than either (a sum over floors or cards)
  and is not used. The commercial file has no land area column.
- Size and age (residential file): `LAND_SQFT`, `AREA_ABG` (above-grade area), `BSMT_AREA`,
  `GRD_AREA`, `STORY`, `CCYRBLT` (year built), `UNITS`, bedrooms and baths.
- Values: `ASMT_APPR_LAND`, `ASMT_APPR_IMPR`, `TOTAL_VALUE` (actual value, stored as
  `market_value`), `TOT_ASMT_RED` (statutory reduction), `APPR_*_LOC` (values for local levies after
  the reduction; `APPR_TOT_LOC` stored as `appraised_value`), `ASSESS_VALUE` / `ASSESS_VALUE_LOC`
  (assessed value = actual value × assessment rate), `*_SCH` (the same for school levies),
  `ASMT_TAXABLE*`, `ASMT_EXEMPT_AMT*`. No assessment-year column.
- `NBHD_*` neighbourhood, `LEGL_DESCRIPTION`.

### Use-code table

Colorado assessors classify with the Division of Property Taxation's four-digit abstract subclass
codes (Assessors' Reference Library vol. 2, chapters 6 and 7; `arl.colorado.gov` refuses automated
clients with a CloudFront 403, so the definitions below are the publisher's own descriptions from the
`PROPERTY_CLASS_DESC` / `PROP_CLASS` columns, tallied with a group-by query on the layers on
2026-11-02). Land codes are `11xx` residential, `21xx` commercial, `31xx` industrial; improvement
codes are the same with `12xx` / `22xx` / `32xx`; `20xx` are possessory interests (private, taxable
use of exempt land; `D_CLASS_CN` says "… P.I."); `0100`–`0550` vacant land; `4xxx` agricultural;
`8991`–`8992` state-assessed; `9xxx` exempt. The improvement code decides the category; the land
code stands in when a parcel has no improvement code. Both are kept in `local_use_code` as
`<improvements>/<land>`.

| Improvements              | Land                           | Publisher's description                                                                                                                                             | Rows (commercial file)      | FactLot      |
| ------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- | ------------ |
| 1220                      | 1120                           | MULTI-UNITS (4-8)                                                                                                                                                   | 1,117 (+2)                  | B            |
| 1225                      | 1125                           | MULTI-UNITS (9+)                                                                                                                                                    | 1,733 (+38 land only, +4)   | B            |
| 2212                      | 2112                           | MERCHANDISING                                                                                                                                                       | 1,703 (+9 land only, +14)   | F1           |
| 2215                      | 2115                           | LODGING                                                                                                                                                             | 119 (+1)                    | F1           |
| 2220                      | 2120                           | OFFICES                                                                                                                                                             | 1,495 (+2 land only, +21)   | F1           |
| 2225                      | 2125                           | RECREATION                                                                                                                                                          | 186 (+21 land only, +6)     | F1           |
| 2230                      | 2130                           | SPECIAL PURPOSE                                                                                                                                                     | 2,463 (+236 land only, +23) | F1           |
| 2235                      | 2135                           | WAREHOUSE (Denver: "INDUSTRIAL-WAREHOUSE")                                                                                                                          | 2,214 (+1 land only, +11)   | F1           |
| 2245                      | 2145                           | COMMERCIAL CONDOMINIUMS                                                                                                                                             | 1,538 (+122)                | F1           |
| 2020 / 2021 / 2022 / 2023 | —                              | OTHER COMMERCIAL P.I. / ENTERTAINMENT P.I. / RECREATION P.I. (possessory interests; no land code, no description)                                                   | 203 / 7 / 5 / 38            | F1           |
| 3215                      | 3115                           | MANUFACTURING                                                                                                                                                       | 147 (+9)                    | F2           |
| 1212                      | 1112                           | SINGLE FAMILY RESIDENCE                                                                                                                                             | 47 (+1 land only, +11)      | out of scope |
| 1215                      | 1115                           | DUPLEXES-TRIPLEXES                                                                                                                                                  | 3,009 (+6 land only, +3)    | out of scope |
| 1230                      | 1130                           | CONDOMINIUMS                                                                                                                                                        | 2 (+1 land only, +1)        | out of scope |
| 1250 / 2250               | 1150 / 2150                    | RESIDENTIAL / COMMERCIAL PARTIAL EXMP (Exempt Portion)                                                                                                              | 25 / 84 (+4 land only)      | out of scope |
| —                         | 100, 101 / 200 / 300 / 510–550 | RESIDENTIAL / COMMERCIAL / INDUSTRIAL VACANT LAND, MISC LAND … ACRE                                                                                                 | 849 / 945 / 194 / 139       | out of scope |
| 4020                      | 4127                           | agricultural P.I. / DRY FARM LAND                                                                                                                                   | 6 / 36                      | out of scope |
| 8991, 8992                | 8991                           | STATE ASSESSED PERSONAL PROPERTY                                                                                                                                    | 582                         | out of scope |
| 9119–9299                 | 9119–9289                      | FEDERAL / STATE / COUNTY / POLITICAL SUBDIVISION / RELIGIOUS / PRIVATE SCHOOLS / CHARITABLE / DHA / ALL OTHERS, residential or commercial, exempt or partial exempt | 8,700                       | out of scope |

Warehouses are a commercial class (`22xx`) in Colorado's scheme, so they map to F1; only the
manufacturing class `3215` is industrial (F2). Denver's multi-unit classes start at four units, so
B includes four-unit buildings (574 of the 1,117 `1220` rows have `TOT_UNITS` = 4).

The residential file is almost entirely out of scope: 164,096 single-family (1212/1112), 42,631
condominium (1230/1130), 3,029 `1230` with no land code, and a handful of multi-unit, exempt and
commercial-condominium rows (one `1220`, one `2245`).

### Owner placeholders and withheld owners

The adapter treats `UNKNOWN`, `UNKNOWN OWNER`, `OWNER UNKNOWN`, `CURRENT OWNER` and `NOT AVAILABLE`
as placeholders (no owner) and an `OWNER` beginning with `CONFIDENTIAL`, `WITHHELD`, `PROTECTED` or
`REDACTED` as a withheld owner (`owner_confidential=True`, C.R.S. 24-72-204(3.5) lets protected
persons ask for their address to be withheld). See the real run for what the file actually holds.

## Gates

None for the download: no account, login, click-through, fee or CAPTCHA. For a person:

1. Confirm the reading of the terms: the GIS page's CC BY 3.0 statement for the catalog versus the
   City website's general Terms of Use ("Commercial use of the materials is prohibited without the
   written permission of the City"), and that the hub datasets' "USE CONSTRAINTS" disclaimer is all
   that applies to them. The hub itself shows no terms page.
2. Read the Assessors' Reference Library (vol. 2, ch. 6 "Property Classification Guidelines and
   Assessment Percentages" and ch. 7 "Abstract, Certification, and Tax Warrant") to confirm the
   subclass code definitions; `arl.colorado.gov` and the Legislative Council's PDF archive reset
   or refuse automated connections.

## Real run (2026-11-03)

Both exports were archived in full by the collector: commercial `collected/co-denver-assessor/b26caab122d3410d/csv` (11,288,056 bytes,
document `fl:document:sha256-b26caab122d3410df0fdb730fcf5d2b3dddf2f13f7f857143c259682135ba358`) and residential `collected/co-denver-assessor/1e10868d82885336/csv` (84,771,835 bytes, document `fl:document:sha256-1e10868d8288533611aa02908bfa91bd6167b206def99c04e4c1b6f8cc69f096`). Commands:

```
python -m factlot.registry.adapters.co_denver collected/co-denver-assessor/b26caab122d3410d/csv registry.db --as-of 2026-10-29
python -m factlot.registry.adapters.co_denver collected/co-denver-assessor/1e10868d82885336/csv registry.db --as-of 2026-10-29 --partial
```

- Commercial export: rows read 28,213; kept 13,528; out of scope 14,685;
  invalid 0; facts written 125,453; organisation owners 11,107;
  natural persons or placeholders 2,421; 3 s.
- Residential export: rows read 212,870; kept 11 (apartment classes in the residential file);
  facts written 90; 3 s.
- Registry total: **13,539 Denver parcels; 11,115 organisation owners; 9,449
  (85%) linked to Colorado SOS entities** (full file) by exact normalized name.

## Known gaps

- No assessment year in the export (`tax_year` is left empty; the snapshot's as-of date is the
  layer's data-last-edit date). No situs city or ZIP (all parcels are in Denver). No land area in
  the commercial file.
- `CO_OWNER` (a second owner) is not read; the owner of record is `OWNER` only. Owner names are
  truncated to 40 characters in the export ("BURLINGTON NORTHERN RR CO PROPERTY TAX D",
  "STATE OF COLORADO DEPARTMENT OF TRANSPOR"), which defeats exact-name entity linking for long
  names.
- Possessory interests (`2020`–`2023`) are taxable private interests in exempt land, kept as F1
  with the interest holder as the owner of record; they are not fee ownership.
- Only card 1 of multi-card parcels is in the export, so a parcel's improvement area and year are
  those of its first building.
- The residential export costs a download of about 70 MB (with a one-minute crawl delay) for a
  handful of in-scope parcels; it is kept in the source for completeness.
