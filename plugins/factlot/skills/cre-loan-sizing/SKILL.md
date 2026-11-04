---
name: cre-loan-sizing
description: Size a commercial real estate loan. Use when the user asks how much debt a property can support, for maximum loan proceeds, or to test or compare LTV, DSCR, and debt yield constraints, find the binding constraint, or run interest-only versus amortizing sizing, stress-test proceeds under NOI, rate, and value shocks, or find the refinance gap against an existing loan; also for a loan's amortization schedule (partial interest-only, balloon at maturity, monthly or quarterly, 30/360 or actual/360). Calls the FactLot calc_debt_sizing (calc.debt_sizing@3) and calc_amortization_schedule (calc.amortization_schedule@1) tools instead of computing proceeds or schedules in-context.
---

# CRE loan sizing

Maximum loan under any mix of max LTV, min DSCR, and min debt yield, with the binding constraint, annual debt service, and the resulting metrics.

## Gather these inputs

| Argument                | Meaning and unit                                                                      |
| ----------------------- | ------------------------------------------------------------------------------------- |
| `noi`                   | Underwritten NOI, USD per **year** (not monthly)                                      |
| `rate_annual`           | Interest rate as a decimal (6.5% = `0.065`)                                           |
| `amortization_years`    | Integer years; `0` = interest-only                                                    |
| `max_ltv`               | Decimal (65% = `0.65`). Needs `value`                                                 |
| `value`                 | Appraised or underwritten value, USD. Required if `max_ltv` is set                    |
| `min_dscr`              | Ratio, not a percent (1.25x = `1.25`)                                                 |
| `min_debt_yield`        | Decimal (9% = `0.09`)                                                                 |
| `round_down_to`         | Optional USD increment lenders round to (`10000`)                                     |
| `existing_loan_balance` | Optional balance being refinanced, USD: adds `refinance` (shortfall, excess proceeds) |
| `stress`                | Optional `{noi_shocks, rate_shocks, value_shocks, value_moves_with_noi}` (see below)  |

Set at least one of `max_ltv`, `min_dscr`, `min_debt_yield`. Ask for the rate and the lender's constraints; if the user gives none, say which assumptions you are using and run the tool with them.

For sensitivities, pass `stress` instead of calling once per scenario. `noi_shocks` and `value_shocks` are relative changes as decimals (`[-0.05, -0.1]` = down 5% and 10%); `rate_shocks` are added to `rate_annual` (`[0.01]` = +100 bp). Every combination is sized under the same constraints and rounding, and `value.stress` lists, per scenario, the stressed NOI, rate and value, `max_loan`, `binding_constraint`, debt service, LTV, DSCR, debt yield, and `refinance_shortfall` when `existing_loan_balance` is given. Value stays fixed under NOI shocks unless `value_moves_with_noi` is true (constant cap rate). Without `stress` and `existing_loan_balance` the result is the same as before.

## Call

Tool: `calc_debt_sizing`. Worked example (vector "LTV binds"):

```json
{
  "noi": 1000000,
  "value": 15000000,
  "rate_annual": 0.06,
  "amortization_years": 30,
  "max_ltv": 0.65,
  "min_dscr": 1.25,
  "min_debt_yield": 0.09
}
```

Returned: `max_loan` 9,750,000, `binding_constraint` `ltv`. Loan by constraint: LTV 9,750,000, DSCR 11,119,440.96, debt yield 11,111,111.11. `annual_debt_service` 701,474.11; `resulting` DSCR 1.4256, debt yield 0.1026.

Interest-only sizing, `{"noi": 1000000, "rate_annual": 0.06, "amortization_years": 0, "min_dscr": 1.25}`, returns `max_loan` 13,333,333 with `binding_constraint` `dscr`.

Stress example (vector "stress table on an interest-only bridge loan"): NOI 2,450,000, value 38,000,000, interest-only at 8.75%, max LTV 0.72, min DSCR 1.15, min debt yield 0.085, rounded down to 50,000, `existing_loan_balance` 24,000,000 and `"stress": {"noi_shocks": [-0.05, -0.1, -0.2], "rate_shocks": [0, 0.01]}`. Base `max_loan` 24,300,000 (DSCR binds). NOI −5% gives 23,100,000 (shortfall 900,000); NOI −20% at +100 bp gives 17,450,000 (shortfall 6,550,000).

## Report

State the maximum loan, which constraint binds, and the loan each constraint would allow on its own, so the user sees how much slack the other tests have. Include debt service and the resulting LTV, DSCR, and debt yield. For a stress table, show each scenario's max loan and binding constraint, and the refinance shortfall when there is an existing loan.

## Amortization schedule: `calc_amortization_schedule`

For the period-by-period schedule of a fixed-rate loan, pass `principal`, `rate_annual`, `term_months` (to maturity), `amortization_months` (`0` = interest-only to maturity), and optionally `interest_only_months`, `payment_frequency` (`monthly` or `quarterly`), `day_count` (`30/360`, `actual/360`, `actual/365`; actual day counts need `start_date`), and `start_date`. Rows are in cents that foot: each row rolls forward exactly and the final payment repays the balance.

Worked example (vector "10-year loan, 2 years interest-only, then 30-year amortization", review case B02-P11): `{"principal": 1000000, "rate_annual": 0.06, "term_months": 120, "amortization_months": 360, "interest_only_months": 24}` returns `interest_only_payment` 5,000, `amortizing_payment` 5,995.51, `balloon_balance` 877,722.99, `final_payment` 883,718.50, `total_interest` 573,291.95. Under actual/360 the payment is still computed on a 30/360 basis, so the balloon absorbs the difference; say so.

## Rules

- Never compute these figures in-context; report the tool's values as returned.
- Cite the formula ID from `provenance.formula` (`calc.debt_sizing@3`, `calc.amortization_schedule@1`) beside the figures.
- Surface every entry in `warnings`.
- On an input error (no constraint set, or `max_ltv` without `value`), fix the arguments or ask the user. Do not estimate instead.
- If the FactLot MCP tools are unavailable, POST the same arguments to `https://api.factlot.com/v1/calc/debt_sizing`.
