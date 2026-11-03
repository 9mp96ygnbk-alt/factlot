# ar-gis-parcels: Arkansas (75 counties), commercial improved and industrial improved parcels

Reviewed 2026-11-03. Machine-readable copy: [`registry/sources/ar/ar-gis-parcels.json`](../../../registry/sources/ar/ar-gis-parcels.json).
Adapter: `factlot.registry.adapters.ar_gis` (account system `ar_countyid`, `<county FIPS>-<parcel id>`); tests
`python/tests/test_adapter_ar_gis.py`.

**Status: `verified: true`.** The publisher states no licence, only a warranty disclaimer; same basis as Pierce County WA and Vermont.
Only two property type codes have a published definition, so the load is the improved commercial and industrial parcels, not every
commercial-class record (see "Known gaps").

## Publisher and URLs

- Publisher: Arkansas Geographic Information Systems Office (AGISO), with the county assessors (the Arkansas GIS Board's statewide
  cadastre, Arkansas Code 15-21-502).
- Service: `https://gis.arkansas.gov/arcgis/rest/services/FEATURESERVICES/Planning_Cadastre/FeatureServer/0` `PARCEL_CENTROID_CAMP`
  (polygon twin: layer 6 `PARCEL_POLYGON_CAMP`); `maxRecordCount` 200. Metadata:
  <https://gis.arkansas.gov/metadata/HTML/asdi.planning_cadastre.PARCEL_POLYGON_CAMP_export.html>.
- Standards: Arkansas Digital Cadastral Mapping Standard 2019 revision
  (<https://gis.arkansas.gov/docs/CAMP/20191122_Cadastral_Mapping_Standard_Revision_approved_Oct2019.pdf>) and the 2004 standard SS-40
  (<https://gis.arkansas.gov/Docs/CAMP/Cad_standard_FINAL.pdf>), which holds the property type code table.

## Terms, licence, robots

- **Terms.** No licence. "Use constraints" and "Distribution liability" in the metadata: the data "are provided 'as is' without warranty of any
  kind ... The entire risk as to the quality and performance of the data is assumed by the user"; the Arkansas Geographic Information Systems
  Board "does not accept liability". Nothing restricts redistribution or AI use. The cadastre is "a statewide resource for digital cadastral
  data as defined by Arkansas Code 15-21-502". No login, form or fee.
- **robots.txt.** `gis.arkansas.gov/robots.txt` answers HTTP 200 with the site's HTML page (no rules), so nothing is disallowed.

## What the file contains

347 pages (`returnGeometry=false`, `objectid` order, 200 features each; 39,216,542 bytes in all) of the records whose `parceltype` is `CI`
or `II` (69,331 rows; 69,058 distinct `(countyfips, parcelid)`). Key columns (lower case in the service): `countyfips`, `parcelid`, `countyid`,
`ownername`, `adrlabel`, `adrcity`, `adrzip5`, `parceltype`, `landvalue`, `impvalue`, `totalvalue`, `assessvalue`, `camadate`, `pubdate`.
There is no owner mailing address, acreage, year built or confidentiality flag.

| `parceltype`                       | Definition (2004 standard SS-40, "Property Type Code")                  | FactLot | Rows (layer count) |
| ---------------------------------- | ----------------------------------------------------------------------- | ------- | ------------------ |
| CI                                 | Commercial Improved                                                     | F1      | 67,309             |
| II                                 | Industrial Improved                                                     | F2      | 2,022              |
| CM, CV                             | Commercial Miscellaneous, Commercial Vacant (not mapped)                | -       | 2,270; 20,609      |
| IM, IV                             | Industrial Miscellaneous, Industrial Vacant (not mapped)                | -       | 35; 1,305          |
| RI, RV, AI, AV, EX, PS, MN, MH ... | residential, agricultural, exempt, public service, mineral, mobile home | -       | not loaded         |

The layer also carries `CR` (2,306), `CG` (2,076), `CA` (726), `CP` (569), `CB` (158), `IF`, `IA`, `IG`, `IB`, `I9` and others that no
published table defines (the 2019 standard says "a list of approved property type codes is available from the Arkansas Assessment Coordination
Department"). They are not mapped. `totalvalue` (land plus improvement) is stored as the market value; `assessvalue` is 20% of it and is not stored.

## Gates

None for what is loaded. To widen the load to the undefined commercial codes (`CR`, `CG`, `CA`, `CP`, `CB`, `IF`, `IA`, `IG`) and to find
apartments, a person asks the Arkansas Assessment Coordination Division (1900 W. 7th St., Little Rock; 501-324-9240; arkansasassessment.com) for
the current property type code list.

## Real run

`snapshot` on 2026-11-03 (347 pages, all archived; first page `fl:document:sha256-cec69a76e3287d90fa7fa824fac6eec7fd07ecd542a71c37badc7fbd5261c34c`),
then `ar_gis.build` into the expansion registry (88 s):

```
python -m factlot.registry.adapters.ar_gis collected/ar-gis-parcels registry.db --as-of 2026-11-03
```

- Rows read: 69,058 distinct parcels (69,331 rows; 273 repeated county parcel ids dropped). Parcels stored: **69,056** in 75 counties: `F1` 67,049,
  `F2` 2,007 (two ids that differ only by punctuation share one registry key).
- Facts written: 385,534. Errors: none.
- Organisation owners stored: 41,144; natural persons or blank owners not stored: 27,912.
- Largest counties: Pulaski 9,366; Benton 5,152; Washington 4,415; Sebastian 3,918; Craighead 3,456; Cumberland-class counties follow (Faulkner, Garland, Saline,
  Crawford, Lonoke).

## Known gaps

- The 2004 table is 22 years old and the 2019 standard defers to a list that is not published; `CI` and `II` are the only commercial and industrial
  improved codes with a published definition. Commercial vacant (`CV`, 20,609) is out of scope by design.
- Apartments and multifamily have no code of their own, so no parcel is `B`; large apartment complexes sit inside `CI`.
- Publication is semi-annual and county by county; a county's `camadate` says when AGISO received its CAMA data.
