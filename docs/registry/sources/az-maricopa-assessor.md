# az-maricopa-assessor: Maricopa County Assessor (Phoenix, Arizona; FIPS 04013)

Review record for the FactLot Registry (data policy §5). Reviewed 2026-11-02.
Config: `registry/sources/az/az-maricopa-assessor.json`. Adapter:
`python/src/factlot/registry/adapters/az_maricopa.py`. Account system `maricopa_apn`.

## Publisher and URLs

- Publisher: Maricopa County Assessor's Office, 301 W Jefferson St, Phoenix, AZ 85003.
  Data inbox: AssessorDataSales@maricopa.gov, 602-506-3769.
- Landing page: https://mcassessor.maricopa.gov/page/data_sales/ ("Data Downloads"). It lists
  eleven data files and five spatial files, each linking to an item on the county's ArcGIS Hub
  (https://data-maricopa.opendata.arcgis.com/datasets/<id>/about). The Hub pages are rendered by
  JavaScript, so the collector reads the ArcGIS item JSON instead
  (`https://www.arcgis.com/sharing/rest/content/items/<id>?f=json`, owner `MaricopaAssessorGIS`).
- Files (confirmed on 2026-11-02 by HEAD requests, byte-range downloads and, for the Apartment
  Master, the collector's archive; all served by www.arcgis.com with a `Content-Disposition` file
  name and a 302 to a signed S3 URL):
  - Secured Master, item `936bbba512bf4c368618cc6e79e64668` → `Secured_Master.zip`, 109,092,436
    bytes, item modified 2026-10-26. "Updated twice a month."
  - Commercial Master, item `12ce08cf4d264f9d97bb7ef4d6eb9944` → `Commercial_Master.zip`,
    26,815,873 bytes, modified 2026-09-18.
  - Apartment Master, item `0b5770a1b73f4637b8f92f088465890b` → `Apartment_Master.zip`, 359,535
    bytes, modified 2026-10-02.
- Layout documents (also inside each zip):
  https://mcassessor.maricopa.gov/file/data_sales/R1170_SecuredMaster_FileLayout.pdf,
  `R1209_CommercialMasterFULL_Layout_ST42090.pdf`, `R122_ApartmentMaster_Layout_ST42100.pdf`
  (same folder). `api.mcassessor.maricopa.gov` resets connections from the collector; the main host
  serves the same paths.
- Use-code definitions: Arizona Department of Revenue, _Property Use Code Manual_
  (https://azdor.gov/sites/default/files/2023-03/PROPERTY_useCodeManual.pdf, revised 2011-02-07),
  which the Assessor's glossary names as the statewide code list; legal classes from the
  Department's _Property Classification_ and _2027 Property Class Summary_ publications
  (https://azdor.gov/business/property-tax/property-tax-publications).

## Terms, license, robots

- Terms: the Data Downloads page states "Disclaimer – Indemnification: User understands and agrees
  that Maricopa County does not guarantee the accuracy of the data and information requested …
  User accepts responsibility for unauthorized use or transmission of any such data or
  information in its actual or altered form." The FAQ: "All data files available on the Data
  Downloads page are free to download" and "If the data you need is already available on the
  Data Downloads page, you can download it directly without submitting any request form.
  However, if you plan to use the information for a commercial purpose, you are responsible for
  complying with all applicable Arizona laws that govern the commercial use of public records."
- License: none stated. The ArcGIS Hub items carry `license: custom` whose text is the same
  disclaimer ("CAUTION! USERS SHOULD INDEPENDENTLY RESEARCH AND VERIFY INFORMATION WITHIN THIS
  DATASET OR MAP BEFORE RELYING ON IT …"). The data are public records under A.R.S. Title 39,
  chapter 1. Attribution: Maricopa County Assessor's Office (the items' `accessInformation`).
- Commercial use: A.R.S. § 39-121.03 requires a person who obtains a public record for a
  commercial purpose to state that purpose; the Assessor's _Data Sharing_ page quotes subsection
  (C): "A person who obtains public records for a commercial purpose without indicating the
  commercial purpose … shall … be liable … for damages in the amount of three times the amount
  which would have been charged". The Assessor provides a _Commercial Purpose Public Record
  Request_ form (FOR-025,
  https://mcassessor.maricopa.gov/file/data_sales/Commercial-Purpose-Public-Record-Request.pdf)
  that names the company, its business, the records, and the purpose, signed and sent to
  AssessorDataSales@maricopa.gov. The registry's use is arguably commercial under (D)(3) ("any
  purpose in which the purchaser can reasonably anticipate the receipt of monetary gain").
- Redistribution: not addressed for the free downloads. The 2002 _Data Sharing with Other
  Governmental Agencies_ policy forbids commercial distribution, but it governs data given to
  other agencies, not the public downloads.
- AI use: not addressed.
- robots.txt (2026-11-02): `mcassessor.maricopa.gov` disallows `/mcs/`, `/mcs/?*` and `/?*` (the
  search) only; `data-maricopa.opendata.arcgis.com` sets `Crawl-delay: 60` and disallows `/sites/`,
  `/admin/`, `/sessions/`, `/groups/`, `/people/`, `/workspace/` (not `/datasets/`);
  `www.arcgis.com` has `User-agent: *` with no rules. The collector honours the crawl delay.
- County site terms (https://www.maricopa.gov/124/Site-Terms-Privacy-Policy): a warranty
  disclaimer for the county web site; nothing on reuse.

## What the file contains

### Secured_Master.zip

`Data/Secured_Master_BK100.txt` … `BK500.txt` (one pipe-delimited file per parcel-book series,
header row, CRLF, no quoting; uncompressed 171 / 124 / 104 / 7 / 81 MB, about 1.75 million rows in
all) and `File Spec/Secured Master.pdf` ("Secured Master (by Book series) File Specification
Sheet", revised 2023-02-02, 39 columns). The file's header spells the columns `FolioKey|OwnerName|
MailingAddress1|…|PUC|…|LandClass|ImprvClass|RentalInd|LivingArea|TotalSqFt|ConstrYear|…|NumUnits|
TaxAreaCode`; the adapter reads by position under the spec's names. (The older R1170 "Premium
Secured Master" layout on the Assessor's site, 83 columns and no header, is not what the Data
Downloads file uses.)

| Spec column (file header)                                           | Use                                                                                               |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| 1 `Parcel_Number` (`FolioKey`)                                      | 8–9 character APN `BBBMMIIIS`; stored hyphenated `177-07-015B` as the Assessor displays it        |
| 2 `Owner_Name`                                                      | owner of record; joint owners joined with `/`                                                     |
| 3–8 `Owner_Mail_*`                                                  | mailing address; `Owner_Mail_Country` is an ISO-3 code (`USA`, `CAN`, `DEU` …)                    |
| 9–12 `Situs_Address`, `Situs_Suite`, `Situs_City`, `Situs_Zip_Code` | situs; the street line already carries the unit; ZIP blank for 12 % of kept parcels               |
| 13 `Property_Type`                                                  | `RESIDENTIAL`, `COMMERCIAL`, `VACANT` (every kept parcel is `COMMERCIAL`, apartments included)    |
| 19 `Total_Full_Cash_Value` (`FCV`)                                  | → `market_value`                                                                                  |
| 21 `Limited_Property_Value` (`LPV`)                                 | → `appraised_value` (the taxable basis since 2015, capped at 5 % growth)                          |
| 23 `Property_Use_Code` (`PUC`)                                      | 4-digit Arizona PUC → category; kept in `local_use_code`                                          |
| 27, 28 `Land_Class`, `Improvement_Class`                            | legal class with proportion (`100% 1.12`, `60% 2.R; 40% 1.12`); recorded here, not used for scope |
| 30 `Living_Area`                                                    | residential living area (0 for commercial parcels)                                                |
| 31 `Total_Square_Feet` (`TotalSqFt`)                                | land area in square feet (filled for vacant land and commercial parcels alike) → `land_area_sf`   |
| 32 `Construction_Year`                                              | → `year_built`                                                                                    |
| 38 `Number_Of_Units`                                                | dwelling units (filled for 84 of the 87 apartment parcels in the sample)                          |

Also present, not used: deed number / date / type, assessed values, lot / block / tract,
`Rental_Indicator`, pool size, last sale price and date, MCR number and subdivision name, tax
area code. No tax year column; the file is "for the current tax year".

### Commercial_Master.zip

`Data/Commercial_Master.txt` (header row of generic `Column 0` … `Column 1471` labels) and the
R1209 spec: one row per commercial improvement **and occupancy**, 32 fixed columns (`Parcel Book`,
`Map`, `Item`, `Split Letter`, `Improvement ID`, `Occupancy Number`, …, `Total Floor Area`,
`Construction Year`, …) followed by 120 repeating 12-column component groups. The adapter sums
`Total Floor Area` once per improvement per parcel and takes the earliest `Construction Year`.

### Apartment_Master.zip

`Data/Apartment_Master.txt` (header row, 39 columns as in the R122 spec, 3,332 economic units) and
the spec: `LeadParcel`, `Complexname`, `PUC`, unit mix, `TotalFloor`, `ConstrYear`, `NumUnits`,
situs and owner. The adapter takes the floor area (and a year, if the Secured Master has none)
by lead parcel. Its PUCs run 0310–0390: duplexes to fourplexes (032x–034x) are listed there too,
which the registry leaves out.

### Use-code mapping (Department of Revenue _Property Use Code Manual_)

The PUC's first two digits are the general use, the third a subcategory, the fourth a detail
(Assessor glossary; manual pp. 1–8). Sections and codes, from the manual:

| PUC                                                                                                                                                                                                                                                           | Manual section                                                                                                                                                                                                                                                                                                                                                                                                               | Registry        |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| 035x, 036x, 037x                                                                                                                                                                                                                                              | Multiple residential: apartments 5–24, 25–99, 100 or more units                                                                                                                                                                                                                                                                                                                                                              | B               |
| 031x–034x, 038x, 039x                                                                                                                                                                                                                                         | Mixed complex, duplex, triplex, fourplex, boarding house, cooperative                                                                                                                                                                                                                                                                                                                                                        | out of scope    |
| 04xx, 05xx, 06xx                                                                                                                                                                                                                                              | Hotels, motels, resorts                                                                                                                                                                                                                                                                                                                                                                                                      | F1              |
| 10xx                                                                                                                                                                                                                                                          | Miscellaneous commercial (laundromats, misc. commercial, private fire stations, retail nurseries, 10-7 "associated parcel", private prisons)                                                                                                                                                                                                                                                                                 | F1              |
| 11xx–27xx                                                                                                                                                                                                                                                     | Convenience markets / retail strips / supermarkets; store combined with other uses; department stores; shopping centers; office buildings; banks; service stations / auto repair; vehicle sales / leasing / storage; care facilities; restaurants / bars; hospitals / medical; race tracks / air fields / animal boarding; cemeteries / mortuaries; golf courses; theaters / amusement; parking facilities; clubs and lodges | F1              |
| 29xx                                                                                                                                                                                                                                                          | Privately-owned schools                                                                                                                                                                                                                                                                                                                                                                                                      | F1              |
| 89xx                                                                                                                                                                                                                                                          | Converted-use property (to office, retail, restaurant, services, care, medical or other commercial use)                                                                                                                                                                                                                                                                                                                      | F1              |
| 30xx                                                                                                                                                                                                                                                          | Industrial properties (multi-use industrial, manufacturing, special-purpose plants, food, lumber, co-generation, mining / quarrying / processing, packing)                                                                                                                                                                                                                                                                   | F2              |
| 37xx                                                                                                                                                                                                                                                          | Industrial warehouses (warehousing, truck terminals, mini-storage, office/retail warehouses, warehouse condominiums, cold storage)                                                                                                                                                                                                                                                                                           | F2              |
| 31xx–36xx, 38xx–39xx                                                                                                                                                                                                                                          | Unassigned in the industrial range (none seen)                                                                                                                                                                                                                                                                                                                                                                               | F2              |
| 28xx                                                                                                                                                                                                                                                          | Partially complete structures, 28 + the finished use: 2804–2827, 2829, 2833 → F1; 2830, 2831, 2837 → F2; 2803 (multiple residential, unit count unknown) and the rest out                                                                                                                                                                                                                                                    | by finished use |
| 00xx vacant, 01xx single family, 02xx PUD common area, 07xx condominiums / townhouses, 08xx manufactured-home land, 09xx salvage, 40xx–49xx agricultural, 50xx–69xx centrally valued, 70xx–86xx personal property, 87xx–88xx, 90xx–99xx exempt and government |                                                                                                                                                                                                                                                                                                                                                                                                                              | out of scope    |

Note on 1074 ("associated parcel"): the Assessor codes land that serves a commercial parcel
(parking, retention, yard) this way; 563 of the sample's 3,529 F1 parcels carry a 10xx code and
most of those are 1074, often with legal class 2.R and no improvement value. They stay in scope as
commercial-use parcels; a consumer wanting improved property only can filter on
`improvement_area_sf` or the value facts.

Legal classes on the kept parcels (sample of 221,444 rows): F1 is 81 % `1.12` (commercial real
property, assessment ratio 15 %), then `2.R` (vacant / agricultural land), `1.9` (golf courses),
`1.8` (shopping centers), `4.5` (licensed care institutions), `4.1`–`4.3`; F2 is `1.12`, `2.R`
(quarries) and `1.10` (manufacturers); B is `4.2` (rental residential) and `4.1`. The class is not
used for scope because a rented house is also class 4.2 and a motel can be class 1.12.

## Gates (anything that needs a person)

1. **Commercial-purpose statement (A.R.S. § 39-121.03).** The download itself is free, needs no
   account, login, click-through or fee, and the collector fetched the files without any gate.
   But Arizona law makes a person who obtains public records for a commercial purpose without
   stating it liable for treble charges, and the Assessor's FAQ puts compliance on the user. The
   founder should complete the Commercial Purpose Public Record Request form (FOR-025) naming the
   registry's purpose and send it to AssessorDataSales@maricopa.gov before the Maricopa facts are
   published, then set `verified: true`. Nothing was sent to the publisher by this review.
2. Nothing else: no CAPTCHA, no agreement, no fee for the Data Downloads files (fees apply only to
   custom and mailed requests on the Service Fees page).

## Real run

Full download not completed. The collector (`snapshot --include-unverified`, 2026-11-02, manifest
`collected/az-maricopa-assessor/manifest.jsonl`) fetched `Secured_Master.zip` from www.arcgis.com
at about 1 MB per minute (the host was shared with other downloads running at the time), and the
read timed out after 6 MB (`error: The read operation timed out`); `Commercial_Master.zip` then
answered `Connection reset by peer`; `Apartment_Master.zip` was archived (359,535 bytes,
`fl:document:sha256-11cdc1596c74c0ed150de54d718d9fcfa6ff9825913ce75f7c59331a478a9bf8`, ETag
`1a0fd592528`, at `collected/az-maricopa-assessor/11cdc1596c74c0ed/Apartment_Master.zip`). Rather
than wait an hour or more, the adapter was run on a **real sample** assembled from byte-range
requests to the same Secured and Commercial Master URLs (HTTP 206; the zip's central directory was
read first to find the members):

- `Data/Secured_Master_BK400.txt` complete (28,303 rows: every parcel in books 400–499) and the
  first 3 MB (compressed) of each of `BK100`, `BK200`, `BK300`, `BK500`, cut at the last whole line
  (46,216 / 45,980 / 51,299 / 49,646 rows), 221,444 rows in all, about 12.7 % of the file by bytes;
- the first 3 MB (compressed) of `Commercial_Master.txt` (35,280 rows, 14,055 parcels);
- `Apartment_Master.zip` complete (3,332 economic units; the same bytes the collector archived,
  sha256 `11cdc159…`).

The sample zip's document id below is the id of that assembled sample, not of the publisher's file;
the publisher's `Secured_Master.zip` sha256 will come from the collector manifest when the full
snapshot completes.

Run (`as_of` 2026-10-26, `tax_year` 2027, with the Commercial and Apartment samples):

| Measure                                                   | Count                                                                                 |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Rows read (Secured Master sample)                         | 221,444                                                                               |
| Parcels kept                                              | 3,863: F1 3,529, B 87, F2 247                                                         |
| Parcels out of scope (not yielded)                        | 217,581                                                                               |
| Skipped invalid / retired                                 | 0 / 0                                                                                 |
| Facts written                                             | 40,425                                                                                |
| Owner-of-record facts (organisations)                     | 3,206                                                                                 |
| Owners that are natural persons (name not stored)         | 657; withheld 0                                                                       |
| With construction year                                    | F1 2,879, B 87, F2 176                                                                |
| With floor area (from the Commercial / Apartment samples) | F1 347, B 84, F2 16 (the Commercial sample covers a sixth of that file)               |
| Seconds                                                   | read 3.3, ingest 3.0 (the full file, 8× larger, should take under a minute)           |
| Snapshot document id (assembled sample)                   | `fl:document:sha256-92600f7026096ebd2f2bcb6b1b9ad320de536274496251febb2c861c8f5e03f7` |

Kept parcels by PUC prefix: 10 (563), 11 (572), 15 (1,089), 21 (383), 24 (249), 20 (166), 19 (126),
17 (92), 14 (55), 16 (48), 26 (36), 18 (30), 29 (25), 04 (20), 27 (16), 12 (13), 28 (13 F1 + 7 F2),
05 (12), 25 (7), 06 (6), 13 (4), 23 (3), 22 (1); 037 (70), 036 (8), 035 (9); 37 (139), 30 (101).
No 89xx, 31xx–36xx or 38xx–39xx codes appeared in the sample.

Scaled to the whole file (1.75 million rows), expect roughly 30,000 parcels in scope.

## Known gaps

- `verified: false` until the commercial-purpose statement is filed (gate 1); the collector
  needed `--include-unverified` for this review's snapshot.
- The full `Secured_Master.zip` has not yet been archived by the collector (slow host); re-run
  `snapshot` off-peak and then the adapter on the archived file for the whole-county counts.
- Commercial floor area only for parcels in the Commercial Master (one row per improvement; the
  sample covered a sixth of it); 18 % of kept parcels have no construction year.
- No tax year in the file; the adapter records what the caller passes (`--tax-year`).
- Withheld owners: A.R.S. § 11-484 lets eligible persons (judges, peace officers, victims …) have
  their names redacted from the Assessor's public records. The file carries no marker for this;
  such parcels presumably show a blank or substitute name, so `owner_confidential` is never set
  from this source.
- Contract sales (`OWNERSHIPTYPE` `CS`): the adapter records `OWNERSNAME` (the contract
  purchaser) and ignores `FEESNAME` (the fee owner).
- The Hub `about` pages cannot be read as landing pages (JavaScript); if the Assessor moves the
  items, re-read https://mcassessor.maricopa.gov/page/data_sales/ for the new item ids.
