# Ohio Secretary of State: business filings (access review)

Review date: 2026-11-03. Verdict: **gated: host blocks automated clients; a free monthly report of new and changed filings exists but is not the whole register; `verified: false`; no adapter.**
Config: [`registry/sources/oh/oh-sos-entities.json`](../../../registry/sources/oh/oh-sos-entities.json).

## Publisher and URLs

- Ohio Secretary of State, Business Services Division. Business Reports: <https://www.ohiosos.gov/businesses/business-reports/> (and `/download-business-report/`). Entity search (interactive, not scraped): <https://businesssearch.ohiosos.gov/>.

## Terms, license, robots

- **Blocked.** `www.ohiosos.gov` answered the collector for every path tried, including `/robots.txt`, with HTTP 403 and a JavaScript "security check" page (a 1.28 MB challenge). The block was not worked around. The findings below come from search-index text and are unverified by a direct read.
- Reported: the Secretary offers free monthly Business Reports, generated on the second Saturday of each month and refreshed in a downloadable table: new business filings (charter number, corporation name, statutory agent, filer name, document number, filed date, date of incorporation, type), subsequent filings,
  trademarks and service marks, and lists of debarred or dissolved entities. Phone numbers and email addresses are not in them; no list of trade names is offered. These are new and changed filings only, not a snapshot of the whole register. No whole-register bulk product or price was found; R.C. 111.23 lets the Secretary charge for bulk filing services but states no amounts.
- License, AI use, redistribution: not read.

## What the file contains

No file read.

## Gates

A person should (1) open the Business Reports page in a browser and record the file URLs, columns and terms, (2) ask the Business Services Division (877-767-6446) whether a full-register extract exists and its price, or whether the security check can allow `FactLotRegistryBot`, or file an Ohio public records request (R.C. 149.43; see [public-information-requests.md](../public-information-requests.md)).

## Real run

None. No adapter.

## Known gaps

File format and URLs, whether the new-business reports accumulate into a usable register, terms. Ohio owners (Franklin, Cuyahoga, Hamilton) therefore cannot be linked to entities yet.
