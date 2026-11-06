# fl-dor-nal: Florida Department of Revenue NAL (Name-Address-Legal) rolls

Review record for the FactLot Registry (data policy §5). Reviewed 2026-11-02. **verified: false**
(see "Terms" below for the one open question). Config: `registry/sources/fl/fl-dor-nal.json`; adapter:
`python/src/factlot/registry/adapters/fl_dor.py`; tests: `python/tests/test_adapter_fl_dor.py`.

## Publisher and URLs

- Publisher: Florida Department of Revenue, Property Tax Oversight (PTO). Under ss. 193.114 and
  193.1142, F.S., every county property appraiser submits its real property assessment roll to the
  Department, which checks it and republishes it in one statewide layout. One source therefore
  covers all 67 counties; the six largest are configured (Miami-Dade 12086, Broward 12011, Palm
  Beach 12099, Orange 12095, Hillsborough 12057, Duval 12031).
- Landing page: <https://floridarevenue.com/property/Pages/DataPortal_RequestAssessmentRollGISData.aspx>
  ("Download Assessment Roll and GIS Data").
- File library: a SharePoint document library,
  `https://floridarevenue.com/property/dataportal/Documents/PTO Data Portal/Tax Roll Data Files/`,
  with subfolders `NAL`, `NAL-EDR`, `NAP` (tangible personal property), `NAV`, `SDF` (sales).
  `NAL/<year>F` holds the final rolls, `NAL/<year>P` the preliminary (July) rolls. On 2026-11-02
  `NAL/2026F` held 62 county files and `NAL/2026P` 5 (the counties whose final roll is not yet in;
  Jackson's entry in `2026F` is an SDF file, not a NAL).
- File URL pattern (spaces percent-encoded):
  `https://floridarevenue.com/property/dataportal/Documents/PTO%20Data%20Portal/Tax%20Roll%20Data%20Files/NAL/2026F/<County>%20<nn>%20Final%20NAL%202026.zip`
  where `<nn>` is the Department's county number (Dade 23, Broward 16, Palm Beach 60, Orange 58,
  Hillsborough 39, Duval 26). Miami-Dade is filed as "Dade".
- Layout document: _2026 User's Guide, Department Property Tax Data Files_ (PDF, 283,728 bytes),
  `.../User%20Guides/2026%20Users%20guide%20and%20quick%20reference/2026_NAL_SDF_NAP_Users_Guide.pdf`,
  with a field-list workbook `2026_Users_Guide_Quick_Reference.xlsx` beside it. Archived with the
  rolls as `fl:document:sha256-b0fdce41b212324c5c3c430c4c75e21d77ed4003cd42ecc343ce4c27ec0359c4`.
- Listing the library: the library pages are script-rendered, so the collector's `discover` reads
  no file links from them. The SharePoint REST endpoint lists files when asked for JSON:
  `GET /property/dataportal/_api/web/GetFolderByServerRelativeUrl('/property/dataportal/Documents/PTO%20Data%20Portal/Tax%20Roll%20Data%20Files/NAL/2026F')/Files?$select=Name,ServerRelativeUrl,Length,TimeLastModified&$top=500`
  with `Accept: application/json;odata=nometadata`. Without that header (which the collector cannot
  send) it answers Atom XML, so the file list in the config was taken by hand from this endpoint
  and each URL confirmed by a real download. `TimeLastModified` in the listing (and `Last-Modified`
  on the file) is the as-of date to pass to the adapter.
- Prior years: not in the library; the page says prior rolls are "available by request only"
  (PTOTechnology@floridarevenue.com) and "Requests for large amounts of data may incur a fee."

## Terms, license, robots

- robots.txt (<https://floridarevenue.com/robots.txt>): "Allow all robots but restrict access to
  certain file structures". Disallow rules exist only for the `PowerMapper` and `SortSite` agents;
  there is no `User-agent: *` block, so the FactLot bot is unrestricted. The collector confirmed
  this (`robots_allowed: true` on every URL in the manifest).
- Public-record status (landing page, quoted): "The Department of Revenue publishes assessment
  rolls in compliance with chapter 119, Florida Statutes. The files publicly available through the
  Department and county property appraisers do not contain confidential records, such as social
  security numbers and the records of property owners exempt from public records disclosure under
  section 119.071, Florida Statutes." The user's guide repeats this (Introduction, p. ii).
- Privacy notice (<https://floridarevenue.com/Pages/privacy.aspx>): "Information obtained by Revenue
  is considered a public record by law, and it must be disclosed upon request", citing ss. 119.07,
  119.071 and 119.0714. For copyright and terms it refers to "the Conditions of Use found at
  MyFlorida.com".
- Conditions of Use (<https://floridarevenue.com/Pages/conditions.aspx>, the Department's copy of
  the MyFlorida.com conditions, which it names as its terms): material on the site "may be
  downloaded on any single personal computer, for non-commercial use only", and may not be
  "copied, reproduced, republished, uploaded, posted, transmitted, or distributed in any way". It
  does not mention public records, AI use, or the data portal.
- Open Government page (<https://floridarevenue.com/opengovt/Pages/public_records.aspx>): states the
  right of access under s. 119.07(1), lists what the Department treats as confidential (taxpayer
  financial records, child support records, and so on), and says nothing about reuse.
- **Why `verified: false`.** The roll files are public records that the Department publishes for
  download under chapter 119, and Florida courts have held that a property appraiser cannot
  restrict commercial use of its roll data or claim copyright in it without a statute saying so
  (Microdecisions, Inc. v. Skinner, 889 So. 2d 871 (Fla. 2d DCA 2004), about Collier County's GIS
  parcel data). But the publisher's own stated terms say "non-commercial use only" and forbid
  redistribution of "material" from the site, and an unclear license stays unverified under the
  data policy. Open point: whether chapter 119 governs the roll files rather than the website
  boilerplate (or PTO confirms it); until then the source stays `verified: false`. AI use is not addressed
  anywhere. Attribution to use: "Florida Department of Revenue, Property Tax Oversight".
- Note for whoever decides: the files are served to anyone without a login, agreement, or
  click-through; nothing was accepted to obtain them, and the collector identified itself.

## What the file contains

One zip per county, holding one comma-delimited CSV with a header row, `NAL<nn>F<year>01.csv`
(for example `NAL73F202601.csv`), CRLF line endings, plain ASCII in the sample read (the adapter
decodes Latin-1, which cannot fail). 167 columns, one row per real property parcel (`FILE_T` = `R`),
as documented field by field in the user's guide. Columns the adapter uses:

| Column                                                                     | Guide field                                                        | Used as                                                                                                                                                                                                                                                      |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `CO_NO`                                                                    | 1, Department county number 11–77                                  | county FIPS via the table in the adapter (`2 × (n − 11) + 1`, Miami-Dade 23 → 086)                                                                                                                                                                           |
| `PARCEL_ID`                                                                | 2, the appraiser's parcel number, up to 26 alphanumerics           | `apn`, `account` (`fl_parcel_id` crosswalk), locator                                                                                                                                                                                                         |
| `ASMNT_YR`                                                                 | 4                                                                  | `tax_year`                                                                                                                                                                                                                                                   |
| `DOR_UC`                                                                   | 8, DOR land use code 000–099                                       | `local_use_code` and the category mapping below                                                                                                                                                                                                              |
| `JV`                                                                       | 11, just value (s. 193.011 market value)                           | `market_value`                                                                                                                                                                                                                                               |
| `AV_NSD`                                                                   | 15, assessed value, non-school                                     | `appraised_value`                                                                                                                                                                                                                                            |
| `LND_SQFOOT`                                                               | 44, land square footage (blank for condominiums, co-ops, HOA land) | `land_area_sf`; when blank or 0, `NO_LND_UNTS` (43) if `LND_UNTS_CD` (42) is `2` = square feet. Acre entries (`1`) are not converted: the guide allows a whole number to mean a two-decimal figure (Union's `40` beside `LND_SQFOOT` 17424 means 0.40 acres) |
| `ACT_YR_BLT`                                                               | 49, actual year built                                              | `year_built` (`EFF_YR_BLT` is not used)                                                                                                                                                                                                                      |
| `TOT_LVG_AREA`                                                             | 50, total effective area of all improvements                       | `improvement_area_sf` (an effective area: base area plus factored secondary areas, so not a gross building area)                                                                                                                                             |
| `OWN_NAME`, `OWN_ADDR1`, `OWN_ADDR2`, `OWN_CITY`, `OWN_STATE`, `OWN_ZIPCD` | 74–79                                                              | owner of record and mailing address (`OWN_STATE` may hold a country; `OWN_ZIPCD` is blank outside the US and, in Union, blank throughout)                                                                                                                    |
| `PHY_ADDR1`, `PHY_ADDR2`, `PHY_CITY`, `PHY_ZIPCD`                          | 99–102                                                             | situs `"<addr1> <addr2>, <city> FL <zip>"`; no `PHY_ADDR1` means no situs                                                                                                                                                                                    |

Not used but present: stratification fields, the 18 classified-use value pairs, two merged sales
(`SALE_PRC1`, `QUAL_CD1`, …, from the SDF), `S_LEGAL`, `TWN`/`RNG`/`SEC`, `CENSUS_BK` (16-digit block
group), `PUBLIC_LND`, 51 exemption value columns (`EXMPT_01`–`EXMPT_82`), `NO_RES_UNTS`,
`NO_BULDNG`, `STATE_PAR_ID` (the Department's uniform parcel ID, e.g. `C73-000-912-3948-3`), and
the blank fiduciary columns. `PA_UC` (field 9) is the county's own finer use code, undocumented
by the Department, and is not used.

### Use-code mapping

From the "DOR Land Use Code" table, field 8, pages 5–7 of the 2026 user's guide (the guide groups
the codes as Residential 000–009, Commercial 003 and 010–039, Industrial 040–049, Agricultural
050–069, Institutional 070–079, Governmental 080–089, Miscellaneous 090–097, Centrally assessed 098,
Non-agricultural acreage 099). The Department's own stratum 06, "Improved commercial and industrial
property (including multi-family residential with 10 units or more)", is 003, 011–039 and 041–049,
which is exactly the F1/F2/B(003) set below.

| DOR code   | Department definition                                                                                                                                                                                                                                                | FactLot                                    |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| 003        | Multi-family - 10 units or more                                                                                                                                                                                                                                      | B                                          |
| 008        | Multi-family - fewer than 10 units (Residential group)                                                                                                                                                                                                               | B                                          |
| 011        | Stores, one story                                                                                                                                                                                                                                                    | F1                                         |
| 012        | Mixed use - store and office or store and residential combination                                                                                                                                                                                                    | F1                                         |
| 013        | Department Stores                                                                                                                                                                                                                                                    | F1                                         |
| 014        | Supermarkets                                                                                                                                                                                                                                                         | F1                                         |
| 015        | Regional Shopping Centers                                                                                                                                                                                                                                            | F1                                         |
| 016        | Community Shopping Centers                                                                                                                                                                                                                                           | F1                                         |
| 017        | Office buildings, non-professional service buildings, one story                                                                                                                                                                                                      | F1                                         |
| 018        | Office buildings, non-professional service buildings, multi-story                                                                                                                                                                                                    | F1                                         |
| 019        | Professional service buildings                                                                                                                                                                                                                                       | F1                                         |
| 020        | Airports (private or commercial), bus terminals, marine terminals, piers, marinas                                                                                                                                                                                    | F1                                         |
| 021        | Restaurants, cafeterias                                                                                                                                                                                                                                              | F1                                         |
| 022        | Drive-in Restaurants                                                                                                                                                                                                                                                 | F1                                         |
| 023        | Financial institutions (banks, saving and loan companies, mortgage companies, credit services)                                                                                                                                                                       | F1                                         |
| 024        | Insurance company offices                                                                                                                                                                                                                                            | F1                                         |
| 025        | Repair service shops (excluding automotive), radio and T.V. repair, refrigeration service, electric repair, laundries, Laundromats                                                                                                                                   | F1                                         |
| 026        | Service stations                                                                                                                                                                                                                                                     | F1                                         |
| 027        | Auto sales, auto repair and storage, auto service shops, body and fender shops, commercial garages, farm and machinery sales and services, auto rental, marine equipment, trailers and related equipment, mobile home sales, motorcycles, construction vehicle sales | F1                                         |
| 028        | Parking lots (commercial or patron), mobile home parks                                                                                                                                                                                                               | F1                                         |
| 029        | Wholesale outlets, produce houses, manufacturing outlets                                                                                                                                                                                                             | F1                                         |
| 030        | Florists, greenhouses                                                                                                                                                                                                                                                | F1                                         |
| 031        | Drive-in theaters, open stadiums                                                                                                                                                                                                                                     | F1                                         |
| 032        | Enclosed theaters, enclosed auditoriums                                                                                                                                                                                                                              | F1                                         |
| 033        | Nightclubs, cocktail lounges, bars                                                                                                                                                                                                                                   | F1                                         |
| 034        | Bowling alleys, skating rinks, pool halls, enclosed arenas                                                                                                                                                                                                           | F1                                         |
| 035        | Tourist attractions, permanent exhibits, other entertainment facilities, fairgrounds (privately owned)                                                                                                                                                               | F1                                         |
| 036        | Camps                                                                                                                                                                                                                                                                | F1                                         |
| 037        | Race tracks (horse, auto, or dog)                                                                                                                                                                                                                                    | F1                                         |
| 038        | Golf courses, driving ranges                                                                                                                                                                                                                                         | F1                                         |
| 039        | Hotels, motels                                                                                                                                                                                                                                                       | F1                                         |
| 041        | Light manufacturing, small equipment manufacturing plants, small machine shops, instrument manufacturing, printing plants                                                                                                                                            | F2                                         |
| 042        | Heavy industrial, heavy equipment manufacturing, large machine shops, foundries, steel fabricating plants, auto or aircraft plants                                                                                                                                   | F2                                         |
| 043        | Lumber yards, sawmills, planing mills                                                                                                                                                                                                                                | F2                                         |
| 044        | Packing plants, fruit and vegetable packing plants, meat packing plants                                                                                                                                                                                              | F2                                         |
| 045        | Canneries, fruit and vegetable, bottlers and brewers, distilleries, wineries                                                                                                                                                                                         | F2                                         |
| 046        | Other food processing, candy factories, bakeries, potato chip factories                                                                                                                                                                                              | F2                                         |
| 047        | Mineral processing, phosphate processing, cement plants, refineries, clay plants, rock and gravel plants                                                                                                                                                             | F2                                         |
| 048        | Warehousing, distribution terminals, trucking terminals, van and storage warehousing                                                                                                                                                                                 | F2                                         |
| 049        | Open storage, new and used building supplies, junk yards, auto wrecking, fuel storage, equipment and material storage                                                                                                                                                | F2                                         |
| 010, 040   | Vacant Commercial / Vacant Industrial - with/without extra features                                                                                                                                                                                                  | out of scope (vacant land, as Texas C1 is) |
| all others | residential, agricultural, institutional, governmental, miscellaneous, centrally assessed, acreage                                                                                                                                                                   | out of scope                               |

Owner handling: the Department strips owners exempt under s. 119.071 before publishing, so there
is no confidentiality flag. The adapter still maps a placeholder name (`CONFIDENTIAL`, `NAME
WITHHELD`, `... 119.071 ...`) to `owner_confidential=True` and `UNKNOWN` / `CURRENT OWNER` to no
owner; none of either appeared in the Union sample. Natural persons pass through the adapter and
are dropped by the registry at ingest (data policy §3).

## Gates (anything that needs a person)

- No account, login, click-through, CAPTCHA, or fee stands between the bot and the files.
- **Decision needed:** whether the site's Conditions of Use ("non-commercial use only", no
  redistribution) yield to chapter 119 for the roll files (see "Terms"). Until then
  `verified: false`; the real run below used `--include-unverified`.
- Prior-year rolls need an e-mail request to PTOTechnology@floridarevenue.com (possible fee).
- Throughput: the host streamed at about 12–35 KB/s to the collector on 2026-11-02 and once
  stalled past the collector's 600-second read timeout, so the six target files (262 MB in all,
  Miami-Dade 60 MB alone) take hours, not minutes. The run was therefore done on a sample.

### Terms read 2026-11-03

**Download Assessment Roll and GIS Data.** https://floridarevenue.com/property/Pages/DataPortal_RequestAssessmentRollGISData.aspx — read 2026-11-03, HTTP 200. The saved page names the file "real property roll (Name – Address – Legal, or NAL)". Opening line of the chapter 119 sentence:

> The Department of Revenue publishes assessment rolls in compliance with

The next line begins "chapter 119, Florida Statutes." A capture read 2026-11-02 gives that opening as one line: "The Department of Revenue publishes assessment rolls in compliance with chapter 119, Florida". The same capture includes "property owners exempt from public records disclosure under section 119.071, Florida Statutes."

Request route on the page read 2026-11-03:

> to PTOTechnology@floridarevenue.com, by fax at 850-488-9482, or by regular mail to PTO's general mailing address (Property Tax Oversight, Florida Department of Revenue, 5050 W. Tennessee St., Tallahassee, FL 32399-0100).

**Conditions of Use.** https://floridarevenue.com/Pages/conditions.aspx — read 2026-11-02. Section I includes:

> No material from MyFlorida.com or any Web site owned, operated, licensed or controlled by THE

> or distributed in any way. Materials may be downloaded on any single personal computer, for

> non-commercial use only providing all copyright and other proprietary notices are kept intact.

**Privacy page.** https://floridarevenue.com/Pages/privacy.aspx — read 2026-11-02.

> Information obtained by Revenue is considered a public record by law, and it must be disclosed

> upon request unless specifically confidential and exempt from disclosure by law.

**Property Tax Oversight contact.** https://floridarevenue.com/property/Pages/contactUs.aspx — read 2026-11-03, HTTP 200. The page lists "Post Office Box 3000" and "Tallahassee, Florida 32315-3000". "Email Your Question" is a form link. No general mailbox is printed there.

**Statute.** Section 119.01(1), Florida Statutes (2026), https://www.leg.state.fl.us/statutes/index.cfm?App_mode=Display_Statute&URL=0100-0199/0119/Sections/0119.01.html — read 2026-11-02.

> It is the policy of this state that all state, county, and municipal records are open for

> personal inspection and copying by any person. Providing access to public records is a duty of

Section 119.07(1)(a), https://www.leg.state.fl.us/statutes/index.cfm?App_mode=Display_Statute&URL=0100-0199/0119/Sections/0119.07.html — read 2026-11-02.

> Every person who has custody of a public record shall permit the record to be inspected and

> and under supervision by the custodian of the public records.

As captured, neither section says anything about commercial use or redistribution of records once obtained. On those two sections the statute is silent on commercial use and silent on redistribution after the copy is obtained.

The Conditions of Use restrict copying and distribution of site material and limit a download to non-commercial use on one personal computer. They do not name the assessment rolls. The portal says the rolls are published in compliance with chapter 119. Those two writings do not, together, state a clear right to redistribute the NAL public fields. The source stays `verified: false` until the Department confirms the terms in writing. No letter was sent.

## Real run (2026-11-02)

Sample county, because of the throughput above: **Union County (DOR 73, FIPS 12125)**, the
smallest 2026 final NAL file, `Union 73 Final NAL 2026.zip` (620,184 bytes, library
`TimeLastModified` 2026-10-15), `NAL73F202601.csv` 3,545,972 bytes,
`fl:document:sha256-08ea5005d513ed1a6accd23307adfe5f7931ab07912a398bc9edfcb8cf33056c`.

- Rows read: 7,157 (every row `FILE_T` R, `ASMNT_YR` 2026, `CO_NO` 73).
- Parcels kept: 148 — B 16 (003: 15, 008: 1), F1 114, F2 18. Out of scope: 7,009 (001 single
  family 1,491; 002 mobile homes 1,306; 055 timberland 1,288; 000 vacant residential 678; 060
  grazing 621; 010 vacant commercial 34; and so on).
- Facts written: 1,634; organisation owners stored: 80; owners that were persons or withheld: 68
  (all persons; nothing withheld); parcels without situs 0, without land area 0, without
  improvement area 3, without year built 3; invalid parcel IDs 0.
- Seconds: 0.22 for `build()` (the whole file: read, map, ingest into a fresh registry).
- The same file was fetched twice: once with curl (resumable, to work around the stall) for the
  layout check and this run, and once by the collector into `collected/fl-dor-nal/` so the manifest
  records it; both copies have the SHA-256 above. The collector's run continues through Duval,
  Orange, Hillsborough, Palm Beach, Broward and Miami-Dade in that order; whatever it archives is
  in `collected/fl-dor-nal/manifest.jsonl` and can be ingested with
  `python -m factlot.registry.adapters.fl_dor <zip> registry.db --as-of <TimeLastModified date>`.

## Known gaps

- Only one sample county was run end to end; the six target counties were not ingested in this
  session (throughput). The adapter is county-agnostic, so no code change is needed for them.
- 008 (multifamily, fewer than 10 units) is mapped to B on the publisher's class, so duplexes and
  triplexes are in scope; `NO_RES_UNTS` could filter to 5+ units but `ParcelRecord` has no unit
  count field.
- `TOT_LVG_AREA` is an effective area, not gross; `LND_SQFOOT` is blank for condominiums and
  co-ops (each condominium unit is its own parcel, use code 004, out of scope anyway).
- Acre-based `NO_LND_UNTS` is not converted to square feet (ambiguous whole-number entries).
- `OWN_ZIPCD` is blank throughout the Union file (the guide requires a five-digit ZIP); other
  counties may fill it. `OWN_STATE` can be a country name.
- Only the primary owner is published (`OWN_NAME`, 50 characters, truncated: "WEYERHAEUSER FOREST
  HOLDING, I"); co-owners appear only as a trailing "&".
- The source's `county_fips` is NULL (statewide); the registry's per-source county column cannot
  express "several counties". `build()` defaults to `full_roll=False` so one county's file does
  not retire the others' parcels; the retirement logic is per source, so a stale county cannot be
  retired without ingesting every county in one snapshot.
- `--include-unverified` was needed for the collector run; flip `verified` after the terms
  decision so the weekly run picks the source up.
- The landing-page JSON listing in the config returns Atom XML to the collector (no `Accept`
  header), so `discover` finds 0 links; a collector option to send `Accept: application/json`
  would make the library discoverable.
