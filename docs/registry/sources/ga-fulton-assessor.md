# ga-fulton-assessor: Fulton County, Georgia (Atlanta) Board of Assessors tax-digest parcels

Review record for the FactLot Registry source `ga-fulton-assessor` (FIPS 13121). Config:
`registry/sources/ga/ga-fulton-assessor.json`; adapter: `python/src/factlot/registry/adapters/ga_fulton.py`;
tests: `python/tests/test_adapter_ga_fulton.py`. Reviewed 2026-11-02. **`verified: false`** (licence
unclear, see "Gates").

## Publisher and URLs

- Publisher: Fulton County Board of Assessors (CAMA data), compiled and hosted by the Fulton County
  Department of Information Technology, GIS Division. The Assessors' own site (fultonassessor.org)
  answers 403 to the collector's user agent and was not used.
- Open-data site (ArcGIS Hub, org `fulcogis`, org id `AQDHTHDrZzfsFsB5`):
  https://gisdata.fultoncountyga.gov/ ; tax assessor page https://gisdata.fultoncountyga.gov/pages/taxassessor.
- Items (ArcGIS Online, `www.arcgis.com/sharing/rest/content/items/<id>?f=pjson`):
  - `c805da9aa51d4c508440358c00498fcf` **Tax Parcels 2025** (Feature Service,
    `services1.arcgis.com/AQDHTHDrZzfsFsB5/arcgis/rest/services/Tax_Parcels_2025/FeatureServer/0`,
    data last edited 2025-04-15; "represents the completed 2025 digest"). **This is the roll loaded.**
    Hub CSV export: `https://gisdata.fultoncountyga.gov/api/download/v1/items/c805da9aa51d4c508440358c00498fcf/csv?layers=0`
    → 302 → `https://hub.arcgis.com/api/v3/datasets/c805da9aa51d4c508440358c00498fcf_0/downloads/data?format=csv&spatialRefId=2240&where=1%3D1`
    (`Content-Disposition: Tax_Parcels_2025.csv`, Last-Modified 2025-06-24).
  - `e581a072dca9442e884d3682bff03484` **Tax Parcels** (the live layer; `TaxYear` 2027 work in progress,
    373,402 features on 2026-11-02) and `b50aaa86c4e143dbbfb7caa0ef980709` **Tax Parcels 2026**
    (created 2026-10-22, "the completed 2026 digest"): both **lack the value columns** (`TotAppr`,
    `TotAssess`, …) that the 2015–2025 annual layers carry, so they were not loaded.
  - `75e58855b00d40d7873975f22c24ba8f` **Tax_CAMA** (Document Link →
    `https://gis.fultoncountyga.gov/Data/OpenData/Data/Tax_CAMAData/TXT/Tax_CAMAInfo.zip`, 62,992,991 bytes,
    Last-Modified 2026-02-26): the Assessors' tabular CAMA extract for tax year 2025.
  - `fb12e4ed4fdd4b24bb93010818971261` **Property Profile** (Document Link →
    `https://gis.fultoncountyga.gov/Data/OpenData/Data/PropertyProfile/TXT/PropertyProfile.zip`, 27,781,653
    bytes, Last-Modified 2026-02-26): one tab-delimited table for tax year 2026.
- The same layer is also published as an ArcGIS Server map service
  (`gismaps.fultoncountyga.gov/arcgispub/rest/services/OpenData/Tax_Parcels/MapServer/0`), without values.

## Terms, license, robots

- Site item (`9a3d1c28277b43ef99acf5c790302e49`, "Fulton County, Georgia - Open Data"): `licenseInfo: "CC-BY-SA"`.
  The "Tax Parcels 2023" item (`f355d80f…`) states `CC BY-SA`.
- "Tax Parcels 2025" item `licenseInfo` (the operative sentence): _"Fulton County provides the data within
  these pages "as is". The data are not guaranteed to be accurate, correct, or complete."_ followed by a
  liability disclaimer; `accessInformation` is blank. The live "Tax Parcels" item says the same and credits
  "the Fulton County Department of Information Technology, GIS Division using data from the Fulton County
  Board of Assessors, GIS Division".
- Tax_CAMA and Property Profile items: _"Fulton County provides the data within these pages for your
  personal use "as is"."_ (then the same disclaimer).
- Statute: Georgia tax digests and assessment records are public records under the Georgia Open Records
  Act, O.C.G.A. § 50-18-70 et seq.
- AI use: not addressed anywhere. Redistribution: permitted with attribution under CC-BY-SA if the
  site-level licence governs; the item-level "personal use" wording on the two document items is the
  reason this source is not verified.
- robots.txt: `gisdata.fultoncountyga.gov` and `hub.arcgis.com`: `User-agent: *`, `Crawl-delay: 60`,
  `Disallow: /sites/ /admin/ /sessions/ /groups/ /people/ /workspace/` (downloads and item pages allowed;
  the collector waits 60 s between requests to those hosts). `gis.fultoncountyga.gov` and
  `gismaps.fultoncountyga.gov`: no robots.txt (404). `www.arcgis.com`: no rules. `services1.arcgis.com`:
  403 on robots.txt (feature-service statistics queries were used only to tabulate code frequencies).

## What the file contains

**`Tax_Parcels_2025.csv`** (Hub CSV export of layer 0; comma-separated, quoted, header row, UTF-8; one row
per parcel polygon). Columns, as the layer defines them: `OBJECTID, ParcelID, TaxYear, Address, AddrNumber,
AddrPreDir, AddrStreet, AddrSuffix, AddrPosDir, AddrUntTyp, AddrUnit, Owner, OwnerAddr1, OwnerAddr2, TaxDist,
TotAssess, LandAssess, ImprAssess, TotAppr, LandAppr, ImprAppr, LUCode, ClassCode, ExCode, LivUnits, LandAcres,
NbrHood, Subdiv, SubdivNum, SubdivLot, SubdivBlck, FeatureID, Shape__Area, Shape__Length`.

- `ParcelID` — the Board of Assessors parcel number, e.g. `17 006000010786`, `14 0135  LL0034` (land-lot
  form, double space); kept verbatim as `apn`/`account` (account system `fulton_parcel_id`); FactLot
  normalises it to `fl:parcel:us-13121:140135ll0034`.
- `Address` — situs street line only (no situs city or ZIP in the layer).
- `Owner` (255 chars), `OwnerAddr1`, `OwnerAddr2` — owner of record and mailing address. No
  confidentiality flag; `UNKNOWN`-type strings are treated as placeholders. The most frequent owners are
  governments and authorities (CITY OF ATLANTA, FULTON COUNTY, MARTA, development authorities).
- `TotAppr`/`LandAppr`/`ImprAppr` — appraised fair market value, whole dollars (369,010 of 369,847
  features have one); `TotAssess` etc. — the 40 % assessed value. The adapter stores `TotAppr` as both
  `market_value` and `appraised_value` (Georgia's appraised value _is_ the FMV; the 40 % figure is not
  stored). `LivUnits` living units; `LandAcres` acres → `land_area_sf` = acres × 43,560.
- `ClassCode` — the Georgia digest class: class letter + strata digit per Ga. Comp. R. & Regs.
  560-11-2-.21 (letters: A agricultural, B brownfield, C commercial, H historic, I industrial, J FLPA
  conservation use, P preferential, R residential, T residential transitional, U utility, V conservation
  use; Fulton also uses E exempt; strata 1 improvements, 2 operating utility, 3 lots, 4 small tracts, 5 large
  tracts, 6 production/storage/auxiliary, 9 other real). Fulton puts almost everything on the land stratum:
  2025 counts R3 328,533 · R4 9,432 · R5 1,124 · R1 112 · C3 15,246 · C4 2,608 · C5 917 · C1 263 ·
  I3 1,436 · I4 928 · I5 354 · I1 9 · E0–E9 10,486 · U1–U5 796 · A3–A5 314 · V3–V5 610 · H3 141 · J5 40 ·
  B1–B5 50 · blank 2.
- `LUCode` — the county's land-use code (232 distinct values in 2025). Three characters; the first is the
  use family, `x00` is the family's vacant-land code, `x99`/`999` are tie-back parcels. Descriptions come
  from the `LandUse` column of `PropertyProfile.txt`, joined on `ParcelID` for 4,819 parcels (the first
  rows of that file; the county publishes no code book). Observed codes:

  | Family                  | Codes seen (description as published, cut at 30 chars by the county)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | FactLot                                                            |
  | ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
  | 1 residential           | 100 Residential vacant · 101 Residential 1 family · 102 Residential 2 family · 103 Residential 3 family · 105 Commercial/Dwelling Conversion · 106 Single Family Residential Cond(o) · 107 …Town(home) · 109 Auxiliary Improvement · 110 …Loft · 111 Homeowner Association Property · 112 Agricultural-Improved · 113 Preferential Agricultural-Vaca(nt) · 166 Common Area - condominiums · 188 Homeowner Association Common A(rea) · 199 Residential under construction                                                                                                                                                                                                                                                                                                                                                                                                                                                   | out of scope                                                       |
  | 2 apartments and hotels | 200 Apartment Vacant Land · 201 Apartment/Dwelling Conversion · 206 Apt Lofts with Retail on First · 208 Co Ops Single Family Fee Simpl(e) · 211 Apartment - Garden (3 story &…) · 2A1 Apt Garden Class A · 2B0 Apt Mid Rise (4-10) Class B · 2B1 Apt Garden Class B · 2C1 Apt Garden Class C · 2D1 Apt Garden Class D · 2X0 Apt Mid Rise (4-10) Class X · 2X2 Apt High Rise Class X · 299 Apartment Land Tie Back; hotels/motels 250–257 (251 Luxury Hotel · 254 Luxury Budget Motel)                                                                                                                                                                                                                                                                                                                                                                                                                                     | **B** (apartments, on a C/I/R parcel); 25x → **F1**; 200/299 → out |
  | 3 commercial            | 300 Vacant Commercial Land · 301 Commercial/Dwelling Conversion · 318 Boarding-Rooming House · 319 Mixed Res/Comm(Built as Comm) · 320 Commercial Auxiliary Improveme(nt) · 321 Restaurant · 325 Franchise Food · 327 Bar/Lounge · 331 Auto Dealer · 332 Auto Service Garage · 336 Car Wash · 338 Parking Garage/Deck · 339 Parking Lot (Paved) · 343 Neighborhood Shopping Center · 344 Strip Shopping Center · 348 Convenience Food Market · 349 Medical Office Building · 351 Bank · 353 Office Building - Low Rise · 355 Office Condominium · 361 Funeral Home · 367 Social/Fraternal Hall · 369 Day Care Center · 371 Downtown Row Type · 373 Retail - Single Occupancy · 374 Retail - Multiple Occupancy · 392 Lumber Storage · 393 Auxillary improvement · 394 Warehouse (Distribution) · 396 Mini Warehouse · 398 Warehouse (bulk) · 399 Prefab Warehouse · 3A4/3B3/3B4/3C3/3X4 Office Bldg (High/Low Rise) Class… | **F1** on class C; **F2** on class I; 300 → out                    |
  | 4 industrial            | 400 Vacant Industrial Land · 401 Manufacturing/Processing · 443 Metal Working · 485 Land Fill · 499 Industrial Tie Back Land                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | **F2**; 400/499 → out                                              |
  | 5 taxable institutional | 520 Taxable Church,Synagogu,Mosque                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | F1 on class C                                                      |
  | 6 exempt                | 600 Vacant Exempt Land · 601 Cemetery · 610 Recreation/Health · 611 Library · 612 School · 613 College · 614 S/F Residential Institutional · 620 Churches… · 621 Church Parking · 625 Religious Mission · 630 Auditorium · 640 Hospital · 660 Police or Fire Station · 670 Correctional · 680 Cultural Facilities · 686 Housing for the Aged · 690 Rail/Bus/Air Terminal · 699 Improved Government Owned Exem(pt)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | out (class E)                                                      |
  | 7 utility               | 700 Utility Vacant Land · 701 Railroad · 702 Electric Utility · 710/711 Telephone                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | out (class U)                                                      |
  | 8 special               | 888 Economic Develpment/Public Hou(sing) · 889 Brownfield · 88R Economic Development - Retail                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | F1 only on class C                                                 |
  | 9                       | 999 Commercial Land Tie Back                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | out                                                                |

  Rule (`ga_fulton.state_category`): drop vacant (`x00`), tie-back (`x99`, `999`) and family-1 codes;
  family 2 except `25x` → `B` when the class letter is C, I or R (one R4/211 parcel exists); otherwise the
  parcel must be class C or I: class I or family 4 → `F2`, else `F1`. `local_use_code` = `ClassCode/LUCode`
  (e.g. `C3/2C1`, `I4/398`). Exempt (E), utility (U), agricultural (A), conservation (V, J), historic (H)
  and brownfield (B — Georgia's class B is _brownfield_, not multifamily) parcels yield no record.

**`Tax_CAMAInfo.zip`** (optional `--structures` input; tab-delimited, header row, CRLF, tax year 2025):
`Tax_ParcelSupplement.txt` (37 MB: site attributes — fronting, topography, parking, water, sewer),
`Tax_Sales.txt` (192 MB), `Tax_StructureApartment.txt` (`ParcelID, Card, Units, Bed, Bath, Half`; 10,119
rows), `Tax_StructureCommercial.txt` (`ParcelID, Card, YrBlt, ParkCover, ParkUncov, AreaSF, Busla`; 26,533
rows), `Tax_StructureResidential.txt` (37 MB). The adapter reads only `Tax_StructureCommercial.txt`:
`improvement_area_sf` = sum of `AreaSF` over a parcel's cards, `year_built` = `YrBlt` of the largest card
(zeros are not figures). The member list and headers were read from byte ranges of the zip; the whole file
could not be archived (see "Gates").

**`PropertyProfile.zip`** → `PropertyProfile.txt` (tab-delimited, header row, CRLF, ASCII, 149 MB, tax year
2026): `ID, ParcelID, Situs, Owner, MailAddr, ApprValue, ApprLand, ApprImpr, Assessed, FultonExmp, AtlExmp,
TaxDist, LandArea, PropClass, LandUse, ZoningClass, …, City, …, ZipCode, InLDCT, TaxYear, InQCT`. In the
first 4,821 rows every value column is blank (the 2026 digest was not yet valued when the file was cut) and
`Owner`, `MailAddr`, `PropClass` and `LandUse` are cut at 30 characters, so it is not loaded as a roll; it is
the only published source of the class and land-use descriptions above.

## Gates (anything that needs a person)

1. **Licence confirmation.** Decide whether the site-level CC-BY-SA governs the Tax Parcels data, or ask
   Fulton County GIS (the open-data site's contact) to confirm, given the "for your personal use" wording on
   the CAMA document items. Until then `verified: false`; the real run below used `--include-unverified`
   for evaluation only.
2. **Slow/stalling host.** `gis.fultoncountyga.gov` served the zips at 25–50 KB/s and stalled twice after
   7–9 MB (2026-11-02, evening US Central); the collector could not archive `Tax_CAMAInfo.zip` or
   `PropertyProfile.zip`. Retry off-peak (or ask the county for a mirror) to get year built and building
   area into the registry.
3. **Values for 2026/2027.** The county's 2026 and live layers publish no values; check whether a 2026
   layer with values appears (the 2015–2025 annual layers all have them) and bump the item id in the config.
4. The Assessors' own site (fultonassessor.org) refuses the collector's user agent (403). Nothing was fetched
   from it; if its "property data downloads" are needed, a person should look.

## Real run

**Not yet run on a real file.** On 2026-11-02 the shared connection was saturated and
`gis.fultoncountyga.gov` stalled, so no roll file was archived before hand-off. A detached collector run
for the Hub CSV (`config-csv-only.json` in the scratchpad, same source id, `--out collected`) was left
running; when it finishes, `collected/ga-fulton-assessor/manifest.jsonl` gains an `archived` line and the
file lands at `collected/ga-fulton-assessor/<sha16>/Tax_Parcels_2025.csv`. Then:

```
python -m factlot.registry.adapters.ga_fulton collected/ga-fulton-assessor/<sha16>/Tax_Parcels_2025.csv \
    registry.db --as-of 2025-06-24 --retrieved-at <manifest checked_at> [--structures collected/ga-fulton-assessor/<sha16>/Tax_CAMAInfo.zip]
```

What was measured on the live data instead (feature-service statistics queries, 2026-11-02): the 2025
layer has 369,847 features (369,010 with `TotAppr`); the live 2027 layer has 373,402. Applying
`state_category` to the live layer's 923 distinct non-residential (`ClassCode`, `LUCode`) pairs
(34,198 parcels) gives the expected scope: **B 3,090 · F1 12,838 · F2 1,919** (17,847 in scope), plus one
R-class apartment parcel (R4/211 in 2025); 16,351 non-residential parcels are out of scope (vacant,
tie-back, exempt, utility, agricultural, conservation, historic, brownfield, residential use on a
commercial lot). Facts, organisation-owner and timing counts and the snapshot document id are pending
the real run. The synthetic-fixture tests (`python -m unittest tests.test_adapter_ga_fulton`) pass.

## Known gaps

- No year built or building area until `Tax_CAMAInfo.zip` is archived (gate 2); `LivUnits` is not stored
  (no `ParcelRecord` field).
- No situs city or ZIP in the layer; `situs_address` is the street line only.
- The roll is the 2025 digest (as of 2025-06-24 export); the county's 2026 digest has no published values.
- Land-use descriptions were observed for about 130 of 232 codes (from the first 4,819 Property Profile
  rows); the family rule covers every code, and `local_use_code` keeps the raw pair for audit.
- Georgia has no owner-confidentiality flag in this file; `owner_confidential` is always False.
- Multifamily in Fulton's code book is any apartment code (family 2), which includes small garden
  complexes; the registry's "5+ units" line is not checkable from `LUCode` alone (`LivUnits` could refine
  it later).
