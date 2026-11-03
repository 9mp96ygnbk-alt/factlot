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

### Terms read 2026-11-03 (gates pass)

This memo is research, not legal advice; the founder holds no attorney or real estate license.

**Bulk-order page.** https://www.sos.ca.gov/administration/public-records-act-requests/business-entity-records , read 2026-11-03.

> Through bizfile Online, users have the ability to order bulk data through the BE & UCC Bulk Orders link available in the Information & Resources column. Users can uncompress and extract the data with standard software such as PKZIP, WinZip, or MacZip for use in their own systems or software for searching. Additional information is available through the "? Help" link on the side bar of the bizfile online main page at pages 132-134.

> Collect ownership information for business entities and would not have records of this information.

The second quotation is the first item under "the Secretary of State does not." Phone (916) 653-6814. The information-requests URL resolved to the same host page and does not restate a bulk price. The Secretary's name in the chrome is not copied.

**Portal manual, April 2022, Version 1.03.** https://bpd.cdn.sos.ca.gov/ucc/ucc-online-help.pdf , read 2026-11-03. Page 8: "Master Unloads for UCC or BE are $100 each, Weekly Data Unloads are free." Section 19.1:

> 3. BE Bulk Order Master Unload of Data ($100 per Unload)
> 4. BE Bulk Order – Weekly Data & Images (Free Data)

Weekly BE data is $0 per year on that sentence. A master unload is $100 per unload, not per year. The 2026 HTML page cites help pages 132–134 and does not restate the dollar amount. The user must be logged in. No account was created and no order checkbox was accepted. UCC image rules in later subsections were not applied to BE.

**bizfile hub.** https://www.sos.ca.gov/business-programs/bizfile , read 2026-11-03. New corporations, LLCs, and LPs use a 12-character id that starts with "B". "If you are a requestor of Bulk data, the new entity numbers will be reflected in the files."

**Terms, Copyright © 2026.** https://www.sos.ca.gov/business-programs/bizfile/privacy-warning-terms-and-conditions-use , read 2026-11-03.

> There is no restriction placed on the use of such filing data by the California Secretary of State, although certain information and names contained in the data may be owned by third parties and may be protected under applicable copyright, trademark, and other proprietary and intellectual property rights of those third parties.

The prohibited-uses list also says: "Post, transmit, or in any way exploit any information, software, or other material for advertising or commercial purposes;" and, separately, "create derivative works from, or sublicense any proprietary software." The derivative-works bullet is about software. The filing-data sentence is the one that speaks to the records.

Filing data (entity name, number, status) is the product the terms describe as unrestricted by the Secretary of State, with a third-party trademark caveat. The website commercial-purposes bullet is still on the page, so the draft letter asks the office to confirm the cited-fact use. Do not store natural-person names. Draft: `../requests/orders/ca-sos-entities-order-draft.md`.

## Real run

None. No file obtained. No adapter.

## Known gaps

Price, file layout, update frequency, order terms, AI-use and redistribution terms are all unknown until a person reads the order page. If the terms allow it, the Master Unload would be the largest entity file in the registry (California is a high-volume state for commercial owners).
