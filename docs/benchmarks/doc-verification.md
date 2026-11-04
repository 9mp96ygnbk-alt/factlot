# Benchmark: document verification accuracy (`doc_verify_facts`)

This page reports one run of the benchmark planned in
[`bench/doc-accuracy/PLAN.md`](../../bench/doc-accuracy/PLAN.md). It measures how well FactLot's
`doc_verify_facts` tool separates correct extracted lease values from wrong ones. Every figure
below comes from `bench/doc-accuracy/results/scores.json` (tables rendered by
`bench/doc-accuracy/report.py`); nothing was typed in by hand.

In short: on 158 candidates from one extraction pass over 20 EDGAR leases, 95 of the 114
verified values matched the labels (83.3%, Wilson 95% 75.4–89.1%). FactLot held back 3 of 22 wrong
values (13.6%, 4.7–33.3%) and held back 18 of 113 correct values (15.9%, 10.3–23.8%). Of the
wrong values it verified, 18 of 19 are party names that the extractor wrote with a trailing
entity descriptor (", a Delaware corporation"). The quote contains that text, so FactLot passes
it, and the pre-registered matching rule counts it as wrong. Of 176 distinct labelled terms, 90
(51.1%, 43.8–58.4%) ended up with a verified correct candidate. Every planted error was caught:
74 of 74 altered values (95.1–100%) and 77 of 77 altered quotes (95.2–100%). The planted test
only reached parts of a value that the verifier compares with its quote (see
[Planted errors](#planted-errors)).

## Method

- **Tool under test:** `factlot.run_tool("doc_verify_facts", ...)` from the Python SDK in
  `python/src` (factlot 0.2.0; the last commit touching `python/src` is `e2c5e63`). It runs
  offline and uses no model. One call per document, `as_of` `2026-11-03`, `document.sha256` set to
  the manifest file hash. `run.py` checks each document's split-page hash against the manifest
  before every call.
- **What the verifier does** (PLAN.md, top section): per candidate it checks the value shape, then
  that the quote is on the cited page (at least 12 characters after normalization), then that the
  checkable numbers and dates in the value are written in the quote, then confidence. The first
  failure puts the candidate in `rejected` (shape, quote) or `needs_review` (consistency,
  confidence). Only `verified` counts as verified.
- **Matching** (PLAN.md section 9): a candidate is compared with the labels of the same document
  and predicate. Dates must be identical; numbers are equal by value or at two decimals; names and
  strings are equal after NFKC, quote normalization, whitespace collapse and case folding; objects
  are compared only on the scored fields listed in the plan (free-text fields are not compared).
  A field missing on one side and present on the other is a mismatch.
- **Candidate classes.** `correct`: matches a label. `wrong`: the predicate is labelled on that
  document but no label has the candidate's value. `unlabeled`: the predicate has no label on that
  document. These are left out of precision, catch rate, false-rejection rate and coverage, and are
  counted by outcome below; a sensitivity line counts the verified ones as wrong. `summary`
  (`lease.rofr`, `lease.rofo`, `lease.exclusive_use`, `lease.assignment_sublease`): the
  verifier only type-checks the text, so these are not scored and are counted by outcome only.
- **Metrics:** (a) precision of verified = correct verified / (correct + wrong) verified;
  (b) catch rate = wrong not verified / wrong; (c) false-rejection rate = correct not verified /
  correct, split into sent to review and rejected; (d) coverage = distinct non-summary labels with
  at least one verified correct candidate / all distinct non-summary labels, including labels on
  documents with no candidates. Coverage is a joint extractor-and-verifier figure, not verifier
  recall. Intervals are 95% Wilson score intervals. Rates are not averaged into one number.
- **Freeze.** The labels are those at commit `a978b85766f5c7e911fc9fe2175dbea0289079a1`, frozen
  by commit `f76cad4` (which adds only `labels/FROZEN.md`). The label files have not changed
  since `a978b85`. No label correction has been made, so there is one set of numbers; if a
  correction is made later, both sets will be reported.

## Data

Twenty SEC EDGAR Exhibit 10 instruments (commercial leases and amendments) filed with 8-K, 10-K
or 10-Q forms. They were selected by the pre-set rules in PLAN.md section 2 from EDGAR full-text
search (filed 2018-01-01 to 2025-12-31, searched 2026-11-03; 56 opened hits were skipped, and the
reason for each is in `manifest.json`). Mix: 8 office, 7 industrial, 5 retail; 15 leases and 5
amendments; 896 split pages in all (5 to 83 per document). "Split pages" are the harness's page
split (PLAN.md section 5), not printed pages. No lease text is in this page. The repository holds
only the short label and candidate quotes.

| Id | Filer | Form | Filed | Exhibit | Property | Kind | Split pages | Labels | Candidates |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| L01 | Square, Inc. | 10-Q | 2018-08-01 | EX-10.6 | office | amendment | 7 | 10 | 8 |
| L02 | DROPBOX, INC. | 10-K | 2024-02-16 | EX-10.24 | office | amendment | 20 | 25 | 12 |
| L03 | Okta, Inc. | 10-K | 2021-03-04 | EX-10.9.2 | office | amendment | 6 | 11 | 9 |
| L04 | Dragonfly Energy Holdings Corp. | 10-K | 2023-04-17 | EX-10.35 | industrial | amendment | 5 | 12 | 8 |
| L05 | Hyliion Holdings Corp. | 10-K | 2022-02-24 | EX-10.14 | industrial | amendment | 17 | 7 | 5 |
| L06 | Allogene Therapeutics, Inc. | 10-K | 2019-03-08 | EX-10.17 | office | lease | 73 | 12 | 10 |
| L07 | Adverum Biotechnologies, Inc. | 10-Q | 2018-08-08 | EX-10.2 | office | lease | 74 | 9 | 6 |
| L08 | HEALTHEQUITY, INC. | 8-K | 2020-01-27 | EX-10.1 | office | lease | 39 | 13 | 10 |
| L09 | MYRIAD GENETICS INC | 10-K | 2024-02-28 | EX-10.5 | office | lease | 83 | 9 | 8 |
| L10 | Forge Global Holdings, Inc. | 8-K | 2022-03-25 | EX-10.2 | office | lease | 67 | 11 | 10 |
| L11 | ORASURE TECHNOLOGIES INC | 10-K | 2022-03-01 | EX-10.30 | industrial | lease | 36 | 9 | 0 |
| L12 | Thorne Healthtech, Inc. | 10-Q | 2021-11-10 | EX-10.1 | industrial | lease | 57 | 7 | 7 |
| L13 | SCANSOURCE, INC. | 10-K | 2021-08-24 | EX-10.40 | industrial | lease | 29 | 6 | 0 |
| L14 | Sow Good Inc. | 8-K | 2024-05-29 | EX-10.1 | industrial | lease | 50 | 11 | 12 |
| L15 | Solid Power, Inc. | 8-K | 2021-12-13 | EX-10.21 | industrial | lease | 62 | 11 | 8 |
| L16 | Cinemark Holdings, Inc. | 10-K | 2018-02-23 | EX-10.28(A) | retail | lease | 65 | 10 | 13 |
| L17 | GENERATION INCOME PROPERTIES, INC. | 10-Q | 2022-05-16 | EX-10.4 | retail | lease | 69 | 11 | 6 |
| L18 | Natural Grocers by Vitamin Cottage, Inc. | 10-Q | 2025-05-08 | EX-10.1 | retail | lease | 35 | 8 | 14 |
| L19 | Prime Meridian Holding Co | 8-K | 2018-08-07 | EX-10.1 | retail | lease | 53 | 6 | 5 |
| L20 | Allied Esports Entertainment, Inc. | 8-K | 2019-08-15 | EX-10.36 | retail | lease | 49 | 8 | 7 |

Labels: 206 in all, 23 of them summary predicates. After removing summaries and same-value
duplicates inside a document, 176 distinct labelled terms are scored for coverage.

## Who labelled and who extracted

The same AI operator did the labelling and the extraction, on behalf of the FactLot maintainers,
in separate sessions. The labelling session wrote and froze `labels/` before any candidate
existed. The extraction session did not open `labels/` and ran the extractor blind: the shipped
FactLot extractor prompt (`python/src/factlot/ingest/extract.py`), sent once per lease through the
grok CLI (model `grok-4.7`) in headless mode. The CLI ran from an empty directory under a
kernel-enforced sandbox that denied the repository and the cache, with its file, shell, web and
subagent tools removed, so the prompt was its only input. Details are in
[`candidates/README.md`](../../bench/doc-accuracy/candidates/README.md). The scoring run on
this page came after both and saw both. One extractor, one pass, 158 candidates. Candidate files
were not edited.

Because one operator wrote both labels and candidates, label–candidate agreement is not
independent evidence that a value is right (PLAN.md section 10). The planted-error pass is the
check that does not depend on that agreement.

## Results

| Metric | k/n | Rate | Wilson 95% |
| --- | --- | --- | --- |
| Precision of verified | 95/114 | 83.3% | 75.4–89.1% |
| Precision of verified, unlabeled verified counted wrong | 95/116 | 81.9% | 73.9–87.8% |
| Catch rate (wrong values not verified) | 3/22 | 13.6% | 4.7–33.3% |
| False-rejection rate (correct values not verified) | 18/113 | 15.9% | 10.3–23.8% |
|   of which sent to review | 15/113 | 13.3% | 8.2–20.8% |
|   of which rejected | 3/113 | 2.7% | 0.9–7.5% |
| Coverage (labels with a verified correct candidate) | 90/176 | 51.1% | 43.8–58.4% |
| Coverage, excluding L11 and L13 | 90/163 | 55.2% | 47.5–62.6% |
| Planted [quote_digit] catch, original verified | 77/77 | 100.0% | 95.2–100.0% |
| Planted [quote_digit] catch, all copies | 94/94 | 100.0% | 96.1–100.0% |
| Planted [value] catch, original verified | 74/74 | 100.0% | 95.1–100.0% |
| Planted [value] catch, all copies | 92/92 | 100.0% | 96.0–100.0% |

Candidate breakdown (158): 113 correct, 22 wrong, 8 unlabeled, 15 summary.

- Correct (113): 95 verified, 15 sent to review, 3 rejected.
- Wrong (22): 19 verified, 3 sent to review, 0 rejected.
- Unlabeled (8), not in the rates above: 2 verified, 2 sent to review, 4 rejected. Counting the 2
  verified ones as wrong gives the second precision row (95/116).
- Summary (15), not scored: 13 verified, 2 rejected.
- Coverage (176 distinct labels): 90 have a verified correct candidate; 18 have a correct
  candidate that was not verified; 36 have only candidates with another value (18 of them are the
  party names described below); 32 were never proposed, 13 of which are on L11 and L13.

**What the wrong verified values are.** 18 of the 19 are `lease.landlord` and `lease.tenant`
values written with the entity descriptor from the preamble ("X LLC, a Delaware limited liability
company"), where the label has the bare name. The quote contains the whole string, so the
verifier passes it, and the pre-registered string rule counts it as a different value. The 19th is
an L16 `lease.parking` value that leaves out the `rate_monthly` field, which the label records as
0. Under the plan's rule a field present on one side only is a mismatch. The verifier does not
check names against a canonical form and does not check that an object has all its fields, so
under these rules it cannot catch either kind.

**What was caught.** The 3 wrong values held back were all sent to review by the consistency
check: an L08 base-rent schedule with different rent amounts than the label (the review reason
names a step date that is not in the quote), an L16 co-tenancy value whose cure period is not in
the quote, and an L14 renewal option whose wrong field is a notice period the label does not
have. In that last case the review reason names the term length, which is a different field.
No wrong value was rejected outright.

**What was falsely held back.** Of the 15 correct values sent to review, 8 are renewal options
(the term in months, or in one case the notice period, is not written as that number in the
quote), 3 are base-rent schedules (a step date not in the quote), 3 are free-rent values (the
month count not in the quote), and 1 is a percentage-rent breakpoint. All 3 correct values
rejected outright had a quote shorter than the 12-character minimum (two pro rata shares, one
security deposit). No correct `lease.renewal_option` was verified (0 of 8).

### Post-hoc sensitivity: party-name descriptor stripped

This is not in PLAN.md and was added after the primary scores were seen. `lease.landlord`,
`lease.tenant` and a guaranty's guarantor are compared after dropping a trailing
", a/an <...> company|corporation|partnership|trust|association" from both sides. Everything else
is unchanged. This sensitivity changes only the party-name results, so read it as a description
of those 18 candidates, not as a second headline.

| Metric | k/n | Rate | Wilson 95% |
| --- | --- | --- | --- |
| Precision of verified | 113/114 | 99.1% | 95.2–99.8% |
| Precision of verified, unlabeled verified counted wrong | 113/116 | 97.4% | 92.7–99.1% |
| Catch rate (wrong values not verified) | 3/4 | 75.0% | 30.1–95.4% |
| False-rejection rate (correct values not verified) | 18/131 | 13.7% | 8.9–20.7% |
|   of which sent to review | 15/131 | 11.5% | 7.1–18.0% |
|   of which rejected | 3/131 | 2.3% | 0.8–6.5% |
| Coverage (labels with a verified correct candidate) | 108/176 | 61.4% | 54.0–68.2% |
| Coverage, excluding L11 and L13 | 108/163 | 66.3% | 58.7–73.1% |

### Per predicate (strict)

V = verified, R = sent to review (`needs_review`), X = rejected. "Labels" is distinct non-summary
labels; "Covered" is how many of them have a verified correct candidate. Precision, catch and
false rejection are k/n with the Wilson 95% interval. Most cells are tiny, so read them as counts.

| Predicate | Labels | Covered | Correct V / R / X | Wrong V / R / X | Unlabeled V / R / X | Precision | Catch | False rejection |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `lease.base_rent_schedule` | 10 | 4 | 4 / 3 / 0 | 0 / 1 / 0 | 0 / 1 / 2 | 4/4 (51–100%) | 1/1 (21–100%) | 3/7 (16–75%) |
| `lease.cam_cap` | 4 | 3 | 3 / 0 / 0 | 0 / 0 / 0 | 0 / 0 / 0 | 3/3 (44–100%) | – | 0/3 (0–56%) |
| `lease.co_tenancy` | 1 | 0 | 0 / 0 / 0 | 0 / 1 / 0 | 0 / 0 / 0 | – | 1/1 (21–100%) | – |
| `lease.commencement_date` | 5 | 5 | 5 / 0 / 0 | 0 / 0 / 0 | 1 / 0 / 0 | 5/5 (57–100%) | – | 0/5 (0–43%) |
| `lease.expiration_date` | 10 | 7 | 7 / 0 / 0 | 0 / 0 / 0 | 0 / 0 / 0 | 7/7 (65–100%) | – | 0/7 (0–35%) |
| `lease.free_rent` | 7 | 2 | 2 / 3 / 0 | 0 / 0 / 0 | 1 / 0 / 0 | 2/2 (34–100%) | – | 3/5 (23–88%) |
| `lease.guaranty` | 2 | 0 | 0 / 0 / 0 | 0 / 0 / 0 | 0 / 0 / 0 | – | – | – |
| `lease.landlord` | 21 | 9 | 11 / 0 / 0 | 9 / 0 / 0 | 0 / 0 / 0 | 11/20 (34–74%) | 0/9 (0–30%) | 0/11 (0–26%) |
| `lease.operating_expense_base_year` | 2 | 2 | 2 / 0 / 0 | 0 / 0 / 0 | 0 / 0 / 0 | 2/2 (34–100%) | – | 0/2 (0–66%) |
| `lease.parking` | 9 | 7 | 7 / 0 / 0 | 1 / 0 / 0 | 0 / 0 / 0 | 7/8 (53–98%) | 0/1 (0–79%) | 0/7 (0–35%) |
| `lease.percentage_rent` | 2 | 1 | 1 / 1 / 0 | 0 / 0 / 0 | 0 / 0 / 0 | 1/1 (21–100%) | – | 1/2 (9–91%) |
| `lease.pro_rata_share` | 23 | 12 | 13 / 0 / 2 | 0 / 0 / 0 | 0 / 0 / 0 | 13/13 (77–100%) | – | 2/15 (4–38%) |
| `lease.renewal_option` | 14 | 0 | 0 / 8 / 0 | 0 / 1 / 0 | 0 / 0 / 0 | – | 1/1 (21–100%) | 8/8 (68–100%) |
| `lease.rent_commencement_date` | 2 | 0 | 0 / 0 / 0 | 0 / 0 / 0 | 0 / 0 / 1 | – | – | – |
| `lease.rentable_area_sf` | 32 | 20 | 21 / 0 / 0 | 0 / 0 / 0 | 0 / 0 / 0 | 21/21 (85–100%) | – | 0/21 (0–15%) |
| `lease.security_deposit` | 12 | 9 | 9 / 0 / 1 | 0 / 0 / 0 | 0 / 0 / 1 | 9/9 (70–100%) | – | 1/10 (2–40%) |
| `lease.tenant` | 20 | 9 | 10 / 0 / 0 | 9 / 0 / 0 | 0 / 0 / 0 | 10/19 (32–73%) | 0/9 (0–30%) | 0/10 (0–28%) |
| `lease.termination_option` | 0 | 0 | 0 / 0 / 0 | 0 / 0 / 0 | 0 / 1 / 0 | – | – | – |

## Planted errors

Two kinds of copies were made of the 113 correct candidates. The copy records are in
`bench/doc-accuracy/planted/` and the outcomes in `results/planted-outcomes.json`. Copies are
only scored, never added to `candidates/`.

- **`value`** (the PLAN.md rule; deterministic, no seed): the quote stays as emitted and the
  first number or date in the value changes (a date moves one day later; a ratio changes by 0.01;
  an integer below 100 gains 1; an integer of 100 or more becomes round(1.1 n); any other number
  gains 1). 92 copies; the 21 correct party names have no number or date and are not copied.
- **`quote_digit`** (exploratory, not in PLAN.md; seed `20261103`): the value stays as emitted
  and one digit of one number in the quote changes, as a misquote would. 94 copies (correct
  candidates whose quote has a digit).

The headline rate uses copies whose original candidate was verified, because a copy of a
candidate that was already held back is held back for the original reason.

Error type for `value` copies: `number_in_quote` means the verifier compares the altered part with
the quote and the original number or date is written there. `value_only` means the part is not
compared, or its original value is not in the quote.

#### quote_digit

Outcomes when the original was verified: {"verified": 0, "needs_review": 0, "rejected": 77}

| Breakdown | Group | Caught / planted (original verified) | Rate | Wilson 95% | Caught / planted (all) |
| --- | --- | --- | --- | --- | --- |
| predicate | lease.base_rent_schedule | 4/4 | 100.0% | 51.0–100.0% | 7/7 |
| predicate | lease.cam_cap | 3/3 | 100.0% | 43.8–100.0% | 3/3 |
| predicate | lease.commencement_date | 5/5 | 100.0% | 56.6–100.0% | 5/5 |
| predicate | lease.expiration_date | 7/7 | 100.0% | 64.6–100.0% | 7/7 |
| predicate | lease.free_rent | 2/2 | 100.0% | 34.2–100.0% | 4/4 |
| predicate | lease.landlord | 2/2 | 100.0% | 34.2–100.0% | 2/2 |
| predicate | lease.operating_expense_base_year | 2/2 | 100.0% | 34.2–100.0% | 2/2 |
| predicate | lease.parking | 7/7 | 100.0% | 64.6–100.0% | 7/7 |
| predicate | lease.percentage_rent | 1/1 | 100.0% | 20.7–100.0% | 2/2 |
| predicate | lease.pro_rata_share | 13/13 | 100.0% | 77.2–100.0% | 15/15 |
| predicate | lease.renewal_option | 0/0 | n/a | n/a | 8/8 |
| predicate | lease.rentable_area_sf | 21/21 | 100.0% | 84.5–100.0% | 21/21 |
| predicate | lease.security_deposit | 9/9 | 100.0% | 70.1–100.0% | 10/10 |
| predicate | lease.tenant | 1/1 | 100.0% | 20.7–100.0% | 1/1 |

#### value

Outcomes when the original was verified: {"verified": 0, "needs_review": 68, "rejected": 6}

| Breakdown | Group | Caught / planted (original verified) | Rate | Wilson 95% | Caught / planted (all) |
| --- | --- | --- | --- | --- | --- |
| error_type | number_in_quote | 74/74 | 100.0% | 95.1–100.0% | 86/86 |
| error_type | value_only | 0/0 | n/a | n/a | 6/6 |
| leaf_kind | date | 16/16 | 100.0% | 80.6–100.0% | 19/19 |
| leaf_kind | integer_ge_100 | 31/31 | 100.0% | 89.0–100.0% | 32/32 |
| leaf_kind | integer_lt_100 | 9/9 | 100.0% | 70.1–100.0% | 19/19 |
| leaf_kind | other_number | 5/5 | 100.0% | 56.6–100.0% | 6/6 |
| leaf_kind | ratio | 13/13 | 100.0% | 77.2–100.0% | 16/16 |
| planted_value_in_quote | False | 74/74 | 100.0% | 95.1–100.0% | 89/89 |
| planted_value_in_quote | True | 0/0 | n/a | n/a | 3/3 |
| predicate | lease.base_rent_schedule | 4/4 | 100.0% | 51.0–100.0% | 7/7 |
| predicate | lease.cam_cap | 3/3 | 100.0% | 43.8–100.0% | 3/3 |
| predicate | lease.commencement_date | 5/5 | 100.0% | 56.6–100.0% | 5/5 |
| predicate | lease.expiration_date | 7/7 | 100.0% | 64.6–100.0% | 7/7 |
| predicate | lease.free_rent | 2/2 | 100.0% | 34.2–100.0% | 5/5 |
| predicate | lease.operating_expense_base_year | 2/2 | 100.0% | 34.2–100.0% | 2/2 |
| predicate | lease.parking | 7/7 | 100.0% | 64.6–100.0% | 7/7 |
| predicate | lease.percentage_rent | 1/1 | 100.0% | 20.7–100.0% | 2/2 |
| predicate | lease.pro_rata_share | 13/13 | 100.0% | 77.2–100.0% | 15/15 |
| predicate | lease.renewal_option | 0/0 | n/a | n/a | 8/8 |
| predicate | lease.rentable_area_sf | 21/21 | 100.0% | 84.5–100.0% | 21/21 |
| predicate | lease.security_deposit | 9/9 | 100.0% | 70.1–100.0% | 10/10 |

How to read this:

- All 74 `value` copies of verified candidates were caught. 68 went to review because the altered
  number or date is not in the quote. 6 were rejected by the value-shape check because the planted
  value was impossible: four pro rata shares of 1 became 2 (the rule treats 1 as an integer), and
  two base years became 2221 and 2222 (the round(1.1 n) rule). Those 6 say nothing about the quote
  check.
- Every `value` copy of a verified candidate was the `number_in_quote` type. A verified candidate
  has all its compared parts written in its quote, and the rule alters a compared part first. The
  6 `value_only` copies all came from candidates already in review. So this pass did not test
  errors in parts the verifier does not compare (enums, free text, missing fields, party-name
  form), which is where all 19 natural wrong verified values sit.
- No planted value in a verified copy happened to appear in its quote as well. If it had, the
  consistency check would have passed it (3 such copies exist, all of candidates already in review).
- All 77 `quote_digit` copies of verified candidates were rejected by the quote-on-page check.
  None matched text elsewhere in the document.

## Limitations

- **Small sample.** 20 documents, 158 candidates, 22 wrong values. The catch-rate interval runs
  from 4.7% to 33.3%. Most per-predicate cells have fewer than 10 items. EDGAR exhibits filed by
  public companies are not a random sample of leases, and these rates are not rates for leases in
  general.
- **One extractor, one pass.** One model through one CLI, run once per lease with the shipped
  prompt. Another extractor, prompt or pass would make different mistakes, and precision and catch
  rate depend on which mistakes it makes. For example, the 18 party names drive most of the strict
  precision gap.
- **L11 and L13 returned zero candidates.** The extractor returned `{"facts": []}` for L11 and
  only empty objects for L13 in its single pass. They were not re-run, because a re-run would be a
  second extraction. Their 13 distinct non-summary labels (15 labels in all) count as extractor
  misses in coverage: 90/176 with them, 90/163 without. They add nothing to precision, catch rate or
  false-rejection rate.
- **Textual checks only.** The verifier checks that the quote is on the page and that the
  value's numbers and dates are written in it. It does not check meaning. A quote that states the
  right number for a different term passes. Enums, free-text fields, party-name form and missing
  object fields are not checked.
- **Labels were drafted against `check-labels`.** Before the freeze, `run.py check-labels` (the
  verifier's quote-on-page and minimum-length rules) ran on the labels. That led to page-citation
  fixes and, in L06, two quotes lengthened with more verbatim text. Values were not changed to
  pass. The labels may still lean toward values with a short quotable sentence, which can favour
  the verifier (PLAN.md section 10). On the frozen labels the verifier itself gives 175 verified,
  31 needs_review and 0 rejected. The 31 are labels whose value is not written as such in the
  quote: 14 renewal options, 6 base-rent schedules, 4 free rent, 3 parking, 2 percentage rent,
  1 co-tenancy and 1 expiration date.
- **Labelling judgment calls.** One labeller, no second annotator, no agreement measured. Some
  calls affect the scores. 5 `lease.security_deposit` labels (L03, L06, L09, L10, L14) have a
  quote about a letter of credit, which was counted as the deposit. Some values are derived rather
  than read from the quote: for example, the one expiration-date label the verifier sends to review
  is computed from the term, and the renewal-option and base-rent labels in the 31 above carry
  months or dates that are not written as such in their quotes. Party names are labelled without
  the entity descriptor, and the L16 parking label records `rate_monthly` 0. A different labeller
  could reasonably call several "wrong" values here correct, and the reverse.
- **Same operator.** The labeller and the extractor were the same AI operator, in separate
  sandboxed sessions, and can share a misreading. Planted errors are synthetic and easier than
  natural ones: one number changes and the quote is left as written.
- **Post-hoc analysis.** The party-name sensitivity and the `quote_digit` variant were not
  pre-registered.
- **Each amendment is scored alone.** `doc_abstract_lease` was not run, and terms changed by a
  later amendment are not rolled forward.

## Harness fixes made in this run

Made in `bench/doc-accuracy/` before the results were committed (commits `f668b3c`, `5c4cf1a`):

- Coverage now counts the labels of documents with no candidates. Before, `score` skipped L11 and
  L13 entirely, which would have reported coverage as 90/163 instead of 90/176.
- A boolean no longer equals a number in matching (`True == 1` was treated as a match). No
  candidate was affected.
- A document over a tool limit is recorded as an error in the results instead of stopping the run
  (PLAN.md section 9). None occurred.
- The planted pass checks each document's page hash, as the main pass does.
- Planted copies are written to `planted/` and checked against the rule on every `score`. Results
  carry the command, repository revision, factlot version and source commit, `as_of`, the label
  freeze and the seed. There are now per-predicate rates with intervals, a coverage breakdown, and
  the label and data statistics used on this page.

The planted `value` rule itself was left as pre-registered, although it produces impossible
values for a pro rata share of 1 and for base years (see above).

## Reproduce

The lease text is not in the repository. `fetch` downloads it from sec.gov (serial, at most two
requests per second, declared User-Agent) into `/workspace/factlot-bench-cache/` (or
`$FACTLOT_BENCH_CACHE`) and checks each file's sha256 against the manifest.

```sh
python3 bench/doc-accuracy/run.py fetch
python3 bench/doc-accuracy/run.py pages        # every document must match its manifest text_sha256
python3 bench/doc-accuracy/run.py test
python3 bench/doc-accuracy/run.py verify
python3 bench/doc-accuracy/run.py plant --seed 20261103
python3 bench/doc-accuracy/run.py score
python3 bench/doc-accuracy/report.py           # the tables on this page
```

The verifier uses no model and no network, so the same pages, candidates and code give the same
results. Re-running the steps above gave byte-identical results apart from the recorded
repository revision.

Run metadata from `results/scores.json`:

- repo_head: `5c4cf1a22e2d016921927b841f79ae1733156c9a`
- worktree_dirty: `False`
- factlot_version: `0.2.0`
- factlot_src_commit: `e2c5e63bb11dcf20415cefe9c538450feedb28d7`
- as_of: `2026-11-03`
- labels_frozen_at: `a978b85766f5c7e911fc9fe2175dbea0289079a1`
- python: `3.13.5`
- verify command: `python3 bench/doc-accuracy/run.py verify`
- plant (value) command: `python3 bench/doc-accuracy/run.py plant --seed 20261103`
- plant (quote_digit) command: `python3 bench/doc-accuracy/run.py plant --seed 20261103`, seed `20261103`
- score command: `python3 bench/doc-accuracy/run.py score`
- documents with no candidates: L11, L13
- documents with a verifier error: none
