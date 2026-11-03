# mn-opt-in-parcels: Minnesota, 24 opt-in open-data counties, commercial, industrial and apartment parcels

Reviewed 2026-11-03. Machine-readable copy: [`registry/sources/mn/mn-opt-in-parcels.json`](../../../registry/sources/mn/mn-opt-in-parcels.json).
Adapter: `factlot.registry.adapters.mn_opt_in` (account system `mn_state_pin`, `<county FIPS>-<county PIN>`); tests
`python/tests/test_adapter_mn_opt_in.py`. Minnesota's Hennepin County (`mn-hennepin-assessor`, Tier 1) is in the same compilation and is not loaded
again from it.

**Status: `verified: true`.** The layer holds only counties that **opted in to open data**; the State disclaims warranties and states no licence.

## Publisher and URLs

- Publisher: Minnesota Geospatial Information Office (MnGeo), compiling the parcel data of counties that opted in (coordinated by the Minnesota
  Geospatial Advisory Council's Parcels and Land Records Committee).
- ArcGIS Online item `69148d3959194a05a23964cc60f6517b` "Parcels, Compiled from Opt-In Open Data Counties, Minnesota"; feature service
  `https://enterprise.gisdata.mn.gov/aghost/rest/services/us_mn_state_mngeo/plan_parcels_open/FeatureServer`, layer 1 "Plan Parcels Open"
  (`maxRecordCount` 2,000; 2,710,201 parcels in 59 counties on 2026-11-03; updated quarterly). Landing page
  <https://gisdata.mn.gov/dataset/plan-parcels-open>. The attribute standard is the GAC parcel standard
  (<https://www.mngeo.state.mn.us/committee/standards/parcel_attrib/parcel_attrib.html>).

## Terms, licence, robots

- **Terms.** No licence. Item description: "This dataset is a compilation of county parcel data from Minnesota counties that have opted-in for their
  parcel data to be included in this dataset ... The State of Minnesota makes no representation or warranties, express or implied, with respect to the
  use or reuse of data provided herewith ... THE DATA IS PROVIDED 'AS IS'." The opt-in is the counties' consent to open reuse (layer 0 records each
  county's `gac_open_approval`). AI use is not addressed. No login, form or fee.
- **robots.txt.** `enterprise.gisdata.mn.gov` serves none the collector could read as rules; the collector's manifest records the status per file.

## What the file contains

31 pages (`returnGeometry=false`, `objectid` order, 2,000 features each; 50,350,777 bytes) of the 60,738 rows of 24 counties whose `useclass1` label is
one of 25 literal wordings (below). Key columns: `county_pin`, `state_pin`, `owner_name`, `own_add_l1` to `own_add_l4`, address parts (`anumber`, `st_name`,
`st_pos_typ`, `ctu_name`, `zip`), `emv_land`, `emv_bldg`, `emv_total`, `mkt_year`, `acres_deed`, `acres_poly`, `year_built`, `num_units`, `useclass1`.

`useclass1` is **the county's own text**, different in each county, so the mapping is per label and per county, from the words (the Minnesota property tax
classes are named in them: 3a commercial/industrial, 4a rental of four or more units). Counties whose labels were read in full and are mapped: Aitkin,
Anoka, Becker, Carver, Cass, Chippewa, Chisago, Cook, Dakota, Fillmore, Lake, McLeod, Mower, Olmsted, Otter Tail, Pipestone, Ramsey, Renville, St. Louis,
Scott, Sherburne, Stearns, Waseca and Wright.

| Label (lower-cased)                                                                                                                                                                                                                                                                                                                            | FactLot |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| `3a commercial land and building`, `3a commercial preferential`, `3a commercial non preferential`, `233 3a commercial preferential`, `233 - commercial land and building (1st $150,000)`, `commercial`, `commercial preferred`, `commercial non-preferred`, `commercial-preferred`, `commercial-open space`, `commercial-preferred-open space` | F1      |
| `3a industrial land and building`, `3a industrial preferential` (Anoka spells it `3a industial preferential`), `3a industrial non preferential`, `234 3a industrial preferential`, `234 - industrial land and building (1st $150,000)`, `industrial`, `industrial preferred`, `industrial non-preferred`, `industrial-preferred`               | F2      |
| `4a apartment 4 or more units`, `205 4a apartment 4 or more units`, `apartment (4 or more units)`, `apartment`                                                                                                                                                                                                                                 | B       |

Not mapped though near: seasonal recreational commercial (resort), telephone, railroad and utility classes, manufactured home parks, low-income rental
(4d), community land trusts, "Apartment-Mobile Home Park", "Apartment-Mobile Home" and "Apartment-Nursing Home" (Dakota), every "Vacant Land - ..." class.
Counties left out for their labels: Washington (bare numeric codes), Isanti, Morrison, Rice (one combined commercial/industrial/public-utility class),
Clay and Mille Lacs and Pope (multi-use strings), Steele, Wabasha and Winona (apartments only) and every other county of the 59.

## Gates

None for the 24 counties loaded. For the others a person asks the county assessor (or MnGeo, which sends each county a mapping file every quarter)
for the use-class definitions; Washington County uses numeric codes (`300`, `305`, `110` ...) with no text.

## Real run

`snapshot` on 2026-11-03 (31 pages, all archived; first page `fl:document:sha256-d49f39237ec15a3c7336c1c9b63a2412ab757ac553ba2e79ebde7c2844fc98f7`), then
`mn_opt_in.build` into the expansion registry:

```
python -m factlot.registry.adapters.mn_opt_in collected/mn-opt-in-parcels registry.db --as-of 2026-11-03
```

- Rows read: 60,738; parcels stored: **60,495** (243 repeated county PINs collapse) in 24 counties: `B` 9,017, `F1` 38,316, `F2` 13,162.
- Facts written: 449,958. Errors: none.
- Organisation owners stored: 36,373; natural persons or blank owners not stored: 11,528 (the remaining rows have no owner of record).
- Per county (B / F1 / F2): Aitkin 48/430/162; Anoka 738/2,805/1,662; Becker 0/974/127; Carver 168/862/388; Cass 64/864/223; Chippewa 41/570/84;
  Chisago 114/898/192; Cook 21/249/1; Dakota 1,069/3,259/1,499; Fillmore 56/959/67; Lake 38/382/100; McLeod 153/873/288; Mower 136/1,511/48;
  Olmsted 693/2,669/568; Otter Tail 283/1,825/457; Pipestone 0/482/123; Ramsey 2,556/4,576/1,594; Renville 0/702/102; St. Louis 1,374/5,134/2,762;
  Scott 268/1,111/1,123; Sherburne 164/1,062/389; Stearns 705/3,595/605; Waseca 66/485/55; Wright 262/2,039/543.

## Known gaps

- Hennepin and the other counties are not loaded from this layer; Washington County is the largest Minnesota county left (numeric codes only).
- Parcels with several classes (`multi_uses` yes) carry only `useclass1`; a commercial building on a parcel whose first class is something else is missed.
- `emv_total` is the estimated market value of `mkt_year`; condominium units appear as separate PINs.
- The sample label lists were read from the layer's own group-by counts on 2026-11-03; a county that adds a label later is not picked up until the table is
  updated.
