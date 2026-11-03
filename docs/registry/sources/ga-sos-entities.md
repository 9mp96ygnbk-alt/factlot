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

### Terms read 2026-11-03 (gates pass)

This memo is research, not legal advice; the founder holds no attorney or real estate license.

**Web page.** https://georgia.gov/bulk-corporations-data , read 2026-11-03.

> -One-time purchase: $1,000
>
> -Monthly FTP subscription
>
> -Establish account: $100
>
> -Monthly data: $500

> The corporations data is available in plain text with the fields separated by "<tab>space."

> pay a a $100 billing account fee.

The double "a" is on the page. Fees are nonrefundable. FTP requires an account, the first month's fee, and a completed agreement. Email token in the saved HTML decodes to datainnovations@gta.ga.gov. "GTA is a public corporation and instrumentality of the state created pursuant to OCGA 50-25-1 et seq." The code text was not fetched. The citation is not a quotation of the section. Phone (404) 463-2300. Visit line: 47 Trinity Ave SW, Atlanta, GA 30334.

**Agreement.** https://georgia.gov/document/document/bulk-corporations-data-sales-agreement/download , read 2026-11-03.

> WHEREAS, GTA has exclusive authority to sell or execute license agreements for an entire file of public
> information in any electronic medium or format; and

No clause in the agreement addresses the customer's use, resale, redistribution, derived works, or automated reuse. Term runs through the end of the current Georgia fiscal year (July 1 – June 30) and renews if the customer continues to order and pay. Schedule A:

> Charge = $500.00 per access
>
> $100 Set-up fee plus initial access charge of $500 is due upon execution

Notices zip 30334. Schedule A payment zip 30034. Both are printed. The form year still reads "201".

If monthly access is chosen and the initial $500 is month one, $100 + ($500 x 12) = $6,100 in the first year. That is arithmetic, not a printed annual price. The one-time file is $1,000 and is not that subscription. Weekly access at $500 per access would be a different product.

The exclusivity recital limits who may sell the entire file. It does not say the customer may republish entity name, status, and id. It also does not forbid it. Ask before paying. Draft, unsigned: `../requests/orders/ga-sos-entities-order-draft.md`.

## Real run

None. No adapter.

## Known gaps

Layout and fields, record count, whether the Secretary of State's own terms add use limits, and the exclusivity question. The Fulton County parcel source exists (`ga-fulton-assessor`); the $600 first-month cost is modest if the legal question clears.
