# ga-dekalb-parcels: Tier 1 audit, 2026-11-06

**Promotion bar: pass.** Audited is not complete. The audited registry holds every distinct parcel in the publisher's class C and class I export. Class C is not a single use: the file has no land-use code, so apartments, hotels and vacant commercial lots stay F1 and B is empty.

County FIPS **13089** (Georgia 13). Evidence JSON: [ga-dekalb-parcels-audit.json](ga-dekalb-parcels-audit.json).

## County count

| FIPS  | Parcels kept |   B |    F1 |    F2 | Snapshot as of | Age on 2026-11-06 |
| ----- | -----------: | --: | ----: | ----: | -------------- | ----------------: |
| 13089 |       11,351 |   0 | 9,099 | 2,252 | 2026-11-01     |            5 days |

This matches the source record (11,351 parcels, F1 9,099, F2 2,252). The Hub CSV is the same file as the 2026-11-03 archive: `fl:document:sha256-6b569f0b50728ba3b2e9cdb171603439c6a37e717cd227aa0e8abb966e96d74c`, 5,001,349 bytes, `Last-Modified` Tue, 03 Nov 2026 07:59:24 GMT.

## Publisher land-use map

Georgia digest class (`CLASSDSCRP`, Ga. Comp. R. & Regs. 560-11-2-.21), not a Texas property-class crosswalk. The adapter (`state_category` in `ga_dekalb`) maps the class letter. Counts are rows in this file:

| Class                                            |              Rows | FactLot      |
| ------------------------------------------------ | ----------------: | ------------ |
| `C1` 78, `C3` 8,096, `C4` 737, `C5` 103, `C9` 86 |             9,100 | F1           |
| `I1` 9, `I3` 1,845, `I4` 321, `I5` 74, `I9` 3    |             2,252 | F2           |
| `R`, `E`, `U`, `V`, `H`, `B`, blank              | not in the export | out of scope |

One `PARCELID` is repeated, so 11,352 rows become 11,351 parcels. `local_use_code` keeps the class (`C3`). `USECD` is empty, so nothing in class C is mapped to B.

## Commercial-universe denominator

The feature service's count query on 2026-11-06, `CLASSDSCRP LIKE 'C%' OR CLASSDSCRP LIKE 'I%'`, returned **11,352**. The whole layer returned **246,494**. Both match the record and the archived CSV. Distinct parcels in that export: 11,351, all kept. The publisher does not publish a land-use split inside class C, so there is no published apartment or vacant-commercial count to compare. The item `licenseInfo` is still `CC0` (re-read 2026-11-06). The recorded rights are unchanged.

## Freshness

`editingInfo.dataLastEditDate` on `TaxParcelsOD` is 2026-11-01 02:34:46 UTC. `--as-of 2026-11-01` is that date. The live class C/I count equals the archived file, so the Hub cache is the current export. Age 5 days, inside 400.

## Fill rates

From the audit, over 11,351 current parcels:

| Field                                        | Parcels | Present |
| -------------------------------------------- | ------: | ------: |
| APN                                          |  11,351 |    100% |
| State category                               |  11,351 |    100% |
| Situs address                                |  11,279 |  99.37% |
| Market value and appraised value (`TOTAPR1`) |  11,230 |  98.93% |
| Land area                                    |  11,333 |  99.84% |
| Improvement area                             |       0 |      0% |
| Year built                                   |       0 |      0% |
| Tax year                                     |       0 |      0% |
| Owner of record (organisation)               |   9,175 |  80.83% |

Organisation owners stored: 9,175. Names not stored: 2,176. Person-like owner facts: 0. No Georgia entity registry was loaded, so none of the owners link. Facts written on this rebuild: 97,473, the same count as the record's real-run line. The record's full-load line says 97,437 facts on this same sha256; this rebuild does not reproduce that fact total. The parcel count does.

## Promotion bar

| Check                                                                              | Result                                                                                                      |
| ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Re-read yields exactly the parcels the registry holds                              | Pass. `read_roll` on the CSV yields 11,351 ids, identical to the registry, and the single snapshot matches. |
| Audit violations                                                                   | Pass. 0.                                                                                                    |
| Person-like owner facts                                                            | Pass. 0.                                                                                                    |
| Per-county count matches the record, or the record is corrected with the new as-of | Pass. 11,351, as-of unchanged at 2026-11-01.                                                                |
| as-of within 400 days                                                              | Pass. 5 days.                                                                                               |

`--reread` reports `no adapter registered for this source` because the audit module's adapter list does not include `ga_dekalb`. The comparison above called `ga_dekalb.read_roll` on the archived CSV.
