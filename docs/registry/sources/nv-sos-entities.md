# Nevada Secretary of State: business entities (access review)

Review date: 2026-11-02. Verdict: **bulk data is a paid account service; price and terms unconfirmed; the site blocks the collector; `verified: false`; no adapter.**
Config: [`registry/sources/nv/nv-sos-entities.json`](../../../registry/sources/nv/nv-sos-entities.json).

## Publisher and URLs

- Nevada Secretary of State, Commercial Recordings Division (`https://www.nvsos.gov/sos/commercial-recordings`); filings and search through SilverFlume (`nvsilverflume.gov`).
- Online-services account system (login page lists "Bulk Data Download"): `nvsosuat.nv.gov/SOSWebAccountManager/Login.aspx` (a test-domain copy surfaced in search).

## Terms, license, robots

- **robots.txt and pages could not be read.** `www.nvsos.gov/robots.txt` answered the collector's user agent with an Imperva/Incapsula bot-challenge page (HTTP 200, HTML, a JavaScript challenge), not a robots file; the collector's `discover` of the commercial-recordings page returned "ok" with no links, which matches a challenge page. The challenge was not solved or bypassed.
- What was found through search indexes: a Secretary of State public-records page (test domain) says additional data reports are available "via the bulk data download service", with customized reports of raw data from the corporations, UCC, voter registration and notary databases. No price was found on any readable official page.
- Vendor claims, not relied on: Topograph says bulk data is a paid subscription only; a Global Database blog says a full corporations dump is $125 and unlimited reports $500 a month, and that SilverFlume was switched off on 2026-09-14 in favour of "ORION". None of this was confirmed against an official page.
- License, AI use, redistribution: unknown.

## What the file contains

Unknown.

## Gates

1. Edge bot-protection on nvsos.gov (a person must read the pages in a browser and, if needed, ask the Division to allow the collector).
2. A registered Secretary of State online-services account to order Bulk Data Download (not created).
3. An unknown price and unread terms. Contact: Commercial Recordings, 775-684-5708.
4. Confirm whether SilverFlume has been replaced and whether the bulk service moved.

### Terms read 2026-11-03 (gates pass)

This memo is research, not legal advice; the founder holds no attorney or real estate license.

No commercial-recordings price, order form, format, frequency, postal address, email, or product clause was readable. Each URL returned HTTP 200 and a 212-byte Incapsula shell. The founder should open:

- https://www.nvsos.gov/sos/commercial-recordings
- https://www.nvsos.gov/sos-information/public-records-requests
- https://www.nvsos.gov/SOSServices/AnonymousAccess/PricingGuide.aspx
- https://www.nvsos.gov/businesses/commercial-recordings/forms-fees

**Statute, not the product contract.** NRS 239.010(1), https://www.leg.state.nv.us/nrs/nrs-239.html , read 2026-11-03.

> Any such copies, abstracts or memoranda may be used
> to supply the general public with copies, abstracts or memoranda of the records

The section does not use the word commercial. It governs public books. It was not a substitute for the blocked commercial-recordings terms.

Price per year: NOT CONFIRMED. Restrictive product clause: NOT CONFIRMED. Do not load a Nevada SOS bulk file from an unread license. Draft inquiry, with the address marked NOT CONFIRMED: `../requests/orders/nv-sos-entities-order-draft.md`.

## Real run

None. No adapter.

## Known gaps

Everything beyond the existence of a paid service. The Clark County parcel source has a review (`nv-clark-assessor`).
