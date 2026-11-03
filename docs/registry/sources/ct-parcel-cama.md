# ct-parcel-cama: Connecticut statewide Parcel and CAMA data (Capitol Planning Region)

Review record for data policy §5. Reviewed 2026-11-03. **Not verified; no adapter.** Machine-readable
copy: [`registry/sources/ct/ct-parcel-cama.json`](../../../registry/sources/ct/ct-parcel-cama.json)
(`verified: false`). The statewide dataset covers all 169 towns, so the one review covers the Capitol
Planning Region and every other planning region.

> **Update 2026-11-03 (tier2-expansion).** The terms gate below is cleared for the same data on the publisher's ArcGIS items: the Connecticut OPM GIS Office
> sets `licenseInfo` "CC0" on "Connecticut CAMA and Parcel Layer" (item `82a733423a244c43a9d4bf552954cea9`), "Connecticut State Parcel Layer 2023",
> "Connecticut Public Use Parcels", "Connecticut Vacant Parcels" and the "Parcel Viewer". That layer is the new source
> [`ct-parcel-cama-layer`](ct-parcel-cama-layer.md) (verified, adapter, real run). This record (the Open Data CT Socrata table `ibe8-9i3q`, no licence
> field) stays `verified: false` and is superseded by it.

## Publisher and URLs

- Publisher: Connecticut Office of Policy and Management (OPM), GIS Office. Towns submit a parcel
  file and a standardized CAMA report (the "OPM 7-100l report") to their Council of Governments by
  September 1 each year under C.G.S. §7-100l; OPM obtains the COGs' copies, "does not modify any of
  the parcel data files" and integrates them into one statewide format
  (<https://portal.ct.gov/datapolicy/gis-office/parcel-and-cama>). The dataset description cites
  C.G.S. §4d-90 to 92 and §7-100l.
- Dataset: "2026 Connecticut Parcel and CAMA Data", id `ibe8-9i3q` on Open Data CT (`data.ct.gov`).
  Landing page: <https://data.ct.gov/Local-Government/2026-Connecticut-Parcel-and-CAMA-Data/ibe8-9i3q>;
  metadata <https://data.ct.gov/api/views/ibe8-9i3q.json>. 1,359,259 rows, 131 columns, all 169 towns;
  attachments: `Metadata_2026.csv`, `2026_Parcel_Layer.zip`, `Collection_2026.zip`. Earlier editions:
  `rny9-6ak2` (2025, 1,358,338 rows), `pqrn-qghw` (2024), and CAMA-only 2022 and 2023 tables. Update
  frequency (metadata): "Not updated (historical data)"; the edition is new each year.
- Capitol Planning Region (Census planning region 09110, population 994,115 in Vintage 2025): 38
  towns, 352,547 rows in the 2026 table. Town list from the Census crosswalk
  (`www2.census.gov/geo/docs/reference/ct_change/ct_cou_to_cousub_crosswalk.xlsx`, old county
  in brackets, H Hartford, T Tolland): Andover (T), Avon (H), Berlin (H), Bloomfield (H), Bolton (T),
  Canton (H), Columbia (T), Coventry (T), East Granby (H), East Hartford (H), East Windsor (H),
  Ellington (T), Enfield (H), Farmington (H), Glastonbury (H), Granby (H), Hartford (H), Hebron (T),
  Manchester (H), Mansfield (T), Marlborough (H), New Britain (H), Newington (H), Plainville (H),
  Rocky Hill (H), Simsbury (H), Somers (T), South Windsor (H), Southington (H), Stafford (T), Suffield (H),
  Tolland (T), Vernon (T), West Hartford (H), Wethersfield (H), Willington (T), Windsor (H), Windsor
  Locks (H). All 38 are present in the 2026, 2025 and 2024 tables (rows per town in 2026: Hartford
  28,423; West Hartford 22,540; Manchester 18,803; Southington 18,549; New Britain 17,404; East Hartford
  16,336; Enfield 15,967; Glastonbury 14,627; down to Andover 1,668).
- Planning regions replaced the eight counties for Census purposes in 2022. The dataset keeps old
  county names in `property_county` (mostly blank or "CT") and has no planning-region column; the
  town is `property_city` (a town name; `town_id` is the State's alphabetical 1 to 169 code and is
  not reliable for villages). A parcel ID of the form `fl:parcel:us-09110:<apn>` would use the
  planning-region FIPS the Census now publishes (110), not a retired county code. OPM's
  town-by-town metadata table (`kx55-2bvm`, 2023 collection, with a `planning_region` column) records
  each town's CAMA vendor (Vision, Right Angles and others) and report name.
- File (confirmed by a real request): the SODA CSV
  `https://data.ct.gov/resource/ibe8-9i3q.csv?$select=<26 columns>&$where=upper(property_city) in(<38 towns>)&$order=town_id,pid&$limit=400000`
  (a 5,000-row sample is 1,216,321 bytes, 243 bytes a row, so about 86 MB for 352,547 rows): over the
  50 MB limit for a local run; the full load belongs on GitHub's network.

## Terms, license, robots

- No licence. The dataset has no license field. The portal's Terms of Use (<https://data.ct.gov/terms>)
  say publishable data is provided "as a public service on an 'as is' basis", disclaim accuracy and
  fitness, and reserve the State's right to "discontinue availability of content [...] at any time
  and for any reason"; they grant no licence and add no restriction. AI use is not addressed.
- robots.txt: `data.ct.gov` `Crawl-delay: 1`, search URLs disallowed, `/resource/` and `/api/`
  allowed; `portal.ct.gov` allows all but internal paths. Discover ran clean on all three pages.
- Statutes. No Connecticut statute restricting commercial use of grand-list or assessment data was
  found: the grand list must be lodged for public inspection (C.G.S. §12-55; annotated as a public
  record), and the data is collected under §7-100l. C.G.S. §1-217 (residential addresses of certain
  public officials; read here only through a 2011 Supreme Court opinion and annotations, not the
  text) requires a town to withhold protected persons' addresses from the grand list. The CAMA
  schema has a `Suppression` field ("identifies that an entry should be suppressed") and OPM asks
  each town whether it suppresses sensitive records; the published dataset has no suppression
  column, so suppressed records are removed or blanked upstream, and how was not established.
  The registry would treat a blank owner as no owner and never try to recover one.

## What the file contains

One row per parcel, condominium unit or account. Key columns: `pid`, `account_number`, `map`/`block`/
`lot`/`unit`, `town_id`, `location` (street address without city or ZIP), `property_city`,
`property_zip`, `owner`, `co_owner`, `mailing_address` and its parts, `assessed_total`/`_land`/
`_building`, `appraised_total` (Connecticut assesses at 70 percent of fair market value, so the appraised
value is the market value; not re-checked against C.G.S. §12-62a here), `valuation_year`, `land_acres`, `state_use`, `state_use_description`, `ayb` (actual
year built), `gross_area_of_primary_building`, `living_area`, `number_of_buildings`, `number_of_units`
(apartments or condo units in the building), `condo_main_id`, sale fields, `link` (the town's
property card). Owner names are present for effectively every row (5,000 of the first 5,000 rows;
2,100 of 2,100 in a Hartford, West Hartford and Manchester sample), and 4,957 of 5,000 rows have a
gross building area.

**`state_use` is the town's own code, not a standard one.** The schema defines it only as "equivalent
to state land use code" (example 101). In the Capitol Planning Region the 2026 table holds hundreds of
code and description pairs: residential `100`/`101`/`1010`/`101.0`; commercial `200`, `201`, `205`
(commercial condominium), `3220` (store/shop), `252.0` (general office), `236.0` (retail); apartments
`800`, `801.0`, `802`, `800C`, `1111` (5 to 8 units), `112` (apartment building); industrial `300`,
`301`, `3160` (commercial warehouse), `227.0` (warehouse); exempt `900` to `9018`. The same code means
different things in different towns (`300` is Industrial in West Hartford and Manchester but "Hotels"
in some others, `3000` is Hotels or "MIXED USE M94"), so the mapping to B, F1 and F2 has to be made town
by town from `state_use_description`, and a wrong guess would put houses or exempt land in the
commercial scope. That mapping, and its tests, are the engineering work to do once the licence gate
below is cleared; it is not done here.

## Gates

**Terms, one action for a person:** email the OPM GIS Office (`OPM.GISO@ct.gov`) and ask in writing
whether the Connecticut Parcel and CAMA Data may be redistributed in an open dataset and used for AI,
with attribution to OPM and the towns, and how suppressed (protected) records are represented in the
published table. Until that answer is on file the source stays `verified: false`.

## Real run

None (unverified). To confirm the layout, 700 commercial-looking rows for each of Hartford, West
Hartford and Manchester (code prefixes 2, 3 and 8) and a 5,000-row region sample were fetched with the
collector's user agent, 2 seconds apart; nothing was loaded. Hartford's 700 rows show 8xx.0 apartment
codes and 2xx.0 commercial codes (APARTMENT 209, APT SUBSIDIZED 91, GEN OFFICE 67); West Hartford's
show 201 Commercial 394, 301 Industrial 144, 802 Comm Apts 79; Manchester's 200/200I/300/205/800C.

## Known gaps

- No standard use code (above). No data for improvement area on land-only rows.
- CT also publishes the 2025 table (`rny9-6ak2`) and the older CAMA-only tables; only the newest was
  reviewed.
- The "Real Estate Sales 2001-2024 GL" dataset (`5mzw-sjtu`) and the Net Grand List by Town dataset
  are aggregate or sales data and were not reviewed for the registry.
