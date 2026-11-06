# in-delaware-parcels: Delaware County parcels (FIPS 18035), stopped

Reviewed 2026-11-06. No collector config. No download. No adapter.

**Status: stopped before a load.** The item's licence is clickwrap. It was not accepted.

## Publisher and URLs

- County GIS page, read 2026-11-06:
  `https://delawarecounty.in.gov/departments/office-of-information-gis-services/`.
  It says downloadable datasets are on `https://maps-delcogis.opendata.arcgis.com`.
  That host's `robots.txt` sets `Crawl-delay: 60` and does not disallow `/datasets/`.
  The sitemap lists `https://maps-delcogis.opendata.arcgis.com/datasets/parcelwebpublish`.
- The dataset item was read from `www.arcgis.com`, not by a second request to the hub.
  Item `d05f185c75d142fd961203304bc36de0`, title `ParcelWebpublish`, `modified` 2026-10-26
  12:57:06 UTC.
  URL: `https://www.arcgis.com/sharing/rest/content/items/d05f185c75d142fd961203304bc36de0?f=json`.

## Terms

`licenseInfo`, HTML wrappers removed, wording unchanged, read 2026-11-06. The opening and the
acceptance sentence:

> DISCLAIMER: Your use of the mapping, assessment, and sales information provided on this site constitutes your understanding and acceptance of the following conditions:
>
> The information provided on this site is for convenience only and is compiled from assessment sales, plats, tax maps, surveys, and other public records and data.

The same text later says:

> By using this website I agree that Neither Delaware County nor any of their employees, agents, or mapping contractors will be liable for any actions, claims, damages or judgments of any nature whatsoever arising out of the use or misuse of the information contained in web pages, maps, applications or web-based data services.

Those sentences are the clickwrap. This review did not accept them and did not query the feature
service. The description says the layer is joined to assessor data that includes owner and
assessed value. No name was read.

The text does not grant redistribution. Acceptance-by-use is enough to stop.

## Denominator and freshness

The item `modified` time is 2026-10-26, which is 11 days before 2026-11-06. It was not used as
an as-of. The publisher's commercial count is unavailable. The IGIO `loaddate` for Delaware is
2025-08-11 (452 days) and fails the 400-day bar. No class codes were read. The N1 DLGF map was
not applied.

## Bar

Not run. Parcels loaded: 0.
