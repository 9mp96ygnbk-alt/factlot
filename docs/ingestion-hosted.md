# Hosted lease ingestion and narratives

Two hosted tools on `api.factlot.com` call a model on the customer's behalf. In both, **a model
proposes and FactLot verifies**: nothing the model writes is returned as a fact or a figure until
FactLot's deterministic code has checked it.

| Tool                | REST                         | What the model does                                   | What FactLot checks                                                                                                   |
| ------------------- | ---------------------------- | ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `doc_extract_lease` | `POST /v1/doc/extract_lease` | reads a lease, proposes each term with quote and page | `doc_verify_facts` on every proposal: the quote is on the cited page, and every number, date and name is in the quote |
| `report_narrative`  | `POST /v1/report/narrative`  | drafts prose from one FactLot tool result             | every number, percentage, money amount, date and statute citation in the prose is a value of the result; no advice    |

Everything else in FactLot runs without a model, hosted and self-hosted. These two tools exist
only on the hosted API, only for Pro and Team keys, and only when the operator has configured a
model; otherwise they are not listed and their routes answer `503 ModelUnavailable` with a `next`
that says how to do the same with your own model and the free tools.

## doc_extract_lease

```
document ─▶ page text (pages, text, or a PDF's text layer; a scanned PDF answers NeedsOcr)
         ─▶ model: lease terms as JSON in the predicate catalog's shapes, each with quote and page
         ─▶ doc_verify_facts (deterministic): shape, quote on page, value in quote
         ─▶ facts (verified, cited) │ needs_review (with the failed check) │ unextracted
```

**Input.** `document` holds exactly one of:

- `pages`: the text of each page, `pages[0]` is page 1 (the shape every `doc_*` tool takes);
- `text`: the whole text with a form feed (`\f`) between pages (one page without form feeds);
- `pdf_base64`: the PDF, at most 20 MB and 200 pages. Its text layer is read with pdf.js;
- `url`: an `https` URL of a PDF or a `text/plain` file, fetched by FactLot for this request
  (public host names only, at most 3 redirects, each checked again, 20 MB, 200 pages);

plus an optional `title`. Optional `predicates` restricts the terms asked for (any of the 30 in
`doc_predicates`; default all), `document_id` (`fl:document:sha256-<hex>`) ties page text to the
original file, `subject` is the URN the facts are about, and `as_of` defaults to today (UTC).

**Output.**

| Field                                          | Meaning                                                                                                                                             |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `facts`                                        | FactLot facts that verified, exactly as `doc_verify_facts` returns them: method `extracted`, citing `document_id`, page, quote and character span   |
| `needs_review`                                 | every other proposal with `status` (`needs_review` or `rejected`), `check` (`quote`, `consistency`, `coverage`, `value`, `value_json`) and `reason` |
| `unextracted`                                  | requested predicates for which the model proposed nothing                                                                                           |
| `document`                                     | `document_id` (from the PDF's bytes, `document_id`, or the page text), `sha256`, `source`                                                           |
| `pages`, `pages_counted`, `pages_without_text` | page count, pages charged (pages with text), and pages with no text layer (not read; OCR them and send `pages`)                                     |
| `model`                                        | `{ id, input_tokens, output_tokens, cache_read_input_tokens }` for this call, retries included                                                      |
| `verified_by`, `quota`, `notice`, `warnings`   | the verifier and its version, the allowance left this month, and what was and was not checked                                                       |
| `nothing_stored`                               | always `true`                                                                                                                                       |

A scanned PDF (no text layer, or less than 20 characters a page on average) answers `422
NeedsOcr` with `needs_ocr: true`, without calling the model and without counting pages. Run OCR
where the file is (`doc_read_pdf` with `ocr: "tesseract"` on the local MCP server, or
`factlot.read_pdf(..., ocr="tesseract")`), then send `document.pages`.

**What is verified and what is not.** A fact under `facts` means FactLot found its quote on the
cited page and every number, date and party name of its value written in that quote (the rules
are in [document verification](document-verification.md#what-a-candidate-goes-through)). It does
not mean the model understood the clause: a quote that states the right number for a different
term still verifies, and a term the model missed is not detected (it is under `unextracted` only
when it was asked for). True/false values and enums that no wording confirms always land in
`needs_review` with check `coverage`. Rent schedules written by lease year are left out (the
model is told not to compute dates); extract them yourself with `doc_verify_facts` and its
`commencement` form. Amendments: run each document separately and combine the facts with
`doc_abstract_lease`.

**How the model is called.** One request to Anthropic's Messages API with FactLot's fixed
instructions and the predicate catalog (sent as a cached system prompt), the requested predicate
list, the title and the page text marked `[Page N]`. The answer is constrained by a JSON schema
(structured output): `{facts: [{predicate, value_json, quote, page, section}], not_found}`, with
the predicate an enum of the catalog. The value travels as JSON text because the 30 predicate
shapes together exceed what a structured-output schema may hold; FactLot parses it and
`doc_verify_facts` checks its shape. An answer that is not valid JSON is retried once. One call
has 60 seconds in all.

## report_narrative

**Input.** `tool` (a FactLot tool name), `result` (that tool's result exactly as returned) or
`input` (FactLot runs the tool itself and narrates that result; with both, they must match, or
the call answers `422 ResultMismatch`), `audience` (`summary`, `client_memo` or
`plain_english`), optional `max_words` (40 to 1,200; default 150, 400 or 250 by audience) and
`keep_unverified`. A calculator result must carry the calculator's own `formula.id`. Registry
results cannot be recomputed here: pass the `result`.

**What FactLot checks in the prose.**

1. **Figures.** Every number, percentage, money amount, date and statute citation is extracted
   and matched to a value anywhere in the result, formatting-aware: `$1,234,567.89`, `1234567.89`
   and `$1.23 million` all match 1234567.891 (rounding to the precision written); `6.5%` matches
   0.065; `June 30, 2031`, `30 June 2031`, `6/30/2031` and `2031-06-30` match `2031-06-30`;
   `June 2031` matches any date that month; number words (`five`) count as numbers; a citation
   such as `§41.43(b)(3)` must be written in the result. A sentence with a figure that matches
   nothing is removed from `text` and listed in `unverified_sentences` with the unmatched
   figures (with `keep_unverified: true` it stays, marked `[unverified: …]`).
2. **Advice and valuation.** Wording that advises or recommends ("you should", "recommend",
   "worth protesting", "likely to win", "tax savings", ...) or calls anything an appraisal or an
   opinion of value causes one redraft; a sentence that still has it is removed and listed in
   `removed_sentences`.
3. **Texas tools** (`calc_tx_unequal_appraisal`, `rules_tx_property_tax_protest_deadline`,
   `registry_tx_equity_candidates`): the model is told to describe arithmetic only, and the
   output carries the calculator's notice in `notice` and as the last paragraph of `text`: not an
   appraisal or opinion of value (Occupations Code §1103.003(1)), not legal or tax advice, and
   not a substitute for the advice of an attorney.

**Output.** `text`, `label` (`Drafted by a model; figures verified by FactLot against
<tool>@<version>`), `notice` (Texas tools), `audience`, `word_count`, `truncated` (sentences
dropped from the end to keep to `max_words`), `verification` (figures checked and verified,
sentences removed), `unverified_sentences`, `removed_sentences`, `redrafted`, `source` (`tool`,
`version`, `result_check`: `recomputed` or `shape`), `model`, `quota`, `nothing_stored: true`.

What is not checked: meaning. A sentence can pair a correct figure with the wrong label ("the
cap rate is 6.5%" when 6.5% is the discount rate) and pass. Read the text against the result
before relying on it, and keep the label with it.

## Limits and allowances

|                                   | Free | Pro | Team  |
| --------------------------------- | ---- | --- | ----- |
| `doc_extract_lease` pages a month | 0    | 100 | 2,000 |
| `report_narrative` calls a month  | 0    | 50  | 1,000 |

Counted per subscription per calendar month (UTC), shared by its keys, in counters of their own
(registry lookups are counted separately). A page counts when it has text and the model is
called; a narrative counts once per call that runs the model. Input errors, `NeedsOcr`, and calls
the model could not answer (busy, timeout, refusal, invalid output) are given back. At the cap
the tool answers `429 IngestQuotaExceeded` or `NarrativeQuotaExceeded` with `resets_at`; every
other tool keeps working and nothing extra is billed. `GET /v1/plans` lists the allowances under
`model_tools`.

Per call: 200 pages, 20 MB of PDF, 1,000,000 characters of page text, 60 seconds. At most two
model-backed calls are answered in one MCP request.

| Error                                                                                             | Status                          | Meaning                                                 |
| ------------------------------------------------------------------------------------------------- | ------------------------------- | ------------------------------------------------------- |
| `ModelUnavailable`                                                                                | 503                             | no model is configured on this server                   |
| `PlanRequired`                                                                                    | 403                             | no key, or a plan without the allowance                 |
| `ModelBusy`                                                                                       | 503                             | the model provider is rate limited or overloaded; retry |
| `ModelTimeout`                                                                                    | 504                             | over 60 seconds; send fewer predicates or fewer pages   |
| `ModelRefused`, `ModelOutputTooLong`, `ModelOutputInvalid`                                        | 422, 422, 502                   | the model gave no usable answer                         |
| `NeedsOcr`                                                                                        | 422                             | no text layer                                           |
| `DocumentTooLarge`, `DocumentUnreachable`, `UnsupportedDocument`, `PdfEncrypted`, `PdfUnreadable` | 413, 400/502, 400/415, 422, 422 | the document could not be read                          |

## Privacy

- The document (or result) is held in memory for the request only. FactLot stores nothing: no
  page text, quote, fact, figure or prose is written to storage, and none reaches a log. The only
  log line is `{tool, outcome, model, pages, attempts, input_tokens, output_tokens, latency_ms}`.
- For these two tools only, FactLot sends the page text (or the result) to Anthropic's API
  (Anthropic PBC, United States) for model inference, through a commercial organization: under
  Anthropic's commercial terms it does not train models on API inputs, and it keeps them only as
  its API data-retention terms allow. The PDF file itself is not sent; its text is.
- A URL is fetched without cookies or credentials, from public hosts only.
- Every other FactLot tool, hosted or self-hosted, runs without a model. For documents that must
  not leave your network, extract with your own model and check with `doc_verify_facts`
  ([document verification](document-verification.md)), or run [FactLot Ingest](ingest.md)
  self-hosted.

## Examples

REST, a PDF on disk (`base64 -i` on macOS, `base64 -w0` on Linux):

```bash
curl -s https://api.factlot.com/v1/doc/extract_lease \
  -H "Authorization: Bearer $FACTLOT_KEY" -H "content-type: application/json" \
  -d "{\"document\": {\"pdf_base64\": \"$(base64 -i lease.pdf)\", \"title\": \"Lease, Suite 400\"},
       \"predicates\": [\"lease.tenant\", \"lease.expiration_date\", \"lease.base_rent_schedule\"]}"
```

A narrative of a calculation FactLot recomputes from its input:

```bash
curl -s https://api.factlot.com/v1/report/narrative \
  -H "Authorization: Bearer $FACTLOT_KEY" -H "content-type: application/json" \
  -d '{"tool": "calc_npv", "input": {"rate": 0.08, "cash_flows": [-1000, 300, 400, 500]},
       "audience": "plain_english"}'
```

MCP (`https://api.factlot.com/mcp` with the key as a bearer token): the tools appear in
`tools/list` for Pro and Team keys. A call:

```json
{
  "jsonrpc": "2.0",
  "id": 7,
  "method": "tools/call",
  "params": {
    "name": "doc_extract_lease",
    "arguments": {
      "document": { "url": "https://example.com/leases/suite-400.pdf" },
      "predicates": ["lease.tenant", "lease.expiration_date"]
    }
  }
}
```

The answer is the same object as REST, in `structuredContent` (and as text); an error carries
`isError: true`. An MCP request with a PDF may be up to 28 MB; every other MCP request keeps the
1 MB limit.
