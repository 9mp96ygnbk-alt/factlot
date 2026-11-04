# Planted-error copies

Written by `python3 bench/doc-accuracy/run.py plant --seed 20261103`. `run.py score` rebuilds both
files from `candidates/` and `labels/` and stops if they differ, then runs `doc_verify_facts` on the
copies. Outcomes are in `results/planted-outcomes.json`. Nothing here is written into `candidates/`.
Each record names the document and the candidate index; no lease text is stored (the quote-digit
variant records a character offset and the two digits).

Only candidates that match a label (`correct`) are copied.

## `value.json`: the PLAN.md rule (deterministic, no seed)

Quote, page, predicate and section stay as emitted. The first number or date in the value changes
(PLAN.md section 9): a date moves one day later; a non-integer in (0, 1] gains 0.01 (or loses 0.01
if it would pass 1); an integer below 100 gains 1; an integer of 100 or more becomes
`round(1.1 n)`; any other number gains 1. Party names (no number or date) are not copied.

Fields per record: `path` (the altered part), `original_part`, `planted_part`, `planted_value`
(the whole altered value), `leaf_kind` (date, ratio, integer_lt_100, integer_ge_100,
other_number), and the error type:

- `number_in_quote`: the verifier compares the altered part with the quote, and the original
  value of that part is written in the quote;
- `value_only`: the part is not compared with the quote, or its original value is not found there.

`planted_value_in_quote` is true when the altered number or date also happens to be in the quote.

## `quote_digit.json`: exploratory variant, not in PLAN.md (seeded)

The value stays as emitted; one digit of one number in the quote changes (a misquote). For each
correct candidate whose quote has a digit, `random.Random(f"{seed}:{doc}:{candidate}")` picks the
digit run, the position inside it and the new digit (never the old one). Seed: `20261103`.
