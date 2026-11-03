# Business model

**Status: hypothesis.** The numbers below come from a simulated survey and from
comparable companies. They are not validated. Each one is a target for
[customer discovery](customer-discovery.md).

The worked-out version of this model is under `docs/business/`: the
[business plan](business/plan.md), the [36-month financial model](business/model.md) (monthly
lines in [model.csv](business/model.csv)), and the
[market sizing, competition, and pricing study](business/market.md), which replaces the ranges
below with proposed prices compared against public price lists.

## The model: open core with a hosted cloud (like Supabase)

Supabase licenses its platform under Apache-2.0 and its client SDKs under MIT, and
it earns money from a hosted cloud with a free tier and usage-based paid plans.
FactLot copies that structure:

| Layer           | What                                                                                          | License or price                |
| --------------- | --------------------------------------------------------------------------------------------- | ------------------------------- |
| Schema and SDKs | `@factlot/schema` and future client SDKs                                                      | MIT, free                       |
| Engine          | `@factlot/calc`, `@factlot/id`, `@factlot/mcp`, and later the ingest and registry server code | Apache-2.0, free, self-hostable |
| FactLot Cloud   | Hosted registry, ingest, and rules, plus SLAs, SOC 2, and support                             | Usage-based                     |
| Enterprise      | Private VPC or on-prem deployment, no-training guarantee, audit logs, SSO                     | Annual contract                 |

**Why open source:**

- **Distribution.** An agent framework or vendor can add FactLot to its tool list
  in one line, with no procurement and no API key. That is how FactLot becomes
  the default.
- **Trust.** Calculators and ID rules that anyone can audit are the point of
  the product.
- **Confidentiality.** Many firms will only process leases inside their own
  infrastructure.

Open source is not the moat. In the survey only 16% of personas rated open source
as highly important. The moat comes from the hosted data and the network effects
described below.

## Revenue engines, in order of build

1. **FactLot Registry.** This is the hosted service that resolves, crosswalks, and
   maintains the identity graph. It covers parcel to building to space, owner
   LLC to beneficial owner and sponsor, lender, and loan, and tenant to parent
   company. It sends webhooks when ownership, debt, or parcel lineage changes.
   - Priced per resolution call, plus subscriptions for change feeds.
   - Moat: building the public-records pipeline across about 3,100 US counties is
     expensive and slow, and once FactLot IDs are embedded in customers' data,
     switching away is costly.
2. **FactLot Ingest.** Documents go in (leases, amendments, rent rolls, T-12s,
   OMs, estoppels) and cited facts come out.
   - Priced per page, and also available self-hosted.
   - Moat: accuracy on a public benchmark (FactLot Bench) and correct handling of
     amendments, meaning which clause overrides which.
3. **FactLot Rules.** Jurisdiction logic packaged as code: property tax deadlines,
   caps, and appeal math; building-performance standards (LL97, BERDO, and
   others); zoning envelopes. Each rule is versioned and cites its statute.
   - Priced per call or per jurisdiction pack. This is the Avalara pattern applied
     to CRE.
   - In the survey, tax-appeal agents scored the property tax and assessments
     option 4.9 out of 5, and development agents scored zoning 4.6.
4. **Enterprise.** Private deployment, SOC 2, data residency, and support. Large
   firms make these a precondition for buying anything.
5. **Later: rights clearinghouse.** Data owners publish facts with
   machine-readable AI-use rights, and FactLot takes a share of each license
   sold.

## Pricing hypotheses (to test, not to publish)

The simulated median budgets were about $300 per month for small firms, $2,000
for mid-market, and $7,500 for institutional. 42% of personas preferred per-call
or usage pricing, and per-seat pricing was a frequent dealbreaker.

| Plan       | Hypothesis                                                                                                       |
| ---------- | ---------------------------------------------------------------------------------------------------------------- |
| Free       | Unlimited local tools. Hosted: about 1,000 registry calls and 100 ingest pages per month.                        |
| Pro        | About $50 per month base plus usage, for example $0.005–0.02 per registry call and $0.05–0.15 per ingested page. |
| Team       | About $600 per month plus usage: SSO, audit logs, higher limits, change webhooks.                                |
| Enterprise | $50k–$250k+ per year: VPC or on-prem, SOC 2 reports, no-training terms, SLAs.                                    |

**No per-seat pricing.** Revenue should grow with agent calls, not headcount. That
lets revenue scale with agent adoption, and it fits how agents are priced.

## Why this can be very large

- **Usage grows with the number of agents.** Every CRE agent that underwrites,
  administers, appraises, or insures a property makes many FactLot calls per task.
- **Deterministic tools cost almost nothing to serve.** Margin comes from data and
  compute, not from people.
- **Network effects.** Each new crosswalk and each ownership change that is
  resolved improves the registry for everyone. Customers who confirm or correct a
  resolution improve it further. This only happens with consent, and only for
  public-record data, never their private documents.

## Segments to target first, by expected profitability

These rankings come from the simulated survey's median budget multiplied by its
fit with FactLot's core offerings. Validate them before acting on them.

1. CRE lenders and debt underwriting (budget about $5k per month, strong need for ingest and calculators)
2. Corporate occupier portfolio teams (about $4.5k, need lease facts, calculators, and ASC 842)
3. Insurance underwriting (about $3.75k, need IDs, specs, and permits)
4. Lease administration (about $2.75k; strongest fit with FactLot's core of any role)
5. Appraisal, property tax appeal, and due diligence and legal (about $2.5–2.75k; heavy use of citations and rules)

Small owners and 1031 investors are a distribution channel through the free tier
and open source. They are not a revenue segment.

## Risks

- **Incumbents ship equivalents.** ATTOM, Green Street, and others already offer MCP
  servers, and CoStar and Cherre could add more.
  - Mitigation: neutrality, open IDs that interoperate with their keys, and
    citations they don't provide.
- **The cost of acquiring public records.** Mitigation: start with the top counties
  by commercial value, buy data where licensing allows AI use, and accept
  corrections from the community.
- **Cloud providers hosting the open code themselves.** Mitigation: the code is
  open, but the registry data and the brand are not, and the FactLot name is a
  trademark. This is the Supabase approach.
- **Liability for wrong numbers.** Mitigation: versioned formulas, published test
  vectors, warnings that surface assumptions, and contractual limits on liability.
