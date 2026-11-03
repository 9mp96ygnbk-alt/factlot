# ny-orpts-rolls: New York State assessment rolls (ORPTS, via Open NY)

Review record for data policy §5. Reviewed 2026-11-03. Machine-readable copy:
[`registry/sources/ny/ny-orpts-rolls.json`](../../../registry/sources/ny/ny-orpts-rolls.json).
Adapter: `python/src/factlot/registry/adapters/ny_orpts.py` (account system `ny_swis_printkey`);
tests: `python/tests/test_adapter_ny_orpts.py`.

One statewide dataset covers every New York county outside New York City, so one review clears
Suffolk (36103), Nassau (36059), Westchester (36119), Erie (36029) and Monroe (36055), and every
other upstate and Long Island county the same way (the adapter knows all 57 county FIPS codes;
the five boroughs are `ny-nyc-dof`).

## Publisher and URLs

- Publisher: New York State Department of Taxation and Finance, Office of Real Property Tax
  Services (ORPTS), on Open NY (`data.ny.gov`, Socrata). Contact on the dataset:
  `Real.Property@tax.ny.gov`.
- Dataset: "Property Assessment Data from Local Assessment Rolls", id `7vem-aaz7`.
  Landing page: <https://data.ny.gov/Government-Finance/Property-Assessment-Data-from-Local-Assessment-Rolls/7vem-aaz7>;
  metadata: <https://data.ny.gov/api/views/7vem-aaz7.json>. Attachments on the dataset: an overview
  and a data dictionary (PDFs). Posting frequency: annually; last updated 2026-04-24.
- Size (SODA `count`, 2026-11-03): roll years 2021 to 2025 hold 4.68 to 4.73 million rows each; 2025
  has 4,727,130 rows. Whole-state download is not attempted. Confirmed files are filtered SODA CSVs,
  one per county, in `registry/sources/ny/ny-orpts-rolls.json`: `roll_year=2025`, one `county_name`,
  `property_class` 400 to 499 or 700 to 799, 31 of the 93 columns, `$order=swis_code,print_key_code`,
  `$limit=100000`. Each answers HTTP 200 (chunked, so no `Content-Length`; Monroe's is 3,208,024
  bytes). Commercial and industrial rows in 2025: Suffolk 42,709; Nassau 29,138; Westchester 37,533;
  Erie 25,800; Monroe 13,641 (148,821 rows, roughly 34 MB in all). When the 2026 rolls are posted,
  change `roll_year` in the URLs.
- Publisher's class list: <https://www.tax.ny.gov/research/property/assess/manuals/prclas.htm>
  ("Property type classification codes").

## Terms, license, robots

- Terms: OPEN-NY Terms of Use (<https://data.ny.gov/dataset/OPEN-NY-Terms-Of-Use/77gx-ii52>), the same
  terms reviewed for `ny-dos-entities` (see that record for the quoted sentences): a non-exclusive,
  revocable licence with no attribution, share-alike or pre-approval requirement; "so long as you are
  not doing anything malicious with NYS data, you may use it as you wish". The dataset has no
  license field. AI use is not addressed.
- The one clause flagged on `ny-dos-entities` applies here too: the prohibition on bots sits in the
  "Public Participation" (user upload) section, not in the licence to download data. A person should
  confirm that reading once for both sources (backlog A11), and read the portal platform's terms
  (socrata.com).
- robots.txt (`data.ny.gov`): `Crawl-delay: 1`; only `/browse` search URLs with `q=`, `category=` and
  similar parameters are disallowed. `/resource/` and `/api/` are allowed. The collector's discover
  step ran clean on the dataset page and the metadata API.
- Statutes, state by state question "does any statute restrict commercial use of assessment lists?":
  none found. The roll is a public record that must be filed for public inspection (Real Property
  Tax Law §516; text read on nysenate.gov, no restriction on use). FOIL (Public Officers Law
  §89(2)(b)(iii)) lists "sale or release of lists of names and addresses if such lists would be used
  for solicitation or fund-raising purposes" as an unwarranted invasion of personal privacy; that
  is a ground for an agency to withhold in answering a request, not a restriction on use of
  published open data, and it is one more reason natural-person owners are never stored.

## What the file contains

One row per parcel per roll year for every city and town outside New York City (996 local
governments; the publisher states village rolls are not included). Columns requested: `roll_year`, `county_name`,
`municipality_code`, `municipality_name`, `swis_code`, `tax_class`, `roll_section`, `property_class`,
`property_class_description`, `print_key_code`, `parcel_address_number`, `parcel_address_street`,
`parcel_address_suff`, `front`, `depth`, `primary_owner_first_name`, `primary_owner_mi`,
`primary_owner_last_name`, `primary_owner_suffix`, the mailing address columns (prefix, number,
street, suffix, city, state, zip, country, PO box), `full_market_value`, `assessment_land`,
`assessment_total`. The portal also has three additional owners, exemptions and taxable values
(not requested).

- **Parcel key.** The publisher: "combine the SWIS code and print key fields". The registry strips
  punctuation from an APN, and print keys differ only by punctuation within a municipality
  (Erie `101.27-6-11` and `101.27-6-1.1`; Suffolk `10.-1-22` and `10.1-2-2`; 24 pairs in the
  first 3,000 Suffolk rows alone), so `ny_orpts.apn()` writes `.`, `-` and `/` as `x` plus the hex
  code and a literal `x` as `xx` (`472003` + `10.-1-22` is `47200310x2ex2d1x2d22`). The readable
  `<swis>-<print key>` is the account and the crosswalk value.
- **Owners.** Present in every county, and not uniform: Suffolk writes the whole name ("LAST, FIRST")
  in the last-name column; Erie, Monroe and Westchester split persons across first and last
  columns; companies are in the last-name column. The adapter joins the non-blank parts and the
  registry keeps only organisations. There is no confidentiality flag; no owner is withheld in the
  rows read.
- **Use codes mapped** (publisher's page above; the roll also carries local codes 412 and 413 that
  the page does not list):

| ORPTS class                                               | FactLot | Note                                                           |
| --------------------------------------------------------- | ------- | -------------------------------------------------------------- |
| 411 Apartments, 413 Co-operative                          | B       | No unit count in the roll; see Known gaps                      |
| 400, 414-418, 420-499 (all other 4xx)                     | F1      | Hotels, motels, retail, offices, parking, storage, mixed       |
| 700, 710-715 manufacturing and processing, 720-729 mining | F2      |                                                                |
| 410 Living accommodations, 412 Condominium                | none    | Seasonal and single-family homes (Suffolk 410) and condo units |
| 3xx vacant land (incl. 330, 340), 2xx, 5xx, 6xx, 8xx, 9xx | none    | Vacant land is out of scope, as in `ny_nyc`                    |
| 730-749 wells and pipelines                               | none    | Production and transmission rights, not buildings              |

## Gates

None for the data. A person should do the two read-only confirmations above (the "Public
Participation" bot clause and the Socrata platform terms) before the first weekly run; they apply to
`ny-dos-entities` as well.

## Real run

Monroe County, the complete 2025 commercial and industrial extract, archived by the collector
(`python -m factlot.collector snapshot`): `fl:document:sha256-b38f57c1305654853edfbb09c7821f4a9707d1930492f18557782128ac3c76c8`,
3,208,024 bytes, 13,641 data rows, retrieved 2026-11-03T07:38:48Z. Loaded with
`python -m factlot.registry.adapters.ny_orpts ... --as-of 2026-04-24 --tax-year 2025` in 2.6 seconds:

- 13,601 parcels kept: B 2,972, F1 9,755, F2 874; 40 rows out of scope (class 744, 410, 734, 740,
  741).
- 100,553 facts written; 9,475 organisation owners stored; 4,126 owners that are natural persons
  not stored; 13,598 parcels with a market value; all with a situs.
- The class counts over the whole roll (SODA group-by, no download) give the same Monroe figures
  and these in-scope totals for the other counties: Suffolk 27,373 (B 6,933, F1 17,806, F2 2,634);
  Nassau 23,449 (B 3,428, F1 18,871, F2 1,150); Westchester 37,456 (B 26,053, F1 10,870, F2 533);
  Erie 24,108 (B 7,603, F1 15,341, F2 1,164).
- Samples of the first 3,000 commercial rows by SWIS and print key for the other four counties,
  fetched with the collector's user agent and loaded into the same scratch registry: Suffolk 1,217
  kept (the first rows are Babylon class 410, out of scope; 961 organisation owners); Nassau 2,338
  (B 1,256, F1 1,018, F2 64; 1,044 organisation owners); Westchester 2,995 (B 1,421, F1 1,247,
  F2 327; 1,587); Erie 3,000 (B 1,195, F1 1,732, F2 73; 1,458). The scratch registry holds 23,151
  parcels with no key collision.
- Full market value is reported on 19,991 of Suffolk's 42,709 commercial and industrial rows, 28,668
  of Nassau's 29,138, 21,793 of Westchester's 37,533, 25,394 of Erie's 25,800 and 13,632 of Monroe's
  13,641.

## Full load (2026-11-03)

Release `data-2026-11-03-41603209834` (draft, maintainers only) of `9mp96ygnbk-alt/factlot`. Each asset's sha256 was checked against the manifest and its first 16 hex characters against the name. Loaded into the Tier 2 scratch registry (one SQLite file shared by every Tier 2 source, `ct-sos-entities` first).

Assets (document id from the manifest):

- `ny-orpts-rolls__1e1010c25009dd71__7vem-aaz7.csv` (9,655,351 bytes): `fl:document:sha256-1e1010c25009dd71daee640b5e73920a59ff35db9a89551222c36beb7d303c72`
- `ny-orpts-rolls__8c7c38ccbbd2f56d__7vem-aaz7.csv` (6,838,782 bytes): `fl:document:sha256-8c7c38ccbbd2f56d81596317aec14143812401d4693f11178c3fd0a7936b80bd`
- `ny-orpts-rolls__4cc95600e3af42ea__7vem-aaz7.csv` (8,409,239 bytes): `fl:document:sha256-4cc95600e3af42ea36edacfa88a72ddd91bd96a7fde3327bf69035b6d2f17fcf`
- `ny-orpts-rolls__beceb1fbccf335d3__7vem-aaz7.csv` (5,880,903 bytes): `fl:document:sha256-beceb1fbccf335d3b1958f0ab588d756b6a5ad2218c0d8346b52155ff4773cc1`
- `ny-orpts-rolls__b38f57c130565485__7vem-aaz7.csv` (3,208,024 bytes): `fl:document:sha256-b38f57c1305654853edfbb09c7821f4a9707d1930492f18557782128ac3c76c8`

Command:

```
PYTHONPATH=python/src python3 -m factlot.registry.adapters.ny_orpts <county csv> registry.db --as-of 2026-04-24 --tax-year 2025 --retrieved-at <manifest checked_at>   # once per county file, no --full-roll
```

- Rows read: 148,821 data rows in the five county files (Suffolk 42,709, Nassau 29,138, Westchester 37,533, Erie 25,800, Monroe 13,641); the adapter drops classes 410, 412 and the 730-749 range at read time, so its records equal the parcels kept.
- Parcels kept: **125,987** distinct commercial parcels (`B` 46,989, `F1` 72,643, `F2` 6,355).
- By county:
  - Monroe (FIPS 36055): 13,601 parcels (`B` 2,972, `F1` 9,755, `F2` 874); organisation owners 9,468; ownership links 70.
  - Suffolk (FIPS 36103): 27,373 parcels (`B` 6,933, `F1` 17,806, `F2` 2,634); organisation owners 16,841; ownership links 53.
  - Nassau (FIPS 36059): 23,449 parcels (`B` 3,428, `F1` 18,871, `F2` 1,150); organisation owners 17,341; ownership links 48.
  - Westchester (FIPS 36119): 37,456 parcels (`B` 26,053, `F1` 10,870, `F2` 533); organisation owners 12,848; ownership links 110.
  - Erie (FIPS 36029): 24,108 parcels (`B` 7,603, `F1` 15,341, `F2` 1,164); organisation owners 13,011; ownership links 46.
- Facts written: 860,268. Seconds: 46.5. Invalid ids, errors, retired: 0, 0, 0.
- Organisation owners stored (current owner-of-record facts): 69,509; natural persons or withheld owners not stored (names not kept): 56,471.
- Ownership links to registered entities after `link_owners()`: 327 (the only entity registry in the scratch file is `ct-sos-entities`).
- Suffolk's roll holds many class-410 seasonal homes that are out of scope; the figures above are in-scope classes only. The counts equal the SODA class counts recorded in the review run above (Suffolk 27,373; Nassau 23,449; Westchester 37,456; Erie 24,108; Monroe 13,601).

## Known gaps

- No building area, year built or lot area: the roll has `front` and `depth` only, which are not an
  area. Land area, improvement area and year built stay empty.
- `full_market_value` is zero or blank for many Suffolk rows and for some elsewhere; it is stored as
  no figure, not as zero. `assessment_total` is a fractional assessed value and is not stored.
- Class 411 has no unit count, so a small walk-up counts as multifamily; Westchester's 26,053 class
  411 and 413 parcels look high for apartment buildings and may include co-operative and condominium units.
  Check against an independent count before relying on Westchester's multifamily total.
- Situs has no ZIP and uses the assessing city or town (a village address carries the town name).
- Villages that assess separately and the five New York City boroughs are not in this dataset.
- Only the primary owner is read. Print-key equivalence across roll years is not checked.
