# in-allen-parcels: Allen County parcels (FIPS 18003), stopped

Reviewed 2026-11-06. No collector config. No download. No adapter.

**Status: stopped before a load.** The service states no licence. Its own snippet limits it to
portal organization users. That is unclear, so the roll was not read.

## Publisher and URLs

- Publisher: Allen County iMap / Allen County GIS.
- Service: `https://gis.acimap.us/acfw/rest/services/Parcels/AC_Parcel_iMap_org/FeatureServer`.
  Layer id 20 is `AC Parcel iMap`. `https://gis.acimap.us/robots.txt` returns HTTP 404.
- Iteminfo:
  `https://gis.acimap.us/acfw/rest/services/Parcels/AC_Parcel_iMap_org/FeatureServer/info/iteminfo?f=json`.
- Viewer disclaimer: `https://www.acimap.us/viewer.html`.
- A digital-data request form is posted at `https://www.acimap.us/MapREQUESTS.pdf`. This review
  did not submit it.

## Terms

Iteminfo, read 2026-11-06: `licenseInfo` is empty. `snippet` and `summary`:

> Parcel data for Allen County portal organization users.

Viewer page, read 2026-11-06:

> Data illustrated on this website is based on the best available information found in and derived from historical records and field investigations. Questionable data found on this site should be directed to the Allen County Surveyor for clarification.

The same page, and `https://www.acimap.us/assessors.html`, say Allen County offers no warranty or
guarantee as to the accuracy of the representations. Neither page grants redistribution. The
request form is how the county takes a digital-data request. It was not used.

## Schema, denominator, freshness

The layer schema includes `Property_Class` and `Property_Class_Description`. It also includes an
owner-of-record field. No feature was queried, so no code value and no name was read. The statewide DLGF
class map was not applied. Whether `Property_Class` is DLGF Code List 1 is unverified.

`editingInfo` is absent. There is no as-of on the metadata. The IGIO `loaddate` for Allen is
2025-08-29 (434 days before 2026-11-06) and fails the 400-day bar. The publisher's commercial
count is unavailable.

## Bar

Not run. Parcels loaded: 0.
