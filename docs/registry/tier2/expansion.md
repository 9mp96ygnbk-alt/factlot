# Tier 2 expansion: Vermont, Minnesota, Arkansas, Montana and Connecticut statewide sources; North Carolina text-class counties; Garfield UT

Researched and loaded 2026-11-03 on the branch `data/tier2-expansion`. Rules and method: [README.md](README.md) and [../EXPANSION-BRIEF.md](../EXPANSION-BRIEF.md). Every count below comes
from a real run on the real file (collected with the project's collector, loaded into one scratch registry); nothing was bought, signed, requested, registered or submitted.

## Results

| State | Source id                                                                  | Counties in the load                                 | Commercial parcels (B / F1 / F2)                     | Owner names        | Licence basis                                                     |
| ----- | -------------------------------------------------------------------------- | ---------------------------------------------------- | ---------------------------------------------------- | ------------------ | ----------------------------------------------------------------- |
| VT    | [`vt-vcgi-parcels`](../sources/vt-vcgi-parcels.md)                         | 14 of 14 (all)                                       | 19,342 (2,304 / 16,191 / 847)                        | yes (12,357 org)   | none stated; disclaimer only; "freely available" (Parcel Program) |
| MN    | [`mn-opt-in-parcels`](../sources/mn-opt-in-parcels.md)                     | 24 of the 59 opt-in counties                         | 60,495 (9,017 / 38,316 / 13,162)                     | yes (36,373 org)   | counties opted in to open data; disclaimer only                   |
| AR    | [`ar-gis-parcels`](../sources/ar-gis-parcels.md)                           | 75 of 75 (all)                                       | 69,056 (0 / 67,049 / 2,007)                          | yes (41,144 org)   | none stated; disclaimer only                                      |
| MT    | [`mt-msl-cadastral`](../sources/mt-msl-cadastral.md)                       | 55 of 56                                             | 7,546 (6,060 / 0 / 1,486) (commercial not separable) | yes (4,241 org)    | none stated; disclaimer and a mailing-list notice                 |
| CT    | [`ct-parcel-cama-layer`](../sources/ct-parcel-cama-layer.md)               | {CT_COUNTIES} former counties                        | {CT_TOTAL}                                           | yes ({CT_ORG} org) | CC0 (publisher's ArcGIS item)                                     |
| NC    | [`nc-onemap-parcels`](../sources/nc-onemap-parcels.md) (five new counties) | Guilford, Forsyth, Cumberland, Johnston, New Hanover | 28,436 (2,735 / 20,561 / 5,140)                      | yes (20,284 org)   | NC OneMap free and unrestricted use policy                        |
| UT    | [`ut-ugrc-lir`](../sources/ut-ugrc-lir.md) (Garfield)                      | Garfield                                             | 188 (0 / 188 / 0)                                    | no                 | CC BY 4.0                                                         |

## What was reviewed and not loaded

| Source                                             | Result                                                                                                                                                                                                                                                                                |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Delaware (FirstMap State Parcels)                  | Layer `DE_StateParcels` has `PIN`, `ACRES`, `COUNTY` and nothing else: no owner, no use. The three counties' own portals were not reviewed.                                                                                                                                           |
| North Dakota (NDGISHUB Parcels)                    | 722,812 polygons with `CountyName`, `Ownership` (a code), acres and survey fields; no owner name and no land use. Not useful for the registry.                                                                                                                                        |
| West Virginia (WV GIS Technical Center)            | The clearinghouse dataset page (`wvgis.wvu.edu/data/dataset.php?ID=371`) renders nothing without JavaScript; the assessment viewer (`mapwv.gov/assessment`) is a lookup tool. No bulk file with owners and class was found. Needs a person to open the clearinghouse in a browser.    |
| Minnesota, Washington County and 34 other counties | Washington County's `useclass1` is a bare numeric code (`300`, `305`, `110`); Isanti, Morrison and Rice fold commercial, industrial and public utility into one class; Clay uses mixed multi-use strings. Hennepin is loaded from its own source. See the Minnesota record.           |
| Arkansas, undefined commercial codes               | `CR`, `CG`, `CA`, `CP`, `CB`, `IF`, `IA`, `IG` and others (about 6,500 parcels in the layer's counts: CR 2,306, CG 2,076, CA 726, CP 569, IF 420, CB 158, IA 174, IG 111) have no published definition; apartments have no code. The Assessment Coordination Division holds the list. |
| Montana, commercial parcels                        | The 2026 file lumps commercial into `Improved Property` with houses; the CAMA tables (`StatewideCama.zip`, file geodatabase) are the way in.                                                                                                                                          |
| NC: Durham, Union, Cabarrus, Onslow                | Durham's code list is on a robots-disallowed path; Union has only `COM` and `IND` and no improvement values to drop vacant land; Cabarrus and Onslow carry no class.                                                                                                                  |

## Gates for the founder

1. **Montana.** (a) The State Library's record warns that Montana law bars using a list of persons prepared by a public agency as a mailing list. The registry stores no natural-person names and is
   not a mailing list; decide that this is enough, or ask `geoinfo@mt.gov`. (b) To load commercial parcels: engineering work on the CAMA file geodatabase, or ask the State Library which field marks
   commercial improved property. (c) Rule slip: one request reached `gisservice.mt.gov/ArcGIS/rest/` before its robots.txt `Disallow: /arcgis/*` was understood to cover it (see the record).
2. **Vermont and Arkansas.** No licence is stated, only disclaimers ("freely available", a public statewide cadastre). Optional: `vcgi@vermont.gov` and the Arkansas GIS Office can confirm in writing
   that the parcel layers may be redistributed as facts. Arkansas: ask the Assessment Coordination Division (501-324-9240) for the current property type code list to add commercial, apartment and
   other codes.
3. **Minnesota.** Optional: ask Washington County (and MnGeo's mapping file for each county) for the use-class definitions.
4. **Connecticut.** The earlier gate (`ct-parcel-cama`, Open Data CT table with no licence field) is cleared for the layer on the publisher's own ArcGIS items, which state CC0. Decide the county
   code: the layer carries the former county (Fairfield 001 ... Windham 015); the Census now uses nine planning regions (09110 ...). Suppressed-owner records are blank in the layer; the registry
   never tries to recover them.
5. **North Carolina.** No gate for the five counties (text classes used as the county's definition; say if a code table should be required). Durham: a person reads the County's Land Use codes
   spreadsheet, or the County allows the bot; Union: ask for improvement values and a class table.
6. **Still gated from earlier reviews, unchanged:** Florida (terms), Cook, Philadelphia, Fulton, Maricopa, Wayne, Fairfax, King, Clark NV, Alameda, Riverside, San Bernardino, the Tennessee Comptroller,
   the purchase and records-request counties, and every paid entity register.

## Process notes

- The ArcGIS REST services used are the publishers' own query endpoints with `returnGeometry=false` and a class filter; every request was made with the collector's user agent, 2 seconds apart (the
  NC OneMap Hub export host asks for 60 seconds and the collector waits that long), and a host's robots.txt was read first. Montana's 518 MB zip was fetched on GitHub's network
  (`collect.yml`, draft release `data-2026-11-03-41690576115`) and downloaded with `gh release download`; every other file was fetched by the collector on the review machine, one at a time.
- Research lookups (item JSON, metadata, code tables, group-by counts) went through a small script that applies the collector's fetcher (robots.txt first, 2 seconds apart per host, the collector's
  user agent). Pages read this way: Vermont Department of Taxes presentation, VCGI metadata, Arkansas standards, Minnesota and Montana item pages and metadata. No account, form, login or CAPTCHA was touched.
- Adapter additions: `arcgis_pages.py` (shared page helpers), `dbf_reader.py` (stdlib dBASE reader for zipped shapefiles), `vt_vcgi.py`, `mn_opt_in.py`, `ar_gis.py`, `mt_msl.py`,
  `ct_parcel_cama.py`, and text-class support in `nc_onemap.py` (`key_field`, `prefixes`). `registry/normalize.py` was not touched.

## Rule slips (stated honestly)

- **Montana, robots.txt.** One metadata request (`/ArcGIS/rest/services/msdi_cadastral_map_v1/MapServer?f=pjson`) went to `gisservice.mt.gov` after its robots.txt was read, because the collector's parser
  treated the lower-case rule `Disallow: /arcgis/*` as not covering the mixed-case path. The rule is plainly meant to cover it. No data was kept from that host and no later request was made to it; Montana was loaded from the
  State Library's file download instead (`ftpgeoinfo.msl.mt.gov`, no robots.txt).
- **One download at a time.** The 518 MB Montana release asset (fetched from GitHub with `gh release download`, because the publisher's file was collected on GitHub's network) was still arriving while the five
  North Carolina Hub requests (a few MB in all) ran on the same connection. Nothing else overlapped with it; the Arkansas, Minnesota and Connecticut pages were collected one source at a time.
- No account, form, login, CAPTCHA, purchase or message was involved, and no AI model name appears in any file.
