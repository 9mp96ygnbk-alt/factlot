# ny-orpts-rolls: surge audit, 2026-11-06

Lane A1. Re-collection and Tier 1 audit of the 57 New York counties outside New York City loaded from ORPTS assessment rolls (Open NY dataset `7vem-aaz7`). Audited means the promotion bar below passed. It does not mean the commercial universe is complete.

Audit JSON: [`ny-orpts-rolls-audit.json`](ny-orpts-rolls-audit.json), written by `python -m factlot.registry.audit` on 2026-11-06. The source record [`../../sources/ny-orpts-rolls.md`](../../sources/ny-orpts-rolls.md) is unchanged: the re-collected files match its document ids, and every county's audited parcel count matches the count in that record.

## Promotion bar

| Check                                                 | Result | Evidence                                                                                                                                                                                                                |
| ----------------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Re-read yields exactly the parcels the registry holds | Pass   | 57 of 57 county files. `reread_source_file` on the NY adapter returned the same distinct parcel ids the scratch registry holds for that document. 0 invalid APNs, 0 header-like APNs, 0 APNs that collapse into one id. |
| 0 audit violations                                    | Pass   | `violations` is empty. Audit exit code 0.                                                                                                                                                                               |
| 0 person-like owner facts                             | Pass   | `owners.person_like` is 0. `maintain --all` purged 0 owner facts.                                                                                                                                                       |
| Per-county count matches the record                   | Pass   | All 57 counties. Audited parcels, and the B / F1 / F2 split, equal the statewide-extension table. Publisher class 4xx/7xx row counts equal that table's first count column.                                             |
| As-of at most 400 days before the audit date          | Pass   | As-of 2026-04-24. Age 196 days on 2026-11-06.                                                                                                                                                                           |

The audit command was:

```
PYTHONPATH=python/src python3 -m factlot.registry.audit scratch.db --today 2026-11-06 --collected collected --reread --entity-names --out docs/registry/quality/surge-2026-11/ny-orpts-rolls-audit.json
```

`--reread` recorded `no adapter registered for this source` on all 57 snapshots. The Tier 1 audit's adapter list (`_READER_MODULES` in `python/src/factlot/registry/audit.py`) names the original Tier 1 adapters and does not name `ny_orpts`. That string is not an audit violation: the violations list is empty and the command exited 0. This lane does not edit that file. The re-read in the table above calls the same `reread_source_file` function the audit uses, with the NY adapter, on each archived file.

## What was collected and loaded

Collector, from the verified config, robots.txt read first (`Crawl-delay: 1`; `/resource/` and `/api/` allowed; read 2026-11-06):

```
PYTHONPATH=python/src python3 -m factlot.collector snapshot --config registry/sources --out collected --source ny-orpts-rolls
```

57 files archived, 70,028,516 bytes, retrieved 2026-11-06T22:57:31Z through 2026-11-06T22:59:42Z. Every file's sha256 is the document id already written in the source record (5 full hashes from the five-county load, 52 sha16 prefixes from the statewide load). No file has 100,000 data rows, so none was cut off by the URL's `$limit`. Each file is one county. Data rows sum to 306,221, the same count a SODA `group by county_name, property_class` returned the same day for roll year 2025 and classes 400–499 or 700–799.

Loaded with the existing adapter, one file at a time, no `--full-roll`:

```
PYTHONPATH=python/src python3 -m factlot.registry.adapters.ny_orpts <county csv> scratch.db --as-of 2026-04-24 --tax-year 2025 --retrieved-at <manifest checked_at>
```

Then `python -m factlot.registry.maintain scratch.db --all`. Kept 275,995 parcels, 1,927,578 facts, 0 invalid ids, 0 errors, 0 retired. Names the organisation rule rejects were not stored (122,088 such rows). Eight parcels have a blank owner and are in neither count.

## Audited is not the commercial universe

The dataset page does not publish a commercial-only total. Its description, read 2026-11-06, says the rolls cover "the more than 4.7 million parcels in New York State." A SODA group by `roll_year` the same day counts 4,727,130 rows for 2025, the same figure the source record quotes, plus roll years 2021–2024 and one stray row with roll year `23`. There is no 2026 roll year.

The commercial and industrial denominator used here is the count of 2025 rows the publisher coded in its own categories **400 Commercial** and **700 Industrial**: **306,221**. That is a count of the published roll, taken from the SODA group-by and confirmed by the row count of the 57 downloaded files. It is not a summary statistic printed by ORPTS.

Of those 306,221, **275,995** are the audited set. The other **30,226** stay in the publisher's 400/700 categories and are outside this source's commercial scope, for the reasons in the mapping section (4,116 class 410, 17,166 class 412, 8,944 classes 730–749).

Also outside that denominator, and not in the audited set:

- Village rolls and New York City. The dataset's own limitation, read 2026-11-06: "Village and New York City Assessment Rolls are not included." No separate count of those rolls is published on this dataset.
- Vacant land the publisher files under category **300**, including land it describes as commercial or industrial vacant. SODA group-by for roll year 2025, read 2026-11-06: 330 vacant land in commercial areas 39,253; 331 commercial vacant with minor improvements 5,242; 340 vacant land in industrial areas 8,288; 341 industrial vacant with minor improvements 522; 352 shell building, commercial 42. Together 53,347. The manual places these in vacant land, not in category 400 or 700.
- Categories 100 agricultural, 200 residential, 500 recreation and entertainment, 600 community services, 800 public services, and 900 wild, forested, conservation lands and public parks. Those counts were not re-aggregated for this audit. The all-class 2025 total is 4,727,130.

Class 411 (apartments, 88,490 rows) and class 413 (co-operative, 75) are inside the audited set and are stored as multifamily. The roll has no unit count. Westchester's 26,053 and Rockland's 11,024 multifamily parcels are the same concentration the source record already flags. Passing this audit does not certify those as building counts.

## Freshness

| Evidence                             | Value                         | Read                                                       |
| ------------------------------------ | ----------------------------- | ---------------------------------------------------------- |
| Dataset metadata `rowsUpdatedAt`     | 2026-04-24T15:03:49Z          | 2026-11-06, `https://data.ny.gov/api/views/7vem-aaz7.json` |
| `Last-Modified` on every county file | Fri, 24 Apr 2026 15:03:55 GMT | 2026-11-06, collector manifest                             |
| Dataset "Posting Frequency"          | Annually                      | same metadata                                              |
| Latest `roll_year`                   | 2025 (4,727,130 rows)         | SODA group-by, 2026-11-06                                  |
| Snapshot `as_of` used for the load   | 2026-04-24                    | the metadata date above                                    |
| Age on the audit date                | 196 days                      | audit JSON, `audited_on` 2026-11-06                        |
| File bytes versus the source record  | 57 of 57 sha256 values match  | collector manifest                                         |

The classification manual's footer says "Updated: May 26, 2026". That date is the code list, not a new roll. The roll files above were last modified 2026-04-24.

## Land-use mapping

The crosswalk is the ORPTS property type classification, read 2026-11-06 at <https://www.tax.ny.gov/research/property/assess/manuals/prclas.htm> (page footer: Updated May 26, 2026), plus the `property_class_description` values on the 2025 roll. FactLot stores the result in its commercial labels B, F1, and F2. The code that decides the label is `category()` in `python/src/factlot/registry/adapters/ny_orpts.py`. Texas Comptroller state codes (F1, F2, B1, and the rest of that table) are not consulted.

The manual's nine categories, in its words:

| Code | Publisher type                                      | Publisher description                                                                                                                  |
| ---- | --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| 100  | Agricultural                                        | Property used for the production of crops or livestock.                                                                                |
| 200  | Residential                                         | Property used for human habitation. Living accommodations such as hotels, motels, and apartments are in the Commercial category - 400. |
| 300  | Vacant land                                         | Property that is not in use, is in temporary use, or lacks permanent improvement.                                                      |
| 400  | Commercial                                          | Property used for the sale of goods and/or services.                                                                                   |
| 500  | Recreation & entertainment                          | Property used by groups for recreation, amusement, or entertainment.                                                                   |
| 600  | Community services                                  | Property used for the well being of the community.                                                                                     |
| 700  | Industrial                                          | Property used for the production and fabrication of durable and nondurable man-made goods.                                             |
| 800  | Public services                                     | Property used to provide services to the general public.                                                                               |
| 900  | Wild, forested, conservation lands and public parks | Reforested lands, preserves, and private hunting and fishing clubs.                                                                    |

How 2025 roll classes in categories 400 and 700 are stored:

| ORPTS class                                              | Roll description (2025)                                        |    Rows | Stored as    | Why                                                                                                                                                                                                      |
| -------------------------------------------------------- | -------------------------------------------------------------- | ------: | ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 411                                                      | Apartments                                                     |  88,490 | B            | Manual: apartments are commercial category 400, not residential. Multifamily label. No unit count on the roll.                                                                                           |
| 413                                                      | Co-operative                                                   |      75 | B            | The state code list has no class 413. Cooperative ownership is a suffix (P or Q) on a use code. The roll uses 413 and describes it "Co-operative". Kept with apartments.                                 |
| 400, 407, 414–418, 420–499, other 4xx except 410 and 412 | see below                                                      | 173,706 | F1           | Remaining commercial-category classes. Includes 400 "Commercial" (1,173), 407 with a blank description (95), and 499 with a blank description (51).                                                      |
| 416                                                      | Mobile Home Parks                                              |   2,390 | F1           | Inside the F1 row above. The manual's name for 416 is "Manufactured home parks". The roll's description is "Mobile Home Parks". The publisher files it under category 400.                               |
| 700, 710, 712, 714, 715, 720, 721, 729                   | Industrial; manufacturing and processing; mining and quarrying |  13,724 | F2           | 2025 rows in the manual's manufacturing (710–715) and mining (720–729) divisions, plus 700 "Industrial" (403). The adapter also accepts 711, 713, 716–719, and 722–728; the 2025 roll has none of those. |
| 410                                                      | Living Accomodations                                           |   4,116 | out of scope | Roll spelling. Manual type: "Living accommodations". The source record treats these as seasonal and single-family homes. Left out of the audited set.                                                    |
| 412                                                      | Condominium                                                    |  17,166 | out of scope | Not a class on the state code list. The manual says a condominium is an ownership suffix, for example 411-C. The roll uses 412 for the unit. Left out.                                                   |
| 730–749                                                  | Wells, pipelines, and the classes under those headings         |   8,944 | out of scope | Manual: production wells (731–736) and non-utility pipelines (741–749). The 2025 roll's largest of these is 733 "Gas (for production)", 7,162. Left out as production and transmission rights.           |

4xx and 7xx rows with a blank or non-three-digit class do not appear in the 2025 group-by beyond the blank descriptions on 407 and 499, which are still three-digit commercial classes and are in the F1 count.

## Counts, fill, and the bar, by county

As-of for every county is 2026-04-24 (196 days). B, F1, and F2 are the stored labels from the ORPTS map above. Situs, market value, and organisation owners are parcels with that fact. Percentages are of audited parcels. "Publisher 4xx/7xx" is the denominator. "Bar" is the five checks in the first table, applied per county (the re-read is per file, and each file is one county).

| County      | FIPS  | Publisher 4xx/7xx | Audited parcels |          B |          F1 |         F2 |                Situs |         Market value |  Organisation owners | Bar      |
| ----------- | ----- | ----------------: | --------------: | ---------: | ----------: | ---------: | -------------------: | -------------------: | -------------------: | -------- |
| Albany      | 36001 |             8,320 |           8,310 |      2,502 |       5,666 |        142 |      8,310 (100.00%) |       8,308 (99.98%) |       5,134 (61.78%) | Pass     |
| Allegany    | 36003 |             1,326 |           1,138 |        133 |         917 |         88 |      1,138 (100.00%) |       1,135 (99.74%) |         510 (44.82%) | Pass     |
| Broome      | 36007 |             5,357 |           5,311 |      1,195 |       3,794 |        322 |      5,311 (100.00%) |       5,310 (99.98%) |       3,533 (66.52%) | Pass     |
| Cattaraugus | 36009 |             3,018 |           2,228 |        399 |       1,663 |        166 |      2,228 (100.00%) |      2,228 (100.00%) |       1,107 (49.69%) | Pass     |
| Cayuga      | 36011 |             1,602 |           1,578 |        260 |       1,222 |         96 |      1,578 (100.00%) |      1,578 (100.00%) |         884 (56.02%) | Pass     |
| Chautauqua  | 36013 |             8,216 |           4,155 |        555 |       3,296 |        304 |       4,154 (99.98%) |       4,154 (99.98%) |       2,240 (53.91%) | Pass     |
| Chemung     | 36015 |             2,249 |           2,179 |        380 |       1,656 |        143 |      2,179 (100.00%) |      2,179 (100.00%) |       1,285 (58.97%) | Pass     |
| Chenango    | 36017 |             1,373 |           1,303 |        189 |       1,004 |        110 |       1,302 (99.92%) |      1,303 (100.00%) |         664 (50.96%) | Pass     |
| Clinton     | 36019 |             2,158 |           2,158 |        451 |       1,603 |        104 |       2,157 (99.95%) |       2,157 (99.95%) |       1,232 (57.09%) | Pass     |
| Columbia    | 36021 |             1,812 |           1,805 |        255 |       1,476 |         74 |      1,805 (100.00%) |      1,805 (100.00%) |       1,150 (63.71%) | Pass     |
| Cortland    | 36023 |             1,422 |           1,406 |        303 |       1,002 |        101 |      1,406 (100.00%) |      1,406 (100.00%) |         896 (63.73%) | Pass     |
| Delaware    | 36025 |             1,526 |           1,520 |        205 |       1,219 |         96 |      1,520 (100.00%) |      1,520 (100.00%) |         775 (50.99%) | Pass     |
| Dutchess    | 36027 |             7,536 |           7,530 |      3,515 |       3,855 |        160 |      7,530 (100.00%) |      7,530 (100.00%) |       4,090 (54.32%) | Pass     |
| Erie        | 36029 |            25,800 |          24,108 |      7,603 |      15,341 |      1,164 |     24,108 (100.00%) |      24,103 (99.98%) |      13,101 (54.34%) | Pass     |
| Essex       | 36031 |             1,312 |           1,311 |        159 |       1,066 |         86 |      1,311 (100.00%) |       1,301 (99.24%) |         738 (56.29%) | Pass     |
| Franklin    | 36033 |             1,359 |           1,211 |        188 |         958 |         65 |      1,211 (100.00%) |      1,211 (100.00%) |         646 (53.34%) | Pass     |
| Fulton      | 36035 |             1,588 |           1,578 |        200 |       1,271 |        107 |      1,578 (100.00%) |      1,578 (100.00%) |         789 (50.00%) | Pass     |
| Genesee     | 36037 |             2,067 |           1,528 |        185 |       1,196 |        147 |      1,528 (100.00%) |       1,525 (99.80%) |       1,000 (65.45%) | Pass     |
| Greene      | 36039 |             2,053 |           2,050 |        725 |       1,275 |         50 |      2,050 (100.00%) |      2,050 (100.00%) |         997 (48.63%) | Pass     |
| Hamilton    | 36041 |               276 |             276 |         13 |         247 |         16 |        276 (100.00%) |        276 (100.00%) |         143 (51.81%) | Pass     |
| Herkimer    | 36043 |             1,678 |           1,675 |        261 |       1,268 |        146 |      1,675 (100.00%) |      1,675 (100.00%) |         816 (48.72%) | Pass     |
| Jefferson   | 36045 |             2,878 |           2,872 |        454 |       2,230 |        188 |       2,869 (99.90%) |      2,872 (100.00%) |       1,695 (59.02%) | Pass     |
| Lewis       | 36049 |               572 |             567 |         63 |         454 |         50 |        567 (100.00%) |        567 (100.00%) |         295 (52.03%) | Pass     |
| Livingston  | 36051 |             1,548 |           1,403 |        232 |       1,082 |         89 |      1,403 (100.00%) |      1,403 (100.00%) |         823 (58.66%) | Pass     |
| Madison     | 36053 |             1,652 |           1,582 |        274 |       1,234 |         74 |      1,582 (100.00%) |      1,582 (100.00%) |         891 (56.32%) | Pass     |
| Monroe      | 36055 |            13,641 |          13,601 |      2,972 |       9,755 |        874 |     13,601 (100.00%) |      13,598 (99.98%) |       9,556 (70.26%) | Pass     |
| Montgomery  | 36057 |             1,445 |           1,440 |        305 |       1,027 |        108 |      1,440 (100.00%) |      1,440 (100.00%) |         766 (53.19%) | Pass     |
| Nassau      | 36059 |            29,138 |          23,449 |      3,428 |      18,871 |      1,150 |     23,449 (100.00%) |      23,343 (99.55%) |      17,419 (74.28%) | Pass     |
| Niagara     | 36063 |             5,834 |           5,781 |      1,389 |       4,009 |        383 |       5,780 (99.98%) |       5,780 (99.98%) |       3,128 (54.11%) | Pass     |
| Oneida      | 36065 |             6,240 |           6,222 |      1,441 |       4,473 |        308 |       6,219 (99.95%) |       6,219 (99.95%) |       3,228 (51.88%) | Pass     |
| Onondaga    | 36067 |            11,069 |          11,033 |      2,752 |       7,833 |        448 |     11,033 (100.00%) |      11,029 (99.96%) |       7,058 (63.97%) | Pass     |
| Ontario     | 36069 |             2,867 |           2,781 |        635 |       1,938 |        208 |      2,781 (100.00%) |      2,781 (100.00%) |       1,751 (62.96%) | Pass     |
| Orange      | 36071 |             7,756 |           7,727 |      1,577 |       5,862 |        288 |       7,725 (99.97%) |       7,721 (99.92%) |       5,260 (68.07%) | Pass     |
| Orleans     | 36073 |               831 |             827 |        168 |         590 |         69 |        827 (100.00%) |         826 (99.88%) |         438 (52.96%) | Pass     |
| Oswego      | 36075 |             2,641 |           2,637 |        368 |       2,086 |        183 |       2,636 (99.96%) |      2,637 (100.00%) |       1,447 (54.87%) | Pass     |
| Otsego      | 36077 |             1,644 |           1,637 |        283 |       1,299 |         55 |       1,635 (99.88%) |      1,637 (100.00%) |         867 (52.96%) | Pass     |
| Putnam      | 36079 |             1,321 |           1,314 |        147 |       1,128 |         39 |      1,314 (100.00%) |       1,313 (99.92%) |         995 (75.72%) | Pass     |
| Rensselaer  | 36083 |             3,669 |           3,649 |      1,079 |       2,447 |        123 |      3,649 (100.00%) |       3,647 (99.95%) |       2,167 (59.39%) | Pass     |
| Rockland    | 36087 |            14,444 |          14,438 |     11,024 |       3,253 |        161 |      14,437 (99.99%) |      13,426 (92.99%) |       4,527 (31.35%) | Pass     |
| St Lawrence | 36089 |             3,104 |           3,096 |        339 |       2,211 |        546 |       3,076 (99.35%) |      3,096 (100.00%) |       1,591 (51.39%) | Pass     |
| Saratoga    | 36091 |             4,505 |           4,496 |      1,354 |       2,938 |        204 |       4,495 (99.98%) |       4,493 (99.93%) |       2,691 (59.85%) | Pass     |
| Schenectady | 36093 |             3,167 |           3,164 |        832 |       2,232 |        100 |      3,164 (100.00%) |      3,164 (100.00%) |       1,841 (58.19%) | Pass     |
| Schoharie   | 36095 |               793 |             793 |        142 |         585 |         66 |        793 (100.00%) |        793 (100.00%) |         422 (53.22%) | Pass     |
| Schuyler    | 36097 |               507 |             464 |         53 |         386 |         25 |        464 (100.00%) |        464 (100.00%) |         268 (57.76%) | Pass     |
| Seneca      | 36099 |               945 |             774 |         98 |         641 |         35 |        774 (100.00%) |        774 (100.00%) |         416 (53.75%) | Pass     |
| Steuben     | 36101 |             2,534 |           2,344 |        355 |       1,847 |        142 |      2,344 (100.00%) |      2,344 (100.00%) |       1,208 (51.54%) | Pass     |
| Suffolk     | 36103 |            42,709 |          27,373 |      6,933 |      17,806 |      2,634 |      27,370 (99.99%) |       8,558 (31.26%) |      17,248 (63.01%) | Pass     |
| Sullivan    | 36105 |             3,168 |           3,157 |      1,051 |       2,029 |         77 |      3,157 (100.00%) |       2,755 (87.27%) |       1,664 (52.71%) | Pass     |
| Tioga       | 36107 |             1,101 |           1,076 |        142 |         863 |         71 |      1,076 (100.00%) |      1,076 (100.00%) |         543 (50.46%) | Pass     |
| Tompkins    | 36109 |             2,531 |           2,511 |      1,042 |       1,381 |         88 |      2,511 (100.00%) |      2,511 (100.00%) |       1,574 (62.68%) | Pass     |
| Ulster      | 36111 |             4,553 |           4,540 |        934 |       3,429 |        177 |       4,537 (99.93%) |       4,536 (99.91%) |       2,887 (63.59%) | Pass     |
| Warren      | 36113 |             2,320 |           2,314 |        315 |       1,916 |         83 |      2,314 (100.00%) |       2,307 (99.70%) |       1,506 (65.08%) | Pass     |
| Washington  | 36115 |             1,486 |           1,486 |        227 |       1,084 |        175 |      1,486 (100.00%) |      1,486 (100.00%) |         803 (54.04%) | Pass     |
| Wayne       | 36117 |             2,113 |           2,093 |        228 |       1,691 |        174 |      2,093 (100.00%) |      2,093 (100.00%) |       1,237 (59.10%) | Pass     |
| Westchester | 36119 |            37,533 |          37,456 |     26,053 |      10,870 |        533 |     37,456 (100.00%) |      21,729 (58.01%) |      13,139 (35.08%) | Pass     |
| Wyoming     | 36121 |             1,269 |             909 |        111 |         734 |         64 |         908 (99.89%) |        909 (100.00%) |         509 (56.00%) | Pass     |
| Yates       | 36123 |               645 |             631 |         89 |         497 |         45 |        631 (100.00%) |        631 (100.00%) |         311 (49.29%) | Pass     |
| **All 57**  |       |       **306,221** |     **275,995** | **88,565** | **173,706** | **13,724** | **275,951 (99.98%)** | **239,872 (86.91%)** | **153,899 (55.76%)** | **Pass** |

Fill that the roll does not provide, statewide: land area 0, improvement area 0, year built 0, appraised value 0. The roll has `front` and `depth`, not an area, and `assessment_total` is a fractional assessed value and is not stored. Situs is missing on 44 parcels (0.02%), the largest gap being St Lawrence (20 of 3,096). Market value is missing on 36,123 parcels (13.09%), concentrated in Suffolk (8,558 of 27,373, 31.26%) and Westchester (21,729 of 37,456, 58.01%). The source record already describes both gaps.

Organisation owners on this re-ingest are 153,899 parcels. The source record's 2026-11-03 load sections sum to 151,710. The files are the same bytes, so the roll did not change. Of the owners stored now, 2,112 fail the entity-token test that preceded the structural-organisation patterns added on 2026-11-04 (credit unions, banks, government bodies, condominiums, securitization trusts) and pass the current rule. That accounts for 2,112 of the 2,189 difference. The other 77 were not isolated to one pattern. The 2026-11-03 owner figures describe that day's load. They are left as written. This scratch registry has no New York entity file, so owner links are 0 and the link rate is not applicable. The record's link counts were measured in a scratch file that also held Connecticut entities.

## Rights

No new rights question came up, so the audit was not stopped. Dataset metadata still has `license: None`. robots.txt, read 2026-11-06, still allows `/resource/` and `/api/` and still sets `Crawl-delay: 1`. The OPEN-NY terms and the Socrata platform-terms reading stay as already recorded on this source and on `ny-dos-entities`, including the open point on the platform scraper clause. Those were not re-decided here.
