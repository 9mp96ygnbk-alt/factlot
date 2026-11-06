# pa-montgomery-parcels: Montgomery County, PA, parcels with assessment attributes (county GIS portal)

Review record for the source `pa-montgomery-parcels` (data policy §5). Reviewed 2026-11-03. Machine-readable
copy: [`registry/sources/pa/pa-montgomery-parcels.json`](../../../registry/sources/pa/pa-montgomery-parcels.json).
Adapter: `python/src/factlot/registry/adapters/pa_montgomery.py` (account system `montco_taxpin`, FIPS
42091); tests: `python/tests/test_adapter_pa_montgomery.py`. **Owner names are present** (`OWN1`, with the
owner's mailing address).

## Publisher and URLs

- Publisher: Montgomery County, Pennsylvania: the Board of Assessment Appeals keeps the assessment
  database and Data & Mapping Services publishes the parcel layer on the county's ArcGIS Hub
  (<https://gis-montcopa.hub.arcgis.com/>, with the county's own front page at
  <https://gis.montcopa.org/opendata/index.html>). County pages:
  <https://www.montgomerycountypa.gov/departments/board-assessment-appeals/property-data-data-requests>
  and <https://www.montgomerycountypa.gov/departments/data-mapping-services/core-datasets/parcels>
  (updated monthly; 2026 dates 2/4, 3/4, 4/6, 5/5, 6/4, 7/2, 8/4, 9/3, 10/5, 11/12, 12/21).
- Item: "Montgomery County Parcels", ArcGIS item `228cad7975554088a350bee4caf3ca45`, layer 6, feature service
  `https://services1.arcgis.com/kOChldNuKsox8qZD/arcgis/rest/services/Montgomery_County_Parcels/FeatureServer/6`
  (310,132 features, 122 fields, `maxRecordCount` 1,000, last modified 2026-10-05). The county describes it as
  "Parcel boundaries and property assessment information for Montgomery County, Pennsylvania. The data
  is a download from the county's assessment database and is updated monthly."
- Files archived: the Hub's CSV download with the `where` parameter, one file per `CLASS`:
  `https://gis-montcopa.hub.arcgis.com/api/download/v1/items/228cad7975554088a350bee4caf3ca45/csv?layers=6&where=CLASS%3D%27A%27`
  (and `C`, `I`), each answering `302` to `hub.arcgis.com/api/v3/datasets/<item>_6/downloads/data?format=csv...`.

  | CLASS          | Rows   | Distinct `TAXPIN` | Bytes     | Document id (sha256 prefix) |
  | -------------- | ------ | ----------------- | --------- | --------------------------- |
  | `A` apartment  | 692    | 678               | 554,924   | `14b606a871eba761`          |
  | `C` commercial | 12,393 | 12,244            | 9,664,071 | `23caa211dc4bd7ad`          |
  | `I` industrial | 2,705  | 2,662             | 2,109,102 | `2a208007c010b7d5`          |

  Row counts equal the feature service's per-class counts (`A` 692, `C` 12,393, `I` 2,705 on 2026-11-03).

- Not used: a second item, "Montgomery County Assesment Table" (`28b14b8c2b594b5d9a813bef53b81e96`; all
  assessment records without geometry, more rows than the GIS parcels) and a monthly change table
  (`ace9a55256554bf089e71558055fb2d2`), the county's "Parcel Codes" PDF excepted (below).

## Terms, license, robots

- Licence shown on the Hub item: **Custom License**: "Montgomery County provides this data as a free and
  open resource. While every reasonable effort is made to ensure the accuracy and completeness of the
  data, Montgomery County makes no representations about the suitability of this data for any purpose.
  All data is provided 'as is' without warranties of any kind, either express or implied, and it should
  not be construed or used as a legal description." The Board of Assessment Appeals page adds that these
  datasets "are available, in a variety of formats, at no charge through the County's Open Data Portal".
  The county's catalog record on data.pa.gov ("Montgomery County GIS Open Data Portal", `u6n2-nimu`) shows
  the licence "Public Domain U.S. Government". (Found by search; not fetched.)
- AI use: not addressed. Redistribution: no restriction stated; the data is a public record offered as a
  "free and open resource". **Judgement call recorded:** the custom licence does not say "public domain" or
  "redistribution", so a one-line confirmation from the Board of Assessment Appeals would settle it
  (`BOA.datarequests@montgomerycountypa.gov` is the data contact); it is `verified: true` because
  nothing forbids redistribution or AI use and the county calls the data free and open.
- robots.txt: `gis-montcopa.hub.arcgis.com` and `hub.arcgis.com`: `Crawl-delay: 60`, `Disallow: /sites/`,
  `/admin/`, `/sessions/`, `/groups/`, `/people/`, `/workspace/` (the download API is allowed).
  `services1.arcgis.com/robots.txt` answers 403 (no rules); `www.montgomerycountypa.gov` disallows
  `/events`, `/news`, `/search`, `/admin`, `*.pdf` and similar, none of which this config touches.
  `gis.montcopa.org/robots.txt` answers an ArcGIS error page.
- `verified: true`: terms and robots read and recorded; the file URLs are confirmed by real downloads
  through the collector (all three `archived`); no restriction on redistribution or AI use.

## What the file contains

The Hub CSV of layer 6: 122 columns (a UTF-8 byte-order mark, then the feature fields), one row per
parcel feature. A parcel drawn as several polygons repeats with identical attributes (14, 149 and 43 repeated
rows in the three files), so the adapter keeps the first row per `TAXPIN`. Columns used:

| Column                                                             | Use                                                                                         |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| `TAXPIN`                                                           | 12-digit parcel id (APN)                                                                    |
| `PARCELTYPE`                                                       | `BASE PARCEL`, `CONDOMINIUM`, `COMMON AREA`, `PRIVATE ROAD`, `RAILROAD`, `OTHER` (all kept) |
| `CLASS`, `LAND_USE`                                                | Class letter and four-digit land use code (→ `local_use_code`)                              |
| `OWN1`, `ADDR1`, `ADDR2`, `ADDR3`, `ZIP1_ZIP2`                     | Owner of record and mailing address. `OWN2` (co-owner) and `CAREOF` are not copied          |
| `LOCATION1`, `LOC_UNITDE`, `LOC_UNITNO`, `Muni_Name`, `LOC_ZIP1_Z` | Situs: street address, unit, municipality name (the "city"), ZIP (often blank)              |
| `LAND_SF`, `LAND_ACRES`                                            | Land area (acres × 43,560 when square feet is 0)                                            |
| `COMM_AREA`, `COMM_YR_BL`, `YEAR_BUILT`                            | Commercial gross building area; commercial year built, else dwelling year built             |
| `TOTAL_APPR`, `TOTAL_ASSE`                                         | Total appraised value (→ `market_value`); total assessed value (→ `appraised_value`)        |

`TOTAL_APPR` equals `TOTAL_ASSE` on 12,330 of 12,393 `C` rows and on all `A` and `I` rows: the county assesses at the
appraised value, and both are base-year values, not current market value.

Class mapping (`state_category`; the county's "Parcel Codes" PDF, item `c47e63a20eba41f69d370e6f4498bdbb`,
defines the letters):

| `CLASS`                   | Publisher's definition                                                          | Category |
| ------------------------- | ------------------------------------------------------------------------------- | -------- |
| `A`                       | Apartment: "multifamily use, five or more families"                             | `B`      |
| `C`                       | Commercial: "properties devoted to trade, services, and recreational uses"      | `F1`     |
| `I`                       | Industrial: "properties devoted to manufacturing and/or processing of products" | `F2`     |
| `R`, `E`, `U`, `F`, blank | Residential (one to four families), exempt, utility, agricultural               | none     |

Land use codes (four digits, kept as `local_use_code`): the PDF lists, for example, `4200`-`4216`
apartments, `4220`-`4850` commercial uses, `3000`-`3503` industrial, `2200`-`2213` commercial vacant land,
`4100` "retail, office, apartments, multi-use", `1140` "residential conversion 5 or more apartments" and
`1160` "residential/commercial non-conforming" (the county files the last two under class `C`).

## Gates

None for the data. Two things a person should know:

1. **The Hub download is generated on demand.** The first request for each `where` URL answers `202`
   with `{"message":"Up to date download file is being generated... ","status":"Pending"}`; the collector
   would archive that body. Request each URL once and snapshot a few minutes later (the files stay cached
   while the layer is unchanged; the three were primed on 2026-11-03 and archived correctly). A run
   that finds a JSON file instead of a CSV should be repeated.
2. **The Hub honours `Crawl-delay: 60`**, so the collector takes about two minutes a file.

## Real run

Run 2026-11-03 on the three archived files (`collected/pa-montgomery-parcels/<sha16>/Montgomery_County_Parcels.csv`),
each loaded with `python -m factlot.registry.adapters.pa_montgomery <file> registry.db --as-of 2026-10-05`
(the item's last-modified date) into a fresh SQLite file:

| Class (file) | Rows read / distinct `TAXPIN` | Parcels kept | Owners (organisations stored; persons or withheld) | Facts written | Seconds |
| ------------ | ----------------------------- | ------------ | -------------------------------------------------- | ------------- | ------- |
| `A`          | 692 / 678                     | 678 `B`      | 678 (548; 130)                                     | 7,191         | 0.2     |
| `C`          | 12,393 / 12,244               | 12,244 `F1`  | 12,244 (7,711; 4,533)                              | 120,117       | 3.2     |
| `I`          | 2,705 / 2,662                 | 2,662 `F2`   | 2,662 (1,962; 700)                                 | 26,516        | 0.9     |
| **Total**    | **15,790 / 15,584**           | **15,584**   | **15,584 (10,221; 5,363)**                         | **153,824**   | 4.3     |

- Present among the kept parcels: situs 15,584; land area 15,499; commercial building area 11,870; year
  built 13,168; market value and assessed value 15,255 each. Invalid ids, errors, retired: 0, 0, 0.
- `PARCELTYPE` in the rows read: `BASE PARCEL` 14,661, `CONDOMINIUM` 905, `COMMON AREA` 191, `PRIVATE ROAD` 19,
  `RAILROAD` 12, `OTHER` 2.
- Snapshot document ids (`fl:document:sha256-` plus the file's sha256): `14b606a871eba761…` (A),
  `23caa211dc4bd7ad…` (C), `2a208007c010b7d5…` (I); full ids in the collector manifest.

## Full load (2026-11-03)

Release `data-2026-11-03-41603209834` (draft, maintainers only) of `9mp96ygnbk-alt/factlot`. Each asset's sha256 was checked against the manifest and its first 16 hex characters against the name. Loaded into the Tier 2 scratch registry (one SQLite file shared by every Tier 2 source, `ct-sos-entities` first).

Assets (document id from the manifest):

- `pa-montgomery-parcels__14b606a871eba761__Montgomery_County_Parcels.csv` (554,924 bytes): `fl:document:sha256-14b606a871eba7619cbeec7017f6c9f3bda1d062a510e79ae2685f9c3d979a61`
- `pa-montgomery-parcels__23caa211dc4bd7ad__Montgomery_County_Parcels.csv` (9,664,071 bytes): `fl:document:sha256-23caa211dc4bd7ad3c29da88118e89f5b9d7b23611a1ec340fe9d2ddbb2f4708`
- `pa-montgomery-parcels__2a208007c010b7d5__Montgomery_County_Parcels.csv` (2,109,102 bytes): `fl:document:sha256-2a208007c010b7d50b9f6852e0b1216c5178340ce01b5cbf40eb7ad93016ddae`

Command:

```
PYTHONPATH=python/src python3 -m factlot.registry.adapters.pa_montgomery <class csv> registry.db --as-of 2026-10-05 --retrieved-at <manifest checked_at>   # once per class file (A, C, I), no --full-roll
```

- Rows read: 15,790 data rows (class `A` 692, `C` 12,393, `I` 2,705); 15,584 distinct `TAXPIN`s.
- Parcels kept: **15,584** distinct commercial parcels (`B` 678, `F1` 12,244, `F2` 2,662).
- Facts written: 153,780. Seconds: 10.4. Invalid ids, errors, retired: 0, 0, 0.
- Organisation owners stored (current owner-of-record facts): 10,199; natural persons or withheld owners not stored (names not kept): 5,385.
- Ownership links to registered entities after `link_owners()`: 51 (the only entity registry in the scratch file is `ct-sos-entities`).

## Known gaps

- **Common-area and private-road parcels** are kept when the county classes them `A`/`C`/`I`; they carry
  an owner (often an association) and usually no value. 191 common-area and 19 private-road rows were read.
- **Condominium units** (905 rows) are separate `TAXPIN`s with the building's situs.
- **Five-or-more-unit conversions filed as residential** (land use `1140` under class `R`, if any) would be missed: the county's own class letter is the test used.
- **Base-year values.** `TOTAL_APPR`/`TOTAL_ASSE` are not current market value.
- **Situs "city" is the municipality** (`Ambler Borough`), not the postal city, and the ZIP is blank on many
  rows, so address matching on city/ZIP will miss; street and number match.
- **No tax year** column in the layer; `tax_year` is `None`.
- **Owner mailing addresses** are the address on file at the last `OWN_INFO_C` change date; some owners are
  persons and are dropped by the registry (5,363 of 15,584 here).
- The assessment table item (more records than the GIS layer) was not examined for parcels that have no
  polygon.

## Tier 1 audit (2026-11-06)

Lane A6 collected the three class files again. Each is the same sha256 as the full load above, and the live feature service still counts class A 692, C 12,393 and I 2,705. `dataLastEditDate` is still 2026-10-05 15:19 UTC, so `--as-of` stays **2026-10-05**. Parcels kept **15,584** (B 678, F1 12,244, F2 2,662). Audit violations 0, person-like owner facts 0. A rebuild with the current owner rule stores 10,246 organisation owners; the real-run table above, on these same files, recorded 10,221. Evidence: [pa-montgomery-parcels.md](../quality/surge-2026-11/pa-montgomery-parcels.md) and [pa-montgomery-parcels-audit.json](../quality/surge-2026-11/pa-montgomery-parcels-audit.json). The item `licenseInfo`, re-read the same day, is still the "free and open resource" paragraph quoted under Terms.
