# ny-nyc-dcp-pluto: New York City Department of City Planning, PLUTO

Review record for the source `ny-nyc-dcp-pluto` (data policy §5). Reviewed 2026-11-03. Machine-readable
copy: [`registry/sources/ny/ny-nyc-dcp-pluto.json`](../../../registry/sources/ny/ny-nyc-dcp-pluto.json).
Adapter: `python/src/factlot/registry/adapters/ny_pluto.py`; tests: `python/tests/test_adapter_ny_pluto.py`.

PLUTO (Primary Land Use Tax Lot Output) is DCP's tax-lot file: one row per tax lot (one per condominium
complex, under its billing lot), built from the Department of Finance roll plus DCP's zoning, landmark
and land-use layers. It is an **enrichment** source: it creates no parcels. Its facts attach to the
commercial, industrial and multifamily lots the DOF roll ([ny-nyc-dof](ny-nyc-dof.md)) already put in
the registry, matched by borough-block-lot (the `nyc_bbl` account, the parcel APN).

## Publisher and URLs

- Publisher: New York City Department of City Planning (DCP).
- Dataset: NYC Open Data `64uk-42ks` "Primary Land Use Tax Lot Output (PLUTO)",
  <https://data.cityofnewyork.us/City-Government/Primary-Land-Use-Tax-Lot-Output-PLUTO-/64uk-42ks>;
  metadata at `https://data.cityofnewyork.us/api/views/64uk-42ks.json` (the collector's landing page).
  Version **26v2**, 858,284 lots, "data last updated" 2026-08-24 (`rowsUpdatedAt`), update frequency
  quarterly. The dataset attributes itself to "Department of City Planning (DCP)" and says all earlier
  versions are on DCP's Bytes of the Big Apple.
- File used: one request to the SODA endpoint, `https://data.cityofnewyork.us/resource/64uk-42ks.csv`
  with a `$select` of the 38 columns the adapter reads (no owner name, no lot polygon, no address) and a
  `$where` on `starts_with(bldgclass, ...)` for the building-class letters that can hold commercial,
  industrial or multifamily lots (C, D, E, F, G, H, I, J, K, L, O, R, S: 245,602 lots), ordered by BBL,
  `$limit=500000`. Archived by the collector on 2026-11-04 (UTC): 56,595,463 bytes in 38 seconds, document
  `fl:document:sha256-0c1fe1a88591dcc7468b100cff53355e5f3d7eb8e52dba3cc1b0bd2aff2ceab7`.
- Not used: DCP's own copy on nyc.gov ("Bytes of the Big Apple"). The page `dwn-pluto-mappluto.page`
  now redirects to a JavaScript page whose file links the collector cannot read, and the guessed
  `s-media.nyc.gov` file names answer 404. The `db-pluto` build mirror on DigitalOcean Spaces
  (`edm-publishing.nyc3.digitaloceanspaces.com`) answers HTTP 403 to every request, including
  `robots.txt`; it was not worked around.

## Terms, license, robots

- **NYC Open Data terms.** The NYC Open Data FAQ (<https://www.nyc.gov/opendata/get-started/FAQs>, read again
  2026-11-03), under "Are there restrictions on how I can use Open Data?": "Open Data belongs to all New
  Yorkers. There are no restrictions on the use of Open Data." The dataset has no licence field of its own.
  The Open Data Law (Admin. Code §23-502) point is the one recorded in `ny-nyc-dof` (the code text is behind a
  JavaScript challenge; a person should confirm it once).
- **DCP's disclaimer** (the db-pluto README that DCP publishes): "DCP provides PLUTO for informational
  purposes only. DCP does not warranty and is not liable for the completeness, accuracy, content, or fitness
  for any particular purpose or use of PLUTO." The licence stored on every fact carries it.
- **AI use:** not addressed by the publisher; "no restrictions on the use" is the operative statement. Recorded
  `unknown`, as for the DOF roll. **Redistribution:** permitted. **Attribution:** New York City Department of
  City Planning (DCP), PLUTO.
- **Platform terms.** The file is served by Socrata (Tyler Technologies). Tyler's Terms of Use forbid
  scrapers and bulk copying of data "accessed through the Services" and commercial redistribution of the
  Services; the tension with the agency licence is the one recorded for the DOF roll and in
  [`../requests/platform-terms/socrata.md`](../requests/platform-terms/socrata.md). It is the founder's call
  (rely on the agency licence, or ask DCP to confirm that it governs bulk exports); the collector made one
  request for this file and nothing was accepted.
- **robots.txt** `data.cityofnewyork.us`: `Crawl-delay: 1`; only `/browse?...` search and filter pages are
  disallowed (not used). The collector waits 2 seconds between requests and identified itself as
  `FactLotRegistryBot/0.1` with a contact address. No account, key, login, click-through or CAPTCHA.
- `verified: true`.

## What the adapter reads and writes

The adapter reads these columns and no others (`ny_pluto.COLUMNS`). The CSV is UTF-8 with a lower-case header
row; `bbl` is written as a decimal (`1000010010.00000000`); the split-zone flag is `true`/`false`; zeros mean
"none listed" and are not stored. Every fact is `public_record`, cites the file's document ID and the line and
BBL (`line 11441 BBL 1008350041 (PLUTO 26v2)`), and carries the source's rights.

| Predicate                                                                                             | From                                                                                                   | Value                                                                                                                                                                                                                                                                                      |
| ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `zoning.district`                                                                                     | `zonedist1`                                                                                            | the lot's (primary) zoning district, `C5-3`, `R6B`, `M1-1`                                                                                                                                                                                                                                 |
| `zoning.other_districts`                                                                              | `zonedist2`-`4`                                                                                        | list; only for lots a district boundary splits                                                                                                                                                                                                                                             |
| `zoning.split_zone`                                                                                   | `splitzone`                                                                                            | `true` when DCP flags a split lot (written only when true)                                                                                                                                                                                                                                 |
| `zoning.commercial_overlay`                                                                           | `overlay1`-`2`                                                                                         | list, `C1-3`                                                                                                                                                                                                                                                                               |
| `zoning.special_district`                                                                             | `spdist1`-`3`                                                                                          | list, `MiD`                                                                                                                                                                                                                                                                                |
| `zoning.limited_height_district`                                                                      | `ltdheight`                                                                                            | `LH-1`                                                                                                                                                                                                                                                                                     |
| `zoning.e_designation`                                                                                | `edesignum`                                                                                            | `E-299`                                                                                                                                                                                                                                                                                    |
| `zoning.max_far_residential`, `_commercial`, `_facility`, `_manufacturing`, `_affordable_residential` | `residfar`, `commfar`, `facilfar`, `mnffar`, `affresfar`                                               | maximum floor-area ratio the zoning allows                                                                                                                                                                                                                                                 |
| `parcel.built_far`                                                                                    | `builtfar`                                                                                             | built floor-area ratio (DCP's figure)                                                                                                                                                                                                                                                      |
| `parcel.num_buildings`, `parcel.num_floors`                                                           | `numbldgs`, `numfloors`                                                                                | buildings on the lot; floors of the tallest one (may be fractional)                                                                                                                                                                                                                        |
| `parcel.units_residential`, `parcel.units_total`                                                      | `unitsres`, `unitstotal`                                                                               | counts                                                                                                                                                                                                                                                                                     |
| `parcel.area_by_use_sf` (unit `sf`)                                                                   | `comarea`, `resarea`, `officearea`, `retailarea`, `garagearea`, `strgearea`, `factryarea`, `otherarea` | object of the positive areas by use                                                                                                                                                                                                                                                        |
| `parcel.land_use_code`                                                                                | `landuse`                                                                                              | DCP's 2-digit category (01 one and two family, 02 multifamily walk-up, 03 multifamily elevator, 04 mixed residential and commercial, 05 commercial and office, 06 industrial and manufacturing, 07 transportation and utility, 08 public facilities, 09 open space, 10 parking, 11 vacant) |
| `parcel.year_altered`                                                                                 | `yearalter1`, `yearalter2`                                                                             | the later year                                                                                                                                                                                                                                                                             |
| `parcel.historic_district`                                                                            | `histdist`                                                                                             | the district's name                                                                                                                                                                                                                                                                        |
| `parcel.landmark_designated`                                                                          | `landmark`                                                                                             | `true` when filled in; the designation's name is **not** stored (some landmarks are named for people)                                                                                                                                                                                      |

Not written: lot area, building area and year built. PLUTO's `lotarea`, `bldgarea` and `yearbuilt` are DOF's
figures, which the DOF roll already supplies as `parcel.land_area_sf`, `parcel.improvement_area_sf` and
`parcel.year_built`; a second copy would be a second source for the same number, and the registry's reader
returns one fact per single-valued predicate. Owner name and owner type are never selected. Lot polygons
(`geom`) and coordinates are not selected: the registry stores no geometry.

## Real run (2026-11-04)

Scratch registry (not the repo): `…/scratchpad/data/zs/zs.db`, built by loading the archived FY27 DOF roll
(`ny_nyc`, 164,633 lots, 72 s) and then PLUTO:

```
python -m factlot.registry.adapters.ny_pluto 64uk-42ks.csv zs.db --as-of 2026-08-24 --retrieved-at 2026-11-04T03:51:37+00:00
```

| Measure                                        | Count                                                                                                    |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| PLUTO rows read (valid BBL, at least one fact) | 245,596 of 245,602 (6 had nothing to say)                                                                |
| Matched to a DOF-roll parcel in the registry   | 116,887                                                                                                  |
| Skipped: not a parcel the registry holds       | 128,709 (one-to-four family with a store, vacant, institutional and other classes the registry excludes) |
| Invalid, errors, retired                       | 0, 0, 0                                                                                                  |
| Facts written                                  | 1,349,335                                                                                                |
| Seconds                                        | 45                                                                                                       |

Of the 164,633 registry parcels, **116,887 (71%) now carry PLUTO facts**; 47,746 do not. By DOF building-class
letter, nearly all the gap is condominium units: R (condominium unit lots) 154 of 47,394 matched, because
PLUTO has one row per condominium _complex_ under its billing lot and no row for a unit lot; every other
class group is matched at 99.5% or better (C 47,066 of 47,149; D 15,593 of 15,832; K 18,686 of 18,726; G 10,556
of 10,635; O 7,166 of 7,196; E 6,039 of 6,056; S 5,879 of 5,882; F 3,245 of 3,248; I 1,170 of 1,174; H 1,135 of
1,142; J 198 of 199). The unit-to-billing-lot mapping is not in the roll; it is in DOF's Digital Tax Map
condominium data and is a follow-up.

Facts by predicate: `parcel.land_use_code` 116,815; `zoning.district` 116,608; `zoning.max_far_facility`
113,751; `parcel.num_buildings` 112,475; `parcel.built_far` 111,409; `parcel.units_total` 111,230;
`parcel.num_floors` 111,168; `parcel.area_by_use_sf` 110,396; `zoning.max_far_residential` and
`_affordable_residential` 101,689 each; `parcel.units_residential` 74,223; `parcel.year_altered` 40,256;
`zoning.max_far_commercial` 32,656; `zoning.commercial_overlay` 29,499; `zoning.special_district` 17,918;
`zoning.max_far_manufacturing` 17,004; `parcel.historic_district` 10,125; `zoning.e_designation` 6,625;
`zoning.split_zone` 6,232; `zoning.other_districts` 6,005; `zoning.limited_height_district` 1,006;
`parcel.landmark_designated` 556.

Spot check: the Empire State Building lot (BBL 1008350041) reads `zoning.district` C5-3 with C6-4.5 as the
other district and `zoning.split_zone` true, `parcel.num_floors` 102, `parcel.built_far` 30.79, area by use 2,812,739
commercial of which 2,685,483 office, in the special district MiD, landmark designated.
`python -m factlot.registry.audit` on the scratch file reports no violation and no citation gap for the source
(the audit counts a source's parcels by `parcel.apn`, so it shows 0 parcels for this enrichment source).

## Known gaps

- Condominium unit lots (47,240 registry parcels, mostly commercial condominium units) have no PLUTO row of their
  own; the billing-lot mapping is a follow-up.
- Zoning is the lot's PLUTO assignment, not a zoning verification; DCP says to check ZoLa and the Zoning Resolution
  for any decision. A split lot lists every district but PLUTO does not say how much of the lot lies in each.
- A PLUTO row stays as published: `numfloors` is the tallest building's floor count, and `areasource`-level caveats
  (how DCP derived building area) are not carried.
- One version (26v2) is loaded. A re-run on 26v3 replaces zoning facts for the lots it lists and retires lots it
  no longer lists (`full_roll`); earlier values stay as history.
