# mi-wayne-parcels: Wayne County, Michigan (FIPS 26163) annual assessment data

Reviewed 2026-11-02. Machine-readable copy: [`registry/sources/mi/mi-wayne-parcels.json`](../../../registry/sources/mi/mi-wayne-parcels.json).
Adapter: `factlot.registry.adapters.mi_wayne` (account system `wayne_parcel_no`, the county parcel
number as printed, e.g. `31 084 01 0212 001`).

**Status: `verified: false`.** The county publishes a county-wide assessment export (all 43
municipalities, Detroit included) with class and values, so this source covers the whole county, not
only Detroit. Two things keep it unverified: the county web portal's terms of use restrict reuse of
site "materials" to personal, non-commercial use and forbid use on another website, which a person
must weigh against the public-record status of an assessment roll; and the county-wide zip could not
be fully downloaded in this session (the host served about 40 KB/s and dropped the collector's
connections after about a minute), so the layout and the real run are confirmed on per-municipality
zips of the same export (see Real run).

## Publisher and URLs

- Publisher: Wayne County, Michigan, Department of Management and Budget, Division of Assessment and
  Equalization (500 Griswold, Suite 2650, Detroit; `equalization@waynecountymi.gov`). The division
  compiles the local assessors' rolls (BS&A assessing exports) after county equalization.
- Landing page: <https://www.waynecountymi.gov/Government/Departments/Management-Budget/Assessment-Equalization/Annual-Assessment-Data>.
  Its only text: "Values listed are as of December 31st, following the approval of county equalization
  by the County Board of Commissioners" and "Note: This is a large file. Please allow several minutes
  for it to download."
- Files (all under `https://www.waynecountymi.gov/files/assets/mainsite/v/1/management-amp-budget/documents/`):
  - `2026-wayne-county-assessments-names-addresses-legal.zip` — "2026 Wayne County Assessments", the
    county-wide file. HEAD on 2026-11-02: 200, `application/zip`, 138,519,414 bytes, Last-Modified
    2026-06-05, ETag, `accept-ranges: bytes`.
  - `assessment-data/2026/2026-wayne-county-assessments-<municipality>.zip` — 43 per-municipality
    files (Allen Park City … Wyandotte City; Detroit City is 40 MB, Last-Modified 2026-09-01 for the
    ones checked). `discover` lists all 44 links from the landing page.
- Related county pages: the division's [Assessment Data](https://www.waynecountymi.gov/Government/Departments/Management-Budget/Assessment-Equalization/Assessment-Data)
  page (describes the export as "master CSV files with assessment, building, name, and legal
  description fields", says the division "no longer offers GIS data", and points to
  <https://data-wayne.opendata.arcgis.com/> and to local assessors for current values); the
  [GIS Data](https://www.waynecountymi.gov/Services/Maps-Data/GIS-Data) page (parcel shapefile
  `wayne_county_allcomm_n.zip`, 75 MB, "as of 2015, and provided for reference only"); FOIA requests
  go through <https://waynecountymi.nextrequest.com/>.
- Alternative, Detroit only: the City of Detroit Office of the Assessor's "Parcels (Current)" layer on
  the Detroit Open Data Portal (ArcGIS Hub item `3c784c118e5c4083b37038e9b38573df`, feature service
  `services2.arcgis.com/qvkbeam7Wirps6zC/arcgis/rest/services/parcel_file_current/FeatureServer/0`,
  fields `property_class`, `property_class_description`, `amt_assessed_value`, `amt_taxable_value`,
  updated daily). Its item metadata has an empty `licenseInfo`; `data.detroitmi.gov/robots.txt` sets
  `Crawl-delay: 60`. Not catalogued: the county file already covers Detroit with the same class codes.

## Terms, license, robots

- **Terms.** No terms or license are stated on the landing page or in the files. The portal footer's
  "Legal Info & Privacy Policy" is <https://www.waynecountymi.gov/Government/About-Wayne-County/Privacy-Policy>.
  Its "Wayne County Terms of Use and Linking Policy" section says: "The Wayne County web portal is
  owned and operated by the Wayne County government and provided as a service to the public. The use
  of the content, images and logos on the Wayne County web portal on any other web site or networked
  computer environment is prohibited. Some of the materials on the web portal may be saved on any
  single personal computer for personal, non-commercial use only. All copyrighted material and other
  means of proprietary or copyright identification must be kept intact and unmodified. Modification
  of the materials or use of the materials for purposes not granted by the Wayne County is a
  violation of Wayne County's copyright and other proprietary rights." The page opens with a
  confidentiality notice ("The use, dissemination, distribution, publication or action in reliance on
  any of the information contained in this communication is strictly prohibited") that reads as
  e-mail boilerplate. Nothing addresses automated access, bulk data, or AI use. The page's own
  privacy statement cites the Michigan Freedom of Information Act (MCL 15.231 et seq.).
- **License status.** Assessment rolls are public records in Michigan (General Property Tax Act,
  MCL 211.1 et seq.; FOIA). The facts in the file (parcel number, class, values, situs) are not
  copyrightable, but the portal terms as written do not grant redistribution, so the config records
  `redistribution` as unclear and `ai_use` as not addressed. Gate for the founder (below).
- **robots.txt** (`www.waynecountymi.gov/robots.txt`, read 2026-11-02): `User-agent: *` with a list
  of disallowed content pages (Covid, EngagementHQ projects, redirects, Sandbox, payment-option
  pages); no rule on `/files/`, no `Crawl-delay`. The landing page and the files are allowed; the
  collector's `discover` reported every link `robots_allowed: true`.

## What the file contains

Each zip holds one quoted CSV (`BELLEVILLE.CSV`, `DETROIT.CSV`, …; the county-wide zip is expected to
hold the same files for every municipality) with a 130-column header row and one row per parcel or
personal-property account, exported from the BS&A assessing system. Column names are `Table.field`
(`Parcels.*`, `ParcelMaster.*`, `ParcelReadonly.*`). Values are quoted; ASCII; CRLF; the last line is a
lone 0x1A (DOS end-of-file) byte, which the adapter skips. There is no layout document: the field
meanings below come from the names and the values seen.

Key columns:

| Column                                                                                                                  | Used as                                                                                                                                                                                   |
| ----------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Parcels.pnum`                                                                                                          | parcel number (`31 084 01 0212 001`; the first two digits are the municipality's county code, `Parcels.secondaryunit`): `apn`, `account`                                                  |
| `ParcelMaster.r_or_p`                                                                                                   | `0` real, `1` personal property (dropped)                                                                                                                                                 |
| `Parcels.propclass` (`Parcels.oldprop` is the prior class)                                                              | Michigan classification, kept verbatim in `local_use_code`; mapped to the FactLot category (table below)                                                                                  |
| `ParcelMaster.cib_numcib`, `cib_occ_String`, `cib_floorarea`, `cib_yearbuilt`, `cib_stories`                            | commercial/industrial buildings: count, occupancy type, floor area (sf), year built                                                                                                       |
| `ParcelMaster.resb_numresb`, `resb_floorarea`, `resb_yearbuilt`, `resb_*`                                               | residential buildings on the parcel                                                                                                                                                       |
| `ParcelMaster.totalacres`                                                                                               | land area, acres × 43,560 → `land_area_sf`                                                                                                                                                |
| `ParcelMaster.esttcv`                                                                                                   | estimated true cash value → `market_value` (0 = no figure, typically exempt parcels)                                                                                                      |
| `ParcelReadonly.ass_1`, `mborsev_1`, `tax_1` (`_2`, `_3` prior years; `adj*`, `mbor*` are the board-of-review variants) | assessed, state-equalized, and taxable value (50 % of true cash value by law). Not stored: the registry has no field for them                                                             |
| `ParcelMaster.propstreetcombined`, `unitorapt`, `propcity`, `propstate`, `propzip`                                      | situs → `476 W COLUMBIA AVE, BELLEVILLE MI 48111`; no situs when the street line is blank (`propaddrnum` is `0.0` for about 14 % of Belleville rows)                                      |
| `ParcelMaster.ownername1`, `ownername2`, `ownercareof`, `ownerstreetaddr`, `ownercity`, `ownerstate`, `ownerzip`        | owner of record (line 1), mailing address (care-of line first). `ownername2` is sometimes a co-owner, sometimes a continuation or a lender, so it is not used. `UNKNOWN` is a placeholder |
| `Parcels.exemptcode`, `Parcels.isExempt`                                                                                | `TAXABLE` or `EXEMPT (211.7S)` etc.; not stored (exempt parcels keep their class and have 0 values)                                                                                       |
| `Parcels.useCode`                                                                                                       | a local five-digit use code, blank on about 90 % of rows; not used                                                                                                                        |
| `ParcelMaster.lastSalePrice`, `lastSaleDate`, `ParcelReadonly.legalDescription`, `Parcels.publ_*`, PRE fields           | present, not used                                                                                                                                                                         |

The roll year is not a column. It is read from the file name (`2026-wayne-county-…`), or passed as
`--tax-year`. The export's `_1` columns are the 2026 roll (values as of 2025-12-31 after county
equalization); `_2` and `_3` are 2025 and 2024.

### Class codes and the mapping

Michigan classifies real property by use under MCL 211.34c (agricultural, commercial, developmental,
industrial, residential, timber-cutover) and the State Tax Commission assigns three-digit codes: the
first digit is the class, `x01` improved, `x02` vacant, `207` commercial condominium, `210` commercial
building on leased land, `x51` personal property (the STC "Property Class Codes" page on michigan.gov
and the STC CAMA Data Standards list them; michigan.gov answered 403 to the collector and to curl, so
the list was taken from the search abstracts and the codes seen in the file). There is **no
multifamily class**. The STC's _Property Classification_ guidance (prepared by the Michigan State Tax
Commission, issued December 2011, read from a township's posted copy) says of the commercial class:
"Apartment buildings or a complex with more than 4 units", and of the residential class: "A single
housing unit or single structure consisting of four or less sub units is generally included in the
residential classification." So 5+ unit multifamily is coded `201` like any other commercial parcel.
The adapter therefore uses the assessor's commercial-building occupancy type to pull apartments out of
`2xx`.

| `propclass`                        | Seen in Belleville / meaning                                   | FactLot category                                                                                 |
| ---------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `201`, `202`, `207`, `210` (`2xx`) | commercial improved / vacant / condominium / on leased land    | **F1**; **B** when `cib_numcib` ≥ 1 and `cib_occ_String` is `Apartment` or `Multiple Residences` |
| `301`, `302` (`3xx`)               | industrial improved / vacant                                   | **F2**                                                                                           |
| `401`, `402`, `407`, `410` (`4xx`) | residential (houses, condominiums, ≤ 4-unit buildings, lots)   | A (out of scope)                                                                                 |
| `1xx`, `5xx`, `6xx`                | agricultural, timber-cutover, developmental                    | D1, D2, C1 (out of scope)                                                                        |
| `251`, `351`, `551` (`x51`)        | personal property (also `r_or_p` = 1)                          | none                                                                                             |
| `001`, `003`                       | local codes outside the STC list (`003` rows are all personal) | none                                                                                             |

`cib_occ_String` is a BS&A enumeration whose first value, `Apartment`, is also what the export writes
for parcels with no commercial building at all (every house, church, and vacant lot shows it), so it
counts only when the building count is at least 1. In Belleville that rule turns 15 of the 140 `201`
parcels into B (for example a 86,406 sf limited-dividend housing complex) and leaves the exempt
churches coded `201` as F1 with no values.

## Gates (anything that needs a person)

1. **Terms of use.** Decide whether the portal's "personal, non-commercial use only" and "use … on any
   other web site … is prohibited" sentences apply to the assessment exports, or ask
   `equalization@waynecountymi.gov` for a statement on reuse of the annual assessment files (and on AI
   use). Until then the source stays `verified: false` and nothing from it is published. Downloading
   the files needs no account, login, click-through, CAPTCHA, or fee.
2. **The county-wide download.** The 132 MB zip downloads at about 40 KB/s from this environment
   (while other collectors share the connection), and the collector's connections were closed by the
   host or network after roughly a minute (`The read operation timed out`, `Remote end closed
connection without response`, `SSL: UNEXPECTED_EOF_WHILE_READING`). The weekly GitHub Actions
   collector, or a run from the founder's machine, should archive it; if it still fails, the 43
   per-municipality zips (listed by `discover`) are the same export in smaller pieces and can be put
   in `files` instead.

### Terms read 2026-11-03 (gates pass)

Portal terms, <https://www.waynecountymi.gov/Government/About-Wayne-County/Privacy-Policy>, section "Wayne County Terms of Use and Linking Policy" (read 2026-11-02, NOTES.md):

> The use of the content, images and logos on the Wayne County web portal on any other web site or networked computer environment is prohibited.

> Some of the materials on the web portal may be saved on any single personal computer for personal, non-commercial use only.

> Modification of the materials or use of the materials for purposes not granted by the Wayne County is a violation of Wayne County's copyright and other proprietary rights.

The same page opens with: "The use, dissemination, distribution, publication or action in reliance on any of the information contained in this communication is strictly prohibited." It cites "the Freedom of Information Act. MCL 15.231, et seq." Bulk data, automated access, and AI use are not addressed.

Statute, MCL 15.231(2), <https://www.legislature.mi.gov/Laws/MCL?objectName=mcl-15-231> (read 2026-11-02):

> It is the public policy of this state that all persons, except those persons incarcerated in state or local correctional facilities, are entitled to full and complete information regarding the affairs of government and the official acts of those who represent them as public officials and public employees, consistent with this act.

MCL 15.233(1), <https://www.legislature.mi.gov/Laws/MCL?objectName=mcl-15-233> (read 2026-11-02): "upon providing a public body's FOIA coordinator with a written request that describes a public record sufficiently to enable the public body to find the public record, a person has a right to inspect, copy, or receive copies of the requested public record of the public body." Commercial use: silent. Redistribution: silent.

Blocked on 2026-11-03 (founder should open these): <https://www.waynecountymi.gov/Services/Records/FOIA-Request-Form-General> (HTTP 403, Access Denied); the FOIA procedures PDF at <https://www.waynecountymi.gov/files/assets/mainsite/v/1/clerk/documents/records/summary_of_foia_procedures_and_guidelines.pdf> (HTTP 403); <https://waynecountymi.nextrequest.com/> (HTTP 204, empty body). The FOIA coordinator's postal address is NOT CONFIRMED from those fetches. The review record (reviewed 2026-11-02) states the publishing division, Department of Management and Budget, Division of Assessment and Equalization, at 500 Griswold, Suite 2650, Detroit, and equalization@waynecountymi.gov, with no ZIP.

The terms restrict saving materials to personal, non-commercial use and prohibit using portal content on any other website. They do not grant redistribution of the annual assessment zip. Michigan FOIA, as read, gives a right to inspect and copy and says nothing about commercial reuse. Do not treat the export as cleared for the open registry until the county answers the letter in `mi-wayne-parcels-letter.md`.

### Platform terms read 2026-11-03 (gates pass, Task 5)

Esri / ArcGIS Hub. No separate public Hub terms page for downloaders was found. Esri's Master Agreement (E204CW, <https://www.esri.com/content/dam/esrisites/en-us/media/legal/ma-translations/english.pdf>) and Product-Specific Terms (E300, <https://www.esri.com/content/dam/esrisites/en-us/media/legal/product-specific-terms-of-use/e300.pdf>) were read 2026-11-03 (HTTP 200, not accepted). Full notes: [`../requests/platform-terms/esri-hub.md`](../requests/platform-terms/esri-hub.md), [`esri-e204.md`](../requests/platform-terms/esri-e204.md), [`esri-e300.md`](../requests/platform-terms/esri-e300.md). E300 footnote 85:

> Software licenses and subscriptions included with ArcGIS Hub may only be used to support the community initiatives enabled by ArcGIS Hub.

Read: E204 and E300 bind Esri's customer (here, the publisher), not an anonymous downloader, and neither restricts redistribution of public records the publisher chooses to publish. The publisher's own terms recorded above still govern. Do not create an Esri account or accept either agreement to download a file.

## Real run

Per-municipality zips of the 2026 export, archived with the collector (manifest
`collected/mi-wayne-parcels/manifest.jsonl`) and run through `mi_wayne.build(..., full_roll=False)` on
2026-11-02 (2026-11-03 UTC):

- **Belleville City** (`2026-wayne-county-assessments-belleville-city.zip`, 213,176 bytes, Last-Modified
  2026-09-01; snapshot `fl:document:sha256-5d4d62defbe455f32b68c9aa469c98afdec5cf99f3a7aa277fa93403bd0afed6`,
  `--as-of 2026-09-01`): 1,731 rows read (plus the EOF line); 1,322 real-property parcels, 409
  personal-property accounts dropped; **235 parcels kept** (F1 194, F2 26, B 15); 2,093 facts; 138
  organisation owners of record stored; 97 owners were natural persons or placeholders and were not
  stored; 0 invalid; 0.14 s. Of the 235: 235 have a situs, 190 a true cash value, 201 a land area, 135
  a building area, 116 a year built.
- **Detroit City** (`2026-wayne-county-assessments-detroit-city.zip`, 40 MB): not obtained. Three
  collector attempts were cut off by the host after 1–6 MB (`Remote end closed connection without
response`, then a SIGTERM'd process at 4 MB), and by 01:51 UTC the host answered HEAD for this file
  with `content-length: 1` and reset range requests, which reads as the CDN refusing further
  automated requests from this address. Per the data policy the attempts stopped there; nothing was
  worked around. A later run (the weekly collector, or the founder's machine) should archive it with
  `snapshot`.

The county-wide zip was not run either (Gate 2): the one attempt that got past robots.txt timed out
reading after 6 MB.

## Known gaps

- The county-wide file's member layout (one CSV per municipality, or one combined file) is not yet
  confirmed; the adapter reads every `.csv` member of a zip, so either works.
- Michigan's assessed, state-equalized, and taxable values (50 % of true cash value) are in the file
  but have no registry field; `appraised_value` is left empty rather than mixing scales.
- Multifamily depends on the assessor's building occupancy type. Apartments coded `201` whose building
  record is missing (`cib_numcib` = 0) stay F1; mixed-use buildings with apartments over retail are F1
  (`Shopping Centers - Mixed w/Residential Units`). Buildings of four or fewer units are residential by
  law and out of scope.
- The file has no owner-confidentiality flag and no sale-price withholding (Michigan records sale
  prices; `lastSalePrice` is in the file but not loaded).
- Situs is missing where `propstreetcombined` is blank (vacant lots mostly); the county-wide file's
  per-municipality CSVs may name the situs city differently from the municipality (e.g. township
  parcels with a city mailing name).
- No situs ZIP+4 normalisation; `propzip` is stored as published (`48111` or `48111-2683`).
