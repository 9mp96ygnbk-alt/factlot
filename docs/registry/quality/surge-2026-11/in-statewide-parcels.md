# in-statewide-parcels quality, 2026-11-06

Scratch load of the IGIO layer `Parcel Boundaries of Indiana Current`, DLGF classes 3xx and 4xx,
Marion County excluded. This page is the audit evidence for that extract. An audit of the extract
is not a complete commercial universe.

Commands, against the archived pages in `collected/in-statewide-parcels` (gitignored) and a scratch
database in `/tmp` (not committed):

```
PYTHONPATH=python/src python3 -m factlot.collector snapshot \
  --config registry/sources/in/in-statewide-parcels.json --out collected \
  --source in-statewide-parcels --include-unverified
PYTHONPATH=python/src python3 -m factlot.registry.adapters.in_statewide \
  collected/in-statewide-parcels /tmp/in-statewide-registry.db --as-of 2026-11-06
PYTHONPATH=python/src python3 -m factlot.registry.maintain /tmp/in-statewide-registry.db --all
PYTHONPATH=python/src python3 -m factlot.registry.audit /tmp/in-statewide-registry.db \
  --today 2026-11-06 --collected collected --reread --entity-names \
  --out docs/registry/quality/surge-2026-11/in-statewide-parcels-audit.json
```

The collector exited 0. The manifest has 141 archived pages, 75,059,725 bytes, `checked_at` from
2026-11-06T23:09:30Z through 2026-11-06T23:14:11Z. The pages sum to 187,458 features, 91 counties,
no Marion County (`18097`) feature, class families 3 and 4 only, and no page that is short of
2,000 features while `exceededTransferLimit` is true.

## Denominator and freshness

The publisher's own commercial and industrial parcel count is unavailable. The service iteminfo,
Hub item `70565d886f1e4528a43a86be6ce5c2f3`, and the Data Harvest access page do not print one.
The counts below are measurements of this download and of the 2026-11-06 layer queries in
[`in-statewide-parcels.md`](../../sources/in-statewide-parcels.md). They are not an IGIO or DLGF total.

Freshness is the county `loaddate` on the feature, stored as the snapshot `as_of`. The audit date
is 2026-11-06. The 400-day line is 2025-10-02. Four loaded counties are inside it. Eighty-seven
are older, so the source does not pass a 400-day freshness bar. The layer `lastEditDate` of
2026-10-06 is not the data date. `--as-of 2026-11-06` was the fallback and was not used: every
loaded page carried a `loaddate`.

| County                       | loaddate                      | Age (days) | 400-day bar |
| ---------------------------- | ----------------------------- | ---------: | ----------- |
| Bartholomew 18005            | 2025-10-27                    |        375 | pass        |
| Huntington 18069             | 2025-10-27                    |        375 | pass        |
| Jay 18075                    | 2025-10-20                    |        382 | pass        |
| Owen 18119                   | 2025-10-27                    |        375 | pass        |
| The other 87 loaded counties | 2025-07-31 through 2025-09-10 |    422–463 | fail        |

The oldest loaded `loaddate` is Miami County `18103`, 2025-07-31, 463 days. Marion County
`18097` is in the layer (20,771 features, 20,543 distinct ids, `loaddate` 2025-08-24, age 439)
and is not in this load. Indianapolis stays on `in-marion-parcels`.

## What was loaded

Ingest stats: seen 179,930, kept 179,930, skipped out of scope 0, skipped invalid 0,
owners withheld 0, facts written 719,613, retired 0, errors empty. `maintain --all` removed 0
owner facts, indexed 179,823 situs addresses, and linked 0 owners.

Kept parcels are distinct `(county, state_parcel_id)` values. One tax parcel can be several
polygons. 187,458 features collapse to 179,930 parcels. Category of the kept row: F1 137,524,
F2 30,838, B 11,568. Situs address is present on 179,823 parcels (99.94%) and absent on 107.
The layer has no owner, value, year built, or area, and the registry holds none of those facts.
Owner-of-record facts: 0. Person-like owner facts: 0.

A second read of the collector directory with `read_roll` yields the same 179,930 parcel ids the
registry holds. The two sets are equal. Each county's kept count equals the distinct
`state_parcel_id` count in the source record.

`audit.py` does not list this adapter, so `--reread` records "no adapter registered for this source"
on all 141 snapshots and does not compare counts. That message is not a violation. A per-file
comparison, which is what `--reread` does once an adapter is registered, differs on 41 of the 141
pages. Those pages contain 2,067 rows of a `state_parcel_id` the loader already kept from an earlier
page of the same county: 1,764 parcels occur on 2 to 5 pages (1,491 on two pages, 244 on three, 28
on four, 1 on five). The registry holds each of those parcels once. Adding this adapter to the audit
reader list without changing that rule would flag those 41 files.

## Audit result

Report: [`in-statewide-parcels-audit.json`](in-statewide-parcels-audit.json), audited_on 2026-11-06.
179,930 parcels, 719,613 facts, 141 snapshots, 0 entities, 0 ownership links. Violations: 0.
Warnings: 137, each a snapshot older than 400 days. The four snapshots at or under 400 days are
the four counties in the table above. Citation gaps: 0. Conflicting facts: 0. Implausible
figures: 0.

Promotion bar for this source:

| Bar                                        | Result                                                                                                                                                                                                        |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Re-read of the extract equals the registry | Pass. 179,930 distinct parcel ids, set-equal, and each county matches the record. Per-file re-read of 41 pages does not match, for the repeat polygons above, and the audit tool did not run that comparison. |
| 0 audit violations                         | Pass.                                                                                                                                                                                                         |
| 0 person-like owner facts                  | Pass.                                                                                                                                                                                                         |
| Per-county count matches the record        | Pass. Kept parcels equal the record's distinct `state_parcel_id` column in all 91 loaded counties.                                                                                                            |
| as-of within 400 days                      | Fail for 87 counties (137 snapshots). Pass for Bartholomew `18005`, Huntington `18069`, Jay `18075`, and Owen `18119`.                                                                                        |

`verified` is false until a person signs off on the terms in the source record. That is the
blocker for a live source. The licence reading did not raise a further rights question.

## Counts by county

Kept is distinct `state_parcel_id`. Features is the polygon count in the download. B, F1, and F2
are the registry slots assigned from the DLGF code on the kept row. No situs is parcels with
neither street filled. Age is days from `loaddate` to 2026-11-06.

| FIPS  | tax_county                                          | Features |  Kept |   B |    F1 |   F2 | No situs | loaddate   | Age | 400-day bar |
| ----- | --------------------------------------------------- | -------: | ----: | --: | ----: | ---: | -------: | ---------- | --: | ----------- |
| 18001 | ADAMS COUNTY                                        |     1240 |  1221 |  68 |   983 |  170 |        0 | 2025-08-08 | 455 | fail        |
| 18003 | ALLEN COUNTY                                        |     9340 |  9331 | 698 |  6708 | 1925 |        0 | 2025-08-29 | 434 | fail        |
| 18005 | BARTHOLOMEW COUNTY                                  |     1975 |  1972 | 100 |  1487 |  385 |        0 | 2025-10-27 | 375 | pass        |
| 18007 | BENTON COUNTY                                       |      395 |   395 |  15 |   300 |   80 |        0 | 2025-08-20 | 443 | fail        |
| 18009 | BLACKFORD COUNTY                                    |      503 |   503 |  23 |   409 |   71 |        0 | 2025-08-11 | 452 | fail        |
| 18011 | BOONE COUNTY                                        |     2537 |  1853 |  97 |  1393 |  363 |        0 | 2025-08-22 | 441 | fail        |
| 18013 | BROWN COUNTY                                        |      371 |   364 |   7 |   347 |   10 |        0 | 2025-08-22 | 441 | fail        |
| 18015 | CARROLL COUNTY                                      |     1044 |  1043 |  30 |   805 |  208 |        0 | 2025-08-11 | 452 | fail        |
| 18017 | CASS COUNTY                                         |     1455 |  1441 |  92 |  1046 |  303 |        0 | 2025-08-11 | 452 | fail        |
| 18019 | CLARK COUNTY                                        |     4675 |  4655 | 295 |  4082 |  278 |        2 | 2025-08-22 | 441 | fail        |
| 18021 | CLAY COUNTY                                         |      955 |   952 |  26 |   833 |   93 |        0 | 2025-09-05 | 427 | fail        |
| 18023 | CLINTON COUNTY; 25 features have a blank tax_county |     1286 |  1276 |  47 |  1022 |  207 |        0 | 2025-08-11 | 452 | fail        |
| 18025 | CRAWFORD COUNTY                                     |      278 |   276 |   5 |   250 |   21 |        0 | 2025-08-18 | 445 | fail        |
| 18027 | DAVIESS COUNTY                                      |     1105 |  1072 |  44 |   863 |  165 |        0 | 2025-08-15 | 448 | fail        |
| 18029 | DEARBORN COUNTY                                     |     1443 |  1443 |  99 |  1193 |  151 |        0 | 2025-08-29 | 434 | fail        |
| 18031 | DECATUR COUNTY                                      |      937 |   926 |  37 |   723 |  166 |        0 | 2025-08-01 | 462 | fail        |
| 18033 | DEKALB COUNTY                                       |     2252 |  2252 | 123 |  1490 |  639 |        0 | 2025-08-26 | 437 | fail        |
| 18035 | DELAWARE COUNTY                                     |     4813 |  4553 | 544 |  3479 |  530 |        5 | 2025-08-11 | 452 | fail        |
| 18037 | DUBOIS COUNTY                                       |     2767 |  2755 | 117 |  1799 |  839 |        0 | 2025-08-25 | 438 | fail        |
| 18039 | ELKHART COUNTY                                      |     7850 |  7847 | 284 |  3996 | 3567 |        0 | 2025-09-05 | 427 | fail        |
| 18041 | FAYETTE COUNTY                                      |      860 |   852 |  58 |   669 |  125 |        0 | 2025-08-19 | 444 | fail        |
| 18043 | FLOYD COUNTY                                        |     2883 |  2354 | 140 |  1828 |  386 |        0 | 2025-08-12 | 451 | fail        |
| 18045 | FOUNTAIN COUNTY                                     |      667 |   639 |  11 |   548 |   80 |        0 | 2025-08-12 | 451 | fail        |
| 18047 | FRANKLIN COUNTY                                     |      576 |   545 |  31 |   477 |   37 |        0 | 2025-08-27 | 436 | fail        |
| 18049 | FULTON COUNTY                                       |      937 |   912 |  40 |   714 |  158 |        0 | 2025-08-29 | 434 | fail        |
| 18051 | GIBSON COUNTY                                       |      937 |   928 |  57 |   717 |  154 |        0 | 2025-08-12 | 451 | fail        |
| 18053 | GRANT COUNTY                                        |     2120 |  2113 | 109 |  1664 |  340 |        0 | 2025-08-13 | 450 | fail        |
| 18055 | GREENE COUNTY                                       |     1106 |  1093 |  34 |  1011 |   48 |        0 | 2025-08-25 | 438 | fail        |
| 18057 | HAMILTON COUNTY                                     |     6195 |  6190 | 681 |  5043 |  466 |        0 | 2025-08-08 | 455 | fail        |
| 18059 | HANCOCK COUNTY                                      |     1543 |  1514 | 108 |  1139 |  267 |        0 | 2025-08-27 | 436 | fail        |
| 18061 | HARRISON COUNTY                                     |      982 |   982 |  24 |   884 |   74 |        0 | 2025-08-07 | 456 | fail        |
| 18063 | HENDRICKS COUNTY                                    |     3648 |  3166 | 155 |  2504 |  507 |        0 | 2025-08-12 | 451 | fail        |
| 18065 | HENRY COUNTY                                        |     1283 |  1281 |  86 |  1061 |  134 |        0 | 2025-08-14 | 449 | fail        |
| 18067 | HOWARD COUNTY                                       |     2652 |  2648 | 187 |  2221 |  240 |        0 | 2025-08-27 | 436 | fail        |
| 18069 | HUNTINGTON COUNTY                                   |     1491 |  1476 |  74 |   965 |  437 |        0 | 2025-10-27 | 375 | pass        |
| 18071 | JACKSON COUNTY                                      |     1514 |  1498 | 107 |  1220 |  171 |        0 | 2025-08-28 | 435 | fail        |
| 18073 | JASPER COUNTY                                       |     1020 |  1018 |  30 |   775 |  213 |        0 | 2025-08-12 | 451 | fail        |
| 18075 | JAY COUNTY                                          |      767 |   722 |  50 |   537 |  135 |        0 | 2025-10-20 | 382 | pass        |
| 18077 | JEFFERSON COUNTY                                    |     1206 |  1201 |  72 |  1021 |  108 |        0 | 2025-09-10 | 422 | fail        |
| 18079 | JENNINGS COUNTY                                     |      666 |   661 |  24 |   516 |  121 |        0 | 2025-09-10 | 422 | fail        |
| 18081 | JOHNSON COUNTY                                      |     2958 |  2958 | 216 |  2163 |  579 |        0 | 2025-09-05 | 427 | fail        |
| 18083 | KNOX COUNTY                                         |     1855 |  1855 | 132 |  1379 |  344 |        0 | 2025-08-13 | 450 | fail        |
| 18085 | KOSCIUSKO COUNTY                                    |     3760 |  3760 | 226 |  2969 |  565 |        0 | 2025-09-03 | 429 | fail        |
| 18087 | LAGRANGE COUNTY                                     |     1313 |  1308 |  40 |   912 |  356 |        0 | 2025-08-18 | 445 | fail        |
| 18089 | LAKE COUNTY                                         |    15020 | 14961 | 971 | 11865 | 2125 |       44 | 2025-08-19 | 444 | fail        |
| 18091 | LAPORTE COUNTY                                      |     3364 |  3359 | 205 |  2559 |  595 |        0 | 2025-08-12 | 451 | fail        |
| 18093 | LAWRENCE COUNTY                                     |     1530 |  1524 |  50 |  1141 |  333 |        0 | 2025-08-28 | 435 | fail        |
| 18095 | MADISON COUNTY                                      |     5385 |  5373 | 159 |  4612 |  602 |        0 | 2025-08-28 | 435 | fail        |
| 18099 | MARSHALL COUNTY                                     |     2207 |  1697 | 110 |  1181 |  406 |        0 | 2025-08-12 | 451 | fail        |
| 18101 | MARTIN COUNTY                                       |      426 |   421 |   2 |   345 |   74 |        0 | 2025-08-12 | 451 | fail        |
| 18103 | MIAMI COUNTY                                        |     1229 |  1221 |  40 |   918 |  263 |        0 | 2025-07-31 | 463 | fail        |
| 18105 | MONROE COUNTY                                       |     7855 |  6806 | 552 |  5942 |  312 |        0 | 2025-08-20 | 443 | fail        |
| 18107 | MONTGOMERY COUNTY                                   |     1274 |  1267 | 104 |  1016 |  147 |        0 | 2025-08-29 | 434 | fail        |
| 18109 | MORGAN COUNTY                                       |     1555 |  1546 |  62 |  1257 |  227 |        0 | 2025-08-13 | 450 | fail        |
| 18111 | NEWTON COUNTY                                       |      752 |   752 |  28 |   530 |  194 |        0 | 2025-08-29 | 434 | fail        |
| 18113 | NOBLE COUNTY                                        |     1532 |  1532 | 103 |  1041 |  388 |        0 | 2025-08-26 | 437 | fail        |
| 18115 | OHIO COUNTY                                         |      162 |   157 |  12 |   134 |   11 |        0 | 2025-08-29 | 434 | fail        |
| 18117 | ORANGE COUNTY                                       |     1508 |   919 |  46 |   728 |  145 |        0 | 2025-08-12 | 451 | fail        |
| 18119 | OWEN COUNTY                                         |      470 |   467 |  22 |   359 |   86 |        0 | 2025-10-27 | 375 | pass        |
| 18121 | PARKE COUNTY                                        |      746 |   735 |  17 |   640 |   78 |        0 | 2025-08-28 | 435 | fail        |
| 18123 | PERRY COUNTY                                        |      797 |   770 |  33 |   619 |  118 |        4 | 2025-09-10 | 422 | fail        |
| 18125 | PIKE COUNTY                                         |      552 |   548 |  15 |   340 |  193 |        0 | 2025-08-28 | 435 | fail        |
| 18127 | PORTER COUNTY                                       |     4163 |  4127 | 466 |  3251 |  410 |        0 | 2025-08-22 | 441 | fail        |
| 18129 | POSEY COUNTY                                        |      904 |   881 |  34 |   606 |  241 |        0 | 2025-08-28 | 435 | fail        |
| 18131 | PULASKI COUNTY                                      |      822 |   821 |  28 |   589 |  204 |        0 | 2025-08-28 | 435 | fail        |
| 18133 | PUTNAM COUNTY                                       |      904 |   901 |  63 |   739 |   99 |        0 | 2025-09-05 | 427 | fail        |
| 18135 | RANDOLPH COUNTY                                     |      991 |   984 |  30 |   790 |  164 |        0 | 2025-08-28 | 435 | fail        |
| 18137 | RIPLEY COUNTY                                       |      962 |   941 |  68 |   795 |   78 |        0 | 2025-09-10 | 422 | fail        |
| 18139 | RUSH COUNTY                                         |      658 |   559 |  36 |   420 |  103 |        0 | 2025-08-28 | 435 | fail        |
| 18141 | ST. JOSEPH COUNTY                                   |     7537 |  7392 | 325 |  5428 | 1639 |        5 | 2025-08-27 | 436 | fail        |
| 18143 | SCOTT COUNTY                                        |      748 |   748 |  55 |   603 |   90 |        0 | 2025-08-27 | 436 | fail        |
| 18145 | SHELBY COUNTY                                       |     1556 |  1551 | 105 |   998 |  448 |        0 | 2025-09-02 | 430 | fail        |
| 18147 | SPENCER COUNTY                                      |      817 |   813 |  17 |   595 |  201 |        0 | 2025-08-27 | 436 | fail        |
| 18149 | STARKE COUNTY                                       |      747 |   737 |  24 |   629 |   84 |        0 | 2025-08-27 | 436 | fail        |
| 18151 | STEUBEN COUNTY                                      |     1837 |  1834 |  43 |  1460 |  331 |        0 | 2025-08-27 | 436 | fail        |
| 18153 | SULLIVAN COUNTY                                     |     1014 |   986 |  12 |   713 |  261 |        0 | 2025-08-28 | 435 | fail        |
| 18155 | SWITZERLAND COUNTY                                  |      235 |   219 |  15 |   189 |   15 |        0 | 2025-08-28 | 435 | fail        |
| 18157 | TIPPECANOE COUNTY                                   |     6073 |  3946 | 784 |  2925 |  237 |       43 | 2025-08-29 | 434 | fail        |
| 18159 | TIPTON COUNTY                                       |      580 |   579 |  26 |   427 |  126 |        2 | 2025-08-12 | 451 | fail        |
| 18161 | UNION COUNTY                                        |      225 |   201 |  13 |   186 |    2 |        0 | 2025-08-27 | 436 | fail        |
| 18163 | VANDERBURGH COUNTY                                  |     5539 |  5539 | 427 |  3955 | 1157 |        0 | 2025-08-29 | 434 | fail        |
| 18165 | VERMILLION COUNTY                                   |      519 |   504 |  22 |   428 |   54 |        0 | 2025-08-28 | 435 | fail        |
| 18167 | VIGO COUNTY                                         |     4449 |  4364 | 409 |  3353 |  602 |        2 | 2025-09-09 | 423 | fail        |
| 18169 | WABASH COUNTY                                       |     1108 |  1107 |  39 |   870 |  198 |        0 | 2025-08-11 | 452 | fail        |
| 18171 | WARREN COUNTY                                       |      375 |   375 |  13 |   258 |  104 |        0 | 2025-08-28 | 435 | fail        |
| 18173 | WARRICK COUNTY                                      |     1971 |  1966 | 176 |  1349 |  441 |        0 | 2025-08-29 | 434 | fail        |
| 18175 | WASHINGTON COUNTY                                   |      628 |   623 |  38 |   526 |   59 |        0 | 2025-08-29 | 434 | fail        |
| 18177 | WAYNE COUNTY                                        |     2317 |  2305 | 224 |  1650 |  431 |        0 | 2025-09-04 | 428 | fail        |
| 18179 | WELLS COUNTY                                        |      971 |   805 |  30 |   648 |  127 |        0 | 2025-08-12 | 451 | fail        |
| 18181 | WHITE COUNTY                                        |     1299 |  1278 |  33 |  1062 |  183 |        0 | 2025-08-20 | 443 | fail        |
| 18183 | WHITLEY COUNTY                                      |      985 |   985 |  39 |   710 |  236 |        0 | 2025-08-12 | 451 | fail        |

Totals for the 91 loaded counties: features 187,458, kept 179,930, B 11,568, F1 137,524, F2 30,838, no situs 107.
