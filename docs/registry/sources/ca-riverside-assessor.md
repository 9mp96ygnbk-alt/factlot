# Riverside County Assessor-County Clerk-Recorder (California, FIPS 06065): access review

**Verdict (reviewed 2026-11-02): the full secured roll with owners is a paid product (gated); a free
subset (class, situs, assessed values, no owners) is published on the county Open Data Portal.
`verified: false`: terms are only "Public Use", no download has completed, and the cached export looks
stale. An adapter and tests were written against the published layouts; no real run.** Config:
[`registry/sources/ca/ca-riverside-assessor.json`](../../../registry/sources/ca/ca-riverside-assessor.json).
Adapter: `python/src/factlot/registry/adapters/ca_riverside.py` (account system `riverside_apn`), tests:
`python/tests/test_adapter_ca_riverside.py` (5 pass, synthetic fixture).

## Publisher and URLs

- Paid product: ACR Property Data Center, <https://www.rivcoacr.org/bulk-data-sales>. "$66.00 per file -
  most files." Files: Certified Assessment Roll (annual, July; owners, situs and mailing addresses, legal
  description, values, exemptions), Current Assessment Roll (weekly), Equalized Roll, Extended Roll, Property
  Characteristics, Sales DB, Prop 8, tax bill and unsecured files, Recorder index. Required forms:
  Bulk Data Order Form, Billing Authorization, Data Distribution Agreement, emailed to pds@asrclkrec.com.
  Fields of the roll include `ClassDescription`, `BusinessUseCodeDescription`, `LegalParty1-4`, `Mail*`, `Situs*`,
  `Land`, `Improvements`.
- Free subset: Riverside County Open Data Portal, <https://gisopendata-countyofriverside.opendata.arcgis.com/>
  (the ACR page: "If you do not need owner information, parcel information is available from the County's Open Data
  Portal for free"). Items: CREST General Table `739eb1d35eb64725a8aed3fae1ed9f6f` (REST layer
  `https://gis.countyofriverside.us/arcgis_mapping/rest/services/OpenData/Assessor/MapServer/70`, 1,124,758 rows),
  CREST Tax Year Table `6aa0a76a93b34eef9fbeb4b90a21364b` (layer 100, 1,013,208 rows, all tax year 2027),
  Parcels CREST (layer 50, geometry). Layers 80 (property characteristics) and 90 (recorded book) are served but
  not published as Hub items. The data-distribution page of gis.rivco.org says the Assessor tables are "only
  available in a file geodatabase format due to the size", though the Hub CSV export route works.
- Download route: `.../api/download/v1/items/<id>/csv?layers=<n>` redirects to `hub.arcgis.com/api/v3/datasets/<id>_<n>/downloads/data?format=csv`.

## Terms, license, robots

- Item license text: "Public Use" (custom, no named license). County Data Distribution Disclaimer: maps and data
  are "for reference purposes only", no warranty. Redistribution and AI use not addressed. R&TC 408.3 (as reported
  by a legal-code site) makes assessor property characteristics, including use codes, public records.
- The Data Distribution Agreement for the paid files sits under `rivcoacr.org/media/`, which robots.txt disallows;
  it was not read.
- `rivcoacr.org/robots.txt`: `Crawl-delay: 5`, disallows `/media` and `/portal`, and a long list of named AI
  crawlers (anthropic-ai, ClaudeBot, GPTBot, ...); the FactLot bot is not named. Hub hosts: `Crawl-delay: 60`
  (the collector honours it). `gis.countyofriverside.us` has no robots.txt (404).
- Privacy: ACR cites Gov. Code 6254.21 for withholding owners online.

## What the file contains (layouts confirmed from the REST service and the head of the General CSV)

- CREST_GENERAL: `PIN`, `GEO_CD`, `CLASS_CODE` (actually the class **description**: `Light Industrial`, `Apartment 11 - 20 Units`,
  `Retail - General`, `PP BUSINESS AND EQUIPMENT`; 354 distinct values, no numeric code and no published code table),
  situs parts, `CITY`, `POSTAL_CD`, `BUSINESS_USE_CODE`. CREST_TAXYEAR: `PIN`, `TAX_YEAR`, `LAND`, `STRUCTURES`, exemptions.
  No owners, no areas, no year built.
- Use-code mapping used by the adapter (publisher's class description, unprefixed): six apartment classes (5 units
  up) to `B`; retail, office, restaurant, hotel, service station, automotive, storage, medical, amusement and similar
  improved commercial classes to `F1`; light/heavy industrial, manufacturing, warehouse and recycling to `F2`.
  Vacant land, houses, duplex to fourplex, agricultural, church, school, government, personal property and every
  prefixed class (`PI-`, `CT-`, `AP-`, `MA-`) are out of scope. Counts of the classes from the live service (not a run
  of the adapter): Light Industrial 5,541, Retail - General 4,497, Office - General 2,470, Apartment 5 - 10 Units 2,656,
  Neighborhood Shopping Center 1,176, Full Service Restaurant 1,082, Warehouse/Dry Storage 887. `PI-` is possessory
  interest; the other prefixes are not defined by the publisher (CT- alone covers about 2,000 parcels), which is a known gap.

## Gates (need a person)

1. Paid, owner-bearing files: order forms and a signed Data Distribution Agreement; $66 per file. Not pursued.
2. Founder to decide whether "Public Use" on the open-data items suffices for redistribution, and AI use given the ACR robots.
3. No account, purchase, form or agreement was used.

### Terms read 2026-11-03 (gates pass)

ArcGIS item `739eb1d35eb64725a8aed3fae1ed9f6f`, "CREST General Table", <https://www.arcgis.com/sharing/rest/content/items/739eb1d35eb64725a8aed3fae1ed9f6f?f=json> (read 2026-11-02, NOTES.md): `licenseInfo` is exactly `Public Use`. The capture's description is "New CREST General Table to replace current General table from the Assessor." Redistribution and AI use are not addressed by those two words. A data-distribution disclaimer mentioned in the review record was not re-read in this lane and is NOT CONFIRMED here. The paid-file Data Distribution Agreement was not read.

Mailing address, <https://www.rivcoacr.org/mapbookchanges> (read 2026-11-03):

> Riverside County Assessor
> P.O. Box 751 Riverside,
> CA 92502-0751

Assessor phone on that page: (951) 955-6200. No email is printed there.

Gov. Code § 7922.530(a) (read 2026-11-02, NOTES.md): records "shall make the records promptly available to any person upon payment of fees covering direct costs of duplication, or a statutory fee if applicable." Rev. & Tax. Code § 408.3(a) (read 2026-11-02): "property characteristics information maintained by the assessor is a public record and shall be open to public inspection." Section 408(a) withholds records "not required by law to be kept or prepared by the assessor". Commercial use: silent. Redistribution: silent. Gov. Code § 7921.000 is NOT CONFIRMED. Founder URL, HTTP 403 on 2026-11-03: <https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=GOV&sectionNum=7921.000.>

"Public Use" does not state a redistribution right. The statutes read are an access rule and a fee rule. They do not clear the CREST tables for the open registry. Do not load them, and do not order the paid roll, until the Assessor answers `ca-riverside-assessor-letter.md`.

### Platform terms read 2026-11-03 (gates pass, Task 5)

Esri / ArcGIS Hub. No separate public Hub terms page for downloaders was found. Esri's Master Agreement (E204CW, <https://www.esri.com/content/dam/esrisites/en-us/media/legal/ma-translations/english.pdf>) and Product-Specific Terms (E300, <https://www.esri.com/content/dam/esrisites/en-us/media/legal/product-specific-terms-of-use/e300.pdf>) were read 2026-11-03 (HTTP 200, not accepted). Full notes: [`../requests/platform-terms/esri-hub.md`](../requests/platform-terms/esri-hub.md), [`esri-e204.md`](../requests/platform-terms/esri-e204.md), [`esri-e300.md`](../requests/platform-terms/esri-e300.md). E300 footnote 85:

> Software licenses and subscriptions included with ArcGIS Hub may only be used to support the community initiatives enabled by ArcGIS Hub.

Read: E204 and E300 bind Esri's customer (here, the publisher), not an anonymous downloader, and neither restricts redistribution of public records the publisher chooses to publish. The publisher's own terms recorded above still govern. Do not create an Esri account or accept either agreement to download a file.

## Real run

None. The collector's Hub CSV download of CREST_GENERAL reached about 14 MB, then stalled on a saturated connection and was
stopped. The cached export's `Last-Modified` is 2025-11-18 while the live layer holds tax year 2027, so the export may be a year
stale; paged REST queries (2,000 rows each, subqueries unsupported) are the alternative. No counts, no snapshot id. Run
`python -m factlot.registry.adapters.ca_riverside <general.csv> <taxyear.csv> registry.db --as-of <date>` once both CSVs are archived.

## Known gaps

Owners; land and building area and year built (layer 80 not in the Hub); the prefixed classes; unverified stale-export risk;
one request burst to the Hub host (about 5 requests 3 s apart) ran inside its 60 s crawl delay before the collector took over.
