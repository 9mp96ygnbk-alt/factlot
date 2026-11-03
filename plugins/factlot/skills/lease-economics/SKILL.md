---
name: lease-economics
description: Commercial lease economics. Use when the user wants a base-rent schedule with escalations and free rent, the effective or net effective rent after free rent, TI allowance, and commissions, or a ranking of competing lease proposals on one comparable $/SF/yr basis. Calls FactLot calc_rent_schedule, calc_net_effective_rent, and calc_compare_proposals instead of doing lease math in-context.
---

# Lease economics

Three tools share one lease-terms object (`schedule`), so gather it once.

## Gather these inputs

| Argument                   | Meaning and unit                                                                                    |
| -------------------------- | --------------------------------------------------------------------------------------------------- |
| `commencement_date`        | Rent commencement, `YYYY-MM-DD`                                                                     |
| `term_months`              | Integer months (120 = ten years)                                                                    |
| `area_sf`                  | Rentable SF                                                                                         |
| `starting_rent_psf_annual` | Year-one base rent in **$/SF/yr** (annual, never monthly)                                           |
| `escalation`               | `{"type":"percent","rate":0.03}` (compounds), `{"type":"fixed_psf","amount":0.5}`, or omit for flat |
| `abated_months`            | 1-based months with zero base rent, e.g. `[1,2,3]`                                                  |
| `ti_allowance_psf`         | Landlord TI, USD per SF, paid once at commencement                                                  |
| `leasing_commissions`      | USD total (landlord cost)                                                                           |
| `discount_rate_annual`     | Decimal (8% = `0.08`); `0` gives the undiscounted figure                                            |

`escalation.every_months` defaults to 12; the first bump lands in month 13.

## 1. Rent schedule: `calc_rent_schedule`

```json
{
  "commencement_date": "2026-01-01",
  "term_months": 60,
  "area_sf": 10000,
  "starting_rent_psf_annual": 30,
  "escalation": { "type": "percent", "rate": 0.03 },
  "abated_months": [1, 2, 3]
}
```

Returned: expiration 2030-12-31; step 1 monthly rent 25,000 (3 abated months), then 25,750, 26,522.50, 27,318.18, 28,137.72. `total_scheduled_rent` 1,592,740.80, `total_abatement` 75,000, `total_rent_due` 1,517,740.80. The tool warns that escalated $/SF rates are not rounded per step; set `round_rate_to_cents` if the lease table rounds, and relay the warning. Set `include_monthly` only if the user wants the month-by-month table.

## 2. Net effective rent: `calc_net_effective_rent`

Nest the schedule under `schedule` and add concessions (vector "10-year deal"):

```json
{
  "schedule": {
    "commencement_date": "2026-01-01",
    "term_months": 120,
    "area_sf": 10000,
    "starting_rent_psf_annual": 40,
    "abated_months": [1, 2, 3, 4, 5, 6]
  },
  "ti_allowance_psf": 50,
  "leasing_commissions": 100000,
  "discount_rate_annual": 0.08
}
```

Returned: `effective_rent_psf` 38, `net_effective_rent_psf` 32 (after 600,000 of landlord costs), `discounted_net_effective_rent_psf` 28.4772, `pv_rent` 2,568,980.49.

## 3. Compare proposals: `calc_compare_proposals`

`proposals` holds 2 to 20 objects, each with a **unique** `name`, a `schedule`, and optional `ti_allowance_psf`, `leasing_commissions`, `other_concessions`, `additional_costs_psf_annual` (NNN or opex, $/SF/yr; `0` for full-service gross), and `tenant_upfront_costs` (USD). `perspective` is `tenant` (default; ranks effective occupancy cost, lower is better) or `landlord` (ranks discounted net effective rent, higher is better). Ask whose side the user is on.

<!-- prettier-ignore -->
```json
{
  "discount_rate_annual": 0.08,
  "proposals": [
    {"name": "Park B", "ti_allowance_psf": 60, "leasing_commissions": 45000,
     "additional_costs_psf_annual": 9, "tenant_upfront_costs": 25000,
     "schedule": {"commencement_date": "2027-01-01", "term_months": 84, "area_sf": 5000,
       "starting_rent_psf_annual": 32, "escalation": {"type": "percent", "rate": 0.03},
       "abated_months": [1, 2, 3, 4, 5, 6]}},
    {"name": "Tower A", "ti_allowance_psf": 40, "leasing_commissions": 30000,
     "schedule": {"commencement_date": "2027-01-01", "term_months": 60, "area_sf": 5000,
       "starting_rent_psf_annual": 35, "escalation": {"type": "percent", "rate": 0.03},
       "abated_months": [1, 2, 3]}}
  ]
}
```

Returned: `best` "Tower A". Ranking: Tower A `metric_psf_annual` 25.2203 (`total_net` 685,348.69), Park B 30.558 (1,185,993.82). Report the ranking from `value.ranking`; do not re-rank it yourself.

## Rules

- Never compute these figures in-context; report the tool's values as returned.
- Cite the formula ID from `provenance.formula` (`calc.rent_schedule@1`, `calc.net_effective_rent@1`, `calc.compare_proposals@1`).
- Surface every entry in `warnings`.
- Compare proposals on identical assumptions (discount rate, perspective) and say what they are.
- If the FactLot MCP tools are unavailable, POST the same arguments to `https://api.factlot.com/v1/calc/<tool name without the calc_ prefix>`.
