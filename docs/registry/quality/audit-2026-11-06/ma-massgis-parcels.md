# ma-massgis-parcels audit, 2026-11-06

The audit database was not committed, and Boston was not collected or loaded.
The audit command exited 1. No Massachusetts county from this source qualifies for promotion.

## Collection

The bucket listing was read on 2026-11-06 from
`https://s3.us-east-1.amazonaws.com/download.massgis.digital.mass.gov?list-type=2&prefix=shapefiles/l3parcels/L3_SHP_M`.
`IsTruncated` was false. The listing has 351 zip files, 934,157,232 bytes, `Last-Modified` from 2026-10-30
back to 2021-09-08. That is the same byte total the source record already measured on 2026-11-03. Nothing
in the prefix had a later `Last-Modified` than 2026-10-30.

`L3_SHP_M035_BOSTON.zip` is in the listing (31,023,097 bytes, `Last-Modified` 2026-10-30T14:41:04Z) and was
not downloaded. Boston stays with `ma-boston-assessing`. The collector archived the other 350 files,
903,134,135 bytes, every one `status: archived`, and every file's byte size matches the listing. The
`sha16` directory names match the November 3 collection. This is that release, re-archived from the publisher.

The mass.gov layer page still returns 403 to the collector and was not read.

## Licence re-read

Read on 2026-11-06 in each town zip's Assess table metadata (`M###Assess_*.dbf.xml`). All 350 files contain
this sentence verbatim:

> This parcel data is in the public domain and should not be redistributed for a fee beyond reproduction costs.

That is the sentence the source record already quotes. The fee clause ("should not be redistributed for a fee beyond reproduction costs") is recorded; whether it permits serving the data on paid plans is undecided. The TaxPar layer metadata
is less uniform: 39 of 350 TaxPar `shp.xml` files do not themselves contain the words "public domain", and
a few add a municipal accuracy disclaimer or, in Wellesley's case, a request to cite the town on a published
map. Those lines sit beside the Assess-table sentence, which is in every zip this load used. They do not
replace the recorded public-domain sentence or add a redistribution ban beyond the fee clause already in
the record.

## Massachusetts land-use codes

The publisher's codes are the Massachusetts Department of Revenue property-type classification codes, read
from the use-code lookup shipped in each zip (`M###UC_LUT_*.dbf`, rows with `TOWN_ID` 0). The crosswalk
is that Massachusetts classification. Texas Comptroller state-class codes are not applied to these rows.
FactLot categories `B`, `F1` and `F2` are the registry's commercial scope. The adapter maps the first three digits of `USE_CODE` as follows. A trailing local digit
(`114C`, `3401`, `3900`) does not change the class.

| DOR code                               | Publisher description (lookup, `TOWN_ID` 0)                                                                                                                                                                                                                             | FactLot category |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| 111                                    | Apartments with Four to Eight Units                                                                                                                                                                                                                                     | `B`              |
| 112                                    | Apartments with More than Eight Units                                                                                                                                                                                                                                   | `B`              |
| 114                                    | Affordable Housing Units (Greater than 50% of the units qualify)                                                                                                                                                                                                        | `B`              |
| 300–393                                | The DOR commercial series: hotels and care facilities, storage, retail, automotive, offices, entertainment, recreation, and commercial land (`390`–`392`). Code `393` is "Agricultural/Horticultural Land not included in Chapter 61A" and is still inside this series. | `F1`             |
| 400–452                                | The DOR industrial series: manufacturing, warehouses, research, mining, utility plant and rights of way, telecommunications (including `434`, Telecommunication Data Centers), and industrial land (`440`–`442`).                                                       | `F2`             |
| 0xx, other 1xx, 9xx, and anything else | Mixed use, other residential, exempt, and local codes outside the scheme                                                                                                                                                                                                | not kept         |

`393` is 786 of the commercial-series records. Mixed-use codes the lookup describes as primarily commercial
or primarily industrial (`030`–`038` and `040`–`048`) are not kept: 7,230 assessor records in this release.

## Commercial universe, separate from the audit

MassGIS does not publish a commercial or industrial parcel total in these files, and the layer page was not
readable (403). A published denominator is unavailable.

The counts below were computed from the Assess tables in this release, using the publisher's own codes:

| Publisher class                                                         | Assessor records |
| ----------------------------------------------------------------------- | ---------------: |
| Commercial series 300–393                                               |           77,695 |
| of which code 393 (agricultural or horticultural land, not Chapter 61A) |              786 |
| Industrial series 400–452                                               |           24,055 |
| Apartment codes 111, 112, 114                                           |           26,190 |
| In-scope records                                                        |          127,940 |
| Distinct parcels after 18 repeated `PROP_ID`s                           |          127,922 |
| Mixed use, primarily commercial or industrial, not kept                 |            7,230 |

A re-read that matches the registry measures the in-scope rows only. It leaves the commercial universe
unsettled: the published total is unavailable, 7,230 mixed-use commercial or industrial records are out of
scope, code `393` is kept even though the publisher describes it as agricultural land, local codes outside
the DOR scheme are out of scope, and 284 towns' assessment dates are older than 400 days.

## Freshness

The as-of date the adapter stores is 1 January of the year before the file's `FY` column. The filename's
`FY##` matches that column in every town that has a year in the name. Chatham's member is `M055Assess.dbf`
(FY2018, as-of 2017-01-01) and Pelham's is `M230Assess.dbf` (FY2019, as-of 2018-01-01).

|   FY | As-of      | Towns | Age on 2026-11-06 | Within 400 days |
| ---: | ---------- | ----: | ----------------: | --------------- |
| 2027 | 2026-01-01 |    66 |               309 | yes             |
| 2026 | 2025-01-01 |   215 |               674 | no              |
| 2025 | 2024-01-01 |    56 |             1,040 | no              |
| 2024 | 2023-01-01 |     8 |             1,405 | no              |
| 2022 | 2021-01-01 |     3 |             2,135 | no              |
| 2019 | 2018-01-01 |     1 |             3,231 | no              |
| 2018 | 2017-01-01 |     1 |             3,596 | no              |

The bucket `Last-Modified` is a different date. Seventy towns' files were last modified more than 400 days
before 2026-11-06. The other 280 were republished inside that window even when the fiscal year is older.
The promotion bar uses the assessment as-of. The bucket date is recorded separately above. Every county has at least one town whose
as-of is older than 400 days. Nantucket (1 town) and Suffolk excluding Boston (Chelsea, Revere, Winthrop)
are entirely as-of 2025-01-01.

## Audit

Commands, against a registry database that was not committed:

```
python -m factlot.collector snapshot --config registry/sources --out collected --source ma-massgis-parcels
python -m factlot.registry.maintain <registry.db> --all
python -m factlot.registry.audit <registry.db> --collected collected --reread --entity-names --today 2026-11-06 --out docs/registry/quality/audit-2026-11-06/ma-massgis-parcels-audit.json
```

`maintain --all` removed 0 person-owner facts. The registry holds 127,922 parcels, 1,239,039 facts, 350
snapshots, 0 ownership links, and 0 pending reviews. No Massachusetts entity registry is loaded, so owners
cannot be linked. `purge` did not have to delete anyone: the adapter had already withheld personal names.

The audit JSON is the command's own output. It records one violation and 286 warnings. Person-like
owner-of-record facts: 0. Orphan mailing addresses: 0. Out-of-scope categories: 0.

Fill, from that JSON (127,922 parcels):

| Field              | Parcels present | Missing |                                         Present |
| ------------------ | --------------: | ------: | ----------------------------------------------: |
| APN                |         127,922 |       0 |                                            100% |
| State category     |         127,922 |       0 |                                            100% |
| Tax year           |         127,922 |       0 |                                            100% |
| Situs address      |         127,920 |       2 |  99.998% (the audit JSON rounds this to 100.0%) |
| Market value       |         127,736 |     186 |                                          99.85% |
| Land area          |         110,707 |  17,215 |                                          86.54% |
| Building area      |          97,731 |  30,191 |                                           76.4% |
| Year built         |          97,079 |  30,843 |                                          75.89% |
| Organisation owner |          83,225 |  44,697 |                                          65.06% |
| Appraised value    |               0 | 127,922 | 0% (the table has no separate appraised column) |

The 2026-11-03 record reports 82,558 organisation owners. This load stored one on 83,225 parcels, 667 more.
The organisation rule has changed since that record (`f893549` reads additional organisation forms as
organisations). This audit still finds 0 person-like owner facts. Parcel counts are unchanged.

The 286 warnings are 284 snapshots older than 400 days, 54 parcels with an implausible year built, and 2
parcels with an implausible area.

### Re-read

`adapter_for` only imports the original Tier 1 adapter modules. `ma_massgis` is not one of them, so every
`source_file` entry in the audit JSON says `no adapter registered for this source`. That module list was
not edited.

The same function the audit calls, `factlot.registry.audit.reread_source_file`, was run on
`factlot.registry.adapters.ma_massgis` for all 350 archived zips. Each file's distinct in-scope parcel ids
equal the parcels that snapshot holds in the registry: 350 matched, 0 mismatched, 0 missing files, 0
header-like APNs. Summary: `ma-massgis-parcels-reread.json`.

### The violation

One violation: 57 extra facts, a parcel with two different values for one single-valued field in one
document. They come from a repeated `PROP_ID` inside a town file. This release has 127,940 in-scope
assessor records and 127,922 distinct parcels, 18 repeats, the same 16 plus 2 the record already counted.
On 17 of those parcels the two rows disagree, and the current facts keep both values. Across the audit's
single-valued fields the extras are: market value 16, situs address 14, building area 14, owner of record
7, land area 2, state category 2, year built 2. The two category conflicts are one Essex parcel coded both
`114C` (`B`) and `3900` (`F1`), and one Middlesex parcel coded both `3401` (`F1`) and `4420` (`F2`).

## Pass or fail

The bar is: re-read matches; 0 violations; 0 person-like owner facts; the per-county parcel count matches
the record; as-of within 400 days of the audit date (2026-11-06; the cutoff is 2025-10-02).

| Bar                                        | Result                                                                                                                                    |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Re-read matches the registry               | Pass, on the direct re-read of all 350 files. The stock audit command could not load the adapter.                                         |
| 0 violations                               | Fail. 57 extra facts on repeated `PROP_ID`s.                                                                                              |
| 0 person-like owner facts                  | Pass.                                                                                                                                     |
| Per-county parcel count matches the record | Pass. Unique parcels match the 2026-11-03 county figures, including Essex 14,950 and Middlesex 26,930.                                    |
| As-of within 400 days for the whole county | Fail for every county. 66 towns are as-of 2026-01-01 (309 days). The other 284 are older, and every county includes at least one of them. |

No county is promoted. Boston was not part of this load.

| County     | FIPS  | Towns | Parcels |    `B` |   `F1` |   `F2` | Organisation owners | As-of range              | Towns within 400 days | Freshness |
| ---------- | ----- | ----: | ------: | -----: | -----: | -----: | ------------------: | ------------------------ | --------------------: | --------- |
| Barnstable | 25001 |    15 |   8,600 |    365 |  7,331 |    904 |               5,123 | 2017-01-01 to 2026-01-01 |               5 of 15 | fail      |
| Berkshire  | 25003 |    32 |   3,990 |    904 |  2,298 |    788 |               2,577 | 2021-01-01 to 2026-01-01 |               2 of 32 | fail      |
| Bristol    | 25005 |    20 |  13,148 |  4,087 |  6,966 |  2,095 |               7,613 | 2024-01-01 to 2026-01-01 |               6 of 20 | fail      |
| Dukes      | 25007 |     7 |   1,024 |     19 |    954 |     51 |                 545 | 2024-01-01 to 2026-01-01 |                2 of 7 | fail      |
| Essex      | 25009 |    34 |  14,950 |  3,399 |  8,895 |  2,657 |              10,066 | 2024-01-01 to 2026-01-01 |               8 of 34 | fail      |
| Franklin   | 25011 |    26 |   2,443 |    368 |  1,333 |    742 |               1,544 | 2023-01-01 to 2026-01-01 |               5 of 26 | fail      |
| Hampden    | 25013 |    23 |  10,140 |  1,948 |  6,258 |  1,934 |               7,197 | 2023-01-01 to 2026-01-01 |               2 of 23 | fail      |
| Hampshire  | 25015 |    20 |   3,673 |    594 |  2,458 |    621 |               2,184 | 2018-01-01 to 2026-01-01 |               2 of 20 | fail      |
| Middlesex  | 25017 |    54 |  26,930 |  5,831 | 15,709 |  5,391 |              18,041 | 2023-01-01 to 2026-01-01 |               7 of 54 | fail      |
| Nantucket  | 25019 |     1 |     686 |     35 |    625 |     26 |                 506 | 2025-01-01               |                0 of 1 | fail      |
| Norfolk    | 25021 |    28 |  11,839 |  2,295 |  7,125 |  2,419 |               8,069 | 2021-01-01 to 2026-01-01 |               7 of 28 | fail      |
| Plymouth   | 25023 |    27 |  10,313 |  1,188 |  6,971 |  2,154 |               6,676 | 2024-01-01 to 2026-01-01 |               6 of 27 | fail      |
| Suffolk    | 25025 |     3 |   2,105 |    808 |  1,125 |    172 |               1,340 | 2025-01-01               |                0 of 3 | fail      |
| Worcester  | 25027 |    60 |  18,081 |  4,348 |  9,633 |  4,100 |              11,744 | 2024-01-01 to 2026-01-01 |              14 of 60 | fail      |
| Total      |       |   350 | 127,922 | 26,189 | 77,681 | 24,054 |              83,225 | 2017-01-01 to 2026-01-01 |             66 of 350 | fail      |

Category columns count current category facts. Essex's three category figures sum to 14,951 and
Middlesex's to 26,931 because one parcel in each county has two category facts. The parcel column is
distinct parcels, 14,950 and 26,930, which is what the record states.

Situs, value, area, year built, and organisation-owner rates, counted from the same registry:

| County     | Parcels |   Situs | Market value | Land area | Building area | Year built | Organisation owner |
| ---------- | ------: | ------: | -----------: | --------: | ------------: | ---------: | -----------------: |
| Barnstable |   8,600 | 100.00% |       99.48% |    65.73% |        83.55% |     82.57% |             59.57% |
| Berkshire  |   3,990 | 100.00% |       99.85% |    96.39% |        65.96% |     66.04% |             64.59% |
| Bristol    |  13,148 |  99.98% |       99.99% |    93.63% |        77.86% |     78.03% |             57.90% |
| Dukes      |   1,024 | 100.00% |      100.00% |    52.34% |        84.57% |     84.57% |             53.22% |
| Essex      |  14,950 | 100.00% |       99.95% |    82.10% |        79.57% |     84.13% |             67.33% |
| Franklin   |   2,443 | 100.00% |       99.88% |    96.07% |        57.43% |     60.87% |             63.20% |
| Hampden    |  10,140 | 100.00% |       99.91% |    95.27% |        73.71% |     75.48% |             70.98% |
| Hampshire  |   3,673 | 100.00% |       99.75% |    88.21% |        65.31% |     42.96% |             59.46% |
| Middlesex  |  26,930 | 100.00% |       99.77% |    83.10% |        77.89% |     81.52% |             66.99% |
| Nantucket  |     686 | 100.00% |      100.00% |    65.89% |        78.13% |     78.13% |             73.76% |
| Norfolk    |  11,839 | 100.00% |       99.82% |    84.89% |        78.87% |     77.23% |             68.16% |
| Plymouth   |  10,313 | 100.00% |       99.92% |    84.94% |        73.90% |     59.09% |             64.73% |
| Suffolk    |   2,105 | 100.00% |      100.00% |    93.92% |        78.67% |     78.72% |             63.66% |
| Worcester  |  18,081 | 100.00% |       99.92% |    95.25% |        74.74% |     74.87% |             64.95% |
| Total      | 127,922 | 100.00% |       99.85% |    86.54% |        76.40% |     75.89% |             65.06% |

## Per town

FY is the file's `FY` column. As-of is 1 January of the year before that FY. Age is days before 2026-11-06.
In-scope records are assessor rows the Massachusetts mapping keeps; 18 of them repeat a `PROP_ID`, so the
parcel total is 127,922 rather than 127,940. Bucket date is the S3 `Last-Modified` date.

| Town                     | County FIPS |   FY | As-of      | Age on 2026-11-06 | Bucket date | In-scope records | sha16              |
| ------------------------ | ----------- | ---: | ---------- | ----------------: | ----------- | ---------------: | ------------------ |
| Abington (M001)          | 25023       | 2026 | 2025-01-01 |               674 | 2026-06-25  |              329 | `0a8fa003102d5a39` |
| Acton (M002)             | 25017       | 2026 | 2025-01-01 |               674 | 2026-08-27  |              462 | `7bdf0849abe93eb7` |
| Acushnet (M003)          | 25005       | 2027 | 2026-01-01 |               309 | 2026-08-27  |              113 | `9aef79150fe1ecbc` |
| Adams (M004)             | 25003       | 2026 | 2025-01-01 |               674 | 2026-06-25  |              328 | `c315aad625c8fb37` |
| Agawam (M005)            | 25013       | 2026 | 2025-01-01 |               674 | 2026-05-22  |              543 | `34836b3fe0f4a40c` |
| Alford (M006)            | 25003       | 2027 | 2026-01-01 |               309 | 2026-07-22  |                1 | `81b7739a725877ef` |
| Amesbury (M007)          | 25009       | 2026 | 2025-01-01 |               674 | 2025-09-18  |              398 | `fb4ddfacdb477766` |
| Amherst (M008)           | 25015       | 2026 | 2025-01-01 |               674 | 2026-05-22  |              351 | `1ac11cd6b10693cb` |
| Andover (M009)           | 25009       | 2026 | 2025-01-01 |               674 | 2026-08-27  |              446 | `389df8466c302d50` |
| Arlington (M010)         | 25017       | 2026 | 2025-01-01 |               674 | 2026-03-31  |              537 | `d87d7231fcb037ea` |
| Ashburnham (M011)        | 25027       | 2025 | 2024-01-01 |              1040 | 2025-08-19  |               67 | `da3c49dcfb2ea221` |
| Ashby (M012)             | 25017       | 2027 | 2026-01-01 |               309 | 2026-08-27  |               28 | `9c9417f3267b61c0` |
| Ashfield (M013)          | 25011       | 2024 | 2023-01-01 |              1405 | 2025-03-25  |               23 | `5dbcbb2743056930` |
| Ashland (M014)           | 25017       | 2026 | 2025-01-01 |               674 | 2026-09-29  |              272 | `56c3078f38227bdc` |
| Athol (M015)             | 25027       | 2026 | 2025-01-01 |               674 | 2026-05-22  |              359 | `9aca07dcfb503b96` |
| Attleboro (M016)         | 25005       | 2026 | 2025-01-01 |               674 | 2026-07-22  |              967 | `426decc97a9daf0d` |
| Auburn (M017)            | 25027       | 2026 | 2025-01-01 |               674 | 2026-05-22  |              461 | `2b2641df0e4690d2` |
| Avon (M018)              | 25021       | 2026 | 2025-01-01 |               674 | 2026-06-25  |              228 | `845fa3d49b4413b1` |
| Ayer (M019)              | 25017       | 2026 | 2025-01-01 |               674 | 2025-08-19  |              358 | `9d3b881ab763da9f` |
| Barnstable (M020)        | 25001       | 2026 | 2025-01-01 |               674 | 2026-03-31  |            1,844 | `be4956a9a43e9764` |
| Barre (M021)             | 25027       | 2026 | 2025-01-01 |               674 | 2026-04-28  |              128 | `8a593e906110d946` |
| Becket (M022)            | 25003       | 2026 | 2025-01-01 |               674 | 2025-08-19  |               23 | `0dcaf4def8ff7f2e` |
| Bedford (M023)           | 25017       | 2025 | 2024-01-01 |              1040 | 2024-08-22  |              190 | `c21c66da6e0623bb` |
| Belchertown (M024)       | 25015       | 2026 | 2025-01-01 |               674 | 2026-01-29  |              179 | `5d013d7112bcac49` |
| Bellingham (M025)        | 25021       | 2026 | 2025-01-01 |               674 | 2025-12-24  |              299 | `5b3e222518bf6bd9` |
| Belmont (M026)           | 25017       | 2024 | 2023-01-01 |              1405 | 2024-02-06  |              244 | `90c63729976c6ebd` |
| Berkley (M027)           | 25005       | 2026 | 2025-01-01 |               674 | 2025-12-24  |               50 | `1a0dd0e6e1f19046` |
| Berlin (M028)            | 25027       | 2026 | 2025-01-01 |               674 | 2026-04-28  |               77 | `5bd0efab115d6f52` |
| Bernardston (M029)       | 25011       | 2026 | 2025-01-01 |               674 | 2026-06-25  |               52 | `96cb11a65f66ad46` |
| Beverly (M030)           | 25009       | 2027 | 2026-01-01 |               309 | 2026-07-22  |              744 | `0d91425ccf61ff0a` |
| Billerica (M031)         | 25017       | 2026 | 2025-01-01 |               674 | 2026-03-31  |              893 | `bd47850fd113ec57` |
| Blackstone (M032)        | 25027       | 2026 | 2025-01-01 |               674 | 2025-08-19  |              187 | `dfaf697f5e1e0e48` |
| Blandford (M033)         | 25013       | 2027 | 2026-01-01 |               309 | 2026-07-22  |               10 | `4ea09caf3cd20002` |
| Bolton (M034)            | 25027       | 2026 | 2025-01-01 |               674 | 2026-05-22  |               46 | `eac36f523bc1da76` |
| Bourne (M036)            | 25001       | 2024 | 2023-01-01 |              1405 | 2025-03-25  |              728 | `776f5fedff3fa14e` |
| Boxborough (M037)        | 25017       | 2027 | 2026-01-01 |               309 | 2026-08-27  |              126 | `8dfd898959fe6afd` |
| Boxford (M038)           | 25009       | 2026 | 2025-01-01 |               674 | 2025-12-24  |               23 | `5f8ba68c9e2e5e26` |
| Boylston (M039)          | 25027       | 2027 | 2026-01-01 |               309 | 2026-07-22  |               73 | `2b07d4e8551cef44` |
| Braintree (M040)         | 25021       | 2025 | 2024-01-01 |              1040 | 2025-04-28  |              675 | `334cfd601a7e7461` |
| Brewster (M041)          | 25001       | 2027 | 2026-01-01 |               309 | 2026-10-30  |              212 | `0711afef42ee2d3e` |
| Bridgewater (M042)       | 25023       | 2026 | 2025-01-01 |               674 | 2026-05-22  |              437 | `2b985efaa3a71ca7` |
| Brimfield (M043)         | 25013       | 2026 | 2025-01-01 |               674 | 2026-05-22  |               89 | `d2ccd49595ff9560` |
| Brockton (M044)          | 25023       | 2025 | 2024-01-01 |              1040 | 2025-08-19  |            2,072 | `c5ae50b98b8312b0` |
| Brookfield (M045)        | 25027       | 2026 | 2025-01-01 |               674 | 2026-07-22  |               43 | `87562074aeaa56fe` |
| Brookline (M046)         | 25021       | 2027 | 2026-01-01 |               309 | 2026-07-22  |              787 | `f8eea9c9f9888587` |
| Buckland (M047)          | 25011       | 2026 | 2025-01-01 |               674 | 2026-06-25  |               54 | `f412c2802a12417f` |
| Burlington (M048)        | 25017       | 2026 | 2025-01-01 |               674 | 2026-05-22  |              508 | `3bf3b16b4eea9da0` |
| Cambridge (M049)         | 25017       | 2026 | 2025-01-01 |               674 | 2025-12-24  |            1,987 | `fca6ceb1816f16bb` |
| Canton (M050)            | 25021       | 2026 | 2025-01-01 |               674 | 2026-09-29  |              486 | `18b6ecaf494a0b75` |
| Carlisle (M051)          | 25017       | 2026 | 2025-01-01 |               674 | 2026-03-31  |               12 | `352be73209583613` |
| Carver (M052)            | 25023       | 2025 | 2024-01-01 |              1040 | 2025-07-28  |              228 | `e6a8f8da502b280a` |
| Charlemont (M053)        | 25011       | 2026 | 2025-01-01 |               674 | 2026-05-22  |               36 | `c090b33bfdc60b31` |
| Charlton (M054)          | 25027       | 2026 | 2025-01-01 |               674 | 2025-12-24  |              266 | `1607f79e3b1ab399` |
| Chatham (M055)           | 25001       | 2018 | 2017-01-01 |              3596 | 2021-09-08  |              454 | `8f329d3f2fbb1639` |
| Chelmsford (M056)        | 25017       | 2026 | 2025-01-01 |               674 | 2026-05-22  |              666 | `8b8665d7aae78bb6` |
| Chelsea (M057)           | 25025       | 2026 | 2025-01-01 |               674 | 2026-09-29  |              875 | `8d97fb5745f3ca39` |
| Cheshire (M058)          | 25003       | 2026 | 2025-01-01 |               674 | 2026-05-22  |               48 | `2d3f1b5f1eb007c0` |
| Chester (M059)           | 25013       | 2027 | 2026-01-01 |               309 | 2026-08-27  |               28 | `35335f95555660cf` |
| Chesterfield (M060)      | 25015       | 2026 | 2025-01-01 |               674 | 2026-05-22  |               11 | `df3528e6533ae2b5` |
| Chicopee (M061)          | 25013       | 2026 | 2025-01-01 |               674 | 2026-04-28  |            1,378 | `3bba4a64240babd7` |
| Chilmark (M062)          | 25007       | 2026 | 2025-01-01 |               674 | 2026-05-22  |               22 | `571805c606f58ab0` |
| Clarksburg (M063)        | 25003       | 2025 | 2024-01-01 |              1040 | 2025-05-30  |               14 | `16c7b34e994333b2` |
| Clinton (M064)           | 25027       | 2027 | 2026-01-01 |               309 | 2026-08-27  |              340 | `4e87c7d12106c26e` |
| Cohasset (M065)          | 25021       | 2027 | 2026-01-01 |               309 | 2026-08-27  |              130 | `5eaaa9566a0cdfba` |
| Colrain (M066)           | 25011       | 2026 | 2025-01-01 |               674 | 2026-03-31  |               30 | `3b9b4443e5efc830` |
| Concord (M067)           | 25017       | 2026 | 2025-01-01 |               674 | 2026-07-22  |              375 | `1c78d39a2a9b4164` |
| Conway (M068)            | 25011       | 2026 | 2025-01-01 |               674 | 2025-11-24  |               30 | `419fea6c60eca978` |
| Cummington (M069)        | 25015       | 2026 | 2025-01-01 |               674 | 2026-04-28  |               18 | `dfae61e0200368c6` |
| Dalton (M070)            | 25003       | 2026 | 2025-01-01 |               674 | 2026-02-27  |              131 | `5e19b377ec5b8742` |
| Danvers (M071)           | 25009       | 2025 | 2024-01-01 |              1040 | 2024-10-22  |              749 | `1ed6d449a3e16501` |
| Dartmouth (M072)         | 25005       | 2026 | 2025-01-01 |               674 | 2025-10-22  |              682 | `efed977e018402c1` |
| Dedham (M073)            | 25021       | 2026 | 2025-01-01 |               674 | 2025-09-18  |              367 | `d82112ba4a505438` |
| Deerfield (M074)         | 25011       | 2026 | 2025-01-01 |               674 | 2026-03-31  |              247 | `bf1a2fff1d20bc5a` |
| Dennis (M075)            | 25001       | 2026 | 2025-01-01 |               674 | 2026-09-29  |              746 | `b62f4c9d2325ec67` |
| Dighton (M076)           | 25005       | 2025 | 2024-01-01 |              1040 | 2026-06-25  |              105 | `7d1a46294e6930e0` |
| Douglas (M077)           | 25027       | 2027 | 2026-01-01 |               309 | 2026-09-29  |              143 | `9442c4d1e579d6b3` |
| Dover (M078)             | 25021       | 2027 | 2026-01-01 |               309 | 2026-08-27  |               29 | `de42c88efa1708a7` |
| Dracut (M079)            | 25017       | 2025 | 2024-01-01 |              1040 | 2026-01-29  |              499 | `4ace946c89c770ac` |
| Dudley (M080)            | 25027       | 2026 | 2025-01-01 |               674 | 2026-03-31  |              236 | `fcf3837baddcb3a1` |
| Dunstable (M081)         | 25017       | 2026 | 2025-01-01 |               674 | 2026-05-22  |               23 | `7b02d33e07a9cf31` |
| Duxbury (M082)           | 25023       | 2026 | 2025-01-01 |               674 | 2026-05-22  |              124 | `9c66f6e5011f5f08` |
| Eastbridgewater (M083)   | 25023       | 2026 | 2025-01-01 |               674 | 2026-05-22  |              304 | `0c6a5aeaf5a3fd0b` |
| Eastbrookfield (M084)    | 25027       | 2027 | 2026-01-01 |               309 | 2026-09-29  |               53 | `3bfeb99637b97cce` |
| Eastlongmeadow (M085)    | 25013       | 2026 | 2025-01-01 |               674 | 2025-07-28  |              373 | `45210bd54c2ac51a` |
| Eastham (M086)           | 25001       | 2024 | 2023-01-01 |              1405 | 2026-10-30  |              176 | `8539b267756d32e7` |
| Easthampton (M087)       | 25015       | 2026 | 2025-01-01 |               674 | 2026-05-22  |              439 | `3f7fb654adf23f79` |
| Easton (M088)            | 25005       | 2026 | 2025-01-01 |               674 | 2026-04-28  |              429 | `49c10d310b18cfa6` |
| Edgartown (M089)         | 25007       | 2027 | 2026-01-01 |               309 | 2026-09-29  |              383 | `76abe33bcbe9ecf0` |
| Egremont (M090)          | 25003       | 2025 | 2024-01-01 |              1040 | 2025-02-28  |               16 | `36042f7f64c6af2c` |
| Erving (M091)            | 25011       | 2026 | 2025-01-01 |               674 | 2026-04-28  |               94 | `6f495c4288a03770` |
| Essex (M092)             | 25009       | 2027 | 2026-01-01 |               309 | 2026-09-29  |               83 | `a21a005064edbc57` |
| Everett (M093)           | 25017       | 2026 | 2025-01-01 |               674 | 2025-08-19  |              822 | `5c76e4246d531af9` |
| Fairhaven (M094)         | 25005       | 2025 | 2024-01-01 |              1040 | 2025-02-28  |              346 | `d57326de58ccd4e5` |
| Fallriver (M095)         | 25005       | 2026 | 2025-01-01 |               674 | 2026-01-29  |            3,168 | `6667667ea81b5b55` |
| Falmouth (M096)          | 25001       | 2022 | 2021-01-01 |              2135 | 2026-08-17  |              846 | `3f34b7813c555f6b` |
| Fitchburg (M097)         | 25027       | 2027 | 2026-01-01 |               309 | 2026-06-26  |            1,265 | `25930b434bb90bed` |
| Florida (M098)           | 25003       | 2025 | 2024-01-01 |              1040 | 2025-11-24  |               21 | `fd5faffb3f9fdc94` |
| Foxborough (M099)        | 25021       | 2025 | 2024-01-01 |              1040 | 2025-03-25  |              483 | `04d98e14fc331f1a` |
| Framingham (M100)        | 25017       | 2025 | 2024-01-01 |              1040 | 2024-12-31  |            1,195 | `22cfb686ef36cf07` |
| Franklin (M101)          | 25021       | 2027 | 2026-01-01 |               309 | 2026-09-29  |              465 | `0b2a63ba80d894a3` |
| Freetown (M102)          | 25005       | 2026 | 2025-01-01 |               674 | 2026-03-31  |              147 | `8b8691cc0126ef97` |
| Gardner (M103)           | 25027       | 2026 | 2025-01-01 |               674 | 2026-05-22  |              605 | `c29507ffa6ff1d74` |
| Aquinnah (M104)          | 25007       | 2025 | 2024-01-01 |              1040 | 2025-05-30  |               18 | `f45b1208d03d89d5` |
| Georgetown (M105)        | 25009       | 2026 | 2025-01-01 |               674 | 2026-05-22  |              155 | `7f25599ea31f4917` |
| Gill (M106)              | 25011       | 2026 | 2025-01-01 |               674 | 2026-09-29  |               75 | `a08e9df08b684812` |
| Gloucester (M107)        | 25009       | 2026 | 2025-01-01 |               674 | 2026-09-17  |              919 | `5488b74d32e92e90` |
| Goshen (M108)            | 25015       | 2026 | 2025-01-01 |               674 | 2025-11-24  |               22 | `04746722bc3596f9` |
| Gosnold (M109)           | 25007       | 2026 | 2025-01-01 |               674 | 2026-03-31  |                5 | `2a1c04614e79d070` |
| Grafton (M110)           | 25027       | 2026 | 2025-01-01 |               674 | 2026-10-30  |              315 | `4acf887ce387d829` |
| Granby (M111)            | 25015       | 2026 | 2025-01-01 |               674 | 2026-06-25  |               96 | `ca0d46925dcabd0e` |
| Granville (M112)         | 25013       | 2025 | 2024-01-01 |              1040 | 2025-07-28  |               27 | `5af90dcec62951cc` |
| Greatbarrington (M113)   | 25003       | 2027 | 2026-01-01 |               309 | 2026-07-22  |              346 | `a6b4095b417a3d22` |
| Greenfield (M114)        | 25011       | 2027 | 2026-01-01 |               309 | 2026-08-27  |              641 | `0e863b8d6c42665d` |
| Groton (M115)            | 25017       | 2026 | 2025-01-01 |               674 | 2026-04-28  |              112 | `54823d8fec29286c` |
| Groveland (M116)         | 25009       | 2026 | 2025-01-01 |               674 | 2026-02-27  |               83 | `61519ab3e193d247` |
| Hadley (M117)            | 25015       | 2026 | 2025-01-01 |               674 | 2026-07-22  |              379 | `199869889e7fc842` |
| Halifax (M118)           | 25023       | 2026 | 2025-01-01 |               674 | 2026-09-29  |               88 | `17b0028f885d0c8e` |
| Hamilton (M119)          | 25009       | 2026 | 2025-01-01 |               674 | 2026-05-22  |               55 | `f174cec61d10fca7` |
| Hampden (M120)           | 25013       | 2026 | 2025-01-01 |               674 | 2026-05-22  |               62 | `f1e3642a630de05e` |
| Hancock (M121)           | 25003       | 2026 | 2025-01-01 |               674 | 2026-03-31  |               40 | `95a1f2a8968f8713` |
| Hanover (M122)           | 25023       | 2025 | 2024-01-01 |              1040 | 2024-11-26  |              431 | `360f014c1ff8efc0` |
| Hanson (M123)            | 25023       | 2026 | 2025-01-01 |               674 | 2026-08-27  |              148 | `9c83ffbc30e64e2e` |
| Hardwick (M124)          | 25027       | 2026 | 2025-01-01 |               674 | 2025-09-18  |               83 | `94488ccba45043fa` |
| Harvard (M125)           | 25027       | 2027 | 2026-01-01 |               309 | 2026-09-29  |               60 | `cd32874ec0a891de` |
| Harwich (M126)           | 25001       | 2026 | 2025-01-01 |               674 | 2026-06-25  |              411 | `6ce32f5b07018122` |
| Hatfield (M127)          | 25015       | 2027 | 2026-01-01 |               309 | 2026-08-27  |              268 | `e3a0e1c6fc254058` |
| Haverhill (M128)         | 25009       | 2025 | 2024-01-01 |              1040 | 2024-10-22  |            1,172 | `b8f79b029a1d811a` |
| Hawley (M129)            | 25011       | 2026 | 2025-01-01 |               674 | 2025-11-24  |                0 | `3c695e1a27dc479a` |
| Heath (M130)             | 25011       | 2026 | 2025-01-01 |               674 | 2026-04-28  |                6 | `bc5cc91252e67bfd` |
| Hingham (M131)           | 25023       | 2027 | 2026-01-01 |               309 | 2026-08-27  |              404 | `e6e935995e69518a` |
| Hinsdale (M132)          | 25003       | 2026 | 2025-01-01 |               674 | 2026-05-22  |               64 | `684c17f7d0d0789d` |
| Holbrook (M133)          | 25021       | 2022 | 2021-01-01 |              2135 | 2022-12-23  |              318 | `187f6650fb9d4072` |
| Holden (M134)            | 25027       | 2026 | 2025-01-01 |               674 | 2026-03-31  |              178 | `d0c0e2129ce7747d` |
| Holland (M135)           | 25013       | 2026 | 2025-01-01 |               674 | 2026-05-22  |               21 | `00c547bfc8f82aec` |
| Holliston (M136)         | 25017       | 2025 | 2024-01-01 |              1040 | 2025-07-28  |              298 | `603444b0c0f85232` |
| Holyoke (M137)           | 25013       | 2026 | 2025-01-01 |               674 | 2026-04-28  |            1,176 | `d43f304ac6a6c1cf` |
| Hopedale (M138)          | 25027       | 2027 | 2026-01-01 |               309 | 2026-09-29  |              161 | `4f6109831649658a` |
| Hopkinton (M139)         | 25017       | 2025 | 2024-01-01 |              1040 | 2025-05-30  |              162 | `2f39b46f30f3eb35` |
| Hubbardston (M140)       | 25027       | 2027 | 2026-01-01 |               309 | 2026-10-30  |               44 | `e5647f3762ec9cf9` |
| Hudson (M141)            | 25017       | 2026 | 2025-01-01 |               674 | 2025-11-24  |              432 | `74d40c0957843a0e` |
| Hull (M142)              | 25023       | 2027 | 2026-01-01 |               309 | 2026-07-22  |              133 | `0fa87c6877a01cef` |
| Huntington (M143)        | 25015       | 2026 | 2025-01-01 |               674 | 2026-02-27  |               31 | `9138c9cc9d3db93d` |
| Ipswich (M144)           | 25009       | 2026 | 2025-01-01 |               674 | 2025-08-19  |              310 | `d2455b6fb73cf11e` |
| Kingston (M145)          | 25023       | 2026 | 2025-01-01 |               674 | 2026-08-27  |              250 | `462d0a35024e9179` |
| Lakeville (M146)         | 25023       | 2027 | 2026-01-01 |               309 | 2026-08-27  |              154 | `2453fbcbd81d15d5` |
| Lancaster (M147)         | 25027       | 2026 | 2025-01-01 |               674 | 2025-12-24  |              181 | `02174eb680c6766e` |
| Lanesborough (M148)      | 25003       | 2026 | 2025-01-01 |               674 | 2026-04-28  |              104 | `68f1b4912ad5a1d6` |
| Lawrence (M149)          | 25009       | 2026 | 2025-01-01 |               674 | 2026-05-22  |            1,868 | `53536d465b1a13dd` |
| Lee (M150)               | 25003       | 2026 | 2025-01-01 |               674 | 2026-05-22  |              248 | `3ff267ed4c2e6ed4` |
| Leicester (M151)         | 25027       | 2026 | 2025-01-01 |               674 | 2026-06-25  |              213 | `9135ed0f80af9e1f` |
| Lenox (M152)             | 25003       | 2026 | 2025-01-01 |               674 | 2026-04-28  |              166 | `cfe183832f0ef986` |
| Leominster (M153)        | 25027       | 2026 | 2025-01-01 |               674 | 2025-12-24  |            1,195 | `9b0108c402bc9ce1` |
| Leverett (M154)          | 25011       | 2026 | 2025-01-01 |               674 | 2026-06-25  |               16 | `6ea73c66965a1165` |
| Lexington (M155)         | 25017       | 2026 | 2025-01-01 |               674 | 2026-04-28  |              481 | `323de212ca05e184` |
| Leyden (M156)            | 25011       | 2025 | 2024-01-01 |              1040 | 2024-11-26  |                4 | `be422bac7b04299f` |
| Lincoln (M157)           | 25017       | 2027 | 2026-01-01 |               309 | 2026-10-30  |               19 | `88de5f9652c5cf21` |
| Littleton (M158)         | 25017       | 2026 | 2025-01-01 |               674 | 2026-06-25  |              206 | `cbaab34655fd3e91` |
| Longmeadow (M159)        | 25013       | 2026 | 2025-01-01 |               674 | 2026-08-31  |               39 | `d95590f46a6115b8` |
| Lowell (M160)            | 25017       | 2026 | 2025-01-01 |               674 | 2025-11-24  |            2,446 | `0bee224a3524bba6` |
| Ludlow (M161)            | 25013       | 2026 | 2025-01-01 |               674 | 2026-06-25  |              470 | `7d85cc1845cd104a` |
| Lunenburg (M162)         | 25027       | 2027 | 2026-01-01 |               309 | 2026-09-29  |              181 | `ef6d8582e9ee694a` |
| Lynn (M163)              | 25009       | 2027 | 2026-01-01 |               309 | 2026-10-30  |            1,311 | `04b0f71da8ee5da9` |
| Lynnfield (M164)         | 25009       | 2026 | 2025-01-01 |               674 | 2026-02-27  |              145 | `59d9064f42147a9d` |
| Malden (M165)            | 25017       | 2026 | 2025-01-01 |               674 | 2026-06-25  |              760 | `69ccba4f8873bce8` |
| Manchester (M166)        | 25009       | 2027 | 2026-01-01 |               309 | 2026-08-27  |              113 | `b75e8a736135e4c2` |
| Mansfield (M167)         | 25005       | 2026 | 2025-01-01 |               674 | 2026-02-27  |              402 | `0a052cf78a9c8619` |
| Marblehead (M168)        | 25009       | 2027 | 2026-01-01 |               309 | 2026-10-30  |              327 | `3e0b87a8db89a894` |
| Marion (M169)            | 25023       | 2026 | 2025-01-01 |               674 | 2026-01-29  |              150 | `077f326c265a864e` |
| Marlborough (M170)       | 25017       | 2025 | 2024-01-01 |              1040 | 2025-06-24  |              939 | `54be23c04b0530d7` |
| Marshfield (M171)        | 25023       | 2026 | 2025-01-01 |               674 | 2025-09-18  |              424 | `ffb2263eebd177d5` |
| Mashpee (M172)           | 25001       | 2027 | 2026-01-01 |               309 | 2026-10-30  |              470 | `49ec81dd4682aaa8` |
| Mattapoisett (M173)      | 25023       | 2027 | 2026-01-01 |               309 | 2026-09-29  |              166 | `e542fb0bd1adb2b0` |
| Maynard (M174)           | 25017       | 2026 | 2025-01-01 |               674 | 2025-09-18  |              208 | `0366cc46978c0b7f` |
| Medfield (M175)          | 25021       | 2026 | 2025-01-01 |               674 | 2026-02-27  |              177 | `b980c402aefecaa4` |
| Medford (M176)           | 25017       | 2026 | 2025-01-01 |               674 | 2026-03-31  |              790 | `aef001adfd3e2f4c` |
| Medway (M177)            | 25021       | 2026 | 2025-01-01 |               674 | 2026-07-22  |              245 | `d71d3abfcb8bbcd9` |
| Melrose (M178)           | 25017       | 2026 | 2025-01-01 |               674 | 2026-04-28  |              326 | `c91a0147045e7a3c` |
| Mendon (M179)            | 25027       | 2026 | 2025-01-01 |               674 | 2026-03-31  |              130 | `2c32aa9804382728` |
| Merrimac (M180)          | 25009       | 2026 | 2025-01-01 |               674 | 2026-07-22  |               73 | `40e472143366a434` |
| Methuen (M181)           | 25009       | 2025 | 2024-01-01 |              1040 | 2025-05-30  |              740 | `4727ca0b86a5d01a` |
| Middleborough (M182)     | 25023       | 2026 | 2025-01-01 |               674 | 2026-05-22  |              681 | `2f07ffcab8b54aae` |
| Middlefield (M183)       | 25015       | 2026 | 2025-01-01 |               674 | 2025-11-24  |                7 | `bf54ed9b242cd680` |
| Middleton (M184)         | 25009       | 2026 | 2025-01-01 |               674 | 2026-02-27  |              234 | `f7bc0258aac7a0c8` |
| Milford (M185)           | 25027       | 2026 | 2025-01-01 |               674 | 2026-04-28  |              727 | `eeb39e4584ce55bb` |
| Millbury (M186)          | 25027       | 2025 | 2024-01-01 |              1040 | 2026-02-27  |              270 | `564ed46db70297f8` |
| Millis (M187)            | 25021       | 2026 | 2025-01-01 |               674 | 2026-04-28  |              148 | `e9398352b71a09de` |
| Millville (M188)         | 25027       | 2026 | 2025-01-01 |               674 | 2025-11-24  |               37 | `2997f45020e21d42` |
| Milton (M189)            | 25021       | 2025 | 2024-01-01 |              1040 | 2025-04-29  |              134 | `fc38113405824b38` |
| Monroe (M190)            | 25011       | 2025 | 2024-01-01 |              1040 | 2025-04-28  |               14 | `227b12c2f51a29c8` |
| Monson (M191)            | 25013       | 2026 | 2025-01-01 |               674 | 2026-02-27  |              156 | `5c25043b819fbffb` |
| Montague (M192)          | 25011       | 2026 | 2025-01-01 |               674 | 2026-03-31  |              393 | `9af3ce6425f2ad19` |
| Monterey (M193)          | 25003       | 2026 | 2025-01-01 |               674 | 2026-06-25  |               10 | `7dd19811f22027cf` |
| Montgomery (M194)        | 25013       | 2025 | 2024-01-01 |              1040 | 2024-09-19  |                5 | `560d407fe2397cd8` |
| Mountwashington (M195)   | 25003       | 2022 | 2021-01-01 |              2135 | 2022-04-24  |                2 | `dd24c2c92a15867d` |
| Nahant (M196)            | 25009       | 2027 | 2026-01-01 |               309 | 2026-09-29  |               15 | `222569b92ad6aa25` |
| Nantucket (M197)         | 25019       | 2026 | 2025-01-01 |               674 | 2026-06-25  |              686 | `afc1ac0dd9a04c62` |
| Natick (M198)            | 25017       | 2027 | 2026-01-01 |               309 | 2026-09-29  |              621 | `985f29140ec99d16` |
| Needham (M199)           | 25021       | 2027 | 2026-01-01 |               309 | 2026-10-30  |              428 | `3d0a378dfadce528` |
| Newashford (M200)        | 25003       | 2026 | 2025-01-01 |               674 | 2026-05-22  |                7 | `1afd0b0332d1c3d7` |
| Newbedford (M201)        | 25005       | 2027 | 2026-01-01 |               309 | 2026-09-29  |            2,820 | `6463e481ec2aa7bc` |
| Newbraintree (M202)      | 25027       | 2026 | 2025-01-01 |               674 | 2026-05-22  |               15 | `ce9805112f8d388c` |
| Newmarlborough (M203)    | 25003       | 2025 | 2024-01-01 |              1040 | 2025-06-24  |               34 | `5b4370ca95211891` |
| Newsalem (M204)          | 25011       | 2027 | 2026-01-01 |               309 | 2026-10-30  |               10 | `c3460747b853a9da` |
| Newbury (M205)           | 25009       | 2026 | 2025-01-01 |               674 | 2026-03-31  |               86 | `76cf2b399e2481bf` |
| Newburyport (M206)       | 25009       | 2026 | 2025-01-01 |               674 | 2026-03-31  |              670 | `68d9b34fc7c0a206` |
| Newton (M207)            | 25017       | 2026 | 2025-01-01 |               674 | 2025-12-24  |              890 | `5338ee105a315d23` |
| Norfolk (M208)           | 25021       | 2026 | 2025-01-01 |               674 | 2026-06-25  |              143 | `62bdb866c1d36e55` |
| Northadams (M209)        | 25003       | 2025 | 2024-01-01 |              1040 | 2025-06-24  |              495 | `65b4b5df64bbf284` |
| Northandover (M210)      | 25009       | 2026 | 2025-01-01 |               674 | 2026-06-25  |              635 | `f3694983ce4b8bb8` |
| Northattleborough (M211) | 25005       | 2027 | 2026-01-01 |               309 | 2026-08-28  |              625 | `bdb35d8cf97c5748` |
| Northbrookfield (M212)   | 25027       | 2026 | 2025-01-01 |               674 | 2026-05-22  |              103 | `a5fb4db540ad7377` |
| Northreading (M213)      | 25017       | 2026 | 2025-01-01 |               674 | 2026-06-25  |              317 | `a6a2590a26df9587` |
| Northampton (M214)       | 25015       | 2026 | 2025-01-01 |               674 | 2026-02-27  |            1,104 | `c8009b81f1595f62` |
| Northborough (M215)      | 25027       | 2026 | 2025-01-01 |               674 | 2026-01-29  |              320 | `f8697dd8ac584a7b` |
| Northbridge (M216)       | 25027       | 2027 | 2026-01-01 |               309 | 2026-08-27  |              365 | `574ff31bd468a105` |
| Northfield (M217)        | 25011       | 2025 | 2024-01-01 |              1040 | 2025-04-28  |              106 | `60df509d95bb5226` |
| Norton (M218)            | 25005       | 2026 | 2025-01-01 |               674 | 2026-07-22  |              326 | `c74e4a45a86ab203` |
| Norwell (M219)           | 25023       | 2026 | 2025-01-01 |               674 | 2025-08-19  |              290 | `66a0ca72384d0da6` |
| Norwood (M220)           | 25021       | 2025 | 2024-01-01 |              1040 | 2025-08-19  |              730 | `ca116239272b40fa` |
| Oakbluffs (M221)         | 25007       | 2026 | 2025-01-01 |               674 | 2026-06-25  |              183 | `08344ac200e19cf9` |
| Oakham (M222)            | 25027       | 2025 | 2024-01-01 |              1040 | 2025-08-19  |               12 | `60b1f062b02d3859` |
| Orange (M223)            | 25011       | 2027 | 2026-01-01 |               309 | 2026-10-30  |              256 | `a1a1dd1044dd0ef9` |
| Orleans (M224)           | 25001       | 2027 | 2026-01-01 |               309 | 2026-09-29  |              485 | `887a09a6cc801018` |
| Otis (M225)              | 25003       | 2025 | 2024-01-01 |              1040 | 2025-09-18  |               48 | `237c38748d194017` |
| Oxford (M226)            | 25027       | 2026 | 2025-01-01 |               674 | 2025-10-22  |              424 | `fe3e1d39bb2df2df` |
| Palmer (M227)            | 25013       | 2026 | 2025-01-01 |               674 | 2026-05-22  |              475 | `c560688d0e796d14` |
| Paxton (M228)            | 25027       | 2025 | 2024-01-01 |              1040 | 2025-09-18  |               34 | `19fdfa7f40e276bb` |
| Peabody (M229)           | 25009       | 2026 | 2025-01-01 |               674 | 2025-12-24  |              915 | `9f5aeecf6fb83bdf` |
| Pelham (M230)            | 25015       | 2019 | 2018-01-01 |              3231 | 2021-09-08  |               16 | `74d9f4cbcf63edec` |
| Pembroke (M231)          | 25023       | 2026 | 2025-01-01 |               674 | 2026-05-22  |              285 | `69f777083bc890c3` |
| Pepperell (M232)         | 25017       | 2027 | 2026-01-01 |               309 | 2026-07-22  |              204 | `b2dc3aa5cab245d6` |
| Peru (M233)              | 25003       | 2026 | 2025-01-01 |               674 | 2026-07-22  |                3 | `760cbdbf2b60e942` |
| Petersham (M234)         | 25027       | 2026 | 2025-01-01 |               674 | 2026-05-22  |               14 | `245fa4ce426a773a` |
| Phillipston (M235)       | 25027       | 2026 | 2025-01-01 |               674 | 2026-05-22  |               25 | `67a2fb02d73dab86` |
| Pittsfield (M236)        | 25003       | 2025 | 2024-01-01 |              1040 | 2025-11-24  |            1,405 | `99da5deba47c50b3` |
| Plainfield (M237)        | 25015       | 2025 | 2024-01-01 |              1040 | 2025-11-24  |               30 | `6b9faa8d491aad39` |
| Plainville (M238)        | 25021       | 2026 | 2025-01-01 |               674 | 2026-03-31  |              265 | `d674c07c6aaa3a0e` |
| Plymouth (M239)          | 25023       | 2026 | 2025-01-01 |               674 | 2026-03-31  |            1,192 | `3fdf6378c1cec4d0` |
| Plympton (M240)          | 25023       | 2025 | 2024-01-01 |              1040 | 2025-07-28  |               59 | `ae7ba1093df275eb` |
| Princeton (M241)         | 25027       | 2025 | 2024-01-01 |              1040 | 2025-12-24  |               19 | `528bca353cf84341` |
| Provincetown (M242)      | 25001       | 2026 | 2025-01-01 |               674 | 2026-05-22  |              431 | `9cf54e9b4e26c6e1` |
| Quincy (M243)            | 25021       | 2027 | 2026-01-01 |               309 | 2026-09-29  |            1,902 | `d771e2b609400aae` |
| Randolph (M244)          | 25021       | 2027 | 2026-01-01 |               309 | 2026-08-27  |              350 | `5da4e1ab11201c5b` |
| Raynham (M245)           | 25005       | 2026 | 2025-01-01 |               674 | 2026-01-29  |              313 | `cf1e1cadd6192adb` |
| Reading (M246)           | 25017       | 2026 | 2025-01-01 |               674 | 2026-01-29  |              236 | `b9cda4ecb4e661ef` |
| Rehoboth (M247)          | 25005       | 2027 | 2026-01-01 |               309 | 2026-09-29  |              137 | `0cb6556c050d9247` |
| Revere (M248)            | 25025       | 2026 | 2025-01-01 |               674 | 2026-03-31  |              942 | `12b763147d8d727e` |
| Richmond (M249)          | 25003       | 2026 | 2025-01-01 |               674 | 2026-03-31  |               14 | `3584d528fe57841c` |
| Rochester (M250)         | 25023       | 2026 | 2025-01-01 |               674 | 2026-04-28  |               88 | `26cbc84b2caa49ea` |
| Rockland (M251)          | 25023       | 2026 | 2025-01-01 |               674 | 2026-08-27  |              419 | `0a8f7b6ef3cf0654` |
| Rockport (M252)          | 25009       | 2026 | 2025-01-01 |               674 | 2025-09-18  |              175 | `5d144e7bc2a49d49` |
| Rowe (M253)              | 25011       | 2026 | 2025-01-01 |               674 | 2026-02-27  |               83 | `cbc4d1ea9bf2dfbe` |
| Rowley (M254)            | 25009       | 2026 | 2025-01-01 |               674 | 2026-04-28  |              145 | `1d0cd112a525a13f` |
| Royalston (M255)         | 25027       | 2025 | 2024-01-01 |              1040 | 2024-07-22  |                7 | `660ad7223e22ad56` |
| Russell (M256)           | 25013       | 2026 | 2025-01-01 |               674 | 2026-08-27  |               54 | `a819cc01e96cc781` |
| Rutland (M257)           | 25027       | 2026 | 2025-01-01 |               674 | 2026-02-27  |               60 | `eb630d65935a1f54` |
| Salem (M258)             | 25009       | 2026 | 2025-01-01 |               674 | 2026-01-29  |            1,103 | `b7666f3775faf022` |
| Salisbury (M259)         | 25009       | 2026 | 2025-01-01 |               674 | 2026-03-31  |              419 | `f3031adb80cf22ce` |
| Sandisfield (M260)       | 25003       | 2026 | 2025-01-01 |               674 | 2026-04-28  |               11 | `712aeaa1a09e3ff9` |
| Sandwich (M261)          | 25001       | 2026 | 2025-01-01 |               674 | 2026-06-25  |              483 | `e4e32c4989d561ee` |
| Saugus (M262)            | 25009       | 2027 | 2026-01-01 |               309 | 2026-08-27  |              514 | `9758f6a4a5106224` |
| Savoy (M263)             | 25003       | 2025 | 2024-01-01 |              1040 | 2025-04-28  |                1 | `d3ca5713fb545dd8` |
| Scituate (M264)          | 25023       | 2026 | 2025-01-01 |               674 | 2025-11-24  |              163 | `6a573d9242031cde` |
| Seekonk (M265)           | 25005       | 2027 | 2026-01-01 |               309 | 2026-07-22  |              451 | `1dbb42dd7e4555f4` |
| Sharon (M266)            | 25021       | 2026 | 2025-01-01 |               674 | 2026-04-28  |              127 | `1f3fbe222c37d98b` |
| Sheffield (M267)         | 25003       | 2026 | 2025-01-01 |               674 | 2026-03-31  |              134 | `9bcb70c646ddd529` |
| Shelburne (M268)         | 25011       | 2026 | 2025-01-01 |               674 | 2026-06-25  |               94 | `0114fdfae7e96a26` |
| Sherborn (M269)          | 25017       | 2025 | 2024-01-01 |              1040 | 2026-02-27  |               27 | `b6ed6e57cf12faa9` |
| Shirley (M270)           | 25017       | 2026 | 2025-01-01 |               674 | 2026-06-25  |              135 | `6c120e25ba9ce9d4` |
| Shrewsbury (M271)        | 25027       | 2027 | 2026-01-01 |               309 | 2026-08-27  |              437 | `6623946b8eb2efa7` |
| Shutesbury (M272)        | 25011       | 2026 | 2025-01-01 |               674 | 2026-06-25  |                9 | `5963d4acb1cc4ffd` |
| Somerset (M273)          | 25005       | 2027 | 2026-01-01 |               309 | 2026-09-29  |              258 | `4be730917fe10543` |
| Somerville (M274)        | 25017       | 2025 | 2024-01-01 |              1040 | 2025-02-28  |            1,332 | `e9992a59482163dc` |
| Southhadley (M275)       | 25015       | 2026 | 2025-01-01 |               674 | 2026-04-28  |              291 | `88830a32dee24682` |
| Southampton (M276)       | 25015       | 2026 | 2025-01-01 |               674 | 2026-05-22  |               81 | `b1238bb1a96fbcdc` |
| Southborough (M277)      | 25027       | 2027 | 2026-01-01 |               309 | 2026-07-22  |              178 | `ee309b9c2d426baf` |
| Southbridge (M278)       | 25027       | 2025 | 2024-01-01 |              1040 | 2026-08-27  |              566 | `d97b39a0ace6ad4a` |
| Southwick (M279)         | 25013       | 2025 | 2024-01-01 |              1040 | 2025-04-28  |              175 | `60d956bc68972f92` |
| Spencer (M280)           | 25027       | 2026 | 2025-01-01 |               674 | 2026-06-25  |              249 | `00c65c88c4c465c5` |
| Springfield (M281)       | 25013       | 2026 | 2025-01-01 |               674 | 2026-01-29  |            3,017 | `9a9ab6d63c3644f2` |
| Sterling (M282)          | 25027       | 2026 | 2025-01-01 |               674 | 2025-12-24  |              195 | `18a2fd6d99e45293` |
| Stockbridge (M283)       | 25003       | 2026 | 2025-01-01 |               674 | 2026-06-25  |               51 | `a50acb1c240f3052` |
| Stoneham (M284)          | 25017       | 2024 | 2023-01-01 |              1405 | 2026-01-07  |              337 | `76671dd1318ec243` |
| Stoughton (M285)         | 25021       | 2026 | 2025-01-01 |               674 | 2026-06-25  |              788 | `e266ba93b5064c3d` |
| Stow (M286)              | 25017       | 2026 | 2025-01-01 |               674 | 2026-07-03  |               75 | `79e89331326dc539` |
| Sturbridge (M287)        | 25027       | 2027 | 2026-01-01 |               309 | 2026-08-27  |              239 | `272bd81b50bc4a46` |
| Sudbury (M288)           | 25017       | 2026 | 2025-01-01 |               674 | 2025-09-18  |              211 | `eaf0965241c66715` |
| Sunderland (M289)        | 25011       | 2026 | 2025-01-01 |               674 | 2025-09-18  |               87 | `f7e90dbe5c57324a` |
| Sutton (M290)            | 25027       | 2026 | 2025-01-01 |               674 | 2026-02-27  |              177 | `a8c33ba9dfb20383` |
| Swampscott (M291)        | 25009       | 2027 | 2026-01-01 |               309 | 2026-09-29  |              127 | `188973dd38e1b950` |
| Swansea (M292)           | 25005       | 2026 | 2025-01-01 |               674 | 2026-09-29  |              306 | `bcdf7bf400034b36` |
| Taunton (M293)           | 25005       | 2026 | 2025-01-01 |               674 | 2025-11-24  |            1,166 | `c4979bab548f86c6` |
| Templeton (M294)         | 25027       | 2026 | 2025-01-01 |               674 | 2026-03-31  |              317 | `029be52640c65d5e` |
| Tewksbury (M295)         | 25017       | 2027 | 2026-01-01 |               309 | 2026-08-27  |              733 | `37f36607a3923287` |
| Tisbury (M296)           | 25007       | 2025 | 2024-01-01 |              1040 | 2025-05-30  |              337 | `7510f739a6f237fd` |
| Tolland (M297)           | 25013       | 2026 | 2025-01-01 |               674 | 2026-02-27  |               15 | `c5ca52f47162f1a5` |
| Topsfield (M298)         | 25009       | 2026 | 2025-01-01 |               674 | 2026-03-31  |              150 | `7f5f57cab82e351b` |
| Townsend (M299)          | 25017       | 2026 | 2025-01-01 |               674 | 2025-09-18  |              113 | `1fec2a0586b76d5d` |
| Truro (M300)             | 25001       | 2027 | 2026-01-01 |               309 | 2026-10-30  |               90 | `4ab2e1fa63ff66d0` |
| Tyngsborough (M301)      | 25017       | 2025 | 2024-01-01 |              1040 | 2026-04-28  |              367 | `b33382f5ff4b8eb4` |
| Tyringham (M302)         | 25003       | 2025 | 2024-01-01 |              1040 | 2025-10-22  |                1 | `b63d45a01a3931e7` |
| Upton (M303)             | 25027       | 2026 | 2025-01-01 |               674 | 2026-01-29  |               94 | `7bae7aaadd58a96c` |
| Uxbridge (M304)          | 25027       | 2026 | 2025-01-01 |               674 | 2026-03-31  |              310 | `2904695655a61f34` |
| Wakefield (M305)         | 25017       | 2027 | 2026-01-01 |               309 | 2026-07-22  |              501 | `7887035bb164a57f` |
| Wales (M306)             | 25013       | 2025 | 2024-01-01 |              1040 | 2025-04-28  |               11 | `f5febe05b3e12f74` |
| Walpole (M307)           | 25021       | 2026 | 2025-01-01 |               674 | 2026-06-25  |              510 | `dc4f2f6ce1951bab` |
| Waltham (M308)           | 25017       | 2026 | 2025-01-01 |               674 | 2026-01-29  |            1,603 | `23e524148e456ded` |
| Ware (M309)              | 25015       | 2027 | 2026-01-01 |               309 | 2026-08-27  |              275 | `e61c17ecac8bb5c5` |
| Wareham (M310)           | 25023       | 2027 | 2026-01-01 |               309 | 2026-08-27  |              682 | `2b2d99300c93d4b1` |
| Warren (M311)            | 25027       | 2027 | 2026-01-01 |               309 | 2026-09-29  |              110 | `7e7a0e07ae891890` |
| Warwick (M312)           | 25011       | 2027 | 2026-01-01 |               309 | 2026-08-27  |                1 | `241e60b86c881a1e` |
| Washington (M313)        | 25003       | 2026 | 2025-01-01 |               674 | 2026-04-28  |               10 | `56de891d80eb3cde` |
| Watertown (M314)         | 25017       | 2026 | 2025-01-01 |               674 | 2026-03-31  |              561 | `243f50fa060453d8` |
| Wayland (M315)           | 25017       | 2024 | 2023-01-01 |              1405 | 2024-03-27  |              117 | `150980371b05db63` |
| Webster (M316)           | 25027       | 2025 | 2024-01-01 |              1040 | 2025-02-28  |              559 | `8f08983a7193048b` |
| Wellesley (M317)         | 25021       | 2026 | 2025-01-01 |               674 | 2026-02-27  |              257 | `844ea56f77fdde47` |
| Wellfleet (M318)         | 25001       | 2027 | 2026-01-01 |               309 | 2026-08-27  |              104 | `97f29055175c886f` |
| Wendell (M319)           | 25011       | 2027 | 2026-01-01 |               309 | 2026-10-30  |               15 | `f78642a31b0275af` |
| Wenham (M320)            | 25009       | 2025 | 2024-01-01 |              1040 | 2025-06-24  |               21 | `4ad978d93a5f3cf2` |
| Westboylston (M321)      | 25027       | 2026 | 2025-01-01 |               674 | 2025-09-18  |              164 | `37ce7b95dc7997cb` |
| Westbridgewater (M322)   | 25023       | 2027 | 2026-01-01 |               309 | 2026-08-27  |              310 | `9cc390c9b9e75252` |
| Westbrookfield (M323)    | 25027       | 2026 | 2025-01-01 |               674 | 2025-12-24  |               83 | `3671a7f52d54e6c5` |
| Westnewbury (M324)       | 25009       | 2026 | 2025-01-01 |               674 | 2026-05-22  |               29 | `ed745857ac54df4f` |
| Westspringfield (M325)   | 25013       | 2024 | 2023-01-01 |              1405 | 2026-08-27  |              918 | `5f2dac64bb55cb0e` |
| Weststockbridge (M326)   | 25003       | 2026 | 2025-01-01 |               674 | 2026-05-22  |               55 | `5d5243fe48818a85` |
| Westtisbury (M327)       | 25007       | 2027 | 2026-01-01 |               309 | 2026-09-29  |               76 | `8bb7a4efaca0ef4e` |
| Westborough (M328)       | 25027       | 2026 | 2025-01-01 |               674 | 2026-06-25  |              454 | `c5ff010038afcb19` |
| Westfield (M329)         | 25013       | 2025 | 2024-01-01 |              1040 | 2025-11-24  |              863 | `d0a3037dee8d3275` |
| Westford (M330)          | 25017       | 2025 | 2024-01-01 |              1040 | 2025-02-28  |              403 | `9010f6866c0be6c9` |
| Westhampton (M331)       | 25015       | 2024 | 2023-01-01 |              1405 | 2024-05-21  |               17 | `b71d19f5ae29cc0b` |
| Westminster (M332)       | 25027       | 2025 | 2024-01-01 |              1040 | 2025-08-19  |              125 | `13c4eccae4a85461` |
| Weston (M333)            | 25017       | 2026 | 2025-01-01 |               674 | 2026-10-30  |               57 | `fe09a4755bc179df` |
| Westport (M334)          | 25005       | 2026 | 2025-01-01 |               674 | 2026-01-29  |              337 | `670cf96c7d5d1297` |
| Westwood (M335)          | 25021       | 2025 | 2024-01-01 |              1040 | 2025-09-18  |              149 | `c78660057a5f99c1` |
| Weymouth (M336)          | 25021       | 2025 | 2024-01-01 |              1040 | 2025-07-28  |            1,001 | `9185a7632c911aca` |
| Whately (M337)           | 25011       | 2026 | 2025-01-01 |               674 | 2025-12-24  |               67 | `1aa32ed8b66f72d6` |
| Whitman (M338)           | 25023       | 2026 | 2025-01-01 |               674 | 2025-08-19  |              302 | `83fa5fddc4f5f240` |
| Wilbraham (M339)         | 25013       | 2026 | 2025-01-01 |               674 | 2025-11-24  |              235 | `aebcbd2ef426a0ef` |
| Williamsburg (M340)      | 25015       | 2026 | 2025-01-01 |               674 | 2026-09-03  |               55 | `1f0424e74e90ef21` |
| Williamstown (M341)      | 25003       | 2026 | 2025-01-01 |               674 | 2026-04-28  |              140 | `d7d08d79645abc5c` |
| Wilmington (M342)        | 25017       | 2025 | 2024-01-01 |              1040 | 2026-05-22  |              489 | `c4c8c68e25f80860` |
| Winchendon (M343)        | 25027       | 2026 | 2025-01-01 |               674 | 2026-04-28  |              264 | `c1093e9bacd5ebb8` |
| Winchester (M344)        | 25017       | 2026 | 2025-01-01 |               674 | 2026-03-31  |              227 | `f6a152427b94ce5b` |
| Windsor (M345)           | 25003       | 2026 | 2025-01-01 |               674 | 2026-04-28  |               19 | `456723e1ad2cb31f` |
| Winthrop (M346)          | 25025       | 2026 | 2025-01-01 |               674 | 2026-06-25  |              288 | `b66a173d2a080e33` |
| Woburn (M347)            | 25017       | 2026 | 2025-01-01 |               674 | 2026-05-22  |            1,012 | `b9881b2a02d1af85` |
| Worcester (M348)         | 25027       | 2026 | 2025-01-01 |               674 | 2026-05-22  |            4,038 | `8f92b7d358cd90dc` |
| Worthington (M349)       | 25015       | 2026 | 2025-01-01 |               674 | 2026-03-31  |                5 | `2d4645c3eefb2ba9` |
| Wrentham (M350)          | 25021       | 2026 | 2025-01-01 |               674 | 2025-12-24  |              218 | `8c0165aa6dec98dc` |
| Yarmouth (M351)          | 25001       | 2026 | 2025-01-01 |               674 | 2026-05-22  |            1,120 | `e3c8cf47115e822d` |
