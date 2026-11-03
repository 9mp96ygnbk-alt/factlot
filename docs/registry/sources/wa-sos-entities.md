# Washington Secretary of State: business entities (access review)

Review date: 2026-11-02. Verdict: **the free bulk extract was retired; only an interactive search with a manual CSV export remains; `verified: false`; no adapter.**
Config: [`registry/sources/wa/wa-sos-entities.json`](../../../registry/sources/wa/wa-sos-entities.json).

## Publisher and URLs

- Washington Secretary of State, Corporations and Charities Division, system CCFS (`https://ccfs.sos.wa.gov/`).
- Open-data record: `https://data.wa.gov/api/views/f9jk-mm39.json` ("Corporations Search (Washington state)", attribution "Washington Office of the Secretary of State (OSOS), Corporations Division", last updated 2024-08-31).
- Former extract page `https://apps.sos.wa.gov/corps/AllData.aspx` now returns 404.

## Terms, license, robots

- The publisher's own data.wa.gov description states: "The Corporations Data Extract feature is no longer available." It tells customers needing a list to use CCFS Advanced Search (by business name, type, status, expiration date, formation date range, registered agent or governor) and export the result list "to an Excel spreadsheet" with the CSV icon.
- The record carries no license field. AI use and redistribution: not addressed; public record.
- robots.txt: `www.sos.wa.gov/robots.txt` has only the Drupal default rules. `data.wa.gov` is a Socrata portal (Crawl-delay 1 on the similar PA portal; not separately read for WA). The collector's `discover` read the data.wa.gov record ("ok").
- Not the same register: data.wa.gov dataset `4wur-kfnr` "Business Lookup" is the Department of Revenue's business-license and tax-account lookup (license "Public Domain"). It is a pointer with no columns on the portal and is a different publisher; it was not archived.

## What the file contains

No file. The CCFS advanced-search export (manual) lists businesses matching the filters; its columns were not examined because it is an interactive export, not a bulk file.

## Gates

No payment or account, but also no bulk file. The only way to a full list is repeated filtered searches through the CCFS application, which is scraping an interactive system and is not done. A person can (a) ask the Corporations Division (360-725-0377) whether a bulk product or a custom extract exists now, or (b) file a Public Records Act request for an extract.

### Platform terms read 2026-11-03 (gates pass, Task 5)

Tyler Technologies Terms of Use (served at <https://www.tylertech.com/terms/socrata-terms-of-service>, "Effective April 29, 2024"; HTTP 200, read 2026-11-03; matches the browser capture). Full notes: [`../requests/platform-terms/socrata.md`](../requests/platform-terms/socrata.md). Under "Restrictions on Use" the user may not:

> Use any computer code, data mining software, "robot," "bot," "spider," "scraper" or other automatic device, or program, algorithm or methodology having similar processes or functionality, or any manual process, to monitor or copy any of the Web pages, data or content found or accessed through the Services;

> Display, distribute, license, perform, publish, reproduce, duplicate, copy, create derivative works from, modify, sell, resell, exploit, transfer, or transmit for any commercial purposes, all or any portion of the Services

Read: these are Tyler's generic terms for its own "Services". The page refers to "the terms specific to a particular Service as applicable" and does not address a public agency's own dataset licence. Read literally, the scraper clause covers copying "data ... accessed through the Services", which is in tension with the collector's export downloads; the publisher's own dataset licence (recorded above) is what grants rights in the data. Decision for the founder: rely on the agency licence and treat the Tyler page as platform boilerplate, or ask the agency (not Tyler) to confirm that its licence governs bulk exports. Nothing was accepted.

## Real run

None. No adapter.

## Known gaps

Whether a paid or records-request extract exists since the August 2024 retirement. Vendor pages say CCFS reads are live and no bulk feed exists; third-party mirrors (opencorpdata.com and similar) hold pre-retirement snapshots and are not used. The King County parcel source already exists (`wa-king-assessor`).
