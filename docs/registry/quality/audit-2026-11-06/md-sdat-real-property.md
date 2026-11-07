# md-sdat-real-property audit, 2026-11-06

Source `md-sdat-real-property`. Twenty-four jurisdictions, including Baltimore City (24510). Owners are withheld by the publisher, so owner and link metrics are n/a. Person-like owner facts are still required to be 0.

**Result: PASS for all 24 counties**, after a dated correction of the kept counts. The audited registry holds 109,249 parcels at as-of 2026-11-05 (`B` 11,746, `F1` 81,561, `F2` 15,942). The 2026-11-03 record counted 109,245 kept parcels at as-of 2026-10-05. Calvert (1,042) and Garrett (1,445) are unchanged. The re-read parcel-id set equals the registry in every county. Audit violations: 0. Person-like owner facts: 0. Owner-of-record facts: 0.

As-of 2026-11-05 is inside the 400-day window measured from 2026-11-04. The audit report, run with `--today 2026-11-06`, records `age_days` 1 on every snapshot.

The audit JSON is `docs/registry/quality/audit-2026-11-06/md-sdat-real-property-audit.json`, trimmed to its `stats`, `violations` and `warnings` sections.

## Per-county result

Record count, registry count, and re-read count are the parcels kept on 2026-11-06. The 2026-11-03 kept count is in the reason when it differs. Shared bar for every row: re-read set equals the registry, 0 violations, 0 person-like owner facts, as-of 2026-11-05.

| FIPS  | County           | Record count | Registry count | Re-read count | As-of      | Result | Reason                                                                                  |
| ----- | ---------------- | -----------: | -------------: | ------------: | ---------- | ------ | --------------------------------------------------------------------------------------- |
| 24001 | Allegany         |        3,434 |          3,434 |         3,434 | 2026-11-05 | PASS   | 2026-11-03 kept count was 3,433.                                                        |
| 24003 | Anne Arundel     |        9,049 |          9,049 |         9,049 | 2026-11-05 | PASS   | 2026-11-03 kept count was 9,046. Four deletion-dated rows skipped (C 2, I 2).           |
| 24005 | Baltimore County |       14,490 |         14,490 |        14,490 | 2026-11-05 | PASS   | 2026-11-03 kept count was 14,494. Portal name is Baltimore.                             |
| 24009 | Calvert          |        1,042 |          1,042 |         1,042 | 2026-11-05 | PASS   | Matches the 2026-11-03 kept count. One in-scope row is still dated 20261005.            |
| 24011 | Caroline         |          887 |            887 |           887 | 2026-11-05 | PASS   | 2026-11-03 kept count was 891.                                                          |
| 24013 | Carroll          |        3,327 |          3,327 |         3,327 | 2026-11-05 | PASS   | 2026-11-03 kept count was 3,318. Nine in-scope rows are still dated 20261005.           |
| 24015 | Cecil            |        2,606 |          2,606 |         2,606 | 2026-11-05 | PASS   | 2026-11-03 kept count was 2,605.                                                        |
| 24017 | Charles          |        3,043 |          3,043 |         3,043 | 2026-11-05 | PASS   | 2026-11-03 kept count was 3,044.                                                        |
| 24019 | Dorchester       |        1,132 |          1,132 |         1,132 | 2026-11-05 | PASS   | 2026-11-03 kept count was 1,131.                                                        |
| 24021 | Frederick        |        4,351 |          4,351 |         4,351 | 2026-11-05 | PASS   | 2026-11-03 kept count was 4,353.                                                        |
| 24023 | Garrett          |        1,445 |          1,445 |         1,445 | 2026-11-05 | PASS   | Matches the 2026-11-03 kept count.                                                      |
| 24025 | Harford          |        3,738 |          3,738 |         3,738 | 2026-11-05 | PASS   | 2026-11-03 kept count was 3,735.                                                        |
| 24027 | Howard           |        4,225 |          4,225 |         4,225 | 2026-11-05 | PASS   | 2026-11-03 kept count was 4,226.                                                        |
| 24029 | Kent             |          677 |            677 |           677 | 2026-11-05 | PASS   | 2026-11-03 kept count was 676.                                                          |
| 24031 | Montgomery       |       11,579 |         11,579 |        11,579 | 2026-11-05 | PASS   | 2026-11-03 kept count was 11,578. Three deletion-dated rows skipped (C 1, I 2).         |
| 24033 | Prince George's  |       13,029 |         13,029 |        13,029 | 2026-11-05 | PASS   | 2026-11-03 kept count was 13,023.                                                       |
| 24035 | Queen Anne's     |        1,530 |          1,530 |         1,530 | 2026-11-05 | PASS   | 2026-11-03 kept count was 1,528. One in-scope row is still dated 20261005.              |
| 24037 | St. Mary's       |        1,944 |          1,944 |         1,944 | 2026-11-05 | PASS   | 2026-11-03 kept count was 1,945. One in-scope row is still dated 20261005.              |
| 24039 | Somerset         |          995 |            995 |           995 | 2026-11-05 | PASS   | 2026-11-03 kept count was 994. Industrial (I) is 0.                                     |
| 24041 | Talbot           |        1,416 |          1,416 |         1,416 | 2026-11-05 | PASS   | 2026-11-03 kept count was 1,418.                                                        |
| 24043 | Washington       |        3,716 |          3,716 |         3,716 | 2026-11-05 | PASS   | 2026-11-03 kept count was 3,690. Two in-scope rows are still dated 20261005.            |
| 24045 | Wicomico         |        3,201 |          3,201 |         3,201 | 2026-11-05 | PASS   | 2026-11-03 kept count was 3,204.                                                        |
| 24047 | Worcester        |        3,592 |          3,592 |         3,592 | 2026-11-05 | PASS   | 2026-11-03 kept count was 3,594.                                                        |
| 24510 | Baltimore City   |       14,801 |         14,801 |        14,801 | 2026-11-05 | PASS   | 2026-11-03 kept count was 14,832. Five deletion-dated rows skipped (C 4, I 1).          |
|       | **All 24**       |  **109,249** |    **109,249** |   **109,249** | 2026-11-05 | PASS   | Net +4 versus the 2026-11-03 kept total of 109,245. Twelve deletion-dated rows skipped. |

Re-read command (local, after the audit): `PYTHONPATH=python/src python3` calling `factlot.registry.audit.reread_source_file` on `factlot.registry.adapters.md_sdat` for each archived file, then `parcel_id(STATE_FIPS, county_fips, apn)` compared with `coverage` where `present=1`. Output ended `FILES 24 ALL_EQUAL True OWNERS_NAMED 0`. Each line had `only_file 0 only_reg 0 set_equal True invalid 0`.

The stock `python -m factlot.registry.audit --reread` cannot see this adapter. See Findings.

## Counts and fill rates

Kept parcels by SDAT land-use code (current facts `parcel.local_use_code`) and by fields present. Owner-of-record facts are 0 in every county. `tax_year` was not passed to the adapter, so that fact is absent (the record already says the cycle year is the reassessment group).

| FIPS  | County           |       Kept |         C |        CC |         I |         M |      Situs |       Land |      Impr |      Year |     Market |  Appraised |
| ----- | ---------------- | ---------: | --------: | --------: | --------: | --------: | ---------: | ---------: | --------: | --------: | ---------: | ---------: |
| 24001 | Allegany         |       3434 |      2649 |        55 |       345 |       385 |       3408 |       3426 |      2058 |      2036 |       3262 |       3258 |
| 24003 | Anne Arundel     |       9049 |      5943 |      1736 |      1097 |       273 |       9008 |       8059 |      5801 |      4073 |       8675 |       8675 |
| 24005 | Baltimore County |      14490 |      7866 |       593 |      3153 |      2878 |      14413 |      12776 |      9015 |      5626 |      13502 |      13498 |
| 24009 | Calvert          |       1042 |       718 |       149 |       150 |        25 |       1041 |        872 |       722 |       632 |        991 |        991 |
| 24011 | Caroline         |        887 |       671 |         0 |       126 |        90 |        886 |        878 |       625 |       619 |        865 |        865 |
| 24013 | Carroll          |       3327 |      2160 |       365 |       327 |       475 |       3303 |       3189 |      2428 |      2208 |       3091 |       3090 |
| 24015 | Cecil            |       2606 |      2086 |       188 |       220 |       112 |       2598 |       2416 |      1401 |      1286 |       2313 |       2313 |
| 24017 | Charles          |       3043 |      1672 |       913 |       363 |        95 |       2956 |       3015 |      1893 |      1599 |       2851 |       2851 |
| 24019 | Dorchester       |       1132 |       926 |         0 |       181 |        25 |       1126 |       1131 |       790 |       774 |       1099 |       1099 |
| 24021 | Frederick        |       4351 |      2742 |       695 |       562 |       352 |       4328 |       4296 |      3281 |      3052 |       4074 |       4075 |
| 24023 | Garrett          |       1445 |      1103 |       275 |        21 |        46 |       1439 |       1206 |       865 |       838 |       1376 |       1376 |
| 24025 | Harford          |       3738 |      2972 |       161 |       362 |       243 |       3728 |       3578 |      2650 |      2553 |       3419 |       3419 |
| 24027 | Howard           |       4225 |      1803 |      1434 |       790 |       198 |       4197 |       4173 |      2318 |      2687 |       3870 |       3870 |
| 24029 | Kent             |        677 |       627 |        23 |         5 |        22 |        672 |        677 |       494 |       476 |        655 |        655 |
| 24031 | Montgomery       |      11579 |      4844 |      3982 |      1470 |      1283 |      11573 |       9974 |      8578 |      5031 |      10953 |      10950 |
| 24033 | Prince George's  |      13029 |      5392 |      3229 |      3265 |      1143 |      13005 |      12983 |      8739 |      8675 |      12880 |      12880 |
| 24035 | Queen Anne's     |       1530 |       894 |       580 |        10 |        46 |       1530 |       1464 |      1118 |       746 |       1481 |       1480 |
| 24037 | St. Mary's       |       1944 |      1539 |       142 |        95 |       168 |       1884 |       1942 |      1398 |      1388 |       1812 |       1812 |
| 24039 | Somerset         |        995 |       935 |        14 |         0 |        46 |        992 |        868 |       509 |       420 |        972 |        972 |
| 24041 | Talbot           |       1416 |      1046 |       212 |        69 |        89 |       1416 |       1280 |      1133 |      1069 |       1364 |       1364 |
| 24043 | Washington       |       3716 |      2583 |       113 |       360 |       660 |       3663 |       3618 |      2691 |      2086 |       3521 |       3521 |
| 24045 | Wicomico         |       3201 |      2117 |       334 |       447 |       303 |       3185 |       3191 |      2068 |      1897 |       3119 |       3119 |
| 24047 | Worcester        |       3592 |      1928 |      1181 |       189 |       294 |       3579 |       2457 |      1907 |      2446 |       3464 |       3464 |
| 24510 | Baltimore City   |      14801 |      9233 |       738 |      2335 |      2495 |      13916 |      13686 |      9819 |      9135 |      14468 |      14473 |
|       | **Total**        | **109249** | **64449** | **17112** | **15942** | **11746** | **107846** | **101155** | **72301** | **61352** | **104077** | **104070** |

FactLot categories on the kept rows: `B` = `M` = 11,746; `F1` = `C` + `CC` = 81,561; `F2` = `I` = 15,942.

Statewide fill from the audit JSON (`parcels.fields`, denominator 109,249): APN 109,249 (100%); situs 107,846 (98.72%); land area 101,155 (92.59%); improvement area 72,301 (66.18%); year built 61,352 (56.16%); market value 104,077 (95.27%); appraised value 104,070 (95.26%); category 109,249 (100%); owner of record 0; tax year 0. Facts written: 878,548. Address index rows: 107,846. Account crosswalk rows: 109,249. Buildings rolled up: 2,812. Links: 0. Entities: 0.

Missing land area equals the kept rows whose land unit of measure (field 243) is blank: 8,094. The archived files have 8,095 blank-unit rows; the extra row is one deleted Baltimore City account, which the adapter skips before it stores an area.

Adapter load stats (`$DATA/load-stats.json`), summed over 24 files: seen 109,249, kept 109,249, skipped out of scope 0, skipped invalid 0, owners person or withheld 0, facts written 878,548, retired 0, errors empty, tax year null. Seen equals kept because a deletion date is dropped before the adapter counts the row. The twelve deletion-dated accounts are in the files and in the publisher in-scope count, and they are absent from the registry.

## Commercial code mapping

The publisher's land-use field is SDAT field 50, API name `land_use_code_mdp_field_lu_desclu_sdat_field_50`. Values are labels with the code in parentheses, such as `Commercial (C)`. The adapter's `lu_code()` reads those letters. `CATEGORY_BY_LU` in `python/src/factlot/registry/adapters/md_sdat.py` stores a FactLot category beside the publisher code. Those categories are the registry's own buckets for these SDAT codes. The counts in the denominator section use the SDAT codes.

The Fields Reference row for this column does not list the allowed values. It was read 2026-11-06 from <https://opendata.maryland.gov/resource/w8th-47fz.json?$where=api_field_name=%27land_use_code_mdp_field_lu_desclu_sdat_field_50%27> (HTTP 200). The row is field order 57, field name `Land Use Code (MDP Field: LU/DESCLU. SDAT Field #50)`, MDP name `LU/DESCLU`, SDAT field number 50. The human page is <https://opendata.maryland.gov/Business-and-Economy/Maryland-Real-Property-Assessments-Fields-Referenc/w8th-47fz>. The value labels below are the strings returned by the SoQL group on `ed4q-f8tm` the same day. The documentation PDF (last edit DoIT, November 18th 2022) does not enumerate the codes.

| SDAT code | Publisher label         | FactLot category | Scope note                                                                                                                              |
| --------- | ----------------------- | ---------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `C`       | Commercial              | `F1`             | Commercial.                                                                                                                             |
| `CC`      | Commercial Condominium  | `F1`             | Commercial condominium units, kept as their own accounts.                                                                               |
| `I`       | Industrial              | `F2`             | Industrial. Somerset has 0.                                                                                                             |
| `M`       | Apartments              | `B`              | Ambiguous. Multifamily class. Field 239 is under 5 on 6,042 of 11,746 kept `M` accounts (0 units 1,058; 1 unit 3,296; 2–4 units 1,688). |
| `CR`      | Commercial Residential  | out of scope     | Mixed-use label. Statewide 5,668.                                                                                                       |
| `RC`      | Residential Commercial  | out of scope     | Mixed-use label. Statewide 885.                                                                                                         |
| `EC`      | Exempt Commercial       | out of scope     | Exempt commercial. Statewide 28,856.                                                                                                    |
| `E`       | Exempt                  | out of scope     | Exempt. Statewide 102,576.                                                                                                              |
| `CA`      | Country Club            | out of scope     | Statewide 258.                                                                                                                          |
| `A`       | Agricultural            | out of scope     | Statewide 57,456.                                                                                                                       |
| `R`       | Residential             | out of scope     | Statewide 1,755,411.                                                                                                                    |
| `U`       | Residential Condominium | out of scope     | Statewide 214,465.                                                                                                                      |
| `TH`      | Town House              | out of scope     | Statewide 159,186.                                                                                                                      |
| `MA`      | Marsh Land              | out of scope     | Statewide 602.                                                                                                                          |
| (blank)   | empty land-use value    | out of scope     | One account, in Charles.                                                                                                                |

Field 50, as grouped on 2026-11-06, has no separate vacant-commercial code. No other land-use label appeared (`UNEXPECTED []` on the 304 groups).

`M` dwelling units on kept accounts (CAMA field 239, `c_a_m_a_system_data_number_of_dwelling_units_mdp_field_bldg_units_sdat_field_239`), counted from the archived CSVs. Blank field 239: 0. Other non-numeric values: 0.

| County           |         M |     Zero |      One |      2–4 |       5+ |  Under 5 |
| ---------------- | --------: | -------: | -------: | -------: | -------: | -------: |
| Allegany         |       385 |        0 |        9 |      180 |      196 |      189 |
| Anne Arundel     |       273 |       63 |       13 |       24 |      173 |      100 |
| Baltimore County |      2878 |      419 |     1873 |        9 |      577 |     2301 |
| Calvert          |        25 |        1 |        0 |        4 |       20 |        5 |
| Caroline         |        90 |        0 |        1 |       39 |       50 |       40 |
| Carroll          |       475 |       11 |      158 |      151 |      155 |      320 |
| Cecil            |       112 |        3 |        3 |       35 |       71 |       41 |
| Charles          |        95 |        2 |        1 |       14 |       78 |       17 |
| Dorchester       |        25 |        0 |        2 |        3 |       20 |        5 |
| Frederick        |       352 |        6 |      135 |       54 |      157 |      195 |
| Garrett          |        46 |        0 |        0 |        9 |       37 |        9 |
| Harford          |       243 |       10 |       87 |       31 |      115 |      128 |
| Howard           |       198 |       10 |       25 |       16 |      147 |       51 |
| Kent             |        22 |        0 |        0 |        0 |       22 |        0 |
| Montgomery       |      1283 |      134 |      280 |      127 |      742 |      541 |
| Prince George's  |      1143 |      224 |       59 |       37 |      823 |      320 |
| Queen Anne's     |        46 |        0 |       14 |       17 |       15 |       31 |
| St. Mary's       |       168 |        3 |        5 |       47 |      113 |       55 |
| Somerset         |        46 |        3 |        2 |       13 |       28 |       18 |
| Talbot           |        89 |        1 |        5 |       34 |       49 |       40 |
| Washington       |       660 |        3 |        3 |      249 |      405 |      255 |
| Wicomico         |       303 |       33 |       11 |      108 |      151 |      152 |
| Worcester        |       294 |        2 |        6 |      145 |      141 |      153 |
| Baltimore City   |      2495 |      130 |      604 |      342 |     1419 |     1076 |
| **Total**        | **11746** | **1058** | **3296** | **1688** | **5704** | **6042** |

The 2026-11-03 known-gaps paragraph quoted Montgomery 541 of 1,282, Prince George's 319 of 1,139, and Baltimore County 2,301 of 2,882 (1,873 one unit, 419 zero). On this extract Montgomery is still 541 under 5, now of 1,283; Prince George's is 320 of 1,143; Baltimore County is still 2,301 under 5, 1,873 one unit, and 419 zero, now of 2,878. The historical paragraph is left as the 2026-11-03 measurement.

## Commercial-universe denominator

Published. Queried 2026-11-06 from the free SoQL endpoint, HTTP 200, `x-soda2-truth-last-modified: Fri, 06 Nov 2026 03:38:17 GMT`.

Command (user agent `FactLotRegistryBot/terms-check (+https://factlot.com/registry; contact@factlot.com)`):

```
curl -fsS -A "$UA" --max-time 180 -o "$DATA/terms/lu-by-county.csv" -D "$DATA/terms/lu.headers" \
  --get "https://opendata.maryland.gov/resource/ed4q-f8tm.csv" \
  --data-urlencode '$select=county_name_mdp_field_cntyname,jurisdiction_code_mdp_field_jurscode,land_use_code_mdp_field_lu_desclu_sdat_field_50,count(*) as n' \
  --data-urlencode '$group=county_name_mdp_field_cntyname,jurisdiction_code_mdp_field_jurscode,land_use_code_mdp_field_lu_desclu_sdat_field_50'
```

The file has 304 groups and 24 jurisdictions, each with one four-letter MDP code. Statewide accounts: 2,434,625. That matches the metadata cached county `non_null` of 2,434,625 on the view JSON read the same day.

Commercial + industrial, using the publisher's own codes, is `C` + `CC` + `I` = **97,515**. Apartments (`M`) are **11,746** and are outside that commercial+industrial sum. The adapter's in-scope extract is `C` + `CC` + `I` + `M` = **109,261**, which still includes the 12 deletion-dated accounts. Kept parcels are 109,249.

`C`+`CC`+`I` is the commercial-universe denominator. `M`, `CR`, `RC`, and `EC` are shown so the ambiguous and exempt classes stay visible. The publisher count includes deletion-dated accounts; the registry does not.

| FIPS  | County           |  All accounts |          C |         CC |          I |          M |     C+CC+I |    C+CC+I+M |        CR |      RC |         EC |
| ----- | ---------------- | ------------: | ---------: | ---------: | ---------: | ---------: | ---------: | ----------: | --------: | ------: | ---------: |
| 24001 | Allegany         |        41,484 |      2,649 |         55 |        345 |        385 |      3,049 |       3,434 |         3 |     239 |      1,183 |
| 24003 | Anne Arundel     |       229,272 |      5,945 |      1,736 |      1,099 |        273 |      8,780 |       9,053 |     1,127 |      71 |      1,985 |
| 24005 | Baltimore County |       306,655 |      7,866 |        593 |      3,153 |      2,878 |     11,612 |      14,490 |       585 |       7 |      2,255 |
| 24009 | Calvert          |        43,333 |        718 |        149 |        150 |         25 |      1,017 |       1,042 |       164 |      17 |        343 |
| 24011 | Caroline         |        16,708 |        671 |          0 |        126 |         90 |        797 |         887 |        54 |      27 |        340 |
| 24013 | Carroll          |        69,332 |      2,160 |        365 |        327 |        475 |      2,852 |       3,327 |       346 |       3 |      1,579 |
| 24015 | Cecil            |        48,468 |      2,086 |        188 |        220 |        112 |      2,494 |       2,606 |       241 |       1 |        561 |
| 24017 | Charles          |        75,799 |      1,672 |        913 |        363 |         95 |      2,948 |       3,043 |       289 |      52 |        452 |
| 24019 | Dorchester       |        22,819 |        926 |          0 |        181 |         25 |      1,107 |       1,132 |        11 |       1 |        472 |
| 24021 | Frederick        |       112,874 |      2,742 |        695 |        562 |        352 |      3,999 |       4,351 |       680 |     200 |      1,316 |
| 24023 | Garrett          |        30,646 |      1,103 |        275 |         21 |         46 |      1,399 |       1,445 |         0 |       0 |      1,020 |
| 24025 | Harford          |       103,505 |      2,972 |        161 |        362 |        243 |      3,495 |       3,738 |       176 |      14 |        688 |
| 24027 | Howard           |       112,798 |      1,803 |      1,434 |        790 |        198 |      4,027 |       4,225 |       129 |      54 |        804 |
| 24029 | Kent             |        13,625 |        627 |         23 |          5 |         22 |        655 |         677 |        99 |       1 |        400 |
| 24031 | Montgomery       |       355,589 |      4,845 |      3,982 |      1,472 |      1,283 |     10,299 |      11,582 |       192 |      45 |      3,226 |
| 24033 | Prince George's  |       315,586 |      5,392 |      3,229 |      3,265 |      1,143 |     11,886 |      13,029 |       414 |      18 |      2,677 |
| 24035 | Queen Anne's     |        27,776 |        894 |        580 |         10 |         46 |      1,484 |       1,530 |       540 |       0 |        443 |
| 24037 | St. Mary's       |        51,280 |      1,539 |        142 |         95 |        168 |      1,776 |       1,944 |         1 |       0 |      1,383 |
| 24039 | Somerset         |        16,894 |        935 |         14 |          0 |         46 |        949 |         995 |        12 |       0 |        349 |
| 24041 | Talbot           |        22,179 |      1,046 |        212 |         69 |         89 |      1,327 |       1,416 |        72 |       8 |        402 |
| 24043 | Washington       |        61,137 |      2,583 |        113 |        360 |        660 |      3,056 |       3,716 |       332 |      90 |        946 |
| 24045 | Wicomico         |        48,471 |      2,117 |        334 |        447 |        303 |      2,898 |       3,201 |       135 |       3 |        918 |
| 24047 | Worcester        |        66,725 |      1,928 |      1,181 |        189 |        294 |      3,298 |       3,592 |        36 |       4 |        591 |
| 24510 | Baltimore City   |       241,670 |      9,237 |        738 |      2,336 |      2,495 |     12,311 |      14,806 |        30 |      30 |      4,523 |
|       | **Total**        | **2,434,625** | **64,456** | **17,112** | **15,947** | **11,746** | **97,515** | **109,261** | **5,668** | **885** | **28,856** |

Archived file row counts equal the `C+CC+I+M` column in every county (109,261 rows, 29,163,354 bytes). `$limit=200000` covered the largest file (Baltimore City, 14,806 rows).

## Freshness evidence

Two publisher dates, both read 2026-11-06.

1. Dataset metadata <https://opendata.maryland.gov/api/views/ed4q-f8tm.json>, HTTP 200 at `Fri, 06 Nov 2026 22:55:26 GMT`. `rowsUpdatedAt` 1793936319 = 2026-11-06T03:38:39Z. `viewLastModified` and `publicationDate` 1791254405 = 2026-10-06T02:40:05Z. Custom field Update Frequency: `Monthly`. Custom field Time Period of Content: `See https://opendata.maryland.gov/d/6bx4-iirp for data update timestamps`. The 2026-11-03 record said `rowsUpdatedAt` 2026-10-05. That field has moved. The license text has not.

2. Column `date_of_most_recent_open_data_portal_record_update` on `ed4q-f8tm`, all land uses:

```
curl -fsS -A "$UA" --max-time 180 -o "$DATA/terms/asof-counts.csv" -D "$DATA/terms/asof.headers" \
  --get "https://opendata.maryland.gov/resource/ed4q-f8tm.csv" \
  --data-urlencode '$select=date_of_most_recent_open_data_portal_record_update,count(*) as n' \
  --data-urlencode '$group=date_of_most_recent_open_data_portal_record_update'
```

HTTP 200. Body: `20261005` = 45; `20261105` = 2,434,580. Sum 2,434,625.

The archived in-scope files (C, CC, I, M only) contain 14 of those 20261005 rows: Calvert 1, Carroll 9, Queen Anne's 1, St. Mary's 1, Washington 2. Every other in-scope row is 20261105. The other 31 statewide 20261005 accounts were not grouped by land use. The load used `--as-of 2026-11-05`, the date on 2,434,580 accounts and on every in-scope row except those 14.

3. Companion dataset `6bx4-iirp`, which the metadata names as the timestamp table. HTTP 200 at `Fri, 06 Nov 2026 23:06:34 GMT` (sample) and `Fri, 06 Nov 2026 23:07:09 GMT` (group). User agent `FactLotRegistryBot/0.4 (+https://factlot.com/registry; contact@factlot.com)`.

```
curl -fsS -A "$UA" --max-time 120 -o "$DATA/terms/6bx4-by-county.csv" -D "$DATA/terms/6bx4-group.headers" \
  --get "https://opendata.maryland.gov/resource/6bx4-iirp.csv" \
  --data-urlencode '$select=county_name_mdp_field_cntyname,date_of_most_recent_open_data_portal_record_update,count(*) as n' \
  --data-urlencode '$group=county_name_mdp_field_cntyname,date_of_most_recent_open_data_portal_record_update'
```

38 groups, each with `n` = 1. This dataset stores one row per county and date, so `n` is the presence of that pair and is an account count nowhere. Every jurisdiction has 20261105. These jurisdictions also have a 20261005 row: Allegany, Baltimore, Calvert, Carroll, Frederick, Garrett, Harford, Kent, Prince George's, Queen Anne's, Somerset, St. Mary's, Talbot, Washington. These have only 20261105: Anne Arundel, Baltimore City, Caroline, Cecil, Charles, Dorchester, Howard, Montgomery, Wicomico, Worcester.

The PDF, read the same day, says the open-data dataset is updated monthly. Verbatim, from `Real_Property_Records_Documentation.pdf` (creation date in the file text: the page footer is 06/08/2015; the header line is `Last Edit: DoIT, November 18th 2022`):

> This resulting opendata.maryland.gov dataset is updated monthly on or about the 3rd day of each month (depends on availability of SDAT’s data and therefore might be later some months)

## Terms read on 2026-11-06

Compared with the 2026-11-03 record. The license object, attribution, PDF disclaimer, monthly update sentence, and robots summary are the same text. No AI-use ban, redistribution ban, commercial-use ban, or click-through was in the metadata JSON, the PDF text, or the data-story payload. The load proceeded.

Dataset metadata, HTTP 200, <https://opendata.maryland.gov/api/views/ed4q-f8tm.json>:

- `licenseId`: `PUBLIC_DOMAIN`
- `license`: `{"name": "Public Domain"}`
- `attribution`: `SDAT (State Department of Assessments and Taxation) and MDP (Maryland Department of Planning)`
- `attributionLink`: `http://www.dat.state.md.us/`
- `name`: `Maryland Real Property Assessments_Hidden Property Owner Names`
- `category`: `Business and Economy`

A search of that JSON and of the extracted PDF text for `redistribut`, `commercial use`, `artificial intelligence`, `machine learning`, `click-through`, and `sublicen` returned no matches.

PDF, HTTP 200, <https://opendata.maryland.gov/api/views/ed4q-f8tm/files/5064508a-f244-4741-a548-b5ec5c5f3019?download=true&filename=Real_Property_Records_Documentation.pdf>. Verbatim disclaimer:

> MDP does not provide any guaranty of accuracy or completeness regarding the map information.

The same PDF says the dataset joins SDAT records (updated daily) with MDP parcel records (updated approximately annually), and that property records in the open-data dataset may not exactly match external property records. The PDF has no public-domain clause of its own. The address caveat already in the source record (MDP street address can fall back to an owner address for some owner-occupied accounts) is still in that PDF. This lane did not re-quote the whole address paragraph.

robots.txt, HTTP 200, <https://opendata.maryland.gov/robots.txt>:

```
User-agent: *
Crawl-delay: 1
```

`Disallow` is limited to browse, catalog, page, and facet URLs carrying `q=`, `category=`, `sortBy=`, `tags=`, `limitTo=`, `federation_filter=`, or `view_type=`, plus `*/alt`, `/OData.svc/`, `/api/odata/`, `/login`, `/reset_password/`, `/tiles/`, and `/api/collocate*`. `/resource/ed4q-f8tm.csv` and `/api/views/` are allowed. That matches the 2026-11-03 summary.

Data story, HTTP 200 at `Fri, 06 Nov 2026 23:14:53 GMT`, <https://opendata.maryland.gov/stories/s/Maryland-Real-Property-Resources/x8p6-5dqp/>. The HTML shell's `window.STORY_DATA` describes `ed4q-f8tm` as the main open dataset. It also describes a different asset. Verbatim (tags removed, spaces collapsed), about `Maryland Real Property Assessments: Includes Property Owner Names` at <https://opendata.maryland.gov/Business-and-Economy/Maryland-Real-Property-Assessments-Includes-Proper/9xq5-z8s2>:

> This asset is unavailable to users who have not signed the user license agreement.

> To access this asset, be sure you have an active account on the Open Data Portal (citizen sign up form link), then send an email requesting access to Service.Desk@maryland.gov . Your will receive the Terms & Conditions in response; after agreeing to them (via email reply to all), you will be given access to this dataset ( terms are in the description of this asset's metadata ). You don't see the terms here because you will need to reply to all in the email so that it is stored with the ticket.

That sentence is about asset `9xq5-z8s2`. This source loads `ed4q-f8tm` only. The owner-name asset was not requested, no account was created, and its emailed terms were not read. The 2026-11-03 Gates section already says there is no free source of Maryland owner names. This story confirms a separate gated asset. It does not change the Public Domain license on `ed4q-f8tm`.

## Findings

- Audit warnings, which are outside the violation bar: 4 parcels with an implausible year built, 7 with an implausible area. Bounds in `audit.py`: year built below 1700, area above 500,000,000 square feet. Year built: Talbot stored `1697` (1); Baltimore City stored `1` (3). The adapter's `_positive` drops 0 and keeps 1. Land area stored values, one parcel each: Anne Arundel `1005626160.0` and `525987000.0`; Harford `1531090440.0`; Baltimore City `1427461200.0`, `2775991680.0`, `3341444040.0`, `804509640.0`. No improvement area exceeded the bound.
- `M` Apartments stays in scope as `B`. It is a multifamily class, and 6,042 of 11,746 kept `M` accounts have field 239 under 5. `CR` and `RC` are the mixed-use labels and stay out of scope. `EC` exempt commercial stays out of scope.
- Twelve deletion-dated accounts were skipped: Montgomery 3 (C 1, I 2), Anne Arundel 4 (C 2, I 2), Baltimore City 5 (C 4, I 1). Publisher in-scope 109,261 minus 12 = kept 109,249.
- The unmodified collector CLI refused every URL (`resolves to non-public address 198.18.0.1`). The manifest's first 24 lines are that refusal; the next 24 are `archived`. The archive run called the existing `snapshot()` after setting `allow_private_addresses = True` on the in-memory `CollectorConfig` only. Robots, `allowed_hosts`, and the 2-second interval still applied. Publisher responses on the curls above were HTTP 200. Collector code, the adapter, and `registry/sources/md/md-sdat-real-property.json` were not edited.
- `factlot.registry.audit` `_READER_MODULES` does not include `md_sdat`, so `--reread` wrote 24 `source_file` entries `{"error": "no adapter registered for this source"}`. `violations` is `[]` and the process exit code was 0. The promotion re-read is the `reread_source_file` comparison above. `audit.py` was not edited.
- Maintainer steps (`maintain --all`): purge of person owners removed 0; organisation owners 0; ownership links 0; no entity registry is loaded for Maryland, which the audit records as `links.note`.

## Commands

`DATA` is the collector's archive directory. Terms user agent except where noted: `FactLotRegistryBot/terms-check (+https://factlot.com/registry; contact@factlot.com)`. Requests were sequential, with `sleep 2` between publisher calls.

```
curl -fsS -A "$UA" --max-time 60 -o "$DATA/terms/robots.txt" -D "$DATA/terms/robots.headers" \
  "https://opendata.maryland.gov/robots.txt"
curl -fsS -A "$UA" --max-time 90 -o "$DATA/terms/ed4q-f8tm.json" -D "$DATA/terms/meta.headers" \
  "https://opendata.maryland.gov/api/views/ed4q-f8tm.json"
curl -fsS -A "$UA" --max-time 120 -o "$DATA/terms/Real_Property_Records_Documentation.pdf" -D "$DATA/terms/pdf.headers" \
  "https://opendata.maryland.gov/api/views/ed4q-f8tm/files/5064508a-f244-4741-a548-b5ec5c5f3019?download=true&filename=Real_Property_Records_Documentation.pdf"
curl -fsS -A "$UA" --max-time 180 -o "$DATA/terms/asof-counts.csv" -D "$DATA/terms/asof.headers" \
  --get "https://opendata.maryland.gov/resource/ed4q-f8tm.csv" \
  --data-urlencode '$select=date_of_most_recent_open_data_portal_record_update,count(*) as n' \
  --data-urlencode '$group=date_of_most_recent_open_data_portal_record_update'
curl -fsS -A "$UA" --max-time 180 -o "$DATA/terms/lu-by-county.csv" -D "$DATA/terms/lu.headers" \
  --get "https://opendata.maryland.gov/resource/ed4q-f8tm.csv" \
  --data-urlencode '$select=county_name_mdp_field_cntyname,jurisdiction_code_mdp_field_jurscode,land_use_code_mdp_field_lu_desclu_sdat_field_50,count(*) as n' \
  --data-urlencode '$group=county_name_mdp_field_cntyname,jurisdiction_code_mdp_field_jurscode,land_use_code_mdp_field_lu_desclu_sdat_field_50'
curl -fsS -A "$UA" --max-time 90 -o "$DATA/terms/field50.json" -D "$DATA/terms/field50.headers" \
  --get "https://opendata.maryland.gov/resource/w8th-47fz.json" \
  --data-urlencode "$where=api_field_name='land_use_code_mdp_field_lu_desclu_sdat_field_50'"
```

Freshness companion and the data story used `FactLotRegistryBot/0.4 (+https://factlot.com/registry; contact@factlot.com)`:

```
curl -fsS -A "$UA" --max-time 60 -o "$DATA/terms/6bx4-iirp-sample.json" -D "$DATA/terms/6bx4.headers" \
  --get "https://opendata.maryland.gov/resource/6bx4-iirp.json" --data-urlencode '$limit=5'
curl -fsS -A "$UA" --max-time 120 -o "$DATA/terms/6bx4-by-county.csv" -D "$DATA/terms/6bx4-group.headers" \
  --get "https://opendata.maryland.gov/resource/6bx4-iirp.csv" \
  --data-urlencode '$select=county_name_mdp_field_cntyname,date_of_most_recent_open_data_portal_record_update,count(*) as n' \
  --data-urlencode '$group=county_name_mdp_field_cntyname,date_of_most_recent_open_data_portal_record_update'
curl -fsS -A "$UA" --max-time 60 -o "$DATA/terms/data-story.html" -D "$DATA/terms/story.headers" \
  "https://opendata.maryland.gov/stories/s/Maryland-Real-Property-Resources/x8p6-5dqp/"
```

Collect. The CLI refusal is in the manifest. Exit code of that process was 0 because a refusal is recorded per URL.

```
PYTHONPATH=python/src python3 -m factlot.collector snapshot \
  --config registry/sources --out "$DATA/collected" --source md-sdat-real-property
```

Load, once per archived file, no `--full-roll` and no `--tax-year`. `--retrieved-at` is that file's manifest `checked_at`. Stats summed above.

```
PYTHONPATH=python/src python3 -m factlot.registry.adapters.md_sdat \
  "$DATA/collected/md-sdat-real-property/<sha16>/ed4q-f8tm.csv" \
  "$DATA/registry.db" --as-of 2026-11-05 --retrieved-at <manifest checked_at>
```

Maintain and audit:

```
PYTHONPATH=python/src python3 -m factlot.registry.maintain "$DATA/registry.db" --all
PYTHONPATH=python/src python3 -m factlot.registry.audit "$DATA/registry.db" \
  --collected "$DATA/collected" --reread --entity-names --today 2026-11-06 \
  --out docs/registry/quality/audit-2026-11-06/md-sdat-real-property-audit.json
```

Maintain exit 0. Audit exit 0. `violations` is `[]`. `owners.person_like` is 0. `owners.owner_facts` is 0. `stats.parcels` is 109249. `stats.facts` is 878548.
