# mi-macomb-parcels: Macomb County, Michigan (FIPS 26099) open-data tax parcels

Review date: 2026-11-03. Verdict: **free layer with owner names but no property class, and no licence text; `verified: false`; no adapter.**
Config: [`registry/sources/mi/mi-macomb-parcels.json`](../../../registry/sources/mi/mi-macomb-parcels.json).

## Publisher and URLs

- Macomb County, Michigan (Macomb County Open Data Portal, "MCMAP"): <https://macomb-county-open-data-portal-mcmap.hub.arcgis.com/> (robots `Crawl-delay: 60`; its DCAT feed `…/api/feed/dcat-us/1.1.json` lists 8 datasets).
- Dataset "Macomb County Parcel Data" (ArcGIS item `e073e8402b3544628d684719c5cd79d1`) → `https://services6.arcgis.com/K0qS4r8AEJxrE8em/arcgis/rest/services/Macomb_County_Parcel_Data/FeatureServer/10`
  ("Macomb County Tax Parcels", 332,993 parcels, `maxRecordCount` 2000). The older item `Macomb_County_Tax_Parcels` (item `820567903b58487fa6af92f5e0bfe60c`) and the Hub download endpoint
  `…/api/download/v1/items/e087278e3c1d4887b3c8d20ae39a38a7/csv?layers=1` answer HTTP 400 "Invalid URL". Equalization reports (PDF, class totals only): macombgov.org.

## Terms, license, robots

None stated: the item's `licenseInfo` is empty and the DetroitData catalog lists "No License Provided". Wayne County's portal terms (personal, non-commercial) and Oakland's open-data terms (reuse for any lawful purpose) do not apply to Macomb.

## What the file contains

Fields: `TAX_ID`, `ADDRESS`, `TAX_TYPE`, `CVT_NAME`, `TAX_URL`, `BSA_ID`, `LEGAL`, `propstreetcombined`, `propertyCityStateZip`, `ownername1` (owner of record: present), `zoning`, `mborsev_0` (state equalized value), `mbortax` (taxable value).
`zoning` holds municipal zoning districts (R-1-C, RA, RM, …; 21,877 blank), not the assessor's property class. **There is no `propclass` or use code**, so commercial, industrial and multifamily parcels cannot be selected.

## Gates

A person should ask Macomb County Equalization (<https://www.macombgov.org/>, Equalization Department) for the parcel-level real property file with the Michigan class code, its price and terms, or file a Michigan FOIA request (see [public-information-requests.md](../public-information-requests.md)), and ask the county to state the open-data terms.

## Real run

None (field list, a count, three sample rows and a zoning count only). No adapter.

## Known gaps

Class code; licence; the Michigan LARA entity register has no bulk file (`mi-sos-entities`). Michigan's other open counties: Oakland (`mi-oakland-parcels`, no owners) and Wayne (`mi-wayne-parcels`, portal terms).
