# FactLot Ingest (prototype)

FactLot Ingest turns a lease and its amendments into cited FactLot facts. The code is in
`python/src/factlot/ingest/`.

```
pages ─▶ (OCR for pages with no text layer, if a backend is given)
      ─▶ extractor (Claude, or your own) ─▶ candidates {predicate, value, verbatim quote, page}
      ─▶ verifier: the value must have the right shape; the quote must appear on the cited page;
                   the numbers, dates, and names in the value must be written in the quote
      ─▶ supersession: amendments override earlier terms, and the history is kept
      ─▶ FactLot facts: method "extracted", with document, page, section, quote (and ocr: true
                        when the page was read by OCR)
```

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
  - _Strings that must be verbatim_ (the party names `lease.landlord` and `lease.tenant`) must
    appear in the quote case-insensitively, ignoring whitespace and typographic quotes.
  - Every step of a rent schedule is checked, so the quote must cover the whole schedule.

  A failing candidate is rejected with a reason naming the value and field, for example
  `value 24.5 not found in quote` or `value "2027-03-01" (from) not found in quote`, and reported
  with the other rejections. The check is conservative: enums (a cap method, what free rent
  applies to), free-text summaries (ROFR, renewal rent, assignment terms), and predicates it has
  no rule for are never rejected by it. It is textual, not semantic: a quote that states the number
  in another context, or that lists the right digits for a different term, still passes.

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
```

You need Claude API credentials. The model is always your choice. `--ocr` is resolved before
anything else runs, so a missing `tesseract` fails fast with exit code 2.

## Status

- The pipeline, verifier, supersession, CLI, and the Claude extractor's request and parsing are
  tested in `python/tests/test_ingest.py`. Those tests use a **synthetic** lease and a scripted
  extractor that includes deliberate model errors, including values that do not follow from their
  quotes. The consistency check's written forms and the OCR hook (with a fake backend and a
  stand-in `tesseract` script) are tested in `python/tests/test_ingest_checks.py`; the test
  against a real `tesseract` runs only when it is installed.
- **No accuracy number exists yet.** Getting one needs real leases with hand-labelled gold values,
  such as public lease exhibits from SEC EDGAR, which this environment cannot reach, plus an API
  key. That is the next step. Publish precision and recall per predicate, not a single headline
  figure.
- OCR quality is the backend's. Nothing here corrects recognition errors; the `ocr` flag on a
  source reference is the signal to review such facts by hand.
