# Arizona Corporation Commission: business entities (access review)

Review date: 2026-11-02. Verdict: **sold public-records product ($75 extract, $1,000 full database, signed use limitation); no free bulk file; `verified: false`; no adapter.**
Config: [`registry/sources/az/az-sos-entities.json`](../../../registry/sources/az/az-sos-entities.json).

## Publisher and URLs

- Arizona Corporation Commission, Corporations Division, Records Section.
- Request page: `https://azcc.gov/public-records-request`.
- Form: "Public Records Request, Database Extraction" (m027): `https://www.azcc.gov/docs/default-source/corps-files/forms/m027-database-extraction-request4afa009930ae4583a9310593ba4c65ce.pdf`.
- Fee schedule (Corporations, rev. 2026) and the LLC schedule list the same two amounts.
- Free search (interactive only): `https://arizonabusinesscenter.azcc.gov`.

## Terms, license, robots

- Operative sentence on the form: "I, the requesting party, understand that I am being sold the use of the public records referred to herein and that I am prohibited from their use for any reason other than as stated above; that at all times these records remain the property of the Arizona Corporation Commission and are subject to return upon demand."
- The requester must check Commercial or Noncommercial purpose (A.R.S. 39-121.03), describe a commercial purpose, and the Commission "retains the ability to deny a request ... if the Commission believes the commercial purpose stated is a misuse of public records". "Commercial purpose" is defined to include "copies of records for sale or resale".
- Price: partial extract $75.00; "CD-Rom or Download of entire database" $1,000.00. Payment by check payable to the Arizona Corporation Commission; credit cards not accepted. The public-records page also says electronic delivery of general records is free and that extractions "may require additional fees"; the extraction form is the more specific source.
- AI use: not addressed, but the use-only-as-stated limitation applies. Redistribution: restricted by the form; resale is a declared commercial purpose; not compatible with open redistribution without the Commission's written agreement.
- robots.txt: `azcc.gov/robots.txt` returns 404 (no rules). The collector's `discover` read the request page ("ok").

## What the file contains

From the form: business name and address, incorporation date, approval date, statutory agent name and address, officer and director names and addresses, name change and merger information, status, domicile by county, zip code or city, and business type. Format: double-quote delimited, comma-separated ASCII, by CD-ROM or email. Not available: SIC and UCC codes, phone numbers, SSNs, EINs, emails. Entity-number field name is not stated. Officers and directors are natural persons: a delivered file would have to be read for the entity columns only.

## Gates

1. Choose the extract scope and sign the commercial-purpose statement (a legal decision).
2. Pay by check; mail to Records Section, 1300 West Washington, Room 101, Phoenix, AZ 85007 (or request by email delivery).
3. Accept that the records "remain the property of the Arizona Corporation Commission".

Nothing was purchased and no request was sent.

## Real run

None. No adapter.

## Known gaps

Entity-number column name, exact layout, update cadence (a one-time extract, not a feed). The signed use limitation likely rules out a public registry unless the Commission agrees in writing; ask before paying. The Maricopa County parcel source already exists (`az-maricopa-assessor`).
