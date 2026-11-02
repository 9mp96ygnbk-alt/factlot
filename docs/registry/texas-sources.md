# Texas source catalog

**Status (2026-11-02): none of these sources has been retrieved or reviewed yet.** The
development environment's network policy blocks every host below. The descriptions come from
general knowledge of how Texas publishes property data. Each row must be confirmed against the
live source, and its terms recorded, before an adapter is written (see
[data-policy.md](data-policy.md) §5).

## Why Texas works for a $0 registry

- **Appraisal districts.** Every county has a central appraisal district (CAD). Most large CADs
  publish appraisal-roll exports: account, parcel ID, situs address, owner of record and mailing
  address, state property category, land and improvement details, and appraised values.
- **Standard property categories.** Texas uses statewide State Property Tax Code categories,
  including:

  | Code | Category                                   |
  | ---- | ------------------------------------------ |
  | A    | single-family residence                    |
  | B    | multifamily residence                      |
  | C1   | vacant lots and tracts                     |
  | F1   | commercial real property                   |
  | F2   | industrial and manufacturing real property |
  | L1   | commercial personal property               |
  | L2   | industrial personal property               |
  | X    | exempt                                     |

  Because every CAD uses these codes, one commercial filter (F1, F2, B) works in every county.

- **Business entities.** The Comptroller's franchise-tax data and the Secretary of State's filings
  identify legal entities registered in Texas. Free bulk data, if available, comes through the
  Texas Open Data Portal.
- **Records requests.** The Texas Public Information Act covers anything not published in bulk.
- **Known gap:** Texas does not require sale prices to be disclosed, so sales comps are out of
  scope.

## Priority sources

| #   | Source                                                      | What it should provide                                                                                     | Domains to allow                                                       |
| --- | ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| 1   | Harris Central Appraisal District (Houston)                 | Appraisal-roll export: accounts, owners, situs, state class, building and land data                        | `hcad.org`, `pdata.hcad.org`                                           |
| 2   | Dallas Central Appraisal District                           | Appraisal-roll data export                                                                                 | `dallascad.org`, `www.dallascad.org`                                   |
| 3   | Travis Central Appraisal District (Austin)                  | Appraisal-roll export                                                                                      | `traviscad.org`, `www.traviscad.org`                                   |
| 4   | Tarrant Appraisal District (Fort Worth)                     | Appraisal-roll export                                                                                      | `tad.org`, `www.tad.org`                                               |
| 5   | Bexar Appraisal District (San Antonio)                      | Appraisal-roll export                                                                                      | `bcad.org`, `www.bcad.org`                                             |
| 6   | Collin Central Appraisal District                           | Appraisal-roll export                                                                                      | `collincad.org`                                                        |
| 7   | Texas Comptroller and Texas Open Data Portal                | Franchise-tax permit holders: taxpayer number, legal name, Secretary of State file number, mailing address | `data.texas.gov`, `comptroller.texas.gov`                              |
| 8   | Texas Geographic Information Office (TxGIO, formerly TNRIS) | Statewide land-parcel dataset aggregated from the CADs (parcel geometry and IDs)                           | `geographic.texas.gov`, `data.geographic.texas.gov`, `tnris.org`       |
| 9   | City open-data portals                                      | Building permits and certificates of occupancy (later phase)                                               | `data.austintexas.gov`, `www.dallasopendata.com`, `data.houstontx.gov` |

Downloads often redirect to a storage or CDN host, such as a cloud bucket. If one of those is
blocked, the adapter run reports the exact host to add.

## Pilot order

Start with Harris and Dallas. Together they are the two largest commercial markets in the state.
Next add the Comptroller entity data, which turns owner names into resolvable legal entities.
Then add Travis, Tarrant, and Bexar.
