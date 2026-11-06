# Tier 2: Texas (Denton, Fort Bend, Hidalgo, El Paso, Montgomery, Williamson)

Researched 2026-11-03. Method: [README.md](README.md#method).
Texas has no statewide parcel roll, so each county was reviewed on its own. Three of the six publish a usable free
roll with owner names and state property categories and now have adapters (**Denton, Fort Bend, Williamson**; about
34,700 commercial parcels between them in the samples below). The other three are gated: Hidalgo and Montgomery run
the same client-rendered "Public Portal" site, whose download pages return an empty shell to an automated client, and
El Paso publishes bulk files but its acceptable use policy bars bots and "AI training data collection" without
written authorization.

## Counties

| County (rank)      | Source id           | Status                                                                                                                                    | Licence                                                                                                            | Owner names                                                      | Sample counts (real runs, 2026-11-03)                                                                                                                                                                  | What clearing the gate needs                                                                                                                                                                    |
| ------------------ | ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Denton (46)        | `tx-denton-cad`     | **verified**; adapter `tx_denton`; the roll as the county GIS serves it (ArcGIS REST pages), DCAD's own Data Extracts page was unreadable | Public record; none stated on the layer (Hub item: Open Data, `licenseInfo` empty)                                 | yes (13,296 of 13,304; 8 confidential withheld)                  | 13,732 rows from 7 pages (8.9 MB) → **13,304 parcels**: F1 9,088, B 4,143, F2 73; 9,498 organisation owners; 150,785 facts; 4 s                                                                        | Find DCAD's current Data Extracts page (the district's own site) and record any licence it states                                                                                               |
| Fort Bend (56)     | `tx-fortbend-cad`   | **verified**; adapter `tx_fortbend`; Orion export, redacted of §25.025 owners; certified roll read by ranged requests (58.8 MB file)      | Public record; none stated. Data-file disclaimer asks the user to hold harmless, indemnify and defend the district | yes (2,759 of 9,698 in the sample: owner file prefix only)       | Certified roll: **9,698 parcels**: F1 8,570, B 924, F2 204; 2,060 organisation owners in the owner prefix; 61,894 facts; 8.7 s. Supplement 4 (1.96 MB, archived): 120 parcels, 104 organisation owners | Decide whether FactLot accepts the indemnity clause on the data-file disclaimer; if not, set `verified` false and send a Public Information Act request                                         |
| Hidalgo (64)       | `tx-hidalgo-cad`    | gated: page content is client-side rendered (empty shell to automated clients); no file URL retrievable; no adapter                       | Not read (public record; none seen)                                                                                | unknown                                                          | none: nothing downloaded                                                                                                                                                                               | Open `https://www.hidalgoad.org/data-downloads` in a browser, read any terms, copy the certified export and DBF URLs into the config; else a Public Information Act request to cs@hidalgoad.org |
| El Paso TX (70)    | `tx-elpaso-cad`     | gated: terms (acceptable use policy bars bots and AI training data collection without written authorization; bulk files are encouraged)   | Public record ("public domain"); AUP §1.2 and §2.2; robots Content-Signal `ai-train=no`                            | yes in the files (Owners dump, certified export); not downloaded | none: nothing downloaded. Files: certified export 408 MB (True Automation 8.0.34 layout), Properties dump 21.8 MB, Owners dump 15.3 MB, weekly                                                         | Decide that the published bulk files fall under AUP §2.2, or obtain written authorization from EPCAD (915-780-2131); then set `verified` true                                                   |
| Montgomery TX (86) | `tx-montgomery-cad` | gated: page content is client-side rendered (same portal as Hidalgo and Denton); no file URL retrievable; no adapter                      | Not read (public record; none seen)                                                                                | unknown                                                          | none: nothing downloaded                                                                                                                                                                               | Open `https://mcad-tx.org/appraisal-data-exports` in a browser, read any terms, copy the certified roll URLs (zip and JSON) into the config; else a Public Information Act request to MCAD      |
| Williamson (90)    | `tx-williamson-cad` | **verified**; adapter `tx_williamson`; WCAD's Socrata open-data portal (improvement state codes joined to the PropOwner table)            | Public record; none stated on any dataset; the platform's (Tyler) terms were not read as text                      | yes (11,699 of 11,699)                                           | 11,758 in-scope properties in the improvement file → **11,699 parcels**: F1 8,734, B 2,720, F2 245; 8,151 organisation owners; 114,318 facts; 3 s; 59 properties have no owner row                     | Read Tyler's Socrata terms and the portal's data page and record the result                                                                                                                     |

Review records: [Denton](../sources/tx-denton-cad.md), [Fort Bend](../sources/tx-fortbend-cad.md),
[Hidalgo](../sources/tx-hidalgo-cad.md), [El Paso](../sources/tx-elpaso-cad.md),
[Montgomery](../sources/tx-montgomery-cad.md), [Williamson](../sources/tx-williamson-cad.md).
Configs: `registry/sources/tx/<source id>.json`. Adapters: `tx_denton`, `tx_fortbend`, `tx_williamson` in
`python/src/factlot/registry/adapters/`; tests `python/tests/test_adapter_tx_<name>.py`.

## Patterns worth knowing

- **No Tier 1 adapter could be reused as is.** The three formats were new: ArcGIS REST pages (Denton), Tyler's Orion
  export (Fort Bend, comma-delimited with a layout workbook inside every zip) and Socrata CSV queries (Williamson).
  The new modules import only the small value helpers of `tx_collin`. The True Automation fixed-width family that
  `tx_travis` reads (Legacy 8.0.33) is what El Paso's certified export is published in (8.0.34); Hidalgo and
  Montgomery may use it too. That is the one place a Tier 1 adapter is likely to apply once those sources are cleared.
- **State codes need the improvement, not the account class.** Williamson's `PropOwner` has a district class
  (`RES`, `COM`, `C1`–`C6`) that misses duplexes and small commercial parcels typed `RES` (about 14% of the in-scope
  properties); the state code (`fsptb`) lives in the improvement table. Denton lists every code on the account
  (`A1,F1`), and the adapter takes F2, then F1, then B.
- **Redacted exports.** Fort Bend's zips are the "Redacted" version: the confidentiality column is dropped and
  §25.025 owners are left out. Denton's layer carries a `confidential` flag (8 in-scope accounts). Williamson's
  `issecured` is 0 on every row and 59 in-scope properties have no `PropOwner` row, which may be the same
  withholding (unconfirmed). El Paso's and the unread sources' handling is not known.
- **Client-rendered "Public Portal" sites** (`hidalgoad.org`, `mcad-tx.org`, `www.dentoncad.com`) return an empty page without JavaScript, and a browser pane did not render them either, so
  their download pages cannot be read by the collector. Denton's county GIS server was the route around it; Hidalgo
  and Montgomery have no equivalent that is current (Houston's copy of Montgomery's parcels is 19 months old).
- **Cloudflare challenges look different to different clients.** `epcad.org` answers `curl` with a managed challenge
  but serves the collector's identified client; the bar on automated use is the policy text, not the host.
- **Size**: Fort Bend's certified roll is 58.8 MB and El Paso's certified export 408 MB, over the 50 MB research limit;
  Fort Bend was sampled by reading the zip directory and two members with `Range` requests (18.4 MB), which works
  because the host honours ranges. Williamson's full PropOwner set is about 115 MB in seven pages and was sampled by
  30 id-filtered queries (3.5 MB).
- **Owner counts in the samples are floors**: Fort Bend's owner member was read for its first third only.
  Owner linking to the Comptroller file was not run (the scratch registries hold no entities).

## Entity registries for Texas

- **Texas Comptroller, Active Franchise Taxpayers** (`tx-comptroller-franchise`, Tier 1, public domain, 3,272,073
  entities): already loaded, so organisation owners of all three verified counties link as soon as the parcels load.
  It carries each entity's Secretary of State file number.
- **Texas Secretary of State business filings** (SOSDirect): not reviewed in this pass; the Comptroller file already
  supplies the legal names and file numbers the registry needs. Anything beyond that (officers, filings) is a
  separate review.
- Texas does not publish sale prices, so no county here can provide comps (see [texas-sources.md](../texas-sources.md)).
