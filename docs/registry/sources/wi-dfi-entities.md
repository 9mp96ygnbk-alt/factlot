# Wisconsin Department of Financial Institutions: corporate database (access review)

Review date: 2026-11-03. Verdict: **gated: purchase by mail. The complete corporate database costs $40.00 per file; `verified: false`; no adapter.**
Config: [`registry/sources/wi/wi-dfi-entities.json`](../../../registry/sources/wi/wi-dfi-entities.json).

## Publisher and URLs

- Wisconsin Department of Financial Institutions (DFI), Division of Corporate and Consumer Services, Corporations Bureau (608-261-7577, `DFICorporations@dfi.wisconsin.gov`).
- Page: <https://dfi.wi.gov/Pages/BusinessServices/BusinessEntities/CorpDataServices.aspx> (read in full). Order form: Form 51 "Commercial Bulk Data Request" (revised August 2024), <https://dfi.wi.gov/Documents/BusinessServices/BusinessEntities/Forms/CORP51.pdf> (read in full).

## Terms, license, robots

- DFI "offer[s] elements of our database information for purchase on an incidental or recurring basis. The two datasets we offer are the complete corporate database delivered via ShareFile as a .txt file and a monthly record of entities formed or registered in the previous month delivered via .txt file and .xlsx spreadsheet by e-mail for $5/month."
- **Prices (Form 51):** Option I, full corporate database via ShareFile, one time, weekly (sent each Tuesday) or monthly (second Tuesday): **$40.00 per file**. Option II, new formations (second Monday, by e-mail): **$5.00 per file**. Mail the form with a check or money order payable to WDFI to Corporations Bureau, PO Box 7846, Madison, WI 53707. DFI sets up a ShareFile subscriber account from the e-mail on the form.
- Neither the page nor the form states use, resale, redistribution or AI terms. No robots.txt (404).

## What the file contains

Per the page: legal entity name, registered agent and registered office address, entity type, date of formation or registration, current status, and a numeric indicator for the most recent annual report. "We do not have entity 'owners' or LLC members on record"; officers and directors are not in the database file.

## Gates

A person must complete Form 51 (company name, e-mail for ShareFile, contact details), mail it with $40.00 (one file) and accept any ShareFile or order terms. Nothing was ordered or paid. This is the cheapest of the four entity registers and the one to buy first.

## Real run

None. No adapter (file layout unseen).

## Known gaps

Exact columns and delimiter (the page says `.txt`), registered-agent handling (natural persons must not be read), terms. Wisconsin parcels (`wi-statewide-parcels`) are gated on terms since 2026-11-06 and are not published; owner linking would also need that gate cleared.
