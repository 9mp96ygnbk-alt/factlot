# ok-sos-entities: Oklahoma Secretary of State business entity bulk orders

Reviewed 2026-11-03. Status: **not verified (gated: purchase; robots.txt disallows the host)**; no adapter. Config:
[`registry/sources/ok/ok-sos-entities.json`](../../../registry/sources/ok/ok-sos-entities.json).

## Publisher and URLs

- Oklahoma Secretary of State, Business Filing Department. Bulk orders page:
  `https://www.sos.ok.gov/corp/bulkorder/bulkDefault.aspx` ("BUSINESS ENTITIES BULK ORDERS"); business services
  portal `https://www.sos.ok.gov/business/default.aspx`. Orders go through the Secretary of State's shopping cart
  (login, "My Account", "Briefcase").
- Layout file and sample weekly file: linked from the order page ("To retrieve bulk order file layouts, click here";
  "To retrieve a sample data file, click here"); not fetched (see robots.txt).

## Terms, license, robots

- **robots.txt blocks automation.** `https://www.sos.ok.gov/robots.txt` and `https://sos.ok.gov/robots.txt` are
  `User-agent: *` / `Disallow: /`. The collector's `discover` run records "robots_disallowed". One disclosure: the
  order page was opened once, by hand, before robots.txt was read, to read the fee schedule; no
  other page or file on the host was fetched and nothing was downloaded.
- Fee schedule on the page: Master Download $500.00; Weekly Filing Update $150.00; Customize Bulk Order $1 per 40
  records (custom reports are returned as xhtml). "The monthly export is our complete database in a tilde(~)-delimited
  text file. The file contains 19 relational tables, compressed (zipped) for web download. When unzipped, it is
  approximately 600 megabytes. The weekly updates have the same data structure as the master download but contain
  filings only for the corresponding week."
- No licence or use restriction appears on the page; the order terms are shown in the cart. Records are public under
  the Oklahoma Open Records Act (51 O.S. 24A.1 et seq.). AI use and redistribution: unknown.

## What the file would contain

19 relational tilde-delimited tables (names and columns unknown; the layout file is behind the robots rule). Agents
and officers can be natural persons and must not be stored.

## Gates

- **Purchase and robots.txt (a person).** Place the $500 Master Download order in the Secretary of State's cart
  (account and payment), read the order terms for redistribution and AI use, download the zip by hand and place it in
  `collected/ok-sos-entities/`. The collector cannot fetch anything from this host. An adapter (`ok_sos_entities.py`)
  can be written to the layout file once it is in hand.

## Real run

Not run.

## Known gaps

Layout, licence and counts are all unknown.
