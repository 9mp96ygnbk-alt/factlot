# Document verification

Document tools turn values an agent reads from a document into cited FactLot facts. **Your agent
extracts; FactLot verifies.** Your model reads the pages and proposes each value with the
verbatim quote and page it came from. FactLot checks every proposal with deterministic code and
returns facts it can cite, items a person should look at, and rejections, each with a reason the
agent can act on. FactLot runs no model, so a verification costs no model spend and gives the
same answer every time.

| Tool                        | Input                                                                                      | Output                                                                                                    |
| --------------------------- | ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| `doc_verify_facts`          | one document's pages, candidates `{predicate, value, quote, page}`, and `as_of` (required) | `verified` facts, `needs_review`, `rejected`, each with a reason                                          |
| `doc_abstract_lease`        | a lease and its amendments, each with candidates or verified facts, and `as_of` (required) | the current-state abstract: each term's value, controlling citation, history and pending amendments       |
| `doc_compare`               | values another document asserts (estoppel, rent roll), and lease facts                     | per value: `match`, `mismatch`, `not_in_lease` or `ambiguous_in_lease`, with the citation                 |
| `doc_verify_claim`          | one claim (`{predicate, value}`, `{text}` or a bare sentence string), its quote and page   | `supported`, `contradicted` or `unverifiable`, with the evidence                                          |
| `doc_spread_statement`      | a T-12 or operating statement's pages, and lines `{label, amount, quote, page}`            | the statement on a standard chart of accounts (NOI, EBITDA, ...), each line cited, footing and exceptions |
| `doc_check_use_conflict`    | verified exclusive-use and prohibited-use facts, and a proposed use                        | each potential conflict with the controlling quote, labelled for human review                             |
| `doc_predicates`            | optionally one `predicate` or a `prefix`                                                   | each lease predicate's value shape (JSON Schema), an example, and which parts are checked and how         |
| `fact_package_create`       | facts                                                                                      | a canonical, hash-chained package and the message its holder signs                                        |
| `fact_package_verify`       | a package, optionally the signer's public key and the source pages                         | whether hashes, signature, facts and quotes check out, with details and the checks it did not run         |
| `doc_read_pdf` (local)      | a PDF file on this machine                                                                 | the `document` input above: page text, sha256, OCR pages                                                  |
| `fact_package_sign` (local) | a package; the key comes from `FACTLOT_SIGNING_KEY_FILE`                                   | the package with its Ed25519 signature                                                                    |

The first nine are in the MCP server, the REST API (`/v1/doc/verify_facts`,
`/v1/doc/abstract_lease`, `/v1/doc/compare`, `/v1/doc/verify_claim`, `/v1/doc/spread_statement`,
`/v1/doc/check_use_conflict`, `/v1/doc/predicates`, `/v1/facts/package`,
`/v1/facts/package/verify`), every provider
format, and the Python SDK (`factlot.run_tool`). The two marked local are registered only by the
stdio MCP server (`factlot-mcp`), because they read files on the user's machine; the hosted API
never reads files. In TypeScript, `fact_package_verify` checks signatures with WebCrypto, which is
asynchronous: call it through `runToolAsync` (the MCP server and REST API do). The checks are the ones FactLot Ingest has always run
([ingest.md](ingest.md)); the TypeScript code (`packages/tools/src/quotes.ts`,
`documents.ts`) is a port of the Python verifier (`python/src/factlot/ingest/verify.py`,
`python/src/factlot/docverify.py`), and `spec/vectors/documents.json` pins both. A runnable
example with a synthetic lease, amendment and estoppel is in
[`examples/document_verification.py`](../examples/document_verification.py).

## What a candidate goes through

`doc_verify_facts` checks each candidate in this order and stops at the first failure.

1. **Value shape.** For an Ingest predicate the value must have the shape in the
   [Ingest predicate table](ingest.md#predicates), which `doc_predicates` also returns as JSON
   Schema: dates `YYYY-MM-DD`, `lease.pro_rata_share` in (0, 1], rent steps with `from` before
   `to`, a CAM cap with an explicit method, a guarantor that is a name and not an address, and the
   documented field types of `lease.free_rent`, `lease.renewal_option` and
   `lease.termination_option` (`applies_to` is `base_rent` or `gross_rent`, months are numbers, a
   rent or fee is a non-empty string). Any other dotted lower_snake predicate (`lease.notice_days`,
   `om.occupancy`) is allowed with the generic rules: the value must not be null or blank.
   Failure: `rejected`, check `value`.
2. **Quote on the page.** The quote must be at least 12 characters and appear on the cited page.
   Both sides are normalized first: Unicode NFKC, typographic quotes and dashes to ASCII, every
   run of whitespace (including line breaks) to one space, and lower case. Nothing else is
   forgiven. A quote found on exactly one other page is accepted with the page corrected (a note
   says so); a quote found only on several other pages, or nowhere, is `rejected`, check `quote`.
3. **Value in the quote.** A quote that exists is not proof of the value, so every checkable part
   of the value must be written in the quote in some common form:
   - numbers: `1250000` matches `$1,250,000.00`, `1,250,000` and `1250000`; `24.5` matches
     `24.50/SF`; whole numbers up to ninety-nine also match their words (`twelve (12)`)
   - ratios: `0.0425` also matches `4.25%` or `4.25 percent`, but not a bare `4.25`; `0.03`
     matches `three percent`
   - dates: `2031-06-30` matches `June 30, 2031`, `Jun. 30, 2031`, `6/30/2031`, `30.6.2031`,
     `30 June 2031` and `the thirtieth day of June, 2031`; not `June 30, '31` or "the
     Expiration Date"
   - party names (`lease.landlord`, `lease.tenant`, the guarantor) must appear verbatim, ignoring
     case, whitespace and typographic quotes
   - text the lease states as written (each prohibited use, an exclusive's protected use and each
     carve-out, a ROFR or ROFO description) must be written in the quote as whole words, ignoring
     case, whitespace, punctuation and a word hyphenated at a line break: `"dry cleaner"` matches
     `a dry-cleaner`, `"vape shop"` does not match a list that does not name it, and `"bar"` does
     not match `barber shop`
   - every step of a rent schedule is checked
   - for a generic predicate, every number, ratio (a number in (0, 1]) and date anywhere in the
     value is checked

   Failure: `needs_review`, check `consistency`, with a reason such as
   `value "2033-06-30" not found in quote`. The quote is real, so a person can decide whether the
   model misread it.

4. **Confidence.** A candidate that passes everything but carries a `confidence` below 0.8 goes to
   `needs_review`, check `confidence`.
5. **Every part confirmed.** `verified` means every part of the value was found in the quote. A
   part no rule can check, or one the quote does not confirm, holds the candidate for a person:
   - a true/false value (`lease.go_dark` `operating_covenant`, a relocation right's
     `landlord_pays_costs`): a quote cannot prove `true` by containing words, and "Tenant is not
     required to continuously operate" contains "continuously operate";
   - an enum, unless the quote words it the way FactLot recognises (`free_rent.applies_to`
     `base_rent` needs "base rent", "basic rent", "fixed rent" or "minimum rent"; a percentage
     rent `natural` breakpoint needs "natural breakpoint"; consent standards as in the table
     below); a CAM cap method, a kick-out party or a ROFR's `applies_to` is never confirmed;
   - a summary an agent may paraphrase (a co-tenancy trigger or remedy, a renewal rent, a radius
     duration, a kick-out test period, a generic predicate's text), unless it is written in the
     quote as words.

   Failure: `needs_review`, check `coverage`, with `checked`, `not_checked` and a reason naming
   each part, such as `value.operating_covenant (boolean) is not checked against the quote; confirm
it`. A person who has read the clause decides; FactLot does not issue an `extracted` fact for a
   value it could not confirm. When that person confirms it, send the candidate again with their
   `confirmation` ([below](#human-confirmation)).

A rent schedule written by lease year adds one step between 3 and 4: the commencement date its
step dates are derived from must verify against its own quote
([below](#rent-schedules-by-lease-year)); if it does not, the schedule is `needs_review` with check
`derivation`.

A verified fact has `provenance.method: "extracted"` and one source: `document_id`, `page`,
`section` (if given), the `quote` as sent, and `span`, the code-point offsets of the matching
text in the document (all pages joined by form feeds), so `text[start:end]` is the passage as it
appears on the page. `span` is left out in the rare case where it cannot be computed exactly
(for example a Greek final sigma that lowercases differently letter by letter). Each verified
item also lists which parts of the value were `checked` and as what (`number`, `ratio`, `date`,
`string` for a name, `words` for written text, `phrase` for a worded enum); its `not_checked` is
always empty, because a value with an unchecked part is held for review instead.

### Human confirmation

Some parts of a value can never be confirmed by a quote: a true/false value (`lease.go_dark`
`operating_covenant`), an enum no wording settles (a CAM cap `method`, a kick-out `party`, a ROFR's
`applies_to`), or a summary the quote does not write out. Once a person has read the clause, send
the candidate again with their confirmation:

```json
{
  "predicate": "lease.go_dark",
  "value": { "operating_covenant": true },
  "quote": "Tenant shall continuously operate in the Premises.",
  "page": 2,
  "confirmation": {
    "by": "J. Smith, lease administrator",
    "at": "2026-11-05",
    "note": "read Section 7.1"
  }
}
```

- The candidate goes through every check above. If the only gaps left are parts no rule can
  check, it is verified with `provenance.method: "human_verified"`, `verified_by` (as given) and
  `verified_at` (a date is recorded as that day at 00:00 UTC; a timestamp with offset is kept). The
  verified item lists the parts the quote confirmed under `checked`, the parts only the person
  confirmed under `confirmed_by_person`, and echoes the `confirmation` (the fact schema has no
  field for the note). The result's `warnings` and `summary.confirmed_by_person` say how many
  values rest on a person.
- A confirmation never overrides a failed check: a quote that is not on the page is still
  `rejected`; a number, date, name or as-written text the quote does not state is still
  `needs_review` (check `consistency`); a confidence below 0.8 still holds it; and a commencement
  date that does not verify still holds a lease-year schedule. A confirmation on a value the quote
  fully confirms is not used: the fact stays `extracted`, with a note.
- **`by` must name a person or a role** ("J. Smith", "Lease administration, Acme REIT"). FactLot
  records it as given and does not authenticate it: it is the caller's statement that a person
  read the clause. An agent must never set `confirmation` for its own extraction. Values that read
  as an automated actor ("agent", "assistant", "model", "system", "FactLot", "me", "unknown", ...)
  are an `InputError`; that guard catches slips, not dishonesty.
- `doc_abstract_lease` accepts `human_verified` facts like any other (each needs a `verified_by`
  that names a person, or it is rejected). With pages they are checked again and stay
  `human_verified`; the field's `source` adds `method`, `verified_by` and `confirmed_by_person`.
- `doc_compare` adds `lease_method: "human_verified"`, `lease_verified_by` and
  `lease_confirmed_by_person` to a result whose lease fact a person confirmed, so a `match` on
  those parts is read as a match against a person's reading, not against the quote.
- `fact_package_create` lists such facts under `confirmed_by_person`, beside the package (the
  digest does not change), and `fact_package_verify` reports them under
  `values_confirmed_by_person`, apart from `values_not_checked`, with a line in `checks_not_run`.

### Rent schedules by lease year

A rent table written by lease year ("Lease Years 1–5: $34.50 ...; Lease Years 6–10: $38.00 ...")
does not write the step dates, so a schedule with dates would fail the quote check. Send the steps
by lease year and the commencement date with its own quote, which may be on another page of the
same document:

```json
{
  "predicate": "lease.base_rent_schedule",
  "value": [
    { "lease_years": [1, 5], "annual_rent_psf": 34.5 },
    { "lease_years": [6, 10], "annual_rent_psf": 38.0 }
  ],
  "quote": "Lease Years 1–5: $34.50 per rentable square foot per annum;\nLease Years 6–10: $38.00",
  "page": 2,
  "commencement": {
    "value": "2026-07-01",
    "quote": "The Commencement Date is July 1, 2026",
    "page": 1
  }
}
```

FactLot checks every rent and every lease-year number against the table's quote, and the
commencement date against its quote as a `lease.commencement_date` candidate would be checked.
It then derives the dates (formula `doc.lease_year_dates@1`):

- Lease Year 1 begins on the commencement date. Lease Year N begins on the (N−1)th anniversary of
  the commencement date (the same month and day N−1 years later) and ends the day before the next
  anniversary: a July 1, 2026 commencement gives Lease Years 1–5 from 2026-07-01 to 2031-06-30.
- The anniversary of a February 29 commencement in a common year is February 28, the same
  calendar-month rule as `calc_rent_schedule` (a note says so; a lease that says March 1 gives
  dates a day later). A commencement that is not the first of a month gets a note too: some leases
  end Lease Year 1 with the twelfth full calendar month.
- Steps must be in order and must not overlap, either every step has `lease_years` or none does,
  and `from`/`to` may be sent but must equal the derived dates.

The verified fact's value has each step's `from`, `to`, `annual_rent_psf` and `lease_years`, so
calculators and the abstract's step merging use it like any schedule. It cites two sources, the
table first and the commencement date second, and names the formula in `provenance.formula`; the
verified item shows the derivation under `derived_from` (the commencement date, its citation, the
convention and each step's dates), and `checked` lists the dates `as: "derived"`. `fact_validate`
checks such a fact the same way: the rents and lease years against the first quote, and the dates
against a commencement date written in the second. If the commencement date is not verified (its
quote is not on the page, or does not state the date), the schedule is `needs_review` with check
`derivation`; without `commencement` it is `rejected` (check `value`). In `doc_abstract_lease` the
commencement quote must be in the same document as the table.

### Words hyphenated across a line

A word broken at a line end ("Pro-" at the end of one line, "portionate" at the start of the
next) must be quoted with its hyphen, followed by the line break or a space: `Pro- portionate` or
`Pro-\nportionate`. FactLot does not rejoin hyphenated words, because a hyphen
before a line break is sometimes part of the word (`self-` / `insured`). When a quote matches only
after rejoining, the rejection says so and names the page:
`quote not found in the document; it matches page 2 only if a word hyphenated at a line break is
rejoined. Quote the text as printed: keep the hyphen and the line break (a space will do)`.

## Document IDs

`document_id` is `fl:document:sha256-<sha256>` when you pass `sha256`, the hash of the original
file (the same ID `id_document` gives that file); `document_id_basis` is then `sha256`. FactLot
cannot check that the pages came from that file. Without it, the ID is the SHA-256 of the pages
joined by form feeds (`\f`) and the basis is `page_text`; for a text file whose pages are split
by form feeds that is the same as hashing the file.

Fact IDs follow Ingest: `flf_` and 24 Crockford base32 characters of SHA-256 of the subject,
predicate, document ID and quote joined by U+001F. The subject defaults to the document ID; pass
your lease's `fl:lease:…` URN as `subject`.

## The predicate catalog

`doc_predicates` (REST `/v1/doc/predicates`, MCP, every provider format) answers "what shape does
this predicate take, and what will FactLot check?" without a rejection round trip. Give
`predicate` for one, `prefix` (`lease.renewal`) for a group, or neither for all 30 lease
predicates. Each entry has:

- `value_schema`: the value shape as JSON Schema (an `anyOf` for the four clauses that also accept
  a summary string), and `example`: a valid value with a synthetic quote that states it, its
  `outcome` from `doc_verify_facts` (`verified`, or `needs_review` when the shape has parts no
  quote can prove), and which of its parts were checked;
- `checked`: the parts always compared with the quote and how (`number`, `ratio`, `date`, `string`
  for a verbatim name, `words` for as-written text, `phrase` for a consent standard, `text` for the
  numbers inside free text); a part the quote does not state makes the candidate
  `needs_review` (check `consistency`);
- `checked_if_written`: the parts that count as checked only when the quote writes them out
  (summaries) or words them (`free_rent.applies_to: base_rent`, a `natural` breakpoint), with the
  phrases FactLot recognises;
- `always_review`: the parts no quote confirms (true/false values, enum values with no recognised
  wording), which hold a candidate in `needs_review` (check `coverage`) unless a person confirms
  them;
- for `lease.base_rent_schedule`, `alternate_forms` describes the lease-year form.

Paths start at `value` and `[]` stands for every item of an array. `notes` explains the statuses,
human confirmation and the generic rules for any other predicate. The catalog is generated from the
tables the checks use (`packages/tools/src/predicates.ts`, published as
`spec/schemas/predicates.json`, which the Python SDK serves as is); tests in both languages run
every example through the checks and fail if a predicate is missing.

## Lease abstracts and amendment precedence

`doc_abstract_lease` takes the lease and its amendments in any order. Each document carries
`pages` with `candidates` (checked as above), or the `facts` an earlier `doc_verify_facts` call
returned for it. Facts sent with their pages are checked again in full; facts sent without pages
(to stay under the request size limit) are checked against their own quotes only and marked
`quote_on_page: false` in the abstract.

- **Roles.** Give the lease `role: "original"` and each amendment `role: "amendment"`. The input
  order is never used. A document without a role is taken to be the original only when no
  document is marked original and it is the only one without a role, or the only one without a
  role and an `effective_date`; the abstract marks it `role_inferred: true`. Otherwise, for
  example two documents with neither, the call is an `InputError` asking for `role`.
- **Order.** The original applies first, then amendments by `effective_date`. With two or more
  amendments every amendment needs its `effective_date` (an `InputError` names the one without);
  a single amendment may have none.
- **Precedence.** For each predicate, the latest document that states it controls. The earlier
  values move to `history`, and the controlling fact lists the one it replaces in `supersedes`.
  Amendment facts carry the amendment's `effective_date` as `valid_from`.
- **Pending amendments.** An amendment whose `effective_date` is after `as_of` does not control
  the current abstract. Its values are listed under the field's `pending` and the top-level
  `pending` (value, effective date and citation), its facts under `pending_facts` rather than
  `facts`, and `warnings` names the document. The document is listed with `pending: true`
  instead of an `applied` number. Run the abstract again with a later `as_of` once it takes
  effect.
- **Rent schedules.** An amendment that restates `lease.base_rent_schedule` from a later date
  keeps the earlier steps before that date: the field's `value` is the merged schedule, and
  `carried_forward` cites the document each kept step came from. A kept step that runs past the
  new schedule's first day is shown ending the day before, with a note. The amendment's own fact
  still states only its own steps.
- **Conflicts.** When one document states two different values for a predicate, the first
  controls and the other is listed under `conflicts`. Two documents of the same rank (two
  originals, or two amendments effective the same day) do not supersede each other: a different
  value from the second is a conflict, and the document IDs, not the input order, decide which is
  listed first.
- **Open items.** When the controlling document or a later one has a candidate for the same
  predicate that needs review or was rejected, the field lists it under `open_items`: the
  answer may change once a person looks.

FactLot only orders what you extracted. It does not find terms your model missed, and an
amendment that changes a term without restating it ("the Term is extended by twenty-four
months") gives no date to check: extract the resulting date with that sentence as its quote and
it will be held for review, which is the right outcome for a computed date.

## Comparing an estoppel or rent roll

`doc_compare` takes the values another document asserts, mapped by your agent to predicates and
shaped like lease values (`YYYY-MM-DD`, plain numbers, decimal rates), and the lease facts from
`doc_abstract_lease` (`facts`) or `doc_verify_facts`. Lease facts another fact supersedes are
ignored. Values compare exactly as JSON: numbers by value (`95000` equals `95000.0`), strings
exactly, so a name written differently is a `mismatch` for a person to judge, and for an object
only the fields you assert. Every lease fact must pass `fact_validate`; FactLot does not re-read
the lease here. When the lease fact is an `extracted` fact whose quote does not confirm part of
its value (a true/false value, an enum, a paraphrased summary: facts that `doc_verify_facts` would
hold for review), the result lists those parts in `lease_not_checked`, so a `match` against them
is not read as a verified match. When the lease fact is `human_verified`, the result adds
`lease_method`, `lease_verified_by` and `lease_confirmed_by_person`
([human confirmation](#human-confirmation)).

## Critical dates from verified terms

`calc_critical_dates` (formula `calc.critical_dates@1`) turns the expiration date and the option
terms an abstract verified into a dated list of notice deadlines and option windows, with steps:

- `expiration_date` (required), optional `commencement_date` and `as_of`;
- `renewal_option`: `count`, `term_months`, and one of `notice_months`, `notice_days` or
  `notice_window` (`earliest_months_before`, `latest_months_before`). Option 1 counts back from
  the expiration; each later option counts back from the end of the renewal term before it, which
  assumes every earlier option was exercised (a warning says so);
- `termination_options`: each `effective_date` with `notice_months` or `notice_days`;
- `expansion_option_deadline`, and `other_deadlines`: a stated `date`, or `from_date` plus
  `days_after` (a ROFO response period after Landlord's notice).

Conventions, also returned in `value.conventions`:

- Calendar months. N months before a date is the same day of the month N months earlier, clamped
  to a shorter month's end. A month-end date is not moved to the target month's end: notice six
  months before February 28, 2031 is due August 28, 2030; a warning gives the month-end reading
  (August 31) when it would be later, and FactLot keeps the earlier date.
- "No later than N months before" a date means that date minus N months: the deadline is the last
  day notice may be given. A renewal term starts the day after the expiration in effect and ends
  the day before the same day of the month `term_months` later.
- Business days. A deadline on a Saturday, Sunday or US federal holiday is flagged
  (`non_business_day`) and not moved by default. `business_day_roll: "preceding"` moves it to the
  business day before (never later than the lease date); `"following"` moves it to the next
  business day, with a warning, because only a lease clause that says so allows that. Holidays are
  the eleven of 5 U.S.C. §6103(a) (Juneteenth from 2021) with their federal observed days
  (Saturday: the Friday before; Sunday: the Monday after), from 1986 on; `holidays: "none"`
  counts weekends only. State, bank and local holidays are not included: the lease's definition of
  business day controls.
- With `as_of`, every event has `days_from_as_of`, each deadline before `as_of` is warned as
  passed, and `next_deadline` is the first deadline on or after it.

The result lists `events` in date order (with each one's `kind`, label and option number),
`renewal_terms`, `termination_options` and `next_deadline`. It does arithmetic on the dates given;
it does not read the notice clause (how notice is given, when it is deemed received). Not legal
advice.

## Checking one claim

`doc_verify_claim` takes a claim as `{predicate, value}` or as a short sentence, either
`{"text": "…"}` or the sentence itself as a string, plus the quote and page it rests on. The quote
must be on the page, by the same rules as above.

- `supported`: every checked number, date, name and as-written text is written in the quote;
  parts that cannot be checked are listed in `not_checked`.
- `contradicted`: the quote states numbers or dates of the same kind, but not the claimed one;
  `quote_states` lists what it does state. FactLot cannot tell whether those numbers are about the
  same term, so read them.
- `unverifiable`: the quote is not on the page, nothing in the claim can be checked (a
  true/false value, an enum, a summary the quote does not write out), the quote states no value
  of that kind, or a name or as-written text is not in the quote.

For a sentence, only its dates and numbers are compared (a date such as "June 30, 2031" counts
once, not also as the numbers 30 and 2031); FactLot does not read what the sentence means.

## What `fact_validate` checks

`fact_validate` checks one fact without the document:

- the published schema (`spec/schemas/fact.json`): subject URN, dotted predicate, `as_of`,
  provenance, rights; fields the schema does not define are rejected at every level
- every fact except a computed one cites at least one source; an inferred fact cites the
  evidence it was inferred from; a computed fact names its formula or cites a source
- `valid_from` is not after `valid_to`; a source `span` does not end before it starts
- for an Ingest predicate, the value has the predicate's shape and every source quote states the
  value, by the written-form rules above (`value not supported by quote: …`)

It does not check that a quote is in the document, that a document or sha256 exists, that
`supersedes` IDs exist, or quotes for predicates outside the Ingest table. Use `doc_verify_facts`
with the pages for the first, and `doc_verify_claim` for a generic predicate.

## What is not checked

- **Meaning.** The checks are textual. A quote that states the right number for a different term
  ("12 months' notice" supporting a 12-month term) passes. Review what matters.
- **Completeness.** FactLot verifies what it is given; it does not look for terms the model
  missed.
- **The file.** The doc tools see text, not the PDF (locally, `read_pdf` and `doc_read_pdf`
  extract that text for you). Page text from OCR carries OCR errors, and a
  quote copied from a misrecognised page verifies against the misrecognition.
- **True/false values, enums and summaries.** They are never proven by a quote. A value that has
  one goes to `needs_review` (check `coverage`) unless the quote words the enum or writes out the
  summary; a consent standard, `free_rent.applies_to: base_rent` and a `natural` breakpoint are
  checked for their wording. A person's confirmation can carry them, as `human_verified`; FactLot
  does not check who the person is.

## Clause-level lease terms

Exclusive use with its carve-outs, prohibited uses, co-tenancy, go-dark, radius restrictions,
relocation rights, kick-outs, the assignment and sublet consent standard, and ROFR/ROFO details
are Ingest predicates with structured values ([predicate table](ingest.md#predicates)), checked
like every other candidate. Text they state as written (each prohibited use, a protected use given
as a string or as `protected_use`, each carve-out, a ROFR or ROFO description) must be written in
the quote; when it is not and it carries a number, the reason names the number, so "incidental
sales in up to 15% of floor area" against a quote saying 10% fails on 15. Summaries (a co-tenancy
trigger or remedy, where an exclusive applies, a radius duration or remedy, a kick-out test period
or fee) and true/false fields are held for review unless the quote confirms them (step 5 above).
The consent standard is checked for its wording:

| `consent_standard`                                 | The quote must contain                             |
| -------------------------------------------------- | -------------------------------------------------- |
| `sole_discretion`                                  | "sole discretion" or "absolute discretion"         |
| `not_unreasonably_withheld`                        | "unreasonably withheld" or "unreasonably withhold" |
| `not_unreasonably_withheld_conditioned_or_delayed` | that, and "delay" (delayed) or "conditioned"       |
| `prohibited`, `no_consent_required`                | not checked                                        |

The wording check is textual: "consent may be withheld in Landlord's sole discretion, except
that it shall not be unreasonably withheld for an affiliate" passes both of the first two.

## Checking a proposed use against exclusives

`doc_check_use_conflict` takes a center's verified `lease.exclusive_use` and
`lease.prohibited_uses` facts (from `doc_verify_facts` or `doc_abstract_lease`; each must pass
`fact_validate`, and a fact another fact supersedes is ignored) and a proposed use: a description,
and optionally a use category and a 2022 NAICS code. A restriction is a **potential conflict**
when:

- it shares a **use category** with the proposed use. Categories come from FactLot's open
  vocabulary ([`spec/schemas/vocabularies/use-categories.json`](../spec/schemas/vocabularies/use-categories.json),
  66 categories such as `coffee`, `bar_nightclub`, `pharmacy`, `adult`), found by keywords as
  whole words, plus the category you give and every category whose NAICS code starts with yours
  (or yours with it: 7225 matches coffee shops and restaurants); or
- it shares **words** with the proposed use: two or more, or every significant word of a short
  restriction ("the sale of kites" against "kite store"). Stopwords such as "sale", "store",
  "tenant" do not count.

Words are compared after normalization: lower case, accents removed, "&" read as "and", simple
plurals folded ("bakeries" = "bakery"). Where keywords overlap, the longest wins, so a "juice bar"
or "coffee bar" is not a bar. Each hit returns the restriction, the matched categories and words,
the exclusive's carve-outs (those that mention the proposed use are listed under
`carve_outs_that_may_apply`), the controlling citation (document, page, section, quote), and the
label `potential conflict — needs human review`. FactLot does not interpret the lease, decide
whether a carve-out applies, or give legal conclusions, and an empty list does not mean there is
no conflict.

## Spreading an operating statement

`doc_spread_statement` maps a T-12, operating statement, budget or rent roll summary onto a
published chart of accounts
([`spec/schemas/vocabularies/chart-of-accounts.json`](../spec/schemas/vocabularies/chart-of-accounts.json)):
`multifamily`, `commercial` (office, retail, industrial), or `hotel`, which follows the structure
of the USALI summary operating statement. Your agent sends one line per item it reads:
`{label, amount, quote, page}`, optionally its proposed `category`, the `period` column it read the
amount from, and for a subtotal the statement prints, `sums`: the indexes of the lines it adds up.
The statement's own totals are lines too, with the total as their category
(`effective_gross_income`, `total_operating_expenses`, `net_operating_income`, `ebitda`, ...).

Each line is checked in order, and a line that fails is left out of the spread with its reason:

1. the quote is on the page (the rules above);
2. the amount is written in the quote, in any common form ("245,000", "$245,000.00");
3. the label is written in the quote, as the statement prints it.

**Mapping.** The label is matched against the chart's keywords (whole words, longest match). When
you give a category that is in the chart, it is used; if the label maps somewhere else, a
`category_review` exception says so. Without a category, a label that maps to exactly one category
is placed there; an ambiguous label ("Parking Lot Repairs": parking income or repairs?) or an
unknown one is left out with an `unmapped` exception. A category outside the chart is reported as
`unknown_category` and the label is mapped instead.

**Signs.** Income, expenses and capital items are positive. Contra lines (vacancy, loss to lease,
concessions, bad debt, free rent, non-operating income in a hotel) are always subtracted, however
the statement writes them. Any other amount the quote writes as negative, `(4,000)`, `-4,000` or
`-$4,000`, is spread as negative and a `sign` exception notes it.

**Totals.** Per period, FactLot sums each section and computes the chart's totals:

| Chart                   | Totals                                                                                                                                                                                                                                                                                                  |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| multifamily, commercial | effective gross income, total operating expenses, net operating income, total capital items (capex, reserves; TI and leasing commissions for commercial), net cash flow before debt service                                                                                                             |
| hotel                   | total operating revenue, departmental expenses, departmental profit, undistributed operating expenses, gross operating profit, management fees, income before non-operating income and expenses, non-operating, EBITDA, replacement reserve, net operating income (EBITDA less the replacement reserve) |

Debt service, depreciation and owner costs are kept apart and never enter NOI. A total the
statement states foots when it is within the tolerance of the computed one; a subtotal foots when
its size matches the sum of its lines. The default tolerance is 0.5 for each line added (each
rounded line can be off by half a unit); pass `tolerance` to change it. A line whose label starts
with "Total" but is spread as an ordinary line gets a `possible_subtotal` exception, since it may
count its parts twice. Statistics (units, occupancy, rooms sold, ADR) are memo lines: verified and
cited, not summed.

The result gives each period's sections, totals (with whether each stated total foots), subtotals
and memo lines; every line with its status, category, spread amount and citation (document, page,
quote, span, `ocr` when the page came from OCR); the exceptions to review; and a summary. FactLot
does not find lines the agent missed: compare the stated totals.

## PDF files (self-hosted)

The hosted API takes page text. Run locally, FactLot can read the PDF itself:

```python
import factlot

doc = factlot.read_pdf("lease.pdf", ocr="tesseract")     # a path or the file's bytes
factlot.run_tool("doc_verify_facts", {"document": doc["document"], "as_of": "2026-11-04",
                                      "candidates": [...]})
```

`read_pdf` extracts each page's text layer with [pypdf](https://github.com/py-pdf/pypdf)
(BSD-3-Clause, an optional dependency: `pip install 'factlot[pdf]'`), sends every page without a
text layer through the pluggable OCR hook of FactLot Ingest (any callable, or a backend name such
as `tesseract`; [ingest.md](ingest.md#ocr-backends)), and returns `document`, ready for any doc
tool: the pages, the file's `sha256` (so `document_id` is `fl:document:sha256-<sha256>`, the ID
`id_document` gives the file) and `ocr_pages`, the pages whose text came from OCR. The local MCP
server's `doc_read_pdf` runs the same code (`python -m factlot.pdf`, with `FACTLOT_PYTHON` naming
the interpreter if `python3` is not the one with FactLot), so both SDKs read a PDF the same way and
quotes match the same text.

Any document input may list `ocr_pages`, wherever its text came from. Facts, spread lines and
claim evidence cited to those pages carry `ocr: true`, so a reviewer checks the scan rather than
a text layer.

## Fact packages

A fact package hands verified facts to someone else (a lender, a buyer's agent, an auditor) in a
form they can check without trusting the sender's systems. `fact_package_create` takes facts
(each must pass `fact_validate`) and returns:

- `documents`: every document the facts cite, with its `sha256` when the source or the
  `fl:document:sha256-…` ID gives it;
- `facts`, unchanged, and `integrity`: the SHA-256 of each fact's canonical JSON
  ([RFC 8785](https://www.rfc-editor.org/rfc/rfc8785) JCS) as an
  [RFC 6962](https://www.rfc-editor.org/rfc/rfc6962) Merkle leaf, the Merkle root, and `digest`,
  the SHA-256 of the canonical manifest (format, version, title, created_at, created_by,
  documents, fact count, Merkle root);
- `signing_message`: `factlot.fact_package.v1:<digest>`, the exact text to sign.

FactLot adds no clock time (pass `created_at`), so the same input always gives the same digest.

**Signing happens where the key is.** FactLot never sees a private key. The holder signs
`signing_message` with their own Ed25519 key and adds
`signature: {algorithm: "Ed25519", public_key, key_id?, value}` (public key and signature as
base64url):

- Python: `factlot.sign_fact_package(package, private_key)` with a PKCS#8 PEM, a raw 32-byte
  seed, or a `cryptography` key (`pip install 'factlot[signing]'`;
  [cryptography](https://github.com/pyca/cryptography) is Apache-2.0 or BSD-3-Clause; the Python
  standard library has no Ed25519);
- TypeScript: `signFactPackage(package, cryptoKey)` from `@factlot/tools` (WebCrypto);
- the local MCP server: `fact_package_sign`, which reads the key from the file named by
  `FACTLOT_SIGNING_KEY_FILE` (for example made with `openssl genpkey -algorithm ed25519`), so the
  key never passes through the conversation.

`fact_package_verify` recomputes every hash from the content: a changed fact, title, date or
document list shows as an `integrity` mismatch naming what differs. It runs each fact through
`fact_validate`. The signature is `verified` only against the `public_key` you pass, the
signer's key you trust; without one it can at most `match` the key inside the package, which
proves nothing about who signed. Given the source documents' pages (with `sha256` when the facts
cite the file's hash), it checks each quote is on its cited page. `valid` is true when all of
that checks out (and, when you pass a key, the signature verifies with it). In Python without
`cryptography`, the signature is reported `unavailable` and everything else is still checked.

The result says what it covered: `checks_run` lists the checks above as they ran (with or without
a trusted key, with or without pages), and `checks_not_run` what was not checked: quotes of
documents whose pages were not given, whether the pages came from the files their sha256 names,
and meaning. `fact_validate` compares each Ingest fact's numbers, dates, names and as-written text
with its quotes, but a package can carry values no quote confirms (a true/false value, an enum, a
paraphrased summary, or a generic predicate's value). For `extracted` facts those parts are listed
in `values_not_checked` and named in `checks_not_run`. For `human_verified` facts they are listed
in `values_confirmed_by_person`, with `verified_by`, because they rest on a person's confirmation
that FactLot does not authenticate. Neither makes `valid` false: verifying the package is about
whether it is intact and correctly cited, not a second judgement of each value.
`fact_package_create` lists the `human_verified` facts under `confirmed_by_person` too, outside the
package, so the digest does not change.

## Limits

Per call: 2,000 pages per document, 100,000 characters per page, 2,000,000 characters in all,
500 candidates (or facts) per document and 2,000 per call, 50 documents per abstract, quotes up
to 5,000 characters, 2,000 lease facts and 500 asserted values per comparison, 1,000 statement
lines per spread, 2,000 facts per use check or package, 50 source documents per package
verification. `doc_read_pdf` reads files up to 100 MB. The hosted API
also caps a request at 1 MiB, which binds first there: split a long lease into several
`doc_verify_facts` calls and pass the returned facts to `doc_abstract_lease` without pages.
Characters are UTF-16 code units in TypeScript and code points in Python.

## Where your text goes

Run locally (the Python SDK, the standalone MCP server, or your own server), nothing leaves
your machine. On the hosted API the pages you send reach FactLot's server for the duration of the
call: they are checked in memory and returned in the response as quotes and spans; nothing is
stored, and the request log records metadata only (`REQUEST_LOG_FIELDS` in
`packages/server/src/index.ts`; [customer documents policy](customer-documents.md), section 5).
