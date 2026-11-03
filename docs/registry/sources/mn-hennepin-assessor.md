# mn-hennepin-assessor: Hennepin County, Minnesota (Minneapolis) parcels

Review record (data policy §5) for source `mn-hennepin-assessor`, FIPS 27053. Reviewed
2026-11-02. Machine-readable copy: [`registry/sources/mn/mn-hennepin-assessor.json`](../../../registry/sources/mn/mn-hennepin-assessor.json).
Adapter: `python/src/factlot/registry/adapters/mn_hennepin.py` (account system `hennepin_pid`).

## Publisher and URLs

- **Publisher:** Hennepin County. The parcel layer is maintained by Hennepin County GIS and the
  Survey Division; its tax attributes come from "a monthly extract of the property tax
  information system" (county assessor and property tax data). Credit requested in the metadata:
  "Hennepin County GIS, Hennepin County Survey Division, Hennepin County Property Tax."
- **Open-data channel:** Hennepin County GIS Open Data, an ArcGIS Hub site:
  <https://gis-hennepin.hub.arcgis.com/datasets/hennepin::county-parcels/about> ("County
  Parcels", ArcGIS Online item `7975aabf6e1e42998a40a4b085ffefdf`, layer 1, owner
  `hennepin.county.maps`, access `public`).
- **Item metadata (JSON):**
  <https://www.arcgis.com/sharing/rest/content/items/7975aabf6e1e42998a40a4b085ffefdf?f=json>
  (`licenseInfo`, `accessInformation`, `url`, `modified`).
- **FGDC metadata (XML, attribute definitions):**
  <https://www.arcgis.com/sharing/rest/content/items/7975aabf6e1e42998a40a4b085ffefdf/info/metadata/metadata.xml>
- **Bulk file (confirmed by download):**
  <https://gis-hennepin.hub.arcgis.com/api/download/v1/items/7975aabf6e1e42998a40a4b085ffefdf/csv?layers=1>
  → HTTP 302 to
  `https://hub.arcgis.com/api/v3/datasets/7975aabf6e1e42998a40a4b085ffefdf_1/downloads/data?format=csv&spatialRefId=26915&where=1%3D1`,
  which answers 200 `text/csv`, `Content-Disposition: attachment; filename="County_Parcels.csv"`,
  `Last-Modified: Thu, 22 Oct 2026 15:51:56 GMT`. The Hub's downloads listing
  (`…/downloads?format=csv`) gives the cached CSV as 56,548,252 bytes (gzip on the wire when the
  client accepts it; served decompressed and chunked otherwise), plus KML, Shapefile and GeoJSON
  exports of the same layer.
- **Live feature service (not used):**
  `https://gis.hennepin.us/arcgis/rest/services/HennepinData/LAND_PROPERTY/MapServer/1`. The
  county's own GIS server forbids robots (below), so the collector never contacts it. The county's
  attribute-table document, `http://gis.hennepin.us/OpenData/Metadata/County%20Tax%20Parcels.pdf`,
  is on the same host and was not fetched.
- **County statement on the data's status:** the property information search page
  (<https://www.hennepin.us/residents/property/property-information-search>, now served from
  hennepincounty.gov) says: "This is public information as mandated by the State of Minnesota
  Data Practices Act."

## Terms, license, robots

- **License / use limitation** (item `licenseInfo`, repeated as `useLimit` in the FGDC metadata):
  "This data (i) is furnished "AS IS" with no representation as to completeness or accuracy; (ii)
  is furnished with no warranty of any kind; and (iii) is not suitable for legal, engineering or
  surveying purposes. Hennepin County shall not be liable for any damage, injury or loss resulting
  from this data." That is a disclaimer, not a restriction: nothing limits copying,
  redistribution or AI use. The data is public government data under the Minnesota Government
  Data Practices Act (Minn. Stat. ch. 13; § 13.03 subd. 1 presumes government data public unless
  a statute classifies it otherwise), and the county says so on its property-search page.
- **Minnesota Data Practices Act, what it withholds from this file.** Property tax and assessment
  records are public, with these exceptions, none of which puts a column in this file:
  - Minn. Stat. § 13.51 subd. 2: _income property assessment data_ that assessors collect from
    owners (detailed income and expense figures, vacancy factors, net rentable areas, lease
    information) are private or nonpublic. The file carries none of it: only estimated and
    taxable market values, which are public.
  - § 13.51 subd. 3: income information gathered to qualify property for class 4d (low income
    rental) is private data on individuals. Not in the file.
  - § 13.045 (Safe at Home address confidentiality, Minn. Stat. ch. 5B): "real property records"
    expressly include "data on assessments, data on real or personal property taxation", and
    under subd. 4a a county that has received a participant's notice "must not disclose the
    program participant's identity data in conjunction with the property identified in the
    written notice in the entity's real property records" (masking or non-public filing is
    allowed). The county applies this before publication; the export has **no flag** that marks a
    masked record, so the adapter cannot set `owner_confidential` from the file and records it as
    `False` throughout (as the Tarrant adapter does).
  - The file does carry owner and taxpayer names (`OWNER_NM`, `TAXPAYER_NM`), as the county
    publishes them. Owner names of natural persons are dropped by the registry core (data policy
    §3); the sample below shows how many.
- **AI use:** not addressed by the publisher. **Redistribution:** not restricted; public data,
  credit requested. Note that the Hub platform (Esri ArcGIS Hub) has its own terms of use for the
  site, which should be read by a person, as for Socrata (backlog A11).
- **robots.txt**
  - `gis-hennepin.hub.arcgis.com` and `hub.arcgis.com` (the download hosts): `User-agent: *`,
    `Crawl-delay: 60`, `Disallow: /sites/ /admin/ /sessions/ /groups/ /people/ /workspace/`. The
    download and dataset paths are allowed; the collector honours the 60-second delay.
  - `www.arcgis.com` (item and metadata JSON/XML): `User-agent: *` with no rules.
  - `gis.hennepin.us` (county GIS server): `User-Agent: *` / `Disallow: /`. Everything on that host
    is off limits to the collector; the Hub export is the county's published route for bulk
    download, so nothing is fetched from gis.hennepin.us.
- **Status:** `verified: true` (terms and robots read and recorded; file confirmed by a real
  download; public data with no restriction on redistribution or AI use). See "Gates" for what a
  person should still look at.

## What the file contains

**Member files:** one, `County_Parcels.csv`: UTF-8 with a byte-order mark, LF line endings,
quoted CSV with a header row, 121 columns, one row per parcel polygon. String fields are padded
with spaces to their column width (`OWNER_NM` 35, `TAXPAYER_NM*` 28, `STREET_NM` 20,
`MUNIC_NM` 16), and `PR_TYP_CD1` sometimes carries a trailing space (`"C "`). The adapter squeezes
whitespace everywhere.

**Key columns** (definitions from the FGDC metadata `attrdef` entries, source "Hennepin County
Resident Services"):

| Column                                                                      | Definition (metadata)                                                                                                             | Adapter use                                                                                                                                           |
| --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PID`                                                                       | "Property identification of property", 13 digits                                                                                  | `apn`, `account` (`hennepin_pid`); a repeated PID collapses to its first row                                                                          |
| `PROPERTY_STATUS_CD`                                                        | "0 = Current, 3 = Non-Current, D = In Process"                                                                                    | only `0` is read                                                                                                                                      |
| `FEATURECODE`                                                               | "Feature subtype code" (501, 502, 503 seen; 503 rows have no tax attributes)                                                      | not used                                                                                                                                              |
| `HOUSE_NO`, `FRAC_HOUSE_NO`, `STREET_NM`, `CONDO_NO`, `MUNIC_NM`, `ZIP_CD`  | situs number (integer, `0` = none), fraction, street, condo unit, municipality, ZIP                                               | `situs_address` = `2901 78TH ST E, BLOOMINGTON MN 55425` (unit as `#A`); `None` without a street name                                                 |
| `MULTI_ADDR_IND`                                                            | "Multiple Address Indicator" (`T` on 5% of rows)                                                                                  | not used; the file carries one address                                                                                                                |
| `OWNER_NM`                                                                  | "Property owner name" (35 characters)                                                                                             | `owner_name`; `UNKNOWN` placeholders dropped                                                                                                          |
| `TAXPAYER_NM`, `TAXPAYER_NM_1..3`                                           | "Taxpayer Name and Mailing Address Line 1..4" (28 characters each)                                                                | `owner_mailing_address` = lines 2–4 joined, only when the taxpayer name equals the owner name on their common width (27 characters); otherwise `None` |
| `PR_TYP_CD1`, `PR_TYP_NM1`                                                  | "Subrecord 1 Property Type" and its description (subrecords 2–4 likewise, each with `LAND_MV`, `BLDG_MV`, `TOTAL_MV`, `HMSTD_CD`) | category from subrecord 1 (the primary use); code kept in `local_use_code`                                                                            |
| `BUILD_YR`                                                                  | "Year Built" (`0000` when unknown)                                                                                                | `year_built`                                                                                                                                          |
| `PARCEL_AREA`                                                               | "Area in Feet" (polygon area, square feet)                                                                                        | `land_area_sf` (rounded to 2 dp); stacked multi-PID parcels (condominium units) share one polygon and so one figure                                   |
| `MKT_VAL_TOT`                                                               | "Total ESTIMATED Market Value"                                                                                                    | `market_value` (0 → `None`)                                                                                                                           |
| `TAXABLE_VAL_TOT`                                                           | "Total TAXABLE Market Value"                                                                                                      | `appraised_value` (0 → `None`)                                                                                                                        |
| `SALE_DATE` (`YYYYMM`), `SALE_PRICE`, `SALE_CODE_NAME`                      | last sale                                                                                                                         | not loaded (no sale predicate in the registry yet); Minnesota sale prices are public, unlike Texas                                                    |
| `NET_IMPRV_AMT`, `TOT_NET_TAX`, `TAX_TOT`, `NET_TAX_PD`, `EARLIEST_DELQ_YR` | tax amounts and delinquency                                                                                                       | not loaded                                                                                                                                            |
| `LAT`, `LON`                                                                | centroid                                                                                                                          | not loaded                                                                                                                                            |

There is **no building-area column** (`improvement_area_sf` stays `None`), **no assessment-year
column** (`tax_year` stays `None`; the extract is monthly and carries the current values), and no
confidentiality flag.

**Use-code table.** The codes and their names come from the file itself (`PR_TYP_CD1`/`PR_TYP_NM1`
pairs in the 2026-10-22 export; the county's own code PDF is on the robots-forbidden host). One
code can carry two names: the "preferred" and "non preferred" names are the two rate tiers of
Minnesota class 3a commercial/industrial, not different uses.

| Code                      | Name in the file                                                                   | FactLot                                        |
| ------------------------- | ---------------------------------------------------------------------------------- | ---------------------------------------------- |
| `A`                       | APARTMENT (class 4a, four or more units)                                           | **B**                                          |
| `C`                       | COMMERCIAL-PREFERRED, COMMERCIAL-NON PREFERRED                                     | **F1**                                         |
| `I`                       | INDUSTRIAL-PREFERRED, INDUSTRIAL-NON PREFERRED                                     | **F2**                                         |
| `R`, `B`, `D`, `RM`, `RZ` | RESIDENTIAL, RESIDENTIAL-ZERO LOT LINE                                             | out of scope                                   |
| `DB`, `TP`                | RESIDENTIAL-TWO UNIT, TRIPLEX                                                      | out of scope (under the multifamily threshold) |
| `X`, `XM`, `Y`, `K`       | CONDOMINIUM, CONDO GARAGE/MISCELLANEOUS, TOWNHOUSE, COMMON AREA                    | out of scope                                   |
| `HL`, `HR`                | LOW INCOME RENTAL (class 4d, a tax class rather than a building type)              | out of scope; see gaps                         |
| `LA`, `LC`, `LI`, `LR`    | VACANT LAND-APARTMENT, LAND-COMMERCIAL, LAND - INDUSTRIAL, VACANT LAND-RESIDENTIAL | out of scope (vacant, as Texas C1)             |
| `NH`                      | MED/CARE FACILITY                                                                  | out of scope; see gaps                         |
| `CR`, `U`, `S`, `FM`      | RAILROAD, UTILITY, SEASONAL-RESIDENTIAL REC, AG NHSTD MULT UNIT                    | out of scope                                   |
| `HT`, `HX`, `HY`          | (no name in the file)                                                              | out of scope                                   |

The list is what the first 5,141 rows show (Minneapolis and Bloomington); the full file will add
codes (exempt, farm, golf course, …), all of which are out of scope unless a person decides
otherwise. The adapter maps by code, so an unlisted code yields no record.

## Gates (anything that needs a person)

- **No login, agreement, CAPTCHA, fee or records request** stands between the collector and the
  file. Nothing was accepted or created.
- **Throughput.** The Hub serves the CSV as a chunked stream; during this run it delivered about
  14 KB/s to the collector (which, like urllib, does not ask for gzip), while a dozen other
  collector runs shared the same link. The full file would have taken hours, so the real run
  below used the first 4 MB as a sample (brief: "if a run would take more than 30 minutes, load a
  sample and say so"). The detached collector run was left going; re-run
  `python -m factlot.collector snapshot --config registry/sources/mn/mn-hennepin-assessor.json --out collected`
  on a quiet link to archive the whole file, then `python -m factlot.registry.adapters.mn_hennepin collected/mn-hennepin-assessor/<sha16>/County_Parcels.csv registry.db --as-of 2026-10-22`.
- **Platform terms.** A person should read the ArcGIS Hub site terms (Esri) once, as for Socrata.
- **The county's robots policy.** gis.hennepin.us forbids all robots while the county publishes
  the same data for download on its Hub. The collector respects the former and uses the latter; a
  person may want to confirm with Hennepin County GIS that automated downloads from the Hub are
  welcome (the metadata lists no contact; the Hub site does).

### Platform terms read 2026-11-03 (gates pass, Task 5)

Esri / ArcGIS Hub. No separate public Hub terms page for downloaders was found. Esri's Master Agreement (E204CW, <https://www.esri.com/content/dam/esrisites/en-us/media/legal/ma-translations/english.pdf>) and Product-Specific Terms (E300, <https://www.esri.com/content/dam/esrisites/en-us/media/legal/product-specific-terms-of-use/e300.pdf>) were read 2026-11-03 (HTTP 200, not accepted). Full notes: [`../requests/platform-terms/esri-hub.md`](../requests/platform-terms/esri-hub.md), [`esri-e204.md`](../requests/platform-terms/esri-e204.md), [`esri-e300.md`](../requests/platform-terms/esri-e300.md). E300 footnote 85:

> Software licenses and subscriptions included with ArcGIS Hub may only be used to support the community initiatives enabled by ArcGIS Hub.

Read: E204 and E300 bind Esri's customer (here, the publisher), not an anonymous downloader, and neither restricts redistribution of public records the publisher chooses to publish. The publisher's own terms recorded above still govern. Do not create an Esri account or accept either agreement to download a file.

## Real run (2026-11-03)

- `discover`: both landing pages `ok`; 0 links found (the Hub page is a JavaScript application and
  the item JSON's `url` points at gis.hennepin.us, which is not an allowed host), so the files
  are listed explicitly.
- `snapshot`: `metadata.xml` archived, 61,952 bytes, document
  `fl:document:sha256-eb750deb74f18889a24277096aa5d3574edce562cf729d45b8b6783eab1bee12`. The
  CSV could not be completed from this connection (truncated at 56 MiB, then a hang-up on every
  `Range` request; `collected/mn-hennepin-assessor/manifest.jsonl`), so it was archived by the
  weekly workflow dispatched for this source (run 41576886878, release
  `data-2026-11-03-41576886878`) and pulled into `collected/` with its manifest record:
  `collected/mn-hennepin-assessor/7877c3f7393f9c55/County_Parcels.csv`, 362,577,002 bytes, document `fl:document:sha256-7877c3f7393f9c557d5311eb8ffa5ecf497f9a08b042e7ae2f996a58e493da1f`.
- **Adapter run on the full file** (`python -m factlot.registry.adapters.mn_hennepin collected/mn-hennepin-assessor/7877c3f7393f9c55/County_Parcels.csv registry.db --as-of 2026-10-22`):

  | Measure                                                 | Count   |
  | ------------------------------------------------------- | ------- |
  | in-scope parcels kept (the adapter tallies these only)  | 19,840  |
  | facts written                                           | 179,630 |
  | organisation owners (`ownership.owner_of_record` facts) | 15,438  |
  | natural-person owners (name not stored)                 | 4,402   |
  | invalid, errors, retired                                | 0, 0, 0 |
  | seconds                                                 | 49      |

- Owner linking: there is no Minnesota entity source (purchase gate). 110 owners link to an entity registered in another state because the owner's mailing address is in that state or the entity was formed in Minnesota; 1,312 had linked by bare name before the jurisdiction rule (C23), and those exact matches in other states now wait in the review queue.
- Unit tests: `python/tests/test_adapter_mn_hennepin.py`, 4 tests, pass with the rest of the
  Python suite.

## Known gaps

- **Class 4d (LOW INCOME RENTAL, `HL`/`HR`)** is excluded: it is a tax classification that
  covers both apartment buildings and single-unit rentals, so it cannot be mapped to B without
  unit counts. A person may decide to include it. Likewise `NH` MED/CARE FACILITY (nursing homes,
  commercial in Texas terms) is left out pending a decision.
- **Mixed use.** Only subrecord 1 decides the category; a residential-primary parcel with a
  commercial subrecord 2 is out of scope, and a commercial-primary parcel's residential subrecord
  is not recorded.
- **Four-unit buildings** are class 4a APARTMENT in Minnesota and are mapped to B; the FactLot
  B definition says "5+ units or the publisher's multifamily class", and this is the latter.
- **Owner mailing address** is the taxpayer's, kept only when the names agree; `OWNER_NM` is cut
  at 35 characters and `TAXPAYER_NM` at 28 by the county, so very long organisation names are
  truncated in the registry too.
- **No building area, no assessment year, no exemption flags** in this file. The land area is
  the GIS polygon area, shared by stacked parcels.
- **Sales** (`SALE_DATE`, `SALE_PRICE`, `SALE_CODE_NAME`) are public in Minnesota and present in
  the file but not loaded: the registry has no sale predicate yet.
- **Safe at Home** masking cannot be detected, so `owner_confidential` is always `False`.
