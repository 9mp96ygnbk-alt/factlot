# oh-cuyahoga-parcels: Cuyahoga County, Ohio (Cleveland; FIPS 39035) composite tax parcels

Reviewed 2026-11-03. Machine-readable copy: [`registry/sources/oh/oh-cuyahoga-parcels.json`](../../../registry/sources/oh/oh-cuyahoga-parcels.json).
Adapter: `factlot.registry.adapters.oh_cuyahoga` (account system `cuyahoga_ppn`, the 8-digit permanent parcel number).

**Status: `verified: false`.** The county serves the data openly with owner names, land use and values, but states no licence or terms
for it. Archived with `--include-unverified` for the real run only; nothing is published from it until a person decides.

## Publisher and URLs

- Publisher: Cuyahoga County Fiscal Officer and Cuyahoga County GIS.
- Service: `https://gis.cuyahogacounty.gov/server/rest/services/Open_Data_Parcels/MapServer` ("Open Data Parcels", tags CAMA, Real Property, Open Data;
  "Survey Parcels with CAMA Real Property characteristics"; credit "CuyahogaGIS, CCFO"): layer 0 "Combined Parcels - Cleveland Only" (163,096) and
  layer 1 "Combined Parcels - Non-Cleveland Only" (358,344); `maxRecordCount` 2000; JSON/GeoJSON/PBF.
- The old hub `data-cuyahoga.opendata.arcgis.com` says it moved to <https://geospatial.gis.cuyahogacounty.gov/pages/data> (robots `Crawl-delay: 60`; landing page only).
- Fiscal Officer pages: <https://fiscalofficer.cuyahogacounty.gov/> and <https://cuyahogacounty.gov/fiscal-officer/data> (read for links only). A 2013 county GIS
  document mentions a Fiscal Office FTP server for owner and transfer data; not used.

## Terms, license, robots

- **Terms.** None stated for the service: the item's `licenseInfo` is empty. The county website Disclaimer (<https://cuyahogacounty.gov/disclaimer>) says the site "is
  provided as a public service", that the county "does not guarantee the accuracy or timeliness of this information" and is not liable for losses from reliance. Nothing
  addresses copying, redistribution or AI use. The records are public under Ohio R.C. 149.43.
- **robots.txt.** `gis.cuyahogacounty.gov`: none (404 page). `geospatial.gis.cuyahogacounty.gov`: `Crawl-delay: 60`, hub paths disallowed.

## What the file contains

18 archived pages (9 per layer; `returnGeometry=false`, `OBJECTID` order, 2,000 features) of the parcels with `property_class` C or I (17,311 + 16,971).
Columns requested: `parcelpin`, `parcel_id`, `parcel_type`, `parcel_year`, `deeded_owner`, `mail_name`, `mail_addr_street`, `mail_unit`, `mail_city`, `mail_state`,
`mail_zip`, `mail_country`, `par_addr_all`, `par_city`, `par_zip`, `tax_luc`, `tax_luc_description`, `property_class`, `tax_year`, `certified_tax_total`,
`certified_exempt_total`, `certified_abated_total`, `gross_certified_land`/`_building`/`_total`, `res_bldg_count`, `total_res_liv_area`, `com_bldg_count`,
`total_com_use_area`, `com_living_units`, `total_square_ft`, `total_acreage`, `tax_abatement`. The service also has `grantee`, `grantor`, `transfer_date`,
`sales_amount`, zoning and utilities.

`property_class` counts (layer 1): R 326,794; E 11,387; C 13,915; I 3,056; LW 867; M 359; P 242; A 206; H 180; CE 125; RE 89; IE 6. Land use `tax_luc` is the
Ohio land use code (Ohio Adm. Code 5703-25-10) with Cuyahoga's 4-digit sub-codes; descriptions are the service's own `tax_luc_description`:

| `tax_luc`                         | Description (service)                                                                                                                                                                          | FactLot      |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| 3000-3995                         | Industrial: vacant land 3000, material yards, landfill, food/drink, heavy/medium/light manufacturing 3200/3300/3400 (908), small shops 3700, utility service facilities 3980 (516), other 3990 | F2           |
| 4000                              | Commercial vacant land (1,011)                                                                                                                                                                 | F1           |
| **4010-4090**                     | **Apartments: walk-up 7-19/20-39/40+ (4010/4020/4030), elevator 7-19/20-39/40+ (4040/4050/4070), garden 20-39/40+ (4060/4080), 4-6 unit apartments 4090 (707)**                                | **B**        |
| 4092-4190                         | Convalescent home, subsidized housing, dormitory, day care, motels, hotels, nursing home, hospital, mobile home park, other housing                                                            | F1           |
| 4200-4999                         | Retail 42xx, food service 43xx, services/offices 44xx-45xx, auto 45xx, entertainment 46xx, other                                                                                               | F1           |
| R, E, CE, IE, RE, A, M, P classes | Residential, exempt, agricultural, mineral, utility                                                                                                                                            | out of scope |

The publisher's code is kept in `local_use_code`. Owner of record = `deeded_owner`; `mail_*` is the tax-bill mailing address. No confidentiality flag.
`gross_certified_total` (before exemption and abatement) is stored as the appraised value; the service does not say whether it is 100 % market value.

## Gates

A person must decide whether a public record published with no terms may be redistributed (see Terms), or ask the Fiscal Officer
(`publicrequest@cuyahogacounty.us`) to confirm the open-data terms of the Open Data Parcels service. No account, form or fee is involved.

## Real run

`collector snapshot --include-unverified` on 2026-11-03: 18 pages, 30,612,145 bytes (first page `fl:document:sha256-e3bd3d77b65c4501189b4d535f5f5706a44ec61d6a5f95dfa852689137059f0c`),
then `oh_cuyahoga.build` (11.6 s):

- Rows read: 34,282 features; parcels kept **34,280** (two repeated parcel numbers dropped): B 5,095, F1 22,330, F2 6,855.
- Facts written: 312,908. Organisation owners (owner-of-record facts): 25,802; natural persons or blank owners not stored: 8,467.

## Known gaps

- No year built (the service has none); `tax_year` is the certified tax year (2025). The Ohio Hamilton and Franklin files carry more characteristics.
- Whether `gross_certified_total` equals the appraised (100 %) value is not documented by the service.
- 4090 (4-6 units) is mapped B as the publisher's apartment class, though the registry's apartment threshold is 5+ units.
- Fiscal Officer sales and transfer detail beyond the last transfer are not read.
