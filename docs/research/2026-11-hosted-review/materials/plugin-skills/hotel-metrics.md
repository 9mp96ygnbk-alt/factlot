---
name: hotel-metrics
description: Hotel operating metrics and profit ladder. Use when the user gives hotel rooms, nights, rooms sold, and revenue or expense totals and wants occupancy, ADR, RevPAR, TRevPAR, GOP and margin, GOPPAR, management fees, EBITDA, FF&E reserve, or NOI, USALI style. Calls FactLot calc_hotel_metrics (calc.hotel_metrics@1) instead of computing them in-context.
---

# Hotel metrics

Occupancy, ADR, RevPAR, TRevPAR, and a USALI-style ladder: departmental profit, GOP and margin, GOPPAR, management fees, EBITDA, FF&E reserve, and NOI (EBITDA less replacement reserve).

## Gather these inputs (all for the same period)

| Argument                                      | Meaning and unit                                                                   |
| --------------------------------------------- | ---------------------------------------------------------------------------------- |
| `nights`                                      | Nights in the period (365 for a year, 30 for a month)                              |
| `rooms`                                       | Keys in inventory                                                                  |
| `rooms_out_of_order`                          | Room-**nights**, not rooms (20 rooms closed for 30 nights = 600)                   |
| `rooms_sold`                                  | Paid room-nights, excluding complimentary                                          |
| `room_revenue`, `fb_revenue`, `other_revenue` | Period revenue, USD                                                                |
| `departmental_expenses`                       | Total rooms + F&B + other operated departments, USD                                |
| `undistributed_expenses`                      | A&G, IT, sales and marketing, property operation, utilities, USD                   |
| `management_fee_rate`, `management_fee_fixed` | Percent of total revenue as a decimal (3% = `0.03`); fixed or incentive fee in USD |
| `non_operating_expenses`                      | Property tax, insurance, ground rent, USD                                          |
| `ffe_reserve_rate`                            | Decimal of total revenue (4% = `0.04`)                                             |

Only `nights`, `rooms`, `rooms_sold`, and `room_revenue` are required; omitted lines count as zero, so a revenue-only call yields rooms KPIs but a NOI equal to revenue. Do not present that as a real NOI; ask for the expense lines or label it as revenue-only. Annual P&L totals need `nights: 365`; do not mix a monthly room count with annual revenue.

## Call

Tool: `calc_hotel_metrics`. Worked example (vector "full year statement"):

```json
{
  "nights": 365,
  "rooms": 150,
  "rooms_out_of_order": 200,
  "rooms_sold": 39000,
  "room_revenue": 7020000,
  "fb_revenue": 2100000,
  "other_revenue": 380000,
  "departmental_expenses": 3800000,
  "undistributed_expenses": 2600000,
  "management_fee_rate": 0.03,
  "non_operating_expenses": 520000,
  "ffe_reserve_rate": 0.04
}
```

Returned: `rooms_available` 54,550; `occupancy` 0.7149; `adr` 180; `revpar` 128.69; `trevpar` 174.15; `total_revenue` 9,500,000; `departmental_profit` 5,700,000; `gop` 3,100,000 (`gop_margin` 0.3263, `goppar` 56.83); `management_fee` 285,000; `ebitda` 2,295,000; `ffe_reserve` 380,000; `noi` 1,915,000 (`noi_margin` 0.2016).

## Rules

- Never compute these figures in-context; report the tool's values as returned.
- Cite the formula ID from `provenance.formula` (`calc.hotel_metrics@1`) and note that labels follow USALI.
- Surface every entry in `warnings`.
- Input errors such as rooms sold above rooms available, or out-of-order nights consuming the whole inventory, mean the user's figures are inconsistent. Report that; do not adjust them.
- If the FactLot MCP tools are unavailable, POST the same arguments to `https://api.factlot.com/v1/calc/hotel_metrics`.
