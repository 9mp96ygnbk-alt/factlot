# dc-doee-energy-benchmarking: DC building energy benchmarking

Review record for the source `dc-doee-energy-benchmarking` (data policy §5). Reviewed 2026-11-04. Machine-readable copy:
[`registry/sources/dc/dc-doee-energy-benchmarking.json`](../../../registry/sources/dc/dc-doee-energy-benchmarking.json).
Adapter: `python/src/factlot/registry/adapters/energy_benchmark.py`; tests: `python/tests/test_adapter_energy_benchmark.py`.

An **enrichment** source: it creates no parcels. The Clean and Affordable Energy Act of 2008 requires private buildings of
more than 50,000 gross square feet to report annual energy and water use to the Department of Energy and Environment
(DOEE) through the EPA's Portfolio Manager; DOEE publishes the results by SSL (square, suffix, lot), the key the DC tax
roll ([dc-otr-real-property](dc-otr-real-property.md)) uses.

## Publisher and URLs

- Publisher: DOEE, through DC GIS and Open Data DC. Layer 45 "Building Energy Benchmarks" of the feature service
  `https://maps2.dcgis.dc.gov/DCGIS/rest/services/DCGIS_DATA/Environment_Energy_WebMercator/FeatureServer` (35,346 records,
  reporting years 2012-2025); Hub item "Building Energy Benchmarking"
  (<https://opendata.dc.gov/datasets/DCGIS::building-energy-benchmarking>), last modified 2026-11-02.
- Files used: 7 ArcGIS `query` pages (`where=REPORTINGYEAR>=2023`, 14 `outFields`, `resultRecordCount=2000`), 12,004 records
  (reporting years 2023: 3,304; 2024: 3,201; 2025: 5,499), about 5.7 MB, archived by the collector on 2026-11-04 (UTC).
  The owner of record, property name, address, coordinates, verifier and monthly use columns are not requested.

## Terms, license, robots

As [dc-dcgis-zoning](dc-dcgis-zoning.md): CC-BY-4.0 on the item; District data is public domain under a CC0 1.0
dedication. AI use `permitted`, redistribution `attribution_required`, attribution "District of Columbia Department of
Energy and Environment (DOEE), Open Data DC". `maps2.dcgis.dc.gov` has no robots.txt. Requests 2 seconds apart,
identified, no account. `verified: true`.

## What the adapter writes

The same predicates as [ny-nyc-dob-ll84](ny-nyc-dob-ll84.md), from the latest `REPORTINGYEAR` of each SSL that has a report
with `REPORTSTATUS` = `In Compliance` and a positive site EUI. `energy.reporting_year` is the layer's `REPORTINGYEAR`
as published (the layer does not say whether it is the filing year or the data year). The `SSL` column can list several SSLs
separated by `;`: the report is written on each, with `energy.property_lot_count`. A square-suffix-lot with two reporting
properties in the latest year gets nothing. Cited to the page file and the record (`dc-energy-page-1.json record 4:
Portfolio Manager property 5002, reporting year 2024`); the pages are registered as snapshots of the source.

## Real run (2026-11-04)

```
python -m factlot.registry.adapters.energy_benchmark dc page1.json … page7.json dc.db --as-of 2026-11-02
```

| Measure                                                 | Count                   |
| ------------------------------------------------------- | ----------------------- |
| Records read / `In Compliance` with a positive site EUI | 12,004 / 7,833          |
| SSLs with a report                                      | 3,694                   |
| …left out (several properties in the latest year)       | 91                      |
| …in a multi-SSL report                                  | 456                     |
| Registry parcels given facts                            | 2,927 (16.2% of 18,077) |
| Not registry parcels                                    | 767                     |
| Facts written                                           | 26,040                  |

Latest year used: 2025 for 3,189 SSLs, 2024 for 343, 2023 for 162. `energy.energy_star_score` on 2,213 parcels,
`energy.property_lot_count` on 413.

## Known gaps

- Reports with another status (`Incomplete Report`, `Data Under Review by DOEE`, `Exempt`, `No Report Received`) are not
  used; 1,499 + 654 records of reporting year 2025 are of those kinds.
- The Building Energy Performance Standard layer (layer 75, BEPS compliance) is a separate dataset and is not loaded.
