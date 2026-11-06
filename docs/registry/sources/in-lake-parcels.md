# in-lake-parcels: Lake County parcels (FIPS 18089), stopped

Reviewed 2026-11-06. No collector config. No download. No adapter.

**Status: stopped before a load.** The county forbids commercial use.

## Publisher and URLs

- Publisher: Lake County Surveyor's Office, ArcGIS item owner `lakecountyod`.
- Item `18b6b08c8c7e403cbd9451360c8f5a61`, read from
  `https://www.arcgis.com/sharing/rest/content/items/18b6b08c8c7e403cbd9451360c8f5a61?f=json`.
  `modified` 2026-11-06 14:07 UTC. Access public.
- Service URL on the item:
  `https://services5.arcgis.com/8CXRnvSfSpwdf0R6/arcgis/rest/services/Lake_County_Parcels/FeatureServer`.
  `https://services5.arcgis.com/robots.txt` returned HTTP 403, so that host was not queried.
- `www.arcgis.com/robots.txt` allows all user agents.

## Terms

`licenseInfo` of the item, HTML wrappers removed, wording unchanged, read 2026-11-06:

> DISCLAIMER: The data on this website is provided 'as is' without warranty of accuracy, timeliness or completeness. The burden for determining appropriateness for use rests solely on the user. Lake County, IN make no warranties of merchantability or fitness. The data is in a constant state of maintenance, correction and revision. The maps and associated data at this website do not represent a survey. No liability is assumed for this data. Any redistribution of this data, either in it's original form or any transformed or built upon state, must give contribution to the Lake County Surveyor's Office and may not be used for commercial purposes.

The item description says the table includes PIN, ownership, address, and other tax information.
No feature was read. No name was stored.

`accessInformation`: Lake County Surveyor's Office.

## Denominator and freshness

The item `modified` time is 2026-11-06, which is inside 400 days. That is the item's modified
time, not a `loaddate`, and it was not used as an as-of because the licence stops the load.
The publisher's commercial count is unavailable. The IGIO `loaddate` for Lake is 2025-08-19
(444 days) and fails the 400-day bar.

The class-code field was not read, because the feature host returned HTTP 403 for `robots.txt`.
The N1 DLGF map was not applied.

## Bar

Not run. Parcels loaded: 0. Commercial use is forbidden, so this source is not loaded even though
the item is newer than the IGIO harvest.
