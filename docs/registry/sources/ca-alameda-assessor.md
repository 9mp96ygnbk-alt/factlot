# ca-alameda-assessor — Alameda County, California (FIPS 06001)

Review record for the Assessor's secured roll. **Result: a free roll table exists on the county's Open
Data Hub, but it states no licence, so `verified: false`. The adapter is written and tested on a synthetic
fixture only; no roll file was downloaded.** Config: `registry/sources/ca/ca-alameda-assessor.json`.
Adapter: `python/src/factlot/registry/adapters/ca_alameda.py` (account system `alameda_apn`). Tests:
`python/tests/test_adapter_ca_alameda.py`. Reviewed 2026-11-02.

## Publisher and URLs

- Publisher: Alameda County Assessor (1221 Oak St., Oakland; 510-272-3787). Assessor pages:
  https://www.acgov.org/assessor/ (the old `/assessor/resources/records.htm` and `fee-schedule.htm`
  redirect to the new Assessor site).
- County Open Data Hub: https://data.acgov.org (ArcGIS Hub, not Socrata).
- **The free roll tables.** Seven hosted tables, one per roll year, all owned by the county's ArcGIS
  account `AlamedaCounty.CA.US`, access `public`, but **unlisted** (`listed: false`, so they do not appear
  in the Hub catalogue; they are found through the Hub search API
  `https://data.acgov.org/api/search/v1/collections/all/items?q=Assessor%20Secured%20Tax%20Roll`):

  | Roll        | Item id                            | Created / modified  | Size                         |
  | ----------- | ---------------------------------- | ------------------- | ---------------------------- |
  | 2019-20     | `292255e1f9834b9d86b39faac8bf1795` | 2022-08-12          | 162 MB (463,890 records)     |
  | 2020-21     | `f6dfb9cad05a46efb7b1c6fac37674ef` | 2022-08-13          | n/a                          |
  | 2021-22     | `646dfa01434f454c8256af52fd16f2bf` | 2022-08-13          | n/a                          |
  | 2022-23     | `a38b1879440f4429972790558eb0a3ea` | modified 2025-10-22 | n/a                          |
  | 2023-24     | `70f10876998a4452b5e75608b4908c20` | modified 2024-10-03 | n/a                          |
  | 2024-25     | `07e250812fe34713a6a5b4d87066c5dd` | modified 2024-10-03 | n/a                          |
  | **2025-26** | `54cc3c88fa384b28b5c456df0868fc67` | created 2025-07-07  | 177 MB (**472,690 records**) |

  The latest, 2025-26: service
  `https://services5.arcgis.com/ROBnTHSNjoZ2Wm1P/arcgis/rest/services/Assessor_Office_Secured_Tax_Roll_2025_to_2026/FeatureServer/0`
  (a table, `maxRecordCount` 2000, capability Query, format JSON). Whether Hub CSV export is enabled for
  these items was not tested (a download would be a roll download; see Gates).

- Related, free, not a roll: "Parcels" boundary layer on the Hub (about 489,651 features, updated 2026-10),
  which does not contain assessor attributes (APN, book and page fields only; per a search-engine summary).
- The Assessor's paid products: https://www.acgov.org/forms/assessor/feeschedule.pdf (effective
  2016-01-01).

## Terms, license, robots

- **Licence: none stated.** The items' metadata have `license: "none"`, `licenseInfo: ""`,
  `description: ""`, `accessInformation: ""`. The Hub's geospatial page
  (https://www.acgov.org/government/geospatial.htm) carries a general disclaimer ("makes no warranty,
  representation or guarantee as to the content, accuracy, timeliness or completeness of its
  information") and, per a search-engine summary of the Hub's Parcels dataset page (not opened directly: the Hub is JavaScript-rendered), "No License Provided" with a note to request permission to use it; it grants no licence.
- The Assessor sells the same information: fee schedule (2016): "Compact Disc Entire Assessment Roll
  (Secured & Unsecured) $20.00", "Assessment Roll Monthly Updates per month $20.00", "Entire Property
  Characteristic File $20,000.00", "Property Characteristic & 12 Monthly Updates $22,000.00", "Deleted
  Parcel Number List $20.00". The Assessor's records page says the "entire assessment roll" and "bulk
  data" may be purchased and lists owner name, parcel number and property address among the public
  roll fields; it says ownership information is available free of charge in person during business
  hours and is not posted online.
- Use-code page disclaimer (https://propinfo.acgov.org/UseCodeList): the codes are "designed for use by
  this department for the purpose of appraising properties for assessment purposes only"; the Assessor
  "does NOT recommend other agencies ... use these Use Codes for any other purpose"; quotes Revenue and
  Taxation Code §408.3(d) (no liability for errors in property characteristics information).
- AI use, redistribution: **not addressed**. Because no licence is attached and the Assessor treats the
  roll as a product, the rule is `verified: false`.
- robots.txt: `data.acgov.org`: `User-agent: * / Crawl-delay: 60 / Disallow: /sites/ /admin/ /sessions/
/groups/ /people/ /workspace/` (the collector honours the 60-second delay). `www.acgov.org`: a short
  list of form and error pages, none relevant. `propinfo.acgov.org`: no robots.txt (404).

## What the file contains

One row per parcel, 38 fields including `OBJECTID` (the 2025-26 table adds `Attention_Name`; the 2019-20 table has 37):

| Field                                                                                                | Meaning / use                                                                               |
| ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `Sort_Parcel`                                                                                        | zero-padded parcel key, `001 011100100` → `apn` (`001011100100`)                            |
| `Print_Parcel`                                                                                       | printed APN, `1-111-1` → `account` (crosswalk `alameda_apn`)                                |
| `TRA_Primary`, `TRA_Secondary`                                                                       | tax rate areas; not mapped                                                                  |
| `Situs_Street_Number`, `Situs_Street_Name`, `Situs_Unit`, `Situs_City`, `Situs_Zip`, `Situs_Zip___4` | situs → `229 BRUSH ST, OAKLAND, CA 94607`                                                   |
| `Land`, `Imps`                                                                                       | assessed land and improvements → `appraised_value` (sum); Proposition 13 values, not market |
| `CLCA_Land`, `CLCA_Imps`                                                                             | Williamson Act values; ignored                                                              |
| `Fixtures`, `BPP`, `HPP`, `HOEX`, `OTEX`, `Total_Net_Value`                                          | fixtures, business and household personal property, exemptions, net total; ignored          |
| `Latest_Document_*`                                                                                  | latest recorded document prefix, series and dates; not mapped                               |
| `Attention_Name`, `Mailing_Address_*`                                                                | owner **mailing** address only; no owner name anywhere in the table. Not stored.            |
| `Use_Code`                                                                                           | four-digit Assessor use code → category and `local_use_code`                                |
| `Source`, `Econ_Unit`, `WSEQ`, `CKDIGIT`, `Delete_Date`                                              | internal; `Delete_Date` non-blank rows are dropped                                          |

No year column (the roll year is in the table name; the adapter takes `--tax-year`), no building area, lot
area or year built.

**Use-code table** (from the Assessor's Property Search "Use Codes" page, copied 2026-11-02; the series
headings are the publisher's). Codes mapped by the adapter:

- **B**, multiple residential of 5 or more units (7x series): `7100` Five or more single family res homes;
  `7200` Residential property converted to 5 or more units; `7400` Cooperatives (divided); `7430`
  Cooperatives (undivided); `7500` Restricted residential income property; `7700` Multiple residential
  building of 5 or more units; `7701` Assisted Living Apartments; `7705`, `7706` Multi-Res 5+ units +
  commercial units; `7800` Residential high-rise (7 or more stories).
- **F1**, commercial: `3100` single-tenant retail; `3120` commercial imps on residential land; `3200`
  store/office with apts/lofts; `3300` miscellaneous improved commercial; `3400` department store; `3500`
  national chain retailer; `3600` restaurant (small or in-line); `3605` free-standing; `3610` fast food;
  `3620` bar; `3700`-`3705` shopping centres; `3800` supermarket; `3900` condominium-commercial retail;
  `6300` golf course; `6850` historical commercial; `8000` car wash; `8100` repair garage; `8200` auto
  dealership; `8300` parking lot; `8400` parking garage; `8500` service stations; `8600` funeral home;
  `8700` nursing/custodial care; `8800` hospital; `8801` medical clinic; `8802` skilled nursing; `8900`
  hotel; `8901` SRO hotel; `9000` motel; `9100` mobile home park parcel with improvements; `9200` bank;
  `9300` medical-dental building; `9301` veterinarian; `9400` one to five story office; `9401`
  condominium-office; `9405` condominium-medical office; `9500` over five story office; `9600` bowling
  alley; `9700` walk-in theater; `9800` drive-in theater; `9801`, `9802` winery; `9900` other
  recreational; `9905` fitness centre.
- **F2**, industrial (4x series, improved): `4100` warehouse; `4101` condominium-industrial; `4102`
  self-storage; `4103` cold storage; `4200` light industrial/manufacturing; `4201` flex/R&D; `4202` data
  center; `4205` advanced tech manufacturing; `4300` heavy industrial; `4400` misc. industrial; `4800`
  terminals, trucking, distribution; `4900` wrecking yards.
- **Out of scope**: all `0x`-`2x` and `1x` residential, mobile-home, tract and exempt codes; vacant land
  (`3000`, `4000`, `7000`, `7040`, `5xxx`, `6000`); condominium residential units (`73xx`); common-area
  parcels (`xx90`, `7390`...); `3990`, `4191`, `9491` condominium common areas; `4240`; nurseries,
  quarries, landfill, salt ponds (`4500`-`4700`); institutional (`6001`-`6800` except `6300`, `6850`:
  government, secured PI, school, cemetery, church, other institutional, lodge); fraternities `7600`;
  church home `7900`; `9910` museums; `9901`, `9902`, `9999`. A code not in the table yields no record.

## Gates (need a person)

1. **Licence and intent.** Ask the Assessor (510-272-3787) or the county IT department whether the
   unlisted hosted tables are intended as open data and may be copied, stored and redistributed, and
   whether the paid-product fee schedule applies to bulk reuse. Get the answer in writing. Until then
   leave `verified: false`.
2. Whether California Revenue and Taxation Code §408 and §408.3 (disclosure of assessor records and
   property characteristics) affect redistribution has not been researched.
3. Export route: once cleared, add the file URL to `files` (an ArcGIS Hub CSV export, or paged
   `FeatureServer/0/query` requests of 2,000 rows, about 237 for the 2025-26 table; the collector
   archives one file per URL, so the paged route needs a merge step or an adapter reading several files).

### Terms read 2026-11-03

ArcGIS item `54cc3c88fa384b28b5c456df0868fc67`, "Assessor_Office_Secured_Tax_Roll_2025_to_2026", <https://www.arcgis.com/sharing/rest/content/items/54cc3c88fa384b28b5c456df0868fc67?f=json> (read 2026-11-02): `licenseInfo` is an empty string, `accessInformation` is an empty string, `description` is an empty string, `access` is "public", `listed` is false. No terms are attached to the item. AI use and redistribution are not addressed there.

Fee schedule, <https://www.acgov.org/forms/assessor/feeschedule.pdf> (read 2026-11-03): effective January 1, 2016. Letterhead: "1221 Oak St., Room 145, County Administration Building", "Oakland, California 94612-4288", "(510) 272-3787". Price line: "Entire Assessment Roll (Secured & Unsecured)" at $20.00, and "Entire Property Characteristic File" at $20,000.00. The schedule does not mention the hosted table and does not grant redistribution.

Blocked on 2026-11-03: <https://www.acassessor.org/about-us/visit-or-contact-us/> (HTTP 403) and <https://www.acgov.org/assessor/>, which ended at <https://assessorprd.wpengine.com/> (HTTP 403). The contact page needs a person in a browser to confirm the room number.

Gov. Code § 7922.530(a) (read 2026-11-02; <https://leginfo.legislature.ca.gov>): the agency "shall make the records promptly available to any person upon payment of fees covering direct costs of duplication, or a statutory fee if applicable." Rev. & Tax. Code § 408.3(a) (read 2026-11-02): "property characteristics information maintained by the assessor is a public record and shall be open to public inspection." Section 408(a) (read 2026-11-02) withholds records "not required by law to be kept or prepared by the assessor". Commercial use: silent. Redistribution: silent. Gov. Code § 7921.000 was not read: <https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=GOV&sectionNum=7921.000.> returned HTTP 403, Cloudflare "Just a moment..." on 2026-11-03. The section is NOT CONFIRMED.

An empty licence does not grant redistribution, and the office publishes a price for the entire assessment roll. The statutes read create an access right and a possible fee. They do not authorize republication. The source stays unverified until the Assessor confirms in writing that the table may be redistributed.

### Platform terms read 2026-11-03

Esri / ArcGIS Hub. No separate public Hub terms page for downloaders was found. Esri's Master Agreement (E204CW, <https://www.esri.com/content/dam/esrisites/en-us/media/legal/ma-translations/english.pdf>) and Product-Specific Terms (E300, <https://www.esri.com/content/dam/esrisites/en-us/media/legal/product-specific-terms-of-use/e300.pdf>) were read 2026-11-03 (HTTP 200, not accepted). Full notes: [`../requests/platform-terms/esri-hub.md`](../requests/platform-terms/esri-hub.md), [`esri-e204.md`](../requests/platform-terms/esri-e204.md), [`esri-e300.md`](../requests/platform-terms/esri-e300.md). E300 footnote 85:

> Software licenses and subscriptions included with ArcGIS Hub may only be used to support the community initiatives enabled by ArcGIS Hub.

Read: E204 and E300 bind Esri's customer (here, the publisher), not an anonymous downloader, and neither restricts redistribution of public records the publisher chooses to publish. The publisher's own terms recorded above still govern. Do not create an Esri account or accept either agreement to download a file.

## Real run

None, by design. The collector's `discover` ran against the item record (status `ok`, 0 file links). The
only data touched were the field list, the record count (472,690) and three sample rows read from the
county's public REST endpoint to confirm the layout. The tests use invented parcels. The adapter has
never seen a full roll, so category counts, duplicate keys and blank-field behaviour on real data are
unknown.

## Known gaps

- No owner name in the table, so no organisation owner facts can come from it (the full roll sold by the
  Assessor includes owner names; the fee schedule lists "Written Response for Ownership" at $8 per parcel).
- No building area, lot area or year built (the paid Property Characteristic File has them).
- The roll year is not in the data; the adapter needs `--tax-year`.
- Assessed values are Proposition 13 values; `market_value` stays empty.
- The use-code list is the Assessor's appraisal list and may change; check it each roll year.
