# District of Columbia: Office of Tax and Revenue real property (`dc-otr-real-property`)

Reviewed 2026-11-02. FIPS 11001. Account system `dc_ssl`. Adapter `factlot.registry.adapters.dc_otr`.
Config `registry/sources/dc/dc-otr-real-property.json`. **verified: true**, see Terms below.

## Publisher and URLs

Open Data DC (an ArcGIS Hub run by the DC Office of the Chief Technology Officer) republishes the
Office of Tax and Revenue's assessment data daily.

| Dataset                                       | Item id                            | Rows (2026-11-02) | Hub CSV export (confirmed, redirects to `hub.arcgis.com`)                                      |
| --------------------------------------------- | ---------------------------------- | ----------------- | ---------------------------------------------------------------------------------------------- |
| Integrated Tax System Public Extract (ITSPE)  | `7d5e6cabd2304e779c719a4d5515af77` | 221,688           | `https://opendata.dc.gov/api/download/v1/items/7d5e6cabd2304e779c719a4d5515af77/csv?layers=0`  |
| Computer Assisted Mass Appraisal - Commercial | `7d1f1b1b1e2d47c4a672cce5c918b9ff` | 21,154            | `https://opendata.dc.gov/api/download/v1/items/7d1f1b1b1e2d47c4a672cce5c918b9ff/csv?layers=23` |
| Integrated Tax System Property Use Codes      | `9d8e09cb7403445ca8b4354cac6ae776` | 109               | `https://opendata.dc.gov/api/download/v1/items/9d8e09cb7403445ca8b4354cac6ae776/csv?layers=54` |

Dataset pages: `https://opendata.dc.gov/datasets/DCGIS::integrated-tax-system-public-extract`,
`…/DCGIS::computer-assisted-mass-appraisal-commercial`, `…/DCGIS::integrated-tax-system-property-use-codes`.
Metadata API (the collector's landing pages): `https://opendata.dc.gov/api/v3/datasets/<item id>_<layer>`.
Feature services: ITSPE `https://services.arcgis.com/neT9SoYxizqTHZPH/arcgis/rest/services/ITSPE_08172026/FeatureServer/0`
(the service name carries the extract date); CAMA and the use-code table on
`https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Property_and_Land_WebMercator/FeatureServer/23` and `/54`.
Also published but not used: ITSPE Facts, ITSPE Vacant Property, CAMA Residential, CAMA Condominium, the ITS Data Dictionary (`/66`).

## Terms, license, robots

- **License, per dataset (metadata `license` and `structuredLicense`, 2026-11-02):** CC-BY-4.0.
  The dataset page says: "This work is licensed under a Creative Commons Attribution 4.0 International License."
  Attribution: District of Columbia Office of Tax and Revenue, Open Data DC.
- **District data policy (Mayor's Order 2017-115, §X, on Open Data DC's "Data Policy" page):** the
  statement to accompany each open dataset is "This data are classified by the District of Columbia
  as Level 0, Open. This data are placed in the public domain. The data should be treated as if
  covered by a Creative Commons CC0 Universal License. There are no restrictions on copying,
  publishing, distributing, or using the data for a non-commercial or commercial purpose.
  Attribution and notification to the District is not required, but is requested." The same order
  prohibits click-through agreements, and the data is provided "as is" without warranty.
- **dc.gov Terms and Conditions of Use** (`https://dc.gov/page/terms-and-conditions-use`): "The data
  located on DC Open Data has its own terms and conditions." (site content is CC-BY-3.0.)
- **Open Data DC terms page** `https://opendata.dc.gov/pages/terms-and-conditions` is rendered by
  JavaScript; the collector sees no text. A person should read it in a browser (founder item).
- **AI use:** not addressed; CC-BY-4.0 and the CC0 statement permit any use with attribution.
- **robots.txt** `opendata.dc.gov`: `User-agent: *`, `Crawl-delay: 60`, disallows `/sites/`, `/admin/`,
  `/sessions/`, `/groups/`, `/people/`, `/workspace/` (the API and download paths are allowed). The
  collector honours the 60 s delay, so each request to opendata.dc.gov waits a minute.
  `maps2.dcgis.dc.gov`: no robots.txt (404). `hub.arcgis.com` serves the redirected downloads.

## What the file contains

**ITSPE** (the tax assessment roll): one CSV row per SSL, about 230 columns, UTF-8 with BOM.
Key columns (descriptions from the publisher's ITS Data Dictionary, layer 66):

| Column                              | Meaning                                                                                                 | Adapter use                                                |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `SSL`                               | Square, suffix, lot: `0123    0045`, `0123E   0045`; also `PIPAR…` possessory-interest and federal lots | parcel key (`apn`, `account` in `dc_ssl`)                  |
| `USECODE`                           | three-digit property use code                                                                           | mapped to B/F1/F2; kept in `local_use_code`                |
| `PREMISEADD`, `UNITNUMBER`          | property address without city/ZIP (a few rows carry them); condo unit                                   | situs: `… , WASHINGTON DC`, unit appended when not present |
| `OWNERNAME`, `OWNNAME2`             | owner of record (no confidentiality marker in the file)                                                 | `owner_name` (first name only)                             |
| `ADDRESS1`, `ADDRESS2`, `CITYSTZIP` | tax billing address                                                                                     | `owner_mailing_address`                                    |
| `LANDAREA`                          | square feet of land per surveyor                                                                        | `land_area_sf` (0 → none)                                  |
| `ASSESSMENT`                        | current assessed value total (land + building)                                                          | `market_value`                                             |
| `NEWTOTAL` (`NEWLAND`, `NEWIMPR`)   | proposed total for the coming tax year                                                                  | `appraised_value` (0 → none)                               |
| `CY1YEAR`                           | current billing tax year                                                                                | `tax_year`                                                 |
| `DELCODE`                           | `Y` = dead SSL                                                                                          | row skipped                                                |
| `EXTRACTDAT`                        | date of the extract (`2026/09/04 00:00:00+00` on 2026-11-02)                                            | use as `--as-of`                                           |

**CAMA Commercial**: one row per building and section on an SSL: `AYB` (year built), `EYB`,
`LIVING_GBA` (gross building area, sf), `NUM_UNITS`, `USECODE` (numeric, `21`), `LANDAREA`,
`SALEDATE`, `PRICE`. The adapter joins it by SSL (whitespace removed): `improvement_area_sf` = sum
of positive `LIVING_GBA`, `year_built` = earliest positive `AYB`.

**Use-code mapping** (from the Property Use Codes table; the parenthesised class in each long
description is the District's historical property class: 2 multifamily, 3 transient, 4 commercial):

| FactLot | OTR use codes                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| B       | 002 multifamily (NC), 021 apartment walk-up (6+ units), 022 apartment elevator (12+), 025 conversion 5 units, 026/027/028 cooperatives, 029 multifamily misc, 126/127 co-op mixed use                                                                                                                                                                                                                                                                              |
| F1      | 004/005/006/008 (NC) retail, office, specific and special purpose; 031–033 hotels/motel; 034 club; 035 tourist home; 036 dormitory; 037 inn; 039; 041–049 stores and retail condo; 051–053, 056–059 offices and office condos; 061–069 banks, garages, parking, service stations, theaters, restaurants; 081–089 religious, medical, educational, public service, embassy, museum, recreational, health care, misc; 165/265/365/465 service stations; 189 memorial |
| F2      | 007 industrial (NC), 071–076 raw material, heavy, light, warehouses, truck terminal, 078 warehouse condo, 079 industrial misc                                                                                                                                                                                                                                                                                                                                      |
| out     | 000, 001, 011–019 single-family and residential condos, 023/024 flats and conversions under 5 units, 038 fraternity house, 091–097 and 191–197 vacant, 116/117, 214 multifamily garage, 216/217, 316, 416/417, 516, 995 condo main                                                                                                                                                                                                                                 |

## Gates

None for the download: no account, login, click-through (the data policy forbids them), fee, or
CAPTCHA. The Hub CSV export streams slowly (about 20 KB/s on 2026-11-02, with the machine's link
shared by other collectors; one 10-minute stall produced a read timeout), so the full 220 MB ITSPE
needs an unattended run. The feature services page at 1,000 (ITSPE) and 2,000 (CAMA) rows per
request as an alternative.

## Real run (2026-11-02)

The collector's `discover` ran for all three landing pages (one transient
"Remote end closed connection" on the first request, the other two `ok`; no links, because the
metadata JSON carries the feature-service URL, not the export URL). The collector's `snapshot` was
started twice and did not complete the ITSPE export within the session (see Gates); no file was
archived under `collected/dc-otr-real-property/`.

Counts below are from a **sample loaded through the official feature services** (same columns,
same rows as the export) with the collector's user agent and a 2 s interval: the ITSPE rows whose
`USECODE` is in scope, and the full CAMA Commercial layer. The sample files are in the scratchpad
(`itspe_commercial_scope.csv`, 4,569,278 bytes; `cama_commercial.csv`, 21,154 rows), not in the repo.

- ITSPE in-scope rows read: 18,302; 225 dead SSLs (`DELCODE` Y) skipped; **18,077 parcels kept:
  F1 9,622, B 8,054, F2 401**; 192,204 facts; 11,607 organisation owners of record (6,470 names were
  natural persons, not stored); 5.3 s. Most common codes: 025 (3,995), 021 (2,533), 042 (1,689),
  022 (865), 052 (806), 041 (764), 081 (679), 064 (650).
- CAMA join: 12,517 parcels got a gross building area and 12,583 a year built.
- Sample snapshot document id: `fl:document:sha256-a0f0a99f14ad36c8dfe663522529affef0d41b05fe8f1e88dd4b25396334978d`
  (the sample CSV, not the Hub export; the export's id is recorded by the collector when it completes).

## Known gaps

- The ITSPE has no situs ZIP (some rows embed city and ZIP in `PREMISEADD`); situs is street plus
  `WASHINGTON DC`.
- No withheld-owner marker exists in the file; `owner_confidential` is always false.
- `tax_year` is the current billing year (`CY1YEAR`), not an assessment year; `appraised_value`
  is the proposed next-year total, which is 0 (dropped) for many parcels until proposed values are
  published each spring.
- Special-purpose codes 081–089 (churches, schools, embassies, museums) are the publisher's
  commercial class and are kept as F1, although many are tax-exempt.
- Mixed-use parcels (`MIXEDUSE` Y) are classed by their predominant use code only.
- The collector archives the export under the name from `Content-Disposition` (`ITSPE.csv`).
