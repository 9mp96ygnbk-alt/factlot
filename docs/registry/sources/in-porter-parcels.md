# in-porter-parcels: Porter County parcels (FIPS 18127), stopped

Reviewed 2026-11-06. No collector config. No download. No adapter.

**Status: stopped before a load.** The parcel item states no licence.

## Publisher and URLs

- Publisher: Porter County. The ArcGIS item is in a Porter County government account.
- Item `5055e398a5344fa496def6bc6fef19d1`, title `PropertyParcel`, read from
  `https://www.arcgis.com/sharing/rest/content/items/5055e398a5344fa496def6bc6fef19d1?f=json`.
  `modified` 2026-11-05 20:47:26 UTC. Access public.
- Service URL on the item:
  `https://services6.arcgis.com/TQ2Al5QIvv4tMBL7/arcgis/rest/services/PropertyParcel/FeatureServer`.
  `https://services6.arcgis.com/robots.txt` returned HTTP 403, so that host was not queried.
- The county server `https://gispro.porterco.org/robots.txt` returns HTTP 404.
  `PoCoMap_GeneralLayers` describes parcels among other layers and says the data is updated on a
  twenty-four hour cycle. It does not state a reuse licence. It is not the PropertyParcel item.

## Terms

Item `licenseInfo`, read 2026-11-06, is empty. `accessInformation` is empty. Snippet:

> For the conveyance of cadastral data in the County of Porter in Indiana.

Description:

> Feature class containing ownership parcel polygons for the County of Porter in Indiana.

"Conveyance of cadastral data" is not a licence. An empty `licenseInfo` does not grant
redistribution and does not forbid it. That is unclear, so the features were not read. The
description says the polygons carry ownership. No name was stored.

## Denominator and freshness

The item `modified` time is 2026-11-05, which is 1 day before 2026-11-06. It was not used as an
as-of. The publisher's commercial count is unavailable. The class field was not read, because the
feature host's `robots.txt` returned HTTP 403. The N1 DLGF map was not applied. The IGIO
`loaddate` for Porter is 2025-08-22 (441 days) and fails the 400-day bar.

## Bar

Not run. Parcels loaded: 0.
