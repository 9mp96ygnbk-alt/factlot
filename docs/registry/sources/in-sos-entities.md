# Indiana Secretary of State: business entity bulk data (access review)

Review date: 2026-11-03. Verdict: **gated: purchase and account. A bulk file exists, priced $8,000 to $9,500; `verified: false`; no adapter.**
Config: [`registry/sources/in/in-sos-entities.json`](../../../registry/sources/in/in-sos-entities.json).

## Publisher and URLs

- Indiana Secretary of State, Business Services Division (INBiz). Bulk Data Services: <https://inbiz.in.gov/Inbiz/BulkDataServices/Index> (a JavaScript page; the collector read only its title). Free interactive search (not scraped): INBiz business search.
- Fee schedule: Regulatory Analysis, LSA Document #25-155, OMB 2025-01R, <https://www.in.gov/sos/business/files/Regulatory-Analysis-Business-Entity-Bulk-Data-Fees-LSA-25-155-OMB-2025-01R.pdf> (read in full).

## Terms, license, robots

- **Price (regulatory analysis, "Enhanced Access" fees, items 26-29):** Monthly Listing of New Businesses $35.00; **bulk download with monthly updates $9,500.00**; bulk data monthly update $500.00; **one-time bulk download $8,000.00**. The one-time file "is generated on the 1st of each month which contains information on all businesses that have been registered
  with the Secretary of State as of the last day of the previous month" and "is delivered via a portable data storage device (USB Drive)". "Bulk data transactions are not required to simply access the public records. The general public can search the same data set directly for free online. Bulk data purchases are typically ordered for commercial purposes by organizations."
- Search-index text for the INBiz page: you must have an INBiz account to purchase and download the files; the monthly update contains differential data.
- robots.txt: `inbiz.in.gov/robots.txt` answers 403 `AccessDenied`; `www.in.gov/robots.txt` allows all. License text, AI use, redistribution: not read (order terms not seen).

## What the file contains

Not seen. The regulatory analysis says only "information on all businesses" (entities, trademarks are a separate bulk product).

## Gates

A person must decide whether to buy ($8,000 one-time, or $9,500 with 12 monthly updates), create an INBiz account, accept the order terms and pay; the terms must be read for use, resale and AI restrictions before the file is loaded or shared. Nothing was bought or requested. Consider asking first whether the $35 monthly listing of new businesses is enough.

## Real run

None. No adapter.

## Known gaps

Columns, whether registered agents and governing persons (natural persons) are in the file, terms. Indiana parcel data for Marion County is `in-marion-parcels` (verified), so owners there link only after this purchase.
