# mn-minneapolis-planning-zoning: Minneapolis zoning joined to Hennepin County parcels by point

Review record for the source `mn-minneapolis-planning-zoning` (data policy §5). Reviewed 2026-11-04. Machine-readable
copy: [`registry/sources/mn/mn-minneapolis-planning-zoning.json`](../../../registry/sources/mn/mn-minneapolis-planning-zoning.json).
Adapter: `python/src/factlot/registry/adapters/zoning_points.py`; tests: `python/tests/test_adapter_zoning_points.py`.

An **enrichment** source: it creates no parcels. The county's parcel file ([mn-hennepin-assessor](mn-hennepin-assessor.md))
has a latitude and longitude for each parcel and no zoning; the City of Minneapolis publishes its zoning districts as
polygons. The join is a point in polygon.

## Publisher and URLs

- Publisher: City of Minneapolis, MapIT Minneapolis. Feature service layer
  `https://services.arcgis.com/afSMGVsC7QlRK1kZ/arcgis/rest/services/Planning_Primary_Zoning/FeatureServer/0` (1,308
  polygons; `Land_Use` the district's name, `Land_Use_Code` its code; data last edited 2026-10-30), Hub item "Planning
  Primary Zoning" (<https://opendata.minneapolismn.gov/datasets/cityoflakes::planning-primary-zoning>).
- File used: one ArcGIS `query` request (`f=geojson`, `outFields=OBJECTID,Land_Use,Land_Use_Code`), 3,491,354 bytes,
  archived 2026-11-04 (UTC). The county parcel file is the one already loaded (`County_Parcels.csv`, 362,577,002 bytes,
  Last-Modified 2026-10-22).

## Terms, license, robots

- **License:** CC0 1.0 Universal (Hub DCAT `license`, read 2026-11-04). AI use `permitted`, redistribution `permitted`.
  Attribution requested: "City of Minneapolis, MapIT Minneapolis, Planning Primary Zoning".
- **robots.txt:** the Hub (`opendata.minneapolismn.gov`) sets `Crawl-delay: 60`, so the feature service behind it was
  queried instead; `services.arcgis.com/robots.txt` answers 403 "Invalid URL" (no rules). Requests 2 seconds apart,
  identified, no account. `verified: true`.
- The layer is the City's planning layer; the Zoning Code and the City's own map are the authority.

## How the join is done, and how honest it is

For each parcel in the county file, the point `(LAT, LON)` is located in the zoning polygons (the point-in-polygon code of
`dc_zoning`). The parcel gets `zoning.district` (`Land_Use_Code`) and `zoning.district_description` (`Land_Use`), both
**`inferred`** with confidence 0.8, citing the zoning file; the locator gives the PID, the point, the line of the county
file (named by document ID, which is a snapshot of the parcel source) and the polygon's feature number. A point in no
polygon (every parcel outside Minneapolis: Hennepin County's other cities zone for themselves) gets nothing; a point in
two polygons with different codes (3 here) gets nothing. A lot that a boundary splits gets one district, the one at its
point.

## Real run (2026-11-04)

Into a scratch Hennepin registry built from the archived county file (`…/scratchpad/data/r2/hennepin.db`, 19,840 parcels):

```
python -m factlot.registry.adapters.zoning_points minneapolis query.geojson County_Parcels.csv hennepin.db --as-of 2026-10-30
```

448,126 distinct PIDs in the county file; 130,169 fall in a Minneapolis polygon, 317,954 in none, 3 in two. **8,616 of the 19,840 registry
parcels (43.4%) get a district** (17,232 facts). Districts of the 130,169 PIDs: `UN2` 44,029, `UN1` 40,182, `UN3` 11,388,
`DT1` 9,948, `RM1` 5,449, `CM3` 5,372, `CM2` 4,725, `DT2` 3,198, `RM3` 1,305, `CM1` 1,233, `PR2` 1,020, `RM2` 989, `PR1` 604, `CM4` 531,
`TR1` 196.

## Known gaps

- Minneapolis only. The other Hennepin cities (Bloomington, Edina, Minnetonka, and the rest) publish their own zoning; none is
  loaded.
- The overlay layer (`Planning Zoning Overlay`) and the built-form layer are not loaded.
- Point, not polygon overlay: a parcel near a boundary can land on the wrong side. Confidence 0.8 says so.
