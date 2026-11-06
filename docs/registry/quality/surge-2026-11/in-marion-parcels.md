# in-marion-parcels: Tier 1 audit, 2026-11-06

**Promotion bar: pass.** Audited is not complete. The scratch registry holds every distinct state parcel number in the publisher's class 300–499 extract. Classes outside 300–499 are not in the extract. The layer has no year built, no building area and no stated roll year.

Lane A6. County FIPS **18097** (Indiana 18). Evidence JSON: [in-marion-parcels-audit.json](in-marion-parcels-audit.json). Scratch database was kept outside the repository and is not committed.

## County count

| FIPS  | Parcels kept |     B |     F1 |    F2 | Snapshot as of | Age on 2026-11-06 |
| ----- | -----------: | ----: | -----: | ----: | -------------- | ----------------: |
| 18097 |       20,626 | 1,357 | 15,496 | 3,773 | 2026-11-06     |            0 days |

The 2026-11-03 load was 20,630 parcels (B 1,357, F1 15,498, F2 3,775) from 20,866 polygons. This re-collection is 20,862 polygons and 20,626 parcels. B is unchanged; F1 is down 2 and F2 is down 2. The record's audit note carries the new as-of.

## Publisher land-use map

Indiana DLGF property class (`PROPERTY_SUB_CLASS`), not a Texas property-class crosswalk. The adapter (`state_category` in `in_marion`) maps the code:

| Publisher code                                           | Publisher meaning                                   | FactLot      |
| -------------------------------------------------------- | --------------------------------------------------- | ------------ |
| `401`, `402`, `403`                                      | apartments, 4–19 / 20–39 / 40 or more units         | B            |
| other `4xx`, including `400` and `409` vacant commercial | commercial                                          | F1           |
| `3xx`                                                    | industrial                                          | F2           |
| `1xx`, `2xx`, `5xx`, `6xx`, `8xx`                        | agricultural, mineral, residential, exempt, utility | out of scope |

`local_use_code` keeps `PROPERTY_SUB_CLASS`. One tax parcel can be several polygons; the adapter keeps the first row and sums `ESTSQFT`. This extract has 20,862 polygons, 20,626 distinct `STATEPARCELNUMBER`s, and 236 extra polygon rows (81 parcel numbers repeat). Apartment feature counts are unchanged from the record: `401` 317, `402` 178, `403` 1,034.

## Commercial-universe denominator

Published by the layer's count query on 2026-11-06 (`returnCountOnly`, `PROPERTY_SUB_CLASS` 300–499): **20,862** features. That matches the archived pages. The service does not publish a distinct-parcel commercial total; the distinct count, 20,626, is computed from `STATEPARCELNUMBER` in those features, and the registry holds all 20,626. The layer JSON has no editing info and an empty copyright string. The item `licenseInfo`, re-read 2026-11-06, still says there are "no restrictions on the use of Data" and that derived data must acknowledge the City of Indianapolis/Marion County, IN. Terms URL: <https://www.arcgis.com/home/item.html?id=0d28e222479743baa97f8f4456da7bb4>. No new rights question.

## Freshness

`--as-of 2026-11-06` is the retrieval date. The publisher describes the layer as updated nightly and publishes no single extract date. `MODDATE` is not usable as one (the values are not a single calendar). Every page sha256 differs from the 2026-11-03 archive, and the feature count moved from 20,866 to 20,862. Age 0 days, inside 400.

## Fill rates

From the audit, over 20,626 current parcels:

| Field                            | Parcels | Present |
| -------------------------------- | ------: | ------: |
| APN                              |  20,626 |    100% |
| State category                   |  20,626 |    100% |
| Situs address                    |  20,626 |    100% |
| Appraised value (assessed total) |  20,543 |   99.6% |
| Market value                     |       0 |      0% |
| Land area                        |  20,626 |    100% |
| Improvement area                 |       0 |      0% |
| Year built                       |       0 |      0% |
| Tax year                         |       0 |      0% |
| Owner of record (organisation)   |  16,122 |  78.16% |

Organisation owners stored: 16,122. Names the current rule does not store: 4,504. Person-like owner facts in the registry: 0. No entity registry for Indiana was loaded, so none of the owners link.

## Promotion bar

| Check                                                                              | Result                                                                                                                                                                                                                                                                                                                                   |
| ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Re-read yields exactly the parcels the registry holds                              | Pass for the registry's parcel set. `read_roll` on all 21 pages yields 20,626 ids, identical to the registry. Read one page at a time, 11 of 21 pages also yield a parcel the registry already kept from an earlier page (the 236 extra polygons). That is the adapter's cross-page collapse, not an extra parcel and not a missing one. |
| Audit violations                                                                   | Pass. 0. The audit command exited 0.                                                                                                                                                                                                                                                                                                     |
| Person-like owner facts                                                            | Pass. 0.                                                                                                                                                                                                                                                                                                                                 |
| Per-county count matches the record, or the record is corrected with the new as-of | Pass after correction. 20,626 on as-of 2026-11-06, against 20,630 on 2026-11-03.                                                                                                                                                                                                                                                         |
| as-of within 400 days                                                              | Pass. 0 days.                                                                                                                                                                                                                                                                                                                            |

`--reread` on the audit command records `no adapter registered for this source` because `factlot.registry.audit` does not list this adapter. This lane does not edit that module. The comparison above called `in_marion.read_roll` directly.

Warning, not a bar failure: 2 parcels have land area over 500 million square feet, from summed `ESTSQFT` (`49-02-13-131-027.000-400` at 903,778,088.4 and `49-07-23-122-018.000-700` at 726,145,200.0). The figures are the publisher's. They were not changed.
