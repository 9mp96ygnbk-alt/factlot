# FactLot

**The open fact layer for commercial real estate AI agents.** Deterministic CRE math with an
audit trail, canonical property IDs, and public-record facts that cite the document they came
from. Free to use hosted, free to run yourself, open source.

[![CI](https://github.com/9mp96ygnbk-alt/factlot/actions/workflows/ci.yml/badge.svg)](https://github.com/9mp96ygnbk-alt/factlot/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/9mp96ygnbk-alt/factlot?sort=semver)](https://github.com/9mp96ygnbk-alt/factlot/releases/latest)
[![MCP Registry](https://img.shields.io/badge/MCP%20Registry-io.github.9mp96ygnbk--alt%2Ffactlot-blue)](https://registry.modelcontextprotocol.io/v0.1/servers?search=io.github.9mp96ygnbk-alt/factlot)
[![Hosted MCP](https://img.shields.io/badge/hosted%20MCP-api.factlot.com%2Fmcp-brightgreen)](https://api.factlot.com/)
[![License](https://img.shields.io/badge/license-Apache--2.0%20%2F%20MIT-lightgrey)](LICENSE)

## Try it in ten seconds

No key, no install:

```bash
curl -s https://api.factlot.com/v1/calc/debt_sizing -H 'content-type: application/json' \
  -d '{"noi":1000000,"value":15000000,"rate_annual":0.065,"amortization_years":30,"max_ltv":0.65,"min_dscr":1.25}'
```

The answer is a $9,750,000 maximum loan, bound by loan-to-value (the coverage test alone would
allow $10.5 million), with every intermediate step, its formula, and the versioned formula ID
`calc.debt_sizing@3` so an agent can cite exactly how the number was made.

Check what your agent read from a lease the same way: it extracts each term with the exact quote
and page, and `doc_verify_facts` confirms the quote is on that page and states the value, then
returns cited facts or the reason it could not
([document verification](docs/document-verification.md)). No model runs on FactLot's side and
nothing is stored.

**Check us against your own spreadsheet:** [seven Excel workbooks](examples/reconciliation/) (office,
industrial, retail, hotel, lender, lease accounting and more) put live Excel formulas beside FactLot's
numbers with a difference column of 0.00 (synthetic inputs; ARGUS parity is untested and not
claimed). What the registry holds, county by county, and the licence and AI-use rights of every
source: [coverage](docs/registry/coverage.md) and [rights](docs/registry/rights.md).

**Lease comps, free:** [6,994 federal (GSA) lease comps](https://github.com/9mp96ygnbk-alt/factlot/releases/tag/lease-comps-gsa-2026-11-04) (5.3 MB, public domain) as cited public-record facts, and an open
format with `lease_comp_validate` so firms can share comps with each other, each with stated rights,
no names, and a derived net effective rent ([lease comps](docs/lease-comps.md)). GSA leases are
government-tenant leases, not market comps for every use. Search them from any agent, hosted, with
`lease_comp_search`.

## Connect your agent

| Client                         | How                                                                                                                                                                                                                                        |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Claude Code plugin             | `/plugin marketplace add 9mp96ygnbk-alt/factlot`, then `/plugin install factlot@factlot`: twelve CRE skills (loan sizing, lease economics, CAM, ASC 842, returns and more) wired to the hosted tools ([plugin](plugins/factlot/README.md)) |
| Claude Code                    | `claude mcp add --transport http factlot https://api.factlot.com/mcp`                                                                                                                                                                      |
| Claude (web and Desktop)       | Settings, Connectors, Add custom connector: `https://api.factlot.com/mcp`. Or open [`factlot-0.4.0.mcpb`](https://github.com/9mp96ygnbk-alt/factlot/releases/download/v0.4.0/factlot-0.4.0.mcpb)                                           |
| ChatGPT                        | Developer mode app with `https://api.factlot.com/mcp`, or a Custom GPT Action importing `https://api.factlot.com/openapi-3.0.json`                                                                                                         |
| Cursor, VS Code, other clients | Remote MCP URL `https://api.factlot.com/mcp` ([guides](connectors/README.md))                                                                                                                                                              |
| Any MCP client, run locally    | `npx -y https://github.com/9mp96ygnbk-alt/factlot/releases/download/v0.4.0/factlot-mcp-standalone-0.4.0.tgz` (Node.js 22.6+, no network calls)                                                                                             |
| Python agents                  | `pip install "git+https://github.com/9mp96ygnbk-alt/factlot.git@v0.4.0#subdirectory=python"`                                                                                                                                               |
| Self-hosted REST and MCP       | `docker run -p 8787:8787 ghcr.io/9mp96ygnbk-alt/factlot:0.4.0`                                                                                                                                                                             |

The hosted endpoint is free with no key at 60 requests a minute. It is listed in the
[official MCP Registry](https://registry.modelcontextprotocol.io/v0.1/servers?search=io.github.9mp96ygnbk-alt/factlot)
as `io.github.9mp96ygnbk-alt/factlot`. Runnable examples for REST, Python and agent SDKs are in
[`examples/`](examples/).

**Try the registry tools on real data:** the [DC registry sample](https://github.com/9mp96ygnbk-alt/factlot/releases/tag/registry-sample-dc-2026-11-04) (23.4 MB, CC BY 4.0) holds
18,077 District of Columbia commercial parcels, 5,513 owning entities, 7,931 cited ownership links, 396
buildings, zoning districts for 16,648 parcels and the latest recorded sale for 12,594.

```bash
curl -fLO https://github.com/9mp96ygnbk-alt/factlot/releases/download/registry-sample-dc-2026-11-04/factlot-registry-sample-dc-2026-11-04.db.gz && gunzip factlot-registry-sample-dc-2026-11-04.db.gz
FACTLOT_REGISTRY_DB="$PWD/factlot-registry-sample-dc-2026-11-04.db" npx -y https://github.com/9mp96ygnbk-alt/factlot/releases/download/v0.4.0/factlot-mcp-standalone-0.4.0.tgz
```

**Paid plans:** [Pro $49 a month and Team $599 a month](https://factlot.com/#pricing) raise the hosted limits; registry lookups are on every plan, including the free tier. Enterprise, private deployments and further hosted regions: [contact@factlot.com](mailto:contact@factlot.com?subject=FactLot%20hosted%20registry%20regions). Questions and bug reports go in [GitHub Discussions](https://github.com/9mp96ygnbk-alt/factlot/discussions) and Issues.

## Hosted registry

The hosted API at `https://api.factlot.com` answers registry lookups on every plan, including the
free tier with no key (60 requests a minute per IP). These regions are hosted:

| Region               | Hosted data                                                                                                                                            | Licence                          |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------- |
| Maryland             | All 24 jurisdictions: 109,249 commercial parcels and 2,812 buildings, SDAT data as of 2026-11-05                                                       | Public domain                    |
| District of Columbia | 18,077 commercial parcels, 5,513 registered business entities and 396 buildings, with owners of record (organisations only), zoning and recorded sales | CC BY 4.0                        |
| Utah                 | Juab and Summit counties: 1,528 parcels, snapshot as of 2025-11-26                                                                                     | CC BY 4.0, "State of Utah, SGID" |

That is 128,854 parcels in 27 counties. Call `registry_coverage` first: it lists exactly what is
hosted, and a lookup outside it returns a coverage miss. Every answer cites its source file and the
licence or attribution that goes with it. Owners are organisations only; a natural person's name is
never stored, and the Maryland and Utah files carry no owner names. The DC data is the same as the
downloadable sample registry-sample-dc-2026-11-04.

The other regions in the project's pipeline (Texas, New York City and more) are available only on a
self-hosted FactLot with a registry file; more hosted regions open as their terms allow.
`registry_tx_equity_candidates` is listed on the hosted API, but no Texas region is hosted yet, so
it returns a coverage miss there.

## What FactLot is

Agents doing CRE work get stuck in the same places. They can't trust their own
arithmetic, they can't cite where a number came from, and they can't tell that
"Suite 400, 123 Main LLC" in one system is the same thing as a parcel number in
another.

FactLot gives every agent three things it can use by default:

| Package                              | What it does                                                                                                                                                                                                                                                                                                                        | License    |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| [`@factlot/calc`](packages/calc)     | Deterministic CRE calculators: rent schedules, net effective rent, proposal comparison, percentage rent, CAM reconciliation, loan sizing, ASC 842 lease remeasurement, prepayment and defeasance, WALT, IRR/NPV, lease vs. own, renew vs. relocate, hotel metrics. Every result includes an audit trail and a versioned formula ID. | Apache-2.0 |
| [`@factlot/id`](packages/id)         | **FactLot ID** gives canonical IDs for parcels, legal entities, buildings, spaces, leases, and documents. IDs are deterministic wherever the world already has a key (parcels, entities, buildings from their street address, spaces, documents), so any agent can compute them offline; leases get minted IDs.                     | Apache-2.0 |
| [`@factlot/schema`](packages/schema) | The FactLot data model. A fact is one atomic claim with **provenance** (source document, page, clause, method) and **rights** (whether an AI may use or redistribute it).                                                                                                                                                           | MIT        |
| [`@factlot/tools`](packages/tools)   | The tool catalog, with native tool definitions for Claude, OpenAI, Gemini, Amazon Bedrock, Mistral, and OpenAPI platforms, plus one `runTool` dispatcher.                                                                                                                                                                           | MIT        |
| [`@factlot/server`](packages/server) | The remote connector: Streamable HTTP MCP at `/mcp`, REST at `/v1`, and OpenAPI. Runs in Docker.                                                                                                                                                                                                                                    | Apache-2.0 |
| [`@factlot/mcp`](packages/mcp)       | An MCP server that exposes all of the above to Claude and any other MCP-capable agent. It runs locally and needs no API key.                                                                                                                                                                                                        | Apache-2.0 |

## What FactLot covers today

Be clear about scope before adopting it:

- **Calculators, IDs, and the fact model work anywhere.** They need no data and no API key, and
  they run offline in both SDKs with identical results.
- **The registry covers the largest metros, unevenly, and most of it is not hosted yet.** The
  project's registry pipeline has built and verified 1,733,923 commercial, industrial and
  multifamily parcels in 330 counties (19 states and DC) from 40 public-record sources, with 14.2
  million registered entities from Texas, New York, Colorado, Pennsylvania, DC and Connecticut for
  owner resolution: the largest metros (Harris, Dallas, Tarrant, Travis and Collin in Texas, New
  York City, Los Angeles, Boston, San Francisco, Denver, Charlotte, Minneapolis and DC), the rest of
  the top 100 counties where the licence allows, and statewide files for New York, Maryland,
  Massachusetts, Vermont, Arkansas and Connecticut, most of Utah, 24 Minnesota counties
  and Montana's apartments and industrial parcels
  ([catalog](docs/registry/sources/README.md), [quality report](docs/registry/quality/tier1-2026-11-03.md)).
  **What you can query today** on the hosted API is Maryland, the District of Columbia and Juab and Summit counties in Utah (128,854 parcels; see [Hosted registry](#hosted-registry)); every other region needs a self-hosted FactLot with a registry file. Cook County, Florida, Fulton,
  Maricopa, Wayne, Fairfax, King and much of California wait on a licence decision, a form or a
  purchase. Several public files omit owner names (Maryland, Utah, Los Angeles, San Francisco); zoning, recorded sales, deeds and mortgages,
  energy benchmarks and CMBS loan data only for some metros ([coverage](docs/registry/coverage.md)); no tenant rosters. See
  [the registry](docs/registry/README.md) and the [source catalog](docs/registry/sources/README.md).
- **One rules pack**, the Texas property-tax protest deadline, verified against the official
  statute text. Other jurisdictions follow only after a person verifies them.
- **Lease ingestion is a prototype**: deterministic quote-on-page and value-in-quote checks, OCR
  for scanned pages through a pluggable backend, but no published accuracy number yet.
- **No SOC 2 report yet.** The hosted service keeps no request bodies (see the
  [privacy notice](https://factlot.com/privacy)); for confidential documents, self-host FactLot so
  nothing leaves your network.
- **Hosted, but not yet on npm or PyPI.** The hosted endpoint at `https://api.factlot.com` serves
  the calculators, IDs, fact tools and registry lookups for the regions above (free at 60 requests a
  minute); registry regions not hosted need a self-hosted copy with a registry file. To run it yourself, install from the
  [v0.4.0 release](https://github.com/9mp96ygnbk-alt/factlot/releases/tag/v0.4.0), from git, from
  source, or with Docker ([getting started](docs/getting-started.md)).

## Connect FactLot to any AI platform

| Platform                                      | How to connect                                                                                                                                                                                                                                  |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Claude**                                    | Add a custom connector with `https://api.factlot.com/mcp`, install the one-click Desktop extension (`factlot.mcpb`), use Claude Code, or call it from the Claude API                                                                            |
| **ChatGPT and OpenAI**                        | Create a ChatGPT app in developer mode (`search`/`fetch` make deep research work), import `/openapi-3.0.json` (the curated subset of at most 30 operations) as a Custom GPT Action, use the Responses API's remote MCP, or use function calling |
| **Google Gemini**                             | Use Gemini API function declarations, Gemini CLI over MCP, or Vertex AI                                                                                                                                                                         |
| **Microsoft Copilot**                         | Add an MCP tool in Copilot Studio, use the Power Platform connector, or build a Microsoft 365 API plugin                                                                                                                                        |
| **Amazon Bedrock**                            | Use the Converse API `toolConfig`, or a Bedrock Agents action group backed by the Lambda handler                                                                                                                                                |
| **Mistral, xAI, Llama, DeepSeek, and others** | Use OpenAI-compatible function calling or MCP clients                                                                                                                                                                                           |

Every surface serves the same tools, generated from one catalog. See **[connectors/](connectors/README.md)**.

## Quick start: use FactLot from an agent

FactLot is not on npm or PyPI yet. These work without either: they run the stdio MCP server
from a GitHub release, from a clone, or in Docker. Each was run end to end
([install verification](docs/install-verification.md)).

```bash
# From the GitHub release: one file, dependencies bundled
claude mcp add factlot -- npx -y https://github.com/9mp96ygnbk-alt/factlot/releases/download/v0.4.0/factlot-mcp-standalone-0.4.0.tgz

# From a clone
git clone https://github.com/9mp96ygnbk-alt/factlot.git && cd factlot
npm install && npm run build
claude mcp add factlot -- node "$PWD/packages/mcp/dist/bin.js"

# Remote connector (Streamable HTTP MCP at /mcp, REST at /v1, OpenAPI)
docker run --rm -p 8787:8787 ghcr.io/9mp96ygnbk-alt/factlot:0.4.0
```

Claude Desktop users can install `factlot-0.4.0.mcpb` from the
[release](https://github.com/9mp96ygnbk-alt/factlot/releases). For any other MCP client, use the
same command in its config:

```json
{
  "mcpServers": {
    "factlot": {
      "command": "node",
      "args": ["/absolute/path/to/factlot/packages/mcp/dist/bin.js"]
    }
  }
}
```

[Getting started](docs/getting-started.md) has every option, including the TypeScript libraries
as release tarballs.

The server provides these tools:

- **Calculators:** `calc_rent_schedule`, `calc_net_effective_rent`, `calc_compare_proposals`,
  `calc_multifamily_rent_roll`, `calc_percentage_rent`, `calc_cam_reconciliation`,
  `calc_cam_reconciliation_batch`, `calc_capex_recovery`, `calc_debt_sizing`,
  `calc_lease_remeasurement_asc842`, `calc_prepayment_and_defeasance`, `calc_walt`, `calc_npv`,
  `calc_irr`, `calc_lease_vs_own`, `calc_renew_vs_relocate`, `calc_hotel_metrics`,
  `calc_dcf_pro_forma`, `calc_direct_cap`, `calc_amortization_schedule`, `calc_equity_waterfall`,
  `calc_exchange_1031`
- **Rules:** `rules_tx_property_tax_protest_deadline`
- **IDs and facts:** `id_parcel`, `id_entity`, `id_space`, `id_building`, `id_document`,
  `id_parse`, `fact_validate`, `fact_package_create`, `fact_package_verify`, `lease_comp_validate`
- **Documents:** `doc_verify_facts`, `doc_abstract_lease`, `doc_compare`, `doc_verify_claim`,
  `doc_spread_statement`, `doc_check_use_conflict`
- **Discovery:** `search`, `fetch`, `schema_get`
- **Registry** (hosted for the regions `registry_coverage` lists, and on a self-hosted FactLot when
  `FACTLOT_REGISTRY_DB` points at a registry file): `registry_get`, `registry_resolve_parcel`,
  `registry_resolve_external`, `registry_search_address`, `registry_search_entities`,
  `registry_owned_by`, `registry_coverage`, `registry_tx_equity_candidates`

## Quick start: Python agents

```bash
pip install "git+https://github.com/9mp96ygnbk-alt/factlot.git#subdirectory=python"
```

```python
import factlot

tools = factlot.anthropic_tools()  # or factlot.openai_tools(); pass these to your model
# When the model calls a tool, run it by name with the model's arguments:
result = factlot.run_tool("calc_npv", {"cash_flows": [-1000, 600, 600], "rate": 0.08})
result["value"]["npv"]  # 69.96
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
loan.formula; // { id: "calc.debt_sizing", version: 2 }

parcelId({ stateFips: "06", countyFips: "037", apn: "5432-001-012" });
// { kind: "parcel", urn: "fl:parcel:us-06037:5432001012", short: "flp_..." }
```

## Develop

This requires Node.js 22.6 or newer.

```bash
npm install
npm run check   # lint, format check, typecheck, tests, build
```

## License

FactLot is open source and fully self-hostable, which matters when leases are confidential.

- **Platform:** calculators, IDs, rules, the MCP server, the remote connector, and the ingest and
  registry code are licensed under [Apache-2.0](LICENSE).
- **Schema and SDKs:** `@factlot/schema`, `@factlot/tools` and the client SDKs are licensed under MIT.
- **Hosted service:** [api.factlot.com](https://api.factlot.com/) runs the same open-source code,
  free at 60 requests a minute, with [paid plans](https://factlot.com/#pricing) for higher limits.

## Docs

- [Getting started](docs/getting-started.md) · [Install verification](docs/install-verification.md)
- [Agent guide: which tool to call when](docs/agents.md) · [llms.txt](llms.txt)
- [Document verification](docs/document-verification.md) · [Lease ingestion](docs/ingest.md) · [Lease comps](docs/lease-comps.md)
- [Rules packs](docs/rules.md) · [Registry](docs/registry/README.md) · [Coverage](docs/registry/coverage.md) · [Rights](docs/registry/rights.md)
- [FactLot ID specification](docs/id-spec.md) · [Fact model: provenance and rights](docs/fact-model.md)
- [Customer documents policy](docs/customer-documents.md) · [Privacy](https://factlot.com/privacy) · [Terms](https://factlot.com/terms)
- [Changelog](CHANGELOG.md) · [Contributing](CONTRIBUTING.md) · [Security](SECURITY.md)

"FactLot" and the FactLot logo are trademarks of their owner. The open-source licenses
cover the code, not the name.
