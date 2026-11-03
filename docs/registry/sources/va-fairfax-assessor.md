# va-fairfax-assessor: Fairfax County, Virginia real estate assessment tables

Reviewed 2026-11-02. Status: **not verified (license unclear: the publisher's disclaimer grants
reproduction for "internal or personal use" only)**. Config:
[`registry/sources/va/va-fairfax-assessor.json`](../../../registry/sources/va/va-fairfax-assessor.json);
adapter `python/src/factlot/registry/adapters/va_fairfax.py` (FIPS 51059, account system
`fairfax_parcel_id`), run on the real tables (see "Real run").

## Publisher and URLs

- Publisher: Fairfax County Department of Tax Administration (DTA); the tables are extracted daily
  from the DTA system and published by the Fairfax County Department of Information Technology
  GIS Division on its ArcGIS Hub, <https://data-fairfaxcountygis.opendata.arcgis.com/>
  (the county's "GIS Data" site; `data.fairfaxcounty.gov` does not resolve).
- Datasets (Hub item id → title; all owner `FX.AuthData`, all "Data Accessibility: Publicly
  Available", "Update Frequency: Daily", last revision 9/1/2026):
  - `e336c76bcfef407cbbcf0b3fb053b43f` Tax Administration Real Estate **Parcels Data**
    (<https://data-fairfaxcountygis.opendata.arcgis.com/datasets/Fairfaxcountygis::tax-administration-real-estate-parcels-data/about>)
  - `9072b5a0c8bb43f5a465d91b528ed255` … **Legal Data**
  - `3654d54d471e408cb7ac52799650d832` … **Assessed Values**
  - `f706e51c2616437e8f83c2a5822296ab` … **Land Data**
  - `b997cdc349e846338070726ef5ce89ec` … **Commercial Data**
  - not used: `8be946f0995241be92212f04d55d531e` Sales Data, `da6bb6ab92d44a80ba1e77dd32a0f3cb`
    Dwelling Data, `d89d210fe4b140f5887093f349f70bfc` Dwelling Addition Data.
- Feature services: `https://services1.arcgis.com/ioennV6PpG5Xodq0/arcgis/rest/services/Tax_Administration_Real_Estate_<Name>/FeatureServer/0`
  (tables, `maxRecordCount` 2000; the collector's `discover` lists all eight).
- Confirmed download URLs (Hub CSV export, one per table):
  `https://data-fairfaxcountygis.opendata.arcgis.com/api/download/v1/items/<item id>/csv?layers=0`.
  Each answers `302` to
  `services1.arcgis.com/…/FeatureServer/replicafilescache/<name>_<n>.csv`, which answers `302` to a
  time-limited (about one hour) Azure blob URL under `*.az.arcgis.com`, which serves the CSV
  (`application/octet-stream`, no `Content-Disposition`). The archived file is therefore named
  `csv`; the adapter tells the five tables apart by their headers.
- Data dictionary: <https://www.fairfaxcounty.gov/maps/sites/maps/files/assets/documents/dta_assessment_tables.pdf>
  (`dta_assessment_tables.pdf`, 9 pages, one per view: GIS_ADDNALL, GIS_ASMTALL, GIS_COMDATALL,
  GIS_DWELDATALL, GIS_LANDALL, GIS_LEGDATALL, GIS_PARDATALL, GIS_SALESALL; column, description,
  type, sample value).

## Terms, license, robots

- Each dataset's license field says only: "Please review the Fairfax County GIS Division
  disclaimer" (<https://www.fairfaxcounty.gov/maps/disclaimer>). The disclaimer's operative
  sentences (read 2026-11-02):

  > The geographic data layers produced by the Government of Fairfax County, Virginia ("Fairfax
  > County"), and any associated maps and applications, are provided as a public resource. While
  > every reasonable effort is made to ensure the accuracy and completeness of the data, Fairfax
  > County makes no warranties, expressed or implied, concerning the accuracy, completeness or
  > suitability of its data, and it should not be construed or used as a legal description.

  > Copyright by Fairfax County. Except as provided herein, all rights are reserved. Authorization
  > to reproduce material for internal or personal use by any user of this information is granted
  > by Fairfax County, the copyright owner.

  That grants internal or personal use and reserves everything else, so redistribution of the
  tables in an open registry is **not clearly permitted**. Real estate assessment records are
  public records in Virginia (Va. Code § 58.1-3122.2 requires localities to make assessment records
  available; the Virginia FOIA, § 2.2-3700 et seq.), and facts are not copyrightable, but the
  decision to publish facts derived from these tables needs a person (or a question to the county:
  GIS Division, 703-324-2712). Hence `verified: false`.

- AI use: not addressed. Redistribution: not granted by the disclaimer (see above).
- robots.txt:
  - `data-fairfaxcountygis.opendata.arcgis.com`: `User-agent: *`, `Crawl-delay: 60`, disallows
    `/sites/`, `/admin/`, `/sessions/`, `/groups/`, `/people/`, `/workspace/`. The download and
    search API paths are allowed; the collector honours the 60-second delay (one request a minute).
  - `services1.arcgis.com`: `/robots.txt` answers `403 Invalid URL` (no rules; the collector treats
    4xx as allowed). The Azure blob host answers `409 PublicAccessNotPermitted` for `/robots.txt`
    (same treatment). Both are reached only by redirect.
  - `www.fairfaxcounty.gov` (disclaimer and data dictionary): standard Drupal rules, allows the
    pages read.

## What the file contains

Five CSVs (field names as headers; `OBJECTID` first), all keyed by `PARID`, the tax-map parcel
identifier (`0072 01  0021A`: map, double-circle, parcel, with padding that the adapter squeezes
to single spaces, `0072 01 0021A`). Counts from the live services on 2026-11-02:

| Table                         | Rows                                   | Tax year | Columns used                                                                                     |
| ----------------------------- | -------------------------------------- | -------- | ------------------------------------------------------------------------------------------------ |
| Parcels Data (`PARDATALL`)    | 370,697 (one per PARID)                | 2027     | `LUC_DESC` land use type description, `LIVUNIT`                                                  |
| Legal Data (`LEGDATALL`)      | 369,893                                | 2027     | `ADRPRE ADRNO ADRADD ADRDIR ADRSTR ADRSUF ADRSUF2`, `CITYNAME`, `ZIP1`, `SQFT`, `ACRES` (deeded) |
| Assessed Values (`ASMTALL`)   | 369,572                                | 2026     | `APRTOT` (also `APRLAND`, `APRBLDG`, prior-year `PRI*`), `TAXYR`, `FLAG4_DESC`                   |
| Land Data (`LANDALL`)         | 372,432 (one per land line `LLINE`)    | 2027     | `SF`, `ACRES` (fallback when the legal table has no area)                                        |
| Commercial Data (`COMDATALL`) | 12,256 (one per improvement `ELEMENT`) | 2027     | `YRBLT` (min per parcel), `BUSLA` usable business sf (sum per parcel)                            |

- **No owner names.** None of the eight Tax Administration tables has an owner column (checked
  field by field). Fairfax County shows owners per parcel on its Real Estate Assessment site but
  does not publish them in bulk. Every record therefore has `owner_name=None`,
  `owner_confidential=False` (absent, not withheld), and `link_owners()` has nothing to match.
- **Land use code.** The published column is `LUC_DESC`, the _description_ of the county's land
  use code; the numeric code itself is not in any table and the data dictionary gives no code
  list. The adapter keys its mapping on the description text (165 distinct values on 2026-11-02,
  listed from the service with `returnDistinctValues`) and stores the description verbatim in
  `local_use_code`. The mapping, with the publisher's strings:

  | FactLot      | Fairfax `LUC_DESC`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
  | ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | B            | `Apartment, NEC including cooperatives`; `Garden Apartments rental ( =<4 story)`; `Medium rise apartments rental(5to8 stry)`; `High rise apartments rental(=>9  comm)`; `High rise apartments rental(=>9 no comm)`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
  | F1           | offices (`Low Rise Office(< = 4 stories)`, `General med/hi rise off (= > 5 stories)`, `Cluster Office (< = 4 stories)`, `Condo office (= > 5 stories)`, `Condominium Office (< = 4 stories)`, `Office Park`, `Medical office (= > 5 stories)`, `Med/dental med/hi rise(= > 5 stories)`, `Medical/dental low rise (< = 4 stories)`, `Condominium Medical (< = 4 stories)`, `Converted Residential office(exdwelling)`, `Other office NEC`); retail and centers (`Department Store`, `Discount Store`, `Drug stores`, `Supermarket`, `Supermarket plus general merchandise`, `Convenience grocery`, `Other food NEC (include fruit,meat,fish)`, `Apparel and accessories`, `Furniture, house furnishings`, `Building Materials,Hardware, Farm Equip`, `Other Retail NEC(not in shopping center)`, `Condo Retail (in office/Indust complex)`, `Comm Use in Res Condo Dev`, `Neighborhood Center`, `Community Center`, `Regional Center`, `Super Regional Center`, `Specialty Center`, `Promotional Center`, `Town Center`, `Condo Center`); lodging and food (`Hotel with/without restaurant & other comm`, `Motel with/without restaurant & other comm`, `Restaurant with/without alcohol`, `Carry-out Kitchen`, `Carry-out with seating`); automotive (`Gasoline and Service Station`, `Gasoline Sale Only`, `Gasoline Sales and Car Wash`, `Service Station out of operation`, `Motor vehicle repair separately`, `Motor vehicle sales (new and used)`, `Other automotive,marine,aircraft and NEC`, `Auto parking`); services and care (`Personal services (laundry,photo,beauty)`, `Finance,insurance,real estate services`, `Other consumer/business services NEC`, `Other repair services NEC`, `Veterinary hospitals`, `Hospital & Health Facilities`, `Nursing homes`, `Retirement homes & orphanages`); other (`Mini-Warehouses (not in IP)`, `Golf Courses (commercial)`, `Other cultural & entertainment NEC`, `Permanent Exhibition`) |
  | F2           | `Durable Manufacturing (not in Ind Park)`; `Nondurable Manufacturing(not in IP)`; `Nondurable Manufacturing(in clust/notIP)`; `Industrial conglomeration`; `Planned industrial park`; `Other Industrial NEC`; `Wholesale,warehousing & stg (not in IP)`; `Whsle,wrhsing & stg (not in IP/in condo)`; `Research & Testing(not in IP/not in off)`; `Research & Testing(not in IP/in condo)`; `Printing & Publishing`; `Contract Construction (not in IP)`; `Contract Construction (notinIP/in condo)`; `Motor frieight transportation` (sic); `Sand & Gravel Quarrying`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
  | out of scope | single-family, townhouse, duplex, multiplex and condominium classes (including `Townhouse in rental development` and `Multiplex in rental development`, which are per-lot parcels with blank `LIVUNIT` on the live service), `Mobile homes in park or court`, `Vacant Land`, agricultural/forestry/horticulture, conservation and open space, water areas, utilities and rights of way, rail/air/bus/marine terminals, government, military, schools and colleges, churches, cemeteries, public recreation, `Public Assembly`, civic associations, `Welfare & Charitable services`, `Private Schools`, `Golf Courses (private)` and `(government-owned)`, `Swimming pools`, `Improved Land w dilapidated structure`, `Combination of Structure types`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |

- Values: Virginia assesses at 100 % of fair market value (Va. Code § 58.1-3201), so `APRTOT`
  is written as both `market_value` and `appraised_value`; `tax_year` is the Assessed Values
  `TAXYR` (2026; the other tables already show the 2027 roll year).
- Situs: `ADRPRE ADRNO[ADRADD] ADRDIR ADRSTR ADRSUF ADRSUF2, CITYNAME VA ZIP1` (a one-letter
  suffix joins the number, `100A`; a fraction keeps its space, `7 1/2`). No street name → no situs.
- Land area: legal `SQFT`, else legal `ACRES` × 43,560, else the Land Data lines summed.
  Improvement area and year built come from Commercial Data only (residential dwellings are out of
  scope anyway). `0` and blank mean "no figure" and yield `None`.
- Provenance: each of the five files is registered as a snapshot; facts cite the Parcels Data
  table's document id with locator `Parcels Data PARID <id>`.

## Gates (anything that needs a person)

1. **License decision.** The disclaimer authorises reproduction for internal or personal use only.
   Decide whether facts derived from these public assessment records may be published in the open
   registry, or ask Fairfax County GIS / DTA for a statement. Until then `verified: false`; the
   scratch run below used `--include-unverified` for internal evaluation only, which the
   disclaimer permits. Nothing from it is published.
2. **Owner names.** Not published in bulk. If owners of record are wanted, ask DTA whether a bulk
   owner file is available (Virginia FOIA request; owner names are public assessment information
   under § 58.1-3122.2) or accept a roll without owners.

## Real run

**Not completed at the time of this record.** On 2026-11-02 the collector's `discover` read both
landing pages (`ok`, 8 links: the eight feature services) and `snapshot --include-unverified`
began archiving the five tables, but the download was still in progress when the review had to be
written (about 10 MB of the first 59 MB table after four minutes; the Hub's 60-second crawl delay
and shared bandwidth make a five-table run take well over 30 minutes). No count below is from a
real file; the row counts in "What the file contains" are from the live feature services
(`returnCountOnly` / statistics queries), which is the same data the CSV export is cut from.

To finish the run once `collected/va-fairfax-assessor/manifest.jsonl` has five `archived` lines:

    python3 -I /private/tmp/claude-501/-Users-rs-Projects-FactLease/fb297270-1bc8-428b-aed7-1276b3addaee/scratchpad/scripts/run_va_scratch.py <scratch.db>

(or `PYTHONPATH=python/src python3 -m factlot.registry.adapters.va_fairfax collected/va-fairfax-assessor <db> --as-of 2026-11-02`, then
`Registry(db).link_owners()`), and record here: rows read per table, parcels kept by category,
facts written, organisation owners (expected 0: no owner column), seconds, and the Parcels Data
snapshot document id. `link_owners()` is expected to return all zeros for this source because it
has no owner-of-record facts; the adapter's synthetic test (`python/tests/test_adapter_va_fairfax.py`,
`test_build_registry_from_the_snapshot`) confirms the build path end to end.

## Known gaps

- No owner of record, so no entity links and no `ownership.*` facts from this source.
- The county's numeric land use code is not in the published tables; the mapping is on the
  description text and will need updating if the county reword a description (`state_category`
  then returns `None` and the parcel drops out of scope rather than being misfiled).
- Condominium office/retail/medical units are kept as F1 (each unit is a parcel); condominium
  apartment units are not B (per-unit residential parcels).
- `LIVUNIT` is not used for scope; B is the publisher's rental-apartment classes regardless of
  unit count.
- Tax-exempt status (`FLAG4_DESC`) is not mapped; exempt-owned commercial parcels stay in scope.
- The Hub's 60-second crawl delay makes a five-table refresh take about six minutes; the files
  are refreshed daily by the county, so a weekly archive is plenty.
