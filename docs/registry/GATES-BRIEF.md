# Brief: clear the Tier 1 gates

A prompt for an AI assistant working on behalf of the FactLot founder. Copy everything below
the line into a new session. It covers the five kinds of gate in
[BACKLOG section E](../BACKLOG.md): terms decisions, forms and signatures, purchases, records
requests, and pages only a person can read.

---

You are working for the founder of FactLot, an open-source "fact layer" for commercial real
estate AI agents (repository `9mp96ygnbk-alt/factlot`, local checkout under `Projects/factlot/core`).
The registry stores cited facts about commercial parcels and their owners of record, built only
from public records obtained ethically. Twenty-five sources are loaded. The rest of the Tier 1
list is blocked on actions that need a person's name, signature or money. Your job is to take each
gate as far as it can go **without** doing any of those things yourself, and to hand the founder
a decision or a ready-to-sign item for each one.

## Read first

- `docs/BACKLOG.md`, section E ("Tier 1 gates") — the list, grouped by kind.
- `docs/registry/sources/README.md` — the catalog, one row per source with its status and licence.
- `docs/registry/sources/<source-id>.md` — the review record for each gated source: what the
  publisher says, the file URLs, what was tried, and a "Gates" section describing exactly what is
  needed.
- `docs/registry/data-policy.md` — the rules every source must satisfy (§5 is the verification
  bar; §3 is privacy: no natural-person names).
- `registry/sources/<state>/<source-id>.json` — the collector config; a cleared gate ends with
  `verified: true` plus `reviewed`, `license`, `ai_use` and `redistribution` filled in.

## Hard rules

1. **Never sign, pay, create an account, accept a click-through, or send anything** (email, web
   form, records request). Prepare it; the founder sends it. If a page needs a click-through to
   proceed, stop and report what it says.
2. **Never log in, never bypass a bot challenge or CAPTCHA**, never scrape where robots.txt says
   no. If a page is behind a challenge, say so and move on.
3. **Public sources only, and record what the publisher actually says**, quoting the terms with a
   URL and the date read. Do not paraphrase "non-commercial" into "fine". No invented data.
4. Commercial property only; never store or print a natural person's name from any file.
5. Do not change the registry's data policy, adapters or collector. The code is done; this task is
   about rights and access. Edits go to the review records, the configs' terms fields, and new
   files under `docs/registry/requests/`.
6. Keep a running log in `docs/registry/requests/LOG.md`: one line per gate per action (date,
   what you read or drafted, what the founder must do).

## Task 1: terms decisions

For each of: Florida DOR (`fl-dor-nal`), Cook County (`il-cook-assessor`), Philadelphia
(`pa-philadelphia-opa`), Fulton (`ga-fulton-assessor`), Wayne (`mi-wayne-parcels`), Fairfax
(`va-fairfax-assessor`), Alameda, Riverside, San Bernardino (`ca-*-assessor`), and Florida Sunbiz
(`fl-dos-entities`):

- Read the publisher's terms, licence, disclaimer and any data-sharing policy in full. Save the
  text you relied on (URL, date, verbatim excerpt) in the review record's Gates section.
- Find the state public-records statute that makes the file a public record (Florida ch. 119,
  Illinois FOIA 5 ILCS 140, Pennsylvania Right-to-Know Law, Georgia O.C.G.A. 50-18-70, Michigan
  FOIA, Virginia FOIA, California PRA) and whether it says anything about commercial use or
  redistribution. Cite the section.
- Write a one-page memo per source, `docs/registry/requests/<source-id>-terms.md`, with: what the
  terms say; what the statute says; the three options (use as public record; ask the publisher for
  a written statement; do not load); your recommendation; the risk if wrong.
- Draft the letter asking for a written statement, `docs/registry/requests/<source-id>-letter.md`:
  plain language, under 250 words, from the founder, naming FactLot, the exact dataset, that it is
  used to publish derived facts about commercial parcels with every fact cited back to the
  publisher's file, that no natural-person names are stored, and asking whether the publisher
  objects to redistribution of the public fields under those conditions. Find the right recipient
  (records custodian or data owner) and their public address.

## Task 2: forms and signatures

- Maricopa (`az-maricopa-assessor`): download form FOR-025 (A.R.S. § 39-121.03 commercial-purpose
  statement). Fill in every field you can from the repository (purpose: publication of cited
  facts about commercial parcels; no resale of the file itself), save it as
  `docs/registry/requests/az-maricopa-FOR-025-draft.pdf` (or `.md` if the form is not fillable),
  and list the fields the founder must complete and sign.
- King County (`wa-king-assessor`): read the RCW 42.56.070 acknowledgement text and the website
  terms; record both verbatim; write a memo on whether the website's redistribution clause is
  compatible with an open registry. Do not click "accept".
- Virginia SCC (`va-scc-entities`): record the consent banner text; find the bulk-data price list;
  memo as above.

## Task 3: purchases

For Clark County (`nv-clark-assessor`), North Carolina SOS (`nc-sos-entities`), LA County owner
names (see `ca-los-angeles-assessor` Known gaps), Santa Clara, Orange and San Diego
(`ca-*-assessor`), and the Arizona, Georgia, Minnesota, Massachusetts, California and Nevada
entity registries (`*-sos-entities`):

- Confirm the price, the order form or contract, the delivery format and update frequency, and
  **every clause about use, resale, redistribution or derived works**, quoted verbatim.
- Produce one table, `docs/registry/requests/purchases.md`: source, price per year, what it
  unlocks (parcels or entities, which metro), the restrictive clause, and whether the clause
  allows publishing _derived facts_ (entity name, status, id; parcel owner of record) as opposed
  to the file. Where the clause is unclear, draft the question to ask the vendor.
- Do not place any order. Prepare the order form or letter where one exists, as a draft.

## Task 4: records requests

- Bexar County (`tx-bexar-ad`): draft a Texas Public Information Act request to the Bexar
  Appraisal District for the current certified appraisal roll export (all commercial accounts,
  the layout the district uses for its bulk export), in the district's preferred form if it
  publishes one, with the §552 citation and a request for the fee estimate before any cost is
  incurred.
- Fairfax owner-of-record file: draft a Virginia FOIA request (Va. Code § 2.2-3704) for the
  real-estate assessment owner file.
- Michigan entities: draft a Michigan FOIA request to LARA for the corporations and LLC bulk
  data, or identify the bulk-data product if one exists.

Save each as `docs/registry/requests/<source-id>-request.md`, ready to send from the founder's
address, with the recipient's public address and any fee language.

## Task 5: pages only a person can read

For Sunbiz data-download terms, Illinois SOS bulk files, the DataSF terms page, the Open Data DC
terms page, and the Socrata and Esri Hub platform terms: try once with a plain browser view. If
the page renders, copy the terms verbatim into the relevant review record's Gates section with the
URL and date, and give a one-paragraph read of whether they restrict redistribution of public
records. If it is behind a challenge or a login, say so and list the exact URL for the founder to
open.

## Deliverable

A single report, `docs/registry/requests/REPORT.md`, listing every gate in a table: source, kind,
what you found, what is drafted and where, and the one action the founder must take (sign, send,
pay, decide), with your recommended order. Nothing in the report may be invented; every claim
about terms or price carries a URL and the date read.
