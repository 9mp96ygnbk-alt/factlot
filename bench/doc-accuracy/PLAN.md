# Plan: doc_verify_facts accuracy

Measurement plan for `bench/doc-accuracy`. `run.py` in this directory calls `factlot.docverify.verify_facts` (the `doc_verify_facts` tool) on the local machine. The verifier runs no model. The same pages, the same candidates, and the same code return the same buckets.

`verify_facts` takes `{document: {pages, sha256?, title?}, candidates: [{predicate, value, quote, page, section?, confidence?}], as_of}` and returns `{document, verified, needs_review, rejected, summary}`. Each candidate stops at the first failing check, in this order: Ingest value shape (`rejected`, check `value`); quote on the page (`rejected`, check `quote`); checkable parts of the value written in the quote (`needs_review`, check `consistency`); `confidence` below 0.8 (`needs_review`, check `confidence`). A quote of fewer than 12 characters after normalization is rejected. A quote found on exactly one other page can still be verified; the item notes the page correction. A quote found on several other pages, or only after a line-break hyphen is rejoined, is rejected. A verified item is `{candidate, fact, checked, not_checked, notes?}`. A review item is `{candidate, predicate, value, quote, page, check, reason}`. A rejection is `{candidate, predicate, value, page, check, reason}`. `summary` counts candidates, verified, needs_review, and rejected.

Scoring treats membership in `verified` as verified. `needs_review` and `rejected` are not verified. The page-correction note does not change the bucket. Each call uses `as_of` `2026-11-03` and passes the manifest file hash as `document.sha256`. `as_of` is stored on the fact. It does not change the checks. The tool does not prove the pages came from that file; `run.py` checks `text_sha256` before scoring.

## 1. Goal

Measure how well `doc_verify_facts` separates correct extracted lease values from wrong ones.

The measurement is of the verifier. A separate extractor proposes candidates. FactLot does not look for terms the extractor missed. A label with no candidate is an extractor miss, and it is not a verifier error. Precision, catch rate, and false-rejection rate are computed on candidates. Coverage is reported as a joint figure and read that way (section 9).

## 2. Data selection

Twenty SEC EDGAR Exhibit 10 instruments filed by public companies: commercial leases and lease amendments. The target mix is office, industrial, and retail, with five amendments. Parties are companies. The set excludes residential leases and ground leases between individuals. Files are text-layer HTML or TXT. Scanned PDFs and image-only filings are excluded.

Candidates come from EDGAR full-text search (`efts.sec.gov/LATEST/search-index`), forms 8-K, 10-K and 10-Q, filed 2018-01-01 through 2025-12-31, one query per property type plus one for amendments (the exact query strings are stored in `manifest.json` under `search`). Hits are taken in the order the search returns them; only hits whose file type is `EX-10.*` are considered.

Acceptance is fixed before any label is written and before any score exists. A document is accepted when all of the following hold:

- The exhibit body is HTML or plain text with a text layer.
- The instrument is a commercial lease (`doc_kind: lease`) or an amendment of one (`doc_kind: amendment`), not a sublease consent, guaranty alone, or purchase agreement.
- The landlord and tenant are companies.
- The premises are `office`, `industrial` (warehouse, manufacturing, lab/flex), or `retail`; `other` only when the use is commercial and none of the three is stated.
- At most one document per filer, and the split text is under 400,000 characters (so labeling stays feasible).

Caps: 20 documents, about 5 amendments, at most 8 of any one `property_type`, at least 4 of each of office, industrial and retail. A rule is not relaxed to fill a slot; a shortfall is recorded.

Ids are `L01` through `L20`. Every skipped hit that was opened is stored with the rule that excluded it. An accepted document is not removed because of how the verifier treats it. `property_type` and `doc_kind` are set at selection and stay as recorded.

`manifest.json` stores the query text, the date of the search, and the skip list beside the documents.

## 3. Fair access

The User-Agent is `FactLot doc-accuracy benchmark contact@factlot.com`. Requests are serial, one at a time, at most two per second (at least 0.5 seconds between them). Only `sec.gov` and `efts.sec.gov` URLs are requested. The request asks for identity encoding. `sha256` is the hash of those response bytes.

On HTTP 403, 429, or 503 the same URL is retried after 10, 20, 40, 80 and 160 seconds (six attempts in all). After that the run stops with an error. Another document is not fetched in its place to get around the limit.

The cache is `/workspace/factlot-bench-cache/`, outside the repository. Raw bodies, split pages, and the request log stay there. Full lease text is not committed. The only lease wording in the repository is the short label quotes in section 6.

## 4. Manifest

`bench/doc-accuracy/manifest.json`. Top-level keys are `search` (queries, forms, `filed_from`, `filed_to`, `searched_on`, `skipped`) and `documents`. Each document has exactly these fields:

| Field | Meaning |
| --- | --- |
| `id` | `L01` … `L20` in acceptance order |
| `company` | Filer name |
| `cik` | Filer CIK |
| `form` | Filing form type |
| `filing_date` | `YYYY-MM-DD` |
| `accession` | Accession number |
| `exhibit` | Exhibit id, such as `EX-10.1` |
| `url` | URL of the downloaded exhibit |
| `property_type` | `office`, `industrial`, `retail`, or `other` |
| `doc_kind` | `lease` or `amendment` |
| `sha256` | SHA-256 hex of the downloaded bytes |
| `pages` | Page count after the split in section 5 |
| `text_sha256` | SHA-256 hex of the split pages joined by U+000C |

`pages` and `text_sha256` are written by the splitter, not by hand.

## 5. Page splitting

`run.py` is the only splitter. Labels, extraction, and scoring use its pages. `page` in a label or a candidate is the 1-based index of a split page. It is not a printed page number. The verifier uses the same index.

Bytes are decoded as UTF-8. An undecodable byte becomes U+FFFD.

HTML (URL path ending in `.htm` or `.html`) is converted with the standard-library `html.parser`. Character references are decoded. Text inside `script`, `style`, and `head` is dropped. A form feed is written before an element whose style has `page-break-before: page` or `break-before: page`, after an element whose style has `page-break-after: page` or `break-after: page`, and at each `<hr>`. The text is then split on form feeds. Empty pieces are dropped.

TXT is split on a form feed or a `<PAGE>` marker, compared case-insensitively. Empty pieces are dropped.

A document over 8,000 characters for which the markers give fewer than two pages is packed into pages of at most 4,000 characters on paragraph boundaries. A paragraph is text between blank lines. Paragraphs are added to the current page while the page, counting the blank line between paragraphs, stays at most 4,000 characters. A paragraph longer than 4,000 characters is its own page and is not cut mid-paragraph. A short document stays one page.

Before the hash and the 4,000-character pack, newlines are normalized to `\n`, NBSP becomes a space, spaces and tabs on a line collapse to one space, each line is stripped, and three or more newlines collapse to two.

`text_sha256` is SHA-256 over the UTF-8 bytes of the pages joined by one form feed, with no form feed after the last page. That is the join the verifier uses for a page-text document id.

## 6. Labels

`labels/Lxx.json` is `{doc, labels: [{predicate, value, page, quote}]}`. `doc` is the manifest id.

`predicate` is a predicate from the Ingest table in `docs/ingest.md`. `value` has that predicate's shape: dates are `YYYY-MM-DD`; `lease.pro_rata_share` is a number in `(0, 1]`; each rent step is `{from, to, annual_rent_psf}` with `from` before `to`; the other objects follow the table. For `lease.operating_expense_base_year`, `2026` and `2026.0` are the same JSON number.

`quote` is one sentence or a shorter fragment, copied verbatim from the cited split page. It is not taken from a signature block, a notary block, or an acknowledgment. After the verifier's quote normalization (Unicode NFKC, typographic quotes and dashes to ASCII, each whitespace run to one space, lower case) the quote is at least 12 characters and occurs on the cited page. A match that requires rejoining a hyphenated word does not pass. The quote keeps the hyphen and the line break.

`lease.landlord` and `lease.tenant` are labeled only when that party is a company. `lease.guaranty` is labeled only when the guarantor is a company. A natural person's name is not used as a value or placed in a quote. A predicate that is absent, redacted, or skipped under these rules is omitted. Omission means unlabeled. There is no null value and no "not present" row.

Before the freeze commit, `run.py` runs the quote-on-page rule on every label and requires a match on the cited page with no page correction. A failing label is fixed before that commit.

## 7. Freezing

Labels are committed in git before any file under `candidates/` is produced. That commit SHA is written in `docs/benchmarks/doc-verification.md`. Label files are not edited after the commit.

A correction, if one is needed, is a later commit. The results doc names both SHAs and reports every metric twice, once on the frozen labels and once on the corrected labels. The frozen numbers stay in the doc.

## 8. Extraction

A separate extractor session writes `candidates/Lxx.json`. It receives the split page text and the Ingest predicate list with value shapes. It does not receive labels, the skip list, verifier output, or scores.

The file is `{doc, candidates: [{predicate, value, quote, page, section?, confidence?}]}`, the candidate shape `doc_verify_facts` accepts. `section` and `confidence` are stored only when the extractor emitted them. Nothing is added or stripped afterward. A candidate that passes the other checks and carries `confidence` below 0.8 is `needs_review`. A candidate with no `confidence` is not held for that reason.

The extractor is a model, so its mistakes are natural errors. Candidate files are not hand-edited. Regenerating a file is a new extraction. The results doc names it, and scores for each extraction are reported against the same frozen labels.

## 9. Scoring

`run.py` loads cached pages, checks `text_sha256` against the manifest, and calls `verify_facts` once per document. A document that exceeds a tool limit (2,000 pages, 100,000 characters on a page, 2,000,000 characters in the call, 500 candidates) is an error in the results. It is not truncated and it is not split across calls. It stays in the set.

### Matching

A candidate is matched to labels of the same document by predicate. When more than one label has that predicate, the candidate matches the label with the equal value, if any.

A candidate is correct when its value equals the matched label:

- JSON equality. Object key order does not matter. Lists match element by element. A boolean is not a number.
- Dates are exact `YYYY-MM-DD` strings.
- Numbers match by value (`95000` equals `95000.0`).
- Party names (`lease.landlord`, `lease.tenant`, and the `guarantor` of `lease.guaranty`) and other strings match after NFKC, typographic quotes to ASCII, whitespace collapsed and case folded.
- For object predicates only these fields are compared (missing on both sides counts as equal): `free_rent` months, applies_to; `cam_cap` method, rate; `renewal_option` count, term_months, notice_months; `termination_option` effective_date, notice_months; `percentage_rent` rate, breakpoint; `co_tenancy` cure_period_months; `parking` spaces, rate_monthly; `guaranty` guarantor, cap. Free-text fields (renewal rent, termination fee, co-tenancy trigger and remedy, sales exclusions) are not compared, because two correct readers word them differently. Enums (a cap method, what free rent applies to) are compared even though the verifier does not check them, so a wrong enum shows up as a wrong value the verifier passed.

Summary predicates are `lease.rofr`, `lease.rofo`, `lease.exclusive_use`, and `lease.assignment_sublease`. The verifier only type-checks the string. Summary candidates are left out of correct and wrong and their outcomes are counted on their own; their wording is not scored.

A candidate whose predicate has no label on that document is unlabeled. Unlabeled candidates are left out of precision, catch rate, false-rejection rate, and coverage. Counts by outcome are reported. A sensitivity line puts each unlabeled verified candidate in the precision denominator as wrong.

Each candidate is scored on its own. Duplicate candidates are not merged. A label is covered when at least one verified candidate matches it. Coverage's denominator is every non-summary label, including labels the extractor never proposed. Coverage is joint (a correct proposal that was also verified). It is not verifier recall.

### Metrics

For k successes in n trials, p = k / n, z = 1.96:

- center = (p + z² / (2n)) / (1 + z² / n)
- half-width = z × sqrt( p(1 − p) / n + z² / (4n²) ) / (1 + z² / n)
- the 95% Wilson interval is [center − half-width, center + half-width]

When n is 0, the rate is omitted and no interval is written. Each metric is published with k, n, the rate, and the interval. The rates are not averaged into one number. The results also give, per predicate, counts of correct verified, correct not verified, wrong verified, and wrong not verified.

| Metric | k | n |
| --- | --- | --- |
| Precision of verified | correct and verified | verified candidates that are correct or wrong |
| Catch rate | wrong and not verified | wrong candidates |
| False-rejection rate | correct and not verified | correct candidates |
| False rejection, needs_review | correct and needs_review | correct candidates |
| False rejection, rejected | correct and rejected | correct candidates |
| Coverage | non-summary labels with a verified match | non-summary labels |
| Planted-error catch rate | planted copies not verified | planted copies whose original candidate was verified |

Sensitivity precision uses the same interval. Its k is correct and verified. Its n is the primary precision denominator plus unlabeled verified candidates. The results doc prints this line under the primary precision and says the primary denominator excludes unlabeled candidates.

### Planted errors

For every correct candidate whose value contains a number or a date, `run.py` builds one copy in memory. Quote, page, predicate, section, and confidence stay as emitted. Exactly one number or date changes. The copy is not written into `candidates/`.

The first number or date in the value changes: for a list, the first item that has one; for an object, the first field in the scored-field order above (for `base_rent_schedule` steps: `from`, `to`, `annual_rent_psf` as written).

- A date becomes the next calendar day (`2031-06-30` becomes `2031-07-01`).
- A non-integer number n with `0 < n ≤ 1` (a ratio) becomes `n + 0.01`, or `n − 0.01` if that would pass 1.
- An integer below 100 (months, counts, spaces) becomes `n + 1`; an integer of 100 or more becomes `round(1.1 n)` (95000 becomes 104500).
- Any other number becomes `n + 1` (24.5 becomes 25.5).

A correct candidate with no number and no date (a party name) is not planted. The headline planted catch rate uses copies whose original candidate was verified: a copy of a candidate whose quote was already rejected is rejected for that reason, not because of the alteration. The rate over every planted copy is also reported.

`docs/benchmarks/doc-verification.md` records the label commit SHA, the extractor identity, `as_of`, the factlot revision that ran, and the tables above. It does not contain page text.

## 10. Known limitations

- Twenty documents and a few hundred values. The intervals are wide. A rate here is not a rate for leases in general.
- EDGAR exhibits are not a random sample of leases. Filers are public companies, often large tenants. The text is an HTML or TXT conversion. Redacted terms are unlabeled.
- One person writes the labels. They are not double-annotated. Inter-annotator agreement is not measured.
- The labeler and the extractor can miss the same reading. Agreement between them is not independent evidence. The planted-error pass is a separate test for that reason.
- Planted errors are synthetic. One number or date is changed and the quote is left as written. That is easier than a natural mistake. When the quote already contains the altered number for another reason, the consistency check passes.
- The verifier checks text, not meaning. A quote that states the right number for a different term passes. The docs give the case: "12 months' notice" can support a 12-month term.
- Summary predicates are not checked against the quote. Presence is not accuracy of the wording. Enum fields (a CAM method, what free rent applies to) are scored but not checked by the verifier, so they can only lower precision; free-text fields are not scored at all.
- Split pages are not the printed pages. A citation's page is the split index.
- Each amendment is scored as its own document. `doc_abstract_lease` is not run, and a term changed by a later amendment is not rolled forward.
