# Registry coverage matrix

Compiled 2026-11-06 from the review records, source configs and the Census county file already in this repository.
No publisher file was read to produce this page. It is not a live inventory and it is not nationally complete.

## Scope

The product state table is the 50 states, the District of Columbia and Puerto Rico (STATE_BY_FIPS in the registry). Census county equivalents outside that table are listed and are not treated as reviewed.

Commercial, industrial and multifamily only (state categories B, F1, F2 and subclasses). Single-family and other residential classes are out of scope.

Organisation owners of record only. Natural-person names are not stored. Registered legal entities used to resolve organisation owners, where a state file has been loaded.

Market, appraised and sale figures are stored only when the source states them, with a citation. They are not an appraisal opinion.

One downloadable District of Columbia sample. Hosted registry lookups are not open.

## What can be queried

Published sample: District of Columbia, release tag `registry-sample-dc-2026-11-04`, 18,077 commercial parcels. Hosted registry lookups are not open. This sample is not the pipeline sum below.

## Pipeline row sum

Verified-source rows: 1,953,805. Unverified-source rows: 77,286. Sample rows, excluded from both: 94,319. Cited registered entities: 14,224,252.

Sum of cited commercial-parcel rows in scratch loads. Not deduplicated, not live, not a national total. Sum of cited entity-registry loads. Not a live count.

Census county equivalents in the 2020 file: 3,235 (retrieved 2026-11-03). That is not a parcel count.

A state with no cited load shows `not recorded` rather than zero. `counties without a row` is filled only when every cited area is one county. A statewide phrase does not invent a county remainder.

## States

| State                | Census counties | Status                            | Cited pipeline parcels | Sample parcels | Counties without a row | As-of recorded           | Published sample |
| -------------------- | --------------- | --------------------------------- | ---------------------- | -------------- | ---------------------- | ------------------------ | ---------------- |
| Alabama              | 67              | not_reviewed                      | not recorded           | not recorded   | not recorded           | not recorded             | no               |
| Alaska               | 30              | not_reviewed                      | not recorded           | not recorded   | not recorded           | not recorded             | no               |
| Arizona              | 15              | sample_only                       | not recorded           | 3,863          | not recorded           | not recorded             | no               |
| Arkansas             | 75              | pipeline_load                     | 69,056                 | not recorded   | not recorded           | 2026-11-03               | no               |
| California           | 58              | pipeline_load                     | 242,280                | not recorded   | 55                     | 2026-06-26 to 2026-11-01 | no               |
| Colorado             | 64              | pipeline_load                     | 13,539                 | not recorded   | 63                     | 2026-10-29               | no               |
| Connecticut          | 8               | pipeline_load                     | 43,390                 | not recorded   | not recorded           | 2026-11-03               | no               |
| Delaware             | 3               | not_reviewed                      | not recorded           | not recorded   | not recorded           | not recorded             | no               |
| District of Columbia | 1               | pipeline_load                     | 18,077                 | not recorded   | 0                      | 2026-11-02               | yes, DC sample   |
| Florida              | 67              | sample_only                       | not recorded           | 148            | not recorded           | not recorded             | no               |
| Georgia              | 159             | pipeline_load                     | 11,351                 | not recorded   | 158                    | 2026-11-01               | no               |
| Hawaii               | 5               | reviewed_not_loaded               | not recorded           | not recorded   | not recorded           | not recorded             | no               |
| Idaho                | 44              | not_reviewed                      | not recorded           | not recorded   | not recorded           | not recorded             | no               |
| Illinois             | 102             | sample_only                       | not recorded           | 90,073         | not recorded           | not recorded             | no               |
| Indiana              | 92              | pipeline_load                     | 20,630                 | not recorded   | 91                     | 2026-11-03               | no               |
| Iowa                 | 99              | not_reviewed                      | not recorded           | not recorded   | not recorded           | not recorded             | no               |
| Kansas               | 105             | not_reviewed                      | not recorded           | not recorded   | not recorded           | not recorded             | no               |
| Kentucky             | 120             | reviewed_not_loaded               | not recorded           | not recorded   | not recorded           | not recorded             | no               |
| Louisiana            | 64              | not_reviewed                      | not recorded           | not recorded   | not recorded           | not recorded             | no               |
| Maine                | 16              | not_reviewed                      | not recorded           | not recorded   | not recorded           | not recorded             | no               |
| Maryland             | 24              | pipeline_load                     | 109,245                | not recorded   | 0                      | 2026-10-05               | no               |
| Massachusetts        | 14              | pipeline_load                     | 141,218                | not recorded   | 0                      | 2025-01-01               | no               |
| Michigan             | 83              | pipeline_load                     | 26,124                 | 235            | 81                     | 2026-11-03               | no               |
| Minnesota            | 87              | pipeline_load                     | 80,335                 | not recorded   | not recorded           | 2026-10-22 to 2026-11-03 | no               |
| Mississippi          | 82              | not_reviewed                      | not recorded           | not recorded   | not recorded           | not recorded             | no               |
| Missouri             | 115             | reviewed_not_loaded               | not recorded           | not recorded   | not recorded           | not recorded             | no               |
| Montana              | 56              | pipeline_load                     | 7,546                  | not recorded   | not recorded           | 2026-10-06               | no               |
| Nebraska             | 93              | not_reviewed                      | not recorded           | not recorded   | not recorded           | not recorded             | no               |
| Nevada               | 17              | reviewed_not_loaded               | not recorded           | not recorded   | not recorded           | not recorded             | no               |
| New Hampshire        | 10              | not_reviewed                      | not recorded           | not recorded   | not recorded           | not recorded             | no               |
| New Jersey           | 21              | reviewed_not_loaded               | not recorded           | not recorded   | not recorded           | not recorded             | no               |
| New Mexico           | 33              | not_reviewed                      | not recorded           | not recorded   | not recorded           | not recorded             | no               |
| New York             | 62              | pipeline_load                     | 440,628                | not recorded   | not recorded           | 2026-04-24 to 2026-05-15 | no               |
| North Carolina       | 100             | pipeline_load                     | 61,756                 | not recorded   | not recorded           | 2026-05-17 to 2026-11-02 | no               |
| North Dakota         | 53              | not_reviewed                      | not recorded           | not recorded   | not recorded           | not recorded             | no               |
| Ohio                 | 88              | reviewed_not_loaded               | not recorded           | not recorded   | not recorded           | not recorded             | no               |
| Oklahoma             | 77              | reviewed_not_loaded               | not recorded           | not recorded   | not recorded           | not recorded             | no               |
| Oregon               | 36              | pipeline_load                     | 34,128                 | not recorded   | 33                     | 2026-07-17               | no               |
| Pennsylvania         | 67              | pipeline_load_includes_unverified | 128,172                | not recorded   | 64                     | 2026-10-05 to 2026-11-02 | no               |
| Puerto Rico          | 78              | not_reviewed                      | not recorded           | not recorded   | not recorded           | not recorded             | no               |
| Rhode Island         | 5               | not_reviewed                      | not recorded           | not recorded   | not recorded           | not recorded             | no               |
| South Carolina       | 46              | not_reviewed                      | not recorded           | not recorded   | not recorded           | not recorded             | no               |
| South Dakota         | 66              | not_reviewed                      | not recorded           | not recorded   | not recorded           | not recorded             | no               |
| Tennessee            | 95              | pipeline_load                     | 13,111                 | not recorded   | 94                     | 2026-11-02               | no               |
| Texas                | 254             | pipeline_load                     | 276,629                | not recorded   | 246                    | 2026-07-07 to 2026-11-03 | no               |
| Utah                 | 29              | pipeline_load                     | 76,250                 | not recorded   | 3                      | 2020-07-17 to 2026-10-13 | no               |
| Vermont              | 14              | pipeline_load                     | 19,342                 | not recorded   | not recorded           | 2026-11-03               | no               |
| Virginia             | 133             | reviewed_not_loaded               | not recorded           | not recorded   | not recorded           | not recorded             | no               |
| Washington           | 39              | pipeline_load                     | 12,530                 | not recorded   | 38                     | 2026-10-30               | no               |
| West Virginia        | 55              | not_reviewed                      | not recorded           | not recorded   | not recorded           | not recorded             | no               |
| Wisconsin            | 72              | pipeline_load                     | 185,754                | not recorded   | 0                      | 2026-06-30               | no               |
| Wyoming              | 23              | not_reviewed                      | not recorded           | not recorded   | not recorded           | not recorded             | no               |

## Gates

A source is `loaded_verified` only when a person set `verified` and a cited load exists. Purchase, click-through, automated-access and records-request gates stay blocked. Public access is not a redistribution grant. Nothing below was fetched for this page.

| State                | Source                            | Role     | Gate                     | Ingestion         | Cited source rows |
| -------------------- | --------------------------------- | -------- | ------------------------ | ----------------- | ----------------- |
| Arizona              | `az-maricopa-assessor`            | parcels  | blocked_terms_or_other   | sample_not_a_load | not recorded      |
| Arizona              | `az-pima-assessor`                | parcels  | blocked_automated_access | not_loaded        | not recorded      |
| Arizona              | `az-sos-entities`                 | entities | blocked_purchase         | not_loaded        | not recorded      |
| Arkansas             | `ar-gis-parcels`                  | parcels  | verified                 | loaded_verified   | not recorded      |
| California           | `ca-alameda-assessor`             | parcels  | blocked_terms_or_other   | not_loaded        | not recorded      |
| California           | `ca-contra-costa-assessor`        | parcels  | blocked_automated_access | not_loaded        | not recorded      |
| California           | `ca-fresno-assessor`              | parcels  | blocked_purchase         | not_loaded        | not recorded      |
| California           | `ca-kern-assessor`                | parcels  | blocked_purchase         | not_loaded        | not recorded      |
| California           | `ca-los-angeles-assessor`         | parcels  | verified                 | loaded_verified   | not recorded      |
| California           | `ca-orange-assessor`              | parcels  | blocked_purchase         | not_loaded        | not recorded      |
| California           | `ca-riverside-assessor`           | parcels  | blocked_terms_or_other   | not_loaded        | not recorded      |
| California           | `ca-sacramento-assessor`          | parcels  | verified                 | loaded_verified   | not recorded      |
| California           | `ca-san-bernardino-assessor`      | parcels  | blocked_terms_or_other   | not_loaded        | not recorded      |
| California           | `ca-san-diego-assessor`           | parcels  | blocked_purchase         | not_loaded        | not recorded      |
| California           | `ca-san-francisco-assessor`       | parcels  | verified                 | loaded_verified   | not recorded      |
| California           | `ca-san-joaquin-assessor`         | parcels  | blocked_terms_or_other   | not_loaded        | not recorded      |
| California           | `ca-san-mateo-assessor`           | parcels  | blocked_purchase         | not_loaded        | not recorded      |
| California           | `ca-santa-clara-assessor`         | parcels  | blocked_purchase         | not_loaded        | not recorded      |
| California           | `ca-sos-entities`                 | entities | blocked_purchase         | not_loaded        | not recorded      |
| California           | `ca-ventura-assessor`             | parcels  | blocked_automated_access | not_loaded        | not recorded      |
| Colorado             | `co-denver-assessor`              | parcels  | verified                 | loaded_verified   | not recorded      |
| Colorado             | `co-denver-energize-benchmarking` | parcels  | verified                 | not_loaded        | not recorded      |
| Colorado             | `co-elpaso-assessor`              | parcels  | blocked_click_through    | not_loaded        | not recorded      |
| Colorado             | `co-sos-entities`                 | entities | verified                 | not_loaded        | not recorded      |
| Connecticut          | `ct-parcel-cama`                  | parcels  | blocked_terms_or_other   | not_loaded        | not recorded      |
| Connecticut          | `ct-parcel-cama-layer`            | parcels  | verified                 | loaded_verified   | not recorded      |
| Connecticut          | `ct-sos-entities`                 | entities | verified                 | not_loaded        | not recorded      |
| District of Columbia | `dc-dlcp-entities`                | entities | verified                 | not_loaded        | not recorded      |
| District of Columbia | `dc-otr-real-property`            | parcels  | verified                 | loaded_verified   | not recorded      |
| Florida              | `fl-dor-nal`                      | parcels  | blocked_terms_or_other   | sample_not_a_load | not recorded      |
| Florida              | `fl-dos-entities`                 | entities | blocked_terms_or_other   | not_loaded        | not recorded      |
| Georgia              | `ga-cobb-assessor`                | parcels  | blocked_purchase         | not_loaded        | not recorded      |
| Georgia              | `ga-dekalb-parcels`               | parcels  | verified                 | loaded_verified   | not recorded      |
| Georgia              | `ga-fulton-assessor`              | parcels  | blocked_terms_or_other   | not_loaded        | not recorded      |
| Georgia              | `ga-gwinnett-assessor`            | parcels  | blocked_terms_or_other   | not_loaded        | not recorded      |
| Georgia              | `ga-sos-entities`                 | entities | blocked_purchase         | not_loaded        | not recorded      |
| Hawaii               | `hi-breg-entities`                | entities | blocked_purchase         | not_loaded        | not recorded      |
| Hawaii               | `hi-honolulu-assessor`            | parcels  | blocked_terms_or_other   | not_loaded        | not recorded      |
| Illinois             | `il-cook-assessor`                | parcels  | blocked_terms_or_other   | sample_not_a_load | not recorded      |
| Illinois             | `il-dupage-parcels`               | parcels  | blocked_terms_or_other   | not_loaded        | not recorded      |
| Illinois             | `il-lake-parcels`                 | parcels  | blocked_automated_access | not_loaded        | not recorded      |
| Illinois             | `il-sos-entities`                 | entities | blocked_automated_access | not_loaded        | not recorded      |
| Illinois             | `il-will-parcels`                 | parcels  | blocked_terms_or_other   | not_loaded        | not recorded      |
| Indiana              | `in-marion-parcels`               | parcels  | verified                 | loaded_verified   | not recorded      |
| Indiana              | `in-sos-entities`                 | entities | blocked_purchase         | not_loaded        | not recorded      |
| Kentucky             | `ky-jefferson-pva`                | parcels  | blocked_purchase         | not_loaded        | not recorded      |
| Kentucky             | `ky-sos-entities`                 | entities | blocked_terms_or_other   | not_loaded        | not recorded      |
| Maryland             | `md-sdat-entities`                | entities | blocked_purchase         | not_loaded        | not recorded      |
| Maryland             | `md-sdat-real-property`           | parcels  | verified                 | loaded_verified   | not recorded      |
| Massachusetts        | `ma-boston-assessing`             | parcels  | verified                 | loaded_verified   | not recorded      |
| Massachusetts        | `ma-massgis-parcels`              | parcels  | verified                 | loaded_verified   | not recorded      |
| Massachusetts        | `ma-sos-entities`                 | entities | blocked_purchase         | not_loaded        | not recorded      |
| Michigan             | `mi-macomb-parcels`               | parcels  | blocked_records_request  | not_loaded        | not recorded      |
| Michigan             | `mi-oakland-parcels`              | parcels  | verified                 | loaded_verified   | 26,128            |
| Michigan             | `mi-sos-entities`                 | entities | blocked_no_bulk_source   | not_loaded        | not recorded      |
| Michigan             | `mi-wayne-parcels`                | parcels  | blocked_terms_or_other   | sample_not_a_load | not recorded      |
| Minnesota            | `mn-hennepin-assessor`            | parcels  | verified                 | loaded_verified   | not recorded      |
| Minnesota            | `mn-opt-in-parcels`               | parcels  | verified                 | loaded_verified   | not recorded      |
| Minnesota            | `mn-sos-entities`                 | entities | blocked_purchase         | not_loaded        | not recorded      |
| Missouri             | `mo-jackson-assessment`           | parcels  | blocked_records_request  | not_loaded        | not recorded      |
| Missouri             | `mo-sos-entities`                 | entities | blocked_no_bulk_source   | not_loaded        | not recorded      |
| Missouri             | `mo-stlouis-county-parcels`       | parcels  | blocked_automated_access | not_loaded        | not recorded      |
| Montana              | `mt-msl-cadastral`                | parcels  | verified                 | loaded_verified   | not recorded      |
| Nevada               | `nv-clark-assessor`               | parcels  | blocked_purchase         | not_loaded        | not recorded      |
| Nevada               | `nv-sos-entities`                 | entities | blocked_purchase         | not_loaded        | not recorded      |
| New Jersey           | `nj-dores-entities`               | entities | blocked_purchase         | not_loaded        | not recorded      |
| New Jersey           | `nj-modiv-parcels`                | parcels  | blocked_terms_or_other   | not_loaded        | not recorded      |
| New York             | `ny-dos-entities`                 | entities | verified                 | not_loaded        | not recorded      |
| New York             | `ny-nyc-dof`                      | parcels  | verified                 | loaded_verified   | not recorded      |
| New York             | `ny-orpts-rolls`                  | parcels  | verified                 | loaded_verified   | not recorded      |
| North Carolina       | `nc-mecklenburg-assessor`         | parcels  | verified                 | loaded_verified   | not recorded      |
| North Carolina       | `nc-onemap-buncombe`              | parcels  | verified                 | not_loaded        | not recorded      |
| North Carolina       | `nc-onemap-cumberland`            | parcels  | verified                 | included_in_group | not recorded      |
| North Carolina       | `nc-onemap-forsyth`               | parcels  | verified                 | included_in_group | not recorded      |
| North Carolina       | `nc-onemap-gaston`                | parcels  | verified                 | not_loaded        | not recorded      |
| North Carolina       | `nc-onemap-guilford`              | parcels  | verified                 | loaded_verified   | not recorded      |
| North Carolina       | `nc-onemap-iredell`               | parcels  | verified                 | not_loaded        | not recorded      |
| North Carolina       | `nc-onemap-johnston`              | parcels  | verified                 | included_in_group | not recorded      |
| North Carolina       | `nc-onemap-newhanover`            | parcels  | verified                 | included_in_group | not recorded      |
| North Carolina       | `nc-sos-entities`                 | entities | blocked_purchase         | not_loaded        | not recorded      |
| North Carolina       | `nc-wake-parcels`                 | parcels  | verified                 | loaded_verified   | not recorded      |
| Ohio                 | `oh-cuyahoga-parcels`             | parcels  | blocked_terms_or_other   | not_loaded        | not recorded      |
| Ohio                 | `oh-franklin-auditor`             | parcels  | blocked_click_through    | not_loaded        | not recorded      |
| Ohio                 | `oh-hamilton-auditor`             | parcels  | blocked_automated_access | not_loaded        | not recorded      |
| Ohio                 | `oh-sos-entities`                 | entities | blocked_automated_access | not_loaded        | not recorded      |
| Oklahoma             | `ok-oklahoma-assessor`            | parcels  | blocked_records_request  | not_loaded        | not recorded      |
| Oklahoma             | `ok-sos-entities`                 | entities | blocked_purchase         | not_loaded        | not recorded      |
| Oklahoma             | `ok-tulsa-assessor`               | parcels  | blocked_records_request  | not_loaded        | not recorded      |
| Oregon               | `or-metro-rlis-taxlots`           | parcels  | verified                 | loaded_verified   | not recorded      |
| Oregon               | `or-sos-entities`                 | entities | blocked_terms_or_other   | not_loaded        | not recorded      |
| Pennsylvania         | `pa-allegheny-assessments`        | parcels  | verified                 | loaded_verified   | not recorded      |
| Pennsylvania         | `pa-montgomery-parcels`           | parcels  | verified                 | loaded_verified   | not recorded      |
| Pennsylvania         | `pa-philadelphia-opa`             | parcels  | blocked_terms_or_other   | loaded_unverified | not recorded      |
| Pennsylvania         | `pa-sos-entities`                 | entities | verified                 | not_loaded        | not recorded      |
| Tennessee            | `tn-comptroller-assessment`       | parcels  | blocked_click_through    | not_loaded        | not recorded      |
| Tennessee            | `tn-davidson-assessor`            | parcels  | verified                 | loaded_verified   | not recorded      |
| Tennessee            | `tn-shelby-assessor`              | parcels  | blocked_automated_access | not_loaded        | not recorded      |
| Tennessee            | `tn-sos-entities`                 | entities | blocked_purchase         | not_loaded        | not recorded      |
| Texas                | `tx-bexar-ad`                     | parcels  | blocked_records_request  | not_loaded        | not recorded      |
| Texas                | `tx-collin-cad`                   | parcels  | verified                 | loaded_verified   | not recorded      |
| Texas                | `tx-comptroller-franchise`        | entities | verified                 | not_loaded        | not recorded      |
| Texas                | `tx-dallas-cad`                   | parcels  | verified                 | loaded_verified   | not recorded      |
| Texas                | `tx-denton-cad`                   | parcels  | verified                 | loaded_verified   | not recorded      |
| Texas                | `tx-elpaso-cad`                   | parcels  | blocked_terms_or_other   | not_loaded        | not recorded      |
| Texas                | `tx-fortbend-cad`                 | parcels  | verified                 | loaded_verified   | not recorded      |
| Texas                | `tx-harris-cad`                   | parcels  | verified                 | loaded_verified   | 1,628,382         |
| Texas                | `tx-hidalgo-cad`                  | parcels  | blocked_automated_access | not_loaded        | not recorded      |
| Texas                | `tx-montgomery-cad`               | parcels  | blocked_terms_or_other   | not_loaded        | not recorded      |
| Texas                | `tx-tarrant-ad`                   | parcels  | verified                 | loaded_verified   | not recorded      |
| Texas                | `tx-travis-cad`                   | parcels  | verified                 | loaded_verified   | not recorded      |
| Texas                | `tx-txgio-parcels`                | parcels  | blocked_automated_access | not_loaded        | not recorded      |
| Texas                | `tx-williamson-cad`               | parcels  | verified                 | loaded_verified   | not recorded      |
| Utah                 | `ut-sos-entities`                 | entities | blocked_records_request  | not_loaded        | not recorded      |
| Utah                 | `ut-ugrc-lir`                     | parcels  | verified                 | loaded_verified   | not recorded      |
| Vermont              | `vt-vcgi-parcels`                 | parcels  | verified                 | loaded_verified   | not recorded      |
| Virginia             | `va-fairfax-assessor`             | parcels  | blocked_terms_or_other   | not_loaded        | not recorded      |
| Virginia             | `va-scc-entities`                 | entities | blocked_click_through    | not_loaded        | not recorded      |
| Washington           | `wa-king-assessor`                | parcels  | blocked_click_through    | not_loaded        | not recorded      |
| Washington           | `wa-pierce-assessor`              | parcels  | verified                 | loaded_verified   | not recorded      |
| Washington           | `wa-snohomish-assessor`           | parcels  | blocked_terms_or_other   | not_loaded        | not recorded      |
| Washington           | `wa-sos-entities`                 | entities | blocked_no_bulk_source   | not_loaded        | not recorded      |
| Washington           | `wa-state-parcels`                | parcels  | blocked_terms_or_other   | not_loaded        | not recorded      |
| Wisconsin            | `wi-dfi-entities`                 | entities | blocked_purchase         | not_loaded        | not recorded      |
| Wisconsin            | `wi-statewide-parcels`            | parcels  | verified                 | loaded_verified   | not recorded      |

## Outside the product state table

These Census prefixes are in the county file and are not in the registry state table. No parcel count is implied.

- FIPS 60: 5 county equivalents, outside_product_state_table.
- FIPS 66: 1 county equivalents, outside_product_state_table.
- FIPS 69: 4 county equivalents, outside_product_state_table.
- FIPS 74: 1 county equivalents, outside_product_state_table.
- FIPS 78: 3 county equivalents, outside_product_state_table.

## Proposals not adopted

- `flr1` (rejected): FactLot parcel IDs (fl:parcel:) are permanent. The same input must keep the same ID.
- `D1-D5-fail-closed` (rejected): Those decisions are not product policy. Scope, owner handling, coordinates and cited assessment figures already exist in the registry. Unset draft thresholds are not new gates.
- `omit-monetary-facts` (rejected): Those are cited source figures, not an appraisal opinion. The fact model and the Texas unequal-appraisal tools already publish them with citations.
- `parcel-only-v1` (rejected): Entities, buildings and ownership links are current registry subjects.
- `quarantine-missing-coordinates` (rejected): Most appraisal rolls do not publish coordinates. Missing coordinates stay unknown; a present but impossible coordinate is counted, and the row is still stored.
- `ban-cited-pipeline-total` (rejected): The sum of quote-checked rows is evidence of what scratch loads recorded. It is not a live count, not a national total, and not a pass threshold.
