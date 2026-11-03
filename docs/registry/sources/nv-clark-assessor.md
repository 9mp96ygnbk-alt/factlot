# nv-clark-assessor: Clark County, Nevada Assessor secured roll

**Status: not verified, blocked by a purchase/subscription gate.** No data file was downloaded,
no adapter was written, and no counts exist. Reviewed 2026-11-02.

## Publisher and URLs

- Publisher: Clark County Assessor's Office, 500 S. Grand Central Pkwy, Las Vegas, NV. FIPS 32003.
- Data files page (landing page, HTTP 200):
  https://www.clarkcountynv.gov/government/assessor/datafiles.php
  (the server rewrites it to `/government/assessor/datafiles`).
- County GIS (GISMO) "Assessor's Parcel Data" for purchase:
  https://www.clarkcountynv.gov/government/departments/geographic_info_systems/services/data-for-purchase
- County GIS free downloads (no parcel layer):
  https://www.clarkcountynv.gov/government/departments/geographic_info_systems/services/free-gis-data1
- Public layout and code documents (PDF, free, on the data files page):
  - AOExtract description: `.../original/as/aoextract-description.pdf`
  - AOExtract record layout: `.../original/as/aoextract-record-layout.pdf`
  - AOExtract sample: `.../original/as/aoextract-sample.pdf`
  - Assessor land use codes: `.../original/as/assessor-land-use-codes.pdf`
  - Fee schedule (effective 2024-07-01): `.../original/as/fee-schedule-rev-07-01-24.pdf`
  - Request for data (letter requirements): `.../original/as/request-for-data.pdf`
  - Data notice: `.../original/as/data-notice.pdf`
    (full URLs are `https://www.clarkcountynv.gov/adobe/assets/urn:aaid:aem:<uuid>/original/as/<name>`;
    the `discovered.json` run did not list them because the collector's default link pattern keeps
    only data-file extensions, not PDFs.)
- Collector config: `registry/sources/nv/nv-clark-assessor.json` (`verified: false`, `files: []`).

No county open-data portal was found: `opendata.clarkcountynv.gov`, `gisgeo.clarkcountynv.gov` do
not resolve; `opendata-clarkcountynv.opendata.arcgis.com` and `data-clarkcountynv.opendata.arcgis.com`
answer "Site does not exist".

## Terms, license, robots

- **Access rule (data files page):** "Information from the Clark County Assessor's Office
  computerized records is available for purchase in the following formats: secured tax roll;
  unsecured tax roll; residential extraction and commercial extraction." and "Customers interested
  in obtaining this information will need to submit a signed letter requesting one time access
  during a calendar month or an ongoing subscription to access the Clark County Assessor Data Site."
- **Fee schedule:** "Monthly Subscription of Assessor Data Files $300.00 per month". Fees "may be
  waived upon request and approval" only for students/faculty and government agencies "providing the
  data requested will used for non-commercial purposes only".
- **Request letter** (request-for-data.pdf) must state the nature of the business, the data
  requested, "The purpose of the request" and "How the data is going to be used to accomplish the
  purpose".
- **Data notice** (data-notice.pdf): the records are public under NRS 239.010 ("maintains databases
  of public books and records which are open to inspection and duplication by the public"). It is
  not a license: it requires cost reimbursement, no warranty, and that any confidential data
  inadvertently revealed "shall not reveal the same to any person nor utilize said information in
  any manner". It does not address redistribution of the public data or AI use.
- **AOExtract description:** "NOTE: This information is for assessment use only. No liability is
  assumed as to the accuracy of the data delineated hereon."
- **GIS product (GISMO):** "$50 per section (every 4th section free)", "$2,500 for the entire
  county", or "the annual fee of $7,500" for weekly updates; requires the signed GIS Data Subscriber
  License Agreement, "a memo authored on company letter head, and signed by a licensed user, stating
  that the Company/Agency understands that the data may not be resold", and a W-9. The licence
  (maps.clarkcountynv.gov/Gismo/pdf/subscriber-agreement.PDF) permits use "in it's business
  activity and for no other purpose whatsoever" and §2.2(a): "User shall not allow access to the
  Product by any other person or organization by networks, timesharing, or multiple CPU arrangements
  or any other means, unless authorized in writing by GISMO." That forbids publishing the GIS product
  in an open registry.
- **Free GIS downloads page:** "The MAPS and DATA are provided WITHOUT WARRANTY of any kind,
  EXPRESSED OR IMPLIED." No parcel/assessor layer is listed (tax code districts, planning land use,
  zoning, contours, centerlines, election, census, etc.).
- **robots.txt:** `www.clarkcountynv.gov`: `User-agent: *` / `Allow: /` (plus a sitemap).
  `mapsrv.clarkcountynv.gov`: no robots.txt (HTTP 404, HTML body). `files.clarkcountynv.gov`
  (old file host still indexed by search engines) resets TCP connections.
- **License summary for the registry:** public record, sold by subscription, no open license, AI use
  not addressed, redistribution not addressed for the Assessor data files and forbidden for the GIS
  product. `verified: false` until the founder obtains the file and its written conditions.

## What the file contains (from the published layout; not seen)

The Secured Tax Roll master file "AOExtract" (also called AOCCROLL in the City of Las Vegas
republication) is a 69-column table, one row per parcel, "updated daily by the County Assessor's
Office"; the data site's files are replaced each weekend. The sample PDF shows a delimited text
export with the 11-digit parcel number prefixed by an apostrophe (`'16322415002`) and `NULL` for
empty fields. Columns (aoextract-record-layout.pdf):

| Column(s)                                                                                         | Meaning                                                                                                                                                                                                                                                       | Registry field                                                                                 |
| ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `PARCEL` char(25)                                                                                 | Assessor's parcel number, 11 digits: book(3) section(2) page(1) subdivision(2) parcel(3)                                                                                                                                                                      | `apn`, `account` (account system `clark_apn`)                                                  |
| `TAXDIST`                                                                                         | taxing district code                                                                                                                                                                                                                                          | not used                                                                                       |
| `ETALFLAG` Y/N                                                                                    | more than two owners (rest in the AOEtal file)                                                                                                                                                                                                                | note only                                                                                      |
| `OWNER`, `OWNER2`                                                                                 | owner lines 1–2                                                                                                                                                                                                                                               | `owner_name` (joined)                                                                          |
| `MAIL_ADDRESS1..3`, `MAIL_CAREOF`, `MAIL_CITY`, `MAIL_STATE`, `MAIL_COUNTRY`, `MAIL_ZIPCODE`      | owner mailing address (ZIP 5+4, zeros for foreign)                                                                                                                                                                                                            | `owner_mailing_address`                                                                        |
| `LOC_STRNO`, `LOC_STRFRAC`, `LOC_STRDIR`, `LOC_STRNAME`, `LOC_STRTYPE`, `LOC_STRUNIT`, `LOC_CITY` | situs; "Vacant land has no location address"; `LOC_CITY` is a city code (`LV`, `HEN`, `NLV`, `PAR`, ...) per the publisher's city code list                                                                                                                   | `situs_address`                                                                                |
| `LEGAL_DESCR1..7`, `SUBNAME`, `COMMON_NAME`                                                       | legal description, subdivision, common name                                                                                                                                                                                                                   | not used                                                                                       |
| `LANDUSE` varchar(16)                                                                             | land use code `S-UU-A-A-P` (source, use, auxiliary, secondary auxiliary, pool count); "If a parcel is not improved it will contain zeroes"                                                                                                                    | `local_use_code`, mapped to `state_category` below                                             |
| `CAPACITY`                                                                                        | units (apartments), rooms (hotels), spaces (parks)                                                                                                                                                                                                            | note only                                                                                      |
| `ASSDYR`                                                                                          | year last appraised                                                                                                                                                                                                                                           | `tax_year` (with `FISCALYEAR`)                                                                 |
| `CONSTYR` smallint                                                                                | initial construction year                                                                                                                                                                                                                                     | `year_built` (0 = unknown)                                                                     |
| `DOCDATE`, `DOCNO`, `DOCVEST`                                                                     | last ownership document                                                                                                                                                                                                                                       | not used                                                                                       |
| `SALEPRICE`, `SALETYPE`, `SALEDATE`                                                               | last sale from the Recorder's value declaration                                                                                                                                                                                                               | not used (policy §3)                                                                           |
| `LANDACRES` decimal(12,4)                                                                         | total acres                                                                                                                                                                                                                                                   | `land_area_sf` = acres × 43560                                                                 |
| `FISCALYEAR`, `LANDVAL`, `IMPVAL`, `CEVAL`, `TOTVAL`, `EXMPTCD`, `EXMPTVAL`                       | current roll: land, improvement, "CE" (likely common-element/personal-property) and total **taxable (assessed) value** (Nevada assesses at 35% of taxable value; the file's values are the assessed values per the description "establish an assessed value") | `appraised_value` = `TOTVAL`; `market_value` left `None` unless the founder confirms the basis |
| `LYFISCALYEAR`, `LY*`                                                                             | prior-year values                                                                                                                                                                                                                                             | not used                                                                                       |
| `NBRHOOD`, `AD*`, `SECTNO`, `TOWNSHIP`, `RANGE`, `COMMENTS`, `ABATEMENT_TYPE`, `POOLCOUNT`        | neighbourhood, fixed description, PLSS, comments, abatement, pools                                                                                                                                                                                            | not used                                                                                       |

There is no situs ZIP column and no owner-confidentiality flag in the layout. Owner names of
persons appear in the sample, so the registry's organisation-only rule applies; `ETALFLAG` rows
carry extra owners in the separate AOEtal file.

### Land use code mapping (assessor-land-use-codes.pdf, "Source Code Index" and use-code pages)

The first digit is the source code, the next two the use code. Mapping proposed for the adapter;
the full code stays in `local_use_code`:

| Assessor code                                                                                                                                                                           | Publisher's definition                                                                                                                                                                                                                                                                                                                                                                           | FactLot   |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------- |
| `1-50`                                                                                                                                                                                  | "Apartments: Five or more household units within a single structure."                                                                                                                                                                                                                                                                                                                            | `B`       |
| `2-10` .. `2-60`                                                                                                                                                                        | Source Code 2 Industrial: "improvements are used for manufacture or storage of materials, products, or mining processes" (manufacturing, mining, heavy equipment, storage facilities, mini-warehouse, industrial condominiums)                                                                                                                                                                   | `F2`      |
| `3-10` .. `3-99`                                                                                                                                                                        | Source Code 3 Commercial: "wholesale or retail sales of goods or merchandise; repair of a product, to render personal or professional services. (Hotels, Motels, etc.)" (hotels 10–12, motels 20–21, casinos 25, services 30–38, entertainment/recreation/golf 40–49, shopping centres and retail 50–59, restaurants 60–65, automotive 70–78, RV parks 80, commercial condominiums 85, other 99) | `F1`      |
| `0-xx` vacant, `1-10/20/30/40/60/80/85/88/95/99` residential, `4-xx` non-profit community, `5-xx` agriculture, `6-xx` transportation/communication/utilities, `7-xx` minor improvements | out of scope                                                                                                                                                                                                                                                                                                                                                                                     | no record |

Open points for the founder: `1-70` "Multi-Family Structure: This includes low rise and high rise
units, typical of condominium owned residences" is individually owned condominium units and is
excluded by default; `7-30` "minor improvements with a commercial use" is excluded; auxiliary code
`4` means the improvement is billed on the unsecured roll (keep, the parcel is still real property).

## Gates (needs a person)

1. A signed letter on company letterhead (contents per request-for-data.pdf: requester, company,
   address, phone/fax, e-mail, date, nature of business, data requested, purpose, how the data will
   be used) sent to the Assessor's Customer Service Division, (702) 455-3882, requesting one-time
   monthly access or an ongoing subscription to the Clark County Assessor Data Site.
2. Payment: $300 per month (fee schedule effective 2024-07-01).
3. Written confirmation of what the subscription allows: the pages say the data "may not be resold"
   and the AOExtract notice says "for assessment use only"; the registry needs the publisher's
   position on redistributing the facts and on AI use before `verified: true`.
4. Alternatively, a Nevada public-records request under NRS 239.010 for the AOExtract file, asking
   for the same conditions in writing.

Nothing was requested, bought, or signed; no account was created.

### Terms read 2026-11-03 (gates pass)

This memo is research, not legal advice; the founder holds no attorney or real estate license.

**Data files page.** https://www.clarkcountynv.gov/government/assessor/datafiles , read 2026-11-03.

> The files are updated each weekend and are a complete replacement extraction of each file.

> Customers interested in obtaining this information will need to submit a signed letter requesting one time access during a calendar month or an ongoing subscription to access the Clark County Assessor Data Site.

**Fee schedule, effective July 1, 2024.** https://www.clarkcountynv.gov/adobe/assets/urn:aaid:aem:b0ee0f69-d7f2-4964-9270-62bb255d8bea/original/as/fee-schedule-rev-07-01-24.pdf , read 2026-11-03.

> Monthly Subscription of Assessor Data Files                                                            $300.00 per month

> *Fees may be waived upon request and approval for the following subscribers, providing the data requested will used for
> non-commercial purposes only:

The waiver list is a student or faculty member of a college or university, and a government agency. $300.00 per month x 12 = $3,600 per year.

**AOExtract description.** https://www.clarkcountynv.gov/adobe/assets/urn:aaid:aem:97e18ac2-17dd-4389-a037-7f92214d53f9/original/as/aoextract-description.pdf , read 2026-11-03.

> NOTE: This information is for assessment use only. No liability is assumed as to the
> accuracy of the data delineated hereon.

**Data Notice.** https://www.clarkcountynv.gov/adobe/assets/urn:aaid:aem:0f43eec9-ecbe-4d85-aa6c-5a19a1edd6f4/original/as/data-notice.pdf , read 2026-11-03.

> information contained in public record for the use of its customers, subscribers,
> employees and/or shareholders.

> 3. In the event any confidential data is inadvertently revealed to the company or
> individual in connection with furnishing of the records herein specified, the company
> or individual shall not reveal the same to any person nor utilize said information in
> any manner.

Paragraph 5 allocates liability for dissemination. It does not forbid dissemination of public fields.

**Request-letter requirements.** https://www.clarkcountynv.gov/adobe/assets/urn:aaid:aem:abd79829-9f33-4654-9bd3-6f4f715ce4e4/original/as/request-for-data.pdf , read 2026-11-03. Draft at `../requests/orders/nv-clark-assessor-order-draft.md`.

**Statute.** NRS 239.010(1), https://www.leg.state.nv.us/nrs/nrs-239.html , read 2026-11-03.

> Any such copies, abstracts or memoranda may be used
> to supply the general public with copies, abstracts or memoranda of the records

The section does not use the word commercial.

The Data Notice and NRS 239.010 allow public data to be copied and used for customers. The AOExtract note says the information is for assessment use only, and the fee-waiver sentence limits a waiver to non-commercial use by students, faculty, and government. Nothing read flatly forbids publishing a cited commercial-parcel fact while withholding the file. That conflict is unresolved until the Assessor answers the draft letter. Recipient: Clark County Assessor, 500 S. Grand Central Pkwy., Las Vegas, NV 89155, AOPDSTITLE@CLARKCOUNTYNV.GOV. The data-request form names an official on the letterhead. That name is not copied.

## Real run

- `python -m factlot.collector discover --config registry/sources/nv/nv-clark-assessor.json --out collected`
  on 2026-11-02: 3 landing pages fetched (`ok`), 26 links found, all on `mapsrv.clarkcountynv.gov`
  (free GIS zips, none a parcel roll) and all marked `robots_allowed: false` because Python's
  `urllib` could not verify that host's TLS chain from this environment (`CERTIFICATE_VERIFY_FAILED`;
  curl verifies it fine, and its robots.txt is a 404). No file was archived; no `snapshot` run.
- Rows read: 0. Parcels kept: none. Facts: 0. Organisation owners: 0. Snapshot document id: none.
- No adapter (`nv_clark.py`) and no tests were written, because there is no real file to run them
  against (brief: no invented data; stop at a purchase gate).

## Known gaps and candidates

- **City of Las Vegas republication (candidate, different publisher, not catalogued here).**
  ArcGIS Online feature service `CC_PARCELS_SHP`
  (https://services1.arcgis.com/F1v0ufATbBQScMtY/arcgis/rest/services/CC_PARCELS_SHP/FeatureServer,
  layer id 1; item `63173c56a91c448498abe229d0e02a4f`, owner `OfficeOfGIS_LasVegas`, org "City of
  Las Vegas", access public). Its description: "Contains parcel information including parcel number,
  ownership, location, land use, size and update information. Derived from AOCCROLL and updated
  weekly on Wednesday. Last updated: May 20 2026"; credit "Clark County Assessor's Office, Clark
  County GISMO (GIS Management Office) and City of Las Vegas"; capabilities `Query,Extract`, export
  formats csv/shapefile/geojson/filegdb. Real query on 2026-11-02: 841,389 features countywide;
  `LUCODE` 150 (apartments) 4,855; `LUCODE` 200–299 (industrial) 4,580; `LUCODE` 300–399
  (commercial) 14,630. Fields include `PARCEL`, `OWNER`, `ADDRESS1..5`, `NAMETAG`, situs parts and
  `LOCATION`, `STRCITY`, `ZIP`, `LANDUSE` (six digits, e.g. `335000` = 3-35-0-0-0), `LUCODE`
  (three digits), `CAPACITY`, `ASSDYR`, `CONSTYR`, `LANDVAL1/2`, `IMPVAL`, `EXMPCD/EXMPVAL`,
  `LOTSQFT`, `ASSR_ACRES`, prior-year values, `UPDDATE`. The item's only licence text is a City
  no-warranty disclaimer; there is no open-data licence and no statement on redistribution or AI
  use, and the underlying data is the County's licensed product. Needs the founder's decision and
  its own review record (e.g. `nv-lasvegas-parcels`) before any collection.
- The commercial extraction (AOCOM) and the Final Land Use Code Table / commercial key codes are
  separate purchasable files with their own layouts (`aocom-record-layout.pdf`,
  `final-land-use-code-table.pdf`); not reviewed in detail.
- `TOTVAL` basis (assessed at 35% versus taxable value) must be confirmed from the delivered file
  before any value fact is published.
- The collector should be given a CA bundle (or `certifi`) so `mapsrv.clarkcountynv.gov` can be
  checked; it does not affect this source's gate.
