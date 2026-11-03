# in-marion-parcels: Marion County, Indiana (Indianapolis; FIPS 18097) parcels with owners and assessed values

Reviewed 2026-11-03. Machine-readable copy: [`registry/sources/in/in-marion-parcels.json`](../../../registry/sources/in/in-marion-parcels.json).
Adapter: `factlot.registry.adapters.in_marion` (account system `marion_state_parcel`, the 18-digit Indiana state parcel number).

**Status: `verified: true`.** IndyGIS states "no restrictions on the use of Data"; attribution is required for derived data.

## Publisher and URLs

- Publisher: City of Indianapolis and Marion County, Indiana: IndyGIS, with the Marion County Assessor's Office.
- ArcGIS Online item `0d28e222479743baa97f8f4456da7bb4` "Parcels w/ Owner Information & Assessed Values"
  (<https://www.arcgis.com/home/item.html?id=0d28e222479743baa97f8f4456da7bb4>; "updated nightly from IndyGIS Parcels and Marion
  County Assessor's Office information").
- Service: `https://gis.indy.gov/server/rest/services/MapIndy/MapIndyProperty/MapServer/10` (347,057 polygons, `maxRecordCount` 1000,
  JSON/GeoJSON/PBF). The data.indy.gov and indianamap.org ArcGIS Hub sites have `Crawl-delay: 60` and were not used.
- Statewide alternative: IndianaMap / IGIO `https://gisdata.in.gov/server/rest/services/Hosted/Parcel_Boundaries_of_Indiana_Current/FeatureServer/0`
  (3,682,675 parcels; `dlgf_prop_class_code`, situs, county id, tax districts; **no owner names, no values**; licenseInfo: citation requested,
  not required, as-is). Useful for Indiana counties whose own services carry no owner, not needed for Marion.

## Terms, license, robots

- **Terms.** The item's `licenseInfo`: "The Spatial Data, and the information therein, (collectively the "Data") is provided "as is" without
  warranty of any kind ... There are no restrictions on the use of Data provided via data download, map or service; any data derived from
  the Data must acknowledge the City of Indianapolis/Marion County, IN. Information published on this map, website and/or service is furnished
  as a public service by the City of Indianapolis/Marion County, IN and is intended to be used for reference only." AI use is not addressed.
- **robots.txt.** `gis.indy.gov`: none (404). `data.indy.gov` and `www.indianamap.org`: `Crawl-delay: 60`, `/sites/ /admin/ /sessions/ /groups/ /people/ /workspace/` disallowed (not used).

## What the file contains

The collector archives 21 pages (`returnGeometry=false`, `OBJECTID` order, 1,000 features each) of the polygons whose `PROPERTY_SUB_CLASS`
(the Indiana DLGF property class) is 300-499. Key columns: `STATEPARCELNUMBER` (`49-13-16-111-003.000-200`), `PARCEL_I`, situs
(`STNUMBER`, `PRE_DIR`, `STREET_NAME`, `SUFFIX`, `SUF_DIR`, `CITY`, `ZIPCODE`), `FULLOWNERNAME` (up to four name lines joined with `", "`),
`OWNERADDRESS`, `OWNERADDRESS2`, `OWNERCITY`, `OWNERSTATE`, `OWNERZIP`, `PROPERTY_CLASS`, `PROPERTY_SUB_CLASS`,
`PROPERTY_SUB_CLASS_DESCRIPTION`, `ASSESSORYEAR_LANDTOTAL`/`_IMPTOTAL`/`_TOTALAV` (assessed, dollars), `ACREAGE` (text), `ESTSQFT` (polygon area, sf).
One tax parcel can be several polygons with the same values; the adapter keeps the first and adds the polygons' `ESTSQFT`.

Code table (descriptions from the layer's `PROPERTY_SUB_CLASS_DESCRIPTION`; counts are all Marion polygons):

| Code                    | Publisher description                                                                                                                                                                                                                                                        | FactLot      |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| 300, 309                | IND vacant land (and support land)                                                                                                                                                                                                                                           | F2           |
| 310-399                 | Industrial: food and drink 310, foundries 320, medium/light manufacturing 330/340, industrial office 345, R&D 346, warehouse 350 (1,384), truck terminals 360, small shops 370, mines 380, grain elevator 390, other 399 (571)                                               | F2           |
| 400, 409                | COM vacant land (and support land)                                                                                                                                                                                                                                           | F1           |
| **401, 402, 403**       | **COM apartments of 4-19, 20-39, 40 or more units** (317, 178, 1,034)                                                                                                                                                                                                        | **B**        |
| 410-499                 | Commercial: motels 410, hotels 411, nursing homes 412, mobile home parks 415, other housing 419, retail 420-429, food service 430-439, services and offices 440-449, gas and auto 450-455, parking 456, amusement 460-469, warehouses 480-482, marine 490, other 499 (1,924) | F1           |
| 1xx, 2xx, 5xx, 6xx, 8xx | Agricultural, mineral, residential (510 is 248,207), exempt, utilities                                                                                                                                                                                                       | out of scope |

The publisher's code is kept in `local_use_code`. `PROPERTY_CLASS` is not read.

## Gates

None.

## Real run

`snapshot` on 2026-11-03: 21 pages, 16,311,012 bytes (first page `fl:document:sha256-a07924944d48490f9a47b20b5dabdb256c4222b73b8059f149ead3c0a9e78384`), then `in_marion.build` (5.7 s):

- Rows read: 20,866 polygons (all of class 300-499) = **20,630 tax parcels** kept: B 1,357, F1 15,498, F2 3,775.
- Facts written: 155,913. Organisation owners (owner-of-record facts): 16,108; natural persons or blank owners not stored: 4,522.

## Known gaps

- No year built, building area or roll year in the layer; `ASSESSORYEAR_*` are assessed (not market) values for the current assessment year.
- `FULLOWNERNAME` joins lines with a comma, so a name containing a comma that is not a company suffix keeps only its first segment (a person's "LAST, FIRST" becomes "LAST", which is dropped as a person anyway).
- Only the 300-499 classes were pulled; 4-unit apartments (code 401) are the publisher's multifamily class, so they are B though the brief's threshold is 5+ units.
- Indiana's other counties are not covered; the statewide IndianaMap layer has no owners.
