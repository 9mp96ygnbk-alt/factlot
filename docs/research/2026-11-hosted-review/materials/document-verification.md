# Document verification

Document tools turn values an agent reads from a document into cited FactLot facts. **Your agent
extracts; FactLot verifies.** Your model reads the pages and proposes each value with the
verbatim quote and page it came from. FactLot checks every proposal with deterministic code and
returns facts it can cite, items a person should look at, and rejections, each with a reason the
agent can act on. FactLot runs no model, so a verification costs no model spend and gives the
same answer every time.

| Tool                        | Input                                                                           | Output                                                                                                    |
| --------------------------- | ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `doc_verify_facts`          | one document's pages, and candidates `{predicate, value, quote, page}`          | `verified` facts, `needs_review`, `rejected`, each with a reason                                          |
| `doc_abstract_lease`        | a lease and its amendments, each with candidates or verified facts              | the current-state abstract: each term's value, controlling citation, and history                          |
| `doc_compare`               | values another document asserts (estoppel, rent roll), and lease facts          | per value: `match`, `mismatch`, `not_in_lease` or `ambiguous_in_lease`, with the citation                 |
| `doc_verify_claim`          | one claim (`{predicate, value}` or a sentence), its quote and page              | `supported`, `contradicted` or `unverifiable`, with the evidence                                          |
| `doc_spread_statement`      | a T-12 or operating statement's pages, and lines `{label, amount, quote, page}` | the statement on a standard chart of accounts (NOI, EBITDA, ...), each line cited, footing and exceptions |
| `doc_check_use_conflict`    | verified exclusive-use and prohibited-use facts, and a proposed use             | each potential conflict with the controlling quote, labelled for human review                             |
| `fact_package_create`       | facts                                                                           | a canonical, hash-chained package and the message its holder signs                                        |
| `fact_package_verify`       | a package, optionally the signer's public key and the source pages              | whether hashes, signature, facts and quotes check out, with details                                       |
| `doc_read_pdf` (local)      | a PDF file on this machine                                                      | the `document` input above: page text, sha256, OCR pages                                                  |
| `fact_package_sign` (local) | a package; the key comes from `FACTLOT_SIGNING_KEY_FILE`                        | the package with its Ed25519 signature                                                                    |

The first eight are in the MCP server, the REST API (`/v1/doc/verify_facts`,
`/v1/doc/abstract_lease`, `/v1/doc/compare`, `/v1/doc/verify_claim`, `/v1/doc/spread_statement`,
`/v1/doc/check_use_conflict`, `/v1/facts/package`, `/v1/facts/package/verify`), every provider
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
- **The file.** The doc tools see text, not the PDF (locally, `read_pdf` and `doc_read_pdf`
  extract that text for you). Page text from OCR carries OCR errors, and a
  quote copied from a misrecognised page verifies against the misrecognition.
- **Enums and summaries.** A CAM cap method, what free rent applies to, and summary strings
  (a ROFR or assignment summary, a protected use without numbers) are type-checked only; a consent
  standard is checked only for its wording.

## Clause-level lease terms

Exclusive use with its carve-outs, prohibited uses, co-tenancy, go-dark, radius restrictions,
relocation rights, kick-outs, the assignment and sublet consent standard, and ROFR/ROFO details
are Ingest predicates with structured values ([predicate table](ingest.md#predicates)), checked
like every other candidate. Free text inside them (a carve-out, a description) is checked for the
numbers it writes in digits, so "incidental sales in up to 10% of floor area" needs 10 or "ten" in
the quote. The consent standard is checked for its wording:

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
