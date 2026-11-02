# FactLot

**The open fact layer for commercial real estate AI agents.**

Agents doing CRE work get stuck in the same places. They can't trust their own
arithmetic, they can't cite where a number came from, and they can't tell that
"Suite 400, 123 Main LLC" in one system is the same thing as a parcel number in
another.

FactLot gives every agent three things it can use by default:

| Package                              | What it does                                                                                                                                                                                                              | License    |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| [`@factlot/calc`](packages/calc)     | Deterministic CRE calculators: rent schedules, net effective rent, proposal comparison, percentage rent, CAM reconciliation, loan sizing, WALT, IRR/NPV. Every result includes an audit trail and a versioned formula ID. | Apache-2.0 |
| [`@factlot/id`](packages/id)         | **FactLot ID** gives canonical IDs for parcels, legal entities, buildings, spaces, leases, and documents. IDs are deterministic wherever the world already has a key, so any agent can compute them offline.              | Apache-2.0 |
| [`@factlot/schema`](packages/schema) | The FactLot data model. A fact is one atomic claim with **provenance** (source document, page, clause, method) and **rights** (whether an AI may use or redistribute it).                                                 | MIT        |
| [`@factlot/mcp`](packages/mcp)       | An MCP server that exposes all of the above to Claude and any other MCP-capable agent. It runs locally and needs no API key.                                                                                              | Apache-2.0 |

## Why

In a [simulated survey of 165 CRE agent personas](docs/research/2026-11-agent-survey) across 20 roles:

- The highest-rated offerings were document-to-facts (3.52/5), deterministic calculators (3.24), and canonical IDs and entity resolution (3.12).
- 95% asked for citations, 51% reported that LLM math was wrong, and 35% said data licensing stops them using data they already pay for.
- Agent-to-agent negotiation scored 0.35/5. Agents want facts they can trust, not more autonomy.

That survey is a hypothesis generator, not market research. The [customer discovery plan](docs/customer-discovery.md) describes how we validate it.

## Quick start: use FactLot from an agent

Add the MCP server to your client. For example, Claude Code:

```bash
claude mcp add factlot -- npx -y @factlot/mcp
```

Or in any MCP client config:

```json
{
  "mcpServers": {
    "factlot": { "command": "npx", "args": ["-y", "@factlot/mcp"] }
  }
}
```

The server provides these tools: `calc_rent_schedule`, `calc_net_effective_rent`,
`calc_compare_proposals`, `calc_percentage_rent`, `calc_cam_reconciliation`,
`calc_debt_sizing`, `calc_walt`, `calc_npv`, `calc_irr`,
`id_parcel`, `id_entity`, `id_space`, `id_document`, `id_parse`, `fact_validate`,
and `schema_get`.

> Packages are not yet published to npm. Until they are, build from source (below)
> and point your client at `node packages/mcp/dist/bin.js`.

## Quick start: Python agents

```python
import factlot

tools = factlot.anthropic_tools()  # or factlot.openai_tools()
result = factlot.run_tool("calc_compare_proposals", {...})  # when the model calls a tool
```

The Python SDK has no dependencies and passes the same [conformance vectors](spec) as the
TypeScript packages. A differential test runs random inputs through both SDKs in CI and fails on
any difference, down to the last digit. See [python/README.md](python/README.md).

## Quick start: use the libraries

```ts
import { debtSizing } from "@factlot/calc";
import { parcelId } from "@factlot/id";

const loan = debtSizing({
  noi: 1_000_000,
  value: 15_000_000,
  rate_annual: 0.06,
  amortization_years: 30,
  max_ltv: 0.65,
  min_dscr: 1.25,
  min_debt_yield: 0.09,
});
loan.value.max_loan; // 9750000
loan.value.binding_constraint; // "ltv"
loan.steps; // every intermediate value, with formulas
loan.formula; // { id: "calc.debt_sizing", version: 1 }

parcelId({ stateFips: "06", countyFips: "037", apn: "5432-001-012" });
// { kind: "parcel", urn: "fl:parcel:us-06037:5432001012", short: "flp_..." }
```

## Develop

This requires Node.js 22.6 or newer.

```bash
npm install
npm run check   # lint, format check, typecheck, tests, build
```

## How FactLot is built and funded

FactLot follows the [Supabase](https://github.com/supabase/supabase) model:

- **Open source.** The platform code is Apache-2.0. Client-facing schemas and SDKs are MIT. Everything here can be self-hosted, which matters when leases are confidential.
- **FactLot Cloud (planned).** These are hosted services that cost real money to run:
  - the **FactLot Registry**: ID resolution, ownership graph, crosswalks, change webhooks
  - **Ingest**: documents to cited facts
  - **Rules packs**: property tax, zoning, building-performance law

  Pricing is usage-based with a free tier.

See [docs/business-model.md](docs/business-model.md) and [docs/roadmap.md](docs/roadmap.md).

## Docs

- [Agent guide: which tool to call when](docs/agents.md) · [llms.txt](llms.txt)
- [FactLot ID specification](docs/id-spec.md)
- [Fact model: provenance and rights](docs/fact-model.md)
- [Roadmap](docs/roadmap.md)
- [Business model](docs/business-model.md)
- [Customer discovery plan](docs/customer-discovery.md)
- [Contributing](CONTRIBUTING.md) · [Security](SECURITY.md)

"FactLot" and the FactLot logo are trademarks of their owner. The open-source licenses
cover the code, not the name.
