# in-clark-parcels: Clark County parcels (FIPS 18019), stopped

Reviewed 2026-11-06. No collector config. No download. No adapter.

**Status: stopped before a load.** The county's GIS link is a Schneider Beacon application.
That application was not opened, and no click-through was accepted.

## Publisher and URLs

County land page, read 2026-11-06:
`https://www.clarkcounty.in.gov/index.php/clark-county-indiana-resident-resources/clark-county-indiana-land-property`.

The page says:

> Clark County has partnered with Elevate for Geographical Information System Solution.

The GIS links on that page go to
`https://beacon.schneidercorp.com/Application.aspx?AppID=1173&LayerID=31896&PageTypeID=2&PageID=13005`
and a second Beacon URL with `PageTypeID=1`. Neither URL was opened.

An ArcGIS Hub whose hostname is `clarkcountygis-ccgismo.hub.arcgis.com` was checked by its
sitemap. The datasets named there are for the Las Vegas area (Henderson, Boulder City, North
Las Vegas). That hub is not this Clark County. It was not used.

A third-party copy titled `ClarkCountyIN_Parcels` (ArcGIS item
`5e08148ebf1a48f7b7ecc48796b4ca17`, owner `tking_synterra`, modified 2026-08-06) carries the IGIO
2022 citation dated 20230112. It is not the county publisher, and the citation date is older than
the statewide layer. It was not downloaded.

## Terms

No Clark County, Indiana licence sentence was readable without opening Beacon. Beacon was not
opened.

## Denominator and freshness

Unavailable from the county. The IGIO `loaddate` for Clark is 2025-08-22 (441 days before
2026-11-06) and fails the 400-day bar. No class codes were read. The statewide DLGF class map was not applied.

## Bar

Not run. Parcels loaded: 0.
