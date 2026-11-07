# in-st-joseph-parcels: St. Joseph County parcels (FIPS 18141), stopped

Reviewed 2026-11-06. No collector config. No download. No adapter.

**Status: stopped before a load.** The county's own FAQ says a countywide copy of the data fields
requires a fee and a signed agreement. The service item states no licence.

## Publisher and URLs

- Publishers named on the service: City of South Bend, St. Joseph County.
- Iteminfo:
  `https://gis.southbendin.gov/arcgis/rest/services/LandRecords/Parcels/FeatureServer/info/iteminfo?f=json`.
  `https://gis.southbendin.gov/robots.txt` returns HTTP 404.
- County FAQ `https://www.sjcindiana.gov/Faq.aspx?QID=242`. A direct request for that URL later
  on 2026-11-06 returned HTTP 403 and was not retried. The sentences below are from the search
  excerpt of that URL captured earlier the same day. `www.sjcindiana.gov/robots.txt` does not
  disallow `/Faq.aspx`.

## Terms

Service iteminfo, read 2026-11-06: `licenseInfo` is empty. `accessInformation` is
"City of South Bend, St. Joseph County". The description is "Parcels in the City of South Bend
and St. Joseph County". That does not grant reuse.

FAQ excerpt, the answer to how to request mapping services:

> Option 1: Navigate to our GIS HUB and scroll down to the Data Portal section. Chose the coordinating tab and follow instructions for downloading.
>
> This option is for those that just need the line work (no data included).
>
> Option 2: Navigate to Online GIS Data Request Form and fill out the form with requested information to obtain mapping services.
>
> This option is for those that need line work and the data fields (if for entire county a fee of $200 and a signed Provisional Data Usage Agreement is required before layer is delivered).

The same excerpt says "GIS parcels are updated every 2 weeks." That sentence was not checked
against a download. The form was not submitted and the agreement was not signed.

The feature schema on layer `LandRecords.DBO.Parcels_County` includes `CLASSCODE`. No feature
was queried. No code value and no name was read. Whether `CLASSCODE` is DLGF Code List 1 is
unverified. The statewide class map was not applied.

## Denominator and freshness

The publisher's commercial count is unavailable. The "every 2 weeks" sentence is not an as-of.
The IGIO `loaddate` for St. Joseph is 2025-08-27 (436 days before 2026-11-06) and fails the
400-day bar.

## Bar

Not run. Parcels loaded: 0.
