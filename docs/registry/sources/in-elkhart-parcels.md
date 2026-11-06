# in-elkhart-parcels: Elkhart County parcels (FIPS 18039), stopped

Reviewed 2026-11-06. No collector config. No download. No adapter.

**Status: stopped before a load.** The county hosts that were tried returned HTTP 403. Those
responses were not bypassed.

## What was requested

- `https://gis.elkhartcounty.com/arcgis/rest/services?f=pjson` returned HTTP 403.
- `https://gis.elkhartcounty.com/arcgis/rest/services/EnterpriseViews/Parcel_Fabric_Views/MapServer/8`
  returned HTTP 403.
- `https://elkhartcounty.com/` returned HTTP 403.

No licence text was readable. A search result pointed at an IGIO Elkhart extract released
February 1, 2022 (`Parcels_ElkhartCounty_2021`). That is older than the N1 layer and is not a
2026 county publication. It was not downloaded.

## Denominator and freshness

Unavailable from the county. The IGIO `loaddate` for Elkhart is 2025-09-05 (427 days before
2026-11-06) and fails the 400-day bar. No class codes were read. The N1 DLGF map was not applied.

## Bar

Not run. Parcels loaded: 0.
