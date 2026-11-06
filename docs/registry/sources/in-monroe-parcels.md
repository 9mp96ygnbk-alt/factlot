# in-monroe-parcels: Monroe County parcels (FIPS 18105), stopped

Reviewed 2026-11-06. No collector config. No download. No adapter.

**Status: stopped before a load.** The county website terms forbid distribution without written
permission, and they say use of the site is acceptance. The GIS item states no licence. It is
unclear whether the website terms cover the GIS host. Either reading stops a load.

## Publisher and URLs

- GIS iteminfo:
  `https://gis.co.monroe.in.us/server/rest/services/Parcels/FeatureServer/info/iteminfo?f=json`.
  `https://gis.co.monroe.in.us/robots.txt` returns HTTP 404.
- County terms: `https://www.co.monroe.in.us/terms/`.
- GIS division disclaimer:
  `https://www.co.monroe.in.us/department/division.php?structureid=150`.

## Terms

GIS iteminfo, read 2026-11-06: `licenseInfo` is empty. Snippet:

> Monroe County parcels, managed by the Monroe County Auditor's Office.

Website terms, read 2026-11-06. The page says it covers `www.co.monroe.in.us`, and:

> By accessing and using the Monroe County site, you agree to be subject to the terms and conditions described in this document.

The use limit on that page:

> You may print or download material displayed on the Site for noncommercial; personal use only, provided you also retain all copyright and other proprietary notices contained on the materials. You may not, however, sell, reverse engineer, distribute, modify, transmit, reuse, repost, use, or create derivative works based on the content of the Site in whole or in part for any purpose, without written permission from www.co.monroe.in.us, its authorized agents and contractors, or the owner of such content in each instance.

This review did not accept those terms and did not ask for written permission. The parcel host
is `gis.co.monroe.in.us`, not `www.co.monroe.in.us`. If the quoted limit applies, redistribution
is forbidden. If it does not apply, the GIS item still states no licence. Both are a stop.

The GIS division page disclaimer says the county does not warrant the information and that GIS
lines are not legal boundaries. It does not grant reuse.

## Schema, denominator, freshness

The layer schema includes `PROP_Class_Code` and `PROP_Class_Desc`, and an owner field. No feature
was queried. No code value and no name was read. Whether the class code is DLGF Code List 1 is
unverified. The N1 map was not applied.

`editingInfo` is absent. The publisher's commercial count is unavailable. The IGIO `loaddate`
for Monroe is 2025-08-20 (443 days before 2026-11-06) and fails the 400-day bar.

## Bar

Not run. Parcels loaded: 0.
