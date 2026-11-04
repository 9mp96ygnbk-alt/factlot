# Document verification

Four tools turn values an agent reads from a document into cited FactLot facts. **Your agent
extracts; FactLot verifies.** Your model reads the pages and proposes each value with the
verbatim quote and page it came from. FactLot checks every proposal with deterministic code and
returns facts it can cite, items a person should look at, and rejections, each with a reason the
agent can act on. FactLot runs no model, so a verification costs no model spend and gives the
same answer every time.

| Tool                 | Input                                                                  | Output                                                                                    |
| -------------------- | ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `doc_verify_facts`   | one document's pages, and candidates `{predicate, value, quote, page}` | `verified` facts, `needs_review`, `rejected`, each with a reason                          |
| `doc_abstract_lease` | a lease and its amendments, each with candidates or verified facts     | the current-state abstract: each term's value, controlling citation, and history          |
| `doc_compare`        | values another document asserts (estoppel, rent roll), and lease facts | per value: `match`, `mismatch`, `not_in_lease` or `ambiguous_in_lease`, with the citation |
| `doc_verify_claim`   | one claim (`{predicate, value}` or a sentence), its quote and page     | `supported`, `contradicted` or `unverifiable`, with the evidence                          |

They are in the MCP server, the REST API (`/v1/doc/verify_facts`, `/v1/doc/abstract_lease`,
`/v1/doc/compare`, `/v1/doc/verify_claim`), every provider format, and the Python SDK
(`factlot.run_tool`). The checks are the ones FactLot Ingest has always run
([ingest.md](ingest.md)); the TypeScript code (`packages/tools/src/quotes.ts`,
`documents.ts`) is a port of the Python verifier (`python/src/factlot/ingest/verify.py`,
`python/src/factlot/docverify.py`), and `spec/vectors/documents.json` pins both. A runnable
example with a synthetic lease, amendment and estoppel is in
[`examples/document_verification.py`](../examples/document_verification.py).

## What a candidate goes through

`doc_verify_facts` checks each candidate in this order and stops at the first failure.

1. **Value shape.** For an Ingest predicate the value must have the shape in the
   [Ingest predicate table](ingest.md#predicates): dates `YYYY-MM-DD`, `lease.pro_rata_share` in
   (0, 1], rent steps with `from` before `to`, a CAM cap with an explicit method, a guarantor that
   is a name and not an address. Any other dotted lower_snake predicate (`lease.notice_days`,
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
   - every step of a rent schedule is checked
   - for a generic predicate, every number, ratio (a number in (0, 1]) and date anywhere in the
     value is checked; other strings are not

   Failure: `needs_review`, check `consistency`, with a reason such as
   `value "2033-06-30" not found in quote`. The quote is real, so a person can decide whether the
   model misread it.

4. **Confidence.** A candidate that passes everything but carries a `confidence` below 0.8 goes to
   `needs_review`, check `confidence`.

A verified fact has `provenance.method: "extracted"` and one source: `document_id`, `page`,
`section` (if given), the `quote` as sent, and `span`, the code-point offsets of the matching
text in the document (all pages joined by form feeds), so `text[start:end]` is the passage as it
appears on the page. `span` is left out in the rare case where it cannot be computed exactly
(for example a Greek final sigma that lowercases differently letter by letter). Each verified
item also lists which parts of the value were `checked` and as what, and which were
`not_checked` (enums such as a cap method, free-text summaries such as a renewal rent).

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

## Lease abstracts and amendment precedence

`doc_abstract_lease` takes the lease and its amendments in any order. Each document carries
`pages` with `candidates` (checked as above), or the `facts` an earlier `doc_verify_facts` call
returned for it. Facts sent with their pages are checked again in full; facts sent without pages
(to stay under the request size limit) are checked against their own quotes only and marked
`quote_on_page: false` in the abstract.

- **Order.** The original applies first (`role`, default original for the first document and
  amendment for the rest), then amendments by `effective_date`, input order breaking ties. If any
  amendment has no date, amendments apply in the order given.
- **Precedence.** For each predicate, the latest document that states it controls. The earlier
  values move to `history`, and the controlling fact lists the one it replaces in `supersedes`.
  Amendment facts carry the amendment's `effective_date` as `valid_from`.
- **Conflicts.** When one document states two different values for a predicate, the first
  controls and the other is listed under `conflicts`.
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
the lease here.

## Checking one claim

`doc_verify_claim` takes a claim as `{predicate, value}` or as a short sentence, plus the quote
and page it rests on. The quote must be on the page, by the same rules as above.

- `supported`: every checked number, date and name is written in the quote.
- `contradicted`: the quote states numbers or dates of the same kind, but not the claimed one;
  `quote_states` lists what it does state. FactLot cannot tell whether those numbers are about the
  same term, so read them.
- `unverifiable`: the quote is not on the page, nothing in the claim can be checked (an enum or
  free text), the quote states no value of that kind, or a name is not in the quote.

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
- **The file.** FactLot sees text, not the PDF. Page text from OCR carries OCR errors, and a
  quote copied from a misrecognised page verifies against the misrecognition.
- **Enums and summaries.** A CAM cap method, what free rent applies to, ROFR and assignment
  summaries are type-checked only.

## Limits

Per call: 2,000 pages per document, 100,000 characters per page, 2,000,000 characters in all,
500 candidates (or facts) per document and 2,000 per call, 50 documents per abstract, quotes up
to 5,000 characters, 2,000 lease facts and 500 asserted values per comparison. The hosted API
also caps a request at 1 MiB, which binds first there: split a long lease into several
`doc_verify_facts` calls and pass the returned facts to `doc_abstract_lease` without pages.
Characters are UTF-16 code units in TypeScript and code points in Python.

## Where your text goes

Run locally (the Python SDK, the standalone MCP server, or your own server), nothing leaves
your machine. On the hosted API the pages you send reach FactLot's server for the duration of the
call: they are checked in memory and returned in the response as quotes and spans; nothing is
stored, and the request log records metadata only (`REQUEST_LOG_FIELDS` in
`packages/server/src/index.ts`; [customer documents policy](customer-documents.md), section 5).
