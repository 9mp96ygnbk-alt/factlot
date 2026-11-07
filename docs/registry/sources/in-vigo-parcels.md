# in-vigo-parcels: Vigo County parcels (FIPS 18167), stopped

Reviewed 2026-11-06. No collector config. No download. No adapter.

**Status: stopped before a load.** The county hub does not publish a parcel dataset, and no
parcel licence was found.

## What was read

- `https://hub-vigocountygis.opendata.arcgis.com/sitemap.xml`, read 2026-11-06. `robots.txt`
  sets `Crawl-delay: 60` and does not disallow the sitemap. The sitemap has 10 URLs. None is a
  parcel dataset. The pages are a district finder, section corners, vector control, road
  closures, and legal drains.
- ArcGIS items on the same hub account include address points, sections, and section corners.
  A search of that account for a parcel feature service did not return one.
- An older item titled `Vigo County Parcels` (id `c32e49ac371f4a508ab95f5a2598eedc`, modified
  2019-09-26) points at `https://gis.in.gov/arcgis/rest/services/DOT/CountyParcels/MapServer/0`.
  Its search `licenseInfo` was empty. The modified date is years outside the 400-day line.
  It was not downloaded.

## A related county term, not a parcel licence

The address-point item `140b17f068934a7d9418bbe89870a2ab` is not a parcel file. Its `licenseInfo`,
read from search on 2026-11-06, includes:

> This data may not be used for commercial purposes without prior written authorization from Vigo County.

That sentence was not applied to a parcel file that this review did not find. It is recorded so
the county's published GIS terms are not ignored. No authorization was requested.

## Denominator and freshness

Unavailable from a county parcel file. The IGIO `loaddate` for Vigo is 2025-09-09 (423 days
before 2026-11-06) and fails the 400-day bar. No class codes were read. The statewide DLGF class map was not
applied.

## Bar

Not run. Parcels loaded: 0.
