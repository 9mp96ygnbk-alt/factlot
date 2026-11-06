# Massachusetts Corporations Division: business entities (access review)

Review date: 2026-11-02. Verdict: **paid bulk extract set by regulation ($4,800/year or $100/week); the publisher's hosts block the collector; nothing confirmed; `verified: false`; no adapter.**
Config: [`registry/sources/ma/ma-sos-entities.json`](../../../registry/sources/ma/ma-sos-entities.json).

## Publisher and URLs

- Secretary of the Commonwealth of Massachusetts, Corporations Division (`corp.sec.state.ma.us`, `www.sec.state.ma.us`, `www.mass.gov`).
- Regulation: 950 CMR 113.15 "Corporate Record Availability" (read on the Cornell LII, Justia and a Cloudfront mirror; current to Register 1538, 2025-01-03).
- Contact (from search results): cis@sec.state.ma.us, 1-800-392-6090.

## Terms, license, robots

- 950 CMR 113.15 (as summarised by the sources read): a bulk extract of the Corporations Information Management System data is available monthly in weekly increments, at $4,800 per year or $100 per week; the data elements and file layouts are available from the filing office on request. The Division's fee schedule (updated 2022-03-14) covers filing fees and, in the part seen, no bulk price.
- **Hosts blocked the collector.** `www.sec.state.ma.us` answered the collector's requests (robots.txt and the fee schedule) with a `302` redirect loop; `discover` on the corporation search page recorded "infinite loop"; `www.mass.gov` returned `403 Not allowed`. robots.txt was therefore unreadable and the Division's own pages were not read.
- License, AI use, redistribution: not addressed by the regulation; the order terms (if any) were not read.
- Not the same register: the Department of Revenue's "Corporations Book" (`mass.gov/service-details/the-corporations-book`) lists corporations subject to Massachusetts taxation and is downloadable in Excel through an online search; it is DOR data, was not readable, and is not used.

## What the file contains

Unknown; "available from the filing office upon request".

## Gates

1. Contact the Corporations Division for the current price, order form, layout and any license (a request to the publisher, which is a person's job).
2. Pay.
3. Someone must read the Division pages in a browser, since the collector is blocked.

### Terms read 2026-11-03

This memo is research, not legal advice.

No price, order form, delivery format, update frequency, postal address, email, or use clause was readable. These pages need a person in a browser:

- https://www.sec.state.ma.us/divisions/corporations/corporations.htm — HTTP 200, 212-byte Incapsula shell
- https://www.mass.gov/info-details/massachusetts-law-about-corporations — HTTP 403, "Not allowed"
- https://www.mass.gov/regulations/950-CMR-11300 — HTTP 403, "Not allowed"
- https://www.law.cornell.edu/regulations/massachusetts/950-CMR-113.15 — HTTP 200, and the page text has no regulation body. It is not a quotation source for 950 CMR 113.15.

No statute text for this product was read, so no section number or fee is given. Price per year: NOT CONFIRMED. Restrictive clause: NOT CONFIRMED.

There is nothing to treat as permission to redistribute Massachusetts entity records, and nothing to load.

## Real run

None. No adapter.

## Known gaps

Current price (the regulation figure may be stale), layout, terms. The Boston assessing source exists (`ma-boston-assessing`).
