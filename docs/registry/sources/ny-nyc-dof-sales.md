# ny-nyc-dof-sales: New York City Department of Finance, Rolling and Annualized Sales

Review record for the sources `ny-nyc-dof-sales-rolling`, `ny-nyc-dof-sales-2025` and `ny-nyc-dof-sales-2024` (data
policy §5), one source per DOF publication. Reviewed 2026-11-04. Machine-readable copy:
[`registry/sources/ny/ny-nyc-dof-sales.json`](../../../registry/sources/ny/ny-nyc-dof-sales.json) (collector source
`ny-nyc-dof-sales`). Adapter: `python/src/factlot/registry/adapters/ny_sales.py` (workbook reader:
`xlsx_reader.py`); tests: `python/tests/test_adapter_ny_sales.py`.

An **enrichment** source: it creates no parcels. Each sale of a lot the DOF roll ([ny-nyc-dof](ny-nyc-dof.md))
holds becomes a `transaction.sale` fact on that parcel (borough-block-lot match).

## Publisher and URLs

- Publisher: New York City Department of Finance (DOF), Property Division. Landing pages:
  <https://www.nyc.gov/site/finance/property/property-rolling-sales-data.page> and
  <https://www.nyc.gov/site/finance/property/property-annualized-sales-update.page>; field glossary:
  <https://www.nyc.gov/site/finance/property/glossary-property-sales.page>.
- Files (Excel, one per borough; archived by the collector 2026-11-04, 15 files, 28 MB, 34 s):
  `…/assets/finance/downloads/pdf/rolling_sales/rollingsales_<borough>.xlsx` (the last twelve months, "October
  2025 - September 2026", PTS data as of 2026-10-08; the file is replaced monthly) and
  `…/rolling_sales/annualized-sales/<year>/<year>_<borough>.xlsx` for calendar 2025 and 2024 (earlier years back
  to 2003 follow the same pattern). Tax classes 1, 2 and 4.
- The same publications are on NYC Open Data: `usep-8jbt` "NYC Citywide Rolling Calendar Sales" and `w2pb-icbu`
  "NYC Citywide Annualized Calendar Sales Update" (attribution Department of Finance). The nyc.gov workbooks were
  used, so no Socrata request was made.

## Terms, license, robots

- Same position as the DOF roll: the sales are public record, DOF publishes them on nyc.gov and on NYC Open Data,
  and the NYC Open Data FAQ (<https://www.nyc.gov/opendata/get-started/FAQs>, read again 2026-11-04) says "Open Data
  belongs to all New Yorkers. There are no restrictions on the use of Open Data." The nyc.gov Terms of Use govern
  website use and state no data licence (they reserve rights in site content: the same gate as `ny-nyc-dof`; the
  same files being on Open Data is the answer). AI use: not addressed; recorded `unknown`. Redistribution:
  permitted. Attribution: New York City Department of Finance.
- **robots.txt** `www.nyc.gov`: disallows only `/html/misc/`. Requests 2 seconds apart, identified collector, no
  account or click-through.
- `verified: true`.

## What the files contain, and what is kept

One worksheet, a few title/note rows (one says "Condominium and cooperative sales are on the unit level"), a header
row, then one row per recorded sale: borough, neighborhood, building class category, tax class and building class
(at present, or "as of final roll" in the annualized files), block, lot, easement, address, apartment number, ZIP,
residential, commercial and total units, land and gross square feet, year built, tax class and building class at
time of sale, sale price, sale date (an Excel serial date). **There is no buyer, seller or other party in the files,
and no arm's-length or "qualified" flag**; the adapter reads neither names nor addresses. Rows kept:

- a building class at time of sale that is multifamily, commercial or industrial under the same mapping as the
  roll (`ny_nyc.category`; commercial condominium units R5 and the like are kept, residential condominium
  units are not);
- not a unit-level sale: rows with an apartment number, and rows whose building class category is a cooperative
  ("COOPS - ...": a co-op's apartment number is written into the address and the lot is the building's), are dropped;
- a real date and a price of zero or more; a row listed twice is stored once.

Each sale is one fact, `transaction.sale`, valued `{date, price_usd, building_class, building_class_category,
tax_class, residential_units, commercial_units, total_units, land_area_sf, gross_area_sf}` (zero and blank figures
omitted), cited to the workbook and row (`2025_manhattan.xlsx row 7260 BBL 1012920015`). Two flags are added, both
about the file:

- `nominal_consideration: true` for a price of $0, which DOF's glossary defines as "a transfer of ownership without a
  cash consideration ... transfers of ownership from parents to children". Other nominal prices are not flagged.
- `lots_sharing_price_and_date: N` when N lots in the same workbook (this one included) sold the same date at the
  same non-zero price. A deed over several lots is published on each lot at the full price (the $1.08 billion
  590 Madison Avenue sale of 2025-08-14 appears on three lots), and the files do not say which rows belong together,
  so the flag is an observation, not a statement that the lots were one deed. **Do not sum or per-area-divide such
  prices.**

Arm's length is **not marked**: the files do not say, and the registry does not infer it. A reader screening for market
sales gets $0 sales flagged and no more.

## Real run (2026-11-04)

Into the scratch NYC registry (`…/scratchpad/data/zs/zs.db`, with the DOF roll and PLUTO), one series at a time; the
rolling files with `--since 2026-01-01` so October-December 2025 sales are not loaded twice (they are in the 2025
files):

```
python -m factlot.registry.adapters.ny_sales <5 borough workbooks> zs.db --series 2024 --as-of 2024-12-31
python -m factlot.registry.adapters.ny_sales <5 borough workbooks> zs.db --series 2025 --as-of 2025-12-31
python -m factlot.registry.adapters.ny_sales <5 borough workbooks> zs.db --series rolling --as-of 2026-09-30 --since 2026-01-01
```

| Series                            | Lots with an in-scope sale | In the registry | Not a registry parcel |                       Sales stored |
| --------------------------------- | -------------------------: | --------------: | --------------------: | ---------------------------------: |
| 2024                              |                      4,086 |           3,883 |                   203 |                              4,234 |
| 2025                              |                      4,494 |           4,400 |                    94 |                              4,675 |
| rolling, 2026-01-01 to 2026-09-30 |                      3,404 |           3,394 |                    10 |                              3,536 |
| **Total**                         |                            |                 |                       | **12,445 sales on 11,072 parcels** |

8,262 of the 12,445 have a price above $0; 4,183 are $0 (`nominal_consideration`); 2,137 carry
`lots_sharing_price_and_date` (2,090 parcels); 93 are at $100 million or more. By building-class letter: C 4,681,
K 2,192, G 1,363, D 1,280, O 915, S 700, E 622, F 400, H 145, I 98, R 36, J 13. `python -m factlot.registry.audit` on
the scratch file: no violation and no citation gap. Each series is its own source, because a registry fact is current
only while the latest snapshot of its source covers the parcel: one source would hide 2024 sales behind a 2026 file.

## Known gaps

- Only the last three periods are loaded (2024, 2025, 2026 to September); the annualized files go back to 2003 and
  are a one-line config change.
- A sale in the files is a recorded deed, not a verified market transaction: $0 and nominal sales, related-party
  transfers and multi-lot deeds are in it, unflagged beyond the two flags above.
- Sales of lots the roll no longer lists as commercial (changed class, merged or subdivided since) are skipped (307
  lots across the three series).
- Condominium unit sales attach to the unit's own lot only when the registry holds that unit; residential condominium
  units are out of scope.
