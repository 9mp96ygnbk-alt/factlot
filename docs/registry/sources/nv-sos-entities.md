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

## Real run

None. No adapter.

## Known gaps

Everything beyond the existence of a paid service. The Clark County parcel source has a review (`nv-clark-assessor`).
