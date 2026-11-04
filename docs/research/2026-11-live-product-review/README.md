# Live product review: the 165 CRE agent personas use FactLot 0.1.1 (Nov 2026)

## Read this first

This is a **simulation**, not user research. The 165 personas from the
[November 2026 survey](../2026-11-agent-survey/README.md) were role-played by AI reviewers (ten
batches of 16 or 17). Unlike the [earlier feedback round](../2026-11-product-feedback/README.md),
which judged a written brief, these reviewers **used the software**: 1,002 real calls over REST and
MCP against the same build as api.factlot.com (commit 31b59c2, with the published DC registry
sample loaded), and they read only what a prospect reads (the site, `llms.txt`, the README, the
getting-started guide, the plugin and its skills, the examples). Every claim about behaviour had to
cite a call; every number they relied on had to be recomputed independently in python3.

Every reviewer came from the same model family, so the answers are correlated and the scores are
not calibrated to real buyers. The numeric checks and the quoted contradictions are facts about the
software and the pages; the scores, the money and the levers are opinions of simulated buyers.

## Files

- `REVIEW-BRIEF.md`: the reviewers' instructions and rules.
- `materials/`: the snapshot of what a prospect reads (2026-11-04).
- `batches/B01–B10.jsonl`: 165 records, each with its calls, observed outputs and verification.
- `aggregate.py` → `results.txt`; `themes.txt` (keyword-tagged themes); `appendix.md` (every
  free-text answer by persona).

## Headline (n = 165)

| Measure                               | Result                                                                  |
| ------------------------------------- | ----------------------------------------------------------------------- |
| Calls made                            | 1,002 (668 REST, 334 MCP); every persona at least 3                     |
| Numbers recomputed independently      | 369: **339 match, 29 disclosed convention, 1 mismatch**                 |
| Clarity / citability of outputs (0–5) | 3.87 / 3.42 (76% / 47% at 4 or more)                                    |
| Adoption (0–5, default tool today)    | mean **1.64** (median 2), none at 4 or 5; earlier brief-only round 1.16 |
| Same personas vs. the earlier round   | 81 up, 70 same, 14 down                                                 |
| Hardest task                          | 3 completed, 104 partial, 58 blocked                                    |
| Would pay per month                   | median $0; 91% $0; 9% $49; nobody $599                                  |

**The math is right.** Across 14 calculators, the rules pack, document hashing and the README,
home-page and plugin worked examples, nothing was wrong. The conventions reviewers had to match
(rent discounted at the start of each month, monthly IRR annualised as (1+r)^12 − 1, WALT on
365.25-day years, an expired lease kept at 0 years, cap before base-year deduction) are stated in
the steps or warnings, with one exception noted below.

**The value is thin.** Personas praised the calculators in almost the same words ("a good
calculator drawer, not an underwriting platform"; "this replaces my Excel template for the maths"),
then scored adoption 1–3 because their hardest task needs data or document work FactLot does not do.
Paid plans buy only a higher rate limit today, and the free tier is enough for what works, so 91%
would pay nothing.

## Defects the calls found (verified again by the lead)

1. **ASC 842 schedule does not foot.** `calc_lease_remeasurement_asc842` (B04-P10): headline figures
   are right, but the row interest sums to 806,145.23 against `total_interest` 806,145.18, and 19 of
   60 rows do not roll forward to the cent. No rounding rule is stated. This is the kind of thing an
   auditor writes up.
2. **`fact_validate` checks shape only**, while the site says "Uncited facts are rejected" and
   describes value-in-quote checks. It returned `valid: true` for a value contradicting its own quote
   (1,000 SF vs "2,500 SF"), an undefined extra field, `valid_from` after `valid_to`, a made-up
   document hash, and an inferred fact with no sources. The quote checks live in Ingest, which no
   one can call.
3. **Registry misses are silent.** A parcel or entity outside the loaded regions returns `[]` or
   `{"urn": null}` with HTTP 200, the same as "does not exist".
4. **No building ID**, though the site lists IDs for buildings "computable offline" and `llms.txt`
   adds suites and leases. DC condo units come back as separate parcels with no building above them
   (one LLC's 27 "parcels" were 4 addresses).
5. **Address search is narrow**: "Northwest", "N.W." and a suite suffix miss (2 of 410 hits vs 392
   for "NW").
6. **`calc_compare_proposals`** ranks on rentable SF (a usable-SF basis flipped the top pick in
   B07-P13), has no base year, opex growth or downtime, and does not state its start-of-month
   discounting in the output (the NER tool does).
7. Smaller: `id_space` merges "Suite 1-20" and "Suite 120"; `calc_walt` describes `weight_by` as
   "area_sf or annual_rent" while accepting `area` and `rent`; the Texas rule is verified by "FactLot
   maintainers" where the site promises "a named person".

## What the marketing gets wrong (from the snapshot)

| Problem (personas raising it)                                                                                         |
| --------------------------------------------------------------------------------------------------------------------- |
| "No hosted public endpoint" (README) and "no public endpoint yet" (home, Connect) beside a live api.factlot.com (77)  |
| Headline registry of 1,953,805 parcels in 405 counties, while a user can reach only the 18,077-parcel DC sample (≈76) |
| Paid plans that add only a rate limit, with registry regions "none open yet" (≈89)                                    |
| Three different parcel totals across pages: 708,538, 1,716,664 and 1,953,805 (45)                                     |
| Security questions unanswered: no SOC 2 mention, liability capped, no indemnity (32)                                  |
| Ingest and its quote checks described as if usable (27)                                                               |

Proof they asked for: coverage in their own market (48), published accuracy numbers (38),
reconciliation to ARGUS, Excel, VTS or Yardi with worked examples for their asset class (25),
per-source AI-use licences (21), SOC 2 / SLA / indemnity (18).

Where they would look for a tool like this: MCP registries, connector and plugin directories
(124 of 165), industry associations and trade press (47), peers and LinkedIn (37), GitHub (35),
vendor marketplaces such as Yardi, VTS, ARGUS and Salesforce (32).

The headlines they wrote for their own roles all lead with the same true claim: **every number
reproduces to the cent, with its steps and a versioned formula ID you can hand to a client, lender,
auditor or committee**, usually tied to one job (CAM true-up, loan sizing, proposal comparison,
NER). Data-centre, insurance and zoning personas wrote that no true headline exists for them yet.

## What would make it indispensable (the must-have levers)

Keyword-tagged, one lever can carry several themes (`themes.txt`):

| Lever                                                                                                                                                                      | Personas |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| Cited extraction from their documents as a callable tool: lease abstracts with amendment precedence, T-12 and rent-roll spreads, estoppel diffs, a verify-this-claim check | 53 (32%) |
| Comps and transactions: lease comps, sales with cap-rate basis, deeds, recorded mortgages, CMBS                                                                            | 43 (26%) |
| Zoning, entitlements, permits and more verified rules packs (building-performance laws, lien sales, appeal deadlines)                                                      | 41 (25%) |
| Registry coverage in their own geography, actually reachable                                                                                                               | 35 (21%) |
| Calculator extensions: opex structures, admin fee, occupancy periods, stress tables, multifamily and kW modes, ARGUS parity                                                | 30 (18%) |
| Building-level facts and a resolvable building ID                                                                                                                          | 24 (15%) |
| Tenant, sponsor and parent-entity resolution                                                                                                                               | 16 (10%) |

The single most repeated request is the one FactLot is closest to: the Ingest pipeline already has
the quote-on-page and value-in-quote checks; it is not exposed as a tool.

## Highest and lowest fit

Highest mean adoption: corporate occupiers and small owner-operators (2.2), lease administration
(2.1), tenant-rep brokers and capital-markets research (1.9). Lowest: development and land
feasibility (0.8), insurance and climate risk, retail site selection and construction/capex (1.2).
The 28 personas at 3 all named one calculator job (CAM, loan sizing, proposal comparison, NER,
ASC 842, hotel metrics) as the reason.
