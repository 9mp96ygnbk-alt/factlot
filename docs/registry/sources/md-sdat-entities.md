# md-sdat-entities: Maryland business entities (SDAT charter file) — GATED, purchase

Review record for the source `md-sdat-entities` (data policy §5). Reviewed 2026-11-03. Machine-readable
copy: [`registry/sources/md/md-sdat-entities.json`](../../../registry/sources/md/md-sdat-entities.json)
(`verified: false`). **No adapter, no file, no sample**: the register is sold, and the brief says to
stop at a purchase.

## Publisher and URLs

- Publisher: Maryland State Department of Assessments and Taxation (SDAT), Charter Division. SDAT's
  Services page, <https://dat.maryland.gov/Pages/Services.aspx> (read 2026-11-03), under "Public Release
  Data Files": "The Department's public release files are available for sale through a contractor,
  SpecPrint, Inc."
- The corporate file, as SDAT describes it: "this file contains information regarding corporations,
  limited partnerships, limited liability companies, limited liability partnerships and trade names.
  All corporations which were active since 1982 are listed. Trade name information includes the name
  and address of the filer, initial date of the filing and the date any subsequent amendments were
  filed. Information on all other business entities includes principal office, resident agent,
  resident agent address, and the date and type of any subsequent amendments filed. Both foreign and
  domestic business entities are included." The Corporate Master File is created monthly and a weekly
  subscription is offered. The page links a "Real Property Public Data Record" layout (for the owners
  of record that `md-sdat-real-property` lacks) and a UCC file as well.
- Vendor: SpecPrint, Inc., 7 Aylesbury Road, Timonium, MD 21093, (410) 561-9600, sales@specprint.com,
  <https://www.specprint.com/> (home page lists "Real Estate Information", "SDAT Subscriber FTP" and a
  login; no prices, no layouts, no terms on the pages that answer; `/sdat`, `/real-estate-information`
  answer 404).
- Not available free: the portal `opendata.maryland.gov` has no business entity or charter dataset (the
  catalog API was searched for "business entities", "SDAT", "real property" and "charter" on
  2026-11-03; only the real property assessments, a count of businesses by county `ftgf-3uby`, and
  unrelated items appear).

## Terms, license, robots

- No licence or terms of use found for the file; SDAT's page says nothing on redistribution or
  AI use, and the order terms are behind the vendor.
- robots.txt: `dat.maryland.gov` disallows only `/_vti_bin/`, `/_layouts/`, `/_catalogs/`;
  `www.specprint.com` has none (404). Neither matters, as nothing was downloaded.
- `verified: false`: no licence, nothing confirmed.

## What the file contains

Not known beyond SDAT's description above; the layout is supplied with the order.

## Gates

**Purchase, by request.** What a person must do (one action): contact SpecPrint, Inc.
(sales@specprint.com or (410) 561-9600) and ask for (1) the current price of the SDAT Corporate
Master File and of a weekly subscription, (2) the file layout, and (3) the licence: whether the
file may be redistributed as facts in an open registry and used by AI agents. Record the answers in
this file and in the config; set `verified: true` only if redistribution is permitted. The same
conversation can cover the Real Property Public Data Record, the only route to Maryland owner names.
No account was created, nothing was ordered, and no request was sent to SpecPrint or SDAT.

## Real run

None.

## Known gaps

- Without this file, Maryland owner names cannot be matched to registered entities. The Maryland real
  property open data publishes no owner names at all (see
  [md-sdat-real-property](md-sdat-real-property.md)), so the entity file's first use would be linking
  Maryland-registered companies that own parcels in other states.
- The free interactive Business Entity Search (Maryland Business Express) was not read or scraped.
