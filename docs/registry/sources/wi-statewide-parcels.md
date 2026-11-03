# wi-statewide-parcels: Wisconsin Statewide Parcel Map Initiative (V12), all counties incl. Milwaukee (FIPS 55079)

Reviewed 2026-11-03. Machine-readable copy: [`registry/sources/wi/wi-statewide-parcels.json`](../../../registry/sources/wi/wi-statewide-parcels.json).
Adapter: `factlot.registry.adapters.wi_statewide` (account system `wi_parcelid`, `<county FIPS>:<the county's parcel id>`).

**Status: `verified: true`.** One review clears all 72 Wisconsin counties: the State Cartographer's Office and the
Department of Administration aggregate every county's parcel and tax-roll data once a year. The publisher states no
licence, only that the data is "free"; the registry treats that as no restriction (see Terms). Milwaukee County is
the Tier 2 county; since the statewide extension of 2026-11-03 the config lists all 72 counties.

## Publisher and URLs

- Publisher: Wisconsin State Cartographer's Office (UW-Madison) and the Wisconsin Department of Administration,
  Wisconsin Land Information Program (WLIP), under 2013 Wisconsin Act 20. Contacts: `help@sco.wisc.edu`, `wlip@wisconsin.gov`.
- Data page: <https://www.sco.wisc.edu/parcels/data/> (V12 released 2026-06-30; V13 tentatively 2027-06-30). Project
  page: <https://doa.wi.gov/Pages/LocalGovtsGrants/Parcel-Initiative.aspx>.
- Statewide file geodatabase (not used): `https://web.s3.wisc.edu/parcels/v12_parcels/V12.0.0_Wisconsin_Parcels_2026_10.3_Compressed.zip`
  (HEAD 200, 515,810,191 bytes, Last-Modified 2026-06-30, `accept-ranges: bytes`) and the 759,926,092-byte uncompressed
  zip. Both exceed the 50 MB research limit and need GDAL or ArcGIS to read. County shapefile/gdb downloads also exist.
- Schema: <https://www.sco.wisc.edu/parcels/data/assets/V12/V12_Wisconsin_Statewide_Parcels_Schema_Documentation.pdf>
  (1.7 MB, read in full).
- Live service used: `https://services3.arcgis.com/n6uYoouQZW75n5WI/arcgis/rest/services/Wisconsin_Statewide_Parcels_DB/FeatureServer/0`
  (ArcGIS Online item `2386813b23ea4e51a009f7d1d6b76e02`; layer `V1200_WisconsinParcels_2026`; 3,574,646 parcels;
  `maxRecordCount` 2000; JSON, GeoJSON and PBF output).

## Terms, license, robots

- **Terms.** No licence or terms of use. The data page: "This data is provided free of charge, however, if you use
  Wisconsin's parcel data, we ask that you please complete the parcel feedback form, to tell us how/why you use the data."
  The ArcGIS item's `licenseInfo`: "This data free for public consumption as of: 06/30/2026". The data-access modal says
  only: "No warranty, expressed or implied, is made regarding accuracy, completeness, or legality of the information
  herein." Nothing addresses redistribution or AI use. The feedback form is a request, not a condition; a courtesy
  attribution is carried in the Source record.
- **Why verified.** The data is a statutory statewide aggregation of public records, offered free to the public with no
  restriction stated. This is the same footing as `mn-hennepin-assessor` (public government data, disclaimer only). If a
  person wants an express statement, ask WLIP (`wlip@wisconsin.gov`); this is a confirmation, not a gate.
- **robots.txt.** `www.sco.wisc.edu`: `User-agent: *` with `Disallow: /wp-admin/` and `/wp-login.php` only. `web.s3.wisc.edu`:
  none (S3 `NoSuchBucket` 404). `services3.arcgis.com`: none. `discover` reported the data page `ok`.

## What the file contains

One feature per parcel; the service is queried with `returnGeometry=false`, `orderByFields=OBJECTID`,
`resultOffset`/`resultRecordCount=2000` and the `outFields` listed in the config. Columns read (schema documentation):
`STATEID`, `PARCELID`, `TAXPARCELID`, `TAXROLLYEAR`, `OWNERNME1`, `OWNERNME2`, `PSTLADRESS` (owner mailing address, one line),
`SITEADRESS`, `PLACENAME`, `ZIPCODE`, `CNTASSDVALUE`, `LNDVALUE`, `IMPVALUE`, `ESTFMKVALUE`, `PROPCLASS`, `AUXCLASS`,
`ASSDACRES`, `DEEDACRES`, `GISACRES`, `CONAME`, `LOADDATE`, `PARCELFIPS` (3-digit county FIPS), `PARCELSRC`.

| `PROPCLASS` (Wis. Stat. 70.32(2)(a)) | Meaning                                                                               | FactLot      |
| ------------------------------------ | ------------------------------------------------------------------------------------- | ------------ |
| `2`                                  | Commercial (market value basis)                                                       | F1           |
| `3`                                  | Manufacturing                                                                         | F2           |
| `1`, `4`, `5`, `5M`, `6`, `7`        | Residential, agricultural, undeveloped, agricultural forest, productive forest, other | out of scope |
| blank (+ `AUXCLASS` X1-X4, W1-W9)    | Tax-exempt or managed-forest parcels                                                  | out of scope |

A parcel with several classes lists them comma separated (`1,2`); it is commercial when `2` is among them. **Wisconsin has no
multifamily class**: apartment buildings are class 2, so they load as F1 and cannot be told from other commercial property
(no unit counts in the layer). The publisher's code is kept in `local_use_code`.

Owner names: present for most counties. Kenosha County redacts 100 % (`NOT AVAILABLE`); Barron, Brown, Columbia, Crawford, Dane
(11.43 %), Manitowoc, Sheboygan and Vilas redact in part. The adapter maps `NOT AVAILABLE` to `owner_confidential`. Milwaukee
County's names are cut to about 28 characters (`WASTE MANAGEMENT OF WISCONSI`). `ESTFMKVALUE` is the estimated fair market
value; `CNTASSDVALUE` the total assessed value; the roll year is `TAXROLLYEAR` (2025 for most counties in V12).

## Gates

None for the data. Only a courtesy: the publisher asks users to fill in its feedback form (<https://www.sco.wisc.edu/parcels/data/>).

## Real run

Milwaukee County (`CONAME='MILWAUKEE'`, `PROPCLASS` containing 2 or 3), collector `snapshot` of 9 pages on 2026-11-03
(9,080,974 bytes; first page `fl:document:sha256-34c856ac2bda2291cba9496d81d613d3b07cccfc1b4f85eeb12bdc58565ef740`; all pages in
`collected/wi-statewide-parcels/manifest.jsonl`), then `wi_statewide.build` into a scratch registry (4.4 s):

- Rows read: 16,582 features (the county has 280,676 parcels; 15,728 class 2, 854 class 3). Parcels kept: **16,580** (two
  repeated parcel ids dropped): F1 15,726, F2 854. B: 0 (no multifamily class).
- Facts written: 155,905. Owner-of-record facts (organisations): 11,770 (9,266 of them an LLC); natural persons or withheld owners
  not stored: 4,810.
- Fact counts: situs 16,551; market value 16,536; assessed value 16,465; land area 16,574; owner mailing address 11,689.

## Full load (2026-11-03)

Release `data-2026-11-03-41603209834` (draft, maintainers only) of `9mp96ygnbk-alt/factlot`. Each asset's sha256 was checked against the manifest and its first 16 hex characters against the name. Loaded into the Tier 2 scratch registry (one SQLite file shared by every Tier 2 source, `ct-sos-entities` first).

Assets (document id from the manifest):

- `wi-statewide-parcels__34c856ac2bda2291__query` (1,098,087 bytes): `fl:document:sha256-34c856ac2bda2291cba9496d81d613d3b07cccfc1b4f85eeb12bdc58565ef740`
- `wi-statewide-parcels__2858f4144f5928b4__query` (1,093,118 bytes): `fl:document:sha256-2858f4144f5928b4ce36f8540e79b7c1545a660c9b626f30dc96c8b032cfbc45`
- `wi-statewide-parcels__575b70a24365083e__query` (1,090,314 bytes): `fl:document:sha256-575b70a24365083ec258db1743c2ce29967da675b39e400d7444edc5fd55cf99`
- `wi-statewide-parcels__6c7578effbbd1c65__query` (1,096,083 bytes): `fl:document:sha256-6c7578effbbd1c655739d2bfc88893cd4601dd259b575b497f957c19f2bbc5b1`
- `wi-statewide-parcels__f2652f60f257d375__query` (1,094,405 bytes): `fl:document:sha256-f2652f60f257d3755bf87eb0b51e9774d1cd73372a63b88dae556c8d1ce84e4b`
- `wi-statewide-parcels__db623c24ec04fe94__query` (1,093,381 bytes): `fl:document:sha256-db623c24ec04fe9486895d803a966cc56e3f7379764c3b6e9cfe42b3de97ed09`
- `wi-statewide-parcels__0c9e2b376c6933c3__query` (1,096,591 bytes): `fl:document:sha256-0c9e2b376c6933c314de2941847c3346303c8d0172b0cb514c7c5665e37a9d66`
- `wi-statewide-parcels__1e755d7b5b901ec5__query` (1,097,191 bytes): `fl:document:sha256-1e755d7b5b901ec5c5d6ebf85b60a977aa64726b672e793eaaa1d2d16db904b8`
- `wi-statewide-parcels__acfe2428505f589f__query` (321,804 bytes): `fl:document:sha256-acfe2428505f589faa004f69a21b494f0f42393b38a666c39fc9c66824d38b89`

Command:

```
PYTHONPATH=python/src python3 -m factlot.registry.adapters.wi_statewide <9 page files in manifest order> registry.db --as-of 2026-06-30 --retrieved-at <manifest checked_at>
```

- Rows read: 16,582 features in 9 pages; two repeated parcel ids dropped.
- Parcels kept: **16,580** distinct commercial parcels (`B` 0, `F1` 15,726, `F2` 854).
- Facts written: 155,893. Seconds: 17.1. Invalid ids, errors, retired: 0, 0, 0.
- Organisation owners stored (current owner-of-record facts): 11,764; natural persons or withheld owners not stored (names not kept): 4,816.
- Ownership links to registered entities after `link_owners()`: 26 (the only entity registry in the scratch file is `ct-sos-entities`).

## Statewide extension (2026-11-03)

The review above already covers the whole statewide layer, so the extension is configuration, adapter
fixes and testing. The config now lists 130 pages: Milwaukee's 9 first, then 121 pages for the other 71
counties alphabetically by `CONAME`, each the same query (`PROPCLASS` containing 2 or 3, the same 23
`outFields`, `orderByFields=OBJECTID`, 2,000 features a page) with another `CONAME` and offsets 0, 2000, …
up to the county's count.

- **County list, from the publisher's own data.** The service's group-by statistics (`CONAME`,
  `PARCELFIPS`, count over all 3,574,646 features) give the 72 `CONAME` values of the schema's Table B-1
  ("County Naming and FIPS Codes", V12 schema documentation, re-read 2026-11-03) plus one stray feature
  (`CONAME` `MENOMONIE`, `PARCELFIPS` `999`, no class, out of scope). The table is now in the adapter
  (`COUNTY_FIPS`).
- **County-specific difference found and fixed: `CONAME` versus `PARCELFIPS`.** The schema defines
  `CONAME` as "the name of the county which the parcel is administratively part of" and `PARCELFIPS` as the
  FIPS of "the contributing jurisdiction of the parcel dataset". They differ where a city spanning a county
  line supplies its parcels: 5,258 Calumet features (3,839 and 1,419) carry Outagamie's `087` (Appleton) or Winnebago's
  `139` (Menasha), and 172 Winnebago features carry `087`. The adapter took the county from `PARCELFIPS`,
  which would have filed 294 in-scope Calumet and Winnebago parcels under the wrong county; it now uses
  `CONAME` through Table B-1 and falls back to `PARCELFIPS` only when `CONAME` names no Wisconsin county
  (and returns no county for the stray `999` row). Milwaukee is unaffected (`079` either way).
- **Parcel keys.** All 185,994 in-scope `PARCELID`s were read (`outFields=PARCELID,TAXPARCELID,CONAME,PARCELFIPS,OWNERNME1`,
  no geometry, 93 pages, about 12 MB) to test the registry key. Two problems, both fixed in the adapter:
  1. 31 counties write punctuation in their ids, and the registry's APN drops it: 74 pairs of different
     parcels would have merged (Brown 58, e.g. `11-109` and `1-1109`; Vilas 8; Kewaunee 5; Oneida 3). The APN
     is now `apn_for(PARCELID)`: letters and digits as they are, any other character as `x<hex>x`, a literal
     `x` as `xx` (the scheme of `ma-massgis-parcels`). Every Milwaukee tax key is ten digits, so Milwaukee's
     parcel ids do not change. With the escape, the 185,994 rows give 185,754 distinct parcels and 0
     collisions.
  2. 344 `PARCELID`s occur in more than one county, and the account (crosswalk `wi_parcelid`) was the bare id,
     so a lookup could land in the wrong county. The account is now `<county FIPS>:<PARCELID>` (as in
     `ut-ugrc-lir`); Milwaukee's crosswalk value becomes `079:<tax key>`.
     Ids repeated within a county (Outagamie 104, Racine 63, Shawano 21, Calumet 8, Milwaukee 2) keep their
     first row, as before.
- **Owners.** A group-by of in-scope `OWNERNME1` values that look like a redaction or a placeholder found
  `NOT AVAILABLE` in ten counties (Kenosha 4,011; Dane 974; Barron 9; Dodge 6; Columbia 5; Vilas 2; Brown,
  Forest, Sauk and Sheboygan 1 each), `NOT AVAILABLE NOT AVAILABLE` in Jackson (4), and `UNKNOWN` /
  `UNKNOWN OWNER` in Columbia, Marathon, Racine and Dane (9). The adapter now treats a name made only of the
  redaction phrase as withheld and the `UNKNOWN` forms as no owner.
- **Codes.** `PROPCLASS` uses the statutory classes in every county, alone or comma-joined (49 combinations
  among in-scope rows, e.g. `2,4,5`); the existing rule (class 2 → `F1`, else class 3 → `F2`) covers
  them all. No county-specific class mapping is needed.
- **URL check.** One request per new county: the county's first page URL with `resultRecordCount=5`,
  through the collector's `PoliteFetcher` (user agent, robots.txt, 2-second interval): all 71 answered
  HTTP 200 with 5 features of the right `CONAME`, `TAXROLLYEAR` 2025. The other pages differ only in
  `resultOffset`. No page was archived; the weekly collector workflow does that.
- **In-scope counts** (the service's group-by statistics; distinct ids and withheld owners from the id
  read above). The 71 new counties hold **169,412** in-scope rows, **169,174** distinct parcels (`F1`
  160,331 rows, `F2` 9,081) and 5,015 withheld owners; the state 185,994 rows and 185,754 parcels.

| County (FIPS)       | Parcels (all) | In scope (class 2 or 3) |        `F1` |      `F2` | Distinct parcel ids | Owners withheld |   Pages | URL check (`resultRecordCount=5`) |
| ------------------- | ------------: | ----------------------: | ----------: | --------: | ------------------: | --------------: | ------: | --------------------------------- |
| Adams (55001)       |        38,489 |                     721 |         699 |        22 |                 721 |               0 |       1 | HTTP 200, 5 features              |
| Ashland (55003)     |        21,352 |                     834 |         796 |        38 |                 834 |               0 |       1 | HTTP 200, 5 features              |
| Barron (55005)      |        45,011 |                   2,331 |       2,217 |       114 |               2,331 |               9 |       2 | HTTP 200, 5 features              |
| Bayfield (55007)    |        35,897 |                   1,072 |       1,060 |        12 |               1,072 |               0 |       1 | HTTP 200, 5 features              |
| Brown (55009)       |       105,679 |                   7,212 |       6,745 |       467 |               7,212 |               1 |       4 | HTTP 200, 5 features              |
| Buffalo (55011)     |        24,414 |                     765 |         731 |        34 |                 765 |               0 |       1 | HTTP 200, 5 features              |
| Burnett (55013)     |        34,015 |                     799 |         772 |        27 |                 799 |               0 |       1 | HTTP 200, 5 features              |
| Calumet (55015)     |        29,685 |                   1,558 |       1,461 |        97 |               1,547 |               0 |       1 | HTTP 200, 5 features              |
| Chippewa (55017)    |        52,868 |                   2,712 |       2,538 |       174 |               2,712 |               0 |       2 | HTTP 200, 5 features              |
| Clark (55019)       |        35,567 |                   1,561 |       1,420 |       141 |               1,561 |               0 |       1 | HTTP 200, 5 features              |
| Columbia (55021)    |        43,719 |                   2,485 |       2,362 |       123 |               2,485 |               5 |       2 | HTTP 200, 5 features              |
| Crawford (55023)    |        23,135 |                     916 |         867 |        49 |                 916 |               0 |       1 | HTTP 200, 5 features              |
| Dane (55025)        |       218,857 |                  14,137 |      13,693 |       444 |              14,137 |             974 |       8 | HTTP 200, 5 features              |
| Dodge (55027)       |        47,987 |                   2,940 |       2,764 |       176 |               2,940 |               6 |       2 | HTTP 200, 5 features              |
| Door (55029)        |        43,560 |                   2,929 |       2,893 |        36 |               2,929 |               0 |       2 | HTTP 200, 5 features              |
| Douglas (55031)     |        47,729 |                   2,432 |       2,326 |       106 |               2,432 |               0 |       2 | HTTP 200, 5 features              |
| Dunn (55033)        |        36,011 |                   1,504 |       1,427 |        77 |               1,504 |               0 |       1 | HTTP 200, 5 features              |
| Eau Claire (55035)  |        52,015 |                   3,474 |       3,361 |       113 |               3,474 |               0 |       2 | HTTP 200, 5 features              |
| Florence (55037)    |        12,168 |                     272 |         260 |        12 |                 272 |               0 |       1 | HTTP 200, 5 features              |
| Fond Du Lac (55039) |        60,408 |                   3,705 |       3,478 |       227 |               3,705 |               0 |       2 | HTTP 200, 5 features              |
| Forest (55041)      |        21,022 |                     631 |         605 |        26 |                 631 |               1 |       1 | HTTP 200, 5 features              |
| Grant (55043)       |        48,765 |                   2,367 |       2,294 |        73 |               2,367 |               0 |       2 | HTTP 200, 5 features              |
| Green (55045)       |        28,052 |                   1,482 |       1,412 |        70 |               1,482 |               0 |       1 | HTTP 200, 5 features              |
| Green Lake (55047)  |        19,471 |                   1,109 |       1,055 |        54 |               1,109 |               0 |       1 | HTTP 200, 5 features              |
| Iowa (55049)        |        31,740 |                   1,195 |       1,143 |        52 |               1,195 |               0 |       1 | HTTP 200, 5 features              |
| Iron (55051)        |        17,963 |                     547 |         529 |        18 |                 547 |               0 |       1 | HTTP 200, 5 features              |
| Jackson (55053)     |        27,652 |                     969 |         911 |        58 |                 969 |               4 |       1 | HTTP 200, 5 features              |
| Jefferson (55055)   |        45,169 |                   3,013 |       2,856 |       157 |               3,013 |               0 |       2 | HTTP 200, 5 features              |
| Juneau (55057)      |        31,381 |                   1,082 |       1,032 |        50 |               1,082 |               0 |       1 | HTTP 200, 5 features              |
| Kenosha (55059)     |        68,499 |                   4,031 |       3,878 |       153 |               4,031 |           4,011 |       3 | HTTP 200, 5 features              |
| Kewaunee (55061)    |        16,750 |                     839 |         796 |        43 |                 839 |               0 |       1 | HTTP 200, 5 features              |
| La Crosse (55063)   |        54,142 |                   4,068 |       3,885 |       183 |               4,068 |               0 |       3 | HTTP 200, 5 features              |
| Lafayette (55065)   |        21,562 |                     903 |         867 |        36 |                 903 |               0 |       1 | HTTP 200, 5 features              |
| Langlade (55067)    |        29,492 |                     962 |         913 |        49 |                 962 |               0 |       1 | HTTP 200, 5 features              |
| Lincoln (55069)     |        30,616 |                   1,169 |       1,114 |        55 |               1,169 |               0 |       1 | HTTP 200, 5 features              |
| Manitowoc (55071)   |        49,744 |                   2,917 |       2,680 |       237 |               2,917 |               0 |       2 | HTTP 200, 5 features              |
| Marathon (55073)    |        83,708 |                   4,711 |       4,292 |       419 |               4,711 |               0 |       3 | HTTP 200, 5 features              |
| Marinette (55075)   |        57,986 |                   1,980 |       1,877 |       103 |               1,980 |               0 |       1 | HTTP 200, 5 features              |
| Marquette (55077)   |        22,030 |                     610 |         597 |        13 |                 610 |               0 |       1 | HTTP 200, 5 features              |
| Menominee (55078)   |         4,514 |                      15 |          15 |         0 |                  15 |               0 |       1 | HTTP 200, 5 features              |
| Milwaukee (55079)   |       280,676 |                  16,582 |      15,728 |       854 |              16,580 |               0 |       9 | Tier 2 (already loaded)           |
| Monroe (55081)      |        39,367 |                   1,762 |       1,650 |       112 |               1,762 |               0 |       1 | HTTP 200, 5 features              |
| Oconto (55083)      |        42,142 |                   1,700 |       1,596 |       104 |               1,700 |               0 |       1 | HTTP 200, 5 features              |
| Oneida (55085)      |        58,355 |                   2,393 |       2,342 |        51 |               2,393 |               0 |       2 | HTTP 200, 5 features              |
| Outagamie (55087)   |        94,426 |                   5,867 |       5,413 |       454 |               5,734 |               0 |       3 | HTTP 200, 5 features              |
| Ozaukee (55089)     |        41,165 |                   2,673 |       2,519 |       154 |               2,673 |               0 |       2 | HTTP 200, 5 features              |
| Pepin (55091)       |         9,693 |                     426 |         405 |        21 |                 426 |               0 |       1 | HTTP 200, 5 features              |
| Pierce (55093)      |        28,378 |                   1,260 |       1,227 |        33 |               1,260 |               0 |       1 | HTTP 200, 5 features              |
| Polk (55095)        |        48,937 |                   1,836 |       1,710 |       126 |               1,836 |               0 |       1 | HTTP 200, 5 features              |
| Portage (55097)     |        47,509 |                   2,380 |       2,259 |       121 |               2,380 |               0 |       2 | HTTP 200, 5 features              |
| Price (55099)       |        27,890 |                     977 |         921 |        56 |                 977 |               0 |       1 | HTTP 200, 5 features              |
| Racine (55101)      |        84,569 |                   5,164 |       4,871 |       293 |               5,095 |               0 |       3 | HTTP 200, 5 features              |
| Richland (55103)    |        20,907 |                     657 |         627 |        30 |                 657 |               0 |       1 | HTTP 200, 5 features              |
| Rock (55105)        |        73,143 |                   4,324 |       4,099 |       225 |               4,324 |               0 |       3 | HTTP 200, 5 features              |
| Rusk (55107)        |        29,163 |                     860 |         818 |        42 |                 860 |               0 |       1 | HTTP 200, 5 features              |
| Sauk (55111)        |        50,762 |                   4,305 |       4,178 |       127 |               4,305 |               1 |       3 | HTTP 200, 5 features              |
| Sawyer (55113)      |        42,906 |                   1,721 |       1,697 |        24 |               1,721 |               0 |       1 | HTTP 200, 5 features              |
| Shawano (55115)     |        40,318 |                   1,721 |       1,639 |        82 |               1,696 |               0 |       1 | HTTP 200, 5 features              |
| Sheboygan (55117)   |        62,042 |                   3,669 |       3,419 |       250 |               3,669 |               1 |       2 | HTTP 200, 5 features              |
| St Croix (55109)    |        54,900 |                   3,057 |       2,908 |       149 |               3,057 |               0 |       2 | HTTP 200, 5 features              |
| Taylor (55119)      |        25,650 |                     887 |         844 |        43 |                 887 |               0 |       1 | HTTP 200, 5 features              |
| Trempealeau (55121) |        33,157 |                   1,607 |       1,458 |       149 |               1,607 |               0 |       1 | HTTP 200, 5 features              |
| Vernon (55123)      |        35,555 |                   1,153 |       1,103 |        50 |               1,153 |               0 |       1 | HTTP 200, 5 features              |
| Vilas (55125)       |        49,901 |                   1,726 |       1,690 |        36 |               1,726 |               2 |       1 | HTTP 200, 5 features              |
| Walworth (55127)    |        69,231 |                   3,772 |       3,579 |       193 |               3,772 |               0 |       2 | HTTP 200, 5 features              |
| Washburn (55129)    |        34,927 |                     930 |         895 |        35 |                 930 |               0 |       1 | HTTP 200, 5 features              |
| Washington (55131)  |        63,682 |                   3,482 |       3,167 |       315 |               3,482 |               0 |       2 | HTTP 200, 5 features              |
| Waukesha (55133)    |       164,715 |                   8,981 |       8,195 |       786 |               8,981 |               0 |       5 | HTTP 200, 5 features              |
| Waupaca (55135)     |        43,171 |                   2,095 |       1,983 |       112 |               2,095 |               0 |       2 | HTTP 200, 5 features              |
| Waushara (55137)    |        31,328 |                   1,107 |       1,080 |        27 |               1,107 |               0 |       1 | HTTP 200, 5 features              |
| Winnebago (55139)   |        80,772 |                   5,286 |       4,912 |       374 |               5,286 |               0 |       3 | HTTP 200, 5 features              |
| Wood (55141)        |        46,484 |                   2,675 |       2,506 |       169 |               2,675 |               0 |       2 | HTTP 200, 5 features              |
| **All 72 counties** | **3,574,645** |             **185,994** | **176,059** | **9,935** |         **185,754** |       **5,015** | **130** |                                   |

- **Multi-file loading.** `build()` never retires (each page is a filtered extract), as before.
- **Tests added** (`python/tests/test_adapter_wi_statewide.py`): county from `CONAME` for the Appleton and
  Menasha cases, the Table B-1 spellings, the fallback and the stray row; the APN escape (Brown's pair, a
  literal `x`, Milwaukee unchanged); county-qualified accounts; the doubled redaction and the `UNKNOWN`
  placeholder; a Brown file loading the two ids as two parcels.

## Statewide full load (2026-11-03)

Release `data-2026-11-03-41618090881` (draft, maintainers only) of `9mp96ygnbk-alt/factlot`: 121 ArcGIS query pages (`wi-statewide-parcels__<sha16>__query`, 92,297,713 bytes in all) and the source's manifest, downloaded with `gh release download` into an empty directory and read as untrusted data (`python3 -I`, scripts kept outside the directory). Each file's sha256 was checked against the manifest (and its byte size and document id), and its first 16 hex characters against the name: 121 of 121 matched. The manifest also lists 9 archived entries that are in the earlier release `data-2026-11-03-41603209834` (the Full load above), not in this one. A file's document id is `fl:document:sha256-` plus its sha256; its first 16 characters are the `sha16` column. The pages are in the manifest's order (county by county, offsets ascending). Loaded into the same Tier 2 scratch registry as the Full load, after it; `purge_person_owners()` and `link_owners()` were then run once for all five statewide sources together.

Command, one call for all 121 pages so that a parcel id repeated across pages is dropped once (the adapter never retires):

```
PYTHONPATH=python/src python3 -m factlot.registry.adapters.wi_statewide <121 page files in manifest order> registry.db --as-of 2026-06-30 --retrieved-at <manifest checked_at>
```

- Features read: 169,412 in the 121 pages; 238 repeated parcel ids dropped (the same repeats the statewide extension found in the publisher's data: 169,412 rows for 169,174 distinct parcels).
- Parcels kept: **169,174** distinct commercial parcels in 71 counties (`F1` 160,109, `F2` 9,065; Wisconsin's classes 2 and 3 map to no `B`). Every county's count equals the distinct-parcel count recorded in the statewide extension.
- With Milwaukee the whole state is loaded: 185,754 parcels in 72 counties, 124,561 with an organisation owner of record and 427 ownership links.
- Facts written: 1,528,624. Adapter seconds: 265.2. Invalid ids, errors, retired: 0, 0, 0.
- Organisation owners stored (parcels with a current owner-of-record fact): 112,797; natural persons or withheld owners not stored (names not kept): 56,353. Dane's and Kenosha's withheld owners are in the second figure.
- Ownership links to registered entities after `link_owners()`: 401 (the only entity registry in the scratch file is `ct-sos-entities`).

By county (county from `CONAME`, as fixed in the statewide extension):

| County (FIPS)       |   Pages | Features read |     Parcels |        `F1` |      `F2` | Organisation owners | Ownership links |
| ------------------- | ------: | ------------: | ----------: | ----------: | --------: | ------------------: | --------------: |
| Adams (55001)       |       1 |           721 |         721 |         699 |        22 |                 457 |               0 |
| Ashland (55003)     |       1 |           834 |         834 |         796 |        38 |                 496 |               0 |
| Barron (55005)      |       2 |         2,331 |       2,331 |       2,217 |       114 |               1,396 |               9 |
| Bayfield (55007)    |       1 |         1,072 |       1,072 |       1,060 |        12 |                 498 |               1 |
| Brown (55009)       |       4 |         7,212 |       7,212 |       6,745 |       467 |               5,661 |              29 |
| Buffalo (55011)     |       1 |           765 |         765 |         731 |        34 |                 377 |               0 |
| Burnett (55013)     |       1 |           799 |         799 |         772 |        27 |                 388 |               0 |
| Calumet (55015)     |       1 |         1,558 |       1,547 |       1,450 |        97 |               1,140 |               1 |
| Chippewa (55017)    |       2 |         2,712 |       2,712 |       2,538 |       174 |               1,795 |              14 |
| Clark (55019)       |       1 |         1,561 |       1,561 |       1,420 |       141 |                 828 |               0 |
| Columbia (55021)    |       2 |         2,485 |       2,485 |       2,362 |       123 |               1,694 |               3 |
| Crawford (55023)    |       1 |           916 |         916 |         867 |        49 |                 570 |               0 |
| Dane (55025)        |       8 |        14,137 |      14,137 |      13,693 |       444 |              11,036 |              45 |
| Dodge (55027)       |       2 |         2,940 |       2,940 |       2,764 |       176 |               1,952 |               9 |
| Door (55029)        |       2 |         2,929 |       2,929 |       2,893 |        36 |               1,589 |               0 |
| Douglas (55031)     |       2 |         2,432 |       2,432 |       2,326 |       106 |               1,670 |               0 |
| Dunn (55033)        |       1 |         1,504 |       1,504 |       1,427 |        77 |                 956 |               6 |
| Eau Claire (55035)  |       2 |         3,474 |       3,474 |       3,361 |       113 |               2,612 |               1 |
| Florence (55037)    |       1 |           272 |         272 |         260 |        12 |                 153 |               0 |
| Fond Du Lac (55039) |       2 |         3,705 |       3,705 |       3,478 |       227 |               2,559 |              15 |
| Forest (55041)      |       1 |           631 |         631 |         605 |        26 |                 275 |               0 |
| Grant (55043)       |       2 |         2,367 |       2,367 |       2,294 |        73 |               1,383 |               0 |
| Green (55045)       |       1 |         1,482 |       1,482 |       1,412 |        70 |                 875 |               0 |
| Green Lake (55047)  |       1 |         1,109 |       1,109 |       1,055 |        54 |                 696 |               0 |
| Iowa (55049)        |       1 |         1,195 |       1,195 |       1,143 |        52 |                 733 |               0 |
| Iron (55051)        |       1 |           547 |         547 |         529 |        18 |                 256 |               0 |
| Jackson (55053)     |       1 |           969 |         969 |         911 |        58 |                 571 |               3 |
| Jefferson (55055)   |       2 |         3,013 |       3,013 |       2,856 |       157 |               2,103 |               9 |
| Juneau (55057)      |       1 |         1,082 |       1,082 |       1,032 |        50 |                 659 |               0 |
| Kenosha (55059)     |       3 |         4,031 |       4,031 |       3,878 |       153 |                  13 |               0 |
| Kewaunee (55061)    |       1 |           839 |         839 |         796 |        43 |                 521 |               1 |
| La Crosse (55063)   |       3 |         4,068 |       4,068 |       3,885 |       183 |               3,218 |               0 |
| Lafayette (55065)   |       1 |           903 |         903 |         867 |        36 |                 434 |               0 |
| Langlade (55067)    |       1 |           962 |         962 |         913 |        49 |                 503 |               2 |
| Lincoln (55069)     |       1 |         1,169 |       1,169 |       1,114 |        55 |                 710 |               0 |
| Manitowoc (55071)   |       2 |         2,917 |       2,917 |       2,680 |       237 |               1,921 |               3 |
| Marathon (55073)    |       3 |         4,711 |       4,711 |       4,292 |       419 |               3,364 |              10 |
| Marinette (55075)   |       1 |         1,980 |       1,980 |       1,877 |       103 |               1,130 |               0 |
| Marquette (55077)   |       1 |           610 |         610 |         597 |        13 |                 319 |               1 |
| Menominee (55078)   |       1 |            15 |          15 |          15 |         0 |                   9 |               0 |
| Monroe (55081)      |       1 |         1,762 |       1,762 |       1,650 |       112 |               1,118 |               0 |
| Oconto (55083)      |       1 |         1,700 |       1,700 |       1,596 |       104 |                 851 |               4 |
| Oneida (55085)      |       2 |         2,393 |       2,393 |       2,342 |        51 |               1,413 |               1 |
| Outagamie (55087)   |       3 |         5,867 |       5,734 |       5,286 |       448 |               4,233 |              14 |
| Ozaukee (55089)     |       2 |         2,673 |       2,673 |       2,519 |       154 |               2,050 |               3 |
| Pepin (55091)       |       1 |           426 |         426 |         405 |        21 |                 237 |               0 |
| Pierce (55093)      |       1 |         1,260 |       1,260 |       1,227 |        33 |                 748 |               0 |
| Polk (55095)        |       1 |         1,836 |       1,836 |       1,710 |       126 |               1,072 |               0 |
| Portage (55097)     |       2 |         2,380 |       2,380 |       2,259 |       121 |               1,733 |               5 |
| Price (55099)       |       1 |           977 |         977 |         921 |        56 |                 581 |               0 |
| Racine (55101)      |       3 |         5,164 |       5,095 |       4,811 |       284 |               3,619 |               1 |
| Richland (55103)    |       1 |           657 |         657 |         627 |        30 |                 367 |               0 |
| Rock (55105)        |       3 |         4,324 |       4,324 |       4,099 |       225 |               3,082 |              52 |
| Rusk (55107)        |       1 |           860 |         860 |         818 |        42 |                 411 |               0 |
| St Croix (55109)    |       2 |         3,057 |       3,057 |       2,908 |       149 |               2,216 |               0 |
| Sauk (55111)        |       3 |         4,305 |       4,305 |       4,178 |       127 |               2,927 |               4 |
| Sawyer (55113)      |       1 |         1,721 |       1,721 |       1,697 |        24 |                 918 |               0 |
| Shawano (55115)     |       1 |         1,721 |       1,696 |       1,615 |        81 |                 918 |               4 |
| Sheboygan (55117)   |       2 |         3,669 |       3,669 |       3,419 |       250 |               2,667 |              61 |
| Taylor (55119)      |       1 |           887 |         887 |         844 |        43 |                 516 |               0 |
| Trempealeau (55121) |       1 |         1,607 |       1,607 |       1,458 |       149 |                 997 |               0 |
| Vernon (55123)      |       1 |         1,153 |       1,153 |       1,103 |        50 |                 637 |               0 |
| Vilas (55125)       |       1 |         1,726 |       1,726 |       1,690 |        36 |                 969 |               7 |
| Walworth (55127)    |       2 |         3,772 |       3,772 |       3,579 |       193 |               2,739 |               1 |
| Washburn (55129)    |       1 |           930 |         930 |         895 |        35 |                 469 |               0 |
| Washington (55131)  |       2 |         3,482 |       3,482 |       3,167 |       315 |               2,626 |               5 |
| Waukesha (55133)    |       5 |         8,981 |       8,981 |       8,195 |       786 |               7,363 |              42 |
| Waupaca (55135)     |       2 |         2,095 |       2,095 |       1,983 |       112 |               1,290 |               4 |
| Waushara (55137)    |       1 |         1,107 |       1,107 |       1,080 |        27 |                 590 |               0 |
| Winnebago (55139)   |       3 |         5,286 |       5,286 |       4,912 |       374 |               4,096 |              27 |
| Wood (55141)        |       2 |         2,675 |       2,675 |       2,506 |       169 |               1,824 |               4 |
| **All 71 counties** | **121** |   **169,412** | **169,174** | **160,109** | **9,065** |         **112,797** |         **401** |

## Known gaps

- Only Milwaukee County has been archived and loaded so far; the other 71 counties' 121 pages are in the config
  (statewide extension above) and are archived by the next weekly collector run.
- The page list is cut to V12's counts; a county that grows before V13 would lose its last rows until the list is
  regenerated (re-run the group-by and rebuild the offsets at each release).
- No building area or year built in the layer. Apartments cannot be separated from commercial (see above).
- `owner_of_record` names are as the county supplies them (truncated in Milwaukee). A parcel id repeated within a county (two in Milwaukee) keeps its first row.
- V12 is the 2025 roll in most counties; refresh yearly after the June release.
- The Wisconsin DFI corporate file is sold (`wi-dfi-entities`), so Milwaukee owners link to entities only after that purchase.
