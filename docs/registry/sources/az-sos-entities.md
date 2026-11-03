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

### Terms read 2026-11-03 (gates pass)

This memo is research, not legal advice; the founder holds no attorney or real estate license.

**Form m027.** https://www.azcc.gov/docs/default-source/corps-files/forms/m027-database-extraction-request4afa009930ae4583a9310593ba4c65ce.pdf?sfvrsn=73637fee_6 , read 2026-11-03.

> CD-Rom or Download of entire database $1,000.00

> CD-Rom or Electronic Mail File for information extract $75.00

The entire database is $1,000.00 once. It is not a stated annual subscription. Format: "double-quote delimited, comma-separated ASCII data." Delivery: CD-ROM or email. "no other options."

> I am being sold the use of the public records referred to herein and that I am prohibited from their use for any reason other than as stated above; that at all times these records remain the property of the Arizona Corporation Commission and are subject to return upon demand.

The form says the Commission may deny a commercial request it believes is a misuse, citing A.R.S. § 39-121.03(B). Commercial purpose on the form includes sale or resale and "any purpose in which the purchaser can reasonably anticipate the receipt of monetary gain." Available fields include officer and director names and addresses. Do not store those natural-person names. Mail: Arizona Corporation Commission, Records Section, 1300 West Washington, Room 101, Phoenix, AZ 85007.

The general public-records page (https://azcc.gov/public-records-request , effective January 1, 2026, read 2026-11-03) is a labor-and-copy schedule, including commercial labor at $30/hour. It is not the database-extract price. Contact on that page: OGC@azcc.gov. Mail: c/o Legal Division, 1200 West Washington Street, Phoenix, Arizona 85007.

**Statute.** A.R.S. § 39-121.03, https://www.azleg.gov/ars/39/00121-03.htm , read 2026-11-03.

> D. For the purposes of this section, "commercial purpose" means the use of a public record for the purpose of sale or resale or for the purpose of producing a document containing all or part of the copy, printout or photograph for sale or the obtaining of names and addresses from public records for the purpose of solicitation or the sale of names and addresses to another for the purpose of solicitation or for any purpose in which the purchaser can reasonably anticipate the receipt of monetary gain from the direct or indirect use of the public record. Commercial purpose does not mean the use of a public record as evidence or as research for evidence in an action in any judicial or quasi-judicial body.

Subsection C makes a different commercial purpose than the one stated a treble-damages misuse. Subsection A is where the statute places the three charge factors. The public-records page cites subsection B for those factors. Both texts are saved.

The form sells a use, keeps ownership with the Commission, and requires the purpose to match the use. Publishing the file is not what the draft purpose asks for. Publishing cited entity name, status, and id is still a commercial purpose under subsection D, so it has to be written on the form and accepted. It is not cleared by silence. Draft, unsigned: `../requests/orders/az-sos-entities-order-draft.md`.

## Real run

None. No adapter.

## Known gaps

Entity-number column name, exact layout, update cadence (a one-time extract, not a feed). The signed use limitation likely rules out a public registry unless the Commission agrees in writing; ask before paying. The Maricopa County parcel source already exists (`az-maricopa-assessor`).
