# mt-msl-cadastral: Montana (55 counties), apartment and industrial parcels from the State Library's statewide cadastre

Reviewed 2026-11-03. Machine-readable copy: [`registry/sources/mt/mt-msl-cadastral.json`](../../../registry/sources/mt/mt-msl-cadastral.json).
Adapter: `factlot.registry.adapters.mt_msl` with the stdlib dBASE reader `dbf_reader` (account system `mt_orion_property_id`); tests
`python/tests/test_adapter_mt_msl.py`.

**Status: `verified: true`, partial.** The State Library offers the file free, with no licence and a mailing-list notice (below). The 2026 file does not
separate commercial parcels from other improved parcels, so only **apartments (B) and industrial property (F2)** are loaded; commercial (F1) is not.

## Publisher and URLs

- Publisher: Montana State Library, with the Montana Department of Revenue (ORION tax appraisal database) and, for Flathead, Missoula, Ravalli, Silver Bow and
  Yellowstone Counties, those counties' own parcel files. Data-list record: <https://mslservices.mt.gov/Geographic_Information/Data/DataList/datalist_Details.aspx?did={b2b3c906-8c40-4a9f-980e-48680a23c165}>
  ("Montana Parcels - Web Service", MSDI framework cadastral).
- File: `https://ftpgeoinfo.msl.mt.gov/Data/Spatial/MSDI/Cadastral/Parcels/Statewide/MTParcels_SHP.zip` (518,095,964 bytes, `Last-Modified` 2026-10-06; the same
  layer is `MTParcels_GDB.zip`, 249,250,816 bytes). Its attribute table `Montana_Parcels/Montana_Parcels.dbf` is 1,645,803,392 bytes (111 MB compressed) with
  920,986 records. `StatewideCama.zip` (80 MB, a file geodatabase) holds CAMA building tables and no owner. Metadata: `MontanaCadastral_ParcelMetadata.xml` in the same folder.

## Terms, licence, robots

- **Terms.** No licence. The record and the metadata say the data are "for informational purposes only", provided "in good faith" without warranty, and that the
  Library "reserves the right to change or revise published data". They add: "State law (Montana Code Annotated 2-6-109 (1)(a)) explicitly prohibits State agencies from
  selling or distributing a list of persons to be used as a mailing list without first securing the permission of those on the list ... (1)(b) also explicitly prohibits
  anyone from using a list of persons prepared by a state agency as a mailing list ... 'A person violating the provisions of subsection (1)(b) is guilty of a misdemeanor.'"
  (the XML metadata cites MCA 2-6-1017). The registry stores no natural-person owner names, is not a mailing list and offers no list of persons; it stores organisation
  owners and facts about parcels. AI use is not addressed. No login, form or fee.
- **robots.txt.** `ftpgeoinfo.msl.mt.gov` serves none (404). `mslservices.mt.gov` was read once (the record above).
- **The REST service is not used.** The State Library's ArcGIS REST service (`gisservice.mt.gov/ArcGIS/rest/services/msdi_cadastral_map_v1`) has a robots.txt that
  disallows `/arcgis/*` (host `gisservice.mt.gov`: `Disallow: /arcgis/*`, `/arcgishosting/*`, `/portal/*`). The research tool read that robots.txt first and its parser
  allowed `/ArcGIS/rest/...` (the rule is lower-case, the URL is mixed-case), so **one metadata request to `/ArcGIS/rest/services/msdi_cadastral_map_v1/MapServer?f=pjson`
  was made**; on reading the rule again it is plainly meant to cover that path, so no further request was made to that host and nothing was taken from it. A rule slip, no data.

## What the file contains

Key columns (shapefile names): `PARCELID` (17-character geocode), `COUNTYCD`, `CountyName`, `PropertyID`, `AddressLin`, `AddressL_1`, `CityStateZ`, `PropType`,
`TotalAcres`, `GISAcres`, `TotalBuild`, `TotalLandV`, `TotalValue`, `TaxYear`, `OwnerName`, `OwnerAddre`, `OwnerAdd_1`, `OwnerAdd_2`, `OwnerCity`, `OwnerState`,
`OwnerZipCo`, `DbaName`, `CareOfTaxp`. No year built, building area or confidentiality flag.

`PropType` counts in the file (the State Library metadata still lists the old two-letter codes `CU`, `CR`, `BU`, `BR`, `IU`, `IR`, `MU`, `MR`; the 2026 data uses words):

| `PropType`                                                                                                                                          | Rows    | FactLot    |
| --------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | ---------- |
| Apartment                                                                                                                                           | 6,060   | B          |
| Industrial Property (and the legacy `IR - Industrial Rural`, 18)                                                                                    | 1,468   | F2         |
| Improved Property (all improved parcels, residential and commercial)                                                                                | 429,780 | not mapped |
| Vacant Land, Exempt, Tribal, Mining Claim, Non-Valued, Townhouse, Condominium, Mobile/RV Parks, Gravel Pit, Golf Course, Centrally Assessed, others | rest    | not mapped |

## Gates

None for what is loaded. To add Montana's commercial parcels a person (or later work) joins the State Library's CAMA tables (`StatewideCama.zip`, file geodatabase
`StatewideCama.gdb`, which needs GDAL to read) to the parcels by `PropertyID`/`Assessment` for the improvement's commercial use, or asks the State Library
(`geoinfo@mt.gov`) which field marks commercial improved property.

## Real run

`collect.yml` on GitHub's network (run 41690576115, draft release `data-2026-11-03-41690576115`; sha256 checked against the manifest), then
`mt_msl.build` into the expansion registry (43 s):

```
python -m factlot.registry.adapters.mt_msl mt-msl-cadastral__255753a93929f441__MTParcels_SHP.zip registry.db --as-of 2026-10-06
```

- Snapshot: `fl:document:sha256-255753a93929f44139cf6a444a380f0fa162fd0244fa5e6b9cb6280f3e940e1b` (518,095,964 bytes).
- Rows read: 920,986; parcels stored: **7,546** in 55 of 56 counties: `B` 6,060, `F2` 1,486.
- Facts written: 60,337. Errors: none.
- Organisation owners stored: 4,241; natural persons or blank owners not stored: 3,305.
- Largest counties (B / F2): Gallatin 1,263/64; Cascade 985/61; Lewis and Clark 913/38; Flathead 851/63; Missoula 567/67; Yellowstone 357/192.

## Known gaps

- No commercial (F1) parcels; Montana's commercial stock sits in `Improved Property`.
- `Apartment` is the Department of Revenue's class and is not defined by unit count in the file.
- The file lags the counties by up to a month; Ravalli, Silver Bow, Missoula, Flathead and Yellowstone data come from the counties.
