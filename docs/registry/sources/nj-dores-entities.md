# nj-dores-entities: New Jersey business entity records (DORES)

Review record for data policy §5. Reviewed 2026-11-03. **Not verified; no adapter; no file.** Machine-
readable copy: [`registry/sources/nj/nj-dores-entities.json`](../../../registry/sources/nj/nj-dores-entities.json)
(`verified: false`, `files: []`).

## Publisher and URLs

- Publisher: New Jersey Department of the Treasury, Division of Revenue and Enterprise Services
  (DORES), Business Records Service: <https://www.njportal.com/DOR/BusinessRecords>.
- The service searches business entities (corporations, LLCs, partnerships), trade names and
  trade/service marks, issues standing certificates and status reports, and says "Also, you will be
  able to download lists or abstracts of businesses on file with the State." The list form is
  <https://www.njportal.com/DOR/BusinessRecords/EntityDocs/BusinessList.aspx>: search by original
  filing-date range, business name, principal name, registered agent or associated name, then a
  cart. It was loaded but not submitted.
- Bulk product with a statutory fee: the fee schedule (<https://www.nj.gov/treasury/revenue/fees.shtml>)
  lists "Bulk Access Status Reports (Line item 01000000), per record" under N.J.S.A. 14A:15-3(16),
  15A:15-2, 42:2A-68 and 42:2C: "Primary Informational Content per record: Business Entity Name,
  Legal Status, Registered Agent/Office, Annual Report Filing Dates, Business Addresses, and
  Associated Names (Previous, Foreign Non-Authorized, Alternate). Selection Criteria: Filing Date,
  Entity Type [...] Output Media: Magnetic Disk; Electronic Transmission (i.e. FTP, E-Mail, or
  Paper). Capacity Limitations May Apply [...] $0.0185 per record." Copies of documents are $0.10
  a page (certified $25 or $50).
- Open data: none. `data.nj.gov` holds only certified-business lists and incentive reports
  (catalog search 2026-11-03).

## Terms, license, robots

- No licence or terms of reuse were found. The portal's disclaimer
  (<https://www.njportal.com/errorpages/disclaimer.aspx>) is the State's standard Conditions of Use
  (information "as is", no warranty, intrusion detection), the same text as on nj.gov.
- robots.txt: `www.njportal.com` has none (the request is answered by a 404 page); `www.nj.gov`
  disallows only `/Support/`, `/cgi-bin/` application paths and document folders. AI use is not
  addressed.
- Statute: the fees are set by statute (above); no statute found restricting commercial use of the
  entity list. The terms attached to a bulk order (reuse, resale, redistribution) are not public and
  need the order form.

## What the file would contain

Per the fee schedule: entity name, legal status, registered agent and office, annual report filing
dates, business addresses and associated names for entities selected by filing date and entity type.
No registry number is named in the product description (the portal's 10-digit entity id, "the New
Jersey 10-digit Id number", would be needed for `registry_number`). The registered agent is often a
natural person and would not be read.

## Gates

**Purchase and form, one action for a person:** request a quote and the order terms for a Bulk Access
Status Report for all entity types from DORES (Records Unit, PO Box 450, Trenton NJ 08646, or the
contact page of the Business Records Service), confirm in writing that the file may be
republished in an open dataset and used for AI, and confirm the entity id is included. At the
published $0.0185 per record, every 100,000 records cost $1,850; the number of New Jersey entities
on file was not available to the review. The collector must not create the portal account or place
the order.

## Real run

None.

## Known gaps

- No file layout, no registry number confirmed, no sample. New Jersey is the only registry among the
  four in this region with no open-data route.
- Without it, the registry cannot link New Jersey parcel owners (whose names the parcels dataset
  redacts anyway) to New Jersey entities. New York and Connecticut owners link through
  `ny-dos-entities` and `ct-sos-entities`.
