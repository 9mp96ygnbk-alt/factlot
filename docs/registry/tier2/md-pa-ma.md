# Tier 2: Maryland, Pennsylvania, Massachusetts

Region file for the nine counties in `md-pa-ma` (rank by 2025 resident population in brackets), reviewed
2026-11-03 under the [Tier 2 method](README.md#method). Statewide sources were checked first: Maryland and
Massachusetts each have one that clears every county in the region; Pennsylvania has none, so the two
counties have a source each.

| County (rank)            | Source id                                                            | Status   | Licence                                                                                          | Owner names | Sample counts                                                                                                                  | What clearing the gate needs                                              |
| ------------------------ | -------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------ | ----------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------- |
| Montgomery MD (45)       | [`md-sdat-real-property`](../sources/md-sdat-real-property.md)       | verified | Public Domain (portal field); attribution SDAT and MDP                                           | no          | full county file: 11,578 kept (`F1` 8,826; `F2` 1,470; `B` 1,282) of 11,580 rows                                               | none                                                                      |
| Prince George's MD (57)  | [`md-sdat-real-property`](../sources/md-sdat-real-property.md)       | verified | same                                                                                             | no          | full county file: 13,023 kept (`F1` 8,615; `F2` 3,269; `B` 1,139)                                                              | none                                                                      |
| Baltimore County MD (75) | [`md-sdat-real-property`](../sources/md-sdat-real-property.md)       | verified | same                                                                                             | no          | full county file: 14,494 kept (`F1` 8,461; `F2` 3,151; `B` 2,882)                                                              | none                                                                      |
| Allegheny PA (39)        | [`pa-allegheny-assessments`](../sources/pa-allegheny-assessments.md) | verified | CC0 (dataset licence field)                                                                      | no          | three 3 MB ranged windows of the 312.7 MB file: 16,690 rows, 1,437 kept (`F1` 1,228; `B` 164; `F2` 45)                         | none                                                                      |
| Montgomery PA (71)       | [`pa-montgomery-parcels`](../sources/pa-montgomery-parcels.md)       | verified | Custom: "a free and open resource", as is; data.pa.gov record says Public Domain U.S. Government | yes         | full county files for classes A, C, I: 15,584 kept (`B` 678; `F1` 12,244; `F2` 2,662); 10,221 organisation owners              | optional: confirm the custom licence with the Board of Assessment Appeals |
| Middlesex MA (20)        | [`ma-massgis-parcels`](../sources/ma-massgis-parcels.md)             | verified | Public domain, with a request not to resell for more than reproduction cost                      | yes         | 4 of 54 towns (Cambridge, Lowell, Newton, Framingham): 6,518 kept (`F1` 3,650; `F2` 774; `B` 2,094); 4,355 organisation owners | decide the fee-clause question for any paid tier (see below)              |
| Worcester MA (67)        | [`ma-massgis-parcels`](../sources/ma-massgis-parcels.md)             | verified | same                                                                                             | yes         | 2 of 60 towns (Worcester, Fitchburg): 5,303 kept (`F1` 2,815; `F2` 727; `B` 1,761); 3,332 organisation owners                  | same                                                                      |
| Essex MA (78)            | [`ma-massgis-parcels`](../sources/ma-massgis-parcels.md)             | verified | same                                                                                             | yes         | 2 of 34 towns (Lynn, Salem): 2,414 kept (`F1` 1,338; `F2` 224; `B` 852); 1,713 organisation owners                             | same                                                                      |
| Norfolk MA (95)          | [`ma-massgis-parcels`](../sources/ma-massgis-parcels.md)             | verified | same                                                                                             | yes         | 2 of 28 towns (Quincy, Brookline): 2,689 kept (`F1` 1,346; `F2` 90; `B` 1,253); 1,516 organisation owners                      | same                                                                      |

How to read the table:

- **Maryland.** One statewide Socrata dataset (`ed4q-f8tm`, monthly) covers all 24 jurisdictions, including
  Baltimore City; the config requests the three Tier 2 counties as server-filtered files (land use C, CC, I,
  M). The publisher hides owner names by design ("Hidden Property Owner Names") and no free alternative
  exists: SDAT sells the ownership file and the charter file through SpecPrint, Inc. (see below). Parcels
  load without owners, so no entity linking is possible for Maryland parcels.
- **Pennsylvania.** Allegheny's roll (CC0, WPRDC) excludes owner names by county ordinance 3478-07. Montgomery
  County's parcel layer includes the owner of record; its licence is a custom "free and open resource"
  statement rather than a named licence. Both counties' values are old base years (Allegheny 2012).
- **Massachusetts.** MassGIS's Level 3 town files (one zip per municipality, from a public bucket, with
  owner names and addresses) cover Middlesex, Worcester, Essex and Norfolk: 176 files, 514.6 MB, none over
  13.5 MB. Only 10 towns were downloaded; the other 166 are in the config. The fee clause in the layer
  metadata ("should not be redistributed for a fee beyond reproduction costs") permits free redistribution,
  so the source is `verified: true`; charging for these facts beyond reproduction costs (as part of what a
  paid plan sells) is outside it (rights review of 2026-11-06, in the record). mass.gov blocks the collector,
  so the licence was read from the metadata inside the downloads.
- `B` here is each publisher's own apartment class; the unit-count test for apartments (five or more)
  are noted in each record's Known gaps (Maryland `M` often shows fewer than five dwelling units;
  Massachusetts `111` covers four to eight).

## Files written

Configs (`registry/sources/`): `md/md-sdat-real-property.json`, `md/md-sdat-entities.json` (unverified),
`ma/ma-massgis-parcels.json`, `pa/pa-allegheny-assessments.json`, `pa/pa-montgomery-parcels.json`.
Adapters (`python/src/factlot/registry/adapters/`): `md_sdat.py`, `ma_massgis.py`, `pa_allegheny.py`,
`pa_montgomery.py`. Tests (`python/tests/`): `test_adapter_md_sdat.py`, `test_adapter_ma_massgis.py`,
`test_adapter_pa_allegheny.py`, `test_adapter_pa_montgomery.py` (run with
`cd python && PYTHONPATH=src python3 -m unittest tests.test_adapter_<module>`). Review records
(`docs/registry/sources/`): `md-sdat-real-property.md`, `md-sdat-entities.md`, `ma-massgis-parcels.md`,
`pa-allegheny-assessments.md`, `pa-montgomery-parcels.md`. This file.

Loading notes common to the multi-file sources (Maryland: one file per county; Massachusetts: one per town;
Montgomery PA: one per class): load each file with the same or its own as-of date, and do not use
`--full-roll` (the registry would retire the other files' parcels). Allegheny is a single file and loads
as a full roll. Downloaded in this review: about 100 MB (Maryland 10.6 MB, Massachusetts 67.9 MB,
Montgomery PA 12.3 MB, Allegheny three 3 MB samples).

## Entity registries for these states

| State | Source id                                            | Status                                            | What it is and what it needs                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ----- | ---------------------------------------------------- | ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PA    | [`pa-sos-entities`](../sources/pa-sos-entities.md)   | verified, already loaded                          | Department of State registered businesses on data.pa.gov, Public Domain U.S. Government. No action. Owner-name matching can use it for Montgomery PA (Allegheny publishes no owners).                                                                                                                                                                                                                                                                                            |
| MD    | [`md-sdat-entities`](../sources/md-sdat-entities.md) | gated: purchase                                   | SDAT's Corporate File (corporations, LLCs, LPs, LLPs, trade names; monthly, weekly subscription) is sold through SpecPrint, Inc.; no price or terms are published. **Action:** contact SpecPrint (sales@specprint.com, (410) 561-9600) for price, layout, and whether the file may be redistributed and used by AI; the same call covers SDAT's ownership file. Maryland parcels have no owner names, so the first use would be Maryland-registered owners of parcels elsewhere. |
| MA    | [`ma-sos-entities`](../sources/ma-sos-entities.md)   | gated: purchase (known; unchanged by this review) | Corporations Division bulk extract, $4,800 a year or $100 a week under 950 CMR 113.15. **Action:** contact the Corporations Division (cis@sec.state.ma.us, 1-800-392-6090) for the current order form and terms. Until then, Massachusetts owners (present in `ma-massgis-parcels`) link to entities only through other states' registries.                                                                                                                                      |
