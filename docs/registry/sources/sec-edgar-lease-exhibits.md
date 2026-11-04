# sec-edgar-lease-exhibits: lease exhibits filed with the SEC

Review record for the source `sec-edgar-lease-exhibits` (data policy §5). Reviewed 2026-11-04. Adapter:
`python/src/factlot/registry/adapters/sec_lease_exhibits.py`; fetcher: `scripts/registry/sec_lease_exhibits_fetch.py`;
tests: `python/tests/test_adapter_sec_lease_exhibits.py`. Method and counts: [../../lease-comps.md](../../lease-comps.md#sec-lease-exhibits).

## Access

- EDGAR full-text search (`efts.sec.gov/LATEST/search-index`, JSON) for discovery; exhibits from
  `www.sec.gov/Archives/edgar/data/<cik>/<accession>/<file>`. The SEC asks for a declared User-Agent with a contact
  address and at most 10 requests per second (<https://www.sec.gov/os/accessing-edgar-data>). The fetcher reads the
  User-Agent from the environment variable **`FACTLOT_SEC_USER_AGENT`** (a name and an address; never written to a
  file in this repository), sends it only to `efts.sec.gov` and `www.sec.gov`, runs one stream and waits 1.5 seconds
  between requests. 5 discovery requests and 75 downloads on 2026-11-04 (47 MB).
- Terms: "Information presented on sec.gov is considered public information" and "may be copied or further
  distributed by users of the web site without the SEC's permission"; the SEC asks for citation
  (<https://www.sec.gov/about/privacy-information>). The page does not address copyright in a filer's exhibit, so the
  source is `ai_use: unknown`, `redistribution: attribution_required`, and **only extracted values and quotes of a
  sentence or so are stored, never an exhibit**. `verified: true` for this use.

## What is stored

For each lease: the verified facts (`lease.rentable_area_sf`, `lease.commencement_date`, `lease.expiration_date`, the
rent steps, `lease.free_rent`, `lease.ti_allowance`, `lease.opex_structure`, `lease.tenant`, `lease.landlord`), each
cited to the exhibit's SHA-256 (the snapshot), its URL, the accession number, the page and the quote; the `lease.comp`
built from them and its `lease.net_effective_rent`. Party names pass `is_organization` and are verified against their
quote. Signature blocks and execution language are refused as quotes before verification. Pages are those of
`html_pages` (HTML has no pages). Sample: 4 comps and 1 lease with verified facts only (see lease-comps.md).
