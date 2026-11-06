# dc-dcgis-zoning: District of Columbia zoning map joined to DC lots

Review record for the source `dc-dcgis-zoning` (data policy §5). Reviewed 2026-11-03. Machine-readable
copy: [`registry/sources/dc/dc-dcgis-zoning.json`](../../../registry/sources/dc/dc-dcgis-zoning.json).
Adapter: `python/src/factlot/registry/adapters/dc_zoning.py`; tests: `python/tests/test_adapter_dc_zoning.py`.

An **enrichment** source: it creates no parcels. It gives the parcels the DC tax roll
([dc-otr-real-property](dc-otr-real-property.md)) put in the registry a zoning district, found by overlaying
each lot's polygon on the District's zoning map. The tax roll has no coordinates, so this is a spatial join
through the SSL (square, suffix, lot), the key both the roll and DC GIS use.

## Publisher and URLs

All layers are ArcGIS REST map-service layers on `maps2.dcgis.dc.gov` (DC GIS, Office of the Chief Technology
Officer), republished on Open Data DC (`opendata.dc.gov`, an ArcGIS Hub). The collector queried the map service
directly, not the Hub (the Hub's `robots.txt` sets `Crawl-delay: 60`; `maps2.dcgis.dc.gov` has no `robots.txt`,
which the collector reads as allowed).

| Layer                                          | Service path                                           | Hub item                           | Licence on the item | Last modified (Hub) | Used for                                                              |
| ---------------------------------------------- | ------------------------------------------------------ | ---------------------------------- | ------------------- | ------------------- | --------------------------------------------------------------------- |
| Zoning Boundaries (Zoning Regulations of 2016) | `Planning_Landuse_and_Zoning_WebMercator/MapServer/32` | `fd7c1d709bca4a9295b6fa5ec7d62446` | CC-BY-4.0           | 2026-11-04          | 981 district polygons (`ZONING`, `ZONE_DESCRIPTION`, `ZONING_STATUS`) |
| Overlay Areas 2016                             | `…/MapServer/6`                                        | `805bcffc06cf4f478de5bd485a8843cf` | CC-BY-4.0           |                     | 23 overlay polygons (`OVERLAY_NAME`)                                  |
| Record Lots                                    | `Property_and_Land_WebMercator/MapServer/35`           | `5b0b6b13ef894b8da62e6bd458d907b3` | CC-BY-4.0           | 2026-10-31          | lot polygons by SSL                                                   |
| Tax Lots                                       | `…/MapServer/39`                                       | `14d9f44e81914b0cb9a7c622fe237a94` | CC-BY-4.0           | 2026-10-31          | lot polygons for SSLs that are tax lots (numbered 800-1999)           |
| Condo Relate                                   | `…/MapServer/52`                                       | `5db1978a41d84da3b6a625934e839827` | CC-BY-4.0           | 2026-11-03          | condominium unit SSL → underlying lot (`SSL`, `MAT_SSL` only)         |

Source organisations on the Hub: Office of Zoning / OCTO for the zoning layers, Department of Buildings for the
lot layers. Hub metadata was read through `opendata.dc.gov/api/search/v1` (three requests, a minute apart).
Also published, not used: _Zoning Development Standards_ (`8d10621514e544c0b5a1ef775e7e0263`, CC-BY-4.0, the
floor-area-ratio, height and lot-occupancy table per zone; its columns are text with `NULL` strings and several
rows per zone by building category, so it is a follow-up, not a join), the 1958 zoning layer, and the other
overlay and planning layers.

## Terms, license, robots

- **Licence, per item (Hub metadata, 2026-11-03):** CC-BY-4.0, "This work is licensed under a Creative Commons
  Attribution 4.0 International License". District terms for District data
  (<https://dc.gov/page/terms-and-conditions-use-district-data>, recorded in the DC OTR review): "the data on the
  Sites is public domain and made available with a Creative Commons CC0 1.0 Universal dedication"; "You can copy,
  modify, distribute, and perform the data, even for commercial purposes, all without asking permission." Requested
  attribution: "Data retrieved from Open Data DC catalog (https://opendata.dc.gov)".
- **AI use:** not addressed; CC-BY-4.0 and the CC0 dedication permit any use. Recorded `permitted`.
  **Redistribution:** `attribution_required`. **Attribution:** District of Columbia Office of Zoning and Department
  of Buildings (DC GIS), Open Data DC.
- **Esri platform terms** bind the District as Esri's customer, not a downloader (recorded in the DC OTR review).
- **robots.txt:** `maps2.dcgis.dc.gov` none (404). Requests were spaced 2 seconds apart; the `User-Agent`
  names the collector and a contact address. No account, key, login or click-through.
- **Condo Relate carries personal data.** The table has owner names (`OWNERNAME`, `OWNNAME2`), mailing addresses
  and sale prices of condominium units. The collector asks for `SSL` and `MAT_SSL` only (`outFields`), the adapter
  reads only those two, and a test checks that the request names no other column. No owner name from it is stored.
- `verified: true`.

## How the join is done, and how honest it is

1. **Lot polygon.** For every in-scope DC parcel the SSL is rewritten as DC GIS writes it (`0123    0045`; suffix
   padded to four) and looked up in Record Lots (batches of 100 SSLs per request); SSLs not found are looked up in
   Tax Lots. A condominium unit (lot number 2000 or more) has no polygon of its own; Condo Relate gives the
   underlying record or tax lot, and the unit takes that polygon. The locator of such a fact says so.
2. **Overlay.** Points are sampled across the lot (a 5 × 5 lattice over its bounding box, kept where inside the
   polygon; a 12 × 12 lattice when the 5 × 5 points disagree on district or overlay; the centroid of the outline
   when no lattice point falls inside, as for a sliver) and each point is located in the zoning and overlay
   polygons. The lot's district is the one holding the most points; any other district with at least 10% of the
   points is listed in `zoning.other_districts` and the lot is marked `zoning.split_zone`; an overlay holding at
   least 10% of the points is listed in `zoning.special_district`.
3. **Labelling.** The result is FactLot's own derivation from two public files, so each fact is **`inferred`**,
   with confidence equal to the district's share of the sampled points that fall in any district, capped at 0.95.
   It cites the zoning file as its document, and its locator names the lot file (and overlay file) by document ID
   and the number of sample points. The lot files, overlay file and condo-relate files are registered as
   snapshots of the source so those IDs resolve. Predicates: `zoning.district`, `zoning.district_description`,
   `zoning.other_districts`, `zoning.split_zone`, `zoning.special_district`.

What this is not: a zoning verification. A lot polygon here is the record lot or tax lot, not the zoning
administrator's determination; sampling approximates the share of the lot in each district; the zoning map is as
amended through its last-modified date; the Zoning Regulations (11 DCMR) and the Office of Zoning's map are the
authority. Overlays are reported by name only (DC's overlays also change what a district allows).

## Real run (2026-11-04)

Requests (collector, one at a time, 2 s apart): the zoning layer (5.5 MB GeoJSON), the overlay layer, 16
condominium-unit queries (1,568 SSLs with lot numbers of 2000 or more), 170 Record Lots queries (16,969 SSLs:
the registry's, with each resolved condominium unit replaced by its underlying lot) and 62 Tax Lots queries (the
6,153 SSLs Record Lots did not return): 250 archived files, 12.7 MB in all, about ten minutes of collector time. Scratch registry (not in the
repo), built from the archived ITSPE and CAMA files (`dc_otr`, 18,077 parcels, 10 s) and
then:

```
python -m factlot.registry.adapters.dc_zoning build dc.db --zoning zoning-boundaries-zr16-….geojson --overlays overlay-areas-2016-….geojson --lots record-lots-… tax-lots-… --condos condo-relate-… --as-of 2026-11-04
```

| Measure                                                                                       | Count                                                                                                                                                                                                                                  |
| --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Lot polygons read                                                                             | 10,816 record lots + 5,341 tax lots (no SSL in both)                                                                                                                                                                                   |
| Condominium units mapped to an underlying lot                                                 | 855                                                                                                                                                                                                                                    |
| Facts produced for lots (records)                                                             | 16,827 (16,648 are DC registry parcels; 179 are lots the registry does not hold)                                                                                                                                                       |
| **Registry parcels with a zoning district**                                                   | **16,648 of 18,077 (92.1%)**: 15,978 by their own lot polygon, 670 by a condominium unit's underlying lot                                                                                                                              |
| Parcels without                                                                               | 1,429: 485 federal, possessory-interest and parcel SSLs (`PI…`, `PAR …`) with no lot polygon; 895 condominium-style SSLs (lot 2000 and up) that Condo Relate does not list; 49 ordinary lots with no polygon or outside every district |
| Split lots (`zoning.split_zone`)                                                              | 378                                                                                                                                                                                                                                    |
| Lots in an overlay (`zoning.special_district`)                                                | 2,232 (Dupont Circle 833, Capitol Interest 311, Capitol Hill Commercial 170, Georgia Avenue 139, Georgetown 115)                                                                                                                       |
| Confidence                                                                                    | mean 0.944; 16,307 at 0.9 or more; 3 below 0.5 (lowest 0.42, lots straddling districts)                                                                                                                                                |
| Facts written                                                                                 | 36,183 (16,648 `zoning.district`, 16,547 `zoning.district_description`, 2,232 `zoning.special_district`, 378 each of `zoning.other_districts` and `zoning.split_zone`)                                                                 |
| Seconds (join and ingest, after a 170-fold speed-up from bucketing polygon edges by latitude) | 13                                                                                                                                                                                                                                     |

Most common districts: RA-1 2,402, MU-4 2,272, RF-1 2,265, RA-2 1,254, R-2 722, R-3 689, PDR-1 442, MU-3A 406,
R-1B 403, MU-5A 365, RA-4 318, D-5 298. Sanity: by FactLot category, multifamily parcels fall in RA, RF and R
districts (3,736, 1,993 and 1,211) and MU (544); the 262 industrial parcels with a district are in PDR; commercial
parcels are mostly in MU, D and NMU, with 2,100 in residential districts (churches, schools, embassies and
non-conforming uses, which the use codes 081-089 and 004-008 include).
`python -m factlot.registry.audit` on the scratch file: no violation and no citation gap.

## Known gaps

- 8% of parcels have no district (listed above); the 895 condo-style lots without a Condo Relate row may be air-rights
  or other special lots and need a human look.
- Sampling, not exact area intersection (no geometry library is available to the registry); lots with a district
  boundary through them get a confidence below 0.9, and the 10% rule is a choice.
- No development standards (FAR, height) yet; the zone is named, not what it allows.
- The zoning layer carries the amendments in force at its last-modified date and no history; a re-run replaces a lot's
  district and keeps the old one as history.
