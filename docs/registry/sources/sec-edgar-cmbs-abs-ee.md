# sec-edgar-cmbs-abs-ee: SEC EDGAR, CMBS loan-level data (Form ABS-EE, Exhibit 102)

Review record for the sources `sec-edgar-cmbs-<CIK>` (one source per CMBS trust; data policy §5). Reviewed
2026-11-04. Adapter: `python/src/factlot/registry/adapters/sec_cmbs.py`; tests:
`python/tests/test_adapter_sec_cmbs.py`; download script: `scripts/registry/sec_edgar.py` (tests:
`python/tests/test_sec_edgar_script.py`). There is no collector config under `registry/sources/`: the SEC asks for its
own declared User-Agent, which the generic collector does not send, so these files are fetched by the script.

Predicate: `debt.cmbs_loan` ([fact model](../../fact-model.md#predicates-from-sec-filings)). It answers the persona
asks for building-level loan balance, maturity and servicing status (B01-P06, B04-P17, B07-P06, B10-P14 in the
[live product review](../../research/2026-11-live-product-review/appendix.md)).

## Publisher and URLs

- Publisher: U.S. Securities and Exchange Commission (EDGAR); the facts are the issuing trusts' own filings.
- Every registered CMBS trust files **Form ABS-EE** with each monthly distribution report: an Exhibit 102 XML file
  (namespace `http://www.sec.gov/edgar/document/absee/cmbs/assetdata`) with one `<assets>` element per mortgage loan
  and a nested `<property>` per property securing it (Regulation AB II, Item 1125 Schedule AL, 17 CFR 229.1125), and an
  Exhibit 103 of comments. Code tables: EDGAR ABS XML Technical Specification v3.1, March 2025, section 4.3
  (<https://www.sec.gov/files/absxml-31.zip>; sha256 `0d5dcc22…ca3aeb`, read 2026-11-04).
- Found through the EDGAR full-index (`https://www.sec.gov/Archives/edgar/full-index/2026/QTR3/form.idx` and `QTR4`,
  one request each), then per filing `…/Archives/edgar/data/<CIK>/<accession>/index.json` and the Exhibit 102 file
  (`exh_102.xml`, `ex102.xml`; 113 KB to 1.3 MB each, 171 MB in all). No crawling, no search, no use of `efts.sec.gov`.

## Terms, license, robots, fair access

- **Public information.** The SEC's website policy (<https://www.sec.gov/about/privacy-information>, "Website
  Dissemination", read 2026-11-04) says information on sec.gov is public and may be copied or further distributed
  without the SEC's permission, and asks that the SEC be cited as the source. Filings are the registrants' own
  disclosures; the registry stores structured values read from them and cites the filing. AI use: not addressed;
  recorded `unknown`. Redistribution: `permitted`. Attribution: the SEC (EDGAR) and the filing trust.
- **Fair access** (same page, and <https://www.sec.gov/os/accessing-edgar-data>, <https://www.sec.gov/about/webmaster-frequently-asked-questions>):
  scripted access is allowed with a declared User-Agent; the current maximum is 10 requests per second, and
  "unclassified" bots that crawl the site are not allowed. The owner approved the User-Agent
  `FactLot <contact address>` for requests to sec.gov, efts.sec.gov and data.sec.gov (2026-11-04). It is read from the
  environment variable **`FACTLOT_SEC_USER_AGENT`**, is sent only to those hosts, and is written nowhere in the
  repository. The script refuses to run without it, refuses a request interval under 0.2 s, sends nothing to other
  hosts, and logs every request to `requests.log`.
- **robots.txt** (`www.sec.gov`, read 2026-11-04): disallows `/core/`, `/profiles/`, `/admin/`, `/search/`,
  `/Archives/bin`, `/Archives/etc`, `/Archives/usr` and the like; `/Archives/edgar/` is not disallowed.
- **Rate actually used** (2026-11-03/04): 0.25 to 0.3 s between requests (about 3.5 per second), one stream, 1,146
  requests in about 35 minutes for this source and the Exhibit 21 source together (this source: 2 `form.idx`, 377
  `index.json`, 377 Exhibit 102 files, plus the SEC's specification zip, three policy pages and `robots.txt`). Five HTTP 503 answers
  (two on `index.json`, three on a URL that does not exist) were each backed off 10 to 20 seconds and retried; for a few
  seconds two of the review's own helper processes overlapped, never above the SEC's 10 per second.
- `verified: true` for use in the registry: terms recorded, URLs confirmed by real downloads, redistribution permitted.

## Scope: what this covers

- **Trusts.** Every issuing entity with an ABS-EE in the full-index for 2026 Q3 and Q4 (to 2026-11-03) whose name
  looks like a CMBS trust: **377 trusts** (BANK, BANK5, BBCMS, Benchmark, BMO, Citigroup, COMM, CSAIL, GS, JPMCC/JPMDB,
  Morgan Stanley, UBS, Wells Fargo and others, 2016 to 2026 issues). All 377 files' roots were the CMBS asset data
  namespace. The 334 other issuers with ABS-EE in the window are auto-loan and lease trusts and were not requested; the
  7 depositor filings (new-issue pools before the trust has its own filer) were skipped. Registered CMBS only: the large
  private-placement (144A) single-asset deals do not file ABS-EE and are not here.
- **Period.** The latest ABS-EE of each trust: reporting periods ending 2026-10-06 to 2026-10-13 for 375 trusts and
  2026-11-12 for two (the period end can fall after the filing date). One snapshot per trust (`as_of` = reporting
  period end); the next month's file replaces the facts of the buildings it covers and retires those it no longer lists.
- **Loans.** A file lists every loan the trust has ever held. Of the **28,476** loan rows, **12,120** are not in the trust
  at period end (a zero or missing balance) and are left out; **126** whose balance fell to zero during the period are
  kept with `paid_off_in_period: true` and the liquidation/prepayment code. Properties: 26,235 on the kept loans.
- **Property types** kept: office, retail, industrial, warehouse, multifamily, mixed use, lodging, self storage,
  healthcare, mobile home park and cooperative housing (the registry holds commercial, industrial and multifamily
  property only). Left out and counted: 1,040 coded "Other" (770 of them in Hawaii, others parking garages; the
  registry cannot tell which are commercial), 5 "Missing Information", 84 without a type.
  2,704 placeholder rows with no address and no state ("Defeased" collateral, portfolio lines) are counted, not stored.

## What a fact holds, and what it does not

Per loan and property: trust and CIK, loan ID in the trust (`Prospectus Loan ID`), reporting period, originator, dates,
original balance, **current (scheduled) balance**, balance at securitization, interest rate (percent), term,
amortization, payment type, loan structure (whole loan, pari passu note, A/B note...), properties in the loan,
**payment status** (code and SEC description: current, 30-59, 60-89, 90+, matured balloon performing or not, in grace,
late under 30 days), paid-through date, **primary servicer**, **special servicer transfer date, master servicer return
date and `specially_serviced`** (true when a transfer date is reported and no later return date is), **workout
strategy**, modification code and dates; and for the property: name and address as filed, type, square feet, units,
year built and renovated, **occupancy** (most recent and at securitization), **NOI, net cash flow and DSCR** (most
recent period with its dates, and at securitization), valuation (amount, date, source), property and defeasance
status, and up to three **largest tenants** with square feet and lease expiration. Every field is in the filing; `placement`
records how the building ID was keyed.

- **No borrower or sponsor.** Schedule AL has no such field. The organisations it names are the originators, the
  servicer and tenants. Tenant names are stored when `is_organization` reads them as an organisation, or when the
  name recurs as a tenant of at least 5 properties in at least 3 of the 377 files (a chain: "Dollar General",
  "Walgreens"); every other tenant name (a person, or a business with no organisation word that is not a
  recurring chain) is dropped and counted. 18,213 tenant entries kept (5,845 by recurrence), 9,317 dropped.
- **No watchlist status.** The CREFC watchlist is part of the Investor Reporting Package, not Schedule AL, so the
  registry does not claim one. Servicing is shown by the payment status code, the transfer and return dates and the
  workout strategy.
- **Balances are the trust's loan, not the property's share.** A loan secured by several properties repeats its
  balance on each property's fact (`properties_in_loan` says how many); nothing is allocated. A whole loan split into
  pari passu notes held by several trusts has one fact per trust (a building can hold several `debt.cmbs_loan` facts,
  newest report first); they are different notes of one loan and must not be added without checking
  `loan_structure`. Of 21,695 loan-property rows, 21,595 are distinct facts on 16,701 buildings (13,060 distinct
  trust and loan pairs, $243.3 billion scheduled balance).
- The method is `public_record` (the values are as filed). The building key is derived (below).

## Placing a property on a building ID

The filing gives state, ZIP code and a county _name_, but a building ID is keyed by county FIPS
(`fl:building:us-<SSCCC>:<zip5>:<street>`). The county is placed by `CountyLocator` from two U.S. Census Bureau files
(US government works, public domain; downloaded 2026-11-04 with the registry bot's User-Agent; robots.txt of
`www2.census.gov` does not disallow them):

- ZIP Code Tabulation Area to county relationship file, 2020:
  <https://www2.census.gov/geo/docs/maps-data/data/rel2020/zcta520/tab20_zcta520_county20_natl.txt> (sha256
  `3ed41278…eaaaf`, 6.8 MB);
- County names and FIPS codes, 2020: <https://www2.census.gov/geo/docs/reference/codes2020/national_county2020.txt>
  (sha256 `9f6e5f6e…970d6`).

Rules, in order: a ZIP code area lying (by land, ignoring slivers under 1%) in one county of the property's state decides;
in several counties the filing's county name picks among them, else a county holding 95% or more of the land; with no
usable ZIP code area, the county name alone. A four-digit ZIP code gets its leading zero back. `placement.method` says
which rule fired. **ZCTAs are not ZIP codes** (they approximate the Postal Service's delivery areas) and the filings have
typing errors, so the key can be wrong; 89 properties whose county name names another county than the ZIP code area
(mostly "St. Louis", "Baltimore", "Richmond" meaning the independent city) are placed by the ZIP code area and marked
`zip_code_area_county_name_differs`. A field listing several house numbers is placed at the first
("48371, 48377 & 48383 Fremont Boulevard" is 48371 Fremont Boulevard; `placement.address_used` says so; 1,709
properties); the address as filed stays in the fact.

**Not placed (counted, no fact):** 707 properties: 397 with no ZIP code and no county, 157 with no street address, 67 with
no house number ("Various"), 39 with no ZIP code, 36 in a ZIP code area spanning several counties with no county name to
choose, 9 with no U.S. state (Canadian provinces, Brazil, blank), 2 with a ZIP code in no area. Unplaced rows are not kept anywhere in the registry.

**Linking to parcels.** `link_parcels` reads every current situs address in the registry, computes the building ID the way
the building roll-up does (plus the reading of a bare street number as an ordinal: DOF's `WEST 68 STREET` is
`68th Street`), and for a building ID with exactly one parcel writes `building --located_on--> parcel` (`inferred`,
confidence 0.8, basis in the link). Buildings with two or more parcels at the address are the roll-up's: the CMBS facts
sit on the very building subject the roll-up makes. Run `maintain` (roll-up) before linking.

## Real run (2026-11-04)

All 377 trusts into one scratch registry, then into copies of the NYC and DC registries (the two with building-level
parcels at hand), `scratchpad/data/edgar/`:

| Count                                                          |                               |
| -------------------------------------------------------------- | ----------------------------: |
| trusts with an Exhibit 102 / with at least one fact            |                     377 / 375 |
| loan rows in the files / not in the trust / paid off in period |         28,476 / 12,120 / 126 |
| properties on kept loans / stored / not placed / out of scope  | 26,235 / 21,695 / 707 / 1,129 |
| distinct facts / buildings / buildings holding more than one   |       21,595 / 16,701 / 2,788 |
| states (incl. DC, PR) / counties                               |                    53 / 1,491 |
| facts with NOI and DSCR / occupancy / largest tenants          |      14,131 / 13,868 / 10,556 |
| loans specially serviced (transferred, not returned)           |                643 ($15.7 bn) |
| loans 30+ days delinquent or matured non-performing            |                487 ($10.8 bn) |
| loans maturing through 2027-12-31 (balance above zero)         |              1,806 ($33.5 bn) |
| run time (parse and ingest, all trusts)                        |                          20 s |

NYC (164,633 DOF commercial parcels, roll-up run): 2,055 CMBS buildings in the five boroughs; **1,050 linked to one
parcel (1,120 links) and 78 tied by the roll-up**, 4 skipped for over 25 parcels (55% of buildings; 583 are
cooperative buildings the DOF commercial scope does not hold, which explains much of the rest). DC (18,077 parcels): 63
CMBS buildings, **40 linked and 2 rolled up**.
`python -m factlot.registry.audit` was not re-run on these scratch copies.

## Known gaps

- Registered CMBS trusts only, latest month only (no history): a monthly cron over the same script builds history.
- Properties of "Other" type, 5 "Missing Information" and defeased collateral are not stored (counted above).
- Tenant names of a person-like form are dropped, and so are brand names that occur at fewer than 5 properties.
- The county of 89 properties may be wrong where the filing's ZIP code is wrong; `placement.method` flags them.
- NYC co-ops and properties the commercial roll does not hold have no parcel to link to.
- Loan data is as the servicer reported it to the trustee; it is not verified against the loan documents.
