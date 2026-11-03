# FactLot business plan

**Status: written 2026-11-03 by a solo founder with no customers.** Everything about demand in
this plan is a hypothesis. The two research rounds in [docs/research](../research/) were
**simulated**: AI subagents role-played 165 personas; no real buyer has been interviewed. Where
this plan cites them it says so. Facts about the market, competitors, and costs are cited to
public sources in [market.md](market.md) and [model.md](model.md); facts about what FactLot has
built are in the [README](../../README.md), the [registry](../registry/README.md), and the
[backlog](../BACKLOG.md).

## 1. The problem

AI agents are being put to work on commercial real estate: underwriting loans, abstracting
leases, appealing property tax assessments, reconciling CAM charges, matching an owner LLC on one
system to a parcel on another. They fail in the same three places:

1. **Arithmetic.** A language model computes net effective rent or a debt-sizing constraint
   differently each time, and cannot show its work.
2. **Citations.** A number without a source document, page, and clause cannot go into a loan
   memo, an appeal filing, or an estoppel. The agent either invents a citation or stops.
3. **Identity.** "Suite 400, 123 Main LLC" in a lease, "0420150000012" on an appraisal roll, and
   "123 MAIN STREET PROPERTIES, L.L.C." at the Secretary of State are one thing, and nothing
   tells the agent so.

Behind all three is a licensing problem: the incumbents' data is sold to people, under terms that
bar automated access and, increasingly, AI use in writing (Regrid's AI policy, LightBox's terms,
Altus's acceptable-use policy, and CoStar's licence language all restrict it; quoted in
[market.md §2](market.md)). A firm that pays for the data often cannot let its agent read it.

## 2. The product: three layers

FactLot follows the Supabase model. The code is open source and free; the hosted services are
paid.

| Layer                   | What it is                                                                                                                                                                                                                                                                                                 | Status (2026-11-03)                                                                                                                                                                                                                                                                                                                   | Price                                                    |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| **Tools** (open source) | Deterministic calculators with audit trails and versioned formulas; FactLot IDs for parcels, entities, buildings, spaces, leases, and documents; the fact schema with provenance and rights; one tool catalog served to Claude, OpenAI, Gemini, Bedrock, Mistral, and OpenAPI clients; a local MCP server. | Built and tested in TypeScript and Python with identical results on shared conformance vectors. **Not yet published** to npm or PyPI (blocked on accounts, backlog A5).                                                                                                                                                               | Free, Apache-2.0 and MIT                                 |
| **Registry** (hosted)   | Cited public-record facts about commercial parcels and the entities that own them, with owner resolution and crosswalks, served through six `registry_*` tools over MCP and REST.                                                                                                                          | **708,538 commercial parcels** from 13 verified sources across Texas, New York City, Los Angeles, San Francisco, Boston, Denver, Hennepin, Mecklenburg, and DC (Philadelphia is loaded but gated on terms); **12.9 million registered entities** from five state registries; 18 verified sources in all. No public endpoint yet (A4). | Usage-based with a free tier ([model.md §2.2](model.md)) |
| **Rules and ingest**    | Rules packs: jurisdiction logic as versioned code that cites its statute. Ingest: leases and amendments become facts whose every value is verified against a verbatim quote on the cited page, with OCR for scans and amendment supersession.                                                              | One verified rules pack (Texas protest deadline, checked against the statute). Ingest is a prototype with no published accuracy number (needs real leases and model spend, A2 and A3).                                                                                                                                                | Per page (ingest) and per call or pack (rules)           |

The server already has what usage pricing needs: named API keys, per-key rate limits, per-key
per-tool metering with a durable usage log, and an admin usage endpoint
([packages/server](../../packages/server/README.md)). What it lacks is a billing integration and
a public URL.

**Data costs $0.** Every verified source is a public record obtained under the
[data policy](../registry/data-policy.md): polite collection, terms recorded, no natural-person
names stored. The gated sources (section 7) cost money or a signature and are the only data
spend in the model.

## 3. Why now

- **Agents need tools, and tool directories are the new app stores.** The official MCP registry
  grew from under 10,000 servers in May 2026 to about 30,000 by September 2026; Glama lists over
  114,000; GitHub has 43,100 repositories tagged `mcp-server` (all read 2026-11-03, cited in
  [market.md §2](market.md)). Anthropic's connector directory and the ChatGPT apps directory are
  both under two years old. A free, correct tool listed early becomes a default.
- **The incumbents have shipped MCP servers but not citations.** ATTOM (January 2026), Regrid
  (August 2026), and Green Street (August 2026) all have one. None returns a per-record source
  document, and all three restrict AI use in their terms. The gap FactLot fills is not "an MCP
  server for CRE"; it is "facts an agent may use and cite".
- **Public records are free and increasingly machine-readable.** New York City, Boston, Denver,
  DC, and Texas publish full rolls under open or public-record terms; FactLot loaded 708,538
  commercial parcels in a week with no data budget. That was not possible at this cost five
  years ago, and it is the raw material of the registry.
- **Model cost has fallen far enough to make verified extraction cheap.** Extracting a lease
  page costs about a cent at current list prices (model.md C4); the deterministic verifier makes
  that extraction trustworthy. OCR is free (tesseract).

## 4. Customers and segments

**All of this is simulated and must be replaced by the 54 interviews in
[customer-discovery.md](../customer-discovery.md).** The segments below come from the simulated
165-persona survey's median budget multiplied by its fit with FactLot's core; the budgets are
invented and the personas are correlated. Real firm counts for each segment are in
[market.md §1](market.md).

| Priority | Segment (simulated ranking)                             | Why they might pay                                         | Real universe (cited in market.md)                                                                                         | FactLot plan     |
| -------- | ------------------------------------------------------- | ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| 1        | CRE lenders and debt underwriting                       | Ingest and calculators; auditability for credit committees | About 4,150 banks with CRE loans; 1,778 credit unions with commercial loans; 711 life insurers; 129 MBA-ranked originators | Enterprise, Team |
| 1        | Corporate occupier portfolio teams                      | Lease facts, ASC 842, renew-vs-relocate math               | Not counted separately (inside large corporations)                                                                         | Enterprise       |
| 1        | Insurance underwriting                                  | IDs, building specs, permits                               | Not counted; specs are not in the registry yet                                                                             | Enterprise       |
| 1        | Lease administration                                    | Strongest fit: ingest, citations, calculators              | 15,914 nonresidential property-management firms, 1,596 with 20+ employees                                                  | Team, Pro        |
| 2        | Appraisal, property tax appeal, due diligence and legal | Citations and rules; the Texas protest rule exists today   | 12,861 appraisal firms; 40,583 Certified General credentials; 2,318 Texas property tax consultants                         | Pro, Team        |
| 2        | Teams building CRE agent products                       | The distribution channel; they embed FactLot               | 3,108 PropTech organisations on Crunchbase; 123 CRE-focused AI companies (Bisnow)                                          | Team, reseller   |
| 3        | Owners, asset managers, brokers, ESG, development       | Breadth; calculators and IDs today, registry later         | 101,217 lessor firms (1,507 with 100+ employees); 180–195 listed REITs; 34,329 NAR commercial-primary members              | Pro, Team        |
| 3        | Small owners and 1031 investors                         | Free tier and open source; a channel, not revenue          | Most of the 96,756 lessor firms under 20 employees                                                                         | Free             |

What the simulated product-feedback round said about v0.1 (also simulated, not evidence): the
calculators, IDs, and quote-on-page verifier were praised wherever they applied; 97 of 165
personas were blocked by coverage. The honest reading is that the tools are ready for anyone and
the registry is ready for firms working in the ten loaded metros.

## 5. Go-to-market, in phases

**Phase 0, now to month 3: exist.** Publish `@factlot/*` to npm and `factlot` to PyPI (A5,
C16 is built), stand up `mcp.factlot.com` on a Docker host (A4), submit to the MCP registry,
Anthropic connector directory, ChatGPT apps, and Copilot (C13), and publish FactLot Bench results
on current models (C14, needs A3). Run the 54 discovery interviews (A8). Revenue: none expected.

**Phase 1, months 3–9: design partners.** Ten design partners run the MCP tools in a real agent
for two weeks and share failure logs (H1). Convert three to paid pilots at $2,000 a month or more
(H3) or stop building the registry and stay on tools, ingest, and rules. Ship the billing
integration on top of the existing metering, the Free and Pro plans, and the first enterprise
contract (base case: month 8).

**Phase 2, months 9–18: the registry as a product.** Clear the Tier 1 gates that legal review
allows (E), close owner-name gaps in Los Angeles and San Francisco, add change webhooks (C5),
crosswalks (C6), and Team plan features (SSO, audit logs). SOC 2 Type 1 (base: month 13), which
is the precondition for every enterprise security questionnaire. Rules packs for New York,
Illinois, and California property tax (C7).

**Phase 3, months 18–36: expand.** More counties toward the top 100 by commercial value,
beneficial ownership (C3), debt and loan data (C4), ingest accuracy published on a public gold
set (B12), and a reseller rate for PropTech vendors who embed FactLot. SOC 2 Type 2.

**Channels, in order of cost.** (1) Tool directories and the open-source packages, which are
free and reach every agent builder. (2) Bench results and per-source review records, which are
the content. (3) Design-partner referrals. (4) Two conferences a year (CREtech, MBA CREF). (5) A
small paid-search test from month 13. No sales hire in 36 months.

## 6. Competition and moat

The deep dive, with prices and quoted terms, is in [market.md §2](market.md). In short:

| Competitor group                             | What they sell                                        | Where FactLot differs                                                                                                               |
| -------------------------------------------- | ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| CoStar                                       | The market-data terminal; per seat, no API, no AI use | FactLot is an API for agents, not a terminal for people; open IDs; citations                                                        |
| Reonomy (Altus), Cherre                      | Property and owner data for people and data teams     | Both restrict derivative works and AI use; neither cites source documents; FactLot's facts carry rights an agent can check          |
| ATTOM, Regrid, LightBox, Cotality, ReportAll | Nationwide parcel and property files and APIs         | Far more coverage than FactLot; no per-record citations; AI-training bans in writing; FactLot prices per cited fact, not per parcel |
| Placekey, GLEIF LEI                          | Identifiers                                           | Allies, not competitors: FactLot IDs are deterministic and crosswalk to them                                                        |
| Open data (OpenAddresses, city portals)      | Free files                                            | FactLot's registry is built from them and adds IDs, owner resolution, currency, and provenance                                      |

**The moat is not open source** (only 16% of simulated personas rated it highly important). It
is:

1. **Citations and rights on every fact.** No vendor in the deep dive returns a source document
   and page per record. Copying this requires rebuilding the pipeline around provenance, which
   the incumbents' licences and data models resist.
2. **IDs embedded in customers' data.** Once a lender's loan tape carries FactLot parcel and
   entity IDs, switching costs rise with every record.
3. **The public-records pipeline.** Forty-seven source reviews, thirty-three adapters, a polite
   collector, and a review queue for owner matching are slow, unglamorous work that compounds
   county by county.
4. **Neutrality.** FactLot interoperates with CoStar's, Yardi's, and MRI's keys instead of
   competing for the terminal; an agent vendor can adopt it without choosing a side.

## 7. Risks

| Risk                                                                                                                                                                                                                                                                                                                                          | What the plan does about it                                                                                                                                                                                                                |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Terms and legal standing of public records.** Nine "gated: terms" sources (Florida, Cook County, Philadelphia, Fulton, Wayne, Fairfax, Alameda, Riverside, San Bernardino) are public records whose websites do not grant redistribution in so many words. Two loaded sources (Tarrant, Mecklenburg) signal "no AI training" in robots.txt. | Legal review of the data policy before going live (A11, $5,000 in the model). Ask publishers for a statement where the policy does not settle it. Store no natural-person names. Record every decision per source.                         |
| **Data purchases with no-resale clauses.** Every entity registry on the purchase list (Massachusetts $4,800 a year, North Carolina $750 + $2,000, Minnesota $710, Georgia, Arizona, California, Nevada) carries a use-only or no-resale clause that may rule out an open registry.                                                            | Settle the legal question before paying anything (E). The low case buys nothing; the base case buys only after review. The alternative is derived facts (name, status, ID) rather than the file, if the clause allows it.                  |
| **Platform risk from tool directories.** Anthropic, OpenAI, Microsoft, and Google own the directories FactLot depends on for distribution and can change listing rules, take a cut, or ship their own CRE tools.                                                                                                                              | Serve every platform from one catalog (done), keep the local MCP server and SDKs free so no directory is a single point of failure, and own the registry data and the `factlot.com` endpoint.                                              |
| **Demand is unproven.** All evidence so far is simulated.                                                                                                                                                                                                                                                                                     | The week-6 decision gate: three letters of intent or paid pilots at $2,000 a month or more, or the registry build pauses.                                                                                                                  |
| **Incumbents ship citations.** ATTOM, Regrid, and Green Street already ship MCP servers; adding a source link per record is work they could do.                                                                                                                                                                                               | Their licences are the obstacle, not their engineering: the open IDs, open schema, and no-training stance are things a licensed-data vendor cannot copy without changing its business.                                                     |
| **Coverage.** Ten metros is not a national product; Los Angeles and San Francisco files omit owner names.                                                                                                                                                                                                                                     | Say so in the README (done). Sell to firms in the covered metros first. Treat each new state as a source review under the data policy, in the order interviews dictate.                                                                    |
| **Liability for wrong numbers or wrong owners.** A mis-linked owner or a wrong deadline has consequences.                                                                                                                                                                                                                                     | Versioned formulas with published test vectors; no automatic owner link below an exact match in the right jurisdiction; a human decides every fuzzy match; contractual limits; E&O and cyber insurance from the first enterprise contract. |
| **Solo founder.** One person builds, sells, reviews, and complies.                                                                                                                                                                                                                                                                            | Contractors for data review (month 4) and engineering (month 13 in the base case); no hire until revenue pays for it; the model keeps the founder paid at $72,000 a year so the company does not depend on an unpaid year.                 |
| **Running out of cash.** Peak need is $120,000 in the base case and $158,000 in the low case, mostly salary.                                                                                                                                                                                                                                  | The founder's starting balance is not in the repository; the model shows runway at $100k, $250k, and $500k. Without a salary the company needs under $40,000 to reach break-even in any scenario.                                          |

## 8. The next 12 months, with milestones tied to the backlog

| Month (M1 = December 2026) | Milestone                                                                                                                                            | Backlog items            | Model line                          |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ | ----------------------------------- |
| M1                         | Incorporate; terms of service, privacy policy, trademark filed; `contact@factlot.com` live; packages published to npm and PyPI; public endpoint up   | A5, A6, A7, A4, C16, C17 | C10 legal $5,700; hosting starts    |
| M1–M3                      | 54 discovery interviews; 10 design partners wired in (H1)                                                                                            | A8                       | none                                |
| M2                         | Legal review of the data policy; GitHub repository public; directory submissions                                                                     | A11, A1, C13             | C11 $5,000                          |
| M2–M3                      | FactLot Bench run on current models and published                                                                                                    | A3, C14                  | C4 model spend                      |
| M4                         | Decision gate (H3): three LOIs or paid pilots at $2,000 a month or more, or stay on the fast track; data-review contractor starts on the owner queue | A8, C2 follow-up         | C8 starts                           |
| M4–M6                      | Billing on top of the metering; Free and Pro plans live; first gated purchases if legal review allows (NC, MN)                                       | C12 follow-up, E         | R4 conversion measurable; C6 begins |
| M6                         | Registry served from the hosted endpoint with change webhooks; crosswalks to NYC BBL/BIN and LEI                                                     | C5, C6                   | R17 calls                           |
| M8                         | First enterprise contract (base case)                                                                                                                | H3                       | R13, R15                            |
| M9                         | Second conference; Team plan (SSO, audit logs) live; lease-ingestion accuracy on a public gold set                                                   | B12, C10                 | C15; R10–R12 ingest revenue         |
| M10–M12                    | Rules packs: NYC LL97 (once the law text is reachable) and Texas unequal-appraisal math; Clark County and Massachusetts purchases if allowed         | B11, C7, E               | C6                                  |
| M12                        | Year-one review against the model: signups (R1–R3), conversion (R4), ARPA (R6), enterprise pipeline (R13–R15); decide on SOC 2 Type 1 for M13        | C19 (this document), C20 | C12 $30,000 at M13                  |

The base case expects $9,319 of monthly revenue at month 12 from two enterprise contracts,
eleven Pro accounts, and one Team account, against $13,486 of monthly cost. If month 12 looks
like the low case ($2,825 MRR), the founder has the numbers to decide early; that is what the
model is for.
