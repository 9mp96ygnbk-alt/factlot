# FactLot Ingest (prototype)

FactLot Ingest turns a lease and its amendments into cited FactLot facts. The code is in
`python/src/factlot/ingest/`.

```
pages ─▶ extractor (Claude, or your own) ─▶ candidates {predicate, value, verbatim quote, page}
      ─▶ verifier: the quote must appear on the cited page; the value must have the right shape
      ─▶ supersession: amendments override earlier terms, and the history is kept
      ─▶ FactLot facts: method "extracted", with document, page, section, and quote
```

## Trust model

The model proposes and deterministic code decides:

- **Quotes.** A candidate whose quote isn't in the document is rejected. If the quote appears on a
  different single page, the page number is corrected and the correction is reported. If it
  appears on several pages, the candidate is rejected because it can't be cited to one page.
- **Values.** Values are type-checked: dates are `YYYY-MM-DD`, shares fall in (0, 1], and rent
  steps are ordered.
- **CAM caps.** A cap must use one of FactLot's explicit methods, so the calculators can use it
  directly.

## Run it on real leases

```bash
pip install anthropic pypdf
python -m factlot.ingest --model <claude-model-id> --lease lease.pdf \
  --amendment first-amendment.pdf@2030-01-15 --gold gold.json
```

You need Claude API credentials. The model is always your choice.

## Status

- The pipeline, verifier, supersession, CLI, and the Claude extractor's request and parsing are
  tested in `python/tests/test_ingest.py`. Those tests use a **synthetic** lease and a scripted
  extractor that includes deliberate model errors.
- **No accuracy number exists yet.** Getting one needs real leases with hand-labelled gold values,
  such as public lease exhibits from SEC EDGAR, which this environment cannot reach, plus an API
  key. That is the next step. Publish precision and recall per predicate, not a single headline
  figure.
- Scanned PDFs without a text layer need OCR first. That isn't included yet.
