# California Secretary of State: business entities (access review)

Review date: 2026-11-02. Verdict: **no free bulk file; paid bulk order behind a bizfile Online account; `verified: false`; no adapter.**
Config: [`registry/sources/ca/ca-sos-entities.json`](../../../registry/sources/ca/ca-sos-entities.json).

## Publisher and URLs

- California Secretary of State, Business Programs Division (bizfile Online, `bizfileonline.sos.ca.gov`).
- Public pages: `https://www.sos.ca.gov/business-programs/business-entities/business-entities-records-request` and `.../information-requests`.
- California does not publish the register on the state open-data portal (no entity dataset was found).

## Terms, license, robots

- The pages read carry no terms for the data; the only legal line is "Copyright (c) 2026 California Secretary of State".
- Bulk orders: the records-request page says only that users "have the ability to order bulk data through the BE & UCC Bulk Orders link" in bizfile Online and that the download is a compressed archive. It gives no price, no agreement and no use terms. A CalChamber summary says the bulk-order function needs a bizfile user account.
- Price: not on any official page read. A vendor (Kyckr, not the publisher) reports $100 for the text "Master Unload", $800 for images, $900 for both; unconfirmed.
- AI use and redistribution: not addressed on the public pages; the order terms are behind the account and unread.
- robots.txt: `www.sos.ca.gov/robots.txt` returns 200 with an empty body (no rules). The collector's `discover` read the records-request page ("ok", 0 file links).

## What the file contains

Unknown (the order page is behind the account). The free search shows: entity name and number, formation or registration date, status and standing (FTB, SOS agent, VCFCF), officer/director/member/manager names and addresses, agent for service of process, entity addresses, jurisdiction, and Statement of Information due dates. The publisher states ownership, telephone numbers, email addresses and affiliate data are not made of record. About 17 million records.

## Gates

1. Create a bizfile Online user account (not done; accounts are the founder's to create).
2. Read the bulk-order price and any order agreement or use terms.
3. Pay (not done).

Do not scrape bizfile Online search: it is an interactive application, and no bulk-use permission was found.

## Real run

None. No file obtained. No adapter.

## Known gaps

Price, file layout, update frequency, order terms, AI-use and redistribution terms are all unknown until a person reads the order page. If the terms allow it, the Master Unload would be the largest entity file in the registry (California is a high-volume state for commercial owners).
