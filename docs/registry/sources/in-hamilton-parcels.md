# in-hamilton-parcels: Hamilton County parcels (FIPS 18057), stopped

Reviewed 2026-11-06. No collector config. No download. No adapter.

**Status: stopped before a load.** `robots.txt` disallows the ArcGIS endpoints. A search excerpt
of the service description says the parcels are for internal use only.

## Publisher and URLs

- Publisher: Hamilton County GIS.
- `https://gis1.hamiltoncounty.in.gov/robots.txt`, read 2026-11-06, begins:

```
# Block automated crawlers from ArcGIS Enterprise endpoints
User-agent: *
Disallow: /arcgis/
```

The same file also disallows `/portal/`, `/server/`, `/rest/`, and `/sharing/`. The parcel
service path is under `/arcgis/`. It was not collected.

A public search excerpt of
`https://gis1.hamiltoncounty.in.gov/arcgis/rest/services/HamCoParcelsPublic/FeatureServer`,
seen 2026-11-06, gives the service description as:

> Hamilton County parcel boundaries (internal use only)

That excerpt is not a fetch of the disallowed path. The field list was not read.

The OpenData folder URL returned HTTP 499 `Token Required` on a direct request. It was not
retried. No token was requested.

## Terms

The words "internal use only" are the only reuse sentence this review has for the parcel service.
They do not grant redistribution. Combined with the robots rule, the service was not read.

## Denominator and freshness

Unavailable from the county. The IGIO `loaddate` for Hamilton is 2025-08-08 (455 days before
2026-11-06) and fails the 400-day bar. The N1 DLGF map was not applied. No code values were read.

## Bar

Not run. Parcels loaded: 0.
