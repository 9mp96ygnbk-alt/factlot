# tn-davidson-assessor: Nashville and Davidson County, Tennessee parcels (Metro Open Data Portal)

Reviewed 2026-11-03. Status: **verified** (Metro Open Data Portal data is excluded from the Nashville.gov
commercial-use prohibition; read the caveats under Terms). FIPS 47037. Config:
[`registry/sources/tn/tn-davidson-assessor.json`](../../../registry/sources/tn/tn-davidson-assessor.json); adapter
`python/src/factlot/registry/adapters/tn_davidson.py`; tests `python/tests/test_adapter_tn_davidson.py`; account
system `davidson_stanpar`.

The Tennessee Comptroller's statewide parcel and assessment download does **not** cover Davidson (see
[southeast.md](../tier2/southeast.md)); this is the county's own source.

## Publisher and URLs

- Publisher: Metropolitan Government of Nashville and Davidson County; the dataset credits the Nashville
  Planning Department and the Assessor of Property (`accessInformation`). Contact `opendata@nashville.gov`.
- Dataset: "Parcels", ArcGIS Hub item `fa26cd9326c446179be059e00449cb1f` on `data.nashville.gov`
  (<https://data.nashville.gov/datasets/parcels-1/about>); service
  `https://services2.arcgis.com/HdTo6HJqh92wn4D8/arcgis/rest/services/Parcels_view/FeatureServer/0`
  (287,827 features on 2026-11-03; data last edited 2026-11-02; "This dataset is updated daily").
- Download used: the Hub download API,
  `https://data.nashville.gov/api/download/v1/items/fa26cd9326c446179be059e00449cb1f/csv?layers=0&where=LUCode > '020' AND LUCode < '080'`,
  which answers 302 to a CSV in the service's `replicafilescache` on `services2.arcgis.com` (5,824,645 bytes,
  13,627 rows). The unfiltered export is the whole 287,827-row roll, about 120 MB at this file's 430 bytes per row (estimated, not downloaded).
- Metadata document: `https://nashville.maps.arcgis.com/sharing/rest/content/items/691604512e634cb88615773d388d4379/data`
  (Parcels-Metadata.pdf; not fetched).

## Terms, license, robots

- The item's `licenseInfo` points to Metro's Open Data Executive Order. **Executive Order 18** (Mayor O'Connell,
  2024-01-17) sets no named licence. Its operative sentences: "The Open Data should be used for informational
  purposes only."; users "should reflect the date upon which the Data was retrieved from the website"; "No user
  may claim in any way that the user has the approval of Metropolitan Government"; the data is "made available 'as
  is' without any warranties of any kind". The order contains no commercial-use restriction and no AI clause.
- **Nashville.gov Terms of Service** (<https://www.nashville.gov/departments/government/terms-service>): Metro
  retains copyright on site content and "you may not ... 'mirror' this information on your server", but: "Excluding
  publicly available data on Metro's Open Data Portal, commercial use of the materials is prohibited without the
  written permission of the Metro." So portal data is outside the commercial-use prohibition and the mirroring
  clause is about site content. This is the basis for `verified: true`. A person who wants more certainty can ask
  `opendata@nashville.gov` to confirm that republishing facts from the Parcels dataset is permitted; the registry
  shows the retrieval date and does not imply Metro endorsement.
- Underlying records are public records under the Tennessee Public Records Act (T.C.A. 10-7-503).
- Data excluded from the portal: records that are "Protected Information" (EO 18 section III), so the file has no
  confidentiality flag and none is needed.
- robots.txt: `data.nashville.gov` and the Hub host: `Crawl-delay: 60`, disallow `/sites/`, `/admin/`, `/sessions/`,
  `/groups/`, `/people/`, `/workspace/`. `services2.arcgis.com` answers 403 to `/robots.txt` (no rules readable;
  the collector fetched the CSV there after the Hub redirect). `www.nashville.gov`: standard Drupal rules.

## What the file contains

`csv` (the archived name): UTF-8 with a BOM, 43 columns headed by the portal's field **aliases**; the adapter
also accepts the service field names. One row per parcel polygon; condominium floors repeat the parcel number
(`Feature Type` "Multistory Cond"). Columns: `Assessor Parcel Number`, `Feature Type`, `Floor Number`, `Parcel ID`,
`Census Tract`, `Council District`, `Tax District`, `Owner Name`, `Sale Date`, `Sale Price`, `Owner Instrument`,
`Owner Address 1`-`3`, `Owner City`, `Owner State`, `Owner Country`, `Owner Zip Code`, `Parcel Address`, `Parcel
House Number`, `House Number Extension`, `Parcel Street Name`, `Parcel Suite/Unit Number`, `Parcel City`, `Parcel
State`, `Parcel Zip Code`, `Legal Description`, `Parcel Instrument`, `Parcel Date`, `Acres`, `Frontage (ft)`,
`Side (ft)`, `Is Regular Shape?`, `Land Use Code`, `Land Use Description`, `Land/Improvement/Total Appraised
Value`, `Zoning`, `Shape Area`, `Latitude`, `Longitude`. Sale prices are present in the file and are not read.

Land-use codes (the Assessor's, from the portal data: code, description, parcels on 2026-11-03) and the mapping:

| Codes                                    | Meaning (publisher's descriptions)                                                                                                                                                                | Category     |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| `037` 86, `038` 667, `039` 220           | apartment: walk-up (built before 1960), low rise (since 1960), high rise (3+ stories)                                                                                                             | `B`          |
| `021`-`029`                              | neighborhood supermarket 49, strip center 687, shopping center 74, small service shop 328, one-story retail 867, department store 6, day care 104, enclosed mall 4, convenience market 75         | `F1`         |
| `031`-`036`                              | branch bank 178, office 1-2 stories 1,800, office 3+ stories 212, medical office 346, office/commercial condominium 749                                                                           | `F1`         |
| `041`-`049`                              | auto dealer 376, repair/body shop 482, service station 12, gas only 11, convenience with gas 261, mini lube 38, car wash 57, parking lot 1,456, parking garage 58                                 | `F1`         |
| `051`-`059`                              | restaurant 446, fast food 341, nightclub 116, theater 11, towers 93, recreational 46, golf 23, recording studio 107, hotel/motel 281                                                              | `F1`         |
| `061`-`065`, `067`, `069`                | camp ground 6, mobile home park 35, mini warehouse 112, small warehouse 876, wholesale outlet 39, dock/marina 3, event center 1                                                                   | `F1`         |
| `071`-`078`                              | light manufacturing 309, heavy manufacturing 97, lumber/sawmill 20, packing/food processing 42, business center 101, mineral processing 43, terminal/distribution warehouse 625, open storage 135 | `F2`         |
| `010`, `020`, `030`, `070`, `080`, `090` | vacant residential / commercial / multi-family / industrial / rural / exempt land                                                                                                                 | out of scope |
| `011`-`019`, `081`-`089`                 | single family, duplex, triplex, quadplex, condominium, zero lot line, dormitory, mobile home, rural combos                                                                                        | out of scope |
| `066`                                    | greenhouse/nursery (12)                                                                                                                                                                           | out of scope |
| `001`-`008`, `091`-`099`                 | parks and government uses; church, school, hospital, nursing home, cemetery, club, museum and other exempt uses                                                                                   | out of scope |

`local_use_code` keeps the code verbatim (`038`). Hotels and parking are `F1`; mobile home parks are `F1`.

## Gates

None. (Written confirmation from `opendata@nashville.gov` would settle the reading; see Terms.)

## Real run

2026-11-03, `python -m factlot.collector snapshot --config registry/sources/tn/tn-davidson-assessor.json`, then
`python -m factlot.registry.adapters.tn_davidson <file> <db> --as-of 2026-11-02`:

- Snapshot `fl:document:sha256-53b25baeeea770bf2606bad6d0be334d18551b947dc08ed7a184df524990b62b` (5,824,645
  bytes; `collected/tn-davidson-assessor/53b25baeeea770bf/csv`).
- Rows read 13,627; parcels kept 13,111 (the other 516 rows are vacant commercial/multi-family/industrial land
  `030`, `070` and greenhouses `066`): `F1` 10,766, `F2` 1,372, `B` 973.
- Facts written 94,950. Organisation owners stored 8,573; natural-person owners skipped 4,538. Seconds: 2.6.
  Errors: none.

## Full load (2026-11-03)

Release `data-2026-11-03-41603209834` (draft, maintainers only) of `9mp96ygnbk-alt/factlot`. Each asset's sha256 was checked against the manifest and its first 16 hex characters against the name. Loaded into the Tier 2 scratch registry (one SQLite file shared by every Tier 2 source, `ct-sos-entities` first).

Assets (document id from the manifest):

- `tn-davidson-assessor__53b25baeeea770bf__csv` (5,824,645 bytes): `fl:document:sha256-53b25baeeea770bf2606bad6d0be334d18551b947dc08ed7a184df524990b62b`

Command:

```
PYTHONPATH=python/src python3 -m factlot.registry.adapters.tn_davidson <csv> registry.db --as-of 2026-11-02 --retrieved-at <manifest checked_at>
```

- Rows read: 13,627 data rows (516 vacant-land and greenhouse rows dropped).
- Parcels kept: **13,111** distinct commercial parcels (`B` 973, `F1` 10,766, `F2` 1,372).
- Facts written: 94,918. Seconds: 6.3. Invalid ids, errors, retired: 0, 0, 0.
- Organisation owners stored (current owner-of-record facts): 8,557; natural persons or withheld owners not stored (names not kept): 4,554.
- Ownership links to registered entities after `link_owners()`: 37 (the only entity registry in the scratch file is `ct-sos-entities`).

## Known gaps

- No building area, year built or tax year in the file; land area is blank for condominium units (0 acres).
- Condominium units each count as a parcel (749 office condominium units in `036`).
- The roll is "updated daily" but the registry takes the Hub export at collection time; `--as-of` is the service's
  data last-edit date.
- The Hub export for the full roll was not downloaded; only land-use codes 021-079 were. On 2026-11-06 the unfiltered layer count was 287,888 (287,827 on 2026-11-03).

## Tier 1 audit (2026-11-06)

Lane A6 collected the configured Hub export again. The CSV is a new file (sha256 `7d73ada67b98d397…`, 5,823,139 bytes; the full-load file above was `53b25baeeea770bf…`). The service's filter count was still 13,627 rows, of which 516 are vacant land or greenhouses and are dropped. Parcels kept **13,111** (B 973, F1 10,766, F2 1,372), the same split as the 2026-11-03 load. `dataLastEditDate` was 2026-11-06 11:09 UTC, so `--as-of` for this export is **2026-11-06** rather than 2026-11-02. Organisation owners stored 8,548 (the full load above, on the older file, stored 8,557). Audit violations 0, person-like owner facts 0. Evidence: [tn-davidson-assessor.md](../quality/surge-2026-11/tn-davidson-assessor.md) and [tn-davidson-assessor-audit.json](../quality/surge-2026-11/tn-davidson-assessor-audit.json). The Nashville.gov terms sentence that excludes Open Data Portal data from the commercial-use prohibition, re-read the same day, is unchanged.
