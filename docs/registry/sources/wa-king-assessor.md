# King County, Washington: Assessor data download (`wa-king-assessor`)

Review record for data policy §5. Reviewed 2026-11-02. **Not verified**: the download is behind a
click-through acknowledgement that only a person may accept, so no file was downloaded and no real
run was made. County FIPS 53033; account system `king_pin` (Major + Minor, 10 digits).

## Publisher and URLs

- Publisher: King County Department of Assessments (Seattle, WA).
- Landing page: <https://info.kingcounty.gov/assessor/DataDownload/default.aspx> ("Assessments Data
  Download"). An ASP.NET form; the file table is rendered only after the acknowledgement checkbox
  is ticked and the page posts back. The collector's `discover` fetched the page (HTTP 200) and
  found 0 links.
- Files the page would show (read from the page's hidden view state, not fetched), all dated
  10/30/2026, served from `http://aqua.kingcounty.gov/extranet/assessor/`:
  `Real Property Account.zip` (18,331 KB), `Parcel.zip` (31,206 KB), `Commercial Building.zip`
  (3,652 KB), `Apartment Complex.zip` (324 KB), `Lookup.zip` (16 KB); also Residential Building,
  Condo Complex and Units, Real Property Sales, Value History, Tax Data, Legal, Permit, Notes,
  Change History, Review History, Unit Breakdown, Vacant Lot, Accessory, District Levy Reference,
  Environmental Restriction, Home Improvement. Each has a `_tab` (tab-delimited) twin and a layout
  document at `http://info.kingcounty.gov/assessor/datadownload/desc/<name>.doc`.
- Open data portals checked for the same extracts: the Socrata portal `data.kingcounty.gov` has no
  assessor extract datasets (catalog API searched for "assessor", "real property", "parcel",
  "commercial building", "apartment complex"; only links to the eReal Property and Localscape
  sites, `Parcel2005`, `Property Legal Descriptions` and `Foreclosure parcels`). The GIS Hub
  (`gis-kingcounty.opendata.arcgis.com`) publishes `parcel_address_area` (633,340 polygons), a
  spatial join of the parcel polygons with `RPACCT_EXTR` and `PARCEL_EXTR` (present use, appraised
  values, lot sqft, levy code, tax year, address) but no taxpayer name and no building attributes;
  its Hub record says `license: none`, `openData: false`, and its ArcGIS REST service returned the
  Hub's HTML page to the collector's JSON requests. It is not this source.

## Terms, license, robots

- **Gate (quoted from the landing page):** "I acknowledge and agree to the prohibitions listed in
  RCW 42.56.070(9) against releasing and/or using lists of individuals for commercial purposes."
  The page also says: "I understand that Washington State law, RCW 42.56.070(9), prohibits the use
  of lists of individuals for 'commercial purposes.'" and defines commercial purposes as intending
  that "the list will be used for general business purposes, including but not limited to
  communicating with the individual(s) named in the record for the purpose of facilitating
  profit-expecting activity." (The statute is now RCW 42.56.070(8); the page cites the old number.)
- **Website terms of use** (<https://kingcounty.gov/en/shared-topics/about-king-county/website/terms-of-use>,
  linked from the page footer), "Restrictions on use": "The content of King County's websites, and
  apps including all text, graphics, compilations, data, and other documentation, is the property of
  King County and is protected by intellectual property law. You may not publish, display,
  distribute or commercially exploit any of the the website or app or the content therein without
  the prior written permission of King County." The same page states that county records "are
  generally available for public review" under chapter 42.56 RCW. Whether the data terms override
  the website terms for public-record extracts is a question for a person (see Gates).
- License: public record (RCW 42.56). No open-data license is stated for the extracts.
- AI use: not addressed by the publisher.
- Redistribution: unclear (website terms require written permission; public records are
  disclosable). Not verified.
- robots.txt: `info.kingcounty.gov` disallows only `/about/contact`; `aqua.kingcounty.gov` has
  none (404); `kingcounty.gov` disallows unrelated paths (`/cgi-bin`, language fallbacks, …);
  `data.kingcounty.gov` is the standard Socrata file (Crawl-delay 1, browse/search paths disallowed).

## What the file contains (layout, unconfirmed)

Nothing was downloaded, so the layout below is the Assessor's published extract description as known
to the author, not a confirmed read. Confirm every column name against the first real snapshot;
the adapter normalizes header names (lower case, no spaces or underscores) and finds each member by
file-name prefix, so small differences survive, but a renamed column yields `None` facts.

- `Real Property Account.zip` → `EXTR_RPAcct_NoName.csv`: `AcctNbr`, `Major`, `Minor`, `AttnLine`,
  `AddrLine`, `CityState`, `ZipCode`, `LevyCode`, `Status`, `BillYr`, `NewConstructionFlag`,
  `TaxValReason`, `ApprLandVal`, `ApprImpsVal`, `TaxableLandVal`, `TaxableImpsVal`. The public file
  is the "NoName" variant: **the taxpayer name is not published** (the coordinator's note that owner
  names are in this file needs confirming; the adapter reads a `TaxpayerName` column if one exists
  and otherwise records no owner). Mailing address lines are the taxpayer's; they are only used when
  a name is present. `market_value` = `ApprLandVal` + `ApprImpsVal` (Washington assesses at 100% of
  market value); `appraised_value` = `TaxableLandVal` + `TaxableImpsVal` (after exemptions);
  `tax_year` = `BillYr`.
- `Parcel.zip` → `EXTR_Parcel.csv`: `Major`, `Minor`, `PropName`, `PlatName`, `PlatLot`, `PlatBlock`,
  `Range`, `Township`, `Section`, `QuarterSection`, `PropType`, `Area`, `SubArea`, …, `PresentUse`,
  `SqFtLot`, then zoning, utilities, views, waterfront, nuisances and hazards. `PresentUse` is the use
  code (`local_use_code`); `SqFtLot` is the land area (0 → none). No situs address.
- `Commercial Building.zip` → `EXTR_CommBldg.csv`: one row per building: `BldgNbr`, `NbrBldgs`,
  `Address` and its parts (`BuildingNumber`, `Fraction`, `DirectionPrefix`, `StreetName`,
  `StreetType`, `DirectionSuffix`, `ZipCode`), `Stories`, `PredominantUse`, `YrBuilt`, `EffYr`,
  `BldgGrossSqFt`, `BldgNetSqFt`, …. Gross area is summed per PIN; the oldest `YrBuilt` is kept;
  the first building's address becomes the situs (`"<street>, WA <zip>"`; the extracts carry no city).
- `Apartment Complex.zip` → `EXTR_AptComplex.csv`: one row per complex: `ComplexDescr`, `NbrBldgs`,
  `NbrStories`, `NbrUnits`, `AvgUnitSize`, `YrBuilt`, `EffYr`, …, `Address` and parts. Used for the
  situs and year built; no gross area is published, and none is estimated from units.
- `Lookup.zip` → `EXTR_LookUp.csv`: `LUType`, `LUItem`, `LUDescription`. PresentUse is `LUType` 102.

### Use-code mapping

The numeric PresentUse codes could not be read from the publisher (the Lookup extract and its layout
document are behind the gate), so the mapping keys on the publisher's PresentUse **descriptions**,
read from the Lookup extract at run time; the code itself is stored verbatim in `local_use_code`.
Rules (`wa_king.category_for`, applied in order to the upper-cased description):

| FactLot | Rule on the Assessor's description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| out     | `Vacant(…)` of any kind; `Hist Prop(Residence)`; blank                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| B       | starts with `Apartment` (`Apartment`, `Apartment(Mixed Use)`, `Apartment(Co-op)`, `Apartment(Subsidized)`); `Rooming House`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| F2      | starts with `Industrial` or `Terminal(`; contains `Warehouse` (incl. `Mini Warehouse`, `Hist Prop(Loft/Warehouse)`); `Mining/Quarry/Ore Processing`; `High Tech/High Flex`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| F1      | starts with `Retail`, `Shopping Ctr`, `Restaurant`, `Parking(`, `Conv Store`, `Hist Prop(`; or is one of: Office Building, Medical/Dental Office, Bank, Hotel/Motel, Tavern/Lounge, Grocery Store, Gas Station, Service Station, Service Building, Auto Showroom and Lot, Bowling Alley, Car Wash, Daycare Center, Health Club, Movie Theater, Nursing Home, Post Office/Post Service, Rehabilitation Center, Residence Hall/Dorm, Retirement Facility, Sport Facility, Vet/Animal Control Srvc, Mini Lube, Hospital, Marina, Golf Course, Club, Fraternal Organization, Mortuary/Cemetery/Crematory, Greenhse/Nrsry/Hort Srvc, Shell Structure, Air Terminal and Hangers, Park, Private(Amuse Ctr), Art Gallery/Museum/Soc Srvc, Mobile Home Park, School(Private) |
| out     | everything else: single family, duplex to 4-plex, townhouse, mobile home, condominium units and complexes, churches, public schools, government, public utilities and parks, rights of way, easements, open space and current-use land, tidelands, reserves, farms                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |

Judgment calls to confirm with the founder: `Rooming House` as B; `Retirement Facility`, `Nursing
Home`, `Residence Hall/Dorm` and `Mobile Home Park` as F1 rather than B; `Terminal(…)` and `High
Tech/High Flex` as F2; churches and private clubs. `python -m factlot.registry.adapters.wa_king
<zips…> --check-lookup` prints how every description in the real Lookup extract maps, including the
ones no rule recognises, and should be read before the first load.

## Gates (needs a person)

1. **Click-through acknowledgement.** The file links appear only after ticking the RCW 42.56.070
   checkbox. The founder must decide whether FactLot can make that acknowledgement (the registry
   stores no natural-person names, which is the statute's concern, but the acknowledgement is a
   personal undertaking) and tick it. The collector will not.
2. **Redistribution.** The website terms of use forbid publishing or distributing site content
   without written permission. Either obtain written permission from King County (Department of
   Assessments, or KCIT for the website terms) or record a reasoned decision that public-record
   extracts obtained under RCW 42.56 are not "website content" for this clause. Until then
   `redistribution` stays unclear and the source stays `verified: false`.
3. After both: put the five file URLs in `files`, set `verified: true`, run `snapshot`, then run
   `--check-lookup` and confirm the column names in "What the file contains" against the real
   headers (and whether a taxpayer-name column exists at all).

### Terms read 2026-11-03 (gates pass)

This memo is research, not legal advice; the founder holds no attorney or real estate license.

Download acknowledgement, https://info.kingcounty.gov/assessor/DataDownload/default.aspx (read 2026-11-03). The box was not ticked.

> I understand that Washington State law, RCW 42.56.070(9), prohibits the use

> of lists of individuals for "commercial purposes."

> I acknowledge and agree to the prohibitions listed in RCW 42.56.070(9) against releasing

Website terms, https://kingcounty.gov/en/shared-topics/about-king-county/website/terms-of-use (read 2026-11-03):

> The content of King County’s websites, and apps including all text, graphics, compilations, data, and other documentation, is the property of King County and is protected by intellectual property law. You may not publish, display, distribute or commercially exploit any of the the website or app or the content therein without the prior written permission of King County.

Statute, RCW 42.56.070, https://app.leg.wa.gov/rcw/default.aspx?cite=42.56.070 (read 2026-11-03). Current numbering is (8), not the (9) printed on the acknowledgement.

> This chapter shall not be construed as giving authority to any agency, the office of the secretary of the senate, or the office of the chief clerk of the house of representatives to give, sell or provide access to lists of individuals requested for commercial purposes, and agencies, the office of the secretary of the senate, and the office of the chief clerk of the house of representatives shall not do so unless specifically authorized or directed by law:

Subsection (8) restricts lists of individuals requested for commercial purposes and is silent on other records. The website clause is not silent: it forbids publishing, displaying, distributing, or commercially exploiting website content, including data, without prior written permission. That is not compatible, on its face, with an open registry.

Letter: `../requests/wa-king-assessor-letter.md`, to the Public Records Officer at KSC-AS-0708, 201 S. Jackson St., Seattle, Washington 98104, email Assessor.Info@KingCounty.gov. The founder signs and sends it. Do not tick the box and do not download until the County answers.

## Real run

None. No file was downloaded (gate 1), so there are no counts, no facts, no organisation owners
and no snapshot document id. The adapter and its mapping are exercised only by the synthetic
fixture in `python/tests/test_adapter_wa_king.py` (7 tests). Collector evidence:
`collected/wa-king-assessor/discovered.json` (landing page `ok`, 0 links, 2026-11-03T01:08Z).

## Known gaps

- Layout unconfirmed (see above); the adapter's docstring says so.
- No owner of record is expected from the public "NoName" account file; if that is confirmed, the
  roll loads situs, use, areas, year built and values only, and owners would need the Assessor's
  full file (a public-records request, with the same lists-of-individuals limits) or another source.
- No situs city: the building extracts give the street line and ZIP only. Condominium PINs (and any
  parcel without a commercial-building or apartment-complex row) get no situs address.
- Apartment complexes have no gross building area in the Apartment Complex extract.
- `owner_confidential` is always false: the extracts carry no confidentiality flag; names are simply
  absent.
- The statute cited by the page is renumbered (RCW 42.56.070(8) today); the quoted text is as shown.
