# Simulated product feedback: 165 CRE agent personas try FactLot v0.1 (Nov 2026)

## Read this first

This is a **simulation**, not user research. The same 165 AI-agent personas from the
[November 2026 survey](../2026-11-agent-survey/README.md) were role-played by AI subagents, each
given [the product brief](PRODUCT-BRIEF.md) (what v0.1 actually does, including its gaps) and its
own survey record (hardest task, missing data, dealbreakers, budget). Each persona "tried" v0.1 on
its hardest task and reported structured feedback. No real model calls against the product were
made, no real user was involved, and every number below is an artefact of the method. Use it the
way the survey is used: to rank what to build and check next, not as evidence of demand.

The method is more useful than it sounds in one respect. The brief forces the reviewer to judge
only what exists, so the result is a map of **where the current product stops short of each role's
job**, written from the role's point of view.

## Files

- `PRODUCT-BRIEF.md`: the only description of the product the reviewers saw.
- `batches/B01–B10.jsonl`: 165 responses, one JSON object per line.
- `aggregate.py`: the scoring script (`python3 aggregate.py .`).
- `results.txt`: its full output.

## Headline (n = 165)

| Measure                                                   | Result                                                      |
| --------------------------------------------------------- | ----------------------------------------------------------- |
| Adoption score, 0–5 (would adopt v0.1 as a default today) | mean **1.16**, median 1, none ≥ 4, 65% ≤ 1                  |
| Hardest task outcome                                      | 0 completed, 68 partial, **97 blocked**                     |
| Would pay for hosted parts                                | median $0; 66% would pay nothing yet                        |
| Preferred pricing                                         | usage 63, subscription 59, enterprise 26, free self-host 17 |

The survey scored the _idea_ of calculators, IDs, and provenance at 3.1–3.5. The same personas score
_v0.1_ at 1.2. The gap is coverage, not design: the things that exist were praised almost everywhere
they applied.

## What worked (the praise is consistent)

- **Calculators that show their work.** The most-quoted virtue: every step and a formula version
  "I can defend to a CFO", "committee", "an angry tenant", "a certificateholder's lawyer".
  `calc_rent_schedule`, `calc_npv`, `calc_net_effective_rent`, `calc_debt_sizing`,
  `calc_cam_reconciliation` were each called by 7–22% of personas.
- **Offline, deterministic IDs** (`id_parcel` 38%, `id_document` 35%, `id_entity` 15%): adopted
  immediately by research and portfolio roles as a join key, even with no registry behind them.
- **The quote-must-exist-on-the-page verifier**: "the right primitive", "the first open
  implementation I have seen", from due-diligence, lease-admin, and ESG roles.
- **The verified Texas protest rule and the real Harris/Dallas rolls**: the few personas inside
  Harris or Dallas County scored 3 and would use it "tomorrow".
- **Self-hosting and the no-training stance**: cleared the confidentiality objection for every
  institutional persona that raised it.

## Why 97 of 165 were blocked

| Gap (count of personas naming it as a top request)        | What it means                                                                                    |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Coverage outside Texas: 82 (and 98 list it as a data gap) | Two counties cannot serve a national product. Expected; it is the roadmap, not a sprint.         |
| Zoning and permits: 31                                    | Development and site selection were blocked 16 of 16. Not in scope for v0.x.                     |
| OCR for scanned leases: 28                                | Most real lease archives are scans; the ingestion prototype cannot read them at all.             |
| Building specs: 24                                        | Clear height, docks, power, lab/hotel fields. The registry stops at area and year built.         |
| Rules for other jurisdictions: 20                         | One Texas rule reads as "a Texas product" to everyone else.                                      |
| SOC 2 / VPC / SSO: 18                                     | A single shared bearer key fails every security questionnaire. Self-host is the only path today. |
| Debt and tenant data: 17 each                             | Not in any public roll; a later data phase.                                                      |
| Lease comps 15, sales comps 12                            | Texas is non-disclosure; out of scope by policy.                                                 |
| More Texas counties: 13                                   | Travis, Tarrant, Collin are archived but not parsed.                                             |
| Fuzzy owner matching: 12                                  | Exact names leave 27% of organisation owners unlinked.                                           |
| Value–quote check: 11                                     | A quote can exist while the value misreads it; fatal for a 98% critical-date bar.                |
| Rent-roll / estoppel ingestion: 11                        | Underwriting roles want the Excel read, not only the lease.                                      |
| Not on npm 10, no hosted endpoint 8                       | "Build a TypeScript monorepo" is a wall for small firms.                                         |

## Decisions taken from this round

Done in the repository immediately after the round (see the changelog):

1. **Value–quote consistency check** in ingestion (backlog C9): the numbers and dates in a value must
   appear in the cited quote, or the fact is rejected.
2. **OCR hook for scanned pages**: pages without a text layer go through a pluggable OCR backend
   before extraction, and OCR'd text is labelled as such in provenance.
3. **Fuzzy owner matching with a review queue** (C2): near-matches become reviewable candidates
   instead of silent misses; nothing is linked without a human decision.
4. **Per-key API keys, rate limits, and usage metering** on the hosted server (C12): the first
   question on every security questionnaire, and the basis of usage pricing.
5. **A release process** (C16): versioning, changelog, and publish workflows, so `npx @factlot/mcp`
   and `pip install factlot` work as soon as the npm and PyPI accounts exist.
6. **Tarrant County adapter**: the third-largest Texas market, from the file already archived.
7. **Honest positioning**: the README now says what FactLot covers today (Texas, three counties)
   instead of implying national coverage.

Not changed, and why:

- **Coverage outside Texas, zoning, specs, debt, tenants, comps.** These are data programmes, not
  features. The weekly collector is the mechanism; each new state needs its own source review
  under the data policy. The order will follow real interviews, not this simulation.
- **Rules for other jurisdictions.** Each rule must be verified against the official text by a
  person; none is written until it can be.
- **SOC 2.** A process and an auditor, not code. The key and metering work above is the
  prerequisite.
- **Bench results.** Needs an API key and approved spend (backlog A3).

## Caveats

Every persona and every reviewer came from the same model family, so the responses are correlated
and the scores are not calibrated to anything. Personas were told to judge v0.1 harshly on today's
state, which they did; a real user who only needs Harris County CAM math would score higher than
this mean. The quotes read well because a language model wrote them. Treat the ranking of gaps as
the finding, and nothing else.
