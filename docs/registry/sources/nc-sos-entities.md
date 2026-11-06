# nc-sos-entities: North Carolina Secretary of State business registration data

Reviewed 2026-11-02. Status: **not verified (gated: paid subscription)**. Config:
[`registry/sources/nc/nc-sos-entities.json`](../../../registry/sources/nc/nc-sos-entities.json);
adapter `python/src/factlot/registry/adapters/nc_sos_entities.py` (written to the published layout
document, not yet run on a real file).

## Publisher and URLs

- Publisher: North Carolina Secretary of State, Business Registration Division
  (<https://www.sosnc.gov/divisions/business_registration>).
- Bulk data: the **Data Subscription Service**
  (<https://www.sosnc.gov/online_services/data_subscriptions/business_registration_data_subscriptions>),
  described at <https://www.sosnc.gov/online_services/data_subscriptions/about_the_data>
  ("Business Registration Data, including name reservations"; "The data format is CSV (comma
  separated values)"; "All data is updated weekly"; "The FTP server contains a data dictionary
  detailing the table structures").
- Fees: <https://www.sosnc.gov/fees/by_title/_data_subscriptions>.
- Layout (free): <https://www.sosnc.gov/webfiles/documents/forms/Data_Subscriptions/Business_Registration_layout.pdf>
  ("North Carolina Corporations System Public Data Export Table Documentation", dated 2012-04-23,
  last change 2015-06-12), linked from
  <https://www.sosnc.gov/online_services/data_subscriptions/data_dictionaries>.
- Reports and listings page (<https://www.sosnc.gov/divisions/business_registration/reports_and_listings>):
  interactive search tools ("Search New & Dissolved", "Nonprofits by County", ...) and a link to
  Data Subscriptions; no bulk files.
- Online entity search (<https://www.sosnc.gov/online_services/search/by_title/_Business_Registration>):
  not a bulk source; its page says automated or scripted searches are not permitted, and the
  Business Registration division page says "For bulk access to public data, please use our Data
  Subscription Services."

## Terms, license, robots

- Terms: the site's Disclaimer & Privacy page (<https://www.sosnc.gov/Home/Disclaimer>) states no
  license for the data; the operative sentence on public records is that information
  "may be subject to disclosure under the Public Records Act, Chapter 132". Business registration
  filings are public records under N.C. Gen. Stat. ch. 132 and ch. 55D. Nothing on the site
  addresses AI use or redistribution of the data files.
- Subscription terms: the subscription page says "Data subscriptions are available for purchase",
  "Various terms apply to the contract based on the type of frequency", and "Account access
  information will be provided after the subscription is set up". The contract text itself is
  not published, so whether it restricts redistribution is unknown until it is read.
- robots.txt: `https://www.sosnc.gov/robots.txt` answers 404 (no rules). The collector's
  `discover` run reached four of the five landing pages on 2026-11-02; the reports-and-listings
  page closed the connection once ("Remote end closed connection without response").

## What the file contains (from the layout document; the data has not been seen)

The export ("Core") is "a complete set of all data and tables at a point in time", relational,
one delimited file per table. The layout names member files such as `CorpOfficers.txt`,
`EntityTypes.txt`, `CitizenshipTypes.txt`, so the adapter looks for `<Table>.txt` or `<Table>.csv`
and sniffs comma vs tab from the header line. Tables and the columns the adapter uses:

| Table          | Key columns used                                                                                                                                            |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Corporations` | `PItemId` ("the ONLY unique identity for a corporation"; `CorpNum` is not unique), `EntityID`, `OfficeAddressID`, `OfficeMailingID`, `Status`, `StateOfInc` |
| `Names`        | `EntityID`, `EName`, `NTypeID` (1 = "Legal NC", the one required legal name; others are Homestate / Previous Legal NC / Previous Homestate)                 |
| `Addresses`    | `AddressID`, `Addr1`..`Addr3`, `City`, `State`, `Zip`, `Country`                                                                                            |
| `CorpStatus`   | `Status` → `StatusDesc` (the descriptions are not listed in the layout; mapped by text, see below)                                                          |

Other tables in the layout (not used): `NameTypes`, `AddressTypes`, `Filings`, `PendingFilings`,
`Stock`, `NameReservations`, `Officers`, `Partners`, `Directors` (legacy), `CorpOfficers` (current
officers), `EntityTypes`, `DocTypes`, `CitizenshipTypes`, `CorpTypes`.

Mapping to `EntityRecord`: `registry_jurisdiction` `us-nc`; `registry_number` = `PItemId` (the
SOSID shown on sosnc.gov profile pages, e.g. `/online_services/search/Business_Registration_profile/<SOSID>`;
to confirm on the real file); `legal_name` = the `Names` row with `NTypeID = 1`;
`mailing_address` = the principal office (`OfficeAddressID`), else the mailing address
(`OfficeMailingID`); `state_of_formation` = `StateOfInc` when it is a two-letter code;
`status` = `CorpStatus.StatusDesc` mapped to `active`, `administratively_dissolved`,
`dissolved`, `withdrawn`, `revoked`, `merged`, `converted`, `suspended`, `expired`, otherwise the
description as a lower-case token. Natural persons appear in `Names` only as agents or officers
and have no `Corporations` row, so they are never yielded. Rows without a legal name or a
`PItemId` are yielded and counted as skipped by the registry.

## Gates (needs a person)

- **Purchase.** The only bulk route is the paid subscription: "Business Registration Division
  Master Files Subscription $2,000 per State fiscal year" and "One time set-up fee $750.00"
  (fees page, 2026-11-02; the page does not say whether the set-up fee applies to every
  subscription), delivered weekly as CSV over an FTP account provided after set-up. Subscription is by
  email to `DataSubscriptions@sosnc.gov`. Nothing was requested or bought.
- **Contract terms.** The subscription contract is not published; read it for redistribution and
  derivative-use clauses before any facts from it go into the open registry (data policy §1).
- **Alternative:** a public records request to the Secretary of State for the same export
  (N.C. Gen. Stat. §132-6.2 lets an agency charge for the actual cost of a database copy).

### Terms read 2026-11-03

This memo is research, not legal advice.

**Fees.** https://www.sosnc.gov/fees/by_title/_data_subscriptions , read 2026-11-03.

> One time set-up fee
> $750.00
>
> Business Registration Division Master Files Subscription
> $2,000 per State fiscal year

Year 1 is $750.00 + $2,000 = $2,750. Each later State fiscal year is $2,000. Do not add the UCC, notary, trademark, or charitable lines.

**Subscription page.** https://www.sosnc.gov/online_services/data_subscriptions/business_registration_data_subscriptions , read 2026-11-03.

> Various terms apply to the contract based on the type of frequency.

> With the exception of assuring that the data is available for download, no ‘technical support’ is offered with any subscription.

The contract text is not published. Subscribe token in the saved HTML decodes to DataSubscriptions@sosnc.gov.

**About the data.** https://www.sosnc.gov/online_services/data_subscriptions/about_the_data , read 2026-11-03.

> All data is updated weekly. The FTP server contains a data dictionary detailing the table structures. The data format is CSV (comma separated values).

The business-registration paragraph includes officers, partners, directors, and company officials. Those natural-person names are not to be stored.

**Statute.** G.S. 132-1(b), https://www.ncleg.gov/EnactedLegislation/Statutes/HTML/BySection/Chapter_132/GS_132-1.html , read 2026-11-03.

> The public records and public information compiled by the agencies of North Carolina government or its subdivisions are the property of the people.

G.S. 132-6.2, same site, chapter 132, GS_132-6.2.html, read 2026-11-03, limits copy fees to actual cost, with a special service charge for extensive information-technology use. Neither section says anything about commercial use or redistribution after receipt.

The published pages sell a weekly CSV and say the contract's terms vary by frequency. They do not themselves forbid publishing a cited entity name, status, and id. Until the contract is read, redistribution of the file and publication of derived facts are both unresolved. Address: Department of the Secretary of State, P.O. Box 29622, Raleigh, NC 27626-0622. Phone 919-814-5400. The Secretary's name in the page chrome is not copied.

## Real run

None. No file could be obtained without purchase, so no counts are reported. The collector's
`discover` run (`collected/nc-sos-entities/discovered.json`, 2026-11-03T01:16:26Z) found the six
layout PDFs and no data files. The adapter's tests run on a synthetic fixture only.

## Known gaps

- Delimiter, file names, date formats, and the `CorpStatus` descriptions are assumptions from the
  layout document; confirm them on the first real export and adjust `nc_sos_entities.py`.
- Whether `PItemId` equals the public SOSID is to be confirmed on the real file.
- `CorpOfficers` (current officers) and `Filings` are not loaded.
- The registry's `EntityRecord` has one address field; the mailing address is dropped when a
  principal office address exists.
