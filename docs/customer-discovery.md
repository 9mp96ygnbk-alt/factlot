# Customer discovery plan

The [simulated survey](research/2026-11-agent-survey) produced hypotheses. This
plan tests them with real people and real agents before we commit capital to
the registry.

## What we must learn

| #   | Hypothesis                                                                                                             | Kill signal                                                                       |
| --- | ---------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| H1  | Teams building CRE agents will add a free MCP calculator and ID toolkit by default.                                    | Fewer than 3 of 10 design partners wire it in within two weeks.                   |
| H2  | LLM math and missing citations are top-three blockers in production CRE agents.                                        | Teams report that these are solved, for example with spreadsheets as tools.       |
| H3  | Canonical IDs and entity resolution are worth paying for, specifically at lenders, insurers, and institutional owners. | No buyer will pre-commit, even with a letter of intent, at $2k or more per month. |
| H4  | Usage-based pricing is acceptable to these buyers, and per-seat pricing is not.                                        | Procurement insists on per-seat pricing or on fixed-fee contracts only.           |
| H5  | Data licensing (AI use) is a real blocker that FactLot's rights field helps with.                                      | Buyers say their vendors now permit AI use.                                       |

## Who: every segment, with effort weighted by expected profitability

| Priority | Segment                                                                             | Why                                                         | Interviews |
| -------- | ----------------------------------------------------------------------------------- | ----------------------------------------------------------- | ---------- |
| 1        | CRE lenders (banks, debt funds, CMBS)                                               | Highest budget; ingest and calculators; strict auditability | 8          |
| 1        | Corporate occupier portfolio teams                                                  | Lease facts, ASC 842, and renew-vs-relocate math            | 6          |
| 1        | Insurance underwriting                                                              | IDs, specs, and permits; large budgets                      | 5          |
| 1        | Lease administration (in-house and outsourced)                                      | Strongest fit with FactLot's core                           | 6          |
| 2        | Appraisal, property tax appeal, due diligence and legal                             | Heavy use of citations and rules                            | 9          |
| 2        | Teams building CRE agent products, such as proptech startups and brokerage AI teams | The distribution channel for H1                             | 8          |
| 3        | Acquisitions, asset management, brokers, ESG, development                           | Breadth checks                                              | 8          |
| 3        | Small owners and 1031 investors                                                     | Open-source and free-tier distribution                      | 4          |

That is 54 conversations, roughly 15 per week over 4 weeks.

## Interview script (30 minutes)

1. Tell me about the last time an AI agent or tool did CRE work for you and you
   didn't trust the result. What happened?
2. Walk me through the hardest recurring task you would hand to an agent. Where
   does it break today?
3. Where do the numbers come from? Which systems, PDFs, and vendors? What do your
   data licenses say about using AI?
4. How do you match the same property, owner, or tenant across systems today?
5. If a tool returned every number with its source page and formula, what would
   change? Who would stop checking by hand?
6. What would make you use a provider by default? What would rule one out
   immediately?
7. How do you buy tools like this: per seat, by usage, or by annual contract?
   Who signs?
8. Commitment ask: would you run FactLot's MCP tools in your agent for two weeks
   and share the failure logs?

Do not pitch until question 8. Record what people actually do, not what they say
they would like.

## Agent-side validation (FactLot Bench, in parallel)

Take 20 real tasks from interviews, such as a CAM reconciliation, NER for a
proposal, loan sizing, or "who really owns this parcel". Run frontier agents on
each task twice: with raw PDFs only, and with FactLot tools. Measure accuracy,
citation rate, and time. Publish the harness and results. This is evidence for
H1 and H2, and it markets FactLot.

## Decision gate (week 6)

- **Go on the registry** if H3 has at least 3 letters of intent or paid pilots at
  $2k or more per month, and H1 holds.
- **Otherwise** stay on the fast track (tools, ingest, rules) and revisit which
  segment to sell to.
