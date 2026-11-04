# Reconciliation workbooks: FactLot against Excel

Seven Excel workbooks, one per asset class or use, each built from **synthetic** inputs (invented
leases, buildings, hotels and loans; none is real). In each, FactLot calculators run on the inputs and
an Excel model of the same calculation is built from live formulas (no pasted values). A Reconcile
sheet puts the two side by side with a Difference column and a Status. Every Difference is 0.00.

This is a proof for people who check a number against their own spreadsheet before they rely on a
tool: you can click any cell, read the formula, change a blue input and watch the Excel side move.

| Workbook                                                                                 | FactLot calculators                                                       | What it covers                                                                                                                                                             | Rows reconciled |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| [office-lease-proposals.xlsx](office-lease-proposals.xlsx)                               | `calc_rent_schedule`, `calc_net_effective_rent`, `calc_compare_proposals` | Four office proposals (base year, NNN, expense stop, gross): rent steps, NER, discounted NER, and the tenant and landlord rankings with downtime                           | 65              |
| [industrial-lease-and-walt.xlsx](industrial-lease-and-walt.xlsx)                         | `calc_rent_schedule`, `calc_net_effective_rent`, `calc_walt`              | A 3.5% compounding lease and a $0.50 bump-every-24-months lease; WALT by area and by rent on a six-tenant roll with an expired lease                                       | 52              |
| [retail-cam-and-percentage-rent.xlsx](retail-cam-and-percentage-rent.xlsx)               | `calc_cam_reconciliation`, `calc_percentage_rent`                         | Three CAM reconciliations (net with gross-up and compounding cap; part-year base year with simple cap; expense stop with year-over-year cap) and two percentage-rent cases | 46              |
| [multifamily-value-add-npv-irr.xlsx](multifamily-value-add-npv-irr.xlsx)                 | `calc_npv`, `calc_irr`                                                    | A value-add hold, annual and quarterly. FactLot has no multifamily-specific calculator; this is what the general ones cover                                                | 8               |
| [hotel-metrics.xlsx](hotel-metrics.xlsx)                                                 | `calc_hotel_metrics`                                                      | Occupancy, ADR, RevPAR, TRevPAR, the profit ladder to NOI, for a full year and for a month with rooms out of order                                                         | 32              |
| [lender-debt-sizing.xlsx](lender-debt-sizing.xlsx)                                       | `calc_debt_sizing`                                                        | LTV, DSCR and debt-yield sizing, refinance shortfall, a four-row stress table, an interest-only bridge loan, and a 360-payment amortization table that repays to 0.00      | 65              |
| [lease-accounting-asc842-remeasurement.xlsx](lease-accounting-asc842-remeasurement.xlsx) | `calc_lease_remeasurement_asc842`                                         | An operating-lease extension and a finance-lease payment cut with a gain; the whole 36- and 24-row schedules reconciled cell by cell                                       | 28              |

## Conventions (the same on every workbook, and stated on its ReadMe sheet)

- **Monthly rent** is `ROUND(rate $/SF/yr x area / 12, 2)`: annual divided by 12, cents, half away from
  zero.
- **Discounting** is monthly at `annual rate / 12` (nominal), with cash flows at the **start** of each
  month, so month 1 carries a discount factor of 1. One-time items (TI, commissions) are at
  commencement and are not discounted. ASC 842 liabilities discount payments in arrears or in advance
  as you state; NPV and IRR use the period you give them.
- **NPV** does not discount the first cash flow (t = 0). Excel's `NPV()` does discount its first
  argument, so the Excel form is `CF_0 + NPV(r, CF_1:CF_n)`.
- **WALT** weights remaining term by area or by rent, with remaining term = actual days / **365.25**;
  an expired lease counts zero years and keeps its weight.
- **Rounding** is to the cent (half away from zero, after reducing to 15 significant digits, which is
  what Excel's `ROUND` does) at the places FactLot rounds, and not elsewhere. Per-SF metrics are
  reported to 4 decimals, ratios to 4, rates to 8.
- **Dates**: lease months run from the commencement day; rent is not prorated to calendar months.
  CAM part-year occupancy is occupied days / period days, both ends inclusive.

## How the check works

`build.py` does three things for each workbook:

1. runs the FactLot calculators (the Python SDK in this repository, no install, no network);
2. writes the workbook with its formulas;
3. evaluates every formula with a small evaluator (`xlsx_lite.py`) and **refuses to write the file
   unless every Difference is 0**. The same evaluation stores each formula's result in the file, so
   viewers that do not recalculate still show numbers. Excel recalculates everything when the file
   opens.

`python/tests/test_reconciliation_examples.py` runs this in the test suite and also fails if a
committed `.xlsx` is out of date, so a calculator change that moves a number cannot ship unnoticed.

**Checked in Excel itself.** On 2026-11-03 all seven files were opened in Microsoft Excel for Mac
16.103, fully recalculated, and read back: every workbook reported 0 rows that differ and no non-zero
Difference. That was a one-off manual check with the files as generated; the test suite above
is what runs every time, and it uses the Python evaluator, not Excel.

## Regenerating

```
python3 examples/reconciliation/build.py             # rewrite all seven .xlsx files
python3 examples/reconciliation/build.py office      # one workbook
python3 examples/reconciliation/build.py --check     # verify and compare with the files on disk
```

Python standard library only. The `.xlsx` files are written directly as OOXML by `xlsx_lite.py`, with
fixed timestamps, so regenerating gives the same file. Each workbook's inputs live at the top of its
module (`office.py`, `industrial.py`, ...): edit them, run `build.py`, and the Excel model and the
FactLot call change together.

In the Excel file itself you can change any blue input and the Excel formulas recalculate; the FactLot
column is a record of the number FactLot returned for the inputs as generated, so it does not move.
To compare new inputs, call the tool (or re-run `build.py`) and read the new FactLot number.

Two things are structural rather than live inputs, and the ReadMe sheets say so: the number of rows in
a month or payment table (changing a lease term means regenerating), and which clauses exist in a CAM
scenario (cap, fee timing, base year or stop). Everything numeric is live.

## ARGUS

**ARGUS parity is untested.** Nothing here was compared with ARGUS Enterprise output, and nothing here
claims that FactLot matches ARGUS. We do not have ARGUS, and we found no public ARGUS documentation
to cite, so this repository does not describe ARGUS's internals or quote its help.

What you can do, and what we can say honestly:

- The FactLot conventions above are the ones to compare against your ARGUS model's settings. The ones
  most likely to differ between any two lease-analysis tools are: whether rent is timed at the start
  or end of the month; whether discounting is monthly or annual and at the start or end of the period;
  whether a part month is prorated by days or by months; whether rent escalates on the lease
  anniversary or on a calendar date; whether and where amounts are rounded; and how free rent, TI and
  commissions are timed and discounted. Check each against your ARGUS version's own documentation.
- To set FactLot inputs to match a setting that FactLot supports, use the blue cells: escalation type
  and interval, free months, rounding of the rate to cents, and the discount rate. To match a monthly
  discount rate, pass `annual / 12`.
- FactLot has no input for some conventions (it always discounts rent at the start of the month, always
  uses `annual / 12`, and does not prorate part months). Where your ARGUS model is set differently, the
  difference is real and known, not hidden by these workbooks.
- If you run the same synthetic inputs through ARGUS and the numbers differ, that is useful: open an
  issue with the setting you used and the two numbers. We will document the difference.

## What this does not prove

- It does not prove a calculator is right for your lease. A reconciliation to Excel shows the arithmetic
  is as stated, not that the stated convention is the one your document says.
- The FactLot column is recorded at generation time; it is not a live link to the service.
- The inputs are synthetic and chosen to exercise branches, not to look like a market.
- CAM and ASC 842 results depend on how you map lease language and accounting facts to the inputs
  (cap method, classification, event, discount rate). FactLot computes what you tell it; it does not
  read the lease.
