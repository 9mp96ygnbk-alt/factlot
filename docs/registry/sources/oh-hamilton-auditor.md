# oh-hamilton-auditor: Hamilton County, Ohio (Cincinnati; FIPS 39061) Auditor real estate exports

Review date: 2026-11-03. Verdict: **gated: the host's robots.txt disallows the download directory; nothing downloaded; `verified: false`; no adapter.**
Config: [`registry/sources/oh/oh-hamilton-auditor.json`](../../../registry/sources/oh/oh-hamilton-auditor.json).

## Publisher and URLs

- Hamilton County Auditor (138 E Court St, Cincinnati; (513) 946-4000). Real Estate Valuation page: <https://hcauditor.org/revalue.asp>, which links "Real Estate Exports":
  Current Tax Year Information File ("current as of 10/31/2026", `/download/revalue/Monthly_tax_information.xlsx`), Building Information (`bldginfo.xlsx`), Historic Sales Export
  (`HistoricSalesExport.xlsx`), New Construction exports, and `TaxYear<YYYY>Pay<YYYY+1>Export.xlsx` for each year back to 2002, and a "Land Use Codes" page.
- HEAD (headers only, sent before robots.txt was read): `Monthly_tax_information.xlsx` 200, 119,984,324 bytes, Last-Modified 2026-11-02, `accept-ranges: bytes`; `bldginfo.xlsx` 12,822,509 bytes.
- Public-records download menu: <https://public.hcauditor.org/MainPRRMenuPage.aspx> (answered 131 bytes to the collector; unread). The Auditor's FAQ says it "facilitates access to our large data files".
- CAGIS (Cincinnati Area GIS) publishes the parcel layer separately; not reviewed.

## Terms, license, robots

- **robots.txt (`hcauditor.org`).** `User-agent: *` with `Disallow: /download/`, `/download_OLD/`, `/menu_downloads-assets/`, `/Old_DOWNLOAD/`, `/DataDownloadMessage.asp`, `/menu_downloads.asp`, `/menu_downloads.htm`,
  `/prr_download_instructions.asp`, `/transfer_download_instructions.asp`, `/transfer_downloads.asp`. Every export file is under `/download/revalue/`, so the collector must not fetch it.
- License, AI use, redistribution: none found on the pages read.

## What the file contains

Not confirmed (nothing downloaded). Per the page: tax-year information for all active parcels (retired parcels are absent), building information, sales and new construction as `.xlsx`.

## Gates

1. robots.txt disallows `/download/` to every agent. A person must ask the Auditor to allow `FactLotRegistryBot` on `/download/revalue/`, or confirm in writing that automated retrieval of these public-record exports is permitted, or download by hand and record the terms.
2. Read the terms on the public-records download menu; confirm whether owner names, class and land use are in the tax information file.

## Real run

None. No adapter.

## Known gaps

Columns, owner names, class and land-use codes, licence. The three Ohio counties are otherwise covered by `oh-franklin-auditor` and `oh-cuyahoga-parcels`.
