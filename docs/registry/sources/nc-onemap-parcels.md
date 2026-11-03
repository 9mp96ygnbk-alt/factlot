# nc-onemap-parcels: North Carolina counties beyond Wake and Mecklenburg, from the NC OneMap statewide layer

Reviewed 2026-11-03. Status: **verified** for eight counties (Buncombe, Gaston, Iredell, and since the tier2-expansion branch Guilford, Forsyth,
Cumberland, Johnston and New Hanover), under NC OneMap's free and unrestricted use policy; Durham, Union, Cabarrus and Onslow are left out for
the reasons below (see "Text-class counties" for the five added later). Config: [`registry/sources/nc/nc-onemap-parcels.json`](../../../registry/sources/nc/nc-onemap-parcels.json)
(one source per county: `nc-onemap-buncombe`, `nc-onemap-gaston`, `nc-onemap-iredell`, `nc-onemap-guilford`, `nc-onemap-forsyth`, `nc-onemap-cumberland`,
`nc-onemap-johnston`, `nc-onemap-newhanover`); adapter
`python/src/factlot/registry/adapters/nc_onemap.py`; tests `python/tests/test_adapter_nc_onemap.py`.

## Relation to the Wake source

[`nc-wake-parcels`](nc-wake-parcels.md) was the first county taken from this layer. Its adapter `nc_wake.py` is now a
thin wrapper over `nc_onemap.py`, which holds the per-county mapping table (`COUNTIES`: Wake, Buncombe, Gaston,
Iredell). Wake keeps its source id `nc-wake-parcels`, account system `wake_reid`, config and review record; its tests
(`test_adapter_nc_wake.py`) pass unchanged. Mecklenburg stays on its own file (`nc-mecklenburg-assessor`) and has no
entry in the table. Source ids are unique: the three new ids are one per county because a source carries one
`county_fips` and `full_roll` retirement is per source.

## Publisher, terms, robots

Same layer, publisher, terms and licence as the Wake record (read again 2026-11-03; nothing changed): NC OneMap,
NC Department of Information Technology, Government Data Analytics Center, Center for Geographic Information and
Analysis. Terms page <https://www.nconemap.gov/pages/terms>: "Written release agreements to authorize use of the geospatial
data, web services, and applications found on the NC OneMap website are not required and will not be issued."
Redistribution permitted; AI use not addressed; underlying records are public records (N.C. Gen. Stat. ch. 132). The
download API and item JSON are allowed by robots.txt (Crawl-delay 60 on `www.nconemap.gov`); `services.nconemap.gov` (the
query service used for counts and samples) has no robots.txt (404). Attribution: NC OneMap, with the county as data
steward.

The use codes are the county's own, so the licence review applies statewide but the code mapping does not: each county
below has its own table, taken from a document that county published.

## Counties (the 12 most populous after Wake and Mecklenburg)

Order by Census Vintage 2025 county estimates (`co-est2025-alldata.csv`,
<https://www2.census.gov/programs-surveys/popest/datasets/2020-2025/counties/totals/>, read 2026-11-03; the Census API
needs a key, which was not requested): Wake 1,257,235; Mecklenburg 1,233,383; **Guilford 562,234; Forsyth 401,718;
Durham 347,240; Cumberland 338,473; Buncombe 277,417; Union 267,674; Johnston 256,448; Cabarrus 249,725; Gaston
246,558; New Hanover 245,959; Onslow 217,175; Iredell 211,798**; next: Alamance 186,177. (Gaston is 11th and New Hanover
12th, the reverse of the order in the task's example list.) "In scope" is the publisher's own count from the layer's
query service for the mapped codes; "loaded" is parcels in the scratch registry after the adapter run.

| County (rank) | FIPS  | Codes mapped                                                                                                                      | Definitions (read 2026-11-03)                                                                                                                                                               | In scope                                                         | Loaded                            |
| ------------- | ----- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | --------------------------------- |
| Buncombe (7)  | 37021 | 411 -> B; 4xx commercial block (60 codes) -> F1; 700-710 (7 codes) -> F2                                                          | County GIS "Parcel Class Code" table, <https://gis.buncombenc.gov/buncomap/classcode.htm>                                                                                                   | 5,135 (B 653, F1 4,352, F2 130)                                  | 5,135 (B 653, F1 4,352, F2 130)   |
| Gaston (11)   | 37071 | 2100 -> B; 26 Commercial-group codes -> F1; 3010-3060 (6 codes) -> F2                                                             | 2023 Schedule of Values, ch. 4 Data Inventory, "Property Use Codes", <https://www.gastongov.com/DocumentCenter/View/2866/Chapter-4-Data-Inventory-PDF>                                      | 4,170 (B 254, F1 3,143, F2 773)                                  | 4,170 (B 254, F1 3,143, F2 773)   |
| Iredell (14)  | 37097 | 17 MULTI-FAMILY codes -> B; OFFICE + COMMERCIAL groups (29 codes) -> F1; INDUSTRIAL group (18 codes) -> F2; improvements required | 2019 Reappraisal Uniform Schedule of Values, Land Appraisal Procedures, "Land Use Codes", <https://iredellcountync.gov/DocumentCenter/View/11850/2019-Chapter-04-Land-Appraisal-Procedures> | 6,531 coded; 4,840 with improvements (B 176, F1 3,638, F2 1,026) | 4,840 (B 176, F1 3,638, F2 1,026) |

Total 14,145 parcels loaded in 3 counties. The in-scope counts equal the loaded counts: the files hold exactly the
publisher's rows for the mapped codes, and every row passed the adapter.

### Left out

| County (rank)    | FIPS  | Why left out                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ---------------- | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Guilford (3)     | 37081 | `parusecode` is blank; `parusedesc` is text (APART 874, MULTI-FAMILY5> 104, COMM 4,423, IND 5,243, OFFICE 1,838, RETAIL 845 of 222,443 parcels). No published definition found: the Tax Department pages link none, the 2026 Schedule of Values (8.3 MB, read) lists neighbourhood codes but not these property descriptions, and the county's `Parcel_Boundaries` service has 9 fields and no domains. The text is not a definition, so nothing is mapped.                                                                                                                                                                                                                   |
| Forsyth (4)      | 37067 | `parusedesc` is text with a county prefix (`1.07-Apt Buildings`, `2.02-Com Services`, `4.01-Light Manuf`; 166,755 parcels). No table found: the 2025 Uniform Schedule of Values (15 MB, read) and the Tax Administration pages (forsyth.cc/Tax/) carry none, and the city-county parcel service has no domain.                                                                                                                                                                                                                                                                                                                                                                |
| Durham (5)       | 37063 | The layer's `parusecode` holds the _zoning_ district and `parusedesc` a text class (`RES/ 1-FAMILY`, `COM/ OFFICE CONDO`; 133,075 parcels). The County publishes a Land Use codes spreadsheet (`/Tax-Administration1/Documents/Land-Use-codes.xlsx`, linked from the Real Property Database page on `www.dconc.gov`), but `https://www.dconc.gov/robots.txt` is `User-agent: *` / `Disallow: /`, so the collector may not fetch it. A copy was fetched by mistake before the robots file was read; it was never opened and was deleted. Founder action: read that spreadsheet by hand (or ask Durham County Tax Administration to allow the FactLot bot) and add the mapping. |
| Cumberland (6)   | 37051 | Codes are `R101-RES`, `C100-COMMERC`, `A101-APART`, `I100-INDUSTR` (140,513 parcels). The 2025 Revaluation Schedule of Values (9.7 MB, read) has a land-use table (`0100 RESIDENTIAL LOT`, `1096 COMMERCIAL LAND` ...) and building-type models (`APT`), neither of which is this code; only the prefix letter is hinted at (C = Commercial, I = Industrial, in the submerged-land codes), which does not define `A101`. Nothing mapped.                                                                                                                                                                                                                                      |
| Union (8)        | 37179 | Only broad classes (COM 3,391, IND 1,136, RES 100,012, FARM, EXEMPT, UTIL, OTHER; 117,539 parcels); apartments are not separate. `www.unioncountync.gov` returns 403 to automated clients (including its robots.txt), so the county's metadata and Schedule of Values could not be read.                                                                                                                                                                                                                                                                                                                                                                                      |
| Johnston (9)     | 37101 | Text classes (`Garden Apartment`, `High Rise Apartment`, `Warehouse`, `Light Manufacturing`; 125,583 parcels). The County's "Improvement Use Codes and Descriptions" PDF is at `https://www.johnstonnc.gov/files/taxoffice/ImprovementUseCodes.pdf`, but `https://www.johnstonnc.gov/robots.txt` disallows `/files/`. A copy was fetched by mistake before the robots file was read; it was never opened and was deleted. Founder action: read it by hand or ask Johnston County Tax to allow the bot.                                                                                                                                                                        |
| Cabarrus (10)    | 37025 | The layer has no use class: `parusecode` and `parusedesc` are blank for all 110,009 parcels, and `parusecd2` is only `I` (78,066), `V` (17,376) or blank (14,567). Owner names are present (103,575 non-blank). Nothing to map.                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| New Hanover (12) | 37129 | Classes `RES`, `COM`, `IND`, `APT`, `HOA`, `GOV`, `REL` (103,489 parcels). The 2025 Schedule of Values (4.4 MB, read) has building models in which `RES` means restaurant and `APT` apartment, and no parcel-class table. The same letters mean different things, so the layer's classes are not mapped.                                                                                                                                                                                                                                                                                                                                                                      |
| Onslow (13)      | 37133 | `parusecode` and `parusedesc` are blank for all 95,297 parcels; `parusedsc2` is a residential building type only (Single Family 53,974, Multi-Section MH 4,775, Townhome 3,983 ... Multi-Family 31, Apartment 10) with no commercial or industrial class. Nothing to map.                                                                                                                                                                                                                                                                                                                                                                                                     |

### Per-county code tables

Counts are rows in the archived file (equal to the publisher's counts by code). Only codes the county's table places in
the class and that the file contains are listed.

#### Buncombe (37021)

Definitions: "Parcel Class Code" table on the County GIS site (page title "Parcel Class Code", no date on the page; read
2026-11-03; HTML, 204 rows). It lists each code with a short name and no prose; the class is the hundreds block
(`400 COMM`, `500 REC`, `600 COMMTY SERVICES`, `700 INDUSTRIAL`, `800 STATE ASSESSED`), and `411 APT` is the apartment
code. Mapped on that structure: `411` -> B; the 4xx block -> F1; `700` to `710` -> F2. Not mapped from the 4xx block:
`416 MFGHOME PARK =>3 UN`, `417 CAMPS,COTTAGES,RV PK`, `438 COMM PKG LOT` (a site), and `442`, which the table calls
"SECT. 42 APARTMENT" but the layer labels "OTHER COMMERCIAL" (21 parcels; unresolved). `448` is "BREWERY" in the table and
"OTHER COMMERCIAL" in the layer; both commercial, so mapped. `720 MINING & QUARRY` and `721 SAND & GRAVEL` are not mapped
(extraction, not manufacturing). In the layer but not in the table: `439` (117 parcels, no text), not mapped. Not in scope
by class: `180 MULTIPLE RES` (not stated to be five units or more), `340`/`341` commercial vacant land, 5xx recreation, 6xx
community services and exempt. A "Buncombe County Parcel Class Codes" dataset exists on `data.buncombecounty.org` (not
read).

| Code | Layer text (parusedesc) | Category | Loaded |
| ---- | ----------------------- | -------- | ------ |
| 411  | APARTMENTS              | B        | 653    |
| 405  | LEASEHOLD/COMMERCIAL    | F1       | 49     |
| 414  | HOTEL                   | F1       | 93     |
| 415  | MOTEL                   | F1       | 16     |
| 418  | INN-BED& BREAKFAST      | F1       | 32     |
| 421  | RESTAURANT              | F1       | 161    |
| 423  | SNACK BARS              | F1       | 10     |
| 424  | NIGHT CLUB              | F1       | 7      |
| 425  | BAR                     | F1       | 18     |
| 426  | FAST FOOD               | F1       | 117    |
| 430  | USED CAR SALES          | F1       | 44     |
| 431  | NEW AUTO DEALERSHIP     | F1       | 18     |
| 432  | SERVICE STATION         | F1       | 11     |
| 433  | AUTO REPAIR/TIRE        | F1       | 249    |
| 434  | AUTO CAR WASH           | F1       | 17     |
| 435  | MANUAL CAR WASH         | F1       | 14     |
| 437  | COMM/PARKING GARAGE     | F1       | 5      |
| 440  | WAREHOUSE/STORAGE       | F1       | 554    |
| 441  | GAS/OIL/SALES/STORAG    | F1       | 6      |
| 444  | LUMBER YRD-SAWMILL      | F1       | 6      |
| 446  | COLD STORAGE FAC.       | F1       | 2      |
| 447  | TRUCKING TERMINAL       | F1       | 20     |
| 448  | OTHER COMMERCIAL        | F1       | 24     |
| 450  | RETAIL SALES            | F1       | 305    |
| 454  | LARGE FOOD STORE        | F1       | 31     |
| 455  | SALES & SERVICE         | F1       | 28     |
| 456  | CONVENIENCE STORE       | F1       | 156    |
| 458  | MH/MODULAR SALES        | F1       | 9      |
| 460  | BANKS & OFFICES         | F1       | 2      |
| 461  | STANDARD BANK           | F1       | 1      |
| 462  | DRIVE-IN BANK           | F1       | 73     |
| 463  | BANK W/ OFFICE          | F1       | 9      |
| 464  | OFFICE BLDG             | F1       | 371    |
| 465  | PROFESSIONAL BL         | F1       | 5      |
| 466  | COMMERCIAL CONDO        | F1       | 533    |
| 468  | MEDICAL OFFICE          | F1       | 131    |
| 470  | COMMERCIAL/SERVICES     | F1       | 173    |
| 471  | FUNERAL HOME            | F1       | 12     |
| 472  | DOG KENNEL/CATTERY      | F1       | 17     |
| 473  | GREENHOUSE/NURSERY      | F1       | 7      |
| 475  | VETERINARY CLINIC       | F1       | 23     |
| 476  | ADULT CARE HOME/COMM    | F1       | 46     |
| 477  | CLUBHOUSE FRAT.BLD.     | F1       | 8      |
| 478  | DAYCARE CENTER          | F1       | 21     |
| 479  | WINERY                  | F1       | 1      |
| 480  | MULTI-USE COMMERCIAL    | F1       | 126    |
| 481  | ROW RETAIL BLD.         | F1       | 309    |
| 483  | CONVERTED RESIDENCE     | F1       | 290    |
| 486  | COMMERCIAL SCHOOL       | F1       | 3      |
| 490  | REGIONAL SHOP CTRS      | F1       | 2      |
| 492  | STRIP SHOPPING CENTR    | F1       | 173    |
| 494  | MALL ANCHOR STORE       | F1       | 8      |
| 495  | HOME IMP. CENTER        | F1       | 6      |
| 701  | MILK PROCESSING         | F2       | 3      |
| 710  | IND/MANUFACTURING       | F2       | 127    |

Mapped codes with no parcel in the file: 400, 401, 420, 422, 445, 467, 491, 493, 700, 702, 704, 706, 708

#### Gaston (37071)

Definitions: "Property Use Codes" ("an overall classification for the use of the parcel"), Gaston County 2023 Schedule of
Values, Chapter 4 Data Inventory, pp. 66-67 (Residential, Commercial, Industrial and Church/Government groups). Mapped:
`2100 Apartment Complex/Multi-family` -> B; Commercial group -> F1; Industrial group `3010` to `3060` -> F2. Not mapped
from the Commercial group: `2000 Commercial Land`, `2001 Cell Tower Site`, `2002 Parking Lot`, `2003 Billboard Site`
(sites, no building), `2004 Mobile Home Park`, `2005 Golf Course`, `2007 House on Commercial Site`, `2240 Live/Work`,
`2250 Section 42 Housing` (the definition does not say multifamily). Not mapped from the Industrial group: `3000
Industrial Land`, `3001 Mining/Minerals`, `3002` to `3007` (lift station, private utilities, water/sewer treatment, solar
farm, recycling and salvage, landfill). `1030` and `1035` (three- and four-family) are under five units. The layer carries
codes added after the 2023 table (`2061 Office Condo` 8, `2155 Tow/Salvage Lot` 1, `2270 Self Storage` 17); they are not
in the published table and are not mapped.

| Code | Layer text (parusedesc)   | Category | Loaded |
| ---- | ------------------------- | -------- | ------ |
| 2100 | Apt Complex/Multi-Family  | B        | 254    |
| 2006 | Marine Related            | F1       | 6      |
| 2010 | Mixed Use Commercial      | F1       | 578    |
| 2020 | General Retail            | F1       | 450    |
| 2030 | Department/Discount Store | F1       | 38     |
| 2040 | Shopping Center/Mall      | F1       | 59     |
| 2050 | Restaurant                | F1       | 147    |
| 2055 | Fast Food                 | F1       | 97     |
| 2060 | Office                    | F1       | 697    |
| 2070 | Medical/Dental Office     | F1       | 131    |
| 2080 | Hosp/Urgent Care Centers  | F1       | 2      |
| 2090 | Vet Clinic/Grooming       | F1       | 19     |
| 2110 | Conv Store/Gas Station    | F1       | 140    |
| 2120 | Hotel/Motel               | F1       | 25     |
| 2130 | Automobile Sales          | F1       | 69     |
| 2140 | Car Wash                  | F1       | 27     |
| 2150 | Vehicle Repair            | F1       | 287    |
| 2160 | Bank/Savings & Loan       | F1       | 48     |
| 2170 | Beauty/Barber Shop        | F1       | 82     |
| 2180 | Daycare                   | F1       | 39     |
| 2190 | Laundry/Cleaners          | F1       | 19     |
| 2200 | Funeral Home              | F1       | 18     |
| 2210 | Entertainment             | F1       | 51     |
| 2230 | Retirement/Rest Home      | F1       | 21     |
| 2260 | Converted Residence       | F1       | 15     |
| 2280 | Service Shop              | F1       | 78     |
| 3010 | Industrial                | F2       | 471    |
| 3020 | Warehouse                 | F2       | 172    |
| 3030 | Distribution Warehouse    | F2       | 42     |
| 3040 | Mini-Warehouse            | F2       | 45     |
| 3050 | Office Warehouse          | F2       | 43     |

Mapped codes with no parcel in the file: 2220, 3060

#### Iredell (37097)

Definitions: "Land Use Codes" in the 2019 Reappraisal Uniform Schedule of Values, Standards, and Rules, Market Value
Schedule, Land Appraisal Procedures chapter, pp. 4-29 to 4-33 (547 KB PDF; a 2023 Chapter 11 and a "Tax Data Dictionary"
PDF are also posted but were not needed). The table is grouped under the headings RESIDENTIAL, CONDOMINIUM, **MULTI -
FAMILY** (0500-0563), **OFFICE** (0400-0431), **INDUSTRIAL** (0600-0657), **COMMERCIAL** (0700-0780), AGRICULTURAL,
INSTITUTIONAL/SPECIAL PURPOSE and GOVERNMENT OWNED. Mapped: MULTI - FAMILY -> B except `0501 MULTI FAMILY COMMON AREA` and
`0562 DUPLEX/TRIPLEX` (fewer than five units); OFFICE and COMMERCIAL -> F1 except `0728 PARKING` and `0780 MARINA LAND`
(sites); INDUSTRIAL -> F2 (that group lists mini-warehouse, warehousing and service garages, so those are F2 here, unlike
Buncombe). `0210 MOBILE HOME PARK`, `0300` condominium and the 5000-8xxx groups are not mapped. The codes classify the land
and have no vacant-land code, so a parcel counts only with `improvval` > 0: of the 6,531 parcels with mapped codes, 1,691
have no improvement value (many are small lots) and are not loaded.

| Code | Layer text (parusedesc) | Category | Loaded |
| ---- | ----------------------- | -------- | ------ |
| 0500 | MULTI FAMILY            | B        | 175    |
| 0560 | MULTI FAMILY GARDEN     | B        | 1      |
| 0400 | OFFICE                  | F1       | 255    |
| 0419 | MEDICAL OFFICE          | F1       | 64     |
| 0420 | MEDICAL CONDOMINIUM     | F1       | 46     |
| 0424 | OFFICE CONDOMINIUM      | F1       | 282    |
| 0431 | DAY CARE CENTERS        | F1       | 2      |
| 0700 | COMMERCIAL              | F1       | 2,961  |
| 0711 | CONVENIENCE STORES      | F1       | 1      |
| 0716 | SHOPPING CENTER (STRIP) | F1       | 2      |
| 0723 | BANKS                   | F1       | 1      |
| 0735 | COMMERCIAL CONDOMINIUM  | F1       | 24     |
| 0600 | INDUSTRIAL              | F2       | 998    |
| 0647 | WAREHOUSE CONDOMINIUM   | F2       | 26     |
| 0653 | SERVICE GARAGE          | F2       | 2      |

Mapped codes with no parcel in the file: 0418, 0502, 0503, 0505, 0506, 0507, 0508, 0509, 0510, 0511, 0513, 0514, 0515, 0516, 0561, 0563, 0601, 0602, 0628, 0630, 0641, 0642, 0643, 0644, 0645, 0646, 0648, 0649, 0651, 0652, 0657, 0701, 0712, 0713, 0714, 0715, 0721, 0722, 0725, 0726, 0727, 0732, 0733, 0734, 0736, 0737, 0738, 0739, 0765

## How the counts were obtained

- Order and population: Census file above. Counts by use code: the layer's query service
  (`https://services.nconemap.gov/secure/rest/services/NC1Map_Parcels/FeatureServer/1/query` with
  `groupByFieldsForStatistics=parusecode,parusedesc`, one request per county, 2 s apart). Samples of two rows per county
  were read the same way.
- Downloads: the Hub download API through the collector
  (`python -m factlot.collector snapshot --config registry/sources/nc/nc-onemap-parcels.json`), filtered to the county and
  the mapped codes, as for Wake: Buncombe 2,450,547 bytes
  (`fl:document:sha256-ffc87ace80ed017ab3ba72abd0f7ff4bc7118db02c9f956241a5f8e6d6423874`, retrieved 2026-11-03T12:07:22Z),
  Gaston 2,332,367 bytes (`fl:document:sha256-c2c8aea5c8eee631a680c7169c8e143bc0edbf09ec850795ceb2eba027dd954b`, 12:04:33Z),
  Iredell 2,341,974 bytes (`fl:document:sha256-0c5845530f191738680dbff52e4c0852a91f33d036b61fdebbce30695615cb4d`,
  12:09:24Z). The first Buncombe attempt archived a 228-byte status file (`"status":"PagingData"`): the Hub API answers 200
  with a JSON status while it builds the file, not 202. That snapshot was discarded and the run repeated. Every file has 70
  columns, one county, no repeated `parno`.
- Definitions documents, read 2026-11-03: Buncombe (HTML, 18 KB), Gaston chapter 4 (914 KB), Iredell chapter 4 (547 KB);
  for counties left out, the Forsyth, Cumberland, Guilford and New Hanover Schedules of Values (15.0, 9.7, 8.3 and 4.4 MB).
  Total downloaded for the task: about 55 MB (budget 200 MB), including the three data files (7.1 MB). Two documents on
  robots-disallowed paths (Durham, Johnston) were fetched before their robots files were read, never opened and deleted;
  robots.txt is now read before any fetch.
- The registry load: scratch file `scratchpad/nc/registry.db` (under the session scratch directory),
  `python -m factlot.registry.adapters.nc_onemap <csv> <db> --county <fips> --as-of <transfdate>`.

## Real run

| County   | Snapshot                                 | `--as-of` (layer `transfdate`) | Rows read | Kept                              | Facts written | Organisation owners stored | Person owners skipped | Seconds | Errors |
| -------- | ---------------------------------------- | ------------------------------ | --------- | --------------------------------- | ------------- | -------------------------- | --------------------- | ------- | ------ |
| Buncombe | `fl:document:sha256-ffc87ace80ed017a...` | 2026-05-11                     | 5,135     | 5,135 (B 653, F1 4,352, F2 130)   | 37,461        | 3,893                      | 1,242                 | 1.1     | none   |
| Gaston   | `fl:document:sha256-c2c8aea5c8eee631...` | 2026-05-13                     | 4,170     | 4,170 (B 254, F1 3,143, F2 773)   | 34,529        | 2,731                      | 1,439                 | 0.9     | none   |
| Iredell  | `fl:document:sha256-0c5845530f191738...` | 2026-05-24                     | 4,840     | 4,840 (B 176, F1 3,638, F2 1,026) | 38,730        | 3,187                      | 1,653                 | 1.0     | none   |

## Owner names and fields in the loaded counties

Owner of record is present on every loaded row in all three counties (0 blank); `owntype` is blank everywhere and no row
carries a confidentiality marker, so `owner_confidential` is false throughout. Natural persons are not stored (the
registry drops them): 4,334 of 14,145 parcels (30.6%) have a person owner, 9,811 have an organisation owner stored.
Mailing address is present on 14,143 of 14,145 rows. Situs street is present on 14,144; the situs city only for Gaston
(Buncombe and Iredell have none, so their addresses end in "NC"). Total value (`parval`, type "Assessed") is positive on
13,584 (Buncombe 4,582 of 5,135, Gaston 4,162 of 4,170, Iredell 4,840 of 4,840); acreage on 12,286; year built only for
Gaston (4,057) and Iredell (4,592); no building area and no tax year in the layer. `altparno` (stored as the account) is
set on all Buncombe and Gaston rows and on 3,596 of 4,840 Iredell rows (Buncombe's equals the PIN).

## Gates

None for the three loaded counties. For the nine left out, one action each: Durham and Johnston, a person reads the
county's code list (robots block for the bot) or the county allows the bot; Guilford, Forsyth, Cumberland and New
Hanover, ask the Tax Administration for the code table behind the layer's use description; Union, ask for the metadata
(its site blocks automated clients); Cabarrus and Onslow, the layer carries no commercial use class, so the county's own
roll or a records request is the only source.

## Known gaps

- The loads are the mapped-code slices of each county, not the whole counties (Buncombe 134,741, Gaston 117,252 and
  Iredell 109,254 parcels in the layer).
- The layer lags the county: `transfdate` is 2026-05-11, 2026-05-13 and 2026-05-24.
- Buncombe's table gives short names only, so the class is read from the hundreds block; Iredell's table is the 2019
  list and Gaston's the 2023 list.
- Condominium unit and master accounts, acreage and farm parcels with commercial use, and exempt property are out of
  scope as for Wake.
- The Hub API's 200 "PagingData" status answer is archived by the collector as if it were the file (shared code, not
  changed here).

## Text-class counties: Guilford, Forsyth, Cumberland, Johnston, New Hanover (tier2-expansion, 2026-11-03)

Five of the nine counties left out above publish their class **as words in `parusedesc`** (the layer's `parusecode` is blank for them) and no code
table to cite. The earlier review treated the text as "not a definition" and mapped nothing. The text, however, names itself (`APART`, `COMM`, `IND`,
`2.02-Com Services`, `Garden Apartment`, `Commercial`), and a county's own description of its class is as much a definition as a table that restates
it; the adapter now keys these counties on `parusedesc` (`CountyMap.key_field`) and maps only the values whose own words say commercial, retail,
office, hotel, industrial or apartment. The same basis is used for Minnesota's opt-in counties
([mn-opt-in-parcels](mn-opt-in-parcels.md)). `local_use_code` keeps the county's text. Because the words do not separate vacant land, a parcel counts only
with a value for improvements (`improvval` > 0), as for Iredell; the publisher's counts below are for the mapped values with that test.

| County (rank)    | FIPS  | Values mapped (the county's own text)                                                                                                                                                                                                                                                     | Left out                                                                                                          | Publisher's count | Loaded (B / F1 / F2)        |
| ---------------- | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ----------------- | --------------------------- |
| Guilford (3)     | 37081 | `APART`, `MULTI-FAMILY5>` -> B; `COMM`, `OFFICE`, `RETAIL`, `HOTEL/MOTEL`, `PETROL/GAS` -> F1; `IND` -> F2                                                                                                                                                                                | `MULTI-FAMILY<4`, `TOWNHOUSE`, `CONDO`, `VACANT`, `INSTITUTIONAL`, `GOV OWNED`, `ASSIST LIV/SKILLCARE`            | 9,783             | 9,782 (784 / 5,565 / 3,433) |
| Forsyth (4)      | 37067 | `1.07-Apt Buildings` -> B; `2.01-Com Retail-WS`, `2.02-Com Services`, `2.03-Hotels-Lodging`, `7.02-Office Park`, `7.03-Shopp Cntr-Mall` -> F1; `4.01-Light Manuf`, `4.02-Heavy Manuf`, `7.01-Industrial Park` -> F2                                                                       | `1.06-MF Dwellings`, `1.04-Quadraplex`, `3.xx` institutional, `9x.xx` vacant classes                              | 5,005             | 5,005 (513 / 4,307 / 185)   |
| Cumberland (6)   | 37051 | by the letter of `<letter><3 digits>-<text>`: `A` APART -> B; `C` (COMMERC, AUTOMOT, FOOD/BV, MISCELL, OFFICE, CM COND, SHOP/RE, SPORT/H, STORAGE) and `H` HOTEL/M -> F1; `I` INDUSTR -> F2                                                                                               | `R`, `F`, `E`, `U` and `M` (manufactured-home park) values; the x100 land codes (no improvements)                 | 6,592             | 6,150 (1,036 / 5,011 / 103) |
| Johnston (9)     | 37101 | `Garden Apartment`, `High Rise Apartment` -> B; 32 retail, office, restaurant, bank, medical, hotel, auto and service classes -> F1; `Industrial`, `Light/Heavy Manufacturing`, `Warehouse`, `Prefab Warehouse`, `Office/Warehouse`, `Cold Storage/Freezer`, `Packing Plnt/Food Pr` -> F2 | `Townhouse Apartment`, `Duplex/Triplex`, `Mobile Home Park`, `Homes for Aged`, `Churches`, `Vacant`, clubs, camps | 2,977             | 2,975 (207 / 2,130 / 638)   |
| New Hanover (12) | 37129 | `Apartment` -> B; `Commercial` -> F1; `Industrial` -> F2                                                                                                                                                                                                                                  | `Residential`, `Homeowners Association`, `Exempt ...`, `Use Value`, `State Appraised`, `Farm`                     | 4,524             | 4,524 (195 / 3,548 / 781)   |

The earlier note that New Hanover's classes were `RES`, `COM`, `IND`, `APT`, `HOA`, `GOV`, `REL` no longer matches the layer: on 2026-11-03 its
`parusedesc` holds `Residential`, `Commercial`, `Industrial`, `Apartment`, `Homeowners Association` and the `Exempt ...` classes, so the letter-ambiguity
objection no longer applies. Johnston's County PDF code list is on a robots-disallowed path and was not read; the layer's own text was used instead.
Cumberland's 442 repeated parcel numbers and one repeated parcel in Guilford and two in Johnston collapse to the first row. Counts were taken from the
Hub export of each county's filtered request (`collector snapshot`, one source at a time; the first request of each answered `not_ready` while the export was
built, the second returned the CSV): Guilford 4,923,395 bytes (`fl:document:sha256-83028520...`, `--as-of` 2026-05-14), Forsyth 2,130,529 bytes
(`fl:document:sha256-ab604df3...`, 2026-03-24), Cumberland 2,762,015 bytes (`fl:document:sha256-9dcf1006...`, 2026-05-13), Johnston 1,305,572 bytes
(`fl:document:sha256-84b94204...`, 2026-05-15), New Hanover 2,306,900 bytes (`fl:document:sha256-b8cdb4ae...`, 2026-05-26). Each file has one county and every row
passed the adapter (apart from the repeated parcel numbers).

| County      | Rows read | Kept  | Facts written | Organisation owners stored | Person owners not stored | Errors |
| ----------- | --------- | ----- | ------------- | -------------------------- | ------------------------ | ------ |
| Guilford    | 9,782     | 9,782 | 72,756        | 7,273                      | 2,509                    | none   |
| Forsyth     | 5,005     | 5,005 | 37,140        | 3,686                      | 1,319                    | none   |
| Cumberland  | 6,150     | 6,150 | 45,347        | 3,929                      | 2,221                    | none   |
| Johnston    | 2,975     | 2,975 | 24,558        | 1,867                      | 1,108                    | none   |
| New Hanover | 4,524     | 4,524 | 34,197        | 3,529                      | 995                      | none   |

Total **28,436 parcels** in five counties (B 2,735, F1 20,561, F2 5,140), 20,284 with an organisation owner. Still left out: **Durham** (the County's land use
spreadsheet is on a robots-disallowed path and the layer's `parusecode` holds the zoning district), **Union** (`COM` and `IND` only, no improvement values in
the layer to drop vacant land, no apartments; its site returns 403 to bots), **Cabarrus** and **Onslow** (no use class in the layer).
