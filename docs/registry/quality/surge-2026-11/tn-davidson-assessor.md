# tn-davidson-assessor: Tier 1 audit, 2026-11-06

**Promotion bar: pass.** Audited is not complete. The scratch registry holds every parcel whose Davidson land-use code the adapter maps to an apartment, commercial or industrial use. It does not hold the rest of the roll. Vacant land and greenhouses inside the download filter are dropped on purpose.

Lane A6. County FIPS **47037** (Tennessee 47). Evidence JSON: [tn-davidson-assessor-audit.json](tn-davidson-assessor-audit.json). Scratch database was kept outside the repository and is not committed.

## County count

| FIPS  | Parcels kept |   B |     F1 |    F2 | Snapshot as of | Age on 2026-11-06 |
| ----- | -----------: | --: | -----: | ----: | -------------- | ----------------: |
| 47037 |       13,111 | 973 | 10,766 | 1,372 | 2026-11-06     |            0 days |

The parcel count and the category split match the 2026-11-03 record. The file does not. This export is sha256 `7d73ada67b98d39781de5010f5e6732bbccbf1308f23994c773f4e919a1a7ddb`, 5,823,139 bytes, `Last-Modified` Fri, 06 Nov 2026 21:58:53 GMT. The record's file was `53b25baeeea770bf…`, 5,824,645 bytes, as-of 2026-11-02. The record's audit note carries as-of 2026-11-06.

## Publisher land-use map

The Assessor's land-use code (`LUCode` / `Land Use Code`) on the Metro Parcels layer, not a Texas property-class crosswalk. The adapter (`state_category` in `tn_davidson`) maps these codes. Counts are rows in the 2026-11-06 export:

| Codes                                                                         | Meaning                                                                                                             | FactLot      |         Rows |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ------------ | -----------: |
| `037`, `038`, `039`                                                           | apartments (walk-up, low rise, high rise)                                                                           | B            | 86, 667, 220 |
| `021`–`029`, `031`–`036`, `041`–`049`, `051`–`059`, `061`–`065`, `067`, `069` | retail, office, bank, auto, restaurant, hotel, parking, storage, and the other commercial uses in the source record | F1           |       10,766 |
| `071`–`078`                                                                   | manufacturing, processing, distribution, open storage                                                               | F2           |        1,372 |
| `030`, `070`                                                                  | vacant multi-family, vacant industrial                                                                              | out of scope |     116, 388 |
| `066`                                                                         | greenhouse / nursery                                                                                                | out of scope |           12 |
| `010`, `020`, `080`, `090`, residential, rural, exempt, government            | not in this filter, or dropped                                                                                      | out of scope |            — |

`034` is 330 and `035` is 16. The 2026-11-03 record listed medical office as 346 and did not list `035` separately; 330 + 16 = 346, and both codes stay F1, so the F1 total is unchanged. `local_use_code` keeps the code.

## Commercial-universe denominator

The feature service on 2026-11-06:

- Whole layer: **287,888** features (the record's 287,827 was 2026-11-03).
- `LUCode > '020' AND LUCode < '080'`, the verified download filter: **13,627**, matching the CSV row count.

The publisher does not publish a separate "commercial parcel" total. Of those 13,627 rows, 516 are vacant land or greenhouses (`030`, `070`, `066`) and are out of the map above. The remaining **13,111** are the commercial-universe count under the county's own codes, and the registry holds 13,111. Rows in the filter are already one per parcel id (13,627 distinct).

The Nashville.gov terms page, re-read 2026-11-06, still says commercial use of site materials is prohibited "Excluding publicly available data on Metro's Open Data Portal". The item `licenseInfo` still points at the Open Data executive order and states no new restriction. No new rights question. The record's note that a person may still ask `opendata@nashville.gov` to confirm republishing is unchanged.

## Freshness

`editingInfo.dataLastEditDate` on `Parcels_view` is 2026-11-06 11:09:47 UTC. `--as-of 2026-11-06` is that date. The layer is described as updated daily. Age 0 days, inside 400.

## Fill rates

From the audit, over 13,111 current parcels:

| Field                          | Parcels | Present |
| ------------------------------ | ------: | ------: |
| APN                            |  13,111 |    100% |
| State category                 |  13,111 |    100% |
| Situs address                  |  13,111 |    100% |
| Appraised value                |  13,102 |  99.93% |
| Market value                   |       0 |      0% |
| Land area                      |  12,258 |  93.49% |
| Improvement area               |       0 |      0% |
| Year built                     |       0 |      0% |
| Tax year                       |       0 |      0% |
| Owner of record (organisation) |   8,548 |   65.2% |

Organisation owners stored: 8,548. Names not stored: 4,563. Person-like owner facts: 0. The 2026-11-03 full load recorded 8,557 organisation owners on a different file. No Tennessee entity registry was loaded, so none of the owners link. Facts written: 94,900.

## Promotion bar

| Check                                                                              | Result                                                                                                                                  |
| ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Re-read yields exactly the parcels the registry holds                              | Pass. `read_roll` on the CSV yields 13,111 ids, identical to the registry.                                                              |
| Audit violations                                                                   | Pass. 0.                                                                                                                                |
| Person-like owner facts                                                            | Pass. 0.                                                                                                                                |
| Per-county count matches the record, or the record is corrected with the new as-of | Pass. Count 13,111 matches. as-of corrected from 2026-11-02 to 2026-11-06 because the service's last-edit date and the file both moved. |
| as-of within 400 days                                                              | Pass. 0 days.                                                                                                                           |

`--reread` reports `no adapter registered for this source` because the audit module's adapter list does not include `tn_davidson`. The comparison above called `tn_davidson.read_roll` on the archived CSV.
