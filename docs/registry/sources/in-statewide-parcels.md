# in-statewide-parcels: Indiana statewide parcels (IGIO / IndianaMap), DLGF commercial and industrial classes

Reviewed 2026-11-06. Machine-readable copy: [`registry/sources/in/in-statewide-parcels.json`](../../../registry/sources/in/in-statewide-parcels.json).
Adapter: `factlot.registry.adapters.in_statewide` (account system `in_state_parcel`, `<3-digit county FIPS>:<state parcel id>`).

**Status: `verified: false`.** The license text was read and quoted below. A person has not signed off, so the config stays unverified. This record does not say the commercial universe is complete.

## Publisher and URLs

- Publisher: Indiana Geographic Information Office (IGIO), Indiana GIS Data Harvest Program. The service description says the parcel boundaries are maintained by county agencies and compiled by IGIO. Contact on the IGIO GIS-law page: `GIOsupport@iot.in.gov`.
- Live layer used: `https://gisdata.in.gov/server/rest/services/Hosted/Parcel_Boundaries_of_Indiana_Current/FeatureServer/0` (service item id `ce78e8017fcb479c81a06a6255cfcfa6`). `maxRecordCount` 2000; `standardMaxRecordCountNoGeometry` 16000 with `maxRecordCountFactor` 1, so a query still returns at most 2,000 features. Capabilities: Query, Extract. Supports pagination and statistics. `editingInfo.lastEditDate` 1791318214250 ms = 2026-10-06 20:23:34 UTC. That is the layer's last edit, not each county's harvest date.
- Service iteminfo (the license read below): `https://gisdata.in.gov/server/rest/services/Hosted/Parcel_Boundaries_of_Indiana_Current/FeatureServer/info/iteminfo?f=json`. Its description says the layer "was released by the Indiana Geographic Information Office (IGIO) on November 13, 2024."
- ArcGIS Online item `70565d886f1e4528a43a86be6ce5c2f3` (owner IndianaMap) points at the same FeatureServer. Its `modified` time is 1706536284000 ms = 2024-01-29 13:51:24 UTC, and its description still says the layer was released February 1, 2022. That item's `licenseInfo` is the shorter 2021 citation quoted below. It is not the current service text.
- Data Harvest access page (not downloaded): <https://dataharvest.gio.in.gov/pages/data-access>. The page says the data is collected annually and is available as feature services and for download, and that the maps below cover 2020 through 2025. No separate licence paragraph was in the page metadata read on 2026-11-06.
- IGIO statement on GIS records: <https://www.in.gov/gis/indiana-gis-law/>.

## Terms, license, robots

Read 2026-11-06.

**Terms on the live service** (`licenseInfo` of the FeatureServer iteminfo; HTML `span`/`p` wrappers removed, wording unchanged):

> This data is a digital representation of real property legal descriptions, and is not intended to be used as a survey product. No spatial accuracy standard is enforced on this data, and accuracy may vary widely by area. CREDIT - It is requested, but not required, that the Indiana GIS Data Harvest Program be cited in any products generated from this data set. If citing, the following source citation language should be included: [Parcel Boundaries of Indiana 2024: Parcel Boundaries Maintained by County Agencies in Indiana, (Indiana Geographic Information Office, File Geodatabase, Polygon Feature Class), 20241113]. LIMITATION OF WARRANTIES AND LIABILITY - This product is provided "AS IS", without any other warranties or conditions, expressed or implied, including, but not limited to, warranties for product quality, or suitability to a particular purpose or use. The risk or liability resulting from the use of this product is assumed by the user. The Indiana Geographic Information Office, Indiana University, and The Polis Center at IUPUI share no liability with product users indirect, incidental, special, or consequential damages whatsoever, including, but not limited to, loss of revenue or profit, lost or damaged data or other commercial or economic loss. The Indiana Geographic Information Office, Indiana University, and The Polis Center at IUPUI are not responsible for claims by a third party. The maximum aggregate liability to the original purchaser shall not exceed the amount paid by you for the product.

The citation sentence asks for credit and says the credit is not required. The rest is a warranty and liability limit. The text does not forbid redistribution and does not mention AI use. The "original purchaser" sentence is in that liability paragraph; the service is a public FeatureServer and this review found no purchase step and no click-through on the query URL.

**Older Hub item** `70565d886f1e4528a43a86be6ce5c2f3`, `licenseInfo` as returned 2026-11-06:

> CREDIT - It is requested, but not required, that the Indiana GIS Data Harvest Program be cited in any products generated from this data set. If citing, the following source citation language should be included: [Parcel Boundaries of Indiana 2021: Parcel Boundaries Maintained by County Agencies in Indiana, (Indiana Geographic Information Office, File Geodatabase, Polygon Feature Class), 20220201].

**IGIO GIS-law page**, the sentence read 2026-11-06:

> Indiana government GIS data are public records and are not subject to licensing or royalties per an opinion of Indiana's Public Access Counsel.

That page cites IC 4-23-7.3 and links a Public Access Counselor opinion. This review does not treat the opinion as a licence grant beyond that sentence. AI use is not addressed on the iteminfo, the Hub item, the Data Harvest access page, or the GIS-law page.

**robots.txt**, fetched 2026-11-06 with the collector user agent:

- `https://gisdata.in.gov/robots.txt` returns HTTP 301 to `https://gisdata.in.gov/portal/home/` (HTML, no `Disallow` rules). `https://gisdata.in.gov/server/robots.txt` and `https://gisdata.in.gov/portal/robots.txt` return HTTP 404.
- `https://www.arcgis.com/robots.txt` is `User-agent: *` and a sitemap, with no `Disallow`.
- `https://dataharvest.gio.in.gov/robots.txt` and `https://www.indianamap.org/robots.txt` set `Crawl-delay: 60` and disallow `/sites/`, `/admin/`, `/sessions/`, `/groups/`, `/people/`, `/workspace/`. Those hosts are not in this source's file list.

No new rights question beyond the planned `verified: false` sign-off. The licence does not forbid redistribution or AI use. It also does not grant an express licence; a person still has to accept the reading before `verified` can be set true.

## What the layer contains

One polygon per feature. Fields on the layer (2026-11-06): `objectid`, `state_parcel_id`, `parcel_id`, `nguid`, `prop_add`, `prop_city`, `prop_state`, `prop_zip`, `local_id`, `dlgf_prop_address`, `dlgf_prop_address_city`, `dlgf_prop_address_state`, `dlgf_prop_address_zip`, `dlgf_prop_class_code` (string, length 3), `county_fips` (string, length 5), `county_id`, `esri_zip`, `esri_poname`, `latitude`, `longitude`, tax-district fields (`valid_tax_code`, `cnty_tax_dist_cd`, `tax_county`, `tax_township`, `tax_city`, `tax_school`, `tax_library`, `tax_special`), `source_featureid`, `source_originator`, `loaddate` (date), and geometry. There is no owner-name field and no assessed-value field.

The adapter reads `state_parcel_id` (the APN), `county_fips`, `dlgf_prop_class_code`, the two situs blocks, and `loaddate`. `parcel_id` is the county local id and is not the key. `SHAPE__Area` is in decimal degrees and is not stored as land area. A name-like attribute, if one were present, is not read.

Counts below are queries of this layer on 2026-11-06. They are not a total the publisher printed.

| Query                                                  |            Result |
| ------------------------------------------------------ | ----------------: |
| All features                                           |         3,682,675 |
| `dlgf_prop_class_code` null or blank                   |            58,222 |
| 3-character class `3__` or `4__` (features)            |           208,229 |
| Distinct `state_parcel_id` among those features        |           200,473 |
| Of which Marion County `18097` features / distinct ids |   20,771 / 20,543 |
| Other 91 counties, features / distinct ids             | 187,458 / 179,930 |
| 3xx/4xx features with a blank `prop_add`               |            31,452 |
| 3xx/4xx features with a blank `dlgf_prop_address`      |               144 |
| 3xx/4xx features with both streets blank               |               126 |

`count_distinct` was rejected by the service (`Unsupported statistic operation 'count_distinct'`). Distinct ids are `returnDistinctValues=true` with `returnCountOnly=true` on `state_parcel_id`, one query per county. The feature count is `returnCountOnly` on the same filter. Ohio County (`18115`) returned 162 features and 157 distinct ids; a one-page fetch of that county's config URL returned 162 features and the field list above, with no owner column.

## DLGF class mapping

Indiana does not use Texas state-category letters. The class is the DLGF property class code required by 50 IAC 26. Descriptions below are the VALUE column of Code List 1 in the Property Tax Management System Code List Manual, PDF at <https://www.in.gov/dlgf/files/2026-memos/Property-Tax-Management-System-Code-List-Manual-260514.pdf>, text read 2026-11-06 (a page footer in that text says May 27, 2026). The hundreds digit is the DLGF family: 1 agricultural, 2 mineral, 3 industrial, 4 commercial, 5 residential, 6 exempt, 8 utility.

The registry has three commercial slots (data policy section 3). This adapter assigns them only from the DLGF names:

- DLGF family 3 (codes 300–399), including vacant industrial land and support land `309`, and including code `395` which is in the layer and not in the manual list read above: registry industrial slot `F2`.
- DLGF `401`, `402`, `403`, which the manual names as commercial apartments of 4–19, 20–39, and 40 or more families: registry multifamily slot `B`. Code `401` includes a 4-family building. The manual calls these apartments, so they are kept in the commercial scope and the code is stored in `local_use_code`.
- Other DLGF family 4 (400–499), including vacant commercial land, hotels, retail, offices, and commercial warehouses: registry commercial slot `F1`.
- Every other code, a code that is not three digits, and a Texas letter such as `F1` or `B` written into this field: no record. Residential, agricultural, mineral, exempt, and utility classes are not relabelled with Texas category letters.

Live feature counts on 2026-11-06 for codes the filter keeps. The slot is the mapping above. Counts are features, not distinct parcels.

| Code | DLGF manual VALUE (read 2026-11-06)                                                       | Features | Registry slot |
| ---- | ----------------------------------------------------------------------------------------- | -------: | ------------- |
| 300  | INDUSTRIAL VACANT LAND                                                                    |     9277 | F2            |
| 309  | PARCEL CLASSIFIED AS VACANT BUT IS PART OF THE SUPPORT LAND FOR ANOTHER PARCEL            |     1399 | F2            |
| 310  | INDUSTRIAL FOOD & DRINK                                                                   |      345 | F2            |
| 320  | INDUSTRIAL FOUNDRIES & HEAVY MANUFACTURING                                                |      426 | F2            |
| 330  | INDUSTRIAL MEDIUM MANUFACTURING & ASSEMBLY                                                |      985 | F2            |
| 340  | INDUSTRIAL LIGHT MANUFACTURING & ASSEMBLY                                                 |     5983 | F2            |
| 345  | INDUSTRIAL OFFICE                                                                         |      538 | F2            |
| 346  | INDUSTRIAL RESEARCH AND DEVELOPMENT FACILITY                                              |      100 | F2            |
| 350  | INDUSTRIAL WAREHOUSE                                                                      |     6062 | F2            |
| 360  | INDUSTRIAL TRUCK TERMINALS                                                                |      332 | F2            |
| 370  | INDUSTRIAL SMALL SHOPS                                                                    |     3056 | F2            |
| 380  | INDUSTRIAL MINES AND QUARRIES                                                             |     1081 | F2            |
| 385  | INDUSTRIAL LANDFILL                                                                       |      165 | F2            |
| 390  | INDUSTRIAL GRAIN ELEVATORS                                                                |      803 | F2            |
| 395  | Not in the May 27, 2026 code list read above; mapped by the 3xx family                    |        1 | F2            |
| 398  | INDUSTRIAL BUILDING ON LEASED LAND                                                        |       66 | F2            |
| 399  | INDUSTRIAL OTHER STRUCTURES                                                               |     5122 | F2            |
| 400  | COMMERCIAL VACANT LAND                                                                    |    29570 | F1            |
| 401  | COMMERCIAL 4-19 FAMILY APARTMENTS                                                         |     8540 | B             |
| 402  | COMMERCIAL 20-39 FAMILY APARTMENTS                                                        |     1588 | B             |
| 403  | COMMERCIAL 40 OR MORE FAMILY APARTMENTS                                                   |     4018 | B             |
| 409  | COMMERCIAL PARCEL CLASSIFIED AS VACANT BUT IS PART OF THE SUPPORT LAND FOR ANOTHER PARCEL |     3151 | F1            |
| 410  | COMMERCIAL MOTELS OR TOURIST CABINS                                                       |      681 | F1            |
| 411  | COMMERCIAL HOTELS                                                                         |      808 | F1            |
| 412  | COMMERCIAL NURSING HOMES & HOSPITALS                                                      |     1000 | F1            |
| 415  | COMMERCIAL MOBILE HOME PARKS                                                              |     2232 | F1            |
| 416  | COMMERCIAL CAMPGROUNDS                                                                    |      770 | F1            |
| 419  | COMMERCIAL OTHER HOUSING                                                                  |     7710 | F1            |
| 420  | COMMERCIAL SMALL RETAIL                                                                   |    10074 | F1            |
| 421  | COMMERCIAL SUPERMARKETS                                                                   |      585 | F1            |
| 422  | COMMERCIAL DISCOUNT & JUNIOR DEPARTMENT STORES                                            |     1016 | F1            |
| 424  | COMMERCIAL FULL LINE DEPARTMENT STORES                                                    |       78 | F1            |
| 425  | COMMERCIAL NEIGHBORHOOD SHOPPING CENTER                                                   |     2876 | F1            |
| 426  | COMMERCIAL COMMUNITY SHOPPING CENTER                                                      |      549 | F1            |
| 427  | COMMERCIAL REGIONAL SHOPPING CENTER                                                       |      157 | F1            |
| 428  | COMMERCIAL CONVENIENCE MARKET                                                             |      500 | F1            |
| 429  | COMMERCIAL OTHER RETAIL STRUCTURES                                                        |    12034 | F1            |
| 430  | COMMERCIAL RESTAURANT, CAFÉ, OR BAR                                                       |     4692 | F1            |
| 431  | COMMERCIAL FRANCHISE-TYPE RESTAURANT                                                      |     2973 | F1            |
| 435  | COMMERCIAL DRIVE-IN RESTAURANT                                                            |      511 | F1            |
| 439  | COMMERCIAL OTHER FOOD SERVICE                                                             |      412 | F1            |
| 440  | COMMERCIAL DRY CLEAN PLANT OR LAUNDRY                                                     |      316 | F1            |
| 441  | COMMERCIAL FUNERAL HOME                                                                   |      849 | F1            |
| 442  | COMMERCIAL MEDICAL CLINIC OR OFFICES                                                      |     4722 | F1            |
| 443  | COMMERCIAL DRIVE-UP / WALK-UP BANK ONLY                                                   |       85 | F1            |
| 444  | COMMERCIAL FULL SERVICE BANKS                                                             |     2239 | F1            |
| 445  | COMMERCIAL SAVINGS AND LOANS                                                              |      279 | F1            |
| 447  | COMMERCIAL OFFICE BUILDING 1 OR 2 STORY                                                   |    12558 | F1            |
| 448  | COMMERCIAL OFFICE O/T 47 WALK-UP                                                          |      162 | F1            |
| 449  | COMMERCIAL OFFICE O/T 47 ELEVATOR                                                         |      652 | F1            |
| 450  | COMMERCIAL CONVENIENCE MARKET WITH GASOLINE SALES                                         |     2354 | F1            |
| 451  | COMMERCIAL CONVENIENCE MARKET / FRANCHISE-TYPE RESTAURANT WITH GASOLINE SALES             |      341 | F1            |
| 452  | COMMERCIAL AUTO SERVICE STATION                                                           |     1190 | F1            |
| 453  | COMMERCIAL CAR WASHES                                                                     |      788 | F1            |
| 454  | COMMERCIAL AUTO SALES & SERVICE                                                           |     3575 | F1            |
| 455  | COMMERCIAL GARAGE                                                                         |     4917 | F1            |
| 456  | COMMERCIAL PARKING LOT OR STRUCTURE                                                       |     8400 | F1            |
| 460  | COMMERCIAL THEATERS                                                                       |      227 | F1            |
| 461  | COMMERCIAL DRIVE-IN THEATERS                                                              |       16 | F1            |
| 462  | GOLF RANGE OR MINIATURE COURSE                                                            |       54 | F1            |
| 463  | COMMERCIAL GOLF COURSE                                                                    |     1062 | F1            |
| 464  | COMMERCIAL BOWLING ALLEY                                                                  |      154 | F1            |
| 465  | COMMERCIAL LODGE HALL OR AMUSEMENT PARK                                                   |      290 | F1            |
| 466  | COMMERCIAL AMUSEMENT PARK                                                                 |       16 | F1            |
| 467  | COMMERCIAL HEALTH CLUB                                                                    |      224 | F1            |
| 468  | COMMERCIAL ICE RINK                                                                       |       12 | F1            |
| 469  | COMMERCIAL RIVERBOAT GAMING RESORT                                                        |       10 | F1            |
| 480  | COMMERCIAL WAREHOUSE                                                                      |     4551 | F1            |
| 481  | COMMERCIAL MINI-WAREHOUSE                                                                 |     2876 | F1            |
| 482  | COMMERCIAL TRUCK TERMINALS                                                                |      186 | F1            |
| 490  | COMMERCIAL MARINE SERVICE FACILITY                                                        |      104 | F1            |
| 495  | COMMERCIAL MARINA                                                                         |       66 | F1            |
| 496  | COMMERCIAL MARINA - SMALL BOATS                                                           |       19 | F1            |
| 498  | COMMERCIAL BUILDING ON LEASED LAND                                                        |      208 | F1            |
| 499  | COMMERCIAL OTHER STRUCTURE                                                                |    22461 | F1            |

Family totals of those feature counts: industrial 3xx 35,741; apartments 401–403 14,146; other commercial 4xx 158,342.

## Commercial universe and freshness

These are separate from any later audit of rows that were loaded. A matching re-read would mean the registry holds the filtered extract. It would not mean every commercial parcel in Indiana is in the file.

**Published denominator.** Unavailable. The service iteminfo, the Hub item `70565d886f1e4528a43a86be6ce5c2f3`, and the Data Harvest access page do not state a statewide count of commercial or industrial parcels. The figures in this record are counts queried from the layer on 2026-11-06, not a number IGIO or DLGF published as the commercial universe.

**What the layer can classify.** 208,229 features, 200,473 distinct `state_parcel_id`, carry a 3-character DLGF class in the 300s or 400s. 58,222 features have a blank class, in every county (the blank-class column below). Those rows are not in the 208,229 and are not known to be commercial or otherwise. 7,756 of the classified features are extra polygons of a `state_parcel_id` already counted (208,229 − 200,473), so a feature count is larger than a parcel count. Large gaps include Tippecanoe (6,073 features, 3,946 ids), Monroe (7,855 / 6,806), Boone (2,537 / 1,853), and Orange (1,508 / 919).

**Marion County.** FIPS 18097 is in the layer (20,771 features, 20,543 distinct ids, `loaddate` 2025-08-24, age 439 days on 2026-11-06). It is excluded from the config's file list and dropped again in the adapter. Indianapolis stays on `in-marion-parcels`, which on 2026-11-03 kept 20,630 parcels from a different layer (IndyGIS) that has owners and assessed values. The two extracts are not the same count and are not both loaded.

**Freshness.** Inside each county, on this query, the minimum `loaddate` equals the maximum, for commercial features and for all features. Age is days from that date to 2026-11-06. The 400-day line falls on 2025-10-02. Four counties are inside it: Bartholomew `18005` (2025-10-27, 375 days), Huntington `18069` (2025-10-27, 375), Jay `18075` (2025-10-20, 382), Owen `18119` (2025-10-27, 375). The other 88 counties are older. The oldest commercial `loaddate` is Miami County `18103`, 2025-07-31, 463 days. The layer `lastEditDate` of 2026-10-06 is not used as the data date. Each loaded page is snapshotted at its county `loaddate`.

Of the 91 counties this source loads, 4 are within 400 days and 87 are not. The source as a whole does not pass a freshness bar of 400 days.

`tax_county` is the publisher's name on the commercial features. Clinton County has 1,261 features named `CLINTON COUNTY` and 25 with a blank `tax_county`.

| County FIPS | Publisher tax_county                | 3xx/4xx features | Distinct state_parcel_id | loaddate   | Age on 2026-11-06 | Blank class, all parcels | Loaded                 |
| ----------- | ----------------------------------- | ---------------: | -----------------------: | ---------- | ----------------: | -----------------------: | ---------------------- |
| 18001       | ADAMS COUNTY                        |             1240 |                     1221 | 2025-08-08 |               455 |                      393 | yes                    |
| 18003       | ALLEN COUNTY                        |             9340 |                     9331 | 2025-08-29 |               434 |                      607 | yes                    |
| 18005       | BARTHOLOMEW COUNTY                  |             1975 |                     1972 | 2025-10-27 |               375 |                     1723 | yes                    |
| 18007       | BENTON COUNTY                       |              395 |                      395 | 2025-08-20 |               443 |                       19 | yes                    |
| 18009       | BLACKFORD COUNTY                    |              503 |                      503 | 2025-08-11 |               452 |                       79 | yes                    |
| 18011       | BOONE COUNTY                        |             2537 |                     1853 | 2025-08-22 |               441 |                      928 | yes                    |
| 18013       | BROWN COUNTY                        |              371 |                      364 | 2025-08-22 |               441 |                      936 | yes                    |
| 18015       | CARROLL COUNTY                      |             1044 |                     1043 | 2025-08-11 |               452 |                      180 | yes                    |
| 18017       | CASS COUNTY                         |             1455 |                     1441 | 2025-08-11 |               452 |                      283 | yes                    |
| 18019       | CLARK COUNTY                        |             4675 |                     4655 | 2025-08-22 |               441 |                      706 | yes                    |
| 18021       | CLAY COUNTY                         |              955 |                      952 | 2025-09-05 |               427 |                       46 | yes                    |
| 18023       | CLINTON COUNTY (1261); (blank) (25) |             1286 |                     1276 | 2025-08-11 |               452 |                     3303 | yes                    |
| 18025       | CRAWFORD COUNTY                     |              278 |                      276 | 2025-08-18 |               445 |                     2320 | yes                    |
| 18027       | DAVIESS COUNTY                      |             1105 |                     1072 | 2025-08-15 |               448 |                      172 | yes                    |
| 18029       | DEARBORN COUNTY                     |             1443 |                     1443 | 2025-08-29 |               434 |                      374 | yes                    |
| 18031       | DECATUR COUNTY                      |              937 |                      926 | 2025-08-01 |               462 |                      318 | yes                    |
| 18033       | DEKALB COUNTY                       |             2252 |                     2252 | 2025-08-26 |               437 |                     2666 | yes                    |
| 18035       | DELAWARE COUNTY                     |             4813 |                     4553 | 2025-08-11 |               452 |                     1235 | yes                    |
| 18037       | DUBOIS COUNTY                       |             2767 |                     2755 | 2025-08-25 |               438 |                      145 | yes                    |
| 18039       | ELKHART COUNTY                      |             7850 |                     7847 | 2025-09-05 |               427 |                      405 | yes                    |
| 18041       | FAYETTE COUNTY                      |              860 |                      852 | 2025-08-19 |               444 |                      100 | yes                    |
| 18043       | FLOYD COUNTY                        |             2883 |                     2354 | 2025-08-12 |               451 |                     1990 | yes                    |
| 18045       | FOUNTAIN COUNTY                     |              667 |                      639 | 2025-08-12 |               451 |                      279 | yes                    |
| 18047       | FRANKLIN COUNTY                     |              576 |                      545 | 2025-08-27 |               436 |                       79 | yes                    |
| 18049       | FULTON COUNTY                       |              937 |                      912 | 2025-08-29 |               434 |                       30 | yes                    |
| 18051       | GIBSON COUNTY                       |              937 |                      928 | 2025-08-12 |               451 |                      158 | yes                    |
| 18053       | GRANT COUNTY                        |             2120 |                     2113 | 2025-08-13 |               450 |                     1005 | yes                    |
| 18055       | GREENE COUNTY                       |             1106 |                     1093 | 2025-08-25 |               438 |                      535 | yes                    |
| 18057       | HAMILTON COUNTY                     |             6195 |                     6190 | 2025-08-08 |               455 |                     2217 | yes                    |
| 18059       | HANCOCK COUNTY                      |             1543 |                     1514 | 2025-08-27 |               436 |                     1134 | yes                    |
| 18061       | HARRISON COUNTY                     |              982 |                      982 | 2025-08-07 |               456 |                      566 | yes                    |
| 18063       | HENDRICKS COUNTY                    |             3648 |                     3166 | 2025-08-12 |               451 |                     5672 | yes                    |
| 18065       | HENRY COUNTY                        |             1283 |                     1281 | 2025-08-14 |               449 |                      150 | yes                    |
| 18067       | HOWARD COUNTY                       |             2652 |                     2648 | 2025-08-27 |               436 |                      233 | yes                    |
| 18069       | HUNTINGTON COUNTY                   |             1491 |                     1476 | 2025-10-27 |               375 |                      214 | yes                    |
| 18071       | JACKSON COUNTY                      |             1514 |                     1498 | 2025-08-28 |               435 |                      109 | yes                    |
| 18073       | JASPER COUNTY                       |             1020 |                     1018 | 2025-08-12 |               451 |                      184 | yes                    |
| 18075       | JAY COUNTY                          |              767 |                      722 | 2025-10-20 |               382 |                      302 | yes                    |
| 18077       | JEFFERSON COUNTY                    |             1206 |                     1201 | 2025-09-10 |               422 |                       61 | yes                    |
| 18079       | JENNINGS COUNTY                     |              666 |                      661 | 2025-09-10 |               422 |                      427 | yes                    |
| 18081       | JOHNSON COUNTY                      |             2958 |                     2958 | 2025-09-05 |               427 |                      546 | yes                    |
| 18083       | KNOX COUNTY                         |             1855 |                     1855 | 2025-08-13 |               450 |                      284 | yes                    |
| 18085       | KOSCIUSKO COUNTY                    |             3760 |                     3760 | 2025-09-03 |               429 |                      194 | yes                    |
| 18087       | LAGRANGE COUNTY                     |             1313 |                     1308 | 2025-08-18 |               445 |                      236 | yes                    |
| 18089       | LAKE COUNTY                         |            15020 |                    14961 | 2025-08-19 |               444 |                     1847 | yes                    |
| 18091       | LAPORTE COUNTY                      |             3364 |                     3359 | 2025-08-12 |               451 |                      346 | yes                    |
| 18093       | LAWRENCE COUNTY                     |             1530 |                     1524 | 2025-08-28 |               435 |                      968 | yes                    |
| 18095       | MADISON COUNTY                      |             5385 |                     5373 | 2025-08-28 |               435 |                      561 | yes                    |
| 18097       | MARION COUNTY                       |            20771 |                    20543 | 2025-08-24 |               439 |                       68 | no (in-marion-parcels) |
| 18099       | MARSHALL COUNTY                     |             2207 |                     1697 | 2025-08-12 |               451 |                      680 | yes                    |
| 18101       | MARTIN COUNTY                       |              426 |                      421 | 2025-08-12 |               451 |                      203 | yes                    |
| 18103       | MIAMI COUNTY                        |             1229 |                     1221 | 2025-07-31 |               463 |                      552 | yes                    |
| 18105       | MONROE COUNTY                       |             7855 |                     6806 | 2025-08-20 |               443 |                     1703 | yes                    |
| 18107       | MONTGOMERY COUNTY                   |             1274 |                     1267 | 2025-08-29 |               434 |                      175 | yes                    |
| 18109       | MORGAN COUNTY                       |             1555 |                     1546 | 2025-08-13 |               450 |                     1170 | yes                    |
| 18111       | NEWTON COUNTY                       |              752 |                      752 | 2025-08-29 |               434 |                      404 | yes                    |
| 18113       | NOBLE COUNTY                        |             1532 |                     1532 | 2025-08-26 |               437 |                      681 | yes                    |
| 18115       | OHIO COUNTY                         |              162 |                      157 | 2025-08-29 |               434 |                       18 | yes                    |
| 18117       | ORANGE COUNTY                       |             1508 |                      919 | 2025-08-12 |               451 |                     1045 | yes                    |
| 18119       | OWEN COUNTY                         |              470 |                      467 | 2025-10-27 |               375 |                      114 | yes                    |
| 18121       | PARKE COUNTY                        |              746 |                      735 | 2025-08-28 |               435 |                       68 | yes                    |
| 18123       | PERRY COUNTY                        |              797 |                      770 | 2025-09-10 |               422 |                     1572 | yes                    |
| 18125       | PIKE COUNTY                         |              552 |                      548 | 2025-08-28 |               435 |                       59 | yes                    |
| 18127       | PORTER COUNTY                       |             4163 |                     4127 | 2025-08-22 |               441 |                      755 | yes                    |
| 18129       | POSEY COUNTY                        |              904 |                      881 | 2025-08-28 |               435 |                       50 | yes                    |
| 18131       | PULASKI COUNTY                      |              822 |                      821 | 2025-08-28 |               435 |                       23 | yes                    |
| 18133       | PUTNAM COUNTY                       |              904 |                      901 | 2025-09-05 |               427 |                       71 | yes                    |
| 18135       | RANDOLPH COUNTY                     |              991 |                      984 | 2025-08-28 |               435 |                       63 | yes                    |
| 18137       | RIPLEY COUNTY                       |              962 |                      941 | 2025-09-10 |               422 |                      652 | yes                    |
| 18139       | RUSH COUNTY                         |              658 |                      559 | 2025-08-28 |               435 |                      335 | yes                    |
| 18141       | ST. JOSEPH COUNTY                   |             7537 |                     7392 | 2025-08-27 |               436 |                      547 | yes                    |
| 18143       | SCOTT COUNTY                        |              748 |                      748 | 2025-08-27 |               436 |                       85 | yes                    |
| 18145       | SHELBY COUNTY                       |             1556 |                     1551 | 2025-09-02 |               430 |                      318 | yes                    |
| 18147       | SPENCER COUNTY                      |              817 |                      813 | 2025-08-27 |               436 |                      867 | yes                    |
| 18149       | STARKE COUNTY                       |              747 |                      737 | 2025-08-27 |               436 |                       27 | yes                    |
| 18151       | STEUBEN COUNTY                      |             1837 |                     1834 | 2025-08-27 |               436 |                      520 | yes                    |
| 18153       | SULLIVAN COUNTY                     |             1014 |                      986 | 2025-08-28 |               435 |                      202 | yes                    |
| 18155       | SWITZERLAND COUNTY                  |              235 |                      219 | 2025-08-28 |               435 |                      109 | yes                    |
| 18157       | TIPPECANOE COUNTY                   |             6073 |                     3946 | 2025-08-29 |               434 |                     1594 | yes                    |
| 18159       | TIPTON COUNTY                       |              580 |                      579 | 2025-08-12 |               451 |                      343 | yes                    |
| 18161       | UNION COUNTY                        |              225 |                      201 | 2025-08-27 |               436 |                      202 | yes                    |
| 18163       | VANDERBURGH COUNTY                  |             5539 |                     5539 | 2025-08-29 |               434 |                       11 | yes                    |
| 18165       | VERMILLION COUNTY                   |              519 |                      504 | 2025-08-28 |               435 |                      233 | yes                    |
| 18167       | VIGO COUNTY                         |             4449 |                     4364 | 2025-09-09 |               423 |                     3516 | yes                    |
| 18169       | WABASH COUNTY                       |             1108 |                     1107 | 2025-08-11 |               452 |                      128 | yes                    |
| 18171       | WARREN COUNTY                       |              375 |                      375 | 2025-08-28 |               435 |                      350 | yes                    |
| 18173       | WARRICK COUNTY                      |             1971 |                     1966 | 2025-08-29 |               434 |                      307 | yes                    |
| 18175       | WASHINGTON COUNTY                   |              628 |                      623 | 2025-08-29 |               434 |                       66 | yes                    |
| 18177       | WAYNE COUNTY                        |             2317 |                     2305 | 2025-09-04 |               428 |                      267 | yes                    |
| 18179       | WELLS COUNTY                        |              971 |                      805 | 2025-08-12 |               451 |                      453 | yes                    |
| 18181       | WHITE COUNTY                        |             1299 |                     1278 | 2025-08-20 |               443 |                      237 | yes                    |
| 18183       | WHITLEY COUNTY                      |              985 |                      985 | 2025-08-12 |               451 |                      114 | yes                    |

## Real run (2026-11-06)

Collected with the unverified config (`--include-unverified`). The collector exited 0. The manifest lists 141 pages, all `archived`, 75,059,725 bytes, `checked_at` from 2026-11-06T23:09:30Z through 2026-11-06T23:14:11Z. The pages sum to 187,458 features in 91 counties. No feature has `county_fips` 18097. Every class code is a 3xx or 4xx code. No page is shorter than 2,000 features with `exceededTransferLimit` true.

Loaded with `python -m factlot.registry.adapters.in_statewide collected/in-statewide-parcels <scratch.db> --as-of 2026-11-06`. The fallback date was not used. Each page's snapshot `as_of` is that page's `loaddate`.

|                                   |         |
| --------------------------------- | ------: |
| Rows the adapter yielded (`seen`) | 179,930 |
| Parcels kept                      | 179,930 |
| Out of scope                      |       0 |
| Invalid ids                       |       0 |
| Owners withheld                   |       0 |
| Facts written                     | 719,613 |
| Retired                           |       0 |
| Errors                            |       0 |

Kept parcels by registry slot, one row per `state_parcel_id`: F1 137,524, F2 30,838, B 11,568. Situs present on 179,823 parcels; 107 have neither street. Owner facts: 0.

The 7,528 extra features (187,458 − 179,930) are further polygons of a `state_parcel_id` already kept. 1,764 of those parcels also appear on a later page (2,067 extra page-rows). The directory re-read equals the registry. A per-file re-read differs on 41 pages for that reason. Detail, the per-county kept counts, and the audit JSON are in [`docs/registry/quality/surge-2026-11/in-statewide-parcels.md`](../quality/surge-2026-11/in-statewide-parcels.md).

## Gates

`verified` stays false until a person signs off on the terms reading above. The collector skips an unverified source unless `--include-unverified` is passed. No click-through, captcha, or purchase was required for the FeatureServer query. The Data Harvest download site was not used.

## Known gaps

- No owner, assessed value, market value, year built, building area, or land area in the fields this adapter can read.
- 58,222 features have no DLGF class, so any commercial parcel the county left uncoded is outside this extract. That is why the loaded count is not a commercial universe.
- Apartment code 401 is the DLGF class for 4–19 family apartments, so a 4-family building is in the multifamily slot.
- Code 395 (1 feature) is not in the manual list read on 2026-11-06. It is kept as industrial because it is a 3xx code.
- 87 of the 91 loaded counties have `loaddate` more than 400 days before 2026-11-06.
- Marion County commercial parcels in this layer are not loaded here.
