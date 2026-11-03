# Missouri Secretary of State: business entities (access review)

Review date: 2026-11-03. Verdict: **none found: no bulk entity file, free or sold, on any page read; `verified: false`; no adapter.**
Config: [`registry/sources/mo/mo-sos-entities.json`](../../../registry/sources/mo/mo-sos-entities.json).

## Publisher and URLs

- Missouri Secretary of State, Business Services Division (Corporations): <https://www.sos.mo.gov/business/corporations>. Free interactive search: <https://bsd.sos.mo.gov/> (not scraped).
- Open-data portal checked: data.mo.gov (Socrata; robots `Crawl-delay: 1`).

## Terms, license, robots

- `www.sos.mo.gov/robots.txt`: `User-agent: *`, `Disallow: /BusinessEntity/` (the search application), `/utility/Tiff2PDFKit/`, `/archives/resources/deathcertificates/`; two bots disallowed outright. `bsd.sos.mo.gov`: no robots.txt (404).
- The Socrata catalog search on data.mo.gov for "business entities" and for "secretary of state" returned only other states' datasets and the office's payroll and accounting files: no business register.
- From search-index text (unverified): RSMo 351.657 lets anyone get an abstract of a single entity's record for $5; the UCC bulk-records rule (15 CSR 30-90) provides bulk UCC data under a written agreement (not the corporate register). No corporate bulk product, price or order form turned up.
- License, AI use, redistribution: none found.

## What the file contains

No file.

## Gates

A person should ask the Business Services Division whether an entity extract exists and at what price, or file a Missouri Sunshine Law request (RSMo ch. 610; see [public-information-requests.md](../public-information-requests.md)) for an extract of entity id, name, status, type, formation date and registered office address without natural-person agent or member names. Do not scrape the search.

## Real run

None. No adapter.

## Known gaps

Whether any bulk product exists. St. Louis County and Jackson County parcels are gated (`mo-stlouis-county-parcels`, `mo-jackson-assessment`), so Missouri owners cannot link in any case yet.
