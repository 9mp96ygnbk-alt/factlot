# pa-montgomery-parcels: Tier 1 audit, 2026-11-06

**Promotion bar: pass.** Audited is not complete. The audited registry holds every distinct `TAXPIN` in the county classes A, C and I. Residential, exempt, utility and agricultural classes are not in the download. Values are base-year values.

County FIPS **42091** (Pennsylvania 42). Evidence JSON: [pa-montgomery-parcels-audit.json](pa-montgomery-parcels-audit.json).

## County count

| FIPS  | Parcels kept |   B |     F1 |    F2 | Snapshot as of | Age on 2026-11-06 |
| ----- | -----------: | --: | -----: | ----: | -------------- | ----------------: |
| 42091 |       15,584 | 678 | 12,244 | 2,662 | 2026-10-05     |           32 days |

This matches the source record. The three Hub CSVs are the same files as the 2026-11-03 archive (same sha256 and byte counts: A `14b606a871eba761…` 554,924 bytes, C `23caa211dc4bd7ad…` 9,664,071 bytes, I `2a208007c010b7d5…` 2,109,102 bytes). `Last-Modified` on all three is 2026-11-03.

## Publisher land-use map

The county's own `CLASS` letter, defined in its Parcel Codes PDF, not a Texas property-class crosswalk. The adapter (`state_category` in `pa_montgomery`) maps the letter. `LAND_USE` (four digits) is kept as `local_use_code` and is not what decides the category.

| `CLASS`                   | Publisher definition                                              | FactLot      | Feature count on 2026-11-06 | Distinct `TAXPIN` kept |
| ------------------------- | ----------------------------------------------------------------- | ------------ | --------------------------: | ---------------------: |
| `A`                       | apartment, multifamily, five or more families                     | B            |                         692 |                    678 |
| `C`                       | commercial: trade, services, recreational                         | F1           |                      12,393 |                 12,244 |
| `I`                       | industrial: manufacturing and processing                          | F2           |                       2,705 |                  2,662 |
| `R`, `E`, `U`, `F`, blank | residential (one to four families), exempt, utility, agricultural | out of scope |              not downloaded |                      — |

Repeated rows are the same parcel drawn as more than one polygon. The adapter keeps the first row per `TAXPIN`.

## Commercial-universe denominator

The feature service `Montgomery_County_Parcels` layer 6, queried 2026-11-06 with `returnCountOnly`:

| Class | Live feature count |
| ----- | -----------------: |
| A     |                692 |
| C     |             12,393 |
| I     |              2,705 |

Those are the same counts as the archived files and the record. The service does not publish a distinct-parcel total; distinct `TAXPIN`s are 15,584, and the registry holds 15,584. The rest of the county roll (classes other than A, C and I) is outside this denominator.

`editingInfo.dataLastEditDate` is 2026-10-05 15:19:03 UTC. The item `licenseInfo`, re-read 2026-11-06, is still: "Montgomery County provides this data as a free and open resource. While every reasonable effort is made to ensure the accuracy and completeness of the data, Montgomery County makes no representations about the suitability of this data for any purpose. All data is provided \"as is\" without warranties of any kind, either express or implied, and it should not be construed or used as a legal description." The recorded rights are unchanged. The record's note that the custom licence does not itself say "public domain" remains.

## Freshness

`--as-of 2026-10-05` is the service's data last-edit date, the same date the record used. The Hub still serves the 2026-11-03 cache because the layer has not been edited since. Age 32 days, inside 400.

## Fill rates

From the audit, over 15,584 current parcels:

| Field                           | Parcels | Present |
| ------------------------------- | ------: | ------: |
| APN                             |  15,584 |    100% |
| State category                  |  15,584 |    100% |
| Situs address                   |  15,584 |    100% |
| Market value and assessed value |  15,255 |  97.89% |
| Land area                       |  15,499 |  99.45% |
| Commercial building area        |  11,870 |  76.17% |
| Year built                      |  13,168 |   84.5% |
| Tax year                        |       0 |      0% |
| Owner of record (organisation)  |  10,246 |  65.75% |

Situs, land area, building area, year built and values match the record's real-run line. Organisation owners stored on this rebuild: 10,246. Names not stored: 5,338 (class A 131, C 4,507, I 700). The real-run note, on these same files, said 10,221 organisation owners and 5,363 names not stored. The current owner rule stores 25 more of those names as organisations. Person-like owner facts: 0. No Pennsylvania entity registry was loaded, so none of the owners link. Facts written: 153,874 (the real-run note said 153,824 on the same files).

## Promotion bar

| Check                                                                              | Result                                                                                                                |
| ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Re-read yields exactly the parcels the registry holds                              | Pass. Reading the three class files yields 15,584 ids, identical to the registry, and each file matches its snapshot. |
| Audit violations                                                                   | Pass. 0.                                                                                                              |
| Person-like owner facts                                                            | Pass. 0.                                                                                                              |
| Per-county count matches the record, or the record is corrected with the new as-of | Pass. 15,584, as-of unchanged at 2026-10-05.                                                                          |
| as-of within 400 days                                                              | Pass. 32 days.                                                                                                        |

`--reread` reports `no adapter registered for this source` because the audit module's adapter list does not include `pa_montgomery`. The comparison above called `pa_montgomery.read_roll` on the three archived CSVs.
