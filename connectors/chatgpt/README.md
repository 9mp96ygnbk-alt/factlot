# FactLot for ChatGPT and OpenAI

## ChatGPT app (remote MCP)

ChatGPT calls connectors "apps". FactLot's MCP server works with ChatGPT in two ways:

- **Developer mode.** Every FactLot tool is available. Open **Settings → Apps → Advanced settings →
  Developer mode**, create an app, and enter `https://api.factlot.com/mcp`. Developer mode requires a
  paid plan; availability varies by plan.
- **Deep research and company knowledge.** These only use read-only `search` and `fetch` tools.
  FactLot implements both over its knowledge base (tools, inputs, CRE predicates, and the ID and
  fact specs). `search` returns `{"results": [{id, title, url}]}`, and `fetch` returns
  `{id, title, text, url, metadata}`, each as a JSON string in a single text content item.

## Custom GPT with an Action (OpenAPI)

1. Create a GPT, then go to **Configure → Actions → Create new action**.
2. Choose **Import from URL** and enter `https://api.factlot.com/openapi-3.0.json`. This OpenAPI 3.0
   document is FactLot's curated **GPT Actions subset**: Actions accept at most 30 operations, and
   FactLot has more tools than that, so this document lists the most-used ones (below). Do not import
   `/openapi.json`: it is the complete OpenAPI 3.1 document and has more than 30 operations.
3. Authentication:
   - **None** for an open server.
   - **API Key → Bearer** if you set `FACTLOT_API_KEY`.
4. Paste [`gpt-instructions.md`](gpt-instructions.md) into the GPT's instructions.
5. A public GPT needs a privacy policy URL. FactLot stores nothing, so state that in the policy.

Every operation is marked `x-openai-isConsequential: false`, because every operation is a read-only
computation.

### What the GPT Actions subset contains

The list is `GPT_ACTIONS_TOOLS` in [`packages/tools/src/providers.ts`](../../packages/tools/src/providers.ts),
in catalog order (a test keeps it at 30 or fewer and checks that this page lists every name):

- Lease and CAM: `calc_rent_schedule`, `calc_net_effective_rent`, `calc_compare_proposals`,
  `calc_percentage_rent`, `calc_cam_reconciliation`, `calc_walt`, `calc_renew_vs_relocate`,
  `calc_lease_remeasurement_asc842`, `calc_multifamily_rent_roll`, `calc_cam_reconciliation_batch`
- Debt, returns, and valuation: `calc_debt_sizing`, `calc_amortization_schedule`, `calc_npv`,
  `calc_irr`, `calc_dcf_pro_forma`, `calc_direct_cap`, `calc_equity_waterfall`, `calc_exchange_1031`
- Hotels and rules: `calc_hotel_metrics`, `rules_tx_property_tax_protest_deadline`
- IDs, facts, and documents: `id_parcel`, `id_space`, `id_document`, `fact_validate`,
  `doc_verify_facts`, `doc_abstract_lease`
- Registry, only on a server with a registry loaded: `registry_search_address`, `registry_get`,
  `registry_search_entities`, `registry_resolve_parcel`

Everything else, such as `calc_lease_vs_own`, `calc_prepayment_and_defeasance`, `calc_capex_recovery`, `id_building`,
`doc_compare`, and the other registry tools, is in the complete OpenAPI 3.1 document
(`/openapi.json`) and over MCP. If your GPT needs one of them, connect ChatGPT to the MCP server
(developer mode, above), or build your own subset of at most 30 operations in TypeScript:

```ts
openApi30({ filter: (t) => myTools.includes(t.name), operations: "all" });
```

`/openapi-3.0.json?operations=all` is the complete OpenAPI 3.0 document, for platforms without an
operation limit.

## OpenAI API

**Responses API with remote MCP.** OpenAI calls your FactLot server directly:

```python
from openai import OpenAI

client = OpenAI()
response = client.responses.create(
    model=MODEL,
    tools=[{"type": "mcp", "server_label": "factlot", "server_url": "https://api.factlot.com/mcp", "require_approval": "never"}],
    input="Compare these two office proposals for my client: ...",
)
```

**Function calling with local tools:**

```python
import factlot

tools = factlot.openai_responses_tools()  # Responses API
tools = factlot.openai_tools()            # Chat Completions
# for each function call the model makes:
result = factlot.run_tool(call.name, json.loads(call.arguments))
```

In TypeScript, use `openaiResponsesTools()` and `openaiChatTools()` from `@factlot/tools`, with `runTool()`.
