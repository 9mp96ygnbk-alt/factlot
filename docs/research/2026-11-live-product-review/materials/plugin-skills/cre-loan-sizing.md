---
name: cre-loan-sizing
description: Size a commercial real estate loan. Use when the user asks how much debt a property can support, for maximum loan proceeds, or to test or compare LTV, DSCR, and debt yield constraints, find the binding constraint, or run interest-only versus amortizing sizing. Calls the FactLot calc_debt_sizing tool (calc.debt_sizing@2) instead of computing proceeds in-context.
---

# CRE loan sizing

Maximum loan under any mix of max LTV, min DSCR, and min debt yield, with the binding constraint, annual debt service, and the resulting metrics.

## Gather these inputs

| Argument             | Meaning and unit                                                   |
| -------------------- | ------------------------------------------------------------------ |
| `noi`                | Underwritten NOI, USD per **year** (not monthly)                   |
| `rate_annual`        | Interest rate as a decimal (6.5% = `0.065`)                        |
| `amortization_years` | Integer years; `0` = interest-only                                 |
| `max_ltv`            | Decimal (65% = `0.65`). Needs `value`                              |
| `value`              | Appraised or underwritten value, USD. Required if `max_ltv` is set |
| `min_dscr`           | Ratio, not a percent (1.25x = `1.25`)                              |
| `min_debt_yield`     | Decimal (9% = `0.09`)                                              |
| `round_down_to`      | Optional USD increment lenders round to (`10000`)                  |

Set at least one of `max_ltv`, `min_dscr`, `min_debt_yield`. Ask for the rate and the lender's constraints; if the user gives none, say which assumptions you are using and run the tool with them. For sensitivities, call the tool once per scenario and tabulate the returned values.

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

## Report

State the maximum loan, which constraint binds, and the loan each constraint would allow on its own, so the user sees how much slack the other tests have. Include debt service and the resulting LTV, DSCR, and debt yield.

## Rules

- Never compute these figures in-context; report the tool's values as returned.
- Cite the formula ID from `provenance.formula` (`calc.debt_sizing@2`) beside the figures.
- Surface every entry in `warnings`.
- On an input error (no constraint set, or `max_ltv` without `value`), fix the arguments or ask the user. Do not estimate instead.
- If the FactLot MCP tools are unavailable, POST the same arguments to `https://api.factlot.com/v1/calc/debt_sizing`.
