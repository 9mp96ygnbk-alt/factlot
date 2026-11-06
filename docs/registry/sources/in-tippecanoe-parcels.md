# in-tippecanoe-parcels: Tippecanoe County parcels (FIPS 18157), stopped

Reviewed 2026-11-06. No collector config. No download. No adapter.

**Status: stopped before a load.** The service states no licence.

## Publisher and URLs

- Service:
  `https://maps.tippecanoe.in.gov/server/rest/services/Parcels_FeatureService/FeatureServer`.
- Iteminfo:
  `https://maps.tippecanoe.in.gov/server/rest/services/Parcels_FeatureService/FeatureServer/info/iteminfo?f=json`.
- `https://maps.tippecanoe.in.gov/robots.txt` does not `Disallow` the service. Its comments
  describe content signals and say a missing signal neither grants nor restricts that use. The
  file does not set `search`, `ai-input`, or `ai-train`.
- `https://www.tippecanoe.in.gov/1048/Assessor-GIS` was fetched. The HTML extracted on
  2026-11-06 did not contain a licence paragraph.
- `https://maps.tippecanoe.in.gov/server/rest/services/Parcel_Fabric?f=pjson` returned HTTP 499
  `Token Required`. It was not retried.

## Terms

Iteminfo `licenseInfo`, read 2026-11-06, is empty. Service description and item description:

> Parcels_FeatureService with redaction names removed

That sentence says names were removed. It does not grant redistribution. An empty `licenseInfo`
is unclear, so no feature was queried.

## Schema, denominator, freshness

Layer 0 is named `Parcels`. The schema includes `mpropertyclass` and `mpropertyclasscode`.
`editingInfo` is absent. No code value was read. Whether those fields are DLGF Code List 1 is
unverified. The N1 map was not applied. No name was read.

The publisher's commercial count is unavailable. The IGIO `loaddate` for Tippecanoe is
2025-08-29 (434 days before 2026-11-06) and fails the 400-day bar.

## Bar

Not run. Parcels loaded: 0.
