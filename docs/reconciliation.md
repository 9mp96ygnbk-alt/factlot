# Tie-out: FactLot against ARGUS, Yardi or your own model

Two tools put FactLot's numbers next to another system's and say where they differ:

| Tool                 | Formula                | Compares                                                                                                                                       |
| -------------------- | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `calc_reconcile_dcf` | `calc.reconcile_dcf@1` | `calc_dcf_pro_forma` (`calc.dcf_pro_forma@2`) with the other system's annual cash-flow lines, and optionally its value, unlevered IRR and sale |
| `calc_reconcile_cam` | `calc.reconcile_cam@1` | `calc_cam_reconciliation_batch` with the other system's per-tenant CAM results for one expense pool                                            |

Each returns, per line and year (or per tenant and line), FactLot's amount, the other amount, the
difference and whether it is within your tolerance, plus a `likely_cause` for each difference drawn
from FactLot's own documented conventions. A likely cause is a **hypothesis to check**, not a finding
about the other system.

## Status: tested on synthetic files only

**ARGUS parity is untested. Yardi parity is untested.** No ARGUS or Yardi export was available when
these tools were built (November 2026), so nothing here has been run on a real export, and FactLot
does not claim to match ARGUS, Yardi or any other product. The tools were tested on **synthetic**
files that FactLot built from its own output with one convention changed on purpose
([`examples/reconciliation/tie-out`](../examples/reconciliation/tie-out), described
[below](#the-synthetic-fixtures)). Those files are not exports from any product and do not show any
product's report layout.

This page does not describe how ARGUS or Yardi compute anything, name their reports, or give their
column layouts: we could not verify any of that. The input is a neutral shape (a label and a list of
annual amounts), and the default label mappings are common CRE line names that you should check
against your own export.

If you have an export you are allowed to share, see [Contribute a real export](#contribute-a-real-export).
One real tie-out is worth more than everything on this page.

## DCF: step by step

### 1. Enter the same property in FactLot

Build the `calc_dcf_pro_forma` input from the same rent roll and assumptions you entered in the other
system: leases, market leasing assumptions, growth, expenses, vacancy, reserves, exit cap rate,
discount rate. FactLot's conventions are in the tool's `steps` and in
[agents.md](agents.md#valuation-conventions); the ones most likely to differ between two models are
listed under [Reading the likely causes](#reading-the-likely-causes).

### 2. Export the other system's annual cash flow

From your system, export the annual cash flow (the property's operating cash flow by year) to **CSV
or XLSX**:

- one row per line, with the line's name in the **first column**;
- one column per analysis year, **year 1 first**. FactLot's year 1 is the first 12 months from the
  analysis start, and it projects the hold plus one year (for the forward exit NOI), so a 7-year hold
  has 8 years. Extra years are not compared; fewer are fine;
- amounts, not percentages or per-SF figures. Deductions may be shown positive or negative.

A header row (`Year 1`, `Year 2`, ... or `2027`, `2028`, ...), a `Total` column, blank rows, section
headings with no amounts and rows starting with `#` are skipped. For XLSX the first worksheet is read,
and formula cells give the value last saved. If your system cannot export CSV or XLSX, copy the table
into a spreadsheet and save it as either.

### 3. Run the tool

With the Python SDK in this repository (no network; it only reads the files):

```bash
python3 -m factlot.reconcile_files annual.csv --dcf dcf.json --system "my export" \
    --value 10250000 --irr 0.0815 --run
```

Without `--run` it prints the `calc_reconcile_dcf` input, which you can send to the hosted API
(`POST /v1/calc/reconcile_dcf`) or over MCP; without `--dcf` it prints only `other.lines`. In Python:

```python
import factlot
from factlot.reconcile_files import lines_from_file

other = lines_from_file("annual.xlsx")  # {"lines": [...], "notes": [...]}
result = factlot.run_tool("calc_reconcile_dcf", {
    "dcf": dcf_input,
    "other": {"system": "my export", "lines": other["lines"], "value": 10_250_000},
    "tolerance": {"absolute": 1, "relative": 0},
})
```

The input in full:

| Field                     | Meaning                                                                                                                                                   |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `dcf`                     | the `calc_dcf_pro_forma` input                                                                                                                            |
| `other.lines`             | `[{label, values: [year 1, year 2, …]}]`, up to 200 lines                                                                                                 |
| `other.value`             | the other system's present value (optional)                                                                                                               |
| `other.unlevered_irr`     | its unlevered IRR as a decimal (optional; compared when `dcf.purchase_price` is given)                                                                    |
| `other.gross_sale_price`  | its sale price before selling costs (optional)                                                                                                            |
| `other.net_sale_proceeds` | its sale proceeds after selling costs (optional)                                                                                                          |
| `other.system`            | a name for the other side, echoed back                                                                                                                    |
| `mapping`                 | `[{label, line}]`: your label mappings, which override the defaults                                                                                       |
| `sign_convention`         | `auto` (default), `as_reported` or `deductions_positive`                                                                                                  |
| `tolerance`               | `absolute` (USD, default 1.00), `relative` (share of the other amount, default 0) and `irr` (default 0.0001); the larger of absolute and relative applies |

### Label mapping

Each label is compared ignoring case and punctuation, with `&` read as "and". A label maps to a
FactLot line by your `mapping` first, then by these **defaults**:

| Default label                                                                   | FactLot line                                                    |
| ------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Potential Base Rent                                                             | `potential_base_rent`                                           |
| Absorption & Turnover Vacancy                                                   | `turnover_vacancy` (compared together with potential base rent) |
| Free Rent; Base Rent Abatements; Free Rent / Base Rent Abatements               | `free_rent`                                                     |
| Expense Reimbursements; Expense Recoveries; Expense Reimbursements / Recoveries | `expense_recoveries`                                            |
| General Vacancy                                                                 | `general_vacancy`                                               |
| Credit Loss                                                                     | `credit_loss`                                                   |
| Effective Gross Revenue                                                         | `effective_gross_revenue`                                       |
| Operating Expenses; Total Operating Expenses                                    | `operating_expenses`                                            |
| Net Operating Income; NOI                                                       | `net_operating_income`                                          |
| Tenant Improvements                                                             | `tenant_improvements`                                           |
| Leasing Commissions                                                             | `leasing_commissions`                                           |
| Capital Reserves                                                                | `capital_reserves`                                              |
| Cash Flow Before Debt Service                                                   | `cash_flow_before_debt`                                         |

FactLot's own line names also map to themselves (`gross_revenue` or "Gross Revenue",
`management_fee` or "Management Fee", and so on). These defaults are generic CRE terms, not any
product's report: **check them against your own export**, and map anything else yourself:

```json
"mapping": [
  { "label": "Total Rental Revenue", "line": "potential_base_rent" },
  { "label": "Parking Income", "line": "ignore" }
]
```

- Lines that map to nothing are listed in `unmapped_labels` and not compared; map them, or map them
  to `ignore` (listed in `ignored_labels`).
- Several labels mapped to one FactLot line are summed (for example tax, insurance and CAM
  reimbursements to `expense_recoveries`). Make sure none of them is a subtotal of the others; a
  warning reminds you.
- FactLot's potential base rent already leaves out the months a suite is vacant at rollover. If your
  export shows potential rent at full occupancy and a separate absorption and turnover vacancy line,
  map that line to `turnover_vacancy`: it is added (as a deduction) to potential base rent before
  the comparison.
- FactLot reports deductions (free rent, vacancy, credit loss, expenses, management fee, TI,
  commissions, reserves) as negative amounts. With `sign_convention: "auto"` a deduction line whose
  amounts are all zero or positive is negated; `mapping[].sign_flipped` in the result says which.

## Reading the result

`all_within_tolerance` is true only when at least one line was compared and every compared cell,
value, IRR and sale amount agrees. Each entry of `lines` has the FactLot line, the labels compared
with it and, per year, `factlot`, `other`, `difference` (FactLot − other, to the cent) and
`within_tolerance`. `totals` does the same for the sale, value and IRR. `factlot_dcf` carries the
DCF's own value, exit and warnings.

An abridged line from the synthetic rounded-downtime fixture:

```json
{
  "line": "potential_base_rent",
  "years": [
    {
      "year": 3,
      "factlot": 1830638.88,
      "other": 1845960.0,
      "difference": -15321.12,
      "within_tolerance": false
    }
  ],
  "likely_causes": [
    {
      "cause": "rollover_convention",
      "years": [3, 6, 8],
      "hypothesis": "Differences fall only in years 3, 6, 8, years with a lease rollover … Fractional terms in those years: Suite 100 downtime 0.45 months, free rent 1.9 months (lease starting month 31, year 3); …"
    }
  ]
}
```

### Reading the likely causes

For each line that differs, the patterns below are tested in this order and the first match is
reported. Fix the first line that differs before reading the subtotals below it: a subtotal's cause
is often `carried_from_other_lines`.

| `cause`                    | Pattern                                                                                            | What to check                                                                                                                                                |
| -------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `opposite_sign`            | the other amounts are FactLot's negated                                                            | the sign of the line in the export; `sign_convention`                                                                                                        |
| `carried_from_other_lines` | a subtotal's difference equals the sum of its parts' differences, or a rate line follows its base  | the parts named in the hypothesis                                                                                                                            |
| `management_fee_in_opex`   | operating expenses = FactLot's operating expenses + its management fee                             | whether the other model counts the fee as an operating expense (FactLot reports it on its own line)                                                          |
| `rate_base`                | general vacancy, credit loss or management fee = the rate × a different FactLot line               | the base the other model applies the rate to (FactLot: gross revenue for vacancy and credit loss, EGR for the management fee)                                |
| `rate_not_entered`         | FactLot's rate is 0 and the other model charges the line                                           | whether the rate was entered in the FactLot input                                                                                                            |
| `exit_year_only`           | only the year after the hold differs                                                               | how the other model projects that year, and which year's NOI it capitalizes                                                                                  |
| `one_year_shift`           | the other amounts are FactLot's one year later or earlier                                          | when the line is booked (FactLot: TI and commissions in the month the rollover lease starts), and how the years are labelled                                 |
| `rollover_convention`      | differences only in years with a lease rollover (downtime, the new lease's first month, free rent) | blended downtime and free rent: FactLot keeps them fractional (`calc.dcf_pro_forma@2`); a model that rounds them to whole months differs only in these years |
| `leasing_cost_basis`       | TI or commissions differ in rollover years                                                         | TI per SF and its growth; the commission base (FactLot: rate × base rent over the whole new term after free rent)                                            |
| `zero_in_other`            | the other export shows 0 where FactLot has an amount                                               | whether the other model includes the line                                                                                                                    |
| `rounding`                 | differences of a few cents (at most 12 cents per lease a year)                                     | monthly rounding; raise `tolerance.absolute` if that is the only difference                                                                                  |
| `growth_rate`              | other ≈ FactLot × k × g^(y − 1)                                                                    | market rent or expense growth, and the year growth starts                                                                                                    |
| `constant_ratio`           | other = FactLot × a constant                                                                       | a rate, base or area                                                                                                                                         |
| `constant_offset`          | the same difference every year                                                                     | a fixed amount on one side only                                                                                                                              |

For the sale, value and IRR, FactLot reruns the DCF with the other discount timing (mid-year or end
of year), the other exit NOI basis (forward or trailing) and no selling costs; when one of them
matches the other system's figure the cause is `discount_timing`, `exit_noi_basis` or
`selling_costs`. Otherwise it is `carried_from_other_lines` (annual lines differ),
`valuation_convention` (every line agrees: look at the exit and the discounting), `exit_cap_or_noi`
(the implied cap rate on FactLot's exit NOI), or for the IRR `irr_convention` (FactLot's IRR is
annual and end of year, like Excel's `IRR`).

An empty `likely_causes` means no listed pattern matched; the difference is still real. Two
conventions that differ at once can hide each other's pattern, so after fixing one, run again.

## CAM: step by step

Reconcile one expense pool per call: give the `calc_cam_reconciliation_batch` input for that pool
(the same expense lines, gross-up, shares and lease terms you entered in the other system) and the
other system's results per tenant:

| Field                                                                                   | Meaning                                                                                          |
| --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `tenant`                                                                                | matched to `cam.tenants[].name`, exactly or ignoring case and punctuation                        |
| `billed_amount`                                                                         | what the other system billed for the year before estimates (FactLot's `tenant_charge`); required |
| `pro_rata_share`                                                                        | its share                                                                                        |
| `gross_up_applied`, `cap_applied`, `admin_fee_applied`                                  | true/false as the other system reports them                                                      |
| `grossed_up_expenses`, `cap_limit`, `cap_reduction`, `admin_fee`, `structure_deduction` | its amounts                                                                                      |
| `estimates_paid`, `balance_due`                                                         | prior estimates and the balance                                                                  |
| `pool`                                                                                  | echoed                                                                                           |

Only `tenant` and `billed_amount` are required; compare whatever your system reports. From a CSV or
XLSX with those field names as the header row:

```bash
python3 -m factlot.reconcile_files --cam-rows tenants.csv --cam cam.json --run
```

For each tenant that differs, the tool first compares the share. If the shares differ the cause is
`pro_rata_denominator` (and when every share differs by one factor, `building_causes` says the
pool's denominator differs). Otherwise it reruns FactLot's single-tenant reconciliation with one
convention changed and reports every rerun whose amounts all match the other system:

| `cause`                | FactLot rerun with                                                                                                                          |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `controllable_default` | the lines whose `controllable` flag was left to its default (true) set uncontrollable, first those named like taxes, insurance or utilities |
| `cap_base_year`        | `cap.years_elapsed` one more or one less                                                                                                    |
| `cap_method`           | compounding instead of simple from base, or the reverse                                                                                     |
| `gross_up_target`      | gross-up to 95% or 100% instead of the input's target                                                                                       |
| `gross_up_missing`     | no gross-up                                                                                                                                 |
| `admin_fee_cap_order`  | the admin fee before instead of after the cap (on the uncapped amount), or within instead of outside it                                     |
| `admin_fee_base`       | no admin fee on uncontrollable lines                                                                                                        |

`estimates_paid` is reported when the estimates differ. As for the DCF, these are hypotheses: a
rerun that matches shows one convention that would explain the numbers, not that the other system
uses it.

## The synthetic fixtures

[`examples/reconciliation/tie_out.py`](../examples/reconciliation/tie_out.py) builds every file in
[`examples/reconciliation/tie-out`](../examples/reconciliation/tie-out) from FactLot's own output,
reads each back through `factlot.reconcile_files`, runs the tool and checks the planted cause. All are
**synthetic**:

| File                                                          | The "other system"                                                                             | The tool names                                                      |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `dcf-exact.csv`                                               | FactLot's own lines, deductions positive, with value, IRR and sale                             | everything within tolerance                                         |
| `dcf-rounded-downtime.csv`                                    | blended downtime and free rent rounded to whole months (the `calc.dcf_pro_forma@1` convention) | `rollover_convention` in years 3, 6 and 8                           |
| `dcf-vacancy-base.xlsx`                                       | general vacancy on potential base rent instead of gross revenue                                | `rate_base`; EGR, management fee and NOI `carried_from_other_lines` |
| `dcf-mid-year.csv`                                            | the same lines valued with mid-year discounting                                                | `discount_timing` on the value                                      |
| `cam-exact.csv`                                               | FactLot's own statements                                                                       | everything within tolerance                                         |
| `cam-admin-fee-before-cap.csv`                                | Suite 100's admin fee on its uncapped share                                                    | `admin_fee_cap_order` for Suite 100                                 |
| `cam-pro-rata-denominator.csv`                                | every share on 96,000 SF instead of 100,000 SF                                                 | `pro_rata_denominator`, per tenant and for the pool                 |
| `cam-controllable-default.csv` with `cam-input-defaults.json` | taxes and insurance not capped, where the FactLot input left `controllable` to its default     | `controllable_default`                                              |

The same cases, plus smaller hand-built patterns, are the shared conformance vectors
`spec/vectors/calc/reconcile_dcf.json` and `reconcile_cam.json`, run by both SDKs, and the
differential test runs random tie-outs through both. Regenerate with
`python3 examples/reconciliation/tie_out.py` (`--check` to verify).

## Limits

- Annual lines only: no monthly comparison, no per-lease or per-tenant DCF detail.
- The tools see only the numbers you pass. They cannot read the other system's settings, so every
  cause is inferred from a pattern in the numbers.
- Only the patterns listed above are recognised, the first match per line is reported, and two
  differences at once can mask each other.
- CAM: one pool per call; per-expense-line tenant shares are not compared.
- A tie-out shows where two models agree on the same inputs. It does not show that either is right
  for the lease or the market.

## Contribute a real export

If you can share an ARGUS, Yardi or other export, it would let us test these tools on real data for
the first time. Please only share what you are permitted to share, and anonymise it first:

1. Replace tenant names with suite labels and remove the property name, address and anything that
   identifies an owner, lender or person. Keep the amounts, the line labels exactly as your system
   prints them, and the year columns.
2. Include the FactLot input you built for the same property (the `calc_dcf_pro_forma` or
   `calc_cam_reconciliation_batch` input), the product and version that produced the export, and the
   settings you know matter (timing, rounding, vacancy base, downtime and free-rent handling, cap and
   admin-fee order).
3. Open an issue on the FactLot repository with the files attached, or email contact@factlot.com.

We will run it through the tools and tell you the result, including where the tools fail to name a
cause. A label it shows is added to the defaults only when it is a common term rather than one
product's wording.
