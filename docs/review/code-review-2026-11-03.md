# Pre-launch correctness review, 2026-11-03

Scope: whether FactLot gives agents correct, consistent, well-explained answers. That covers the
fourteen calculators in both SDKs, the tool definitions agents read, the rules pack, IDs and fact
validation, the Python registry and ingest, and the docs people follow literally. Security
(server auth, rate limits, input-size caps, collector SSRF, Docker, CI) was reviewed separately
and is not covered here. Branch `code-review`, cut from `main` at `b4d11c9`.

Every expected value added to `spec/vectors` was worked out by hand or with Python `decimal`,
never by running FactLot. Spot checks with `decimal` also confirmed the first existing vector of
`lease_remeasurement_asc842`, `prepayment_and_defeasance` and `hotel_metrics`.

## Summary

| Severity | Found | Fixed | Left (reason given below) |
| -------- | ----- | ----- | ------------------------- |
| High     | 4     | 4     | 0                         |
| Medium   | 14    | 12    | 2                         |
| Low      | 13    | 6     | 7                         |

Three formula versions were bumped:

- `calc.debt_sizing@2`
- `calc.lease_vs_own@2`
- `calc.renew_vs_relocate@2`

The Python registry and ingest have no formula versions; their behaviour changes are listed in
the changelog. Final runs, all passing:

- `npm install`
- `npm run check`
- `npm run test:python` (250 tests)
- `npm run differential -- 1 2000` (4,000 cases, 0 mismatched)

## Commits

| Commit    | What                                                                              |
| --------- | --------------------------------------------------------------------------------- |
| `78e3bd7` | `calc.debt_sizing@2`: round the maximum loan down after removing binary noise     |
| `7c04a4b` | Python IDs and fact validation match TypeScript on edge input                     |
| `2a8afe5` | Tool descriptions: units, rate form and period; Gemini bounds and defaults        |
| `be30a83` | Registry: persons kept out by role and initials; one owner link per reviewed name |
| `5cffc8f` | Ingest: rejections hold on re-run; review, ordering and redaction fixes           |
| `236d6f2` | Docs: snippets that run as written, correct tool counts and surfaces              |
| `291b16b` | Python `run_tool`: same `UnknownTool` message as TypeScript                       |
| `ad75254` | `calc.renew_vs_relocate@2`, `calc.lease_vs_own@2`: warn on unachievable results   |

## Findings

### High

**H1. Debt sizing floors a whole increment short on binary noise.** Fixed in `78e3bd7` (formula
bump).

- Where: `packages/calc/src/debt.ts:151`, `python/src/factlot/calc.py:368`.
- What was wrong: `Math.floor(minLoan / round_down_to)` ran on the raw float.
  `0.57 × 10,000,000` is `5699999.999999999`. So a 57% LTV on $10,000,000, rounded to $1,000,
  returned $5,699,000; rounded to $1, it returned $5,699,999. Any LTV whose product is not exact
  in binary loses one increment. This is the most-used calculator in the feedback round.
- Fix: the quotient is reduced to 15 significant digits before the floor (`reduceNoise` /
  `reduce_noise`, the same reduction `round` uses).
- Vectors: three, at 57%, 29% and 58%.

**H2. Registry stored natural persons' names and mailing addresses.** Fixed in `be30a83`.

- Where: `python/src/factlot/registry/normalize.py:53`.
- What was wrong: `is_organization` read several personal names as organisations:
  - the "CO" of "CO-TRUSTEE", "CO TRS" and "CO-OWNER" as "Company";
  - the middle initials "L P" as "LP";
  - a sole proprietor's trade name after "DBA" as the owner.
- Impact: those owners were stored with their mailing addresses, against data policy §3.
- Fix: only the text before "DBA" counts. "CO" followed by a fiduciary or owner role is a role.
  Bare spaced "L P" counts as initials, while "L.P." with a dot is still a partnership.
- Follow-up: existing registries must be re-ingested to drop these owners.

**H3. A reviewer's rejection did not survive a re-run.** Fixed in `5cffc8f`.

- Where: `python/src/factlot/ingest/pipeline.py:224`.
- What was wrong: when a candidate verified cleanly, it became a fact without checking earlier
  decisions. A rejected item therefore became a fact on the next run if the extractor reported
  higher confidence or the threshold was lowered. Model confidences vary from run to run.

**H4. Python fact validation and URN parsing accepted a trailing newline.** Fixed in `7c04a4b`.

- Where: `python/src/factlot/facts.py:13`, `python/src/factlot/ids.py:164`.
- What was wrong: Python's `$` matches before a final `\n`. So `validate_fact` passed a subject
  `"fl:parcel:…\n"` and a predicate `"lease.base_rent\n"`, and `parse` accepted such a URN.
  TypeScript rejects all three.
- Vectors: added to `spec/vectors/id.json` and `tools.json`.

### Medium

**M1. Python IDs differed from TypeScript on unusual whitespace and digits.** Fixed in
`7c04a4b`.

- Where: `python/src/factlot/ids.py:59-113`.
- What was wrong:
  - A suite with a leading byte-order mark normalized to `suite400` in Python and `400` in
    TypeScript.
  - U+001C was trimmed by Python only.
  - Python's `\d` accepted Arabic-Indic digits, in FIPS codes (a parcel URN TypeScript refuses)
    and in floor numbers.
- Fix: Python now uses the ECMAScript whitespace set and ASCII digits. TypeScript IDs are
  unchanged (rule 4).

**M2. A reviewed owner link and a later exact or standing link could both be current.** Fixed
in `be30a83`.

- Where: `python/src/factlot/registry/store.py:390`.
- What was wrong: the parcel got two owners of record. The reviewer's decision now comes first.
  This is a policy choice; see "Unsure" below.

**M3. Two values for the same (predicate, quote) could both be "accepted".** Fixed in
`5cffc8f`.

- Where: `python/src/factlot/ingest/pipeline.py:301`.
- What was wrong: the second accept placed nothing, because the fact ID hashes the quote and not
  the value, yet it reported success. It is now refused, and the reviewer rejects it instead.

**M4. `lease.cam_cap.rate` had no range check.** Fixed in `5cffc8f`.

- Where: `python/src/factlot/ingest/verify.py:77`.
- What was wrong: a rate of 5 (meaning 5%) passed, and passed the consistency check too. The rate
  is now held to (0, 1] like the other ratios.

**M5. An undated amendment was applied before every dated one.** Fixed in `5cffc8f`.

- Where: `python/src/factlot/ingest/pipeline.py:164`.
- What was wrong: this happened whatever order the amendments were given in. When any amendment is
  undated, amendments now apply in the order given.

**M6. Redacted reports kept rejected candidates' values.** Fixed in `5cffc8f`.

- Where: `python/src/factlot/ingest/retention.py:61`.
- What was wrong: a guarantor's home address refused by the value check stayed in the
  "redacted" file. The test that asserted the old behaviour was updated.

**M7. NPV `rate` and several other fields were ambiguous to an agent.** Fixed in `2a8afe5`.

- Where: `packages/calc/src/*.ts` (descriptions only).
- What was ambiguous:
  - whether a rate is a percent or a decimal;
  - whether TI allowances are one-time or annual;
  - whether `current_rent_monthly` is a total or $/SF;
  - when the first escalation bump lands;
  - that IRR results are decimals.
- Fix: the descriptions now say so.

**M8. Hotel `rooms_out_of_order` was described inconsistently with USALI.** Fixed in `2a8afe5`.

- Where: `packages/calc/src/hotel.ts:23`.
- What was wrong: the description said USALI excludes out-of-order rooms from rooms available,
  but USALI 11th edition keeps short-term out-of-order rooms in. The field also takes room-nights,
  which its name does not suggest.
- Fix: it is now described as room-nights taken off the market, with an example. The arithmetic
  is unchanged.

**M9. Gemini definitions lost exclusive bounds and defaults.** Fixed in `2a8afe5`.

- Where: `packages/tools/src/providers.ts:166`.
- What was wrong: a field documented as `< 1` read as "maximum 1", and Gemini never saw any
  default.
- Fix: both are now stated in the description.

**M10. `renew_vs_relocate` reported a negative break-even rent without a warning.** Fixed in
`ad75254` (formula bump).

- Where: `packages/calc/src/renew_vs_relocate.ts:320`, `python/src/factlot/calc.py:1304`.

**M11. README's Python quick start did not run as written.** Fixed in `236d6f2`.

- Where: `README.md:102-106`.
- What was wrong: `run_tool(..., {...})` passes a set holding `Ellipsis`.

**M12. getting-started overstated what each surface serves.** Fixed in `236d6f2`.

- Where: `docs/getting-started.md:3-8`.
- What was wrong: it said "nine calculators" (there are fourteen) and claimed all three surfaces
  serve the same tools. REST, OpenAPI and the tool exports have no `search`/`fetch`/`schema_get`,
  and they always list the registry tools.

**M13. The same-`as_of` snapshot tie in the registry was left.**

- Where: `python/src/factlot/registry/schema.sql` (`current_facts` view),
  `store.py:334` (`_retire_absent`).
- What is wrong: when two snapshots of one source share an `as_of`, both are current. A corrected
  file republished with the same date therefore leaves two owners current, and retirement ignores
  it.
- Why it was left: the fix needs a load-order column in the view, `facts()` and retirement. It
  must also keep Riverside's two same-date documents (different predicates) current. That is too
  wide a schema change to make hours before launch.
- Workaround: load a corrected file with a later `--as-of`.

**M14. Python input-validation messages differ from TypeScript's.** Left.

- Where: `python/src/factlot/_core.py`.
- What differs: Python reports the first invalid field ("expected number"); TypeScript reports
  every field in zod's wording.
- Why it was left: the error kind, `issues[].path` on the first field, and every domain error
  message already match. Matching zod's text field by field is a larger port.
- Note: MCP, REST and OpenAPI all go through `runTool`, so they already agree with each other.

### Low

**L1. Python `UnknownTool` message quoted differently.** Fixed in `291b16b`.

- Where: `python/src/factlot/tools.py:267`.
- What was wrong: Python used single quotes; TypeScript uses double quotes.

**L2. `lease_vs_own` allowed a loan larger than the cost basis silently.** Fixed in `ad75254`
(formula bump).

- Where: `packages/calc/src/lease_vs_own.ts:575`.
- What was wrong: the loan could exceed purchase price plus closing costs, showing negative
  equity at closing with no comment. It now warns.

**L3. Negated entity statuses read as live.** Fixed in `be30a83`.

- Where: `python/src/factlot/registry/normalize.py:225`.
- What was wrong: "not_in_good_standing" and "unregistered" counted as live. No current adapter
  emits them; they are now undecided.

**L4. A malformed `--amendment file@date` crashed after the model calls.** Fixed in `5cffc8f`.

- Where: `python/src/factlot/ingest/__main__.py:143`.
- Fix: it is now a usage error before any model call.

**L5. `--accept`/`--reject` on a redacted file dropped extras.** Fixed in `5cffc8f`.

- Where: `python/src/factlot/ingest/__main__.py:116`.
- What was wrong: the file lost its `"redacted": true` marker, `unreadable_pages` and
  `evaluation`.

**L6. Doc counts and setup notes were wrong or missing.** Fixed in `236d6f2`.

- `packages/tools/README.md` said 16 core tools; there are 21.
- `docs/agents.md` described `formula` as an `@`-string.
- The server README had no pre-publish run line.
- `python/README.md` had a test command that fails without `PYTHONPATH=src`.
- No Python version was stated.
- `hatchling>=1.25` predates the PEP 639 license fields `pyproject.toml` uses.

**L7. IRR can miss two roots within one 1% grid step.** Left.

- Where: `packages/calc/src/finance.ts:79`.
- What is wrong: two roots in the same step, or a tangent root off a grid point, are missed.
  The tool description no longer claims "every root"; that wording was corrected in `ad75254`.
- Why it was left: the solver's behaviour is unchanged. A finer scan is a formula change and
  would cost a version bump of `calc.irr`.

**L8. Rent periods clamp to month end.** Left.

- Where: `packages/calc/src/dates.ts:26`.
- What happens: a lease starting 2024-02-29 for 12 months expires 2025-02-27, and one starting on
  Jan 31 has month 1 end on Feb 27.
- Why it was left: this is the documented convention ("clamped to month end"). Leases also use a
  convention that overflows into the next month. Changing it is a `rent_schedule` formula change
  that flows into NER, proposals and renew-vs-relocate, and is a product decision.

**L9. `rent_schedule` counts duplicate abated months in its step text.** Left.

- Where: `packages/calc/src/rent.ts:235`.
- What is wrong: the "Total abatement" step says "2 abated months" for `[1, 1]`. The amounts are
  right; only the step text is wrong.

**L10. `ingest_entities` indexes any legal name.** Left.

- Where: `python/src/factlot/registry/store.py:256`.
- Why it was left: rows in a state entity registry are legal entities by definition. Filtering
  them with `is_organization` would drop real companies whose names have no organisation word
  ("JOHNSON AND JOHNSON"). Whether Florida's `AGENT` and `TRUST` filing types contain personal
  names was not confirmed. Worth a check before the Florida load is published.

**L11. Weak value-in-quote matching in ingest.** Left.

- What is weak:
  - party names are matched by substring ("Smith" in "Blacksmith Holdings");
  - slash dates are read both month-first and day-first;
  - any number in the quote satisfies a number field;
  - "the first (1st) day of March" is not recognised.
- Why it was left: each of these sends a candidate to review or accepts a plausible one; none
  silently accepts a contradicted value. Tightening them is extractor-quality work for after
  launch.

**L12. The `corrected` list keeps entries for reviewer-rejected candidates.** Left.

- Where: `python/src/factlot/ingest/pipeline.py`.
- Why it was left: the entry's quote is already in the rejected review item, so nothing new is
  stored. Removing it would change `page_corrected` between runs, and the idempotency tests pin
  that count.

**L13. Hotel ADR is `null` when room revenue exists but no rooms were sold.** Left.

- What happens: it warns "ADR is undefined" but does not say the inputs conflict.
- Why it was left: this is cosmetic; the warning already sends the agent back to the inputs.

## Calculators checked and found correct

Each calculator was read in both SDKs and run on edge inputs. The table lists the source each was
checked against; no external lookup was made in this session. The differential test covers
summation order and rounding parity, and it passed.

| Calculator                                | Checked against                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `lease_remeasurement_asc842`              | FASB ASC 842-10-35-4 and 35-5(a)-(c) (rate updated except for RVG changes and contingency resolution); 842-20-35-4 (ROU adjustment floored at zero, excess to P&L); 842-20-25-6 / 25-8 (remaining cost = remaining payments + ROU − liability, straight-line); 842-20-35-7 and 35-8 (finance amortization period). Zero rate, payments in advance, rent-free tail periods and the gain floor behave correctly. The liability and ROU both run to zero. |
| `prepayment_and_defeasance`               | Conventional CMBS yield maintenance: PV of remaining scheduled payments, balloon included, at Treasury plus spread, minus the balance, with a floor. The rate-differential form; the semiannual bond-equivalent conversion `(1 + y/2)^(1/6) − 1`; step-down; and defeasance as PV of each payment at its maturity's yield plus costs. Interest-only, 0% note rate and full amortization are handled.                                                   |
| `lease_vs_own`                            | Standard cost-NPV comparison. The break-even residual was re-derived: `R = (needed + payoff − τ·adjusted basis) / ((1 − s)(1 − τ))`. The interest/principal split, interest-only and short amortization were checked.                                                                                                                                                                                                                                  |
| `renew_vs_relocate`                       | PV is linear in the starting rate (`slope × rate + intercept`, with percent and fixed-$/SF escalations). The break-even is exact up to cent rounding of monthly rent.                                                                                                                                                                                                                                                                                  |
| `hotel_metrics`                           | USALI 11th ed. ladder: departmental profit → GOP → management fees → income before non-operating → EBITDA → replacement reserve → EBITDA less replacement reserve.                                                                                                                                                                                                                                                                                     |
| `debt_sizing`                             | Annual constant `12r / (1 − (1 + r)^−n)`.                                                                                                                                                                                                                                                                                                                                                                                                              |
| `npv`, `irr`                              | Textbook definitions.                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `net_effective_rent`, `compare_proposals` | Annuity NER (rent in advance, landlord costs at t = 0).                                                                                                                                                                                                                                                                                                                                                                                                |
| `percentage_rent`                         | Natural breakpoint = base rent ÷ rate.                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `cam_reconciliation`                      | Variable-only gross-up, cap methods as documented.                                                                                                                                                                                                                                                                                                                                                                                                     |
| `walt`                                    | Actual days ÷ 365.25.                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `rules_tx_property_tax_protest_deadline`  | Tax Code §41.44(a)(1) and §1.06 rollover across year end; Gov't Code §662.003(a)-(b) holiday list.                                                                                                                                                                                                                                                                                                                                                     |

## Unsure

These are judgment calls the owner should confirm.

- **USALI and out-of-order rooms.** The claim that USALI 11th edition keeps short-term
  out-of-order rooms in rooms available comes from memory of the text, not a fresh reading. Only
  the field description depends on it.
- **Reviewer precedence (M2).** A Delaware LLC registered in Texas as a foreign LLC appears as two
  FactLot entities with the same name. Linking only the reviewed one hides the other. The
  alternative, letting an in-state exact match replace a cross-state review, is also defensible.
- **Persons versus partnerships (H2).** A bare "L P" with no other organisation word is now
  treated as a person. Some real partnerships written that way will lose their owner fact. That
  is the conservative direction the data policy asks for.
- **Removing values from the redacted report (M6).** This is a policy change from the
  documented behaviour, and the docs were updated.
