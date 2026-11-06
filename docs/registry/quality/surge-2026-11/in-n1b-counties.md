# N1b Indiana county parcels, 2026-11-06

Lane N1b, branch `surge/n1b-in-counties`, started from `surge/n1-in-statewide`. This page is the
evidence for that lane. No county extract was downloaded. No adapter was added. No scratch
database was built. The promotion bar was not run. `collected/` and `*.db` were not created.

N1 loaded IGIO `Parcel Boundaries of Indiana Current` and kept 179,930 commercial and industrial
parcels. For the 13 counties in this lane, that load's `loaddate` is 2025-08-08 through
2025-09-09, which is 423 to 455 days before 2026-11-06. The 400-day line is 2025-10-02. Detail of
that load is in [`in-statewide-parcels.md`](in-statewide-parcels.md).

## Statewide harvest

Read 2026-11-06.

There is no public 2026 parcel feature service. The Hosted folder
`https://gisdata.in.gov/server/rest/services/Hosted?f=pjson` lists
`Parcel_Boundaries_of_Indiana_2025` and `Parcel_Boundaries_of_Indiana_Current`. It does not list
`Parcel_Boundaries_of_Indiana_2026`. `https://gisdata.in.gov/robots.txt` returns HTTP 301 to the
portal home page and no `Disallow` rules. `https://gisdata.in.gov/server/robots.txt` returns
HTTP 404.

`Hosted/Parcel_Boundaries_of_Indiana_2025/FeatureServer` (service item
`f38abeb0f923447485572e0207660c2d`) describes itself as released by IGIO on December 1, 2025.
Its iteminfo `licenseInfo`, HTML wrappers removed, wording unchanged:

> CREDIT - It is requested, but not required, that the Indiana GIS Data Harvest Program be cited in any products generated from this data set. If citing, the following source citation language should be included: [Administrative Boundaries of Indiana 2025: Administrative Boundaries Maintained by Local Government Agencies in Indiana, (Indiana Geographic Information Office, File Geodatabase, Polygon Feature Classes), 20251201].

The rest of that `licenseInfo` is the same "AS IS" warranty limit N1 quoted for the Current
service, with "The Polis Center at Indiana University Indianapolis" in place of "The Polis Center
at IUPUI". The citation names administrative boundaries. The layer name is
`Parcel Boundaries of Indiana 2025`, and the fields include `dlgf_prop_class_code`,
`state_parcel_id`, `county_fips`, and `loaddate`. The description text and the citation do not
match the layer name. This review does not treat that mismatch as a new prohibition. The credit
sentence does not forbid redistribution. It is the same class of text N1 left at `verified: false`.

A statistics query of both the 2025 service and the Current service, on 2026-11-06, for these 13
counties, returned the same commercial-feature count and the same `loaddate` minimum and maximum.
The minimum equals the maximum inside each county. The counts match the feature column in the N1
record. Distinct `state_parcel_id` values were not counted again. Age is days from `loaddate` to
2026-11-06.

| FIPS  | County      | 3xx/4xx features | loaddate   | Age | 400-day bar |
| ----- | ----------- | ---------------: | ---------- | --: | ----------- |
| 18003 | Allen       |             9340 | 2025-08-29 | 434 | fail        |
| 18019 | Clark       |             4675 | 2025-08-22 | 441 | fail        |
| 18035 | Delaware    |             4813 | 2025-08-11 | 452 | fail        |
| 18039 | Elkhart     |             7850 | 2025-09-05 | 427 | fail        |
| 18057 | Hamilton    |             6195 | 2025-08-08 | 455 | fail        |
| 18089 | Lake        |            15020 | 2025-08-19 | 444 | fail        |
| 18095 | Madison     |             5385 | 2025-08-28 | 435 | fail        |
| 18105 | Monroe      |             7855 | 2025-08-20 | 443 | fail        |
| 18127 | Porter      |             4163 | 2025-08-22 | 441 | fail        |
| 18141 | St. Joseph  |             7537 | 2025-08-27 | 436 | fail        |
| 18157 | Tippecanoe  |             6073 | 2025-08-29 | 434 | fail        |
| 18163 | Vanderburgh |             5539 | 2025-08-29 | 434 | fail        |
| 18167 | Vigo        |             4449 | 2025-09-09 | 423 | fail        |

The 2025 compilation does not make these counties fresh. The Current service iteminfo still says
the layer was released on November 13, 2024.

The Data Harvest access page, `https://dataharvest.gio.in.gov/pages/data-access`, read 2026-11-06,
still says the maps cover 2020 through 2025. A page block on that site says:

> The IGIO will be launching the 2026 Data Harvest program cycle on July 31, 2026.

The hub JSON around that sentence has `updatedAt` 2026-10-29. July 31, 2026 is before this review.
The sentence is still written in the future tense. No 2026 parcel service was in the public Hosted
folder on 2026-11-06.

`https://countydataharvest.in.gov/statewide/` lists download directories for 2020, 2021, 2022, and 2023. `https://countydataharvest.in.gov/realproperty/` lists
`real_property_2020.gdb.zip` through `real_property_2023.gdb.zip`. Requests for
`/statewide/2024/`, `/statewide/2025/`, and `/statewide/2026/` returned HTTP 403 and were not read.
`https://countydataharvest.in.gov/robots.txt` also returned HTTP 403. The 200 responses above are
the directory pages. Those zip files were not downloaded.

The IGIO licence on the 2025 service would have allowed a load of the same kind as N1, with
`verified` left false. It was not loaded because every one of these 13 counties fails the 400-day
bar on that service, and the extract would repeat the N1 rows.

## County sources

Each county record is under `docs/registry/sources/`. Terms were read on 2026-11-06. A licence that
forbids redistribution or commercial use, a clickwrap, a fee plus a signed agreement, a robots
`Disallow`, an HTTP 403, or text that does not grant reuse stopped the county before a download.
No code values were read, so the N1 DLGF map was not applied to a county extract. Where a layer
schema was readable, the class-field name is in that county's record. Whether those values are
DLGF Code List 1 is unverified.

The publisher's own commercial or industrial parcel count was not printed on any page read here.
Because no extract was taken, this lane does not substitute a measured count. The denominator is
unavailable for every county.

`services5.arcgis.com/robots.txt` and `services6.arcgis.com/robots.txt` returned HTTP 403. Field
lists on those hosts were not used. Item metadata quoted below was read from `www.arcgis.com`,
whose `robots.txt` is `User-agent: *` and a sitemap, with no `Disallow`.

| County      | FIPS  | County source read                                                  | Terms                                                                                                                             | Parcels loaded | As-of used                                                                                       | Bar                                                                                  |
| ----------- | ----- | ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | -------------: | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| Allen       | 18003 | iMap `AC_Parcel_iMap_org` layer 20                                  | Empty `licenseInfo`. Snippet says the service is for portal organization users. Viewer text is a warranty disclaimer.             |              0 | No layer edit date. Statewide `loaddate` 2025-08-29 fails.                                       | Not run. Stopped: unclear.                                                           |
| Lake        | 18089 | ArcGIS item `18b6b08c8c7e403cbd9451360c8f5a61`, modified 2026-11-06 | Redistribution must credit the Surveyor's Office and "may not be used for commercial purposes."                                   |              0 | Item modified 2026-11-06. Not a loaded as-of.                                                    | Not run. Stopped: commercial use forbidden.                                          |
| Hamilton    | 18057 | Not collected. `robots.txt` disallows `/arcgis/`.                   | Search excerpt of the service description: "internal use only."                                                                   |              0 | Statewide `loaddate` 2025-08-08 fails.                                                           | Not run. Stopped: robots, and internal use.                                          |
| St. Joseph  | 18141 | South Bend `LandRecords/Parcels` iteminfo. FAQ excerpt.             | Service `licenseInfo` empty. County FAQ: countywide fields require a $200 fee and a signed agreement.                             |              0 | FAQ says parcels are updated every 2 weeks. Not measured. Statewide `loaddate` 2025-08-27 fails. | Not run. Stopped: fee and signed agreement; licence unclear.                         |
| Elkhart     | 18039 | No county file read.                                                | `gis.elkhartcounty.com` REST and `elkhartcounty.com` returned HTTP 403.                                                           |              0 | Statewide `loaddate` 2025-09-05 fails.                                                           | Not run. Stopped: 403.                                                               |
| Vanderburgh | 18163 | ArcGIS item `eb92dc98ed854334a2ff7e8d2a708311`, modified 2025-10-29 | Convenience disclaimer. No reuse grant.                                                                                           |              0 | Item modified 2025-10-29 (373 days). Not a loaded as-of.                                         | Not run. Stopped: unclear.                                                           |
| Monroe      | 18105 | `gis.co.monroe.in.us` Parcels iteminfo, and the county terms page.  | Website terms forbid distribution without written permission and are accepted by use. GIS item `licenseInfo` is empty.            |              0 | No layer edit date. Statewide `loaddate` 2025-08-20 fails.                                       | Not run. Stopped: distribution forbidden if the site terms apply; otherwise unclear. |
| Madison     | 18095 | County home page. A Schneider WFS URL in search.                    | No licence sentence found. Beacon was not opened.                                                                                 |              0 | Statewide `loaddate` 2025-08-28 fails.                                                           | Not run. Stopped: unclear.                                                           |
| Clark       | 18019 | County land page. The GIS link is Schneider Beacon.                 | Beacon was not opened. No licence was readable without that application.                                                          |              0 | Statewide `loaddate` 2025-08-22 fails.                                                           | Not run. Stopped: click-through not accepted.                                        |
| Delaware    | 18035 | ArcGIS item `d05f185c75d142fd961203304bc36de0`, modified 2026-10-26 | Use "constitutes" acceptance, and "By using this website I agree".                                                                |              0 | Item modified 2026-10-26. Not a loaded as-of.                                                    | Not run. Stopped: clickwrap.                                                         |
| Porter      | 18127 | ArcGIS item `5055e398a5344fa496def6bc6fef19d1`, modified 2026-11-05 | `licenseInfo` empty.                                                                                                              |              0 | Item modified 2026-11-05. Not a loaded as-of.                                                    | Not run. Stopped: unclear.                                                           |
| Tippecanoe  | 18157 | `Parcels_FeatureService` iteminfo.                                  | `licenseInfo` empty. Description says redacted names were removed.                                                                |              0 | No layer edit date. Statewide `loaddate` 2025-08-29 fails.                                       | Not run. Stopped: unclear.                                                           |
| Vigo        | 18167 | County hub sitemap. No parcel dataset.                              | No parcel licence found. An address-point item, which is not a parcel file, forbids commercial use without written authorization. |              0 | Statewide `loaddate` 2025-09-09 fails.                                                           | Not run. Stopped: no parcel licence to read.                                         |

## Promotion bar

| Bar                                 | Result                                                                                                                                                               |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Re-read equals the registry         | Not run. No registry rows were written.                                                                                                                              |
| 0 audit violations                  | Not run. `audit.py` was not invoked.                                                                                                                                 |
| 0 person-like owner facts           | Not run. No owner values were read or stored.                                                                                                                        |
| Per-county count matches the record | Not run. The denominator is unavailable.                                                                                                                             |
| as-of within 400 days               | Fail for the IGIO 2025 and Current layers, all 13 counties. County item modified-dates that fall inside 400 days were not loaded, because the licence stopped first. |

`verified` is not set on any of these county sources. No new rights question was resolved by
loading. The open questions are the ones in the county records: commercial-use bans, clickwrap,
a fee and a signed agreement, empty licence text, robots `Disallow`, and HTTP 403.
