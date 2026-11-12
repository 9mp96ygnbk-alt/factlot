# ny-nyc-dof-acris: NYC recorded deeds, mortgages and satisfactions (ACRIS)

Review record for the source `ny-nyc-dof-acris` (data policy §5). Reviewed 2026-11-04. Machine-readable copy:
[`registry/sources/ny/ny-nyc-dof-acris.json`](../../../registry/sources/ny/ny-nyc-dof-acris.json). Adapter:
`python/src/factlot/registry/adapters/ny_acris.py`; tests: `python/tests/test_adapter_ny_acris.py`.

ACRIS (Automated City Register Information System) is the New York City Register's index of recorded real property
documents; the Department of Finance (DOF) publishes it on NYC Open Data as linked tables. This is an **enrichment**
source: it creates no parcels. Each deed, mortgage and satisfaction that affects a commercial, industrial or multifamily lot
the DOF roll ([ny-nyc-dof](ny-nyc-dof.md)) already holds becomes a fact on that lot (borough-block-lot match), with the
document type, dates, amount and the **organisations** among its parties. Natural persons are dropped when the file is
read and are not stored in any form.

## Publisher and URLs

- Publisher: New York City Department of Finance. NYC Open Data datasets (attribution "Department of Finance (DOF)",
  tag "acris land records", made public 2013-09-23, updated monthly, "data last updated" 2026-10-08, `good_through_date`
  2026-09-30):
  - `bnx9-e6tj` "ACRIS - Real Property Master": 17,117,230 documents; `document_id`, `crfn`, `doc_type`, `document_date`,
    `document_amt` ("principal debt or obligation"), `recorded_datetime` ("legal date instrument was recorded"),
    `percent_trans` ("reported percentage of interest transferred"), `good_through_date`.
  - `8h5j-fqxa` "ACRIS - Real Property Legals": 22,797,599 rows, one per lot a document affects; `borough`, `block`, `lot`,
    `easement`, `partial_lot`, `air_rights`, `subterranean_rights`, `property_type`.
  - `636b-3b5g` "ACRIS - Real Property Parties": 46,695,140 rows; `document_id`, `party_type`, `name`, address columns.
  - `7isb-wh4c` "ACRIS - Document Control Codes" (document types and what party 1 and 2 are), read, not downloaded. The
    attached guides (`ACRIS_Public_OpenData_Extract_Guide`, the data dictionary) were not downloaded.
    The same data is in DOF's ACRIS web application (`a836-acris.nyc.gov`); that site was not used.
- Files used: one SODA request per dataset per document-ID year (a document ID begins with the year it was filed:
  `2025061001109008`; the older `BK_` and `FT_` IDs are the pre-ACRIS reel-and-page records and are not requested), **2013 to 2026**, each CSV
  with a `$select` of the columns above and a `$where` on the year. Master is limited to the 14 document types below; Parties
  to party types 1 and 2 and to `document_id`, `party_type`, `name` (no address columns). 42 files, 1.32 GB, archived by
  the collector on 2026-11-04 (UTC). Row counts match a `count(*)` of the same query (2025 Legals: 417,624).
  Document IDs go back to 2003 (about 9 million documents of the types below); an earlier year is the same request with
  another year and is a config line.

## Terms, license, robots

- **NYC Open Data terms.** As [ny-nyc-dcp-pluto](ny-nyc-dcp-pluto.md): the NYC Open Data FAQ
  (<https://www.nyc.gov/opendata/get-started/FAQs>, read again 2026-11-04) says "Open Data belongs to all New Yorkers. There
  are no restrictions on the use of Open Data." The datasets have no licence field of their own. AI use: not addressed,
  recorded `unknown`. Redistribution: permitted. Attribution: New York City Department of Finance, ACRIS. The Tyler/Socrata
  platform-terms question is the one in [`../requests/platform-terms/socrata.md`](../requests/platform-terms/socrata.md).
- **ACRIS is an index, not the documents.** A fact says what the index records (document type, date, amount, parties as
  typed by the filer, truncated to 50 characters); the recorded instrument is the authority.
- **robots.txt** `data.cityofnewyork.us`: `Crawl-delay: 1`, only `/browse` search pages disallowed. Requests 2 seconds
  apart, identified collector, no account or click-through. `verified: true`.
- **Natural persons in the raw files.** The Parties files name the parties of every document, including individuals (a
  mortgage on a house lists the borrower). Like the appraisal rolls, the archived raw files therefore stay private
  (data policy §3, "Raw archives stay private"); only facts and citations are published. The adapter reads a party's name only
  to ask `is_organization`, keeps it only if it says yes, and counts the rest. A test checks that no person appears in the
  registry file's bytes. **Open point:** whether the collector should archive these party files at all, or whether
  the adapter should read the live API and archive an organisation-only extract (the citation would then point at the
  extract, not the publisher's file).

## What the adapter reads and writes

| Document types                                          | Predicate                             | Parties (ACRIS control codes)                    |
| ------------------------------------------------------- | ------------------------------------- | ------------------------------------------------ |
| `DEED`, `DEEDO`, `DEED, RC`, `IDED`, `CONDEED`, `CORRD` | `transaction.deed`                    | party 1 grantor/seller, party 2 grantee/buyer    |
| `MTGE`, `M&CON`, `CMTG`, `SMTG`, `MMTG`                 | `debt.mortgage_recorded`              | party 1 borrower/mortgagor, party 2 lender       |
| `SAT`, `PSAT` (partial), `WSAT` (withheld)              | `debt.mortgage_satisfaction_recorded` | party 1 borrower, party 2 mortgagee (the lender) |

Each is one fact per document and lot, valued `{date (recorded), document_date, doc_type, doc_type_description, amount_usd,
percent_transferred, crfn, document_id, grantors/grantees or borrowers/lenders, organizations_only: true, lots_in_document,
partial_lot, air_rights, subterranean_rights}` (keys only where they apply; a satisfaction's zero amount is omitted, a deed's
or mortgage's amount is kept as recorded, zero included; at most 25 names per role, flagged `…_truncated`). `public_record`,
cited to the Legals file of the year (`ACRIS acris-legals-2025.csv BBL 1012920015 document 2025081800333001`); the three files
of the year are registered as snapshots of the source under the names `acris-master-<year>.csv`, `acris-legals-<year>.csv`,
`acris-parties-<year>.csv`, and the value carries the ACRIS document ID and CRFN, which a reader can look up.

- **Organisations only.** `is_organization` is deliberately conservative. Of the lender names on the 2025 mortgages (all
  classes), 72% pass; the largest groups it drops are clearly organisations: MERS (the nominee on most residential
  mortgages), the Secretary of Housing and Urban Development, `CITIBANK, N.A.` (one word), and credit unions
  (`… FEDERAL CREDIT UNION`). The rule is shared by every adapter, so it was not changed here; widening it (a "CREDIT UNION", a
  `…BANK` suffix, a short list of agencies) is a maintainers' decision. A deed to an individual lists no
  grantee, and `organizations_only: true` says why.
- **Withheld parties.** Each party the rule rejects (a person, an estate, a personal trust, a trustee named in person,
  a company followed by a personal trust) is counted in `<role>_withheld`, for example
  `grantors_withheld: {"count": 2, "kinds": ["estate", "person"]}`, with no name. A "<company> LLC <person> REV TR"
  party keeps its leading company in the role list when nothing of the person's name remains in it, and is counted
  too. The document is kept whatever its parties.
- **Multi-lot documents.** `lots_in_document` is the number of lots the Legals table lists for the document. A deed or
  mortgage over several lots is published on each lot with the full amount: do not sum it or divide it by one lot's area.
  Easement rows (`easement` = `Y`) are not an interest in the lot itself and are skipped (2,962 rows in 2021-2026).
- **Satisfactions** are events: ACRIS's Master and Legals do not say which mortgage a satisfaction ends (the References
  table `pwkr-dpni` does; it is not loaded), so the fact is not linked to one.
- **Currency.** Every year of a load is a snapshot with the same `as_of` (the extract's `good_through_date`), so all years are
  current together. A refresh must load every year again with the new `as_of`: a year left at the old date would stop being
  current.

## Real run (2026-11-04)

Into a scratch copy of the NYC registry; `python -m
factlot.registry.adapters.ny_acris nyc.db --as-of 2026-09-30 --set master.csv legals.csv parties.csv …` (one `--set` per year).

| Measure                                                                                          | Count                                       |
| ------------------------------------------------------------------------------------------------ | ------------------------------------------- |
| Years loaded (document-ID years)                                                                 | 2013-2026 (14; 42 files)                    |
| Master / Legals / Parties rows in the files                                                      | 2,356,580 / 6,624,392 / 13,338,490          |
| Documents of the 14 types with a recorded date, and with a lot                                   | 2,351,432 / 2,346,580                       |
| Lot-document facts the files yield (all five boroughs: deeds / mortgages / satisfactions)        | 872,467 / 1,051,278 / 793,181               |
| Parcel-year records that were registry parcels (the rest are other classes: residential, vacant) | 241,428 of 1,589,727                        |
| **Facts written**                                                                                | **433,660**                                 |
| Registry parcels with at least one (of 164,633)                                                  | **119,959 (72.9%)**                         |
| `transaction.deed`: facts / documents / parcels                                                  | 120,982 / 102,509 / 78,279                  |
| `debt.mortgage_recorded`                                                                         | 215,639 / 153,591 / 85,810                  |
| `debt.mortgage_satisfaction_recorded`                                                            | 97,039 / 72,292 / 51,006                    |
| On more than one lot (`lots_in_document` above 1): deeds / mortgages / satisfactions             | 43,846 / 97,762 / 38,964                    |
| With an organisation as grantee / lender / lender                                                | 86,411 (71%) / 200,436 (93%) / 86,829 (89%) |
| Party rows read / dropped as not an organisation (persons and names the rule is unsure of)       | 7,216,699 / 4,735,516 (66%)                 |
| Organisation names stored: total / distinct                                                      | 840,664 / 165,640                           |
| Stored names that fail `is_organization` when re-checked (must be 0)                             | 0                                           |
| Seconds                                                                                          | 82 + 111 + 54                               |

By document type: `MTGE` 206,216; `DEED` 116,998; `SAT` 96,929; `M&CON` 8,364; `CORRD` 3,411; `CMTG` 952; `DEEDO` 518; `PSAT` 110;
`SMTG` 107; `DEED, RC` 55 (`IDED`, `CONDEED`, `MMTG`, `WSAT` none on registry lots in these years). Facts per recorded year run
from 5,858 deeds (2020) to 11,227 (2015), and from 10,085 mortgages (2026, to September) to 19,731 (2013).

Spot check: 590 Madison Avenue (BBL 1012920015) reads a `transaction.deed` recorded 2025-08-18 for $1,080,000,000, grantor
`590 MADISON AVENUE, LLC`, grantee `RXR 590 MADISON OWNER LLC`, `lots_in_document` 3 (the same price DOF's sales file shows on three lots
for 2025-08-14), CRFN 2025000223235. `python -m factlot.registry.audit` on the scratch file: no violation, no citation gap, no fact
without a locator for this source.

**Staten Island has no deeds or mortgages here.** The Master table's `recorded_borough` takes the values 1 to 4 only: the
dataset holds no document recorded in Richmond County, and the Legals rows that name Staten Island lots (9,427 in 2025) belong to
other document types (the three examined are transfer-tax returns, `RPTT`, carrying another borough's recording code). The 5,035
Staten Island registry lots therefore carry no ACRIS fact; their sales come from the DOF sales files.

## Known gaps

- Mortgage assignments (`ASST`), agreements, leases, UCC filings, releases and the pre-1999 paper-era documents are not
  loaded; neither are party addresses.
- Names are as typed and truncated to 50 characters by ACRIS (`THE CITY OF NEW YORK, ACTING BY AND THROUGH ITS DE`); no
  entity resolution is attempted, though an organisation name could later be matched to the entity registries.
- A deed amount of 0 or a nominal amount is not marked as a non-arm's-length transfer; ACRIS does not say.
- 2003 to 2012 are not loaded (a config line each; the 2003 files are the largest, 590,000 documents a year).
- Real Property Transfer Tax returns (`RPTT`, `RPTT&RET`, 620,000 documents) carry a sale's consideration and parties; they are not loaded.
