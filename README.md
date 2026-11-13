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
| Claude (web and Desktop)       | Settings, Connectors, Add custom connector: `https://api.factlot.com/mcp`. Or open [`factlot-0.5.0.mcpb`](https://github.com/9mp96ygnbk-alt/factlot/releases/download/v0.5.0/factlot-0.5.0.mcpb)                                           |
| ChatGPT                        | Developer mode app with `https://api.factlot.com/mcp`, or a Custom GPT Action importing `https://api.factlot.com/openapi-3.0.json`                                                                                                         |
| Cursor, VS Code, other clients | Remote MCP URL `https://api.factlot.com/mcp` ([guides](connectors/README.md))                                                                                                                                                              |
| Any MCP client, run locally    | `npx -y https://github.com/9mp96ygnbk-alt/factlot/releases/download/v0.5.0/factlot-mcp-standalone-0.5.0.tgz` (Node.js 22.6+, no network calls)                                                                                             |
| Python agents                  | `pip install "git+https://github.com/9mp96ygnbk-alt/factlot.git@v0.5.0#subdirectory=python"`                                                                                                                                               |
| Self-hosted REST and MCP       | `docker run -p 8787:8787 ghcr.io/9mp96ygnbk-alt/factlot:0.5.0`                                                                                                                                                                             |

The hosted endpoint is free with no key at 60 requests a minute. It is listed in the
[official MCP Registry](https://registry.modelcontextprotocol.io/v0.1/servers?search=io.github.9mp96ygnbk-alt/factlot)
as `io.github.9mp96ygnbk-alt/factlot`. Runnable examples for REST, Python and agent SDKs are in
[`examples/`](examples/).

**Try the registry tools on real data:** the [DC registry sample](https://github.com/9mp96ygnbk-alt/factlot/releases/tag/registry-sample-dc-2026-11-07) (23.5 MB, CC BY 4.0) holds
18,077 District of Columbia commercial parcels, 5,513 owning entities, 7,931 cited ownership links, 396
buildings, zoning districts for 16,648 parcels and the latest recorded sale for 12,594.

```bash
curl -fLO https://github.com/9mp96ygnbk-alt/factlot/releases/download/registry-sample-dc-2026-11-07/factlot-registry-sample-dc-2026-11-07.db.gz && gunzip factlot-registry-sample-dc-2026-11-07.db.gz
FACTLOT_REGISTRY_DB="$PWD/factlot-registry-sample-dc-2026-11-07.db" npx -y https://github.com/9mp96ygnbk-alt/factlot/releases/download/v0.5.0/factlot-mcp-standalone-0.5.0.tgz
```

**Plans:** the hosted endpoint is free with no key: every calculator, ID, fact, rules and document tool at 60 requests a minute per IP address, 25 registry lookups a day per IP address, and 3 reports a month per IP address. The free tier returns the current roll year only in `registry_get`'s value history and does not include the registry batch lookup (`registry_tx_equity_candidates_batch`). [Pro, $49 a month or $490 a year](https://factlot.com/pricing/): 1 API key, 600 requests a minute, 5,000 registry lookups a month, 50 reports a month, full multi-year value history, the registry batch lookup, email support. [Team, $599 a month](https://factlot.com/pricing/): up to 5 API keys, 3,000 requests a minute, 100,000 registry lookups a month, 1,000 reports a month, full multi-year value history, the registry batch lookup, priority support, and a vote on which regions open next. Limits are hard caps with no overage charges; at a cap the call returns HTTP 429 with the reset time. Paid plans renew until cancelled (monthly, or yearly on Pro yearly); cancel any time. A registry download licence ($2,400 a year per state file, refreshed weekly, for internal use, not redistribution) is available on request, and Enterprise (private deployment, invoicing, a signed data-processing agreement with a no-training commitment, and SSO) is by quote: [contact@factlot.com](mailto:contact@factlot.com?subject=FactLot%20Enterprise%20or%20registry%20licence). [Terms](https://factlot.com/terms) · [Privacy](https://factlot.com/privacy). Questions and bug reports go in [GitHub Discussions](https://github.com/9mp96ygnbk-alt/factlot/discussions) and Issues.

## Hosted registry

The hosted API at `https://api.factlot.com` answers registry lookups on every plan, including the
free tier with no key (25 registry lookups a day per IP address). These regions are hosted:

<!-- hosted:table -->

| Region                           | Hosted data                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Maryland                         | All 24 jurisdictions; 109,249 commercial parcels and 2,812 buildings from SDAT data as of 2026-11-05, public domain                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| The District of Columbia         | 18,077 commercial parcels, 5,513 registered business entities and 396 buildings, with owners of record that are organisations, zoning and recorded sales; CC BY 4.0                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Juab and Summit counties in Utah | 1,528 parcels, snapshot as of 2025-11-26; CC BY 4.0, "State of Utah, SGID"                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Sixteen Texas counties           | 305,684 commercial parcels: Harris 87,717 with 3,511 buildings, Dallas 59,645 with 998 buildings, Travis 30,556 with 407 buildings, Collin 18,035 with 656 buildings, Denton 13,304 with 311 buildings, Williamson 11,758 with 402 buildings, Cameron 14,173 with 98 buildings, Nueces 13,634 with 493 buildings, Galveston 10,088 with 274 buildings, Jefferson 9,594 with 204 buildings, Brazos 8,252 with 64 buildings, Midland 7,641, Ector 7,036, Grayson 6,613 with 41 buildings, Guadalupe 4,081 with 33 buildings and Kaufman 3,557 with 42 buildings; Denton and Williamson from 2027 preliminary rolls as of 2026-11-07; Midland has no values because its publisher's file has none; value history by tax year, organisation owners only, and the 88,176 Texas Comptroller entities that own a hosted parcel; `registry_tx_equity_candidates` and its batch form answer for these counties; appraisal-district rolls are public record with no licence stated, cited per fact with each source's rights |
| New York City                    | All five boroughs; 164,633 commercial parcels and 5,071 buildings from the Department of Finance final assessment roll as of 2026-05-15, public record with no restrictions on use, with owners of record that are organisations, and the 66,510 New York Department of State entities that own a hosted parcel                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Los Angeles County               | 203,179 commercial parcels from the Assessor's parcel data roll as of 2026-10-14; no owner names, which the public file does not carry; the County's open-data terms allow commercial use                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| San Francisco                    | 19,048 commercial parcels from the Assessor's secured roll (the 2025 roll year, the latest published; file as of 2026-06-26); no owner names, which the public file does not carry; public domain (PDDL)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| The City of Boston               | The City of Boston only, not Chelsea, Revere or Winthrop, the rest of Suffolk County; 13,296 commercial parcels from the Assessing Department's fiscal-year 2026 file, with values as of 2025-01-01, older than the other regions; public domain (ODC-PDDL)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Denver                           | 13,539 commercial parcels from the Assessor's file as of 2026-10-29; CC BY 3.0, "City and County of Denver", and the 6,678 Colorado Secretary of State entities that own a hosted parcel                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Connecticut                      | 43,398 commercial parcels in eight former counties, from the towns' grand lists in the statewide parcel and CAMA layer as of 2026-11-09; CC0, and the 23,752 Connecticut Secretary of the State entities that own a hosted parcel                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |

<!-- /hosted:table -->

The hosted API serves <!-- hosted:places -->Maryland (all 24 jurisdictions), the District of Columbia, Juab and Summit counties in Utah, sixteen Texas counties (Harris, Dallas, Travis, Collin, Denton, Williamson, Cameron, Nueces, Galveston, Jefferson, Brazos, Midland, Ector, Grayson, Guadalupe and Kaufman), New York City (all five boroughs), Los Angeles County, San Francisco, the City of Boston, Denver, and Connecticut (statewide, by town)<!-- /hosted:places -->: <!-- hosted:totals -->891,631 parcels in 60 counties<!-- /hosted:totals -->. Call `registry_coverage` first: it lists exactly what is
hosted, and a lookup outside it returns a coverage miss. Every answer cites its source file and the
licence or attribution that goes with it. The registry is built to keep owners that are organisations and to
exclude natural persons' names (if a record names you as a person, or is wrong, email contact@factlot.com and
we will remove or correct it), and the Maryland, Utah, Los Angeles County and San Francisco files carry no owner names. The DC data is the same as the
downloadable sample registry-sample-dc-2026-11-07.

The other regions in the project's pipeline are available only on a
self-hosted FactLot with a registry file; more hosted regions open as their terms allow.
Tarrant County is not served by the hosted registry while the publisher's terms for AI use are unclear.

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
- **The registry covers the largest metros, unevenly, and not all of it is hosted.** The
  project's registry pipeline has built and verified 1,733,923 commercial, industrial and
  multifamily parcels in 330 counties (19 states and DC) from 40 public-record sources, with 14.2
  million registered entities from Texas, New York, Colorado, Pennsylvania, DC and Connecticut for
  owner resolution: the largest metros (Harris, Dallas, Tarrant (not served by the hosted registry), Travis and Collin in Texas, New
  York City, Los Angeles, Boston, San Francisco, Denver, Charlotte, Minneapolis and DC), the rest of
  the top 100 counties where the licence allows, and statewide files for New York, Maryland,
  Massachusetts, Vermont, Arkansas and Connecticut, most of Utah, 24 Minnesota counties
  and Montana's apartments and industrial parcels
  ([catalog](docs/registry/sources/README.md), [quality report](docs/registry/quality/tier1-2026-11-03.md)).
  **What you can query today** on the hosted API is <!-- hosted:places -->Maryland (all 24 jurisdictions), the District of Columbia, Juab and Summit counties in Utah, sixteen Texas counties (Harris, Dallas, Travis, Collin, Denton, Williamson, Cameron, Nueces, Galveston, Jefferson, Brazos, Midland, Ector, Grayson, Guadalupe and Kaufman), New York City (all five boroughs), Los Angeles County, San Francisco, the City of Boston, Denver, and Connecticut (statewide, by town)<!-- /hosted:places --> (<!-- hosted:totals -->891,631 parcels in 60 counties<!-- /hosted:totals -->). <!-- hosted:withheld -->Tarrant County is not served by the hosted registry while the publisher's terms for AI use are unclear.<!-- /hosted:withheld --> Every other region needs a self-hosted FactLot with a registry file. Cook County, Florida, Fulton,
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
  the calculators, IDs, fact tools, reports and registry lookups for the regions above (free at 60
  requests a minute); registry regions not hosted need a self-hosted copy with a registry file. To run it yourself, install from the
  [v0.5.0 release](https://github.com/9mp96ygnbk-alt/factlot/releases/tag/v0.5.0), from git, from
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
claude mcp add factlot -- npx -y https://github.com/9mp96ygnbk-alt/factlot/releases/download/v0.5.0/factlot-mcp-standalone-0.5.0.tgz

# From a clone
git clone https://github.com/9mp96ygnbk-alt/factlot.git && cd factlot
npm install && npm run build
claude mcp add factlot -- node "$PWD/packages/mcp/dist/bin.js"

# Remote connector (Streamable HTTP MCP at /mcp, REST at /v1, OpenAPI)
docker run --rm -p 8787:8787 ghcr.io/9mp96ygnbk-alt/factlot:0.5.0
```

Claude Desktop users can install `factlot-0.5.0.mcpb` from the
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
  `calc_exchange_1031`, `calc_critical_dates`, `calc_reconcile_dcf`, `calc_reconcile_cam`,
  `calc_tx_unequal_appraisal`
- **Rules:** `rules_tx_property_tax_protest_deadline`, `rules_tx_property_tax_protest_deadline_batch`
- **IDs and facts:** `id_parcel`, `id_entity`, `id_space`, `id_building`, `id_document`,
  `id_parse`, `fact_validate`, `fact_package_create`, `fact_package_verify`, `lease_comp_validate`
- **Documents:** `doc_verify_facts`, `doc_abstract_lease`, `doc_compare`, `doc_verify_claim`,
  `doc_spread_statement`, `doc_check_use_conflict`, `doc_predicates`
- **Reports** (hosted only, every plan: 3 a month free per IP address, 50 on Pro, 1,000 on Team):
  `report_create` builds an XLSX, PDF or ICS file from a tool result, by code with no model, and
  returns a download link that works 24 hours ([docs/reports.md](docs/reports.md))
- **Discovery:** `search`, `fetch`, `schema_get`
- **Registry** (hosted for the regions `registry_coverage` lists, and on a self-hosted FactLot when
  `FACTLOT_REGISTRY_DB` points at a registry file): `registry_get`, `registry_resolve_parcel`,
  `registry_resolve_external`, `registry_search_address`, `registry_search_entities`,
  `registry_owned_by`, `registry_coverage`, `registry_tx_equity_candidates`,
  `registry_tx_equity_candidates_batch`
- **MCP resources and prompts** (no key, no registry lookup): `factlot://coverage`,
  `factlot://sources`, `factlot://markets`, `factlot://schemas/tools`, `factlot://schemas/fact`,
  `factlot://spec/id`, `factlot://plans`; prompts `property_owner`, `owner_portfolio`,
  `parcel_value_history`, `tx_unequal_appraisal_candidates`, `lease_abstract_check`, `deal_math`
  ([docs/agents.md](docs/agents.md#mcp-resources-and-prompts))

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
  free at 60 requests a minute, with [paid plans](https://factlot.com/pricing/) for higher limits.

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
