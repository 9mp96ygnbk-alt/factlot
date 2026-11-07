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
- `pdf_base64`: the PDF, at most 10 MB, 200 pages and 400,000 characters of text. Its text layer
  is read with pdf.js one page at a time, and reading stops (413 `DocumentTooLarge`) as soon as
  the text passes 400,000 characters;
- `url`: an `https` URL of a PDF or a `text/plain` file, fetched by FactLot for this request
  (public host names only, at most 3 redirects, each checked again, 10 MB, 200 pages);

plus an optional `title`. Optional `predicates` restricts the terms asked for (any of the 30 in
`doc_predicates`; default all), `document_id` (`fl:document:sha256-<hex>`) ties page text to the
original file, `subject` is the URN the facts are about, and `as_of` defaults to today (UTC).

**Output.**

| Field                                          | Meaning                                                                                                                                                                  |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `facts`                                        | FactLot facts that verified, exactly as `doc_verify_facts` returns them: method `extracted`, citing `document_id`, page, quote and character span                        |
| `needs_review`                                 | every other proposal with `status` (`needs_review` or `rejected`), `verified: false`, `check` (`quote`, `consistency`, `coverage`, `value`, `value_json`) and `reason`   |
| `unextracted`                                  | requested predicates for which the model proposed nothing                                                                                                                |
| `document`                                     | `document_id` (from the PDF's bytes, `document_id`, or the page text), `sha256`, `source`                                                                                |
| `pages`, `pages_counted`, `pages_without_text` | page count, pages charged (the larger of the pages with text and the characters ÷ 4,000, rounded up), and pages with no text layer (not read; OCR them and send `pages`) |
| `model`                                        | `{ id, input_tokens, output_tokens, cache_read_input_tokens }` for this call, retries included                                                                           |
| `verified_by`, `quota`, `notice`, `warnings`   | the verifier and its version, the allowance left this month, and what was and was not checked                                                                            |
| `nothing_stored`                               | always `true`                                                                                                                                                            |

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
`needs_review` with check `coverage`. A fact's `section` is kept only when the model's section
label is at most 20 characters of `0-9 A-Z a-z . ( ) § -` and is written on the cited page;
otherwise the fact has no section. Rent schedules written by lease year are left out (the
model is told not to compute dates); extract them yourself with `doc_verify_facts` and its
`commencement` form. Amendments: run each document separately and combine the facts with
`doc_abstract_lease`.

**How the model is called.** One request to a model provider's API with FactLot's fixed
instructions and the predicate catalog (sent as a cached system prompt), then the requested
predicate list, the title and the page text marked `[Page N]` (sent as a cached user block),
asking for inference in the United States (`inference_geo: "us"`). The answer is constrained by a JSON schema
(structured output): `{facts: [{predicate, value_json, quote, page, section}], not_found}`, with
the predicate an enum of the catalog. The value travels as JSON text because the 30 predicate
shapes together exceed what a structured-output schema may hold; FactLot parses it and
`doc_verify_facts` checks its shape. An answer that is not valid JSON in that shape is retried
once, with the note after the cached document; a single item whose `value_json` is not JSON is
returned under `needs_review` as `rejected` and costs no second request. One call has 120 seconds
in all; a provider 5xx or 529 is retried once only while at least 30 seconds remain, and a 400 or
413 is never retried.

## report_narrative

**Input.** `tool` (a FactLot tool name), `input` (FactLot runs the tool itself and narrates that
result) or `result` (that tool's result exactly as returned; with both, they must match, or the
call answers `422 ResultMismatch`), `audience` (`summary`, `client_memo` or `plain_english`),
optional `max_words` (40 to 1,200; default 150, 400 or 250 by audience) and `keep_unverified`. A
calculator result must carry the calculator's own `formula.id`. Registry results cannot be
recomputed here: pass the `result`. **Texas tools** (names containing `tx_`) are narrated only
from their `input`: a Texas `result` alone answers `422 InputRequired` with a `next`, and Texas
registry results cannot be narrated. When FactLot recomputes, the input's values are facts the
prose may cite too ("at an 8% rate").

**What FactLot checks in the prose.**

1. **Figures.** Every number, percentage, money amount, date and statute citation is extracted
   and matched to a value of the result, formatting-aware: `$1,234,567.89`, `1234567.89` and
   `$1.23 million` all match 1234567.891 (rounding to the precision written); a figure written
   with fewer than two significant digits must also be within 5% (`$1 million` does not match
   742,000); a minus sign must match a negative value (`-$73,000` does not match 73,000);
   `6.5%` matches the ratio 0.065 (or 6.5 in a field named `…percent`), never a plain 6.5;
   `June 30, 2031`, `30 June 2031`, `6/30/2031` and `2031-06-30` match `2031-06-30`, and `1/1/26`
   reads as 2026-01-01; `June 2031` matches any date that month; a range such as `5-9%` must
   match at both ends; number words (`five`, `two million`), fractions and multipliers (`half`,
   `a third`, `double`, `twice`) and leading-dot decimals (`.5%`) count as figures; digits joined
   by `/` or `-` that are neither a date nor a range never match. Only the result's values count:
   array lengths and numbers inside its descriptive text do not. A citation such as
   `§41.43(b)(3)` must be one the result writes, whole (`§41.43` does not match
   `§41.43(b)(3)`), and in the code the prose names (`Property Code §41.43(b)(3)` does not match
   a Tax Code citation). A sentence with a figure that matches nothing is removed from `text` and
   listed in `unverified_sentences` with the unmatched figures (with `keep_unverified: true` it
   stays, marked `[unverified: …]`).
2. **Advice and valuation.** Wording that advises, judges or values ("should", "ought to",
   "recommend", "worth protesting", "warranted", "likely to", "savings", "over-assessed",
   "excessive", "too high", "the market value … is", "is worth", "entitled to", "next step",
   "in our opinion", "estimate of value", ...) or calls anything an appraisal or an opinion of
   value causes one redraft; a sentence that still has it is removed and listed in
   `removed_sentences`. Only a negation right before the wording excuses it ("not an appraisal",
   "Nothing here is an appraisal"); "not legal advice; this appraisal shows …" is removed. If the
   redraft request fails, the checked first draft is returned.
3. **Texas tools** (`calc_tx_unequal_appraisal`, `rules_tx_property_tax_protest_deadline`,
   `registry_tx_equity_candidates`): the model is told to describe arithmetic only, and the
   output carries the calculator's notice in `notice` and as the last paragraph of `text`: not an
   appraisal or opinion of value (Occupations Code §1103.003(1)), not legal or tax advice, and
   not a substitute for the advice of an attorney.

**Output.** `text`, `label` (`Drafted by a model; figures verified by FactLot against
<tool>@<version>` when FactLot recomputed the result from `input`; `Drafted by a model; figures
matched against the result you supplied (not recomputed by FactLot)` when you gave the result),
`notice` (Texas tools), `audience`, `word_count`, `truncated` (sentences
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
(registry lookups are counted separately). An extraction is charged when the model is called:
the larger of its pages with text and its characters ÷ 4,000, rounded up (one 90,000-character
"page" counts 23); a narrative counts once per call that runs the model. Input errors and
`NeedsOcr` are never counted. Calls the model could not answer (busy, timeout, refusal, invalid
output) are given back for the first 5 such failures of a subscription in a UTC day; from the
6th on, a failed call is counted and its answer says so (`counted: true`). At the cap the tool
answers `429 IngestQuotaExceeded` or `NarrativeQuotaExceeded` with `resets_at`; every other tool
keeps working and nothing extra is billed. `GET /v1/plans` lists the allowances under
`model_tools`.

Per subscription, both tools together: at most 2 calls running at once and 6 started a minute;
over either, the call answers `429 ModelRateLimited` with `retry_after_seconds` (and a
`retry-after` header on REST) and nothing is counted.

Per call: 200 pages, 10 MB of PDF, 400,000 characters of page text (more answers `413
DocumentTooLarge` with a `next`), 120 seconds for `doc_extract_lease` and 60 seconds for
`report_narrative`. At most two model-backed calls are answered in one MCP request.

| Error                                                                                             | Status                          | Meaning                                                  |
| ------------------------------------------------------------------------------------------------- | ------------------------------- | -------------------------------------------------------- |
| `ModelUnavailable`                                                                                | 503                             | no model is configured on this server                    |
| `PlanRequired`                                                                                    | 403                             | no key, or a plan without the allowance                  |
| `ModelRateLimited`                                                                                | 429                             | over 2 calls at once or 6 a minute; retry after the wait |
| `InputRequired`                                                                                   | 422                             | a Texas result without its input                         |
| `ModelBusy`                                                                                       | 503                             | the model provider is rate limited or overloaded; retry  |
| `ModelTimeout`                                                                                    | 504                             | over 120 s (extraction) or 60 s (narrative)              |
| `ModelRefused`, `ModelOutputTooLong`, `ModelOutputInvalid`                                        | 422, 422, 502                   | the model gave no usable answer                          |
| `ModelInputTooLarge`                                                                              | 413                             | the provider refused the request as too large; split it  |
| `NeedsOcr`                                                                                        | 422                             | no text layer                                            |
| `DocumentTooLarge`, `DocumentUnreachable`, `UnsupportedDocument`, `PdfEncrypted`, `PdfUnreadable` | 413, 400/502, 400/415, 422, 422 | the document could not be read                           |

## Privacy

- The document (or result) is held in memory for the request only. FactLot stores nothing: no
  page text, quote, fact, figure or prose is written to storage, and none reaches a log. The only
  log line is `{tool, outcome, model, pages, attempts, input_tokens, output_tokens, latency_ms}`.
- For these two tools only, FactLot sends the page text (or the result) to a model provider's API
  (named in the [privacy notice](https://factlot.com/privacy); United States) for model inference,
  through a commercial organization, and every request asks for inference in the United States
  (`inference_geo: "us"`). Under its commercial terms the provider does not train models on API
  inputs, and under its published API retention policy it deletes API inputs and outputs within 30
  days of receipt or generation, unless it must keep them longer by law or to enforce its usage
  policy (flagged inputs and outputs up to 2 years). The PDF file itself is not sent; its text is.
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
`isError: true`. An MCP request with a PDF may be up to 15 MB; every other MCP request keeps the
1 MB limit.
