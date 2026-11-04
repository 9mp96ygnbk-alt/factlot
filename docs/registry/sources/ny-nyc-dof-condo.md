# ny-nyc-dof-condo: condominium unit lots inherit their building's PLUTO facts

Review record for the source `ny-nyc-dof-condo` (data policy §5). Reviewed 2026-11-04. Machine-readable copy:
[`registry/sources/ny/ny-nyc-dof-condo.json`](../../../registry/sources/ny/ny-nyc-dof-condo.json). Adapter:
`python/src/factlot/registry/adapters/ny_condo.py`; tests: `python/tests/test_adapter_ny_condo.py`.

An **enrichment** source: it creates no parcels. PLUTO ([ny-nyc-dcp-pluto](ny-nyc-dcp-pluto.md)) has one row per
condominium _complex_, under its billing lot (lot 7501 and up), and none for the unit lots (1001 and up) that the
Department of Finance roll lists as tax lots of their own. 47,240 registry parcels, almost all commercial condominium
units (DOF class `R`), therefore had no zoning or building facts. DOF's Digital Tax Map publishes which unit lot
belongs to which condominium and which billing lot that condominium has. This adapter joins the two and copies a
subset of the billing lot's PLUTO facts to each unit, labelled as inherited.

## Publisher and URLs

- Publisher: New York City Department of Finance (DOF), Digital Tax Map, on NYC Open Data.
- Datasets: `p8u6-a6it` "Digital Tax Map: Condominiums" (12,261 condominiums; `condo_key` and
  `condo_billing_bbl`), <https://data.cityofnewyork.us/resource/p8u6-a6it>; and `eguu-7ie3` "Digital Tax Map: Condominium
  Units" (308,142 unit lots; `unit_bbl` and `condo_key`), <https://data.cityofnewyork.us/resource/eguu-7ie3>. Both are
  attributed to "Department of Finance (DOF)", extracted from DOF's system on the last Friday of each month (the
  dataset description). Metadata at `https://data.cityofnewyork.us/api/views/<id>.json`.
- Files used: two SODA requests, `…/p8u6-a6it.csv?$select=condo_key,condo_base_bbl,condo_billing_bbl&$order=condo_key`
  (428,908 bytes) and `…/eguu-7ie3.csv?$select=unit_bbl,condo_key,condo_base_bbl&$order=unit_bbl&$limit=1000000`
  (10,785,010 bytes). Archived by the collector on 2026-11-04 (UTC). The condominium's name, the unit designation and
  the geometry are not requested.
- The PLUTO file is the one `ny-nyc-dcp-pluto` loaded (version 26v2,
  `fl:document:sha256-0c1fe1a88591dcc7468b100cff53355e5f3d7eb8e52dba3cc1b0bd2aff2ceab7`).

## Terms, license, robots

Same position as the other NYC Open Data sources ([ny-nyc-dcp-pluto](ny-nyc-dcp-pluto.md)): the NYC Open Data FAQ
(<https://www.nyc.gov/opendata/get-started/FAQs>, read again 2026-11-04) says "Open Data belongs to all New Yorkers.
There are no restrictions on the use of Open Data." AI use: not addressed, recorded `unknown`. Redistribution:
permitted. Attribution: New York City Department of Finance, Digital Tax Map; New York City Department of City Planning
(DCP), PLUTO (the facts copied are DCP's, and DCP's informational-purposes-only disclaimer applies to them). The
Tyler/Socrata platform-terms question is the one in [`../requests/platform-terms/socrata.md`](../requests/platform-terms/socrata.md).
`data.cityofnewyork.us` robots.txt: `Crawl-delay: 1`, only `/browse` search pages disallowed. Requests 2 seconds apart,
identified collector, no account or click-through. `verified: true`.

## What is copied, and what is not

For each unit lot in the registry that has no PLUTO row of its own, whose condominium has a billing lot PLUTO lists:

| Copied from the billing lot's PLUTO row                                                                                                                           | Not copied (describes the whole complex)                                                                                                      |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| every `zoning.*` fact; `parcel.num_floors` (the tallest building of the complex), `parcel.year_altered`, `parcel.historic_district`, `parcel.landmark_designated` | `parcel.built_far`, `parcel.num_buildings`, `parcel.units_residential`, `parcel.units_total`, `parcel.area_by_use_sf`, `parcel.land_use_code` |

Areas, unit counts and the land-use category of the complex would read as the unit's own on a unit's parcel, so they are
left on the billing lot. The copied facts are **`inferred`** with confidence 0.9. The locator of each says where from
(`BBL 1000041001: condominium unit lot inherits from billing lot 1000047501 (condo 100835, units table line 2); PLUTO 26v2
line 4 (fl:document:sha256-0c1fe1a88591dcc7…)`); the fact cites the units table as its document, and the PLUTO file is
named by a 16-hex prefix of its document ID (the full ID is in the `snapshots` table of `ny-nyc-dcp-pluto`). The fact's
`as_of` is the PLUTO version's date (2026-08-24), the date of the data described.

## Real run (2026-11-04)

Into the scratch NYC registry (`…/scratchpad/data/r2/nyc.db`, a copy of the round-1 `zs.db` with the DOF roll and PLUTO):

```
python -m factlot.registry.adapters.ny_condo eguu-7ie3.csv p8u6-a6it.csv 64uk-42ks.csv nyc.db --as-of 2026-08-24
```

| Measure                                                             | Count                    |
| ------------------------------------------------------------------- | ------------------------ |
| Unit lots in the table                                              | 308,141                  |
| …whose condominium has no billing lot in the condominiums table     | 128                      |
| …with a PLUTO row of their own (left alone)                         | 449                      |
| …whose billing lot is not in the PLUTO file                         | 1,224                    |
| …that inherit (billing lots used: 10,887)                           | 306,340                  |
| Of those, registry parcels (the rest are out of scope: residential) | 47,189 (259,151 skipped) |
| Facts written                                                       | 308,426                  |

Registry parcels with a `zoning.district` now: **163,722 of 164,633 (99.4%)**, 116,608 from PLUTO directly
(`public_record`) and 47,114 inherited (`inferred`). By predicate (inherited): `zoning.district` 47,114;
`zoning.max_far_facility` 46,265; `zoning.max_far_residential` and `_affordable_residential` 45,501 each;
`parcel.num_floors` 44,639; `zoning.max_far_commercial` 17,307; `zoning.special_district` 14,378; `parcel.year_altered`
12,530; `zoning.commercial_overlay` 9,857; `zoning.split_zone` 7,106; `zoning.other_districts` 6,984;
`zoning.max_far_manufacturing` 5,203; `zoning.e_designation` 2,730; `parcel.historic_district` 2,193;
`parcel.landmark_designated` 804; `zoning.limited_height_district` 314.

## Known gaps

- A unit in a complex of several buildings gets the complex's tallest-building floor count, and zoning of the billing
  lot as PLUTO assigns it; a complex split by a zoning boundary lists every district on every unit.
- 911 registry parcels still have no zoning district: lots PLUTO does not list and that are not condominium units, and
  unit lots under a billing lot PLUTO does not list (1,224 unit lots of all classes in the table).
- The mapping is the current Digital Tax Map; a condominium amended after the PLUTO version is mapped by the newer
  table to the older billing-lot row.
