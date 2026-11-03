# Tier 2: the next 61 counties (research brief and index)

Tier 1 covered the largest commercial markets (see [sources/README.md](../sources/README.md)).
Tier 2 extends the registry to every other county in the top 100 US counties by 2025 resident
population, plus the state entity registries those counties need for owner resolution.

## How the list was made

- Ranking: U.S. Census Bureau, Vintage 2025 county population estimates,
  `https://www2.census.gov/programs-surveys/popest/datasets/2020-2025/counties/totals/co-est2025-alldata.csv`
  (column `POPESTIMATE2025`), downloaded 2026-11-03.
- Population is a proxy for commercial property value: it is public, citable and the same for
  every state. It misses a few dense commercial cores that are separate from their counties
  (Baltimore City, St. Louis City, the Virginia independent cities); those are listed under
  "Also consider" for a later pass.
- Counties already reviewed in Tier 1 are excluded, including every Florida county (the Florida
  Department of Revenue roll covers all 67; it is gated on terms) and the five New York City
  boroughs.

## Regions

| Region file                    | Counties (rank by population)                                                                                                                                                              | Statewide sources to check first                                                                                                      |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| [texas.md](texas.md)           | Denton (46), Fort Bend (56), Hidalgo (64), El Paso TX (70), Montgomery TX (86), Williamson (90)                                                                                            | Appraisal-district exports in the same formats as Tier 1 Texas; the Comptroller entity file is already loaded                         |
| [ny-nj-ct.md](ny-nj-ct.md)     | Suffolk NY (27), Nassau (30), Westchester (50), Erie (59), Monroe NY (91); Bergen (55), Essex NJ (66), Middlesex NJ (69), Hudson (96); Capitol Planning Region CT (51)                     | NY ORPTS assessment rolls; NJ MOD-IV tax list; CT CAMA and parcel data on data.ct.gov; NJ and CT entity registries                    |
| [md-pa-ma.md](md-pa-ma.md)     | Montgomery MD (45), Prince George's (57), Baltimore County (75); Allegheny (39), Montgomery PA (71); Middlesex MA (20), Worcester (67), Essex MA (78), Norfolk (95)                        | Maryland SDAT real property and business entity data; MassGIS statewide parcels with assessor attributes; Pennsylvania county portals |
| [midwest.md](midwest.md)       | Franklin OH (32), Cuyahoga (38), Hamilton OH (76); Oakland (34), Macomb (68); Marion IN (52); Milwaukee (63); DuPage (61), Lake IL (98), Will (99); St. Louis County (53), Jackson MO (97) | Ohio county auditors; Michigan county portals; IndianaMap parcels; Wisconsin statewide parcels (V-series); OH, IN, WI, MO entity data |
| [southeast.md](southeast.md)   | Wake (36); Gwinnett (49), Cobb (84), DeKalb (87); Shelby (65), Davidson (92); Jefferson KY (83); Oklahoma County (81), Tulsa (100)                                                         | NC OneMap; Tennessee Comptroller assessment data; GA, TN, KY, OK entity data                                                          |
| [california.md](california.md) | Sacramento (23), Contra Costa (41), Fresno (48), Kern (62), Ventura (77), San Joaquin (80), San Mateo (93)                                                                                 | County assessor open-data portals (California owner names are often withheld from free files)                                         |
| [west.md](west.md)             | Salt Lake (40), Utah County (88); Pima (44); Pierce (60), Snohomish (74); Multnomah (82); El Paso CO (89); Honolulu (54)                                                                   | UGRC statewide parcels (Utah); Washington statewide parcels; Oregon, Utah, Hawaii and Colorado entity data                            |

Also consider (not in the population top 100 or not counties): Baltimore City MD, St. Louis City
MO, Arlington VA, Alexandria VA, Richmond VA, Orleans Parish LA, Jefferson AL (108), Bernalillo NM
(107), Kent MI (103), Providence RI (102), Arapahoe CO (105).

## Results (2026-11-03)

28 of the 61 counties are **verified** (licence permits redistribution; files confirmed by a real
request) and have adapters; 33 are gated on something only a person can do, listed with the one
action each needs in its region file. Counts below are **full loads** (2026-11-03): every
file the weekly collector archived from GitHub's network (draft release
`data-2026-11-03-41603209834`) was loaded in full into one scratch registry, entity registry first,
then `purge_person_owners()` and `link_owners()` once. Each source's review record has a "Full load
(2026-11-03)" section with the assets, document ids, command and counts. The one exception to the
release is `ga-dekalb-parcels`, whose export was still building when the collector ran
(`not_ready`); it was archived again with the collector the same day. Parcel counts are distinct
commercial parcels (`B`, `F1`, `F2`).

| State | Verified source                                         | Counties                                      | Commercial parcels (full load)                                                          | Owner names                    |
| ----- | ------------------------------------------------------- | --------------------------------------------- | --------------------------------------------------------------------------------------- | ------------------------------ |
| TX    | `tx-denton-cad`, `tx-williamson-cad`, `tx-fortbend-cad` | Denton, Williamson, Fort Bend                 | 13,304; 11,699; 9,698                                                                   | yes                            |
| NY    | `ny-orpts-rolls` (statewide, OPEN-NY)                   | Monroe, Suffolk, Nassau, Westchester, Erie    | Monroe 13,601; Suffolk 27,373; Nassau 23,449; Westchester 37,456; Erie 24,108 (125,987) | yes                            |
| MD    | `md-sdat-real-property` (statewide)                     | Montgomery, Prince George's, Baltimore County | 11,578; 13,023; 14,494 (full county files)                                              | no (withheld by the publisher) |
| PA    | `pa-montgomery-parcels`, `pa-allegheny-assessments`     | Montgomery, Allegheny                         | Montgomery 15,584; Allegheny 35,302                                                     | Montgomery yes; Allegheny no   |
| MA    | `ma-massgis-parcels` (statewide, 176 town files)        | Middlesex, Worcester, Essex, Norfolk          | 176 towns: 71,800 (Middlesex 26,930; Worcester 18,081; Essex 14,950; Norfolk 11,839)    | yes                            |
| WI    | `wi-statewide-parcels` (all 72 counties)                | Milwaukee                                     | 16,580                                                                                  | yes                            |
| IN    | `in-marion-parcels`                                     | Marion                                        | 20,630                                                                                  | yes                            |
| MI    | `mi-oakland-parcels`                                    | Oakland                                       | 26,124                                                                                  | no (blank in the file)         |
| NC    | `nc-wake-parcels` (NC OneMap statewide)                 | Wake                                          | 9,634                                                                                   | yes                            |
| TN    | `tn-davidson-assessor`                                  | Davidson                                      | 13,111                                                                                  | yes                            |
| GA    | `ga-dekalb-parcels`                                     | DeKalb                                        | 11,351                                                                                  | yes                            |
| CA    | `ca-sacramento-assessor`                                | Sacramento                                    | 20,053                                                                                  | no                             |
| UT    | `ut-ugrc-lir` (statewide, all 29 counties)              | Salt Lake, Utah County                        | Salt Lake 30,756; Utah County 13,639                                                    | no                             |
| WA    | `wa-pierce-assessor`                                    | Pierce                                        | 12,530                                                                                  | no                             |
| OR    | `or-metro-rlis-taxlots` (Portland metro)                | Multnomah                                     | Multnomah 20,618 (the layer's Clackamas 6,085 and Washington 7,425 loaded too)          | no                             |

New entity registry: `ct-sos-entities` (Connecticut, public domain, 1,305,856 rows; full load:
1,305,836 entities kept, 20 skipped for a placeholder account number). Every other new state's entity register is sold or not published; prices and
order routes are in the region files.

**Full-load totals** (all 19 sources, one scratch registry): 531,005 distinct commercial parcels in
30 counties (the 28 verified Tier 2 counties, 517,495 parcels, plus Clackamas and Washington,
Oregon, which share the Portland metro file), 206,130 of them with an organisation owner of record,
and 1,305,836 Connecticut entities. Natural-person owners are not stored.
`link_owners()` made 1,926 current ownership links, all to Connecticut entities because that is the
only entity registry loaded; owner linking for the other states waits on their entity registers.

Statewide sources found along the way cover far more than the 61 counties. Five of them, already
verified, were **extended statewide on 2026-11-03** (configuration, adapter fixes and tests; no new
terms review, since each licence covers the whole state) and **loaded in full the same day** from the
draft release `data-2026-11-03-41618090881`: every file the weekly collector archived for the added
counties and towns went into the scratch registry of the Full load above, then `purge_person_owners()`
and `link_owners()` ran once. Each review record has a "Statewide extension (2026-11-03)" section with
the county list cited from the publisher's own data and a "Statewide full load (2026-11-03)" section with
the command and a per-county table of counts (MassGIS also per town). Counts are distinct commercial
parcels (`B`, `F1`, `F2`) in the counties added by the extension; the last column is the whole state
with the Tier 2 counties loaded earlier.

| Source                  | Files in config                               | Files loaded | Counties added and loaded                                                                                    | Commercial parcels loaded in the added counties (publisher's count) | Organisation owners (added counties) | Whole state loaded: parcels; organisation owners |
| ----------------------- | --------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------- | ------------------------------------ | ------------------------------------------------ |
| `ny-orpts-rolls`        | 57 (one per county outside New York City)     | 52           | 52 of 52                                                                                                     | 150,008 (150,008)                                                   | 82,201                               | 275,995 in 57 counties; 151,710                  |
| `ma-massgis-parcels`    | 350 town files (every town but Boston)        | 174          | 174 towns of 174, in the other 10 counties, incl. Chelsea, Revere, Winthrop                                  | 56,122 (no query service; 1,015,459 assessor records, all classes)  | 35,062                               | 127,922 in 14 counties (350 towns); 82,558       |
| `ut-ugrc-lir`           | 26 county layers                              | 23           | 23 of 24 (Garfield not ready when the collector ran; Carbon, Emery and San Juan left out: no mappable class) | 31,667 (31,855 with Garfield's 188)                                 | 0 (no owner in the file)             | 76,062 in 25 of 29 counties; 0                   |
| `wi-statewide-parcels`  | 130 pages (all 72 counties)                   | 121          | 71 of 71                                                                                                     | 169,174 (169,174)                                                   | 112,797                              | 185,754 in 72 counties; 124,561                  |
| `md-sdat-real-property` | 24 (every jurisdiction, incl. Baltimore City) | 21           | 21 of 21                                                                                                     | 70,150 (70,158; the adapter skips 8 deleted accounts)               | 0 (withheld by the publisher)        | 109,245 in 24 jurisdictions; 0                   |

**Statewide totals (2026-11-03):** the five statewide loads added 477,121 commercial parcels
in 177 counties, 230,060 of them with an organisation owner of record
(`ny-orpts-rolls` 150,008, `wi-statewide-parcels` 169,174, `md-sdat-real-property`
70,150, `ma-massgis-parcels` 56,122, `ut-ugrc-lir` 31,667). With the Full-load
registry the scratch file now holds **1,008,126 distinct commercial parcels in 207 counties**, 436,190 with an
organisation owner of record, and 1,305,836 Connecticut entities. Natural-person owners are not stored.
`link_owners()` now shows 3,873 current ownership links (1,926 before), still all to Connecticut
entities, because that is still the only entity registry loaded (1,947 of the links are in the new
counties and towns: New York 585, Massachusetts 961, Wisconsin 401). Gaps in this load: Utah's
Garfield (188 parcels expected) waits for the next collector run, and Carbon, Emery and San Juan have no
mappable class; Maryland and Utah carry no owner names, so none of their parcels can be linked; Kenosha
County, Wisconsin, withholds almost every owner (4,011 of 4,031 in-scope parcels).

Adapter fixes made along the way: Wisconsin takes the county from `CONAME` (not the contributing
county's `PARCELFIPS`, which misfiled Appleton and Menasha parcels in Calumet and Winnebago), escapes
punctuation in parcel ids (74 Brown, Vilas, Kewaunee and Oneida pairs would have merged) and
county-qualifies its accounts; Utah escapes punctuation in parcel ids (Sevier, Kane) and its command
line no longer retires parcels by default; MassGIS covers all 350 towns and refuses Boston. Still
statewide but not extended: North Carolina OneMap (100 counties, county use codes to map) and the
Tennessee Comptroller (86 of 95 counties, not yet reviewed in full).

**Licence points for the founder** (also in each record): MassGIS asks that its data not be
redistributed "for a fee beyond reproduction costs"; the Portland metro RLIS data is ODbL
(share-alike); Fort Bend's export carries a hold-harmless and indemnity clause; Davidson's
verification rests on Nashville's terms excluding open-portal data from its commercial-use ban.

**Process notes.** Three agents recorded slips that the rules forbid and that did not obtain
data: header-only requests to Hamilton County's download folder before its robots.txt (which
disallows it) was read; one look at the Oklahoma Secretary of State's fee page before its
robots.txt was read; and one request to a Texas appraisal-district vendor API with another site's
origin header, blocked before it ran. Each is recorded in that source's review record.

## Rules for Tier 2 research agents

Everything in [EXPANSION-BRIEF.md](../EXPANSION-BRIEF.md) applies (public sources only, the
collector's user agent, robots.txt, stop at any gate that needs a person, no invented data,
commercial scope B/F1/F2, no natural-person names, no AI model identifiers). In addition:

- **Bandwidth.** A product launch is running on the same connection. Do not download any file
  larger than 50 MB; use a ranged or filtered request (e.g. `?$limit=20000`, an ArcGIS `where`
  clause, an HTTP `Range` header) to get a sample, and record the full file's size from its
  headers. Full loads run later from GitHub's network through the weekly collector workflow.
- **One shared worktree.** You share `/Users/rs/Projects/FactLot/worktrees/tier2-research` with
  six other agents. Write only your own files: `registry/sources/<state>/<id>.json`,
  `python/src/factlot/registry/adapters/<module>.py`, `python/tests/test_adapter_<module>.py`,
  `docs/registry/sources/<id>.md`, and your region file `docs/registry/tier2/<region>.md`. Do not
  edit any shared file (this README, `docs/registry/sources/README.md`, `docs/BACKLOG.md`,
  `CHANGELOG.md`, existing adapters). Never run git write commands and never commit. Do not run
  `npm` at all. Run only your own tests: `cd python && PYTHONPATH=src python3 -m unittest tests.test_adapter_<module>`.
- **Order of work per county.** First find whether a statewide source covers it (one review can
  clear many counties). Then: terms and robots review, file URLs confirmed by a small request,
  config with `verified` true only if the licence clearly permits redistribution and does not
  forbid AI use. Write an adapter only for verified sources whose layout is published or visible
  in the sample, and load the sample into a scratch registry to report real counts. Gated
  sources get a config with `verified: false`, a review record with a precise Gates section, and
  no adapter.
- **Region file.** `docs/registry/tier2/<region>.md` has one table row per county: source id,
  status (verified, gated: terms / form / purchase / records request / host blocks automated
  clients, or none found), licence, owner names present (yes/no), sample counts, and the one
  action a person must take for gated sources. End with the entity registries for your states.
- **Budget.** About three hours in all; prefer breadth (every county reviewed) over depth.

## Expansion (2026-11-03, branch `data/tier2-expansion`)

A second pass added open statewide sources in states the registry did not yet cover, and cleared two gates (Connecticut's licence, five North Carolina counties' use codes) and
one load (Garfield County, Utah). Full record, reviewed-but-not-loaded sources and the founder gates: [expansion.md](expansion.md). Counts are distinct commercial parcels
(`B`, `F1`, `F2`) in one scratch registry built from the Tier 2 file plus these loads.

| State | Source                   | Counties in the load                                 | Commercial parcels | Organisation owners |
| ----- | ------------------------ | ---------------------------------------------------- | ------------------ | ------------------- |
| VT    | `vt-vcgi-parcels`        | 14 of 14                                             | 19,342             | 12,357              |
| MN    | `mn-opt-in-parcels`      | 24 opt-in counties                                   | 60,495             | 36,373              |
| AR    | `ar-gis-parcels`         | 75 of 75                                             | 69,056             | 41,144              |
| MT    | `mt-msl-cadastral`       | 55 of 56 (apartments and industrial only)            | 7,546              | 4,241               |
| CT    | `ct-parcel-cama-layer`   | 8 former counties (169 towns)                        | 43,390             | 34,022              |
| NC    | `nc-onemap-parcels`      | Guilford, Forsyth, Cumberland, Johnston, New Hanover | 28,436             | 20,284              |
| UT    | `ut-ugrc-lir` (Garfield) | Garfield                                             | 188                | 0                   |

**Totals (2026-11-03).** The expansion added **228,453 distinct commercial parcels in 182 counties** (24,956 `B`, 173,729 `F1`, 29,773 `F2` counted once per category; five Connecticut parcels carry
two), 148,421 of them with an organisation owner of record, and four new states (Vermont, Arkansas, Montana, Connecticut). The scratch registry now holds **1,236,579 commercial parcels in 389 counties of 20 states**
(1,008,126 in 207 counties before), 1,305,836 Connecticut entities and no natural-person owner. `link_owners()` then `purge_person_owners()` ran on the whole file: 30,420 exact links plus 1,350 chosen among
same-name entities because the others have ended (31,770 current ownership links, 3,873 before; 289 ambiguous, 33,298 owners whose exact match exists only in another state, 3,526 of them newly queued for
review); **27,513 of the links are on the new Connecticut parcels**, because Connecticut is the only entity registry loaded; Vermont 110, Minnesota 124, Arkansas 66 and North Carolina 84 link to Connecticut
entities of the same name. `purge_person_owners()` removed nothing (0 owner facts, 0 mailing facts, 0 links): every new adapter stores organisations only. Against the lead's combined figures (1,716,664
parcels, 223 counties, 17 states and the District of Columbia, 37 verified sources) the branch brings the totals to **1,945,117 parcels, 405 counties, 21 states and the District of Columbia, 47 verified sources**
(five new sources, five North Carolina county sources; Garfield is an existing source).
