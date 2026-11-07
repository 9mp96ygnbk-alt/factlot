# in-vanderburgh-parcels: Vanderburgh County parcels (FIPS 18163), stopped

Reviewed 2026-11-06. No collector config. No download. No adapter.

**Status: stopped before a load.** The licence is a convenience disclaimer. It does not grant
redistribution.

## Publisher and URLs

- Publisher: City of Evansville / Vanderburgh County, ArcGIS item owner `EVC_ComputerServices`.
- Item `eb92dc98ed854334a2ff7e8d2a708311`, read from
  `https://www.arcgis.com/sharing/rest/content/items/eb92dc98ed854334a2ff7e8d2a708311?f=json`.
  Title `Tax Parcels`. `modified` 2025-10-29 21:03:46 UTC.
- Service URL on the item:
  `https://maps.evansvillegis.com/arcgis_server/rest/services/PROPERTY/PARCELS/MapServer/0`.
  `https://maps.evansvillegis.com/robots.txt` sets `Crawl-delay: 60` and does not disallow
  `/arcgis_server/`. The terms below are from the ArcGIS Online item, not a second crawl of that host.

## Terms

`licenseInfo`, HTML wrappers removed, wording unchanged, read 2026-11-06:

> The information provided on this site is for convenience only and is compiled from public records and data. In the preparation of this site, extensive efforts have been made to offer the most current, correct, and clearly expressed information possible. However, inadvertent errors can occur, and information placed on these Web pages is not intended to replace any official source. Contact the appropriate official information sources for verification of the information provided on these pages. Use of any of this information is at the user's own risk. Neither the City of Evansville, nor Vanderburgh County, nor any of their employees, agents, or mapping contractors assume any legal responsibility for the information contained herein, which is provided with no warranties of any kind and disclaims all liability of any kind arising out of this information and disclaims all express or implied warranties, including warranties of merchantability, fitness for a particular purpose, and non-infringement of proprietary rights and for any actions, claims, damages or judgments of any nature whatsoever arising out of the use or misuse of the information contained in these Web pages.

The item snippet says the layer has tax ID, ownership, property address, and other attributes.
No feature was queried. No name was stored. The text does not grant reuse and does not forbid it
in a separate sentence. That is unclear, in the same class as a disclaimer with no licence stated.

## Schema, denominator, freshness

The MapServer layer schema includes `property_class`. No value was read. Whether it is DLGF Code
List 1 is unverified. The statewide class map was not applied.

The item `modified` time is 2025-10-29, which is 373 days before 2026-11-06 and inside the
400-day line. It is the item's modified time, not a loaded as-of. The publisher's commercial
count is unavailable. The IGIO `loaddate` for Vanderburgh is 2025-08-29 (434 days) and fails.

## Bar

Not run. Parcels loaded: 0.
