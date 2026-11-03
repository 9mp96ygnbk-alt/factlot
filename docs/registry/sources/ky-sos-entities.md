# ky-sos-entities: Kentucky Secretary of State Bulk Data Service (business entities)

Reviewed 2026-11-03. Status: **not verified (gated: subscriber agreement and a monthly fee)**; no adapter. Config:
[`registry/sources/ky/ky-sos-entities.json`](../../../registry/sources/ky/ky-sos-entities.json).

## Publisher and URLs

- Kentucky Secretary of State; service run with Kentucky.gov. Pages:
  `https://www.sos.ky.gov/bus/Pages/Bulk-Data-Service.aspx`, `https://www.sos.ky.gov/bus/Pages/File-Descriptions.aspx`.
  Sign-up `https://secure.kentucky.gov/register`; Subscriber Agreement via `http://kentucky.gov/register/`;
  downloads `https://secure.kentucky.gov/sos/bulkdata/web/Default.aspx` (login).
- Layout spreadsheet, free: `https://www.sos.ky.gov/bus/Documents/Business%20Entity%20Data%20File%20Formats.xls`
  (93,184 bytes; nine tabs: All Companies, All Initial Officers, All Officers, New Companies Weekly, New Company
  Officers Weekly, New Companies, New Company Officers, Company Changes, Company Officer Changes).
- Free per-entity lookup (not bulk): Business Entity Search (FastTrack).

## Terms, license, robots

- Pricing on the Bulk Data Service page: "Subscribers using this service for commercial purposes will be charged a
  monthly subscription fee based on the type(s) of records specified in their subscriber agreements ... Business
  Records - $2,000 per month; UCC Filings - $1,500 per month; UCC Filing Images - $300 per month. Non-commercial
  users (e.g., persons using the information for research) are not required to pay a monthly subscription fee, but
  the appropriate fee will change if the purpose of use changes to commercial." Contact (502) 875-3733.
- The Subscriber Agreement was not read (it needs the registration). Records are public under the Kentucky Open
  Records Act (KRS 61.870 et seq.). AI use and redistribution: unknown.
- robots.txt: `www.sos.ky.gov` answers 404 (no rules); the collector read both pages.

## What the file contains

Tab-delimited text. "All Companies" (monthly, "a listing of all businesses on file"): key `ID` plus `comptype` and
`compseq` (an LLC, type 06, and its assumed names, type 12, share an `ID`; renamed versions share `ID` and
`comptype`); field names visible in the layout sheet (read with `strings`; which tab each belongs to was not parsed) include `Name`, `Standing`, `Status`, `Country`, `State`, registered
agent name and address (`raname`, `raaddr1`-`4`, `racity`, `restate`, `razip`), principal office address
(`poaddr1`-`4`, `pocity`, `postate`, `pozip`), dates (`filedate`, `orgdate`, `authdate`, `recorddate`, `expdte`,
`rendte`), `mangnum`, `applname`, `appltitl`, parent fields (`parpre`, `parcom`), `profit`. Officer files list
natural persons (President, Director, Member, Manager ...) and must not be stored; the registered agent can also be a person.

## Gates

- **Subscription and fee (a person).** Register on Kentucky.gov, sign the Subscriber Agreement, choose the tier
  (commercial: $2,000 per month for Business Records), read the agreement for redistribution and AI use, and
  download the monthly All Companies file into `collected/ky-sos-entities/`.

## Real run

Not run.

## Known gaps

Counts, exact column order and file encoding are unknown until a real file is seen.
