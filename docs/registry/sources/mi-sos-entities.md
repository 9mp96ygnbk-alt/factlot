# Michigan LARA Corporations Division: business entities (access review)

Review date: 2026-11-02. Verdict: **no bulk entity file found, free or sold; michigan.gov blocks the collector; `verified: false`; no adapter.**
Config: [`registry/sources/mi/mi-sos-entities.json`](../../../registry/sources/mi/mi-sos-entities.json).

## Publisher and URLs

- Michigan Department of Licensing and Regulatory Affairs (LARA), Bureau of Corporations, Securities and Commercial Licensing (CSCL), Corporations Division. (Michigan's Secretary of State handles vehicles, not business entities.)
- Corporations Division: `https://www.michigan.gov/lara/bureau-list/cscl/corps`; MiBusiness Registry Portal (replaced COFS in June 2025); entity search `www.michigan.gov/corpentitysearch`.
- LARA data sets index: `https://www.michigan.gov/lara/about/reports-data-sets`; CSCL License List and Data: `.../cscl/licensing/critical-links/cscl-license-list-and-data`.

## Terms, license, robots

- **Blocked.** `www.michigan.gov` (Akamai) answered the collector and `curl` with `403 Access Denied` for every path, including `/robots.txt`; `discover` recorded `HTTP Error 403: Forbidden`. The block was not worked around. The findings below are from search-index snippets of michigan.gov pages and are unverified by a direct read.
- Found: LARA publishes aggregate "Total Business Entities as of <date>" counts by type and good-standing status (counts, not records). The "CSCL License List and Data" form delivers licensee lists (entity name, owner, license type, county) as .xlsx by email; that is professional-licence data, not the corporate register. No corporate bulk extract, price or order form turned up. A vendor (Topograph, not the publisher) says Michigan publishes no bulk corporate extract.
- License, AI use, redistribution: none found.

## What the file contains

No file.

## Gates

A person should (1) ask the Corporations Division (517-241-6470) whether a bulk or custom extract exists and at what price, or (2) file a Michigan FOIA request through LARA for an entity extract (see [public-information-requests.md](../public-information-requests.md) for the pattern). Do not scrape the portal search.

### Terms read 2026-11-03

This memo is research, not legal advice.

No bulk entity product was named on the pages read.

Corporations Division, https://www.michigan.gov/lara/bureau-list/cscl/corps (read 2026-11-03):

> As of June 23, 2025, the new MiBusiness Registry Portal is live! You can now submit filings online, perform searches, and request

Data-sets index, https://www.michigan.gov/lara/about/reports-data-sets (read 2026-11-03):

> Below is a list of available data sets and reports from bureaus inside LARA.

The Corporations, Securities & Commercial Licensing entries on that index are "CSCL License List and Data" and "Disciplinary Action Reports". The license-list page was not opened.

FOIA procedures, effective September 10, 2024, read 2026-11-03: email LARAFOIAInfo@michigan.gov, mail c/o FOIA Coordinator, Ottawa Bldg., 4th Floor, P.O. Box 30004, Lansing, MI 48909. Portal www.michigan.gov/larafoia was not used.

> estimate exceeds fifty dollars a deposit will be required to initiate processing

Statute, from a capture read 2026-11-02, MCL 15.233, https://www.legislature.mi.gov/Laws/MCL?objectName=mcl-15-233 :

> the person's agent who is an individual.

> inspect, copy, or receive copies of the requested public record of the public body.

No section read addresses commercial use or redistribution. The statute as captured is silent on both. It does not require the Department to create a new compilation.

A FOIA request would ask for an existing extract of entity id, legal name, status, type, formation date, and organisation address, with no natural-person officer or member names. It is made by an individual agent, and a deposit is required when the estimate exceeds fifty dollars. No request was sent.

## Real run

None. No adapter.

## Known gaps

Whether any bulk product exists; the Wayne County parcel source exists (`mi-wayne-parcels`).
