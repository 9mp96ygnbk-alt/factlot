# co-denver-energize-benchmarking: Energize Denver building energy benchmarking

Review record for the source `co-denver-energize-benchmarking` (data policy §5). Reviewed 2026-11-04. Machine-readable
copy: [`registry/sources/co/co-denver-energize-benchmarking.json`](../../../registry/sources/co/co-denver-energize-benchmarking.json).
Adapter: `python/src/factlot/registry/adapters/energy_benchmark.py`; tests: `python/tests/test_adapter_energy_benchmark.py`.

An **enrichment** source: it creates no parcels. Denver's Energize Denver ordinance requires buildings of 25,000 square feet
and larger to submit annual energy benchmarking data; the Climate Action, Sustainability and Resiliency office (CASR) posts
the master dataset. The workbook has a building ID, the building's name and street address, and **no parcel number**, so
the join is by street address and is an inference.

## Publisher and URLs

- Publisher: City and County of Denver (CASR), through the Denver Open Data Catalog (ODC). ArcGIS Online item
  `169272beebc54212ac08f3f607bef272` "Energize Denver 2025 Master Dataset" (Microsoft Excel,
  `2025_Master_Data_Set_090326.xlsx`, modified 2026-09-22), listed on the Hub as
  <https://opendata-geospatialdenver.hub.arcgis.com/documents/geospatialDenver::energize-denver-2025-master-dataset>.
  Older years (2016-2024) are separate items and are not loaded.
- File used: one request to `https://www.arcgis.com/sharing/rest/content/items/169272beebc54212ac08f3f607bef272/data`,
  593,323 bytes, 2,700 building rows, archived by the collector on 2026-11-04 (UTC).

## Terms, license, robots

As [co-denver-assessor](co-denver-assessor.md): the City's GIS page says of the Open Data Catalog "You are free to copy,
distribute, transmit and adapt the data in this catalog under an open license, the Creative Commons Attribution 3.0
license (CC BY 3.0)." The item's use constraints disclaim liability ("NOT FOR ENGINEERING PURPOSES"). AI use: not
addressed, recorded `unknown`. Redistribution: `attribution_required`. Attribution: City and County of Denver. The Hub
sets `Crawl-delay: 60`, so the ArcGIS Online item behind it was fetched; `www.arcgis.com/robots.txt` has no rules. Requests
identified, no account. The person who confirms the Denver CC BY 3.0 reading (see that record's gates) confirms this one.
`verified: true`.

## What the adapter reads and writes

Columns read: `Building ID`, `Street`, `Primary Property Type EPA Calculated`, `Master Sq Ft`, `Reporting Year`, `Energy Star
Score`, `Site EUI (kBtu/sq ft)`, `Weather Normalized Site EUI (kBtu/sq ft)`, `Total GHG Emissions (Metric Tons Co2e)`. The
building's name, the zip code, the compliance status and the target columns are not read.

A row with a reporting year and a positive site EUI is matched to a parcel when its street, with `, DENVER CO`, normalised
like the registry's situs addresses (`normalize_address`), equals the address key of **exactly one** parcel; no match, or
several parcels at the address, leaves the row out. The facts are those of [ny-nyc-dob-ll84](ny-nyc-dob-ll84.md) except
`energy.ghg_intensity` (the workbook has no intensity column) and `energy.source_eui`; they are **`inferred`** with confidence
0.85, cite the workbook and row (`2025_Master_Data_Set_090326.xlsx row 3: Energize Denver building 1001, reporting year 2026,
matched on street address 6805 N ARGONNE ST`). `Reporting Year` is the workbook's (2026 for this file's submissions).

## Real run (2026-11-04)

Into a scratch Denver registry built from the archived Assessor exports (`…/scratchpad/data/r2/denver.db`, 13,539 parcels):

```
python -m factlot.registry.adapters.energy_benchmark denver 2025_Master_Data_Set_090326.xlsx denver.db --as-of 2026-09-22
```

| Measure                                                       | Count         |
| ------------------------------------------------------------- | ------------- |
| Building rows / with a reporting year and a positive site EUI | 2,700 / 2,378 |
| Matched to exactly one registry parcel                        | 873           |
| Address matches no registry parcel                            | 1,434         |
| Address matches several parcels                               | 71            |
| Parcels left out (two buildings on one parcel)                | 16            |
| Registry parcels given facts                                  | 820 (6.1%)    |
| Facts written                                                 | 5,536         |

## Known gaps

- Most unmatched rows are buildings the registry does not hold (condominium and residential classes it excludes) or addresses
  the Assessor writes differently; no fuzzy matching is done.
- The workbook's compliance status and the 2030 target EUIs are not read.
