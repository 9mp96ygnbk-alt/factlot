---
name: cam-reconciliation
description: Year-end tenant charge true-ups on commercial leases. Use when the user needs a CAM (common area maintenance) or operating expense reconciliation with exclusions, occupancy gross-up, pro rata share, controllable-expense caps, base year or expense stop, and estimates paid, or a percentage (overage) rent calculation against a natural or fixed breakpoint. Calls FactLot calc_cam_reconciliation and calc_percentage_rent instead of doing the arithmetic in-context.
---

# CAM reconciliation and percentage rent

## CAM: `calc_cam_reconciliation`

Gather from the lease and the landlord's operating statement:

| Argument         | Meaning and unit                                                                                                    |
| ---------------- | ------------------------------------------------------------------------------------------------------------------- |
| `year`           | Year being reconciled                                                                                               |
| `pro_rata_share` | Decimal, 0 to 1 (12,000 SF of 150,000 SF = `0.08`)                                                                  |
| `expenses`       | Building-level lines: `category`, `amount` (USD, full year), `controllable`, `recoverable`, `variable`              |
| `gross_up`       | `{actual_occupancy, target_occupancy}` as decimals (target defaults to 0.95); only `variable` lines are grossed up  |
| `structure`      | `net` (default), `base_year` (`base_year_expenses`, already grossed up), or `expense_stop` (`stop_amount`)          |
| `cap`            | `{method, rate, reference_amount, years_elapsed}`: `compounding_from_base`, `simple_from_base`, or `year_over_year` |
| `estimates_paid` | Total estimates the tenant paid for the year, USD (not monthly)                                                     |

Set `recoverable: false` for excluded items (roof replacement, landlord-only costs). Taxes and insurance are usually `controllable: false`. `cap.reference_amount` is the **tenant's share** of controllable expenses in the base year (USD), or the prior year's capped amount for `year_over_year`. The `*_from_base` methods need `years_elapsed`. Map the lease wording (cumulative compounding, cumulative non-compounding, non-cumulative) to one method explicitly.

Worked example (vector "gross-up, exclusion, compounding_from_base cap"):

<!-- prettier-ignore -->
```json
{
  "year": 2026,
  "pro_rata_share": 0.1,
  "expenses": [
    {"category": "real estate taxes", "amount": 300000, "controllable": false},
    {"category": "insurance", "amount": 50000, "controllable": false},
    {"category": "janitorial", "amount": 200000, "variable": true},
    {"category": "repairs & maintenance", "amount": 150000},
    {"category": "roof replacement", "amount": 400000, "recoverable": false}
  ],
  "gross_up": {"actual_occupancy": 0.8, "target_occupancy": 0.95},
  "estimates_paid": 60000,
  "cap": {"method": "compounding_from_base", "rate": 0.05, "reference_amount": 30000, "years_elapsed": 3}
}
```

Returned: `recoverable_expenses` 700,000; `grossed_up_expenses` 737,500; tenant share controllable 38,750 and uncontrollable 35,000; `cap_limit` 34,728.75; `cap_reduction` 4,021.25; `tenant_charge` 69,728.75; `balance_due` 9,728.75. A negative balance is a credit to the tenant.

## Percentage rent: `calc_percentage_rent`

Inputs: `gross_sales` (USD for the period), `sales_exclusions` (returns, sales tax, gift cards), `rate` (decimal, 6% = `0.06`), `base_rent_annual` (USD per **full** year even for a partial period), `breakpoint` (`{"type":"natural"}` default, or `{"type":"fixed","amount":4500000}`), `period_fraction` (0.5 for a six-month period), `percentage_rent_paid`.

Example (vector "natural breakpoint"): `{"gross_sales": 5000000, "rate": 0.06, "base_rent_annual": 240000}` returns `breakpoint` 4,000,000 and `percentage_rent` 60,000. With `"breakpoint": {"type": "fixed", "amount": 4500000}` it returns 30,000.

## Rules

- Never compute these figures in-context; report the tool's values as returned.
- Cite the formula ID from `provenance.formula` (`calc.cam_reconciliation@1`, `calc.percentage_rent@1`).
- Surface every entry in `warnings`.
- Do not guess lease terms (cap method, gross-up target, exclusions). Ask, or quote the clause the user provided.
- If the FactLot MCP tools are unavailable, POST the same arguments to `https://api.factlot.com/v1/calc/cam_reconciliation` or `/v1/calc/percentage_rent`.
