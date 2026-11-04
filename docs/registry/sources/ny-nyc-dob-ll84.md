# ny-nyc-dob-ll84: NYC Local Law 84 energy and water benchmarking

Review record for the source `ny-nyc-dob-ll84` (data policy §5). Reviewed 2026-11-04. Machine-readable copy:
[`registry/sources/ny/ny-nyc-dob-ll84.json`](../../../registry/sources/ny/ny-nyc-dob-ll84.json). Adapter:
`python/src/factlot/registry/adapters/energy_benchmark.py` (shared with DC and Denver); tests:
`python/tests/test_adapter_energy_benchmark.py`.

An **enrichment** source: it creates no parcels. Local Law 84 of 2009 requires the owners of buildings of more than
25,000 square feet (50,000 at first) to report annual energy and water use to the EPA's Portfolio Manager; the
Department of Buildings (DOB) publishes the reports. Each report becomes energy facts on the tax lots it names.

## Publisher and URLs

- Dataset: NYC Open Data `5zyy-y8am` "NYC Building Energy and Water Data Disclosure for Local Law 84 2023 to Present (Data
  for Calendar Year 2022-Present)", attribution Department of Buildings (DOB),
  <https://data.cityofnewyork.us/resource/5zyy-y8am>; 103,259 rows (report years 2022: 30,485; 2023: 33,684; 2024:
  39,090); data last updated 2025-11-25 (`rowsUpdatedAt`). Each property has an EPA Portfolio Manager ID and "can contain
  one or more tax lots identified by one or more BBLs" (the description).
- File used: one SODA request with a `$select` of 13 columns (`report_year`, `property_id`, `nyc_borough_block_and_lot`,
  `primary_property_type`, `year_ending`, `site_eui_kbtu_ft`, `weather_normalized_site_eui`, `source_eui_kbtu_ft`,
  `energy_star_score`, `total_location_based_ghg`, `total_location_based_ghg_1`, `property_gfa_calculated`,
  `number_of_buildings`), 14,406,331 bytes, archived by the collector on 2026-11-04 (UTC). The property name, address,
  coordinates and the roughly 200 per-use columns are not requested. Earlier years (2010-2021) are in other datasets and
  are not loaded.

## Terms, license, robots

As [ny-nyc-dcp-pluto](ny-nyc-dcp-pluto.md): the NYC Open Data FAQ says "There are no restrictions on the use of Open Data."
AI use: not addressed, recorded `unknown`. Redistribution: permitted. Attribution: New York City Department of Buildings,
Local Law 84 benchmarking. The figures are self-reported by owners (the facts' license text says the City does not
verify them). The Tyler/Socrata question is the one in [`../requests/platform-terms/socrata.md`](../requests/platform-terms/socrata.md).
robots.txt `Crawl-delay: 1`, `/browse` search pages only disallowed. `verified: true`.

## What the adapter writes

For each tax lot named in the file, the **latest report year that has a usable report** (a positive site EUI), all
`public_record`, cited to the file and the line (`5zyy-y8am.csv line 3: Portfolio Manager property 7365, report year 2024`):

`energy.reporting_year`, `energy.property_type` (EPA primary property type), `energy.site_eui` (kBtu/ft2),
`energy.weather_normalized_site_eui`, `energy.source_eui`, `energy.energy_star_score`, `energy.ghg_emissions` (tCO2e),
`energy.ghg_intensity` (kgCO2e/ft2), `energy.floor_area_sf` (Portfolio Manager's calculated gross floor area), and
`energy.property_lot_count` when one report names several lots. "Not Available" and zeros are not stored.

- **Multi-lot properties.** 30,463 rows list more than one BBL. The figures are for the whole property, so they are written on
  each of its lots with `energy.property_lot_count`; do not read them as a lot's own.
- **Two properties on one lot** (a condominium with several reporting properties, a campus) in the latest year: the parcel
  gets nothing, because a single-valued predicate cannot hold both and the file does not say which is the lot's.
- Only the latest year is stored. Single-valued predicates return the newest fact, and one snapshot has one `as_of`, so
  several years of one property could not be told apart on read; the year is in `energy.reporting_year`.

## Real run (2026-11-04)

Into the scratch NYC registry (`…/scratchpad/data/r2/nyc.db`):

```
python -m factlot.registry.adapters.energy_benchmark nyc 5zyy-y8am.csv nyc.db --as-of 2025-11-25
```

| Measure                                                             | Count            |
| ------------------------------------------------------------------- | ---------------- |
| Reports read / with a positive site EUI                             | 103,259 / 63,103 |
| Tax lots with a report                                              | 23,565           |
| …left out because the latest year has several properties on the lot | 3,892            |
| …in a multi-lot property                                            | 719              |
| Registry parcels given facts                                        | 17,503 (10.6%)   |
| Not registry parcels (residential, exempt, other classes)           | 6,062            |
| Facts written                                                       | 154,427          |

Latest year used: 2024 for 22,230 lots, 2023 for 1,101, 2022 for 234. Spot check: the Empire State Building lot (BBL 1008350041) reads Office, 2,852,257 sf, site EUI 61.4, weather-normalized 63.4, source EUI 132.5, ENERGY STAR score 78, 16,678.22
tCO2e (5.85 kgCO2e/ft2), report year 2024.

## Known gaps

- Buildings under 25,000 sf and buildings that did not report have no facts; "usable" means a positive site EUI, not that
  DOB verified the report.
- The 3,892 lots with several properties would need a rule for choosing the lot's own property (by gross floor area, say).
