# dc-dcgis-zoning-standards: DC zoning development standards (floor-area ratio and height per zone)

Review record for the source `dc-dcgis-zoning-standards` (data policy §5). Reviewed 2026-11-04. Machine-readable copy:
[`registry/sources/dc/dc-dcgis-zoning-standards.json`](../../../registry/sources/dc/dc-dcgis-zoning-standards.json).
Adapter: `python/src/factlot/registry/adapters/dc_zoning_standards.py`; tests:
`python/tests/test_adapter_dc_zoning_standards.py`.

An **enrichment** source: it creates no parcels. It gives the DC parcels that already carry a zoning district
([dc-dcgis-zoning](dc-dcgis-zoning.md)) the maximum floor-area ratios and height that the Zoning Regulations of 2016 set
for that district.

## Publisher and URLs

- Publisher: District of Columbia Office of Zoning, through DC GIS (Office of the Chief Technology Officer) and Open
  Data DC. Layer 36 "Zoning Regulations of 2016 Development Standards" (a table) of the map service
  `https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Planning_Landuse_and_Zoning_WebMercator/MapServer`; Hub item
  `8d10621514e544c0b5a1ef775e7e0263` "Zoning Development Standards"
  (<https://opendata.dc.gov/datasets/DCGIS::zoning-development-standards>), last modified 2026-11-03.
- Description (the Hub item): "the Floor Area Ratio, Height, Lot Occupancy, Reary Yard, Side Yard, and other various
  development standards for each zone in the District of Columbia Zoning Regulations of 2016".
- File used: one ArcGIS `query` request (`where=1=1&outFields=*&returnGeometry=false&f=json`), 409 rows, 309,522 bytes,
  archived by the collector on 2026-11-04 (UTC). All columns are text; `NULL`, `N/A` and prose stand where no single
  number applies.

## Terms, license, robots

As [dc-dcgis-zoning](dc-dcgis-zoning.md): CC-BY-4.0 on the Hub item (DCAT `license`); District terms for District data
(<https://dc.gov/page/terms-and-conditions-use-district-data>): public domain under a CC0 1.0 dedication, "even for
commercial purposes, all without asking permission". AI use `permitted`; redistribution `attribution_required`;
attribution "District of Columbia Office of Zoning (DC GIS), Open Data DC". `maps2.dcgis.dc.gov` has no robots.txt (404).
Request spaced by the collector's 2-second interval, identified. No account, key or click-through. `verified: true`.

## What the adapter reads and writes

1. **Standards per zone** (only plain numbers are read; prose is not parsed, so a conditional standard gives no fact):

   | Table category                                                                                                                                                                                                       | Predicate                               |
   | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
   | `Residential`                                                                                                                                                                                                        | `zoning.max_far_residential`            |
   | `Residential (IZ)` (inclusionary zoning)                                                                                                                                                                             | `zoning.max_far_affordable_residential` |
   | `Non-Residential`                                                                                                                                                                                                    | `zoning.max_far_nonresidential` (new)   |
   | `Institutional`                                                                                                                                                                                                      | `zoning.max_far_facility`               |
   | `Industrial` (PDR zones)                                                                                                                                                                                             | `zoning.max_far_manufacturing`          |
   | `All Other Buildings & Structures`, RA zones only, when it is the zone's only category                                                                                                                               | `zoning.max_far_residential`            |
   | any category: the greatest plain `HEIGHT_FT` among the zone's rows other than the special uses (institutional, church, military, library, accessory buildings); skipped if any of those rows gives a height in prose | `zoning.max_height_ft` (new, unit `ft`) |

   Two rows of one category with different numbers, a zero ratio, `NULL`, `N/A` and prose give nothing for that
   predicate. The mapping of `Residential (IZ)`, `Institutional` and `Industrial` onto the NYC-derived names is a
   judgement and is stated here, not in the value. The height is the zone's greatest, which for a zone with an
   inclusionary bonus is the bonus height.

2. **The rule that a district's standard applies to the parcel** (stated on each fact): a parcel takes the standards of its
   `zoning.district` fact, with names compared ignoring case, hyphens and spaces (`R-1B` = `R-1-B`). A district with an
   overlay suffix (`RF-1/CAP`, `MU-4/CHC`) takes the standards of the base zone before the first `/`, which an overlay
   can change. A district the table does not list gets nothing.

Every fact is **`inferred`**: it is FactLot's derivation from two public files. Confidence is the parcel's district
confidence, at most 0.9 for an exact zone name and 0.6 for a base zone under an overlay. The fact cites the standards file
as its document; the locator names the SSL, the district, the zone matched and the table's categories
(`SSL 0442 0842: zoning district MU-4 takes the ZR16 standards of zone MU-4 (categories: Non-Residential, Residential,
Residential (IZ))`).

## Real run (2026-11-04)

Into the scratch DC registry (`…/scratchpad/data/r2/dc.db`, a copy of round 1's `dc.db`):

```
python -m factlot.registry.adapters.dc_zoning_standards query.json dc.db --as-of 2026-11-03
```

| Measure                                                           | Count                    |
| ----------------------------------------------------------------- | ------------------------ |
| Zones in the table with at least one usable standard              | 135 of 150               |
| Parcels with a zoning district                                    | 16,648                   |
| Matched to a zone by exact name                                   | 13,330                   |
| Matched to the base zone under an overlay suffix (confidence 0.6) | 1,546                    |
| District not in the table, or with no usable standard             | 1,772 (10.6%)            |
| Parcels given facts                                               | 14,876 (82.3% of 18,077) |
| Facts written                                                     | 33,838                   |

By predicate: `zoning.max_height_ft` 14,448; `zoning.max_far_residential` 9,423; `zoning.max_far_nonresidential` 4,701;
`zoning.max_far_affordable_residential` 4,624; `zoning.max_far_manufacturing` 642. Mean confidence of the height facts
0.86. Districts left without facts, largest first: `MU-7B` 274, `D-6` 263, `D-7` 106, `UNZONED` 101, `D-5-R` 83, `MU-8B/DC` 72,
`NMU-4/H-A` 70, `NMU-7B/GA` 69, `NMU-4/GA` 68 (`D-6`, `D-7` and the downtown zones state height by street width or FAR
"as achievable", which is prose; the `NMU-` zones and `MU-nB` names are not in the table under those names).

## Known gaps

- Overlay districts change what a zone allows (height, use); they are named in `zoning.special_district`, not applied.
- Lot occupancy, setbacks, stories and green-area ratios are in the table and not read.
- The table summarises the regulations; 11 DCMR and the Office of Zoning are the authority. Planned unit developments,
  zoning-commission orders and variances are not reflected.
