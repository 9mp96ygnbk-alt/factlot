# ca-san-joaquin-assessor — San Joaquin County, California (FIPS 06077)

Review record for the county's parcel layer that carries the Assessor's roll attributes.
**Result: a complete free roll exists (253,428 parcels with use codes, values, situs and building
facts) but it states no licence, so `verified: false`. No adapter is written (Tier 2 method:
adapters for verified sources only); the layout is mapped below so one takes about an hour once the
county clears the terms. No data file was archived.** Config:
`registry/sources/ca/ca-san-joaquin-assessor.json`. Reviewed 2026-11-03.

## Publisher and URLs

- Publisher: San Joaquin County Department of Public Works GIS; the layer's copyright text reads
  "San Joaquin County Assessor's Office".
- Open data portal: https://opendata.sjgov.org (CKAN). Dataset page
  https://opendata.sjgov.org/dataset/parcels ("Parcels within San Joaquin County limits. Updated:
  09/2026"; CKAN last updated 2026-11-02, dcat modified 2026-10-12).
- ArcGIS item `03f97b03d2614a6b8505dd16962a0922` "Parcels" (owner `SanJoaquinCountyPW`, size
  408 MB), service
  `https://services2.arcgis.com/GQhSReJEO6f7tsvy/arcgis/rest/services/Parcels/FeatureServer/0`
  (capability Query, `maxRecordCount` 2000, **253,428 features**). Hub site
  https://san-joaquin-county-public-works-sjc-gis.hub.arcgis.com/datasets/sjc-gis::parcels.
- Download links listed on the CKAN record (Hub download API):
  `https://san-joaquin-county-public-works-sjc-gis.hub.arcgis.com/api/download/v1/items/03f97b03d2614a6b8505dd16962a0922/csv?layers=0`
  (also shapefile, GeoJSON, KML). Not requested: see Gates.
- A second, older route: https://sjmap.org/GISDataDownload.htm offers `gisdata/Parcels.zip` (a
  shapefile snapshot "extracted ... twice per year", latest 2026-07-06) under the same terms.

## Terms, license, robots

- Licence: **none**. CKAN: "License: No License Provided". The ArcGIS item has no `licenseInfo`
  (null) and no `license`.
- The county's GIS download page (https://sjmap.org/GISDataDownload.htm) says: "This data is subject
  to the standard disclaimer. See terms and conditions of use for full details. Any use of this data
  shall constitute acceptance of these terms." The terms
  (https://sjmap.org/files/SjcGisAgreementP2.pdf, "GIS Product – Terms and Conditions of Use", read
  2026-11-03) disclaim all warranty, and clause 4 makes the applicant "defend, ... hold harmless and
  indemnify the County of San Joaquin" against claims from "the modification, misrepresentation,
  misuse or reuse by others of the machine-readable ... information and data ... excepting only such
  use as may be authorized, in writing, by the County of San Joaquin." That reads as written
  authorization being needed for onward reuse by others, which a public registry is.
- AI use: not addressed. Redistribution: not granted.
- robots.txt: `opendata.sjgov.org` disallows `/api/`, `/datastore/*` and others for all agents (the
  dataset page itself is allowed and was read). The Hub site (`*.hub.arcgis.com`) sets
  `Crawl-delay: 60` and disallows `/sites/ /admin/ /sessions/ /groups/ /people/ /workspace/`.
  `sjmap.org` disallows `/website/ /arcgis/ /portal/ /server/ /asrpdf/`; `/GISDataDownload.htm` and
  `/gisdata/` are allowed. The feature service's public REST endpoint (`services2.arcgis.com`) was
  queried for the layout and statistics only, within the 2-second spacing.

## What the layer contains

One row per parcel; 2026 roll (`VALUE_ROLL_YEAR` "2026"). The field list (ArcGIS names):

| Field(s)                                                                                                           | Meaning / use                                                                                                                                        |
| ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `APN` (8 digits `26707002`), `LINK` (9, with check digit `267070002`), `MPTS_FEEPARCEL`                            | parcel key; `APN` is the printed-form digits without dashes → `apn`; `LINK` → `account`                                                              |
| `USECODE`, `USECODES` (integer), `USECODE_1`, `DESCRIPTION`, `CATEGORY`                                            | the Assessor's three-digit use code, its text and the county's category (`RESIDENTIAL`, `COMMERCIAL`, `INDUSTRIAL`, `AGRICULTURAL`, ...)             |
| `SITUSNUMBER`, `SITUSDIRECTION`, `SITUSTREET`, `SITUSTYPE`, `SITUSUNIT`, `SITUSCITY`, `SITUSZIP`, `FULL_ADDRESS`   | situs (`FULL_ADDRESS` is one line: `32398 S CORRAL HOLLOW RD TRACY CA 95377`)                                                                        |
| `LAND_VALUE`, `STRUCTURE_VALUE`, `IMPROVEMENT_VALUE`, `FIXED_EQUIP_VALUE`, `TREE_VINE_VALUE`, `PERS_PROP_VALUE`    | assessed values (Proposition 13), not market values                                                                                                  |
| `LANDSIZE_SQFT`, `LANDSIZE_ACRES`, `YEAR_BUILT`, `STORIES`, `TOTALLIV_AREA`, `NUMBER_UNITS`, `FD_SQFT`, `RENTSQFT` | land and building facts                                                                                                                              |
| `MAILSTREET`, `MAILCITY`, `MAILSTATE`, `MAILZIP*`, `MAILING_ADDRESS`, `CAREOF`, `DBANAME`                          | owner **mailing** address, a care-of line (sample rows show a personal name) and a business name. **No owner-of-record name.** None would be stored. |
| `EXEMPCODE`, Williamson Act `WILLYACT_*`, `MPTS_*`, `TRA`, `APNHISTORY`, `RETIRE_*`                                | not mapped                                                                                                                                           |

**Use codes** (distinct values with row counts queried from the service on 2026-11-03; the Assessor's
printed code book was not located, so the descriptions below are the layer's own `DESCRIPTION`
text). Row counts: RESIDENTIAL 219,197; AGRICULTURAL 12,128; COMMERCIAL 9,171; UTILITIES &
GOVERNMENT 6,334; INDUSTRIAL 3,821; blank 1,874; INSTITUTIONAL 681; RECREATIONAL 222.

- **B (multifamily, five or more units)**: `41` "5-10 res units - single building" (329), `42`
  "5-10 res units - 2 or more buildings" (275), `43` "11-20 res units - one structure" (115), `44`
  "11-20 res units - 2 or more buildings" (108), `45` "21-40 res units" (150), `46` "41-100 res units"
  (147), `47` "over 100 units" (96), `48` "high rise apartments" (2). 1,222 parcels.
- **F1 (commercial)**: `COMMERCIAL` category improved codes, for example `110` single story store
  (597), `112` multiple stores in one building (277), `113` store with residential units (207), `121`,
  `140` grocery store, `151`/`152`/`154`/`155` shopping centres, `170`/`171` office buildings, `190`-`197`
  medical and dental offices and condominiums, `210` restaurants, `211` fast food (237), `240` banks,
  `253` truck terminal (156), `255` service station, `260`-`262` auto sales, `280`/`281` repair, `90`
  mobile home park (100). Out: vacant land `100`-`102`, common areas `80`-`82`, `200`, and residential
  or exempt codes.
- **F2 (industrial)**: `INDUSTRIAL` improved codes `310` light manufacturing (427), `311`, `312`, `313`
  industrial condominium (459), `314`, `320` warehousing (580), `323`, `324` mini storage (173), `370`
  heavy industry (58). Out: vacant `300`-`302`.
- Out of scope: single-family, duplex to fourplex (`11`-`35`), rural residence (`50`-`59`), agricultural,
  utilities and government (`8xx`, `9xx`), institutional (church `710`/`711`), recreational (club `640`).
  The adapter would take the code list from this table and confirm it against the Assessor's list.

## Gates (need a person)

1. **Licence and written authorization.** Needs the county (the Assessor, or Public Works GIS through the
   sjmap.org "GIS Data Request" page) to confirm in writing that the Open Data "Parcels" layer may be
   copied, stored and redistributed, and by whom a signed "authorized, in writing" statement is given.
   Until then the source stays `verified: false`. Nothing was requested from the county in this review.
2. After clearing: add the CSV export URL(s) to `files` (a `where` filter on `CATEGORY` or `USECODES`
   keeps the file small; the full layer is 408 MB, over the review's 50 MB limit), set `verified: true`,
   write `ca_san_joaquin.py` modelled on `ca_sacramento.py` and `ca_los_angeles.py`.

## Real run

None, by design. Only the field list, the record count (253,428), grouped use-code counts and four
sample rows were read from the public REST endpoint to confirm the layout. No file was downloaded.

## Known gaps

- No owner-of-record name anywhere; the care-of line can hold a person's name and is not for storage.
- Use-code definitions come from the layer's own `DESCRIPTION`, not the Assessor's code book.
- A blank `CATEGORY` on 1,874 rows (probably retired or unsecured parcels) needs a look.
