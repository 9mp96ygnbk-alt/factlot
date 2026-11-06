# ca-san-francisco-assessor — San Francisco County, California (FIPS 06075)

Review record for the Assessor-Recorder's secured property tax roll as published on DataSF.
**Result: free, PDDL-licensed, `verified: true`; adapter written and run on the 2025 roll year (2025-26
fiscal year).** Config: `registry/sources/ca/ca-san-francisco-assessor.json`. Adapter:
`python/src/factlot/registry/adapters/ca_san_francisco.py` (account system `sf_parcel`). Tests:
`python/tests/test_adapter_ca_san_francisco.py`. Reviewed 2026-11-02.

## Publisher and URLs

- Publisher: City and County of San Francisco, Office of the Assessor-Recorder (inventory ID `ASR-0001`),
  published through DataSF (Socrata). The portal moved from `data.sfgov.org` to **`data.sf.gov`**
  (`data.sfgov.org` answers with a redirect page).
- Dataset: "Assessor Historical Secured Property Tax Rolls", id `wv5m-vpq2`,
  https://data.sf.gov/d/wv5m-vpq2. One row per parcel per roll year, 2007 to 2025 (19 roll years,
  197,778 to 213,531 rows each; **2025 has 211,547 rows**). Updated annually after the roll closes
  (rows last updated 2026-06-26; `data_as_of` of every 2025 row is 2026-06-26). The 2026 roll was not yet
  in the dataset on 2026-11-02, so the latest roll year is 2025. (The dataset's own description still
  says "through June 30, 2024".)
- File in `files`: the SODA CSV endpoint
  `https://data.sf.gov/resource/wv5m-vpq2.csv?$select=<23 columns>&$where=closed_roll_year=2025 AND property_class_code in(<73 in-scope class codes>)&$order=row_id&$limit=300000`.
  Change `closed_roll_year` for a new roll. **It is an extract:** the unfiltered stream of the full roll
  repeatedly stalled and dropped partway on the review machine's network (three attempts, the collector process
  ended at 4 to 20 MB each time), so the collector archives only the in-scope property classes
  (20,612 of 211,547 rows, 5.5 MB) with a 23-column projection of the 46 columns. The class list is the
  one in the adapter; if the adapter's class sets change, change the URL too.
- Reference tables (also Socrata, same licence): use and property class codes `pa56-ek2h` (145 rows),
  exemption codes `g77e-ikb4`, assessor neighbourhoods `dx7g-zwbx`.

## Terms, license, robots

- Licence: the dataset's own metadata state `licenseId: "PDDL"`, `license.name` "Open Data Commons Public
  Domain Dedication and License", `termsLink` http://opendatacommons.org/licenses/pddl/1.0/. Operative
  sentence of the PDDL grant (section 3.3(a), read at opendatacommons.org): "The Licensor grants to You a
  worldwide, royalty-free, non-exclusive, licence to Use the Work". The dataset has no attribution
  requirement and no AI clause. Warranty: "The Office of the Assessor-Recorder makes no representation or
  warranty that the information provided is accurate and/or has no errors or omissions."
- DataSF's terms of use page (https://www.sf.gov/reports--april-2017--datasf-terms-use, plus
  https://www.sf.gov/terms-of-use) answers automated requests with an empty HTTP 202 (a CDN challenge),
  so its text was **not read directly**. A search-engine summary says it contains a PDDL section and
  attribution is welcome but not required. The licence rests on the dataset metadata and the PDDL text;
  a person should read the sf.gov page once (data policy §5) but nothing found conflicts.
- AI use: permitted (PDDL; nothing restricts it). Redistribution: permitted. → `verified: true`.
- robots.txt (`data.sf.gov`): `User-agent: * / Crawl-delay: 1`; disallows only `/browse?...`, `/page/...`,
  `/catalog/...` and `/facet/...` query-string variants, `/login`, `/OData.svc/`, `/api/odata/`,
  `/api/collocate*`, `/tiles/`, and a clustered-rows path. `/resource/` and `/api/views/` are allowed. The
  collector's 2-second spacing is used.

## What the file contains

Header row, quoted CSV, UTF-8. The archived file has these 23 columns (the full dataset has 46, adding
bedrooms, bathrooms, rooms, basement area, lot depth and frontage, construction type, lot code, tax rate
area, exemption fields, misc and homeowner exemption values, neighbourhood and supervisor-district fields
and the point geometry):

| Column                                                                                | Use                                                                                                           |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `closed_roll_year`                                                                    | leading year of the fiscal year the value applies to → `tax_year` (2025)                                      |
| `parcel_number`, `block`, `lot`                                                       | block + lot, 7 to 9 characters (`0012003A`) → `apn` and `account` (crosswalk `sf_parcel`)                     |
| `property_location`                                                                   | fixed-width situs string, 36 or 37 characters → `situs_address` (see the adapter docstring for the positions) |
| `use_code`, `use_definition`, `property_class_code`, `property_class_code_definition` | the Assessor's use group and class → category and `local_use_code` (`COMR/C1`)                                |
| `year_property_built`, `number_of_units`, `number_of_stories`, `zoning_code`          | `year_built` (0 or blank = none); units used to decide the unbanded multifamily classes                       |
| `property_area`, `lot_area`                                                           | building and lot square feet → `improvement_area_sf`, `land_area_sf` (0 = none)                               |
| `assessed_land_value`, `assessed_improvement_value`                                   | summed → `appraised_value` (Proposition 13 assessed value, **not market value**; `market_value` stays empty)  |
| `assessed_fixtures_value`, `assessed_personal_property_value`                         | read, not used                                                                                                |
| `status_code`                                                                         | `NA` taxable, `L` senior lien taxable, `N` non-taxable/government owned, `S` SBE assessed                     |
| `current_sales_date`, `row_id`, `data_as_of`                                          | `row_id` (`YYYYMMDD` of Jan 1 of the roll year + parcel number) is the fact locator                           |

**There are no owner names** in this dataset (the Assessor-Recorder publishes none here), so the registry
gets no owner-of-record facts from it, and no `owner_confidential` marker exists to map.

**Use-code table** (publisher reference dataset `pa56-ek2h`, read 2026-11-02; `use_code` / class code and
class definition). Mapping used:

- **B** (multifamily, 5 or more units), use code `MRES`: `A5` Apartment 5 to 14 units; `A15` Apartment 15
  units or more; `DA5`, `DA15` Dwellings - Apt 5 to 14 / 15+; `DD5`, `DD15` 2 Dwellings on 1 Parcel 5 to
  14 / 15+; `F5`, `F15` Flats 5 to 14 / 15+; `FA5`, `FA15` 1 Flat & 1 Apt - 1 Parcel 5 to 14 / 15+; `FS5`,
  `FS15` Flat & Store 5 to 14 / 15+; `OA5`, `OA15` Office and Apartments 5 to 14 / 15+; `TIC5` TIC Bldg 5
  to 14; `TI15` TIC Bldg 15+. Also, **only when `number_of_units` is 5 or more**: `CO` Coop Units
  Unsegregated, `DCON` Legal Multi-Family Con to SFR, `DF` 1 Flat & Dwelling-1 Parcel, `F2` Flat & Store,
  `FA` 1 Flat & 1 Apt Bldg-1 Parcel, `TIA` TI Apartment, `XV` Single Struct on Multi Lot.
- **F1** (commercial): use `COMR`: `B` Bank, `BZ`, `C` Commercial Stores, `C1` Shopping Center, `CD`
  Department Stores, `CM` Commercial/Mixed use, `CZ` Commercial Store Condo, `CZEU`, `EC` Entertainment
  Complex, `OC` Office with Major Retail Units. `COMO`: `O`, `O35`, `OAH`, `OAL`, `OAM`, `OAT`, `OBH`,
  `OBL`, `OBM`, `OCH`, `OCL`, `OCM` (office classes A/B/C), `OMD` Medical-dental Office, `OZ` Office
  Condominium, `OZEU`. `COMH`: `H`, `H1`, `H2`, `HC` Hotels, `M` Motels, `RH` Residential Hotel & SRO,
  `RH1` Retail & Hotel. `COMM`: `AC` Apartment & Commercial Store, `G`, `GG` Garages (Commercial), `GZ`,
  `GZEU` Garage Condominium, `GC` Golf Course, `N1` Hospitals, `N2` Convalescent/Nursing Homes, `PL`
  Parking Lot, `PZ` Parking Stall Condominium, `S` Gas Station, `T` Theatres.
- **F2** (industrial), use `IND`: `I` Industrial, `IDC` Data Center, `IW` Warehouse, `IX` Mixed/Other
  Use, `IZ` Industrial Condominium.
- **Out of scope** (no record): every `SRES` class (dwellings, condominiums `Z`, townhouses, live/work);
  `MRES` classes of 4 units or less (`A`, `DA`, `DD`, `F`, `FS`, `OA`, `TIC`, `TIF`) and unbanded ones
  under 5 units; all `…G` government classes and `GOVT` (`CP`, `P`, `PI`, `Y`...); vacant land
  (`MISC`: `V`, `VCI`, `VR`, `VA15`...); schools `E`, churches `W`, clubs `U`, timeshares `TS*`, police,
  fire and library stations, `CONG` Consulate, `LE35`, `MB`, `TDR`, `UWL`, `X`. A code not in the table
  yields no record. Parcels with `status_code` `N` or `S` are dropped even in an in-scope class.
- Judgement calls open to revisiting: `AC` (apartment over store) is F1 because the Assessor
  files it under commercial; `RH` residential hotels and SROs are F1 for the same reason; parking stall
  condominiums (`PZ`, 366 parcels) are kept as commercial parcels.

## Gates (need a person)

None for the data. One housekeeping item: read the DataSF terms page on sf.gov in a browser (it refused
the collector), per data policy §5.

### Platform terms read 2026-11-03

DataSF terms of use, <https://www.sf.gov/reports--april-2017--datasf-terms-use> (HTTP 200, read 2026-11-03; matches the browser capture in the gates working file). Full notes: [`../requests/platform-terms/datasf.md`](../requests/platform-terms/datasf.md).

> Except where otherwise stated in the file containing such Data or on the page from which such Data is accessed, including its metadata, Data is made available under the Public Domain Dedication and License v1.0 whose full text can be found at: http://www.opendatacommons.org/licenses/pddl/1.0/

> You hereby understand and agree that You will not take any measures to re-identify the Data or to contact individuals whose information is represented by the Data.

Section II.A says downloading or using the Data or a Derivative Work is treated "as an acceptance of the Terms of Use from that point forward", and section VII.B requires indemnity for use "including without limitation Your use of the Data in a Derivative Work."

Read: the terms do not restrict redistribution. The data are dedicated under PDDL v1.0 unless the file or its page says otherwise (none was seen for `wv5m-vpq2`). The binding conditions are no re-identification and no contacting individuals (the registry keeps no natural-person names and this dataset has no owner names) and an indemnity. This clears the housekeeping item above. Downloading counts as acceptance under II.A.

## Real run

- `discover` (landing page `https://data.sf.gov/api/views/wv5m-vpq2.json`): `ok`, 0 links (the file URL
  is built from the dataset id).
- `snapshot`: one file archived, `collected/ca-san-francisco-assessor/cfc5b9425b25ef2b/wv5m-vpq2.csv`,
  5,459,319 bytes, retrieved 2026-11-03T01:48:05Z (2026-11-02 evening US Central), `Last-Modified`
  2026-06-26. Snapshot document id
  **`fl:document:sha256-cfc5b9425b25ef2be1038e3b606d15da221360fef4721da26c7f66d720bd8124`**.
- Rows read: **20,612** (all `closed_roll_year` 2025, no repeated parcel number, 36 or 37 character situs
  strings). Dropped by the adapter: 278 with `status_code` N (248) or S (30); 1,286 unbanded multifamily
  rows with fewer than 5 units (`CO` 1,008, `TIA` 124, `FA` 55, `DF` 49, `F2` 34, `XV` 15, `DCON` 1).
- `python -m factlot.registry.adapters.ca_san_francisco <file> registry.db --as-of 2026-06-26
--retrieved-at 2026-11-03T01:48:05+00:00` (scratch registry, not committed): **seen 19,048, kept 19,048**,
  skipped out of scope 0, skipped invalid 0, retired 0, **facts written 165,677**, 3.8 seconds.
- Parcels kept by category: **B 9,068; F1 7,870; F2 2,110**. Largest classes: `MRES/A5` 5,884, `COMR/C`
  2,722, `MRES/A15` 2,414, `IND/I` 1,774, `COMO/O` 1,240, `COMR/CZ` 1,106.
- Facts by predicate: apn, situs address, category, local use code and tax year 19,048 each;
  appraised value 19,035; year built 18,092; improvement area 16,820; land area 16,490.
- Organisation owners: **0**, by construction (no owner names in the dataset). Spot check: parcel
  `0010001` (COMR/C1) → F1, 2801 LEAVENWORTH ST, assessed 10,546,659 + 15,819,989 = 26,366,648.

## Zoning (added 2026-11-04)

The roll's `zoning_code` is the zoning district the Assessor-Recorder records for the parcel, written without hyphens (`RM1`,
`C3O`, `NC3`, `M1`; the Planning Code writes `RM-1`, `C-3-O`, `NC-3`). The adapter now writes it, as published, as the parcel's
`zoning.district` (`public_record`, cited to the roll row, PDDL rights as the roll); `NA` (no code) writes nothing. It is the
Assessor's attribute, not a zoning verification: the Planning Department's zoning map is the authority. Scratch registry
(re-ingested with this change from the archived 2026-06-26 extract): 16,874
of 19,048 parcels (88.6%) with a district (`RM1` 1,644; `RH3` 1,630; `RH2` 1,423; `NC3` 1,275; `NC2` 1,159; `RC4` 919; `M1` 913;
`RM2` 910); the other 2,174 are `NA`. SF Planning's own zoning-district polygons (DataSF) were not used.

## Known gaps

- No owner names, so no owner graph from this source; the registry's owner-of-record needs another
  source (the Recorder's deed records are not in this dataset).
- No situs ZIP; the city is written as SAN FRANCISCO, CA because the county is the City and County of
  San Francisco. Unit numbers are in `property_location` only for condominium-type parcels.
- Values are Proposition 13 assessed values; there is no market value or sale price (`current_sales_date`
  exists but is not mapped).
- The archived file is a class extract, not the whole roll year, so a parcel that leaves the in-scope
  classes is not retired (`full_roll` is off by default). A full-roll download from a faster connection
  would allow retirement; use `--full-roll` only with an unfiltered file.
- The SODA export is slow (about 50 KB/s for the unfiltered stream) and sometimes closes the connection;
  re-run `snapshot` if a run is cut short.
- Only roll year 2025 was collected. Earlier years are in the same dataset (`closed_roll_year`) for
  history later; the 2026 roll should be added when the Assessor-Recorder next loads the dataset (it updates once a
  year after the roll closes); re-run with `closed_roll_year=2026` then.
