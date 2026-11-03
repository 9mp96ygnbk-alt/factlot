# tn-sos-entities: Tennessee Secretary of State business entity database download

Reviewed 2026-11-03. Status: **not verified (gated: purchase; host blocks automated clients)**; no adapter. Config:
[`registry/sources/tn/tn-sos-entities.json`](../../../registry/sources/tn/tn-sos-entities.json).

## Publisher and URLs

- Tennessee Secretary of State, Division of Business Services. Business Services Online: `https://tnbear.tn.gov/`;
  database download wizard `https://tnbear.tn.gov/Ecommerce/DBDownloadWizard.aspx`; the Secretary of State's
  service list `https://sos.tn.gov/businesses/services` ("Download Business Entity Database", "Purchase Database
  Downloads").
- Neither host is readable by the collector: `tnbear.tn.gov` resets the TCP connection (`Connection reset by peer`,
  including for `/robots.txt`), and `sos.tn.gov` answers 403 to `/robots.txt` and pages.
- Tennessee publishes no free statewide entity dataset on `data.tn.gov` that could be found (that host timed out).

## Terms, license, robots

Not read. What a search listing of the official wizard page says (second-hand; confirm on the page): the cost to
download the file is $50.00 plus any applicable service fee; the file is generated each Sunday night; it covers all
registered entities and includes basic entity information with mailing address, assumed names, registered agent
information and annual report history; it is a .zip of four tab-separated text files. No licence or use restriction
was found. Business filings are public records under the Tennessee Public Records Act (T.C.A. 10-7-503). AI use and
redistribution: unknown until the checkout terms are read.

## What the file would contain

Four tab-separated tables (names and columns unknown). The registry needs entity name, control number, status,
formation state, principal/mailing address. Registered agents and officers can be natural persons and must not be stored.

## Gates

- **Purchase (a person).** Buy the database download in Business Services Online (an account, a card, and the
  checkout terms), read the terms for redistribution and AI use, and place the zip in `collected/tn-sos-entities/`.
  An adapter (`tn_sos_entities.py`) can then be written to the real layout.

## Real run

Not run.

## Known gaps

Layout, licence and counts are all unknown.
