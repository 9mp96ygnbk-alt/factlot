# wa-state-parcels: Washington statewide parcel layer without owners (Pierce 53053, Snohomish 53061, King 53033 and 36 more counties)

Review record for the FactLot Registry (data policy §5). Reviewed 2026-11-03. Machine-readable copy:
[`registry/sources/wa/wa-state-parcels.json`](../../../registry/sources/wa/wa-state-parcels.json). **Gated on terms; no
adapter.** Tier 2, west region ([`../tier2/west.md`](../tier2/west.md)).

## Publisher and URLs

- Publisher: Washington Technology Solutions (WaTech), Office of the Chief Information Officer, Geospatial Program
  Office, through the Washington Geoportal (<https://geo.wa.gov>, an ArcGIS Hub). The State Parcels Project assembles the
  counties' tax parcels.
- Layer: "Current Parcels" (ArcGIS item `2b603a599a0842a3b2284c04c8927f35`, owner `WAGeoservices`, modified 2026-10-19),
  feature service `https://services.arcgis.com/jsIt88o09Q0r1j8h/arcgis/rest/services/Current_Parcels/FeatureServer/0`
  (layer name `Parcels_2026`, `maxRecordCount` 2000). Item text: "The Washington State Parcels Project provides a statewide
  dataset of tax parcels attributes that covers all 39 counties ... The data presented are an amalgamation of data sourced
  from individual counties. Each county does data stewardship to their own standards. Not all data in all fields for all
  features is populated." A file geodatabase download is linked from the item ("Direct download available here: Current
  Parcels (GDB)"; its URL and size were not read). A "Previous Parcels" layer (item `98029557...`) also exists.
- The same project's **ownership edition** is not public: the layer's description (as mirrored by other agencies) says it
  carries owner and taxpayer names and that "Some of the counties restrict the use of parcels for State of Washington
  business only"; this "Parcels without ownership information" edition is the public one.

## Terms, license, robots

- Item `licenseInfo`: "The Washington State Geoportal provides this product/service for informational purposes only ...
  The Geoportal provides these data in good faith but does not represent or warrant its accuracy, adequacy, or
  completeness ... The Geoportal makes these data and services available as a convenience to the public and reserves the
  right to change, revise, or remove published data and/or services at any time." That is a disclaimer, not a license; the
  Hub lists the license as `custom`.
- The OCIO "Washington State Data Disclaimer" (2016, Geospatial Program Office,
  <https://watech.wa.gov/sites/default/files/2023-11/Washington%20State%20Data%20Disclaimer%202016.pdf>, read 2026-11-03):
  "all data created by the state, using government funds, is in the public domain but commercial use and licensing of state
  data is prohibited." It adds "In many cases, source data is obtained from multiple organizations ... It is advisable that you
  review all metadata and contact specific contributors directly to find out about any specific data use constraints."
  It is unclear whether this reaches a county-sourced layer, and whether "commercial use" means FactLot's open registry.
- robots.txt: `geo.wa.gov` `Crawl-delay: 60`, disallows `/sites/`, `/admin/`, `/sessions/`, `/groups/`, `/people/`,
  `/workspace/`; `services.arcgis.com` has none.

## What the file contains

Fields (from the feature service): `FIPS_NR`, `COUNTY_NM` (a county number, a name or `Walla Walla` depending on the
county), `PARCEL_ID_NR` (`<FIPS>-<parcel>`), `ORIG_PARCEL_ID`, `SITUS_ADDRESS`, `SUB_ADDRESS`, `SITUS_CITY_NM`,
`SITUS_ZIP_NR`, `LANDUSE_CD` (a two-digit State Department of Revenue land use code, WAC 458-53-030), `ORIG_LANDUSE_CD`
(the county's own code, e.g. `53-5300`), `VALUE_LAND`, `VALUE_BLDG`, `DATA_LINK` (the county's property page), `GlobalID`, shape
fields. **No owner names, no building area, no year built, no assessed/taxable value.** Parcels per county on 2026-11-03 (group-by on
`FIPS_NR`): King 635,192; Pierce 339,590; Snohomish 318,594; five more above 100,000 (Spokane 214,022, Clark 194,316,
Kitsap 139,602, Thurston 130,367, Whatcom 117,813); 39 counties in all.

Indicative in-scope counts, using the State code on `LANDUSE_CD` (B = 13 multi-unit 5+; F1 = 16 hotels, 50-59 trade, 61-65 and 69
services; F2 = 21-35 and 39 manufacturing), from the layer's group-by statistics, not from a download:

| County          |     B |     F1 |                              F2 |  Total |
| --------------- | ----: | -----: | ------------------------------: | -----: |
| Pierce (053)    | 2,581 | 10,917 |                             546 | 14,044 |
| Snohomish (061) | 1,597 |  7,838 |                             898 | 10,333 |
| King (033)      | 8,519 | 18,372 | 0 (no 21-39 codes in the layer) | 26,891 |

(Pierce's own Data Mart, [wa-pierce-assessor.md](wa-pierce-assessor.md), yields 12,530 after removing exempt and excluded codes.)

## Gates

Terms. The download needs no account, click-through or fee. A person must:

1. Decide whether the OCIO sentence "commercial use and licensing of state data is prohibited" reaches this layer and the
   registry, and if in doubt ask WaTech's Geospatial Program Office (the contact on the item) for a written statement that
   the Current Parcels attributes may be redistributed.
2. If the answer is yes: set `verified` true, add the file geodatabase or a paged query as the file, and a statewide adapter
   (one source, FIPS from `FIPS_NR`) is a small job modelled on `ut_ugrc.py`.

Not downloaded beyond layer metadata, a few sample rows and group-by statistics.

## Known gaps

- No owners, so it cannot feed entity linking; no building area or year built. It does cover King County, which is gated in
  [wa-king-assessor.md](wa-king-assessor.md), for land use and values.
- Several counties' `COUNTY_NM` values are inconsistent (`GraysHarbor`, `PendOreille`, `SanJuan`, `Walla Walla`, a number); use `FIPS_NR`.
