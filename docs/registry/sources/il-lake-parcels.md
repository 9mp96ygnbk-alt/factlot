# il-lake-parcels: Lake County, Illinois (FIPS 17097) tax parcels and Data Extract

Review date: 2026-11-03. Verdict: **gated: host blocks automated clients (the Data Extract page) and the reachable layer has no class or value; `verified: false`; no adapter.**
Config: [`registry/sources/il/il-lake-parcels.json`](../../../registry/sources/il/il-lake-parcels.json).

## Publisher and URLs

- Lake County, Illinois GIS Division (`gis@lakecountyil.gov`) and the Supervisor of Assessments. Pages: <https://www.lakecountyil.gov/gis>, <https://www.lakecountyil.gov/3942/Data-Extract> (the assessment "Data Extract").
- Open-data hub <https://data-lakecountyil.opendata.arcgis.com/> (robots `Crawl-delay: 60`); ArcGIS Online item `318e616ff0d14efe83927d8dd3bc1e12` "Tax Parcels", service
  `https://services3.arcgis.com/HESxeTbDliKKvec2/arcgis/rest/services/OpenData_ParcelPolygons/FeatureServer/0` ("LakeCountyParcels", 279,079 parcels, `maxRecordCount` 2000).

## Terms, license, robots

- **Blocked.** `www.lakecountyil.gov` answered the collector (including `/robots.txt`, `/GIS` and `/3942/Data-Extract`) with HTTP 403 and a Cloudflare "Just a moment..." JavaScript challenge. The block was not worked around.
- The hub item says the parcel boundaries "are intended to be a visual inventory of property for tax and other administrative purposes; they are not intended to be used in place of an on-site survey". The item's `licenseInfo` is that text only: no licence, redistribution or AI terms.
- From search-index text (unverified): the Data Extract provides "parcel characteristics and tax information for all properties", including `land_use_code`, and since 2019 six townships (Cuba, Ela, Grant, Libertyville, Shields, Vernon) no longer report detailed characteristics to the county.

## What the file contains

The reachable layer: `PIN`, `legdesc1-3`, `situs_addr_line_1_First`…`situs_addr_zip_legdat_First`, `taxpayer_name`, `taxpayer_addr_line_1`…`taxpayer_addr_country` (owner of record's tax-bill name: present). It has **no property class, land use or value**, so no
parcel can be scoped to B, F1 or F2 from it. The Data Extract (class and tax data) could not be read.

## Gates

1. Cloudflare challenge on `www.lakecountyil.gov`. A person must open the Data Extract page in a browser, record its file URL(s), layout, class-code table and terms, and ask the GIS Division whether `FactLotRegistryBot` can be allowed through the challenge.
2. Confirm the licence for the parcel layer and the extract.

## Real run

None (field list and a count only). No adapter.

## Known gaps

The extract's layout and class codes; whether it joins to the parcel layer by `PIN`; licence. Illinois entity data: `il-sos-entities` (Tier 1, blocked).
