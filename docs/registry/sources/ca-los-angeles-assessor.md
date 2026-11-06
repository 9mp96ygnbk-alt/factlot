# ca-los-angeles-assessor — Los Angeles County, California (FIPS 06037)

Review record for the Assessor's secured roll as published on the County of Los Angeles Open Data
portal. Config: `registry/sources/ca/ca-los-angeles-assessor.json`. Adapter:
`python/src/factlot/registry/adapters/ca_los_angeles.py` (account system `la_ain`). Tests:
`python/tests/test_adapter_ca_los_angeles.py`. Reviewed 2026-11-02.

## Publisher and URLs

- Publisher: Los Angeles County Office of the Assessor (the item is owned by an
  `@assessor.lacounty.gov` account in the County's ArcGIS Online organisation `RmCCgQtiZLDCtblq`).
- Portal: https://data.lacounty.gov — an **ArcGIS Hub** site. It is no longer Socrata: the Socrata
  catalog API answers `Domain not found: data.lacounty.gov`, so the old `/resource/<id>.csv`
  routes do not exist.
- Dataset page: https://data.lacounty.gov/datasets/lacounty::assessor-parcel-data-roll-2026/about
  (JavaScript-rendered; the machine-readable record is the item JSON
  https://www.arcgis.com/sharing/rest/content/items/0d3ac33a76e1495bb7fc522a8085729c?f=json).
- Service: `https://services.arcgis.com/RmCCgQtiZLDCtblq/arcgis/rest/services/Assessor Parcel Data Roll 2026/FeatureServer`,
  layer 0 `Parcel_Data_2026` (a table, no geometry; capabilities Query, Extract; `maxRecordCount`
  1000; pagination supported). Item created 2026-10-13, modified 2026-10-14 (the `as-of` used).
- Download: the Hub download API
  `https://data.lacounty.gov/api/download/v1/items/0d3ac33a76e1495bb7fc522a8085729c/csv?layers=0`
  answers `302` to a cached export on `services.arcgis.com/.../FeatureServer/replicafilescache/`,
  which answers `302` to a time-limited (about 65 minutes) Azure blob URL on
  `stg-arcgisazurecdataprod.az.arcgis.com`. The unfiltered export is **1,139,573,165 bytes**
  (4,856,866 rows). The API honours a `where` parameter: `where=UseCode LIKE '05%'` gives a
  32,800,230-byte file. The four URLs in `files` use it to fetch only the use-code prefixes in
  scope (05, 1, 2, 3). The first request for a filter that is not yet cached answers **HTTP 200
  with a JSON body** `{"message":"Up to date download file is being generated. Please check back
again later.","status":"Pending",...}` (183 bytes); the collector archives that as a file, so a
  snapshot run must be repeated until every piece is a CSV.
- Companion item: `70d93266f45a4080a97b285a471493cd` "Assessor Parcel Data (Rolls 2021 - 2025)"
  (service `Parcel_Data_2021_Table`) holds prior years in the same layout; not catalogued yet.
- The Assessor's own site (assessor.lacounty.gov) publishes no separate bulk file; its "Property
  Data" links point at this portal. Its robots.txt is absent (404).

## Terms, license, robots

- Terms URL: https://egis-lacounty.hub.arcgis.com/pages/terms-of-use ("Terms of Use & Citation
  Reference Guide" of the County of LA Enterprise GIS Hub). The item's own `licenseInfo` binds
  users to it: "All users of the maps and data presented on https://lacounty.maps.arcgis.com or
  deriving from any LA County REST URLs agree to the 'Terms of Use' outlined on the County of LA
  Enterprise GIS (eGIS) Hub".
- Operative sentence (License section): "Subject to these Terms of Use, you are granted a license
  to copy, publish, distribute and/or transmit the Data, to adapt the Data and to exploit the Data
  for commercial and/or personal use (collectively, 'License')." No ownership passes; the licence
  "will be automatically voided and terminated without notice to you if you violate these Terms of
  Use"; it does not permit "any way that suggests County's endorsement of your use". Data is
  provided "as is" with no warranties; liability capped at $100; the County "reserves the right to
  change, restrict, or discontinue access at any time" (item `licenseInfo`).
- Citation: the Terms recommend "Organization or Author. Year. Title of Dataset: Subtitle
  [dataset]. Name of Archive, Repository or Database. Accessed Month Date, Year. Link." → `County of
Los Angeles, Office of the Assessor. 2026. Assessor Parcel Data Roll 2026 [dataset]. County of
Los Angeles Open Data. Accessed November 2, 2026.
https://data.lacounty.gov/datasets/lacounty::assessor-parcel-data-roll-2026`.
- AI use: not addressed. Redistribution: permitted (copy, publish, distribute, transmit, adapt).
  → `verified: true`.
- robots.txt: `data.lacounty.gov` (and `hub.arcgis.com`, `egis-lacounty.hub.arcgis.com`):
  `User-agent: * / Crawl-delay: 60 / Disallow: /sites/ /admin/ /sessions/ /groups/ /people/
/workspace/`. The download API path is allowed; the collector honours the 60-second delay (four
  files → about four minutes of waiting). `services.arcgis.com/robots.txt` answers 403 (no rules);
  `www.arcgis.com/robots.txt` has no rules.

## What the file contains

One CSV per filtered export (UTF-8 with BOM, CRLF, quoted fields), header row of the publisher's
field **aliases** (the FeatureServer field name in brackets):

| Column (alias)                                                                       | Field                                                | Notes                                                                                                                              |
| ------------------------------------------------------------------------------------ | ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| AIN                                                                                  | `AIN`                                                | 10-digit Assessor Identification Number, the parcel key (`apn`, `account`)                                                         |
| Assessor ID                                                                          | `AssessorID`                                         | dashed AIN `2010-004-040`                                                                                                          |
| Roll Year                                                                            | `RollYear`                                           | `2026` → `tax_year`                                                                                                                |
| Property Use Type                                                                    | `UseType`                                            | `SFR`, `CND`, `R-I`, `C/I`, `OTH`, `VAC`                                                                                           |
| Property Use Code                                                                    | `UseCode`                                            | four characters → `local_use_code`                                                                                                 |
| Use Code 1st–4th Digit                                                               | `UseCodeDescChar1..4`                                | the publisher's description of each character                                                                                      |
| Year Built, Effective Year                                                           | `YearBuilt`, `EffectiveYearBuilt`                    | 0 = none                                                                                                                           |
| Square Footage                                                                       | `SQFTmain`                                           | main building area → `improvement_area_sf` (0 = none)                                                                              |
| Number of Units / Bedrooms / Bathrooms                                               | `Units`, ...                                         | not mapped                                                                                                                         |
| Land Value, Improvement Value, Total Value Land Improvement                          | `Roll_LandValue`, `Roll_ImpValue`, `Roll_totLandImp` | roll (assessed, Prop. 13 base-year) values; the total → `appraised_value`                                                          |
| Total Value, Taxable Value, exemptions                                               | `Roll_TotalValue`, `netTaxableValue`, ...            | total includes fixtures and personal property; not mapped                                                                          |
| Address House Number, ...Fraction, Direction, Street, Unit Number, City, Zip Code    | `SitusHouseNo` ... `SitusZIP5`                       | situs; `City` already carries the state (`LOS ANGELES CA`). Two columns are aliased `Zip Code` (ZIP+4 first, five-digit ZIP later) |
| Property Location                                                                    | `PropertyLocation`                                   | the situs on one line                                                                                                              |
| Parcel Legal Description, Classification, Region Number, Cluster Code, Tax Rate Area |                                                      | not mapped                                                                                                                         |
| Row ID                                                                               | `rowID`                                              | roll year + AIN → `locator`                                                                                                        |
| Location Latitude, " Location Longitude" (leading space)                             | `CENTER_LAT`, `CENTER_LON`                           | not mapped                                                                                                                         |

**Owner names: none.** The public file has no owner-of-record, mailing-address, or
confidentiality column at all (the data dictionary in the item description lists none, and the
service's 51 fields contain none). Every record is ownerless (`owner_name=None`,
`owner_confidential=False`). The Assessor's separate "Secured Parcel Data / Ownership" map service
(`LACounty_Parcel_OwnershipSecure`) is a map service behind a utility proxy, not a bulk file.
There is also **no land area** column.

### Use codes and the mapping

The Assessor's four-character use code is defined character by character; the publisher ships
the definitions inside the dataset (`Use Code 1st Digit` … `4th Digit` columns), which is where the
table below comes from (distinct values queried from the service on 2026-11-02: 1,147 distinct
codes). The Assessor's printed source is its _Real Property Handbook — Property Use
Classification_, which is not posted on assessor.lacounty.gov; only third-party copies were found,
so the in-file definitions are used.

First character (property class), with the 2026 row counts:

| 1st char | Publisher's description                                                                                                                                                                                                                                                                                                                                       | Rows      | FactLot                                 |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | --------------------------------------- |
| 0        | Residential (01 Single Family Residence, 02 Duplex, 03 Three Units, 04 Four Units, **05 Five or More Units or Apartments (Any Combination)**, 07 Manufactured Home, 08 Rooming/Boarding House, 09 Manufactured Home Park)                                                                                                                                     | 2,150,815 | `05xx` → **B**; other 0xxx out of scope |
| 1        | Commercial (10 Commercial, 11 Store, 12 Store Combination, 13 Department Store, 14 Supermarket, 15 Shopping Center (Neighborhood, Community), 16 Shopping Center (Regional), 17 Office Building, 18 Hotel and Motel, 19 Professional Building)                                                                                                                | 69,686    | **F1**                                  |
| 2        | Commercial (21 Restaurant, Cocktail Lounge; 22 Wholesale and Manufacturing Outlet; 23 Bank, Savings and Loan; 24 Non-Auto Service and Repair Shop, Paint Shop, or Laundry; 25 Service Station; 26 Auto, Recreation Equipment, Construction Equipment Sales and Service; 27 Parking Lot (Commercial Use Property); 28 Animal Kennel; 29 Nursery or Greenhouse) | 31,431    | **F1**                                  |
| 3        | Industrial (30 Industrial, 31 Light Manufacturing, 32 Heavy Manufacturing, 33 Warehousing, Distribution, Storage, 34 Food Processing Plant, 35 Motion Picture, Radio and Television Industry, 36 Lumber Yard, 37 Mineral Processing, 38 Parking Lot (Industrial Use Property), 39 Open Storage)                                                               | 52,523    | **F2**                                  |
| 4        | Irrigated Farm                                                                                                                                                                                                                                                                                                                                                | 1,786     | out of scope                            |
| 5        | Dry Farm                                                                                                                                                                                                                                                                                                                                                      | 50,207    | out of scope                            |
| 6        | Recreational                                                                                                                                                                                                                                                                                                                                                  | 2,672     | out of scope                            |
| 7        | Institutional                                                                                                                                                                                                                                                                                                                                                 | 9,746     | out of scope                            |
| 8        | Miscellaneous (80 Privately Owned, 81 Utility, 83 Petroleum and Gas, 84 Pipeline, 85 Rights of Way, 88 Government Owned Property, ...)                                                                                                                                                                                                                        | 34,777    | out of scope                            |
| other    | `(missing)` descriptions: blank, `9`, and letter-led codes (`LA..`, `SC..`, `D1..`)                                                                                                                                                                                                                                                                           | 24,929    | out of scope                            |

The second character of `05xx` is always "Five or More Units or Apartments (Any Combination)"; the
third gives storeys (`050x` 4 Stories or Less, `055x` 5 Stories or More, `05Tx` Wireless
Communication Tower), the fourth amenities or tenure (`1` Pool, `C` Condominium, `G` Mills Act
Property, `V` Vacant Land, ...). 70,925 rows carry `05xx`.

**Vacant land is excluded.** `Property Use Type = VAC` rows carry the use code of their zoning
(`050V`, `100V`, `310V`...; 400 of the `05xx`, 8,729 of the `1xxx`, 335 of the `2xxx`, 11,922 of the
`3xxx` rows). The registry's categories B, F1, F2 are the Texas categories for _improved_ property
(vacant commercial land is Texas C1), so these yield no record. The adapter's
`state_category(use_code, use_type)` implements the mapping.

Half of the dataset's rows are entirely blank: the service holds 4,856,866 rows, of which
2,428,433 have no AIN, no roll year, nothing (every attribute null); the other 2,428,433 are the
2026 roll (SFR 1,510,517; CND 323,258; R-I 248,809; VAC 171,402; C/I 135,125; OTH 39,322). The
adapter skips blank rows.

## Gates

None for the download: no account, login, click-through, CAPTCHA, or fee. The terms are a
browse-wrap licence quoted above (the item's `licenseInfo` says users of the REST URLs "agree" to
it); nobody clicked anything. The Terms of Use say the County
may "change, restrict, or discontinue access at any time", so a periodic re-read is advisable.

### Terms read 2026-11-03

This memo is research, not legal advice.

**Blocked.** https://assessor.lacounty.gov/real-estate-toolkit/data-sales — HTTP 200, Incapsula shell, no product text. The price list needs a person in a browser.

**Order form, Rev 4-25, Revised 4-2025, Effective 12-3-14.** https://res.cloudinary.com/los-angeles-county-assessor/image/upload/v1628093490/Form/Standard_Order_Form.pdf , read 2026-11-03.

> 3. Duplication and Resale of Assessor Property Records: The Assessor property records provided to the Purchaser are for the exclusive
>    use of the Purchaser only. The Purchaser is prohibited from distributing the Assessor property records in the same or similar format and
>    quantity in which the Assessor provided them to the Purchaser. The Purchaser is prohibited from relinquishing possession of the
>    Assessor’s property records received from the Assessor to any other person or persons, or legal entity, nor may the Purchaser, or its
>    agent or employees, rent, lease, sublease, loan, copy, or otherwise distribute the Assessor property records or allow others to use the
>    Assessor property records in the format in which they were provided by the Assessor.

> 6. Payment: Payment of the standard charges, as determined by reference to the Assessor's Property Data Sales Price List

Price is NOT CONFIRMED. The PDF's dollar amounts are a $6 mail postage charge and sales-tax rates (9.75% in Los Angeles County except higher-rate cities, 7.25% elsewhere in California, no tax on email, FTP, or out-of-state). Section 2 and Exhibit A (Cal Gov Code § 6254.21 (2010), as reprinted) restrict posting an official's home address or telephone number after a written demand, including removal within 48 hours. Section 5 requires indemnification for dissemination, publication, or other use. Section 4 says property characteristics are maintained solely for assessment purposes and disclaims warranty, citing Revenue and Taxation Code Section 408.3. The form letterhead names an official. That name is not copied.

**Statute.** Leginfo returned HTTP 403 on 2026-11-03. Quotations are from a capture read 2026-11-02. Gov. Code § 7922.530(a): agencies shall make records promptly available upon payment of direct costs of duplication or a statutory fee. Rev. & Tax. Code § 408.3(a): "property characteristics information maintained by the assessor is a public record and shall be open to public inspection." Neither section addresses commercial use or redistribution. Gov. Code § 7928.205 is NOT CONFIRMED.

The order form, not the statute notes, is what restricts the file: exclusive use, no same-or-similar redistribution, no relinquishing possession. It does not say whether a cited organisation-owner fact, without the file and without a natural-person name, is allowed. The public open-data roll has no owner names (review-record Known gaps). Order address: Los Angeles County Assessor, 500 W. Temple Street, Room 304, Los Angeles, CA 90012, Attn: Accounting Department.

### Platform terms read 2026-11-03

Esri / ArcGIS Hub. No separate public Hub terms page for downloaders was found. Esri's Master Agreement (E204CW, <https://www.esri.com/content/dam/esrisites/en-us/media/legal/ma-translations/english.pdf>) and Product-Specific Terms (E300, <https://www.esri.com/content/dam/esrisites/en-us/media/legal/product-specific-terms-of-use/e300.pdf>) were read 2026-11-03 (HTTP 200, not accepted). Full notes: [`../requests/platform-terms/esri-hub.md`](../requests/platform-terms/esri-hub.md), [`esri-e204.md`](../requests/platform-terms/esri-e204.md), [`esri-e300.md`](../requests/platform-terms/esri-e300.md). E300 footnote 85:

> Software licenses and subscriptions included with ArcGIS Hub may only be used to support the community initiatives enabled by ArcGIS Hub.

Read: E204 and E300 bind Esri's customer (here, the publisher), not an anonymous downloader, and neither restricts redistribution of public records the publisher chooses to publish. The publisher's own terms recorded above still govern. Do not create an Esri account or accept either agreement to download a file.

## Real run (2026-11-03)

All four use-code exports were archived by the collector once it retried truncated downloads
(commit 2a1b900; the Azure blob host had reset every earlier attempt), one piece at a time:

- `05xx (B)`: `collected/ca-los-angeles-assessor/6bcaa509d390b070/csv`, 32,800,230 bytes, document `fl:document:sha256-6bcaa509d390b070f28c7aed87c3bb0717766869e1134314746c0a8ba64e6095`: rows read 70,525, kept 70,525, invalid 0.
- `1xxx (F1)`: `collected/ca-los-angeles-assessor/aa55df9d01ebe19c/csv`, 29,954,800 bytes, document `fl:document:sha256-aa55df9d01ebe19cb25d9c1e8d1358318f214f60e469bc73b083ba56cca5130f`: rows read 60,957, kept 60,957, invalid 0.
- `2xxx (F1)`: `collected/ca-los-angeles-assessor/7112b544c831e2d3/csv`, 14,729,925 bytes, document `fl:document:sha256-7112b544c831e2d3fd4ecec55e36433b43edb22c2ca195d96b69e66dbc03c235`: rows read 31,096, kept 31,096, invalid 0.
- `3xxx (F2)`: `collected/ca-los-angeles-assessor/13aade2696961c91/csv`, 23,441,992 bytes, document `fl:document:sha256-13aade2696961c9119f12c5836a3b4b3ae635cca0e7a614cfb44d286b78c4253`: rows read 40,601, kept 40,601, invalid 0.

Command (the four pieces in one call, each its own snapshot, `full_roll=False`):

```
python -m factlot.registry.adapters.ca_los_angeles collected/ca-los-angeles-assessor/<four pieces>/csv registry.db --as-of 2026-10-14
```

- Parcels kept: **203,179**, exactly the count predicted from the live service's
  `returnCountOnly` queries on 2026-11-02 (B 70,525; F1 92,053; F2 40,601).
- Facts written 1,585,362; organisation owners 0 (the public file carries no owner), so no
  `ownership.*` facts and no entity links.
- The 183-byte "Pending" placeholder archived on 2026-11-02 is superseded: the collector now
  recognises an export API's placeholder and records `not_ready` instead of a document.

## Known gaps

- No owner of record in the public file, so no `ownership.*` facts and no entity links for Los
  Angeles until an owner source is found (the Assessor sells the full secured roll with owner
  names under a data agreement; that is a purchase gate).
- No land area.
- `market_value` is left empty: California's roll values are Proposition 13 factored base-year
  values, not market estimates; they go to `appraised_value`.
- The roll is fetched in four use-code pieces, each its own snapshot and built with
  `full_roll=False`, so parcels that leave the roll are never retired. A full-roll download (1.1 GB)
  would allow retirement; the adapter's `--full` flag supports that file.
- Only one roll year per item; the `Roll Year` column makes the layout year-agnostic, so the 2027
  roll needs only the new item id in the config and `SOURCE.title`.
