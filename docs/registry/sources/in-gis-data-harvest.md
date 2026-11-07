# Indiana GIS Data Harvest, 2025 parcel service and the 2026 cycle

Reviewed 2026-11-06. This record checks whether a newer harvest makes the statewide layer fresh
for the 13 Indiana counties that have their own county records. It does not. No file was downloaded. No adapter was added.

The evidence table is in
[`docs/registry/quality/audit-2026-11-06/in-counties.md`](../quality/audit-2026-11-06/in-counties.md).

## What was read

- `https://gisdata.in.gov/server/rest/services/Hosted?f=pjson` lists parcel services through
  `Parcel_Boundaries_of_Indiana_2025` and `Parcel_Boundaries_of_Indiana_Current`. It does not list
  a 2026 parcel service.
- 2025 service:
  `https://gisdata.in.gov/server/rest/services/Hosted/Parcel_Boundaries_of_Indiana_2025/FeatureServer`.
  The service description says IGIO released it on December 1, 2025.
- 2025 iteminfo:
  `https://gisdata.in.gov/server/rest/services/Hosted/Parcel_Boundaries_of_Indiana_2025/FeatureServer/info/iteminfo?f=json`.
- Current iteminfo, same host, still says the Current layer was released on November 13, 2024.
- `https://dataharvest.gio.in.gov/pages/data-access`.
- `https://countydataharvest.in.gov/statewide/` and
  `https://countydataharvest.in.gov/realproperty/`.

## Terms

The 2025 iteminfo `licenseInfo`, read 2026-11-06, HTML wrappers removed:

> CREDIT - It is requested, but not required, that the Indiana GIS Data Harvest Program be cited in any products generated from this data set. If citing, the following source citation language should be included: [Administrative Boundaries of Indiana 2025: Administrative Boundaries Maintained by Local Government Agencies in Indiana, (Indiana Geographic Information Office, File Geodatabase, Polygon Feature Classes), 20251201].

The following paragraph is a warranty and liability limit. It provides the product "AS IS" and
does not forbid redistribution. The citation names administrative boundaries. The layer that was
queried is named `Parcel Boundaries of Indiana 2025` and has parcel fields, including
`dlgf_prop_class_code` and `loaddate`. AI use is not addressed. `verified` is not set. This is
the same reading recorded for the Current service in [in-statewide-parcels.md](in-statewide-parcels.md), not a new prohibition.

The access page, read 2026-11-06, says the harvest data is collected annually and that the maps
cover 2020 through 2025. A block on that site says:

> The IGIO will be launching the 2026 Data Harvest program cycle on July 31, 2026.

## Freshness

Statistics on the 2025 service and on the Current service, for the 13 counties, returned the
same 3xx/4xx feature counts and the same `loaddate` on 2026-11-06. Every one of those dates is
before 2025-10-02. The counts and dates are in the quality note. The 2025 release does not move
these counties inside 400 days.

The public download indexes list statewide and real-property geodatabases for 2020 through 2023.
Requests for the 2024, 2025, and 2026 statewide directories returned HTTP 403 and were not read.

## Not loaded

A second copy of the statewide extract would fail the same freshness bar. It was not loaded.
