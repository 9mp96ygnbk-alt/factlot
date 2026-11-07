# mi-oakland-parcels: Tier 1 audit, 2026-11-06

**Promotion bar: pass.** Audited is not complete. The audited registry holds every distinct commercial PIN in the publisher's class 2xx/3xx extract, and it holds nothing else from this source. The open layer publishes no owner names, no land area and no separate apartment class.

County FIPS **26125** (Michigan 26). Evidence JSON: [mi-oakland-parcels-audit.json](mi-oakland-parcels-audit.json).

## County count

| FIPS  | Parcels kept |   B |     F1 |    F2 | Snapshot as of | Age on 2026-11-06 |
| ----- | -----------: | --: | -----: | ----: | -------------- | ----------------: |
| 26125 |       26,122 |   0 | 21,455 | 4,667 | 2026-11-06     |            0 days |

The 2026-11-03 load in the source record was 26,124 parcels (F1 21,459, F2 4,665). This re-collection is 2 parcels smaller. The record's audit note carries the new as-of.

## Publisher land-use map

Michigan State Tax Commission class (`CLASSCODE`, MCL 211.34c), not a Texas property-class crosswalk. FactLot `B` / `F1` / `F2` are only the registry's scope labels. The adapter (`state_category` in `mi_oakland`) maps the first digit:

| Publisher code                           | Meaning in this layer                                    | FactLot      | Features on 2026-11-06 |
| ---------------------------------------- | -------------------------------------------------------- | ------------ | ---------------------- |
| `201`                                    | commercial improved                                      | F1           | 17,439                 |
| `202`                                    | commercial vacant                                        | F1           | 3,346                  |
| `203`, `205`, `210`                      | other commercial                                         | F1           | 168, 1, 4              |
| `207`                                    | commercial condominium                                   | F1           | 501                    |
| `301`                                    | industrial improved                                      | F2           | 3,262                  |
| `302`                                    | industrial vacant                                        | F2           | 1,338                  |
| `303`, `307`, `310`                      | other industrial                                         | F2           | 32, 32, 3              |
| `1xx`, `4xx`, `5xx`, `6xx`, county `00x` | agricultural, residential, timber, developmental, exempt | out of scope | not in the extract     |

There is no multifamily class. Apartments of more than four units are commercial (`2xx`) and stay F1. Four PINs repeat inside a page rather than across pages: each page's re-read matches that page's coverage. The adapter keeps the first row, so 26,126 features become 26,122 parcels. `local_use_code` keeps `CLASSCODE`.

## Commercial-universe denominator

Published by the layer's own count query on 2026-11-06 (`returnCountOnly`, same `where` as the verified config): **26,126** features with a class code beginning 2 or 3. The whole layer is **490,821** parcels (the record's 490,784 was the 2026-11-03 figure). Distinct PINs inside the commercial extract: **26,122**, and the registry holds 26,122. A publisher total of "commercial parcels" other than that class filter is not published. The load is the full distinct-PIN set of that filter. It is not the whole county roll, and it has no owners.

## Freshness

`--as-of 2026-11-06` is the retrieval date. The layer JSON has no `editingInfo` and the query responses have no `Last-Modified`. `REVISIONDATE` on the commercial rows runs from 2005-01-01 through 2026-10-21 (Unix seconds). The pages are not the 2026-11-03 files: every page sha256 differs, and the feature count moved from 26,128 to 26,126. Age 0 days, inside 400.

## Fill rates

From the audit, over 26,122 current parcels:

| Field                                                          | Parcels | Present |
| -------------------------------------------------------------- | ------: | ------: |
| APN                                                            |  26,122 |    100% |
| State category                                                 |  26,122 |    100% |
| Situs address                                                  |  21,911 |  83.88% |
| Appraised value (`ASSESSEDVALUE`, the Michigan assessed value) |  24,340 |  93.18% |
| Market value                                                   |       0 |      0% |
| Land area                                                      |       0 |      0% |
| Improvement area (`LIVING_AREA_SQFT`)                          |     234 |    0.9% |
| Year built                                                     |       0 |      0% |
| Tax year                                                       |       0 |      0% |
| Owner of record                                                |       0 |      0% |

`NAME1` was null on all 26,126 features. Organisation owners stored: 0. Person-like owner facts: 0.

## Promotion bar

| Check                                                                              | Result                                                                                                                                                                                            |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Re-read yields exactly the parcels the registry holds                              | Pass. `read_roll` on the 14 pages yields 26,122 parcel ids, the same set the registry holds. Each page read alone also matches that page's coverage (the four repeated PINs sit inside one page). |
| Audit violations                                                                   | Pass. 0. `python -m factlot.registry.audit` exited 0.                                                                                                                                             |
| Person-like owner facts                                                            | Pass. 0.                                                                                                                                                                                          |
| Per-county count matches the record, or the record is corrected with the new as-of | Pass after correction. 26,122 on as-of 2026-11-06, against 26,124 on 2026-11-03.                                                                                                                  |
| as-of within 400 days                                                              | Pass. 0 days.                                                                                                                                                                                     |

The audit's `--reread` records `no adapter registered for this source` on all 14 snapshots. `factlot.registry.audit` only loads the Tier 1 adapter list. The re-read above ran `mi_oakland.read_roll` on the archived pages and compared parcel ids to the registry.

Warnings, not bar failures: 4,211 of 26,122 parcels have no situs address. No implausible values. The recorded rights are unchanged. The item's section 3, re-read 2026-11-06, still says reuse is allowed "for any lawful purpose" and forbids only an unlawful purpose. Terms URL: <https://www.arcgis.com/home/item.html?id=e2910cc3a8f84549ab7f0f8e8f99817b>.
