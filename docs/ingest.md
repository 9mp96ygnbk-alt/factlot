# FactLot Ingest (prototype)

FactLot Ingest turns a lease and its amendments into cited FactLot facts. The code is in
`python/src/factlot/ingest/`.

```
pages ─▶ (OCR for pages with no text layer, if a backend is given)
      ─▶ extractor (Claude, or your own) ─▶ candidates {predicate, value, verbatim quote, page}
      ─▶ verifier: the value must have the right shape; the quote must appear on the cited page;
                   the numbers, dates, and names in the value must be written in the quote
      ─▶ review queue: a quote that is on the page but does not support the value, or a candidate
                       the extractor was unsure of, waits for a human decision
      ─▶ supersession: amendments override earlier terms, and the history is kept
      ─▶ FactLot facts: method "extracted", with document, page, section, quote (and ocr: true
                        when the page was read by OCR)
```

## Predicates

Every predicate the extractor is asked for, with the value shape `check_value` enforces and the
parts of the value `check_consistency` looks for in the quote. Numbers, ratios, and dates in a
value go through the same written-form rules whatever the predicate (see below); strings marked
_verbatim_ must appear in the quote; everything else (enums, summaries) is not checked against
the quote.

| Predicate                           | Value                                                                                                                              | Checked in the quote              |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| `lease.landlord`, `lease.tenant`    | string, the name exactly as written                                                                                                | the name, verbatim                |
| `lease.commencement_date`           | `YYYY-MM-DD`                                                                                                                       | the date                          |
| `lease.expiration_date`             | `YYYY-MM-DD`                                                                                                                       | the date                          |
| `lease.rentable_area_sf`            | positive number                                                                                                                    | the number                        |
| `lease.base_rent_schedule`          | array of `{from, to, annual_rent_psf}`, each step ordered                                                                          | every step's two dates and rent   |
| `lease.free_rent`                   | `{months, applies_to: base_rent \| gross_rent}`                                                                                    | months                            |
| `lease.security_deposit`            | positive number (USD)                                                                                                              | the number                        |
| `lease.pro_rata_share`              | number in (0, 1]                                                                                                                   | the ratio (or its percentage)     |
| `lease.cam_cap`                     | `{method: compounding_from_base \| simple_from_base \| year_over_year, rate}`                                                      | rate (ratio)                      |
| `lease.renewal_option`              | `{count, term_months, notice_months, rent: string}`                                                                                | count, term and notice months     |
| `lease.termination_option`          | `{effective_date, notice_months, fee: string}`                                                                                     | the date, notice months           |
| `lease.rofr`, `lease.rofo`          | string summary                                                                                                                     | nothing                           |
| `lease.exclusive_use`               | string, the protected use                                                                                                          | nothing                           |
| `lease.assignment_sublease`         | string summary                                                                                                                     | nothing                           |
| `lease.percentage_rent`             | `{rate in (0, 1], breakpoint: {type: natural \| fixed, amount?}, sales_exclusions?}`; a fixed breakpoint needs a positive amount   | rate (ratio), breakpoint amount   |
| `lease.co_tenancy`                  | `{trigger: string, remedy: string, cure_period_months?}`                                                                           | cure period months                |
| `lease.renewal_notice_deadline`     | `YYYY-MM-DD`, the last day to exercise a renewal                                                                                   | the date                          |
| `lease.termination_notice_deadline` | `YYYY-MM-DD`, the last day to give termination notice                                                                              | the date                          |
| `lease.rent_commencement_date`      | `YYYY-MM-DD`                                                                                                                       | the date                          |
| `lease.expansion_option_deadline`   | `YYYY-MM-DD`, the last day to exercise an expansion option                                                                         | the date                          |
| `lease.operating_expense_base_year` | integer year (1900–2200)                                                                                                           | the year, as a number             |
| `lease.parking`                     | `{spaces > 0, rate_monthly? ≥ 0}`                                                                                                  | spaces, monthly rate              |
| `lease.guaranty`                    | `{guarantor: string, cap?}`; the guarantor is a name, and a value that reads as a street address, postal code or PO box is refused | the guarantor name, verbatim; cap |

The critical dates are separate dated predicates rather than offsets ("twelve months before
expiration") so each one is checked against a date written on the page and can be diarised as
is. A value computed from another term is not a fact this pipeline emits.

## Trust model

The model proposes and deterministic code decides:

- **Quotes.** A candidate whose quote isn't in the document is rejected. If the quote appears on a
  different single page, the page number is corrected and the correction is reported. If it
  appears on several pages, the candidate is rejected because it can't be cited to one page.
- **Values.** Values are type-checked: dates are `YYYY-MM-DD`, shares fall in (0, 1], and rent
  steps are ordered.
- **Value–quote consistency.** A quote that exists is not proof that the value follows from it,
  so `check_consistency` requires every checkable part of the value to be written in the quote,
  in some common form:
  - _Numbers_ (areas, amounts, step rents, month counts) match any way of writing the same
    number: `24.5`, `24.50`, `$24.50`, `24.50/SF`, `1,250,000`, `1250000`, and number words up
    to ninety-nine (`twelve`, `ninety-five`).
  - _Ratios_ (pro rata share, cap rate) also match their percentage form when the quote carries a
    `%` sign or the word "percent": `0.0325` matches `3.25%` and `3.25 percent`, but not a bare
    `3.25`.
  - _Dates_ match `2027-03-01`, `March 1, 2027`, `Mar. 1, 2027`, `3/1/2027` (and the day-first
    reading `1/3/2027`), `1 March 2027`, `1st day of March, 2027`, and `first day of March, 2027`.
    Two-digit years and relative dates ("the Commencement Date") do not match.
  - _Strings that must be verbatim_ (the party names `lease.landlord` and `lease.tenant`, and the
    guarantor in `lease.guaranty`) must appear in the quote case-insensitively, ignoring
    whitespace and typographic quotes.
  - Every step of a rent schedule is checked, so the quote must cover the whole schedule.

  A failing candidate gets a reason naming the value and field, for example
  `value 24.5 not found in quote` or `value 2500000 (breakpoint.amount) not found in quote`, and
  goes to the review queue (below), since its quote is real and a person can tell whether the
  model misread it. The check is conservative: enums (a cap method, what free rent applies to),
  free-text summaries (ROFR, renewal rent, assignment terms), and predicates it has no rule for
  are never failed by it. It is textual, not semantic: a quote that states the number in another
  context, or that lists the right digits for a different term, still passes.

- **Confidence.** An extractor may put a `confidence` (0 to 1) on a candidate. A candidate that
  passes every check but reports a confidence below the threshold (`REVIEW_CONFIDENCE_THRESHOLD`,
  0.8, or `--confidence-threshold`) is queued for review instead of accepted. Candidates without
  a confidence are not held back. The shipped Claude extractor does not ask the model for one.

- **CAM caps.** A cap must use one of FactLot's explicit methods, so the calculators can use it
  directly.
- **OCR.** Pages whose extracted text is empty or whitespace (scans) have no text to cite. If an
  OCR backend is given, each such page's text comes from it and the page is flagged. Facts cited
  to a flagged page carry `"ocr": true` on their source reference, next to `page` and `quote`,
  so a reader knows the quote was matched against recognised text and should check the page
  image. `provenance.method` stays `extracted`. Without a backend the pages are skipped and
  listed in the document's `metadata["pages_without_text"]`; the CLI prints a warning naming
  them and reports them under `unreadable_pages` in the output JSON. OCR errors become part of
  the page text, so a quote the model copies from a misrecognised page still verifies against
  that misrecognition; the `ocr` flag exists so a human can catch this.

## Review queue

The verifier can dismiss a candidate (no quote on the page, wrong value shape) or accept it. In
between are candidates it can neither trust nor dismiss: the quote is on the page but the value
is not written in it, or the extractor was unsure. Those go to a review queue that works like
the registry's owner-match review (`docs/registry/README.md`, "Owner resolution"): nothing is
accepted automatically, a named reviewer decides each item once, and decisions are final.

Each `ReviewItem` carries the candidate (predicate, value, quote, section, confidence), the
check it failed (`consistency` or `confidence`) and the reason, the document and the page the
quote was found on (corrected if the model cited the wrong one, flagged `ocr` if the page was
recognised), and a status `pending`, `accepted` or `rejected`. Its ID is derived from the
predicate, quote and value, so the same item has the same ID on every run.

```python
from factlot.ingest import decide, ingest_lease, review_queue

result = ingest_lease(urn, docs, extractor, as_of="2026-11-03")
for item in review_queue(result):                      # pending, in document order
    print(item.id, item.candidate.predicate, item.check, item.reason, item.page, item.quote)

decide(result, "rv_056bge9hh9nv", accepted=True, decided_by="A. Reviewer")
decide(result, "rv_2b394pt02bkn", accepted=False, decided_by="A. Reviewer")
```

- **Accept.** The candidate becomes a fact with `method: "extracted"` (the value still came from
  the extractor and is cited to its quote) and takes its place in document order with the usual
  supersession. Because the fact schema has no free-text provenance note, the note goes in
  `provenance.verified_by`, which names the reviewer, the item and the check it failed, for
  example `A. Reviewer (accepted in ingest review rv_056bge9hh9nv after failing the consistency
check: value 59000 not found in quote)`, with the decision time in `verified_at`.
- **Reject.** The decision is recorded and the same (predicate, quote) pair is never queued
  again, whatever value the extractor attaches to it next time.
- **Persistence.** The CLI writes the queue into its output file (`--out`, default
  `lease-facts.json`) next to the facts and reads it back on the next run of the same file:
  accepted items are facts again (with their note), rejected pairs are not re-queued, pending
  items keep their IDs. Re-running with the same decisions produces the same file. A pending
  item whose candidate later verifies on its own is dropped from the queue.

```bash
python -m factlot.ingest --review                                   # list pending items
python -m factlot.ingest --accept rv_056bge9hh9nv --by "A. Reviewer"
python -m factlot.ingest --reject rv_2b394pt02bkn --by "A. Reviewer"
```

These three make no model call. A listing looks like:

```
rv_056bge9hh9nv  lease.security_deposit  [pending]
  value:   59000
  failed:  consistency (value 59000 not found in quote)
  cited:   synthetic_lease, page 2, section 3.3
  quote:   'a security deposit of $95,000'
```

## OCR backends

A backend is any callable `ocr(page) -> str`. `load_document(path, ocr=backend)` calls it with the
pypdf page object for a PDF page with no text layer, or with the `Path` of an image file (`.png`,
`.jpg`, `.jpeg`, `.tif`, `.tiff`, `.bmp`) given as a document, which becomes one page.

```python
from factlot.ingest import load_document, tesseract_ocr

doc = load_document("scanned-lease.pdf", ocr=tesseract_ocr())      # shells out to `tesseract`
doc = load_document("scan.png", ocr=lambda page: my_ocr(page))     # your own backend
```

The core stays standard-library only. The shipped backend, `tesseract_ocr()`, runs the
`tesseract` command (installed separately: `brew install tesseract`, `apt install tesseract-ocr`)
on an image path, or on each image embedded in a PDF page, which is how a scanned page is
usually stored. Building it raises a `RuntimeError` with install instructions when the command is
not on `PATH`. It does not rasterise pages: a PDF page with no text layer and no embedded image
(for example text drawn as vector outlines) yields no text and is reported as unreadable.

## Run it on real leases

```bash
pip install anthropic pypdf
python -m factlot.ingest --model <claude-model-id> --lease lease.pdf \
  --amendment first-amendment.pdf@2030-01-15 --gold gold.json

# scanned pages: add an OCR backend (tesseract must be installed)
python -m factlot.ingest --model <claude-model-id> --lease scanned-lease.pdf --ocr tesseract

# then work the review queue in the output file (no model call)
python -m factlot.ingest --review
python -m factlot.ingest --accept rv_… --by "A. Reviewer"
```

You need Claude API credentials. The model is always your choice. `--ocr` is resolved before
anything else runs, so a missing `tesseract` fails fast with exit code 2. The output file holds
the facts, the rejections, and the review queue; running the extraction again with the same
`--out` reuses its lease URN and keeps every review decision.

## Customer documents

What leaves your machine (the page text sent to the model, and nothing else), what the report
keeps, and how a hosted version will store and delete documents are in the
[customer documents policy](customer-documents.md). Two controls from it are in the pipeline:

- Every report has a `retention` header naming the policy and its version, `documents_days`,
  and `retain_until`: the run date plus `--retain-days` (default 30, `DEFAULT_RETENTION_DAYS`),
  the date a hosted copy of the source documents is deleted. Self-hosted, nothing acts on it. The
  CLI prints it with the summary.
- `--redact` (or `IngestResult.to_report(redact=True)`) persists document text only as the quotes
  that are evidence for a fact or a review item: rejected candidates keep their predicate, page
  and reason but lose their quote, and the report is marked `"redacted": true`. The review queue
  is untouched, so `--review`, `--accept` and `--reject` work on a redacted file. Hosted ingest
  will always persist the redacted form. Tests: `python/tests/test_ingest_policy.py`.

## Status

- The pipeline, verifier, supersession, CLI, and the Claude extractor's request and parsing are
  tested in `python/tests/test_ingest.py`. Those tests use a **synthetic** lease and a scripted
  extractor that includes deliberate model errors, including values that do not follow from their
  quotes. The consistency check's written forms and the OCR hook (with a fake backend and a
  stand-in `tesseract` script) are tested in `python/tests/test_ingest_checks.py`; the test
  against a real `tesseract` runs only when it is installed. The review queue (what is queued,
  accept and reject, persistence through the JSON file, idempotent re-runs, the CLI flags) is
  tested in `python/tests/test_ingest_review.py`, again on synthetic documents.
- **No accuracy number exists yet.** Getting one needs real leases with hand-labelled gold values,
  such as public lease exhibits from SEC EDGAR, which this environment cannot reach, plus an API
  key. That is the next step. Publish precision and recall per predicate, not a single headline
  figure.
- OCR quality is the backend's. Nothing here corrects recognition errors; the `ocr` flag on a
  source reference is the signal to review such facts by hand.
