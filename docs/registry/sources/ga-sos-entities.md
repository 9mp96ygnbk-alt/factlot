# Georgia Secretary of State: business entities (access review)

Review date: 2026-11-02. Verdict: **paid ($100 set-up + $500 per access, or $1,000 once for the whole database) under a signed agreement with the Georgia Technology Authority; no free bulk file; `verified: false`; no adapter.**
Config: [`registry/sources/ga/ga-sos-entities.json`](../../../registry/sources/ga/ga-sos-entities.json).

## Publisher and URLs

- Georgia Secretary of State, Corporations Division; sold by the Georgia Technology Authority (GTA), Office of Data Sales / Data Innovations.
- Page: `https://georgia.gov/bulk-corporations-data`.
- Agreement: `https://georgia.gov/document/document/bulk-corporations-data-sales-agreement/download` ("Bulk Corporate Data Sales Agreement", PDF).
- Subscriber sign-up: `https://services.georgia.gov/gta/odi-innovations/newSubscriber.do`; purchase: `.../corporationsDataHome.do`.

## Terms, license, robots

- Price (from the page): entire database, one-time $1,000 on FTP; FTP subscription $100 account fee plus $500 per monthly data access; Schedule A of the agreement: "Charge = $500.00 per access" (weekly, bi-weekly or monthly) with "$100 Set-up fee plus initial access charge of $500 ... due upon execution". All fees non-refundable; payable by check or money order. Large order volumes can use a billing account with a signed service agreement and a W-9.
- Agreement terms read (full text): one State fiscal-year term, auto-renewing; payment within 30 days of invoice; GTA may change rates on 30 days' notice; suspension rights; disclaimer of warranties; Georgia law. **No clause on use, resale, redistribution or AI.** The recitals state "GTA has exclusive authority to sell or execute license agreements for an entire file of public information in any electronic medium or format". Whether that exclusivity bars republishing the whole file is a question for counsel.
- AI use: not addressed. Redistribution: not addressed in the text, but see the exclusivity recital.
- robots.txt: `georgia.gov/robots.txt` has only the Drupal default rules; `/bulk-corporations-data` is not blocked. The collector's `discover` read the page ("ok").

## What the file contains

Plain text, fields separated by "tab space", openable in Excel, no duplicate records expected. The page lists no field names; the layout comes with the data. The free alternative is the interactive eCorp entity search.

## Gates

1. Register as a subscriber at services.georgia.gov (an account; not created).
2. Sign the Bulk Corporate Data Sales Agreement (not signed).
3. Pay by check or money order (not paid).
4. Receive FTP credentials.

## Real run

None. No adapter.

## Known gaps

Layout and fields, record count, whether the Secretary of State's own terms add use limits, and the exclusivity question. The Fulton County parcel source exists (`ga-fulton-assessor`); the $600 first-month cost is modest if the legal question clears.
