---
name: lease-vs-own-and-renewals
description: Occupier real estate decisions and rent-roll tenor. Use when the user asks whether to lease or buy a property, whether to renew in place or relocate, for the break-even rent or residual value, or for the weighted average lease term (WALT) of a rent roll. Calls FactLot calc_lease_vs_own, calc_renew_vs_relocate, and calc_walt instead of building the NPV comparison in-context.
---

# Lease vs own, renew vs relocate, WALT

## Lease vs own: `calc_lease_vs_own`

Compares the NPV of annual cash costs of leasing against owning over `horizon_years`; the own case sells at the horizon. Gather (USD, annual unless noted; rates as decimals):

- `horizon_years` (integer) and `discount_rate_annual`.
- `lease`: `rent` as `{"type":"escalating","base_rent_annual","escalation_rate_annual"}` or `{"type":"schedule","annual_rent":[...]}` (exactly one entry per year), `free_rent_months`, `operating_expenses_annual`, `expense_growth_rate_annual`, `upfront_costs`.
- `own`: `purchase_price`, `closing_costs`, optional `loan` `{amount, rate_annual, amortization_years}` (omit for all-cash), `operating_expenses_annual`, `capex_reserve_annual`, `property_taxes_annual`, `insurance_annual`, `selling_costs_rate`, and `residual` as `{"type":"exit_cap","cap_rate","stabilized_noi"}` or `{"type":"value","amount"}`.
- Optional `own.tax` `{"marginal_tax_rate": 0.26}` for an after-tax comparison; without it both cases are pre-tax. Say which you ran.

<!-- prettier-ignore -->
```json
{
  "horizon_years": 5,
  "discount_rate_annual": 0.08,
  "lease": {
    "rent": {"type": "escalating", "base_rent_annual": 240000, "escalation_rate_annual": 0.03},
    "free_rent_months": 3, "operating_expenses_annual": 60000,
    "expense_growth_rate_annual": 0.02, "upfront_costs": 50000
  },
  "own": {
    "purchase_price": 3000000, "closing_costs": 60000,
    "loan": {"amount": 2100000, "rate_annual": 0.065, "amortization_years": 25},
    "operating_expenses_annual": 45000, "capex_reserve_annual": 15000,
    "property_taxes_annual": 50000, "insurance_annual": 12000,
    "expense_growth_rate_annual": 0.02, "selling_costs_rate": 0.03,
    "residual": {"type": "exit_cap", "cap_rate": 0.07, "stabilized_noi": 230000}
  }
}
```

Returned (pre-tax): lease NPV 1,255,909.81; own NPV 1,270,037.70; `cheaper` "lease" by `difference_npv` 14,127.89; `break_even_residual_value` 3,307,114.81 (the sale price at which owning equals leasing; the modelled residual is 3,285,714.29). The margin is thin, so report the break-even and the assumptions it hinges on. The tool also warns that this is a pre-tax comparison and that the result is sensitive to the exit cap rate; relay both.

## Renew vs relocate: `calc_renew_vs_relocate`

Gather `horizon_months`, `discount_rate_annual`, `current_rent_monthly` (USD per month for the whole premises, not $/SF; prices the double-rent overlap), and a `renew` and a `relocate` object. Each has a `schedule` (commencement date, area, starting $/SF/yr, escalation, abated months; term = horizon) plus one-time costs: `ti_cost`, `ti_allowance`, `renewal_fee` for renew; `buildout_cost`, `ti_allowance`, `moving_cost`, `downtime_months`, `downtime_cost_monthly`, `overlap_months`, `termination_cost`, `disruption_cost` for relocate.

<!-- prettier-ignore -->
```json
{
  "horizon_months": 36, "discount_rate_annual": 0, "current_rent_monthly": 10000,
  "renew": {"ti_cost": 20000, "schedule": {"commencement_date": "2026-07-01", "area_sf": 4000, "starting_rent_psf_annual": 30}},
  "relocate": {"buildout_cost": 200000, "ti_allowance": 160000, "moving_cost": 15000,
    "overlap_months": 1, "termination_cost": 12000,
    "schedule": {"commencement_date": "2026-07-01", "area_sf": 4000, "starting_rent_psf_annual": 26}}
}
```

Returned: `cheaper` "renew"; renew NPV 380,000, relocate NPV 389,000.12, `difference_npv` 9,000.12. `break_even.relocate_starting_rent_psf` 25.25 (relocating only wins below this new-lease rate), `break_even.renew_starting_rent_psf` 30.75. The tool warns that no disruption or downtime cost was supplied for relocating; relay it and ask the user for those costs. Discount rate 0 here keeps the figures plain; use the user's real rate.

## WALT: `calc_walt`

`as_of` (`YYYY-MM-DD`), `weight_by` (`area` default, or `rent`), and `leases`: `[{id, expiration_date, area_sf, annual_rent}]` (`area_sf` needed for area weighting, `annual_rent` in USD per year for rent weighting). Example with `as_of` 2026-01-01 and two leases (10,000 SF, $500,000, expires 2031-01-01; 30,000 SF, $600,000, expires 2028-01-01): `walt_years` 2.7488 by area, 3.3626 with `"weight_by": "rent"`.

## Rules

- Never compute these figures in-context; report the tool's values as returned.
- Cite the formula ID from `provenance.formula` (`calc.lease_vs_own@2`, `calc.renew_vs_relocate@2`, `calc.walt@1`).
- Surface every entry in `warnings` (for example negative equity or a negative break-even rent).
- State the discount rate, horizon, and tax treatment next to any verdict; the answer is only as good as those inputs.
- If the FactLot MCP tools are unavailable, POST the same arguments to `https://api.factlot.com/v1/calc/<tool name without the calc_ prefix>`.
