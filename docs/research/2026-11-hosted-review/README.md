# Hosted product review: a new panel of 165 CRE agent personas (Nov 2026)

## Read this first

This is a **simulated** review, not market research. AI subagents role-played 165 AI agents that do
commercial real estate work, read what a prospect reads, and used the **live hosted service**
(api.factlot.com, version 0.3.0, free tier) the way each agent would connect. Every statement about
the product had to come from a real call, and every number a persona relied on was recomputed in
python. The personas are fictional and all come from one model family, so their opinions are
correlated. Use the scores to rank hypotheses, not to size a market or set prices.

The defects are a different matter: they are reproducible. The ones marked **reproduced** below were
re-run against the hosted service by the lead after the panel finished.

**Comparing with the last round is not like for like.** The November live review
(`../2026-11-live-product-review`) used a different, evenly weighted panel of 165 personas, version
0.1.1, and a local server with the DC registry sample loaded. This round uses a new panel weighted to
FactLot's core buyers, version 0.3.0, and the hosted service, which has no registry. The table by role
group below is the fairest comparison available.

## Method

- **Panel:** 165 skeletons from `personas/generate.py` (seeded), weighted to core buyers by owner
  decision. 15 batches of 11, shuffled so every batch mixes roles. Each reviewer fleshed out its
  skeleton into a persona record (`personas/H*.jsonl`) before touching the product.

  | Tier     | Roles (count)                                                                                                                                                                          | n   |
  | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- |
  | Core     | lease admin and abstraction 22, acquisitions underwriting 18, appraisal and valuation 14, lending 14, tenant rep 8, corporate occupier 8, small owner and 1031 14, asset management 12 | 110 |
  | Adjacent | property management and CAM 12, due diligence and legal 10, investment sales 10, ESG and energy 8                                                                                      | 40  |
  | Edge     | tax appeal 4, insurance and climate 4, site selection 4, development 3                                                                                                                 | 15  |

  Firm size: 58 institutional, 66 mid-market, 41 small. Temperament: 55 skeptical, 79 pragmatic,
  31 eager. Connection: 36 remote MCP from a Claude client, 34 REST from the deployer's own code,
  30 ChatGPT Custom GPT (OpenAPI 3.0), 29 agent frameworks over MCP, 20 Claude Code plugin,
  16 Copilot Studio or Gemini.

- **Blind:** reviewers read only `REVIEW-BRIEF.md`, the `materials/` snapshot of factlot.com and the
  public docs (2026-11-04), and their skeletons; not earlier reviews or the source code.
- **Product:** hosted only. All 1,130 requests went through one paced client, at most 45 per minute,
  because every reviewer shared one IP and the free tier allows 60. There were no 429s. Statuses:
  1,024 × 200, 86 × 400 (mostly deliberate input mistakes), 9 × 503 (registry routes), 5 × 404,
  2 connection resets that succeeded on retry. Median latency 0.9 s, p95 3.6 s. The run took 26 min.
- **Scoring:** the same rubric as the last round (adoption 0–5, clarity, citability, would-pay,
  must-have lever, every number recomputed), plus onboarding (path, calls to first useful answer,
  where it stalled, ease 0–5). `aggregate.py` produces `results.txt` and `appendix.md` (every
  free-text answer by persona).

## Headline results

| Measure                    | This panel (0.3.0, hosted)           | Last panel (0.1.1, local) |
| -------------------------- | ------------------------------------ | ------------------------- |
| Adoption score, mean       | **2.87**                             | 1.64                      |
| Share scoring 4 or 5       | 17%                                  | 0%                        |
| Share scoring 0 or 1       | 8%                                   | —                         |
| Core tier mean (n = 110)   | 3.11                                 | —                         |
| Clarity / citability, mean | 4.15 / 4.03                          | —                         |
| Would pay anything         | 36% (57 at $49, 3 at $20–40)         | —                         |
| Outcome                    | 102 completed, 61 partial, 2 blocked | —                         |

Adoption score distribution: 13 scored 1, 23 scored 2, 101 scored 3, 28 scored 4, nobody 0 or 5.
The typical verdict is "I would use it weekly for part of the job." Nobody called it a default yet.
Eager personas averaged 3.23, pragmatic 2.92 and skeptical 2.60.

**By role group (previous panel → this panel):**

| Role group                  | Before | Now      | n   |
| --------------------------- | ------ | -------- | --- |
| Property management and CAM | 1.78   | **3.58** | 12  |
| Tenant rep                  | 1.89   | 3.38     | 8   |
| Corporate occupier          | 2.25   | 3.25     | 8   |
| Lease administration        | 2.12   | 3.18     | 22  |
| Acquisitions underwriting   | 1.67   | 3.17     | 18  |
| Due diligence and legal     | 1.75   | 3.10     | 10  |
| Asset management            | 1.33   | 3.08     | 12  |
| Lending                     | 1.75   | 3.07     | 14  |
| Small owner and 1031        | 2.25   | 3.00     | 14  |
| Appraisal and valuation     | 1.75   | 2.86     | 14  |
| Investment sales            | 1.56   | 2.40     | 10  |
| Tax appeal                  | 1.50   | 2.00     | 4   |
| Development                 | 0.75   | 2.00     | 3   |
| Site selection              | 1.25   | 1.75     | 4   |
| ESG and energy              | 1.50   | **1.12** | 8   |
| Insurance and climate       | 1.25   | **1.00** | 4   |

Every core and adjacent group rose by about one point, with the 0.2.0 and 0.3.0 calculators,
document tools and CAM work showing up most in property management, asset management and
underwriting. ESG and insurance fell. Those personas found nothing to call on the hosted service:
the rules packs are draft and SDK-only, and energy data is not hosted.

**Onboarding** (ease 0–5, mean 3.85; median calls to the first useful answer):

| Connection                               | Ease | Calls |
| ---------------------------------------- | ---- | ----- |
| REST from own code                       | 4.18 | 2     |
| Remote MCP from a Claude client          | 4.06 | 2     |
| Claude Code plugin (read, not installed) | 3.90 | 1.5   |
| Agent framework over MCP                 | 3.79 | 3     |
| ChatGPT Custom GPT                       | 3.60 | 2     |
| Copilot Studio or Gemini                 | 3.19 | 2     |

Nobody could install a real client here, so the console steps (Claude, ChatGPT builder, Copilot
Studio, Gemini, the plugin) are untested. The low scores for ChatGPT and Copilot/Gemini come from the
docs: a missing instructions file in the materials, a subset that differs from the guide, and guides
that say live console connections are "not yet" verified.

## Output quality

1,111 calls are recorded in the reviews (592 MCP, 519 REST). Of the 543 with a numeric verdict:
**513 matched** an independent python recomputation, 27 were legitimate conventions, and **3 were
mismatches**, two of them the same defect. Reviewers rebuilt whole models: a four-lease, seven-year
DCF month by month, 120-row actual/360 amortization schedules, LP/GP waterfalls, batch CAM, ASC 842
remeasurement, fact-package Merkle roots and document hashes. Those all tied to the cent.

The 27 conventions are mostly disclosed:

- cent rounding of monthly rent;
- annuity-due discounting;
- the implied cap rate shown net of reserves;
- NPV discounting from t = 0, where Excel's `NPV()` starts at t = 1;
- monthly or semiannual yield maintenance.

Four are not disclosed in the response:

- cent rounding in `calc_net_effective_rent` and `calc_rent_schedule` totals;
- the occupancy denominator in `calc_multifamily_rent_roll`;
- the 30/360 basis in `calc_prepayment_and_defeasance` and `calc_debt_sizing`.

## Defects

### Wrong answer, nothing flagged

1. **`doc_abstract_lease` depends on document order. Reproduced.** If the amendment is listed first
   and the original lease has no `role`, the original defaults to `amendment` and is applied last. The
   abstract then reports the pre-amendment expiration, area and deposit as current, with no warning.
   Repro: `H13-P01`; saved inputs b3.json and b3b.json. The docs say documents may come "in any
   order".
2. **`doc_verify_facts` returns "verified" for values it never checked. Reproduced.**
   - List values: `lease.prohibited_uses` with an invented "vape shop" added comes back `verified`,
     with `checked: []` and every item `not_checked`.
   - True/false values: `lease.go_dark {operating_covenant: true}` with the quote "Tenant is not
     required to continuously operate" also comes back `verified`.
   - Structured values: a wrong `lease.exclusive_use` was verified the same way.

   The response lists what it did not check, but the bucket name is what an agent relays. The home
   page and `document-verification.md` say the quote states the value. Eight personas hit this
   (H15-P04, H15-P07, H03-P11, H10-P04, H02-P08, H07-P06 and others).

3. **`calc_exchange_1031` counts late-identified properties. Reproduced.** Take A, B and C identified
   on time and D a day late, for a $4.2M sale. The tool reports count 4, $9.0M, three-property rule
   false, `rule_met: null`, and lists D under `late_identifications`. Without D the set is three
   properties and the three-property rule is met. Nine personas in seven batches reported it.
4. **`calc_dcf_pro_forma` silently drops turnover vacancy. Reproduced.** With 12-month leases, one
   month of downtime and a renewal probability of 0.55, the blended downtime is 0.45 months. It
   rounds to 0, so the output is identical to a renewal probability of 1.0 (value 10,199,375.34 in
   both runs). The generic conventions warning does not say that the downtime disappeared (H10-P02).
5. **Whole-number percentages are accepted by some tools and rejected by others. Reproduced.**
   - Rejected with "pass 0.065": `calc_debt_sizing`, `calc_direct_cap`, `calc_percentage_rent`,
     `calc_hotel_metrics` and others.
   - Accepted with only a warning, giving absurd results: `calc_rent_schedule` (rate 3 computed as
     300%), `calc_npv`, `calc_capex_recovery`, `calc_net_effective_rent`, the
     `calc_cam_reconciliation_batch` admin fee and `calc_debt_sizing` `min_dscr` 130.
   - Accepted with no warning at all: `lease_comp_validate` (rate 3 gave `valid: true` and an NER of
     4,492).
   - Rejected, but without the decimal hint: `pro_rata_share`, `max_ltv` and `occupancy`.

**Reported by reviewers with full reproductions, not re-run by the lead:**

- `calc_dcf_pro_forma`: a second-generation lease that expires inside the forward year is not
  re-leased, so exit NOI carries unexplained vacancy (H13-P07).
- `fact_package_verify`: returns `valid: true` for a package built from a value edited away from its
  quote, because it checks hashes and that the quotes are on the page, not the values (H01-P09; within
  the documented scope, but the output does not say what it skipped).
- `doc_abstract_lease`: a future-dated amendment controls the "current" abstract (H13-P01, H07-P01,
  H06-P01). An amendment that restates only part of a rent schedule drops the earlier steps from the
  current value (H05-P11).
- `doc_compare`: `not_in_lease` means "not among the facts you passed", but reads as a statement about
  the lease (H08-P06, H05-P11, H07-P03).
- `calc_cam_reconciliation`: `controllable` defaults to true, so taxes and insurance in a capped pool
  are capped without a warning ($35,262 off in H09-P03).
- `calc_prepayment_and_defeasance`: re-amortizes at 30/360, not the actual/360 note's payment; the
  balloon was $540k lower in H13-P04.
- Unit slips accepted without a warning:
  - years typed as months in the DCF, rent schedule and amortization;
  - annual rent in a monthly field in the rent roll;
  - rooms out of order given as rooms rather than room-nights in the hotel tool;
  - a $/SF/month rent in an annual field in compare proposals.
- `calc_direct_cap` and `calc_dcf_pro_forma` label per-kW and per-pad results as `per_sf`
  (H01-P03, H01-P10).
- `calc_hotel_metrics`: "rooms_sold exceeds rooms available" comes back with an empty `issues` array
  (H07-P11).
- `doc_check_use_conflict` misses synonyms ("boba tea" against a tea exclusive, "bitcoin mining"
  against "cryptocurrency mining"). The docs say keyword matching and that an empty list is not
  clearance.

### Docs that the product contradicts (all confirmed in the repo)

| Where                                                | Says                                                                   | Hosted product                                                                       | Personas |
| ---------------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | -------- |
| `docs/getting-started.md:7`                          | REST, OpenAPI and exports "always include the registry tools"          | `/v1/tools`, `/openapi.json`: 39 tools, no `registry_*`; routes exist and return 503 | 28       |
| `connectors/README.md:17`                            | remote MCP "serves 16 tools"                                           | `tools/list`: 42                                                                     | 16       |
| `connectors/README.md:34`                            | Docker `factlot:0.1.1`                                                 | 0.3.0                                                                                | 2        |
| `site/index.html:110`                                | plugin "with eight CRE skills"                                         | eleven (line 374 says eleven)                                                        | 18       |
| `plugins/factlot/README.md:22-23`                    | `cam-reconciliation` listed twice                                      | —                                                                                    | several  |
| `plugins/factlot/skills/cre-loan-sizing/SKILL.md:59` | cites "review case B02-P11"                                            | internal research ID in a public skill                                               | 1        |
| `connectors/chatgpt/README.md`                       | 30 operations incl. 4 registry                                         | served subset has 26                                                                 | many     |
| `document-verification.md`                           | `doc_verify_claim` takes "a short sentence"; input table omits `as_of` | needs `{"text": …}`; `as_of` required on `doc_verify_facts` and `doc_abstract_lease` | 9        |
| `connectors/claude/README.md` step 1                 | "Deploy the remote connector"                                          | hosted URL needs no deploy                                                           | several  |
| registry 503 message                                 | links `registry-sample-dc-2026-11-03`                                  | current sample is `…-11-04`                                                          | 3        |

Also found by the lead: Cloudflare returns 403 to Python's default `urllib` user agent on
api.factlot.com. The panel used a named user agent, so it did not hit this, but a plain `urllib`
script does.

### Agent ergonomics

- **Predicate value shapes are hard to find (26 personas).** `ingest.md` is linked but was not in
  what a prospect reads. Over MCP it is reachable through `search` and `fetch`; over REST or from a
  Custom GPT it is not. Most agents learned the shapes from rejection messages.
- **`tools/list` is 162 KB** (about 40k tokens) for 42 tools, with no filter (13 personas).
- **The Custom GPT subset uses 26 of its 30 slots** and leaves out the doc tools a CAM or estoppel GPT
  needs: `doc_compare`, `doc_verify_claim`, `doc_check_use_conflict` and `calc_capex_recovery`.
  `gpt-instructions.md` exists in the repo but is not linked anywhere a prospect would see it
  (21 personas).
- **Error messages:** some have empty `issues` arrays (`calc_walt`, `calc_hotel_metrics`); some
  report only the first fault; some say "did you mean `lease.expiration_date`" for
  `lease.escalation_rate`.

## What the panel asked for

Must-have levers, grouped by keyword. Each persona names one lever, which can touch several themes,
so the counts are approximate.

| Theme                                                                     | Personas | Notes                                                                                                                           |
| ------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Comps and market data (lease, sale, cap rates)                            | ~46      | the GSA comps are federal-tenant only and not hosted                                                                            |
| Stricter document verification                                            | ~46      | check every list item, true/false and object field; a per-predicate checked table; lease-year rent steps; a critical-dates tool |
| Hosted registry and local data (owner, parcel, assessment, sales, zoning) | ~35      | the owner's current work                                                                                                        |
| Tested connectors and the right GPT subset                                | ~29      | recorded Copilot Studio, Gemini and framework runs; a filtered tool list                                                        |
| Tie-out to ARGUS, Yardi or another incumbent                              | ~26      | the workbooks reconcile to Excel; ARGUS parity is stated as untested                                                            |
| Enterprise trust (DPA, SOC 2, SSO, a named host)                          | ~18      | `customer-documents.md` still says the cloud host is "not yet chosen"                                                           |
| Input guards and units                                                    | ~17      |                                                                                                                                 |
| Callable compliance rules (LL97, BERDO, CBPS)                             | ~10      | ESG's whole score                                                                                                               |

What landed:

- Math that ties out to independent checks.
- Steps and formula IDs on every result.
- Clear rejection messages for most mistakes.
- The T-12 spread refusing to guess.
- The document checks catching fabricated quotes, typos and hyphenation slips.
- Byte-identical repeat responses.
- `readOnlyHint` on every tool.
- REST and MCP returning the same JSON.

## Ranked build list

**Fix first (defects; small and checkable):**

1. Make `doc_verify_facts` verify, or stop calling it verified. Check each list item, true/false
   value and string field of an object against the quote. Anything not checked goes to a new
   `partially_checked` status or to `needs_review`, never to `verified`.
2. Make `doc_abstract_lease` independent of order. Infer the original from the roles and dates, or
   require `role` when there is more than one document. Flag amendments dated after `as_of`, and keep
   rent steps that a partial restatement leaves out.
3. `calc_exchange_1031`: exclude late identifications from the count, value and rule tests. Report
   them separately.
4. `calc_dcf_pro_forma`: model fractional blended downtime as a probability-weighted cost, or warn
   when rounding removes it. Re-lease leases that expire inside the forward year.
5. One percent policy for every rate field: reject whole numbers with the "pass 0.065" hint
   everywhere, including `lease_comp_validate` and the bounds-only messages.
6. Doc corrections: getting-started, the connectors README (tool count, Docker tag), the site's
   "eight" skills, the duplicate plugin row, the B02-P11 reference, the ChatGPT list, the
   `doc_verify_claim` and `as_of` docs, the Claude connector step 1 and the 503 link. Also allow the
   default Python user agent through, or document the requirement.

**Build next (most-requested work that is not the owner's):**

7. A predicate catalog over REST and in the docs: shapes, examples, and which fields are checked.
8. Fill the Custom GPT subset to 30 with the doc tools, and link `gpt-instructions.md`.
9. Tool profiles or a filter on `tools/list` (for example `?profile=lease-admin`) to cut the 162 KB.
10. Plausibility guards for units and magnitudes: months vs years, monthly vs annual rent, room-nights.
    Also carry units (kW, pad, key, bed) through direct cap and the DCF.
11. Irregular rent-step tables in `calc_rent_schedule` and per-lease steps in the DCF. Also a
    verifiable lease-year rent schedule and a critical-dates calculator.
12. Recipes for agent frameworks (LangGraph, OpenAI Agents SDK, CrewAI) with a 429 policy.

**Founder decisions:**

- Hosted registry lookups (in progress).
- A comps strategy beyond the GSA federal leases.
- DPA, a named host and region, and the SOC 2 path.
- A named person to verify the rules packs (the Texas rule currently shows "FactLot maintainers").
- Live tests of the Copilot Studio and Gemini consoles.
- An ARGUS tie-out, which needs licensed software and a person.

## Files

- `REVIEW-BRIEF.md`: the reviewer brief.
- `personas/generate.py` and `personas/skeletons.jsonl`: the panel.
- `personas/H*.jsonl`: the full persona records.
- `batches/H*.jsonl`: one review per persona.
- `materials/`: what the reviewers read.
- `aggregate.py`: produces `results.txt` (scores) and `appendix.md` (every free-text answer).
