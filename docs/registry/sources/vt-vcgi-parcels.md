# vt-vcgi-parcels: Vermont (all 14 counties), commercial, commercial-apartment and industrial grand-list parcels

Reviewed 2026-11-03. Machine-readable copy: [`registry/sources/vt/vt-vcgi-parcels.json`](../../../registry/sources/vt/vt-vcgi-parcels.json).
Adapter: `factlot.registry.adapters.vt_vcgi` (account system `vt_span`, the School Property Account Number); tests
`python/tests/test_adapter_vt_vcgi.py`.

**Status: `verified: true`.** The publisher states no licence; the item carries only a warranty disclaimer and the Parcel Program
calls the data "freely available". This is the same basis as Pierce County WA and Denton CAD (public record, disclaimer only); see
"Licence point".

## Publisher and URLs

- Publisher: Vermont Center for Geographic Information (VCGI), compiled from Vermont municipalities, Vermont licensed land surveyors
  and the Vermont Department of Taxes.
- ArcGIS Online item `09cf47e1cf82465e99164762a04f3ce6` "VT Data - Statewide Standardized Parcel Data - parcel polygons"
  (owner `Services_VCGI`); feature service
  `https://services1.arcgis.com/BkFxaEFNwHqX3tAw/arcgis/rest/services/FS_VCGI_OPENDATA_Cadastral_VTPARCELS_poly_standardized_parcels_SP_v1/FeatureServer/0`
  (`maxRecordCount` 2,000; item size 1.4 GB, so the review used filtered query pages and no full download).
- Metadata: <https://maps.vcgi.vermont.gov/gisdata/metadata/CadastralParcels_VTPARCELS.htm>; program page
  <https://vcgi.vermont.gov/data-and-programs/parcel-program>; schema <https://vcgi.vermont.gov/document/vt-gis-parcel-data-standard>.
- Town boundary layer used for the county: item `3f464b0e1980450e9026430a635bff0a`, fields `TOWNNAME`, `CNTY` (256 rows).

## Terms, licence, robots

- **Terms.** No licence. The item's `licenseInfo` and the metadata's use limitation read: "This data layer is not a legal survey. It is not a
  legal conveyance or description of property and is intended for planning purposes only. VCGI and the State of VT make no representations of
  any kind, including but not limited to the warranties of merchantability or fitness for a particular use". The Parcel Program page calls the
  result "a freely available GIS layer for all Vermont municipalities joined with their annual grand list". AI use is not addressed. No
  login, form, click-through or fee is involved.
- **robots.txt.** `services1.arcgis.com` serves none; `www.arcgis.com` is used for the item JSON only. `geodata.vermont.gov` sets
  `Crawl-delay: 60` and disallows `/sites/ /admin/ /sessions/ /groups/ /people/ /workspace/`; it was not used (its Hub CSV export was avoided in
  favour of the service query). `vcgi.vermont.gov` and `maps.vcgi.vermont.gov` allowed the documents read once each.

## What the file contains

The collector archives 11 pages (`returnGeometry=false`, `OBJECTID` order, 2,000 features each; 10,089,903 bytes in all) of the polygons with
`CAT` in `C`, `CA`, `I` and `PROPTYPE = 'PARCEL'`: 20,400 polygons, 19,342 distinct SPANs (a Grand List parcel with unlanded buildings is
drawn as stacked polygons with the same SPAN; the adapter keeps the first). Key columns: `SPAN`, `TOWN`, `OWNER1`, `OWNER2`, `ADDRGL1`, `ADDRGL2`,
`CITYGL`, `STGL`, `ZIPGL`, `E911ADDR`, `LOCAPROP`, `CAT`, `ACRESGL`, `REAL_FLV`, `LAND_LV`, `IMPRV_LV`, `GLYEAR`.

| `CAT` | Grand List category (Vermont Department of Taxes) | FactLot |
| ----- | ------------------------------------------------- | ------- |
| C     | Commercial                                        | F1      |
| CA    | Commercial apartment                              | B       |
| I     | Industrial                                        | F2      |

Definitions and statewide counts come from the Department of Taxes presentation "H.480: Property Categories in the Grand list" (Senate
Government Operations, 2023-04-14; <https://legislature.vermont.gov/Documents/2024/WorkGroups/Senate%20Government%20Operations/Bills/H.480/Witness%20Documents/H.480~Rebecca%20Sameroff~Grand%20List%20Categories~4-14-2023.pdf>),
which lists "Commercial 14,616", "Commercial Apartment 2,308" and "Industrial 890" and notes that categories "only exist for PVR's equalization
study" and follow "highest and best use". Not mapped: R1/R2 residential, MHU/MHL mobile homes, S1/S2 seasonal, F farm, W woodland, UE/UO
utilities, M miscellaneous, O other. The Department's own code list (`Category Codes.pdf` on tax.vermont.gov) now answers 404.

The layer has no county column; the adapter maps `TOWN` to a county with the 256-row `TOWN_COUNTY` table built from VCGI's town boundary layer
(`CNTY`: 1 Addison ... 27 Windsor, Vermont FIPS 50001-50027). All 246 distinct towns in the files matched.

## Gates

None.

## Real run

`snapshot` on 2026-11-03 (11 pages; first page `fl:document:sha256-cf8f24d07fa713640078ea1a03bfe8c20be1038388335e0541bb793d3bef6b1b`), then `vt_vcgi.build`
into the expansion registry:

```
python -m factlot.registry.adapters.vt_vcgi collected/vt-vcgi-parcels registry.db --as-of 2026-11-03
```

- Rows read: 19,342 distinct SPANs (20,400 polygons). Parcels kept: **19,342** in 14 counties: `B` 2,304, `F1` 16,191, `F2` 847.
- Facts written: 159,349. Errors: none. Seconds: about 50.
- Organisation owners stored: 12,357; natural persons or blank owners not stored: 6,985.
- Per county (B / F1 / F2): Addison 70/904/30; Bennington 99/1,201/65; Caledonia 115/1,076/38; Chittenden 701/2,661/180; Essex 19/173/6;
  Franklin 118/961/64; Grand Isle 7/158/1; Lamoille 123/733/24; Orange 89/708/30; Orleans 78/733/36; Rutland 196/1,965/126;
  Washington 278/1,724/86; Windham 189/1,438/91; Windsor 222/1,756/70.
- The layer's own category counts (stacked polygons included) are C 17,169, CA 2,393, I 879 (all 18,271 rows with a blank category and the rest
  are out of scope); the adapter's count is by distinct SPAN.

## Licence point

No licence is stated, only a disclaimer and "freely available". If a written statement is wanted, `vcgi@vermont.gov` can confirm that the
Grand List parcel layer may be redistributed as facts. Vermont law keeps grand lists public (32 V.S.A. ch. 123).

## Known gaps

- The Grand List category reflects highest and best use as the town's listers recorded it, not the current use; the Department says so itself.
- `REAL_FLV` is the listed real value (full), stored as the appraised value; Vermont lists at fair market value, but the layer does not say so,
  so it is not stored as a market value.
- No building area, no year built, no roll-year column other than `GLYEAR`; content year differs by town (`YEAR` 2018 to 2026 across pages).
- Condominium units and exempt property (churches, colleges) are not separated out by the category.
