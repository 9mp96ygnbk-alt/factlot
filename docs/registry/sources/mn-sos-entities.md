# Minnesota Secretary of State: business entities (access review)

Review date: 2026-11-02. Verdict: **bulk data is available only by signed order: $710 commercial (with a license that bars bulk resale) or free for non-commercial users who promise not to publish it; plus a $30 name-and-address file; every route needs an account; `verified: false`; no adapter.**
Config: [`registry/sources/mn/mn-sos-entities.json`](../../../registry/sources/mn/mn-sos-entities.json).

## Publisher and URLs

- Minnesota Secretary of State, Business Services (MBLS system).
- Data page: `https://www.sos.mn.gov/business-liens/business-liens-data/business-data-available/`.
- Commercial order form: `https://www.sos.mn.gov/media/5124/bulkrequestcorp_commercialusers.pdf` (revised 2024-05-22). Non-commercial form: `.../media/5123/bulkrequestcorp_non-paying.pdf`. License: `.../media/5125/business-bulk-la.pdf`. Implementation guide: `.../media/d3skshdo/business-bulk-order-implementation-guide-and-record-layout.pdf` (not downloaded).
- Account portal: `mblsportal.sos.mn.gov`.

## Terms, license, robots

- Commercial: "Bulk Business Data Order Fee: $710"; "A signed license agreement will be needed prior to processing your order"; the delivery email must be a registered online account. Operative license sentence: "Licensee shall be allowed to use the Records only in the normal course of its business, except that Licensee may not resell in bulk or repackage in bulk any substantial part of the Records. Licensee shall not sub-license the Records without the express written consent of OSS."
- Non-commercial (news media, journalists, researchers, non-commercial use): no charge, by emailed or mailed form; the requester certifies non-commercial use and "I agree that I will not sell or publish the entirety of, or any substantial portion of, the database."
- Active Business Data (name and primary address of each active business; assumed names, corporations, LLCs, LPs, LLPs, cooperatives, nonprofits, domestic and foreign): $30 one-time or $30 weekly, CSV in a zip, registered account required.
- AI use: not addressed. Redistribution: restricted as above; an open republished registry would not comply.
- robots.txt: `www.sos.mn.gov/robots.txt` returns 404. **The site then showed the collector a Radware CAPTCHA ("your activity and behavior on this site made us think that you are a bot")** on two page fetches shortly after the PDFs were read. Requests to the host were stopped; `discover` and `snapshot` were not run against it, and the CAPTCHA was not attempted. Two linked data pages (Business Snapshot Data, Snapshot Reports) were therefore not read and are not assessed.

## What the file contains

Bulk Business Data: a monthly CSV in a zip, with three main record types (master data, filing data, filing party and address data), same layout every month; the telephone number and type of business are not available. Filing-party records include natural persons; an adapter would read the master data only. Active Business Data: name and primary address.

## Gates

1. Register an online account at mblsportal.sos.mn.gov (not created).
2. Decide commercial versus non-commercial status (a legal call: a public commercial registry is not obviously non-commercial) and sign the matching form and, if commercial, the license.
3. Pay $710 or $30 (not paid).
4. Clear the CAPTCHA block with the Office if page access is needed.

### Terms read 2026-11-03

This memo is research, not legal advice.

**Blocked HTML.** https://www.sos.mn.gov/business-liens/business-liens-data/business-data-available/ returned a Radware captcha (HTTP 200 on the challenge URL). Any price that lived only on that page is NOT CONFIRMED; the page needs a person in a browser.

**Commercial order, revised 5/22/2024.** https://www.sos.mn.gov/media/5124/bulkrequestcorp_commercialusers.pdf , read 2026-11-03.

> Bulk Business Data Order Fee: $710

> Data is purchased in bulk as a one-time set of records.

CSV in a zip. File created at the beginning of each month. Delivery email must be a registered account at mblsportal.sos.mn.gov. No account was created. $710 is not a yearly subscription. Mail: Minnesota Secretary of State - Business Services, First National Bank Building, 332 Minnesota Street, Suite N201, St Paul, MN 55101.

**Noncommercial form, revised 5/23/2024.** Do not use it for FactLot.

> I agree that I will not sell or publish the entirety of, or any substantial portion of, the database.

**License, BusinessBulkLARev5/5/2026.** https://www.sos.mn.gov/media/5125/business-bulk-la.pdf , read 2026-11-03. The letterhead names the Secretary. That name is not copied.

> OSS GRANTS TO THE Licensee a non-exclusive, non-transferable license to publish and make
> available in the normal course of its business to its customers, subject to paragraph C1

> Nothing in this agreement prohibits
> Licensee from charging its customers a fee for access to the Records.

> This agreement does not provide for any updates of the Records.

> Notwithstanding the Minnesota Government Data Practices Act, Minnesota Statutes chapter 13,
> Licensee shall be allowed to use the Records only in the normal course of its business, except that
> Licensee may not resell in bulk or repackage in bulk any substantial part of the Records. Licensee
> shall not sub-license the Records without the express written consent of OSS.

> Records cannot be presented by a User as the "Official" Records of OSS.

Records remain the sole property of OSS. A header email in the text extract, "secretary.state.@state.mn.us", is not relied on. Use business.services@state.mn.us.

**Statute.** Minn. Stat. § 13.03, subd. 3, https://www.revisor.mn.gov/statutes/cite/13.03 , read 2026-11-03. Subd. 3(a) permits inspection and copying of public government data. Subd. 3(d) allows a fee for a commercially valuable database built with significant public funds. Subd. 3(e) requires an electronic copy in the format maintained. The section does not forbid republication after receipt. The license applies "Notwithstanding" chapter 13 and then bars bulk resale or bulk repackaging of a substantial part, and bars sublicensing. Publishing one cited entity name, status, and file number is what paragraph A.1 seems to allow, and it is also the point paragraph C.1 does not expressly decide. An open dump of the file is not loaded.

## Real run

None. No adapter.

## Known gaps

Layout (implementation guide not read), whether the $30 Active Business Data file carries file numbers, and what is on the Snapshot pages. The Hennepin County source exists (`mn-hennepin-assessor`).
