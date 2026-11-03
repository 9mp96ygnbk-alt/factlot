# ct-parcel-cama-layer: Connecticut (all 169 towns), commercial, industrial and apartment parcels from the OPM CAMA and Parcel Layer

Reviewed 2026-11-03. Machine-readable copy: [`registry/sources/ct/ct-parcel-cama-layer.json`](../../../registry/sources/ct/ct-parcel-cama-layer.json).
Adapter: `factlot.registry.adapters.ct_parcel_cama` (account system `ct_cama_link`, the town-and-CAMA-record link); tests
`python/tests/test_adapter_ct_parcel_cama.py`. Supersedes the licence gate of [ct-parcel-cama](ct-parcel-cama.md) (the Open Data CT table of the same data).

**Status: `verified: true`.** The Connecticut OPM GIS Office states CC0 on the layer's ArcGIS item.

## Publisher and URLs

- Publisher: Connecticut Office of Policy and Management (OPM), GIS Office; towns submit a parcel file and a CAMA report to their Council of Governments each year under C.G.S. 7-100l and OPM integrates them
  into one statewide format without modifying them (<https://portal.ct.gov/datapolicy/gis-office/parcel-and-cama>).
- ArcGIS Online item `82a733423a244c43a9d4bf552954cea9` "Connecticut CAMA and Parcel Layer" (owner `ctgisoffice`, modified 2026-10-13); feature service
  `https://services3.arcgis.com/3FL1kr7L4LvwA2Kb/arcgis/rest/services/Connecticut_CAMA_and_Parcel_Layer/FeatureServer/0` (`maxRecordCount` 2,000; 1,320,686 records for 169 towns, 2026 parcel
  collection joined to the 2026 CAMA collection). The OPM office also publishes the same layer as a WFS, a 2024 edition, a vacant-parcels layer and a parcel viewer.

## Terms, licence, robots

- **Terms.** The item's `licenseInfo` reads "CC0", and so do the same office's "Connecticut State Parcel Layer 2023", "Connecticut Public Use Parcels", "Connecticut Vacant Parcels" and "Parcel Viewer" items.
  The Open Data CT table of the same data has no licence field, and its portal terms are disclaimers only, which is why the first review gated it; the publisher's own CC0 statement on its ArcGIS items clears
  that. The records are the towns' grand lists, open to public inspection (C.G.S. 12-55). AI use is not addressed (CC0 does not restrict it). C.G.S. 1-217 (residential addresses of certain public officials)
  makes towns withhold protected persons' records; the layer carries no suppression column, so such owners are blank or absent upstream, and the registry stores organisation owners only and never tries to recover a
  withheld one.
- **robots.txt.** `services3.arcgis.com` serves none the collector read as rules; `www.arcgis.com` is used for the item JSON only.

## What the file contains

29 pages (`returnGeometry=false`, `OBJECTID` order, 2,000 features each) of the 57,855 records that have a building value and whose `State_Use_Description` contains one of 22 commercial words (a prefilter; the mapping
is in the adapter). Key columns: `CAMA_Link`, `Parcel_ID`, `Town_Name`, `FIPS`, `Location_1`, `Property_City`, `Property_Zip`, `Owner`, `Co_Owner`, `Mailing_Address`, `Mailing_City`, `Mailing_State`, `Mailing_Zip`,
`Appraised_Land`, `Appraised_Building`, `Appraised_Outbuilding`, `Assessed_Total`, `Valuation_Year`, `Land_Acres`, `AYB`, `State_Use`, `State_Use_Description`.

**`State_Use` is the town's own code and means different things in different towns** (the first review found `300` is Industrial in West Hartford and Manchester but Hotels elsewhere). The mapping therefore never uses
the code: `State_Use_Description` is reduced to a normal form (lower case, a town's model or vendor suffix such as `MDL-94`, `M-96`, `-96`, `C` removed) and looked up in `LABELS`, 155 descriptions whose own words say
commercial (98 -> F1), industrial or warehouse (25 -> F2) or apartment of five or more units (32 -> B). The statewide group-by of the layer has 3,740 distinct raw descriptions; the 69,547 rows whose words match a
commercial keyword fall into 673 normal forms; the 155 mapped forms cover 48,498 of those rows before the building-value test. Examples (statewide rows): `commercial` 22,686, `industrial` 6,522, `apartment` 1,831,
`store/shop` 1,697, `office bld` 1,061, `commercial improv` 857, `commercial improved` 818, `comm apts` 738, `apartments` 707, `commercial condo` 673, `retail` 638, `auto repr` 494, `comm whse` 471.

Not mapped: land and vacant descriptions (`Comm Land`, `Commercial Vacant`, `Vac Comm Lnd`, `Industrial Land`), exempt and municipal commercial (`Exempt Comm`), mixed use (`Mixed Use`, `Retail/Res`, `Res/Comm`),
residential with an apartment (`SFR w/Acc Apt`, `Apt 4-Unit`, `In-Law Apt`), `Multi Hses`, `Manufactured Home`, `Planned Community`, nursing homes, condominium-residential and every description outside the list. A record counts
only with `Appraised_Building` > 0 (18,140 of the 20,572 rows described `Commercial` have one).

The layer's `FIPS` is the town's 11-digit county-subdivision code with the **former county** in characters 3-5 (`09013526102`: Tolland, 013). Connecticut's counties were replaced by planning regions for Census purposes in 2022; the
former county is used as the county code here and the planning region is a founder decision (the first review planned `09110` for the Capitol Planning Region).

## Gates

None for the load. Decision for the founder: planning-region or former-county codes for Connecticut parcels (the former county is what the layer carries).

## Real run

`snapshot` on 2026-11-03 (29 pages), then `ct_parcel_cama.build` into the expansion registry:

```
python -m factlot.registry.adapters.ct_parcel_cama collected/ct-parcel-cama-layer registry.db --as-of 2026-11-03
```

- Pages: 29, 38,572,259 bytes archived (first page `fl:document:sha256-1f7ef2df98709a7070333a8fe8f51368b7c1965b2c59977bc9ab73dec7b789ef`); 57,855 rows, the publisher's count. One page (offset 46,000) first came back as an
  ArcGIS error body (`Cannot perform query. Invalid query parameters.`, HTTP 200, 151 bytes); it was removed from the scratch manifest and fetched again, and the same URL answered normally.
- Rows read: 43,398 CAMA records in scope after the building-value test and the label mapping. Parcels stored: **43,390** in 8 former counties: `B` 4,840, `F1` 31,424, `F2` 7,131 (the registry keys on letters and digits only, so 8 records whose `CAMA_Link` values differ only by punctuation share a key).
- Facts written: 394,018. Errors: none.
- Organisation owners stored: 34,022; natural persons or blank owners not stored: 9,375.
- Per former county (B / F1 / F2; parcels): Fairfield 001 1,111/6,420/1,073 (8,602); Hartford 003 1,547/7,203/2,817 (11,567); Litchfield 005 49/2,680/551 (3,280); Middlesex 007 177/1,790/498 (2,464);
  New Haven 009 1,035/8,660/1,589 (11,282); New London 011 426/2,309/227 (2,962); Tolland 013 168/1,077/206 (1,451); Windham 015 327/1,285/170 (1,782).

## Known gaps

- Mixed-use and "Comm Land" parcels with buildings are out; so are towns whose commercial description is not among the 155 forms (the forms were read from the layer's own group-by counts on 2026-11-03).
- Condominium units are separate CAMA records and separate parcels here (a commercial condominium building with 40 units is 40 parcels).
- `Appraised_*` is the town's appraised (100%) value; `Assessed_Total` (70%) is not stored. The layer has no commercial building area (it carries living and effective area for residential models).
- The `State_Use_Description` forms depend on this year's town vendors' text; a town that changes software changes its words.
