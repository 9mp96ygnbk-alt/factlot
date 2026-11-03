# il-dupage-parcels: DuPage County, Illinois (FIPS 17043) parcels with the County Clerk real estate file

Review date: 2026-11-03. Verdict: **gated: terms. The data is free and has owners, class and values, but its disclaimer forbids redistribution without written permission; `verified: false`; no adapter.**
Config: [`registry/sources/il/il-dupage-parcels.json`](../../../registry/sources/il/il-dupage-parcels.json).

## Publisher and URLs

- DuPage County Information Technology Department, GIS Division (630-407-5000), in conjunction with the County Clerk; assessment data from the county's assessment administration system.
- Open-data hub: <https://gisdata-dupage.opendata.arcgis.com/> (robots `Crawl-delay: 60`). ArcGIS Online item `b47d0bd9cef14b2fbeec45bc0df50935` "ParcelsRealEstate".
- Services (public REST, no login): `https://gis.dupageco.org/arcgis/rest/services/Tyler/ParcelsRealEstateCCWGS84SR4326/MapServer/0` (current; 337,346 parcels; `maxRecordCount` 2000; the description says the real
  estate file is joined to the parcels weekly) and `.../DuPage_County_IL/ParcelsWithRealEstateCC/FeatureServer/0` (the hub's copy; same count; description says complete to assessment year 2016).
- `gis.dupageco.org` has no robots.txt (404).

## Terms, license, robots

- **Terms (the item's `licenseInfo`).** "DuPage County Government County Clerk's Office - Real Estate Database Disclaimer ... The County of DuPage is not inviting reliance on the real estate database and the user should always verify actual data ...
  **By providing you with a copy of DuPage County real estate data, via hardcopy, electronic media, you are not entitled or permitted to repackage, resell or distribute this information without the written permission through the Public Information Office
  of the County of DuPage, at 421 N. County Farm Rd., Wheaton, Illinois 60187.**" The county GIS page says its geospatial data is free from the open-data site and is subject to Illinois FOIA constraints. AI use is not addressed.

## What the file contains

Fields (layer 0): `PIN`, `ACREAGE`, `OWNERSHIP_TYPE`, `MAJOR_PROPERTY_OWNER`, `BILLNAME`, `BILLSTNUM`…`BILLZIP` (tax-bill name and address), `PROPNAME`, `PROPSTNUM`…`PROPZIP` (situs), `PARCELSTAT`, `EXEMPTCODE`, `PROPCLASS` and
`GIS_Prop_Class` (Illinois property class), `TAXCODE`, `FCVLAND`/`FCVIMP`/`FCVTOTAL` (fair cash value), `BILLVALUE`, `TAXRATE`, `TAXAMOUNT`, `MUNICIPALITY`, school/fire/park districts, legal descriptions, and the 2017 class and values
(`REA017_*`). Only the field list and a count were read; no class table was mapped and no records were archived.

## Gates

A person must request written permission from the DuPage County Public Information Office to repackage and distribute the real estate data (state the use), and then confirm the class-code definitions with the Supervisor of Assessments.
Until then nothing is archived.

## Real run

None (field list and one count query only). No adapter.

## Known gaps

Property class mapping (Illinois classes for commercial, industrial and apartments), whether `BILLNAME` is the owner of record or the taxpayer, sample counts. Illinois entity data: `il-sos-entities` (Tier 1, blocked).
