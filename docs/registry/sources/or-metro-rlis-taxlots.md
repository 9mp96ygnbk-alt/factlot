# or-metro-rlis-taxlots: Metro RLIS Taxlots (Public), Multnomah County (41051), also Washington (41067) and Clackamas (41005)

Review record for the FactLot Registry (data policy §5). Reviewed 2026-11-03. Machine-readable copy:
[`registry/sources/or/or-metro-rlis-taxlots.json`](../../../registry/sources/or/or-metro-rlis-taxlots.json).
Adapter: `python/src/factlot/registry/adapters/or_metro_rlis.py` (account system `or_metro_account`, account
`<county FIPS>:<PRIMACCNUM>`); tests: `python/tests/test_adapter_or_metro_rlis.py`. Tier 2, west region
([`../tier2/west.md`](../tier2/west.md)).

## Publisher and URLs

- Publisher: Metro (the Portland-area regional government), Data Resource Center, which compiles the
  Regional Land Information System (RLIS). Contact on the item: drc@oregonmetro.gov, 503-797-1742.
- Dataset: "Taxlots (Public)", ArcGIS item `b3cabe5845ec47eab61c54e0c631313c`, feature service
  `https://services2.arcgis.com/McQ0OlIABe29rJJy/arcgis/rest/services/Taxlots_(Public)/FeatureServer`, layer 3,
  647,192 tax lots (Clackamas 163,936, Multnomah 283,139, Washington 200,117). Description: "County tax
  assessors tax lots with associated property data, excluding ownership information ... Date of last data
  update: 2026-07-17". RLIS Discovery page: <https://rlisdiscovery.oregonmetro.gov/datasets/b3cabe5845ec47eab61c54e0c631313c/about>.
  Layer metadata: <https://gis.oregonmetro.gov/rlis-metadata/#/details/3733>.
- Bulk file: <https://rlisdiscovery.oregonmetro.gov/api/download/v1/items/b3cabe5845ec47eab61c54e0c631313c/csv?layers=3>
  answers `302` to `hub.arcgis.com/api/v3/datasets/b3cabe5845ec47eab61c54e0c631313c_3/downloads/data?format=csv&spatialRefId=2913&where=1%3D1`,
  which answers `200 text/csv`, `Transfer-Encoding: chunked`, filename `Taxlots__(Public).csv`. It ignores `Range`
  (a ranged request is dropped with an empty reply), and its `Last-Modified` was 2026-02-19, earlier than the layer's
  July update, so the cached export may be stale. The shapefile edition "Taxlots (Public) - Download" (item `9d3c396f...`)
  is the alternative Metro recommends for speed.

## Terms, license, robots

- ArcGIS item `licenseInfo`: "This database and GIS data are made available under the RLIS Open Database End User
  License Agreement. See https://rlisdiscovery.oregonmetro.gov/pages/open-database-license." The layer's FGDC
  metadata repeats it and adds: "The information in this file was derived from digital databases on Metro's GIS. Care
  was taken in the creation of this file. Metro cannot accept any responsibility for errors, omissions, or positional
  accuracy. There are no warranties, expressed or implied."
- The license page HTML is an application shell. The agreement text was read 2026-11-06 from public ArcGIS Hub
  item `43a73dbe46e644a9a8204afc4cbeb525` (revised February 2023). It is Metro's own RLIS Open Database End User
  License Agreement, not the Open Database License (ODbL). It grants a limited, revocable license to copy, publish,
  and adapt the data; it prohibits sublicensing; and it does not license rights to the individual contents of the
  database. It says its terms are compatible with CC BY 4.0 and the Open Data Commons Attribution License, not ODbL.
  FGDC metadata id 3733 says the product contains information copyrighted by Clackamas County. The earlier ODbL label
  came from search results and is withdrawn. `verified` is false until a person decides whether derived facts can be
  carried. The cited load counts below are not deleted.
- robots.txt: `rlisdiscovery.oregonmetro.gov` and `hub.arcgis.com` both `Crawl-delay: 60`, disallow `/sites/`, `/admin/`,
  `/sessions/`, `/groups/`, `/people/`, `/workspace/`; the download API is allowed. `services2.arcgis.com` has none.

## What the file contains

UTF-8 (BOM) CSV, one row per tax lot or right-of-way polygon, header row of field names:
`TLID, PRIMACCNUM, ALTACCNUM, SITEADDR, SITECITY, SITEZIP, BLDGSQFT, A_T_ACRES, YEARBUILT, PROP_CODE, LANDUSE, TAXCODE,
SALEDATE, SALEPRICE, COUNTY, X_COORD, Y_COORD, JURIS_CITY, GIS_ACRES, STATECLASS, ORTAXLOT, LANDVAL, BLDGVAL, TOTALVAL,
ASSESSVAL, FID, AREA, HAS_MANY, Shape__Area, Shape__Length` (the live layer adds `PUBLIC_OWN` and `OWNERTYPE`, a public/private
flag, not a name). `COUNTY` is `C`, `M` or `W`. `PRIMACCNUM` is the county's account number (Multnomah: the property ID,
`R` plus digits). `TOTALVAL` is real market value (`LANDVAL` + `BLDGVAL`), `ASSESSVAL` the assessed value. Features
without a `PRIMACCNUM` (rights of way and similar polygons; 1,140 of the 120,096 sample rows) are dropped.

**There is no owner of record**, by Metro's design: "Tax lot ownership information is excluded from the open data but is
available for business or organizational activity with payment of a one-time data access fee" (RLIS Discovery, as
quoted by search results; the fee page was not opened).

### Use-code table mapped

`PROP_CODE` is the Oregon Department of Revenue property class, "populated from PROPCLASS (Multnomah County)" and its
Clackamas and Washington equivalents; the layer metadata lists all codes (the descriptions below are from it). First digit:
1 residential, 2 commercial, 3 industrial, 4 tract, 5 farm, 6 forest, 7 multiple-family, 8 miscellaneous, 9 exempt. Last digit:
0 vacant, 1 improved, 2 condominium, 3 state responsibility, 6 waterfront vacant, 7 manufactured structure (park), 8 land
only, 9 manufactured structure.

| Rule in the adapter                                                                                                    | Category     | Multnomah lots (live layer, 2026-11-03) |
| ---------------------------------------------------------------------------------------------------------------------- | ------------ | --------------------------------------: |
| `2x1`, `2x2` (201, 211, 212, 221, 231, 232, 271, 202)                                                                  | F1           |                                  16,195 |
| `3x1`, `3x2`, and `303` (DOR appraised industrial)                                                                     | F2           |                                      77 |
| `7x1`, `7x2` (701, 702, 711, 712, 721, 722, 731, 781, 782)                                                             | B            |                                   4,355 |
| every other code (vacant `x00`, land-only, manufactured `x07`/`x17`..., residential `1xx`, farm, forest, exempt `9xx`) | out of scope |                                 262,512 |

`LANDUSE` (`COM`, `IND`, `MFR`, ...) is not used: it labels residential condominiums (`102`) `MFR`, and Multnomah has
9,278 `MFR` lots in the 30 MB sample against 1,025 improved `7xx` lots.

## Gates

None for the download itself: no account, login, click-through, fee or CAPTCHA. For a person:

1. Decide whether derived registry facts can be carried under the February 2023 RLIS end-user agreement (no sublicensing,
   individual database contents not licensed, revocable, Clackamas copyright noted in the metadata). This is not an ODbL question.
2. Confirm `202` ("Commercial, vacant, condominium" in Metro's list) is an improved commercial condominium in Multnomah (832 lots). The adapter treats `x02` as improved.
3. Owners: Multnomah County's Division of Assessment, Recording and Taxation sells data files on a fee schedule (a
   county-wide general property data report, land characteristics, improvement characteristics and values, tax bill
   summary; application with a check, revised July 2024, <https://multco.us/file/141334/download>, read only through search
   result summaries). Metro sells ownership for a one-time fee. Either is a purchase and is for a person.

## Real run (2026-11-03)

The full CSV has no length header and ignores `Range`, and the layer holds 647,192 features, so the sample is the first
30 MB of the streamed export (cut at the last complete row; the full file belongs to the weekly workflow). The sample was
loaded into a scratch registry outside the repository:

```
python -m factlot.registry.adapters.or_metro_rlis or_rlis_prefix.csv scratch.db --as-of 2026-07-17
```

- Sample (document `fl:document:sha256-6e49ca4bd00ee2c740a535c4b588fb15bf61442be7a07a5621323efcc5470177`, 29,999,938 bytes):
  rows read 118,956 with an account number (120,096 CSV rows); kept 7,394 (Multnomah 4,391: F1 3,358, B 1,025, F2 8;
  Washington 1,667: F1 1,357, B 292, F2 18; Clackamas 1,336: F1 869, B 168, F2 299); out of scope 111,562; invalid 0;
  facts written 57,304; organisation owners 0 (no owner column); 2 s.
- Expected size of a full Multnomah load: 20,627 parcels (live-layer counts above).

## Full load (2026-11-03)

Release `data-2026-11-03-41603209834` (draft, maintainers only) of `9mp96ygnbk-alt/factlot`. Each asset's sha256 was checked against the manifest and its first 16 hex characters against the name. Loaded into the Tier 2 scratch registry (one SQLite file shared by every Tier 2 source, `ct-sos-entities` first).

Assets (document id from the manifest):

- `or-metro-rlis-taxlots__650b169684cc2530__Taxlots__.Public.csv` (162,431,724 bytes): `fl:document:sha256-650b169684cc25302a65245e0186d8bc9e54cac64936054ad1705cdfe054139d`

Command:

```
PYTHONPATH=python/src python3 -m factlot.registry.adapters.or_metro_rlis <csv> registry.db --as-of 2026-07-17 --retrieved-at <manifest checked_at>
```

- Rows read: 645,882 data rows (the whole three-county Portland metro layer, 644,742 with an account number); out of scope 610,614.
- Parcels kept: **34,128** distinct commercial parcels (`B` 6,388, `F1` 26,087, `F2` 1,653).
- By county:
  - Multnomah (FIPS 41051): 20,618 parcels (`B` 4,331, `F1` 16,210, `F2` 77); organisation owners 0; ownership links 0.
  - Clackamas (FIPS 41005): 6,085 parcels (`B` 911, `F1` 3,707, `F2` 1,467); organisation owners 0; ownership links 0.
  - Washington (OR) (FIPS 41067): 7,425 parcels (`B` 1,146, `F1` 6,170, `F2` 109); organisation owners 0; ownership links 0.
- Facts written: 261,146. Seconds: 17.3. Invalid ids, errors, retired: 0, 0, 0.
- Organisation owners stored (current owner-of-record facts): 0; natural persons or withheld owners not stored (names not kept): 0. The layer has no owner column.
- Ownership links to registered entities after `link_owners()`: 0 (the only entity registry in the scratch file is `ct-sos-entities`).
- Tier 2 covers Multnomah only; Clackamas and Washington parcels come with the same file and are loaded and counted above (ODbL share-alike applies to all of them; see Terms).

## Known gaps

- No owner of record, so no entity linking for Multnomah (or any RLIS county) without a purchased owner file.
- `SALEDATE`/`SALEPRICE` are on the layer; they are recorded sale prices and are not read (the policy does not
  infer prices, and the field's provenance is not documented).
- No tax year column; `as_of` is the layer's "last data update". The Hub export may lag it.
- Condominium units are separate tax lots, so a building can appear as many records.
