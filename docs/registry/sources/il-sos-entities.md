# Illinois Secretary of State: business entities (access review)

Review date: 2026-11-02. Verdict: **free daily bulk files exist by statute, but the publisher's site denies the collector, so nothing is confirmed; `verified: false`; no adapter.**
Config: [`registry/sources/il/il-sos-entities.json`](../../../registry/sources/il/il-sos-entities.json).

## Publisher and URLs

- Illinois Secretary of State, Department of Business Services.
- Data Transparency Act page: `https://www.ilsos.gov/data/bus-serv-home.html` (title "Data Transparency Act").
- Procedures: `https://www.ilsos.gov/content/dam/data/bs/proc_corp_data.pdf` and `.../proc_llc_data.pdf` (version 001, 2022-09-29).
- Entity search (not a bulk source): `https://apps.ilsos.gov/businessentitysearch/`.

## Terms, license, robots

- **The site could not be read.** `www.ilsos.gov` answered the collector's user agent, plain `curl`, and a second HTTP client with `403 Access Denied` (an edge-network deny page) for every path tried, including `/robots.txt`. The collector's `discover` recorded `HTTP Error 403: Forbidden`. The block was not worked around (no browser spoofing, no alternate network).
- What is known comes from search-index snippets of the pages and from third parties, not from a direct read:
  - The Data Transparency page offers Corporations and LLC bulk data sets "pursuant to the Business Data Transparency Act (P.A. 102-0049)", "provided for informational purposes only", each with a download-documentation link.
  - The 2022 procedures PDFs describe seven corporation files (Master, Name, Agent, Annual Report, Assumed/Old Names, Stock, Other) and eight LLC files (Master, Name, Agent, Annual Report, Assumed, Old Names, Managers, Series), regenerated daily, related by file number.
  - OpenCorporates (blog, 2022-11-16) says it ingests the files and that the Act "overturned" the earlier restrictive terms.
  - The entity-search pages state: the database "is provided to the public for individual searches only" and may not be used "to copy or download bulk searches or information", with a reference to criminal computer-tampering statutes. That notice covers the search application, not the Act's data sets, but nothing read reconciles the two.
- Price: free by the Act's description; unconfirmed. License text, AI-use and redistribution terms: not read.

## What the file contains

Per the snippets above: file number, company names (current, assumed, prior), status, incorporation date, agent name and address, annual-report filings, and for LLCs manager and member names and addresses. Managers and members are mostly natural persons; an adapter would read only the Master and Name files (entity number, name, status, type, addresses) and never the Agent, Managers or Series files.

## Gates

1. Edge-network denial of non-browser clients, including robots.txt. A person must (a) open the Data Transparency page in a browser, (b) copy the exact file URLs, the license wording and the documentation links, (c) check whether the files are served from a host that allows the collector (or ask the Department of Business Services, 217-782-6961, to allow `FactLotRegistryBot`), and (d) read the usage notice.
2. Confirm no click-through agreement sits in front of the downloads.

### Platform terms read 2026-11-03 (gates pass, Task 5)

Illinois SOS pages tried once on 2026-11-03: <https://www.ilsos.gov/data/bus-serv-home.html> (HTTP/2 stream error, then timeout, zero bytes), <https://www.ilsos.gov/privacypolicy.html> and <https://www.ilsos.gov/departments/business-services.html> (timeouts). Not bypassed. Notes: [`../requests/platform-terms/ilsos-data.md`](../requests/platform-terms/ilsos-data.md), [`ilsos-privacy.md`](../requests/platform-terms/ilsos-privacy.md).

Another session's browser capture of the site Terms of Use (not re-verifiable from here, so not relied on) reads: "This license does not include any resale, commercial use, or derivative use of this site or its contents. The use of data mining, scraping, harvesting, robots, spiders, crawlers, and/or similar data gathering or extraction tools is strictly prohibited." and "Information presented on the Secretary of State's website is considered public information and may be distributed or copied." That capture found no bulk-data page at `/data/bs_home.html` (404), a different path from the one above.

Read: if accurate, the website terms forbid automated collection and commercial or derivative use of the website, while saying its information may be distributed; the bulk files' own Data Transparency Act notice would govern the files and is unread. A person must open <https://www.ilsos.gov/data/bus-serv-home.html> and the procedure PDFs <https://www.ilsos.gov/content/dam/data/bs/proc_corp_data.pdf> and <https://www.ilsos.gov/content/dam/data/bs/proc_llc_data.pdf>, and record the terms.

## Real run

None. No file URL was observed, so `files` is empty; none was guessed. No adapter.

## Known gaps

File URLs, sizes, exact columns, terms. Highest-value next step among the ten states: Illinois is probably free and large (about 2.8 million companies), and Cook County parcels already have an adapter (`il_cook`).
