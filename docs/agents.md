# Using FactLot from an agent

FactLot exists so an agent doing commercial real estate work never has to guess a number or
an identifier. This page covers which tool to call, when, and how to report the result.

## Golden rules

1. **Don't do CRE math in context.** Call a `calc_*` tool for rent, abatement, NER, CAM, percentage
   rent, loan sizing, WALT, NPV, IRR, lease-versus-own, renew-versus-relocate, and hotel metrics.
   Models drift on compounding, caps, and amortization. The calculators don't.
2. **Cite the method.** Report `formula` (for example `calc.debt_sizing@1`) and point to `steps`.
   A human can check every intermediate value without redoing the work.
3. **Surface warnings.** `warnings` lists assumptions that need a human, such as the order of a
   CAM cap versus the base year, or a prorated breakpoint.
4. **Use FactLot IDs as join keys.** Compute `id_parcel`, `id_entity`, `id_space`, and
   `id_document` IDs offline. Two agents given the same county parcel number or state file
   number always produce the same ID.
5. **Emit facts, not prose.** When you extract something from a lease or a record, emit a fact
   with `provenance.sources` (document, page, section, quote) and check it with `fact_validate`.
   Uncited facts are rejected.

## Which tool when

| The user asks…                                                              | Call                                                |
| --------------------------------------------------------------------------- | --------------------------------------------------- |
| "What's the rent schedule / total rent / expiration date?"                  | `calc_rent_schedule`                                |
| "What's the net effective rent on this deal?"                               | `calc_net_effective_rent`                           |
| "Which of these proposals is better?" (tenant rep or landlord)              | `calc_compare_proposals`                            |
| "What does the tenant owe in percentage rent?"                              | `calc_percentage_rent`                              |
| "Reconcile CAM / opex for 2026" or "check this CAM statement"               | `calc_cam_reconciliation`                           |
| "How big a loan can this support?" or "which constraint binds?"             | `calc_debt_sizing`                                  |
| "Remeasure this lease under ASC 842" after an amendment or reassessment     | `calc_lease_remeasurement_asc842`                   |
| "What does it cost to prepay or defease this loan?"                         | `calc_prepayment_and_defeasance`                    |
| "What's the WALT?"                                                          | `calc_walt`                                         |
| "NPV / IRR of these cash flows"                                             | `calc_npv`, `calc_irr`                              |
| "Should we buy the building or keep leasing?"                               | `calc_lease_vs_own`                                 |
| "Should we renew or move?" or "what rent makes moving worth it?"            | `calc_renew_vs_relocate`                            |
| "What's the occupancy / ADR / RevPAR / GOP / NOI of this hotel?"            | `calc_hotel_metrics`                                |
| You have a county parcel number, a state LLC file number, a suite, or a PDF | `id_parcel`, `id_entity`, `id_space`, `id_document` |
| You extracted a fact and want to store or share it                          | `fact_validate`                                     |

## Mapping lease language to inputs

- **CAM caps.** Lease terms like "cumulative" and "non-cumulative" are used inconsistently, so
  FactLot names caps by what they compute:
  - "Cumulative, compounding", where unused increases carry forward → `compounding_from_base`
  - "Cumulative, non-compounding" → `simple_from_base`
  - "Non-cumulative", meaning each year is capped over the prior year → `year_over_year`

  If the lease is ambiguous, run more than one method and show the difference to a human.

- **Free rent** → `abated_months` (1-based). "Three months free" usually means `[1, 2, 3]`, but
  check whether the lease abates base rent only or gross rent too.
- **NNN vs gross proposals** → put estimated expenses in `additional_costs_psf_annual` for the
  net proposals, or the comparison flatters them.
- **Partial lease years** → `period_fraction` for percentage rent. Check whether the lease
  prorates by days or by months.

## Example: Claude Messages API with the Python SDK

```python
import json

import anthropic
import factlot

MODEL = "..."  # any current Claude model
client = anthropic.Anthropic()
messages = [{"role": "user", "content": "Compare these two office proposals for my client: ..."}]
while True:
    response = client.messages.create(
        model=MODEL, max_tokens=4096, tools=factlot.anthropic_tools(), messages=messages
    )
    messages.append({"role": "assistant", "content": response.content})
    calls = [b for b in response.content if b.type == "tool_use"]
    if not calls:
        break
    messages.append({"role": "user", "content": [
        {"type": "tool_result", "tool_use_id": c.id, "content": json.dumps(factlot.run_tool(c.name, c.input))}
        for c in calls
    ]})
```

`run_tool` returns input errors as data (`{"error": "CalcInputError", "issues": [...]}`), so the
model can fix its arguments and retry.

## Example: emitting a computed fact

```json
{
  "subject": "fl:lease:01jbx3k8q2v7m9c4t6w8y0a2b4",
  "predicate": "lease.net_effective_rent",
  "value": 28.4772,
  "unit": "USD/sf/yr",
  "as_of": "2026-11-02",
  "provenance": {
    "method": "computed",
    "formula": "calc.net_effective_rent@1",
    "sources": []
  }
}
```
