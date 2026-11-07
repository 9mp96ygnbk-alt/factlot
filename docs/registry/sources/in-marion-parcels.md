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

## Full load (2026-11-03)

Release `data-2026-11-03-41603209834` (draft, maintainers only) of `9mp96ygnbk-alt/factlot`. Each asset's sha256 was checked against the manifest and its first 16 hex characters against the name. Loaded into the Tier 2 scratch registry (one SQLite file shared by every Tier 2 source, `ct-sos-entities` first).

Assets (document id from the manifest):

- `in-marion-parcels__a07924944d48490f__query` (788,440 bytes): `fl:document:sha256-a07924944d48490f9a47b20b5dabdb256c4222b73b8059f149ead3c0a9e78384`
- `in-marion-parcels__657f3c22dfcf02ad__query` (785,061 bytes): `fl:document:sha256-657f3c22dfcf02ad6c9c8db77502b4cc3828936198a710d88e981742975b8f0a`
- `in-marion-parcels__ee17a268c9c78b6f__query` (782,376 bytes): `fl:document:sha256-ee17a268c9c78b6f313b0cc1baff38aee0d97037c097a0bc0cc0747d92bb603e`
- `in-marion-parcels__8df72d29e88a9176__query` (783,006 bytes): `fl:document:sha256-8df72d29e88a91769ffe790657ff6031995c568ce86104b66853bbc7f393c7d8`
- `in-marion-parcels__29af750881ed4e71__query` (785,039 bytes): `fl:document:sha256-29af750881ed4e7137603a527338cf00382765409fd3c8c3e1ffd78734255522`
- `in-marion-parcels__beea2df761070eb3__query` (783,450 bytes): `fl:document:sha256-beea2df761070eb3dd46c06c90dd0faaba5d6c36d51207af2e977976ed6407b3`
- `in-marion-parcels__349d1eb5e69d9f8e__query` (784,314 bytes): `fl:document:sha256-349d1eb5e69d9f8e3df776383d9fc3250bff249d4186e02f4e4ac8b313ac5d27`
- `in-marion-parcels__0dfeaa7df436828c__query` (784,585 bytes): `fl:document:sha256-0dfeaa7df436828c9ea236595b70fc08fddd9666e85a7efbbfefa34e87c3243c`
- `in-marion-parcels__8fc6988467ca79be__query` (785,541 bytes): `fl:document:sha256-8fc6988467ca79bec058c9a576b2815b56f6271898f264ac53b20d922cd55d8a`
- `in-marion-parcels__8927a4a07dee1b4f__query` (782,528 bytes): `fl:document:sha256-8927a4a07dee1b4f20d21ff0d664b383182cac8790d22c90c0b966f206356166`
- `in-marion-parcels__bfcfbec96b272944__query` (777,096 bytes): `fl:document:sha256-bfcfbec96b272944724e05876b3115ee6c1870d51ee4aa21d9a37340fe8b2c07`
- `in-marion-parcels__484e0cf14ca48427__query` (777,373 bytes): `fl:document:sha256-484e0cf14ca4842724a1ffea76f6514eddcd96f5f9d6a47c31ec3fe12b24f6e1`
- `in-marion-parcels__f9e733f47db7b170__query` (778,847 bytes): `fl:document:sha256-f9e733f47db7b170c5b4ccdad4d720b4bf9433dd4787a799165664e62fc7d1cd`
- `in-marion-parcels__c9b0cb06728d1fd5__query` (779,629 bytes): `fl:document:sha256-c9b0cb06728d1fd5db826e348c98c14ab97c8950c76b3033c80da0d30f43a53f`
- `in-marion-parcels__bcf60216df80464b__query` (778,490 bytes): `fl:document:sha256-bcf60216df80464b109b8efc89fc6e3716b110fab78da7bffb21ca6ad0426ad6`
- `in-marion-parcels__1000cceae5620ccf__query` (780,243 bytes): `fl:document:sha256-1000cceae5620ccf74303acce79b5a3eb1926473972cfd6daa8f0f78d406a15d`
- `in-marion-parcels__a6ce08faadd0845d__query` (774,107 bytes): `fl:document:sha256-a6ce08faadd0845d29b1946a5a912cc3bc1c209b2e403260c3acd9964ef50734`
- `in-marion-parcels__73269f6d72d2f9fc__query` (779,139 bytes): `fl:document:sha256-73269f6d72d2f9fc802e3c9db173b8499da0d81be2fa95168f7d40e67c4c8e18`
- `in-marion-parcels__e59e41cc6e997bf2__query` (785,236 bytes): `fl:document:sha256-e59e41cc6e997bf2880b7d716aa13cab9d23161b9bdd7bccec9329d1542856ed`
- `in-marion-parcels__0577f4f34b0f5803__query` (782,969 bytes): `fl:document:sha256-0577f4f34b0f5803e9313dab46965b483e8ddf2a0d429e328eb609ee8100d05f`
- `in-marion-parcels__4aa2db60c33e2aa3__query` (673,543 bytes): `fl:document:sha256-4aa2db60c33e2aa3fe13a64b1cb5a05139cc7adb9129336966d48fa5ebdff814`

Command:

```
PYTHONPATH=python/src python3 -m factlot.registry.adapters.in_marion <21 page files in manifest order> registry.db --as-of 2026-11-03 --retrieved-at <manifest checked_at>
```

- Rows read: 20,866 polygons in 21 pages (all of class 300-499); 236 polygons share a parcel number with another.
- Parcels kept: **20,630** distinct commercial parcels (`B` 1,357, `F1` 15,498, `F2` 3,775).
- Facts written: 155,881. Seconds: 14.6. Invalid ids, errors, retired: 0, 0, 0.
- Organisation owners stored (current owner-of-record facts): 16,092; natural persons or withheld owners not stored (names not kept): 4,538.
- Ownership links to registered entities after `link_owners()`: 196 (the only entity registry in the scratch file is `ct-sos-entities`).

## Known gaps

- No year built, building area or roll year in the layer; `ASSESSORYEAR_*` are assessed (not market) values for the current assessment year.
- `FULLOWNERNAME` joins lines with a comma, so a name containing a comma that is not a company suffix keeps only its first segment (a person's "LAST, FIRST" becomes "LAST", which is dropped as a person anyway).
- Only the 300-499 classes were pulled; 4-unit apartments (code 401) are the publisher's multifamily class, so they are B though the registry's apartment threshold is 5+ units.
- Indiana's other counties are not covered; the statewide IndianaMap layer has no owners.

## Tier 1 audit (2026-11-06)

The 21 configured pages were collected again. The layer's count query returned **20,862** polygons of class 300–499 (20,626 distinct state parcel numbers). The 2026-11-03 load above was 20,866 polygons and 20,630 parcels. Kept on this retrieval: **20,626** (B 1,357, F1 15,496, F2 3,773). `--as-of` is **2026-11-06**, the retrieval date; the layer is described as updated nightly and its JSON has no editing date. Audit violations 0, person-like owner facts 0. Two parcels have a summed `ESTSQFT` over 500 million square feet; the audit warns and the figures were left as published. Evidence: [in-marion-parcels.md](../quality/audit-2026-11-06/in-marion-parcels.md) and [in-marion-parcels-audit.json](../quality/audit-2026-11-06/in-marion-parcels-audit.json). The item's "no restrictions on the use of Data" sentence, re-read the same day, is unchanged.
