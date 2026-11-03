# Financial model: 36 months, bottom-up

**Status: a model, not a forecast (2026-11-03).** FactLot has no customers, nothing on npm or
PyPI, and no public endpoint. Every revenue line below is therefore an assumption multiplied by
another assumption. The point of the model is to show which assumptions matter, what they cost
to be wrong about, and how much cash the founder needs under three scenarios. Costs are better
grounded than revenue: most are public price lists, read on 2026-11-03 and cited in
[market.md](market.md) or below.

The monthly lines are in [`model.csv`](model.csv): one row per line item per scenario, one
column per month (`M01` = December 2026, `M36` = November 2029), plus a `total` column (the sum
for flows, the month-36 value for stocks such as account counts). Load it into any spreadsheet.
The arithmetic that produced it is written out in section 4 so it can be rebuilt.

Companion documents: the [business plan](plan.md) and the [market study](market.md).

## 1. Headline numbers

| Scenario | MRR month 12 | MRR month 24 | MRR month 36 | **ARR at month 36** | Revenue, 3 years | Costs, 3 years | Peak cash need | First net-positive month | Net-positive every month from |
| -------- | ------------ | ------------ | ------------ | ------------------- | ---------------- | -------------- | -------------- | ------------------------ | ----------------------------- |
| Low      | $2,825       | $8,094       | $13,314      | **$160k**           | $178k            | $321k          | $158k          | 30                       | 34                            |
| Base     | $9,319       | $34,026      | $71,069      | **$853k**           | $910k            | $556k          | $120k          | 11                       | 26                            |
| High     | $34,918      | $133,159     | $342,020     | **$4.10M**          | $3.91M           | $856k          | $81k           | 8                        | 11                            |

"Peak cash need" is the deepest point of cumulative cash flow: the money the founder must have,
or raise, to get through the model without running out. In the base case the business is
net-positive from month 11 except for the one-off SOC 2 audits in months 13 and 25.

**Runway.** Nothing in the repository states the founder's starting cash, so runway is shown for
three hypothetical balances. "36+" means the balance lasts the whole model.

| Starting cash | Low   | Base  | High |
| ------------- | ----- | ----- | ---- |
| $100,000      | 11 mo | 12 mo | 36+  |
| $250,000      | 36+   | 36+   | 36+  |
| $500,000      | 36+   | 36+   | 36+  |

Most of the cash need is the founder's own salary ($77,508 a year including employer FICA). With
no salary the peak need falls to $27k (low), $36k (base), and $19k (high): the company itself is
cheap to run; the question is how long one person can go unpaid.

**Where month-36 revenue comes from (base):** enterprise contracts $46,849 (66%), Team plans
$13,433 (19%), Pro plans $8,860 (12%), ingest $1,927 (3%). The business is an enterprise data
business with a self-serve funnel feeding it, not the reverse. That is the main thing to notice.

## 2. Every assumption, with a one-line rationale

Prices and costs marked **fact** come from a cited public page; everything else is an
**assumption**. The low / base / high columns are the three scenarios.

### 2.1 Revenue drivers

| #   | Assumption                                              | Low                                                    | Base                                         | High                                         | Kind       | Rationale                                                                                                                                                                                                                                                                                                |
| --- | ------------------------------------------------------- | ------------------------------------------------------ | -------------------------------------------- | -------------------------------------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | New free hosted accounts, month 1                       | 15                                                     | 20                                           | 30                                           | assumption | Launch month: npm and PyPI publish plus the public endpoint; a niche developer tool with no marketing. No comparable company publishes launch-month signups.                                                                                                                                             |
| R2  | Monthly growth in new signups, months 1–24              | 6%                                                     | 10%                                          | 14%                                          | assumption | Directory listings (C13), Bench results (C14), and word of mouth. 10% a month is 3.1× a year; Supabase reported developer growth far higher but from a far larger market (its Series F post, read 2026-11-03, [link](https://supabase.com/blog/supabase-series-f)).                                      |
| R3  | Monthly growth in new signups, months 25–36             | 3%                                                     | 5%                                           | 6%                                           | assumption | A niche saturates; growth slows as the easy integrations are done.                                                                                                                                                                                                                                       |
| R4  | Free-to-Pro conversion, applied two months after signup | 2%                                                     | 4%                                           | 6%                                           | assumption | OpenView's 2023 benchmark puts developer-focused freemium at a median of 5% and "good" self-serve at 3–5% ([Lenny's Newsletter](https://www.lennysnewsletter.com/p/what-is-a-good-free-to-paid-conversion), read 2026-11-03). Base is below the median because the free tier covers most small-firm use. |
| R5  | Pro monthly churn                                       | 5%                                                     | 3%                                           | 2%                                           | assumption | Small-business SaaS churn; no FactLot data. Usage-based products with embedded IDs should churn less once IDs are in customers' data (the switching-cost argument in [business-model.md](../business-model.md)).                                                                                         |
| R6  | Pro average revenue per account per month               | $69                                                    | $79                                          | $95                                          | assumption | $49 base (section 3) plus registry overage: 4,000 / 6,000 / 9,200 calls over the included 10,000 at $0.005. Excludes ingest, which is R10–R12.                                                                                                                                                           |
| R7  | Pro-to-Team upgrades per month, share of Pro accounts   | 1.0%                                                   | 1.5%                                         | 2.0%                                         | assumption | Teams that need SSO, audit logs, or webhooks; the simulated feedback round put SOC 2 / SSO as a top-ten gap (18 of 165, not evidence).                                                                                                                                                                   |
| R8  | Team monthly churn                                      | 2.5%                                                   | 1.5%                                         | 1.0%                                         | assumption | Lower than Pro: more integration, more people depending on it.                                                                                                                                                                                                                                           |
| R9  | Team average revenue per account per month              | $750                                                   | $850                                         | $950                                         | assumption | $599 base (Supabase Team is $599, [fact](https://supabase.com/pricing)) plus overage at $0.003–$0.005 per call.                                                                                                                                                                                          |
| R10 | Share of Pro / Team accounts that use hosted ingest     | 20% / 50%                                              | 30% / 60%                                    | 35% / 70%                                    | assumption | Ingest was the top-rated offering in the simulated survey (3.52 / 5, not evidence), but many firms will self-host it for confidentiality, which earns nothing.                                                                                                                                           |
| R11 | Ingest pages per month, Pro / Team accounts             | 100 / 1,000                                            | 150 / 1,500                                  | 200 / 2,500                                  | assumption | A lease is 40–120 pages; a Pro account abstracts one or two leases a month, a Team account a small portfolio.                                                                                                                                                                                            |
| R12 | Ingest price per page                                   | $0.10                                                  | $0.10                                        | $0.10                                        | assumption | Inside the $0.05–0.15 hypothesis range; raw OCR costs $0.0015 a page at AWS Textract ([fact](https://aws.amazon.com/textract/pricing/)) and model extraction about $0.01–0.02 (C4).                                                                                                                      |
| R13 | First enterprise contract, month                        | 12                                                     | 8                                            | 6                                            | assumption | Discovery interviews run months 1–3, the decision gate is month 4 ([customer discovery](../customer-discovery.md)), paid pilots convert to annual contracts about three months later in the base case.                                                                                                   |
| R14 | Enterprise contract cadence                             | one every 6 months                                     | one every 3 months to month 20, then every 2 | one every 2 months to month 18, then monthly | assumption | A solo founder closes slowly; SOC 2 Type 1 (month 13 base) is the gate for the second wave. The high case assumes a design-partner referral loop.                                                                                                                                                        |
| R15 | Enterprise annual contract value                        | $30,000                                                | $48,000                                      | $90,000                                      | assumption | The kill signal in H3 is "no buyer at $2,000 a month"; base is $4,000 a month. Placekey Enterprise starts at $40,000 a year ([fact](https://www.placekey.io/pricing)); the simulated institutional budget was $7,500 a month (not evidence).                                                             |
| R16 | Enterprise annual churn                                 | 15%                                                    | 10%                                          | 8%                                           | assumption | Annual contracts; usage-based companies reported median net revenue retention of 108% in 2025 ([Aleph × Benchmarkit](https://www.getaleph.com/answers/net-revenue-retention-saas-2026), read 2026-11-03), so 10% gross churn without expansion is conservative.                                          |
| R17 | Registry calls per month by account type                | free 300, Pro 20,000, Team 200,000, enterprise 500,000 | same                                         | same                                         | assumption | Drives hosting cost only (C2). Free accounts mostly use local tools; enterprise agents resolve every parcel they touch.                                                                                                                                                                                  |

### 2.2 Prices (the proposal under test)

| #   | Plan       | Price                                                                                          | Kind       | Comparable (fact, read 2026-11-03)                                                                                                                                                               |
| --- | ---------- | ---------------------------------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| P1  | Free       | Local tools unlimited; hosted 1,000 registry calls and 100 ingest pages a month                | assumption | Placekey free tier 10,000 lookups a day; Google Geocoding 10,000 a month free ([pricing](https://developers.google.com/maps/billing-and-pricing/pricing))                                        |
| P2  | Pro        | $49 a month with 10,000 calls and 200 pages; $0.005 per extra call; $0.10 per page             | assumption | Google Geocoding $5.00 per 1,000 at the first paid tier; Melissa $0.012 per US address ([pricing](https://www.melissa.com/pricing)); Supabase Pro $25                                            |
| P3  | Team       | $599 a month with 200,000 calls and 2,000 pages, SSO, audit logs, webhooks; same overage rates | assumption | Supabase Team $599 ([pricing](https://supabase.com/pricing)); Placekey Silver $3,000 a year for 6M lookups                                                                                       |
| P4  | Enterprise | From $48,000 a year: VPC or on-prem, no-training terms, SOC 2 report, SLA, invoicing           | assumption | Placekey Enterprise from $40,000 a year; CoStar about $592–$691 per seat per month in public awards (secondary, [thepricer.org](https://www.thepricer.org/how-much-does-costar-membership-cost)) |
| P5  | All plans  | No per-seat pricing anywhere                                                                   | decision   | Revenue should scale with agent calls ([business-model.md](../business-model.md)).                                                                                                               |

### 2.3 Costs

| #   | Cost line                                    | Amount                                                                                                                                                                                                                                                                                                                      | Kind                                | Source or rationale                                                                                                                                                                                                                                                                                                                                                                                                           |
| --- | -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C1  | Founder salary                               | $6,000 a month from month 1, plus 7.65% employer FICA ($6,459 a month), same in every scenario                                                                                                                                                                                                                              | assumption                          | Pilot's 2025 founder salary report: Texas median $70,000, other US $65,000, 60% pay themselves under $100,000 ([pilot.com](https://pilot.com/report/founder-salary-2025), read 2026-11-03). Kruze's seed-stage CEO average is $153,000 ([kruzeconsulting.com](https://kruzeconsulting.com/blog/startup-ceo-salary-report)), which is a venture-funded figure. FICA from [IRS Topic 751](https://www.irs.gov/taxtopics/tc751). |
| C2  | Hosting: registry and server                 | $83.89 a month fixed (Fly.io performance-2x 4 GB $66.00 + 30 GB volume at $0.15/GB + staging shared-cpu-2x $13.39), plus $66.00 per additional machine per 5 million calls a month                                                                                                                                          | fact (prices), assumption (sizing)  | [Fly.io pricing](https://docs.fly.io/about/pricing), read 2026-11-03. The registry is a 9.3 GB SQLite file read by a stateless Node service; one machine serves it. Hetzner CX33 at €8.99 a month would be cheaper but is priced in euros only.                                                                                                                                                                               |
| C3  | Hosting: snapshot storage                    | Cloudflare R2 at $0.015 per GB-month; 60 GB at month 1 growing 15 GB a month (the weekly collector archives 3.8 GB per Texas run; other states add to it)                                                                                                                                                                   | fact (price), assumption (growth)   | [R2 pricing](https://developers.cloudflare.com/r2/pricing/), read 2026-11-03. GitHub release assets stay the primary archive (free for public repositories, 2 GiB per file, [docs](https://docs.github.com/en/repositories/releasing-projects-on-github/about-releases)).                                                                                                                                                     |
| C4  | Model API spend                              | $300 a month fixed (Bench runs, ingest accuracy work) plus $0.02 per billed ingest page                                                                                                                                                                                                                                     | fact (prices), assumption (volume)  | Anthropic's mid-tier model is listed at $2 / $10 per million input / output tokens ([pricing](https://platform.claude.com/docs/en/about-claude/pricing), read 2026-11-03); a page at about 3,000 input and 500 output tokens costs about $0.011, rounded up for retries and OCR.                                                                                                                                              |
| C5  | Tooling SaaS                                 | $81 a month: Sentry Team $29, Better Stack $25, Postmark $15, Google Workspace Business Starter $7, GitHub Team $4, domain about $1                                                                                                                                                                                         | fact                                | [Sentry](https://sentry.io/pricing/), [Better Stack](https://betterstack.com/pricing), [Postmark](https://postmarkapp.com/pricing), [Workspace](https://workspace.google.com/pricing), [GitHub](https://github.com/pricing), all read 2026-11-03.                                                                                                                                                                             |
| C6  | Data purchases, gated sources                | Base and high only: North Carolina SOS $750 setup + $2,000 a year (month 4); Minnesota SOS $710 (month 6); Georgia SOS $1,000 (month 8); Arizona SOS up to $1,000 (month 10); Massachusetts SOS $4,800 a year (month 12); Clark County assessor $300 a month from month 12. Annual renewals assumed. Low case buys nothing. | fact (prices), assumption (timing)  | Prices as recorded in the [source catalog](../registry/sources/README.md). **Every one of these carries a use-only or no-resale clause that may rule out an open registry; the model assumes the legal question (backlog E) is settled in FactLot's favour.** Year 2 total $13,110.                                                                                                                                           |
| C7  | Data cost, verified sources                  | $0                                                                                                                                                                                                                                                                                                                          | fact                                | Public records at no charge; the collector's only cost is C2–C3.                                                                                                                                                                                                                                                                                                                                                              |
| C8  | Contractor: data review                      | $800 a month from month 4 (20 hours at $40)                                                                                                                                                                                                                                                                                 | assumption                          | Works the owner-match review queue (6,149 rows queued on Texas alone) and the source gates. Upwork's technical-writer range is $30–60 an hour ([upwork.com](https://www.upwork.com/hire/technical-writers/cost/), snippet); no published data-operations rate was found.                                                                                                                                                      |
| C9  | Contractor: engineering                      | Low: none. Base: 40 hours a month from month 13, 80 from month 25. High: 80 from month 7, 160 from month 19. $80 an hour.                                                                                                                                                                                                   | assumption                          | Arc.dev lists freelance TypeScript developers at $60–100+ an hour ([arc.dev](https://arc.dev/hire-developers/typescript), read 2026-11-03). Starts when revenue, not hope, pays for it.                                                                                                                                                                                                                                       |
| C10 | Legal and formation, month 1                 | $5,700: terms of service and privacy policy $3,500; USPTO trademark $350 per class × 2; trademark attorney $1,000; Stripe Atlas $500                                                                                                                                                                                        | fact (fees), assumption (attorney)  | USPTO fee schedule effective 2025-01-18 ([uspto.gov](https://www.uspto.gov/trademarks/trademark-fee-information)); ContractsCounsel puts a startup ToS + privacy policy at $2,000–5,000 for a company handling user data ([link](https://www.contractscounsel.com/b/terms-of-service-and-privacy-policy-cost), updated 2026-10-30); Stripe Atlas $500 ([docs](https://docs.stripe.com/atlas/signup)).                         |
| C11 | Legal review of the data policy, month 2     | $5,000                                                                                                                                                                                                                                                                                                                      | assumption                          | Backlog A11. No public price for this specific review; it is a few hours of a privacy lawyer's time at law-firm rates.                                                                                                                                                                                                                                                                                                        |
| C12 | SOC 2                                        | Type 1 $30,000 all-in (base month 13, high month 10); Type 2 $25,000 (base month 25, high month 22); low case none                                                                                                                                                                                                          | fact (range), assumption (point)    | Vanta: a first SOC 2 costs "$10,000 to $80,000 or more" ([vanta.com](https://www.vanta.com/collection/soc-2/audit/soc-2-audit-cost)); Secureframe: Type 1 audit $5–20k, readiness about $15k ([secureframe.com](https://secureframe.com/hub/soc-2/audit-cost)), both read 2026-11-03.                                                                                                                                         |
| C13 | Registered agent renewal                     | $100 a year from year 2                                                                                                                                                                                                                                                                                                     | fact                                | Stripe Atlas renewal rate ([docs](https://docs.stripe.com/atlas/signup)).                                                                                                                                                                                                                                                                                                                                                     |
| C14 | Insurance                                    | $550 a month (E&O $3,700 + cyber $2,900 a year) from the first enterprise contract                                                                                                                                                                                                                                          | fact (medians)                      | Vouch startup medians, 2026-05-21 ([vouch.us](https://www.vouch.us/blog/startup-insurance-costs)), read 2026-11-03. D&O is excluded until there are outside investors.                                                                                                                                                                                                                                                        |
| C15 | Conferences                                  | $3,000 twice a year (months 3, 9, 15, 21, 27, 33)                                                                                                                                                                                                                                                                           | fact (tickets), assumption (travel) | CREtech New York general ticket $1,795, early-stage startup $1,145 ([cretech.com](https://cretech.com/register)); MBA CREF member $1,299–1,599 ([mba.org](https://www.mba.org/conferences-and-education/cref-convention-expo/pricing-and-policies), snippet); plus about $1,500 travel.                                                                                                                                       |
| C16 | Paid advertising                             | Low: none. Base: $500 a month from month 13. High: $1,000 from month 7.                                                                                                                                                                                                                                                     | assumption                          | B2B search clicks cost about $5–12 (LocalIQ 2026 benchmarks, [link](https://localiq.com/blog/search-advertising-benchmarks/); Search Engine Land LinkedIn CPC $11.12, snippet). $500 buys roughly 50–100 clicks: a test, not a channel.                                                                                                                                                                                       |
| C17 | Payment processing                           | 3.6% of self-serve revenue (Stripe 2.9% + Billing 0.7%) plus $0.30 per paying account per month; 0.4% of enterprise invoices                                                                                                                                                                                                | fact                                | [stripe.com/pricing](https://stripe.com/pricing), read 2026-11-03.                                                                                                                                                                                                                                                                                                                                                            |
| C18 | Office, travel beyond conferences, equipment | $0                                                                                                                                                                                                                                                                                                                          | assumption                          | Solo founder working remotely; add a line if that changes.                                                                                                                                                                                                                                                                                                                                                                    |

### 2.4 What is deliberately left out

- **Fundraising.** No equity round is modelled; runway is shown against hypothetical balances.
- **Hiring.** No employees in 36 months; engineering is contracted (C9). A first hire at a
  US salary would add roughly $150,000–200,000 a year including taxes and would need the high
  case's revenue to pay for it.
- **Expansion revenue** inside enterprise accounts (price increases, more agents). Net revenue
  retention above 100% is common in usage-based companies (R16) and would raise every scenario.
- **Rights clearinghouse and write-backs** (roadmap "Then"): no revenue assumed.
- **Taxes on profit.** The base case shows cumulative cash of $354k at month 36 before any
  income tax.

## 3. Year by year (base case)

| Line                    | Year 1   | Year 2   | Year 3   |
| ----------------------- | -------- | -------- | -------- |
| Pro plans               | $4,228   | $24,115  | $74,014  |
| Team plans              | $1,853   | $22,965  | $99,067  |
| Ingest                  | $437     | $3,805   | $14,705  |
| Enterprise contracts    | $27,636  | $197,943 | $439,382 |
| **Revenue**             | $34,154  | $248,828 | $627,169 |
| Founder salary + FICA   | $77,508  | $77,508  | $77,508  |
| Hosting                 | $1,032   | $1,131   | $2,153   |
| Tooling SaaS            | $972     | $972     | $972     |
| Model API spend         | $3,687   | $4,361   | $6,541   |
| Data purchases          | $10,560  | $13,110  | $13,110  |
| Contractors             | $7,200   | $48,000  | $86,400  |
| Legal, trademark, SOC 2 | $10,700  | $30,100  | $25,100  |
| Insurance               | $2,750   | $6,600   | $6,600   |
| Go-to-market            | $6,000   | $12,000  | $12,000  |
| Payment processing      | $362     | $2,723   | $8,834   |
| **Costs**               | $120,772 | $196,505 | $239,218 |
| **Net**                 | -$86,617 | $52,323  | $387,951 |

Base-case stocks at months 12 / 24 / 36: cumulative free accounts 428 / 1,770 / 4,763; active
Pro accounts 11 / 43 / 112; Team accounts 1 / 4 / 16; enterprise contracts 2 / 7 / 12; registry
calls served 1.4M / 5.6M / 12.7M a month; ingest pages 1,043 / 5,860 / 19,270 a month.

Hosting stays under $200 a month in every scenario because a deterministic lookup against a
local SQLite file is cheap to serve; the cost of this business is people and compliance, not
compute. The gross margin on self-serve revenue is above 90% once the fixed costs are covered.

## 4. How the numbers are computed

Each month `m` (1–36), per scenario:

- `signups[m] = R1 × (1 + R2)^min(m−1, 23) × (1 + R3)^max(m−24, 0)`
- `pro[m] = pro[m−1] × (1 − R5) + R4 × signups[m−2] − upgrades[m]`, with
  `upgrades[m] = R7 × pro[m−1]`
- `team[m] = team[m−1] × (1 − R8) + upgrades[m]`
- `enterprise[m] = enterprise[m−1] × (1 − R16 / 12) + 1` in a contract month (R13, R14)
- `pages[m] = R10_pro × pro[m] × R11_pro + R10_team × team[m] × R11_team`
- `calls[m] = 300 × free[m] + 20,000 × pro[m] + 200,000 × team[m] + 500,000 × enterprise[m]`
- Revenue: `pro[m] × R6 + team[m] × R9 + pages[m] × R12 + enterprise[m] × R15 / 12`
- Hosting: `83.89 + 66 × floor(calls[m] / 5,000,000) + 0.015 × (60 + 15 × (m − 1))`
- Model API: `300 + 0.02 × pages[m]`
- Payment processing: `0.036 × self-serve revenue + 0.30 × (pro[m] + team[m]) + 0.004 × enterprise revenue`
- Other cost lines are the schedules in section 2.3.
- `net[m] = revenue[m] − costs[m]`; `cumulative[m] = cumulative[m−1] + net[m]`; peak cash need
  is `−min(cumulative)`; runway at a starting balance is the number of months before
  `balance + cumulative[m]` goes below zero.

Accounts are carried as fractions (2.4 enterprise contracts), which is normal in a model and
wrong in reality: real revenue arrives in steps.

## 5. The five assumptions to validate first

In order of how much month-36 revenue moves when they are wrong:

1. **R15 and R13–R14, enterprise contract value and cadence.** Two thirds of base revenue. The
   test is H3 in the customer discovery plan: three letters of intent or paid pilots at $2,000 a
   month or more by the week-6 decision gate.
2. **R4, free-to-Pro conversion at 4%.** Measured directly once the public endpoint and API keys
   exist (C12 is built; A4 and A5 are the blockers). Two months of real signups replace this
   number.
3. **P2, $0.005 per registry call.** Whether a cited owner-of-record fact is worth a geocode or
   ten is a question for the first ten paying accounts; the model is linear in it.
4. **C6, the legal standing of purchased entity files.** If no-resale clauses bar an open
   registry, the gated states stay out, the geography filter in [market.md](market.md) shrinks,
   and $13,110 a year is saved. Settle it before paying anything.
5. **C1, the founder salary.** It is 64% of base-case costs in year 1. Every month it is $0
   shortens the cash need by $6,459; every month it is a market salary ($12,750 at Kruze's seed
   average) roughly doubles it.
