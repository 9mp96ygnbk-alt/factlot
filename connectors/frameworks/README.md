# FactLot in agent frameworks

Copy-paste recipes for connecting an agent framework to FactLot's remote MCP server
(`https://api.factlot.com/mcp`, or your own host): connect, list the tools, call a calculator and
a document tool, load only some tools, back off on HTTP 429, name your client, and send an API key.
Every recipe below was run; the output shown is what it printed.

These recipes test the **MCP connection layer**: loading tools, converting their schemas, and
invoking a tool through each framework's own tool object. None needed an LLM key, so none ran a
model. How a model behaves with FactLot's tools is a separate question (see
[docs/agents.md](../../docs/agents.md)).

## What was tested

Tested on **2026-11-06** with Python 3.13.15 and Node 26.8.1. "Local" is a build of this repository
(`node packages/server/dist/bin.js`, open mode and keyed mode); "hosted" is `api.factlot.com`
(free tier, no key, 42 tools). The tool counts below are the counts measured on that date; the hosted API now lists 55 tools over REST (the catalog tools, registry tools included) and 58 over MCP (those plus `search`, `fetch` and `schema_get`), 59 with `report_create` once hosted reports open.

| Framework                                      | Package and tested version                                                                                       | Local      | Hosted                                    |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ---------- | ----------------------------------------- |
| [LangGraph / LangChain](#langgraph--langchain) | `langchain-mcp-adapters` 0.3.2, `langgraph` 1.2.20, `langchain-core` 1.7.6, `mcp` 1.30.0                         | yes        | yes                                       |
| [OpenAI Agents SDK](#openai-agents-sdk)        | `openai-agents` 0.20.0 with `mcp` 1.30.0; also 0.24.0 with `mcp` 2.3.0                                           | yes (both) | yes (0.20.0)                              |
| [CrewAI](#crewai)                              | `crewai` 1.15.36: `mcps=[MCPServerHTTP(...)]`, and `crewai-tools` 1.15.36 `MCPServerAdapter` (`mcpadapt` 0.1.20) | yes (both) | adapter yes, `mcps=` not run              |
| [MCP Python SDK](#mcp-python-sdk)              | `mcp` 2.3.0 (`Client`); `mcp` 1.30.0 (`ClientSession`)                                                           | yes (both) | 2.3.0 yes, 1.30.0 not run                 |
| [MCP TypeScript SDK](#mcp-typescript-sdk)      | `@modelcontextprotocol/client` 2.4.0; `@modelcontextprotocol/sdk` 1.32.2 (v1)                                    | yes (both) | 2.4.0 yes, v1 not run                     |
| [Vercel AI SDK](#vercel-ai-sdk)                | `@ai-sdk/mcp` 2.0.91 (`createMCPClient`), `ai` 7.0.163                                                           | yes        | **not run** (needs 9 requests, see below) |

"Not run" on hosted is a request budget, not a failure: the hosted pass was capped at 29 requests,
paced at least 2.1 s apart, with a User-Agent, and the rows above used all of it. The same scripts
pass against the local build.

Each tested framework ran these checks:

1. Connect, `tools/list` (42 tools), and load only `calc_debt_sizing`, `calc_irr` and
   `doc_verify_facts`.
2. Call `calc_debt_sizing` and get `max_loan` 9,750,000, then `doc_verify_facts` on a synthetic lease
   page and get one verified fact and one held for review.
3. Call `calc_rent_schedule`, whose input has a `oneOf` union, and get the same result as a direct
   call.
4. Compare each tool's schema after the framework converted it with the server's.
5. Replay all 129 successful calculator cases in `spec/vectors/calc` through each framework's tool
   object and compare with a direct call (local only; the hosted free tier could not take it):
   129 of 129 matched in every framework.
6. Connect with an `Authorization: Bearer` header to a local server that required a key (a made-up
   test key; no real key was used).
7. Retry after a 429 from a local server rate-limited to 6 requests a minute.

Not tested, because it cannot be run from here: Copilot Studio, Gemini, ChatGPT and the Claude
console. See their own guides for the steps.

## Know these before you start

- **`tools/list` is about 165 KB** (42 tools). It has no server-side filter. Every framework
  downloads all of it; "loading only some tools" means deciding which ones your agent sees
  ([below](#load-only-some-tools)). Cache the list: do not fetch it for every request.
- **Every HTTP request counts against the limit** (hosted free tier: 60 a minute per IP address).
  FactLot's server is stateless, but a client still opens a session. Measured requests for one
  session that lists the tools and makes two tool calls:

  | Client                                                      | Requests |
  | ----------------------------------------------------------- | -------- |
  | MCP Python SDK 1.30, LangChain (one session), OpenAI Agents | 5        |
  | CrewAI `MCPServerAdapter`                                   | 6        |
  | MCP Python SDK 2.3, MCP TypeScript client 2.4 and 1.32      | 6        |
  | Vercel AI SDK                                               | 9        |
  | CrewAI `mcps=[MCPServerHTTP(...)]` (a new session per call) | 11       |

  The SDK 2.x clients start with a `server/discover` probe (answered `400`) and the TypeScript
  clients and the AI SDK try `GET /mcp` for a server stream (answered `405`). Both are real requests
  to the server, and a local server's per-IP limit counts them. After the first session, a tool call
  inside an open session is one request. LangChain's `client.get_tools()` without `client.session()`
  opens a new session for every tool call (about 4 requests each), and CrewAI's `mcps=` does the same.
  At 60 a minute, that is about ten sessions a minute from one address, or 15 calls through
  `get_tools()`. Keep sessions open, share one list, and use a key for anything bigger.

- **Name your client.** Default library agents are accepted, but send a descriptive `User-Agent`
  anyway ([below](#set-a-user-agent)).
- **Pass rates as decimals** (0.065, not 6.5). Tools reject whole-number percentages; see
  [docs/agents.md](../../docs/agents.md).

Install pins that worked (a Python 3.13 virtual environment; `scripts/e2e/frameworks/requirements.txt`
has the same list):

```bash
pip install "mcp<2" langchain-mcp-adapters langgraph langchain-core openai-agents crewai "crewai-tools[mcp]"
```

`langchain-mcp-adapters` 0.3.2 requires `mcp<2`. Version 0.3.1 has no upper bound, so with
`mcp` 2.x installed it fails on import (`cannot import name 'RequestContext' from
'mcp.shared.context'`). If you get that error, pin `mcp<2`. `openai-agents` works with both.

## Shared settings: User-Agent, API key, and 429 handling

The same three needs recur in every recipe, so the Python recipes share one `httpx` client factory.
Save it as `factlot_http.py`. With the MCP SDK 2.x, change `import httpx` to `import httpx2 as httpx`
(2.x uses `httpx2`).

```python
# factlot_http.py
import asyncio
import os

import httpx  # with the MCP SDK 2.x use `import httpx2 as httpx`

URL = os.environ.get("FACTLOT_MCP_URL", "https://api.factlot.com/mcp")
USER_AGENT = "my-agent/1.0 (you@example.com)"  # name your client
API_KEY = os.environ.get("FACTLOT_API_KEY")  # paid tiers only; the free tier needs no key


class RetryAfterTransport(httpx.AsyncHTTPTransport):
    """On HTTP 429, wait for Retry-After and send the same request again (at most twice)."""

    async def handle_async_request(self, request):
        for attempt in range(3):
            response = await super().handle_async_request(request)
            if response.status_code != 429 or attempt == 2:
                return response
            wait = await retry_after_seconds(response)
            await response.aclose()
            await asyncio.sleep(min(wait, 70))


async def retry_after_seconds(response) -> float:
    try:
        return float(response.headers["retry-after"])
    except (KeyError, ValueError):
        pass
    try:  # the JSON-RPC error body: {"error": {"data": {"retry_after_seconds": 60}}}
        await response.aread()
        return float(response.json()["error"]["data"]["retry_after_seconds"])
    except Exception:
        return 60.0


def client_factory(headers=None, timeout=None, auth=None) -> httpx.AsyncClient:
    """Drop-in `httpx_client_factory` for the MCP SDK and the frameworks built on it."""
    merged = {"User-Agent": USER_AGENT, **(headers or {})}
    if API_KEY:
        merged["Authorization"] = f"Bearer {API_KEY}"
    return httpx.AsyncClient(
        headers=merged,
        timeout=timeout or httpx.Timeout(30.0, read=300.0),
        auth=auth,
        transport=RetryAfterTransport(),
    )
```

The retry sits in the HTTP layer on purpose. Above it, the frameworks hide the 429: the MCP SDK
raises an `httpx.HTTPStatusError` inside nested exception groups, and the OpenAI Agents SDK raises
`UserError: Failed to connect to MCP server 'factlot': HTTP error 429` with no `Retry-After`.

The recipes also share two inputs, saved as `common.py`. The lease page is **synthetic** test
text, not a real lease, and the second candidate is a deliberate misread (the page says 2031).

```python
# common.py
DEBT = {"noi": 1_000_000, "value": 15_000_000, "rate_annual": 0.06,
        "amortization_years": 30, "max_ltv": 0.65, "min_dscr": 1.25}
DOC = {
    "document": {"title": "Synthetic lease page (not a real lease)",
                 "pages": ["SYNTHETIC EXAMPLE - NOT A REAL LEASE. Tenant shall deposit the sum of "
                           "$95,000.00 with Landlord. The Term shall expire on June 30, 2031."]},
    "candidates": [
        {"predicate": "lease.security_deposit", "value": 95000,
         "quote": "deposit the sum of $95,000.00 with Landlord", "page": 1},
        {"predicate": "lease.expiration_date", "value": "2033-06-30",   # a deliberate misread
         "quote": "shall expire on June 30, 2031", "page": 1},
    ],
    "as_of": "2026-11-06",
}
```

### What the two tools return

`calc_debt_sizing` returns `value`, `steps` (the audit trail), `warnings`, and `provenance`:

```json
{
  "value": {
    "max_loan": 9750000,
    "binding_constraint": "ltv",
    "loan_by_constraint": { "ltv": 9750000, "dscr": 11119440.96 },
    "resulting": { "ltv": 0.65, "dscr": 1.4256, "debt_yield": 0.1026 }
  },
  "provenance": { "method": "computed", "formula": "calc.debt_sizing@3" }
}
```

`doc_verify_facts` returns the candidates sorted into `verified`, `needs_review` and `rejected`.
The misread date is held for a person, with the reason; the deposit comes back as a cited fact:

```text
verified      ['lease.security_deposit']
needs_review  [('lease.expiration_date', 'value "2033-06-30" not found in quote')]
summary       {'candidates': 2, 'verified': 1, 'needs_review': 1, 'rejected': 0}
```

Both tools return their JSON as one text content block. Every framework hands you that block in its
own wrapper (shown per recipe).

## LangGraph / LangChain

`pip install "mcp<2" langchain-mcp-adapters langgraph langchain-core`

```python
import asyncio, json
from langchain_core.messages import AIMessage
from langchain_mcp_adapters.client import MultiServerMCPClient
from langchain_mcp_adapters.tools import load_mcp_tools
from langgraph.graph import END, START, MessagesState, StateGraph
from langgraph.prebuilt import ToolNode

from common import DEBT, DOC
from factlot_http import URL, USER_AGENT, client_factory

client = MultiServerMCPClient({"factlot": {
    "transport": "streamable_http",
    "url": URL,
    "headers": {"User-Agent": USER_AGENT},     # client_factory adds the Authorization header, if any
    "httpx_client_factory": client_factory,    # User-Agent, API key, 429 retry
}})

async def main():
    async with client.session("factlot") as session:        # one session for everything
        tools = await load_mcp_tools(session)
        print(len(tools), "tools")
        by_name = {t.name: t for t in tools}

        # Only some tools: filter the list you got (tools/list has no server-side filter).
        mine = [t for t in tools if t.name in {"calc_debt_sizing", "doc_verify_facts"}]

        out = await by_name["calc_debt_sizing"].ainvoke(DEBT)   # a list of content blocks
        loan = json.loads(out[0]["text"])
        print("max_loan", loan["value"]["max_loan"], loan["provenance"]["formula"])

        # The same tools inside a LangGraph graph; replace the AIMessage with your model's output.
        builder = StateGraph(MessagesState)
        builder.add_node("tools", ToolNode(mine))
        builder.add_edge(START, "tools")
        builder.add_edge("tools", END)
        graph = builder.compile()
        call = AIMessage(content="", tool_calls=[{"name": "doc_verify_facts", "args": DOC, "id": "1"}])
        state = await graph.ainvoke({"messages": [call]})
        doc = json.loads(state["messages"][-1].content[0]["text"])
        print("verified", [v["fact"]["predicate"] for v in doc["verified"]])
        print("needs_review", [(r["predicate"], r["reason"]) for r in doc["needs_review"]])

asyncio.run(main())
```

```text
42 tools
max_loan 9750000 calc.debt_sizing@3
verified ['lease.security_deposit']
needs_review [('lease.expiration_date', 'value "2033-06-30" not found in quote')]
```

- With a model, pass `mine` to `create_agent` / `create_react_agent`, or `model.bind_tools(mine)`.
  LangChain's own OpenAI-format conversion (`convert_to_openai_tool`) accepted all 42 tools with
  their `oneOf`, `const` and `propertyNames` intact. No model was called.
- `await client.get_tools()` is shorter but opens a new session for every tool call. Use it for
  scripts, not for loops.

## OpenAI Agents SDK

`pip install openai-agents "mcp<2"` (works with `mcp` 2.x too, but then the client factory must
return an `httpx2` client; see the shared-settings note).

```python
import asyncio, json
from agents import Agent
from agents.mcp import MCPServerStreamableHttp, create_static_tool_filter

from factlot_http import URL, USER_AGENT, client_factory

async def main():
    async with MCPServerStreamableHttp(
        name="factlot",
        params={"url": URL, "headers": {"User-Agent": USER_AGENT}, "httpx_client_factory": client_factory},
        cache_tools_list=True,                       # one tools/list per process
        client_session_timeout_seconds=130,          # default is 5; a 429 retry can wait 60
        # Only some tools. The SDK still downloads the full list and drops the rest.
        tool_filter=create_static_tool_filter(
            allowed_tool_names=["calc_debt_sizing", "calc_irr", "doc_verify_facts"]),
    ) as server:
        print([t.name for t in await server.list_tools()])
        result = await server.call_tool("calc_debt_sizing", {
            "noi": 1_000_000, "value": 15_000_000, "rate_annual": 0.06,
            "amortization_years": 30, "max_ltv": 0.65, "min_dscr": 1.25})
        loan = json.loads(result.content[0].text)
        print("max_loan", loan["value"]["max_loan"], loan["provenance"]["formula"])
        # In an agent: Agent(name="CRE analyst", instructions="...", mcp_servers=[server])

asyncio.run(main())
```

```text
['calc_debt_sizing', 'calc_irr', 'doc_verify_facts']
max_loan 9750000 calc.debt_sizing@3
```

The test script also invokes `doc_verify_facts` and `calc_rent_schedule` through the SDK's own
function tools (`MCPUtil.get_all_function_tools`, then `on_invoke_tool`), which is what a running
agent does. Those calls returned the same results.

**Strict mode.** Off by default. If you turn it on (`Agent(mcp_config={"convert_schemas_to_strict":
True})`), the SDK tries to convert each schema to OpenAI strict mode and cannot for 8 tools, whose
inputs contain free-form objects (a fact, a package, a lease page with open fields):
`doc_abstract_lease`, `doc_check_use_conflict`, `doc_compare`, `fact_package_create`,
`fact_package_verify`, `fact_validate`, `lease_comp_validate` and `schema_get`. It logs that at INFO
level ("Error converting MCP schema to strict mode") and serves those tools with their original,
non-strict schema, so they still work. For the other 34 it rewrites `oneOf` as `anyOf` (14 places)
and adds `additionalProperties: false`, which is how strict mode works. `doc_verify_facts` converts.

## CrewAI

CrewAI has two ways in. Use the first.

**`mcps=` on an Agent (current).** `pip install crewai`

```python
import json, os
os.environ.setdefault("CREWAI_DISABLE_TELEMETRY", "true")
from crewai import Agent
from crewai.mcp import MCPServerHTTP
from crewai.mcp.filters import create_static_tool_filter

from common import DEBT, DOC
from factlot_http import API_KEY, URL, USER_AGENT

headers = {"User-Agent": USER_AGENT, **({"Authorization": f"Bearer {API_KEY}"} if API_KEY else {})}
factlot = MCPServerHTTP(
    url=URL, headers=headers, streamable=True, cache_tools_list=True,
    tool_filter=create_static_tool_filter(allowed_tool_names=["calc_debt_sizing", "doc_verify_facts"]),
)
# Constructing an Agent does not call a model. Give it an `llm` you will really use when you run a Crew.
agent = Agent(role="CRE analyst", goal="Size loans and check lease terms", backstory="-",
              llm="gpt-4o-mini", mcps=[factlot])

tools = agent.get_mcp_tools([factlot])               # what the agent will be given
by_name = {t.original_tool_name: t for t in tools}   # t.name is prefixed with the server host
print(sorted(by_name))
loan = json.loads(by_name["calc_debt_sizing"].run(**DEBT))
print("max_loan", loan["value"]["max_loan"], loan["provenance"]["formula"])
doc = json.loads(by_name["doc_verify_facts"].run(**DOC))
print("verified", [v["fact"]["predicate"] for v in doc["verified"]])
print("needs_review", [(r["predicate"], r["reason"]) for r in doc["needs_review"]])
```

```text
['calc_debt_sizing', 'doc_verify_facts']
max_loan 9750000 calc.debt_sizing@3
verified ['lease.security_deposit']
needs_review [('lease.expiration_date', 'value "2033-06-30" not found in quote')]
```

CrewAI prints connection panels to the console (`MCP Connection Completed ...`), one per session.
This path does not take an `httpx_client_factory`, so it has no 429 retry; each tool call opens its
own session (4 requests). Put a retry around `tool.run` if you expect to hit the limit, or use a key.
Tool names the model sees are prefixed with the server host (for the local test,
`mcp_127_0_0_1:8791_mcp_calc_irr`).

**`MCPServerAdapter` from `crewai-tools` (older).** `pip install "crewai-tools[mcp]"`. It keeps one
session open, takes the shared client factory, and takes tool names to load. It has one catch:
**it sends `null` for every optional field the model leaves out.** The hosted API now treats a
`null` for a field the schema names as the field left out, so these calls work as sent. A local
server or SDK at 0.4.0 or earlier still rejects them; against one of those, strip the nulls with
the helper below. Without it, `calc_debt_sizing` on such a server came back:

```text
invalid input: min_debt_yield: Invalid input: expected number, received null; existing_loan_balance:
Invalid input: expected number, received null; stress: Invalid input: expected object, received null
```

```python
import json, os
os.environ.setdefault("CREWAI_DISABLE_TELEMETRY", "true")
from crewai_tools import MCPServerAdapter

from common import DEBT, DOC
from factlot_http import URL, USER_AGENT, client_factory

params = {"url": URL, "transport": "streamable-http",
          "headers": {"User-Agent": USER_AGENT}, "httpx_client_factory": client_factory}

def without_nulls(value):
    if isinstance(value, dict):
        return {k: without_nulls(v) for k, v in value.items() if v is not None}
    if isinstance(value, list):
        return [without_nulls(v) for v in value]
    return value

def drop_nulls(tool):
    """crewai-tools sends null for every optional field you leave out; FactLot 0.4.0 and earlier reject null."""
    inner = tool._run
    object.__setattr__(tool, "_run", lambda **kw: inner(**without_nulls(kw)))
    return tool

# Names after the params dict load only those tools (still a full tools/list underneath).
with MCPServerAdapter(params, "calc_debt_sizing", "doc_verify_facts", connect_timeout=60) as tools:
    by_name = {t.name: drop_nulls(t) for t in tools}
    print(sorted(by_name))
    loan = json.loads(by_name["calc_debt_sizing"].run(**DEBT))
    print("max_loan", loan["value"]["max_loan"], loan["provenance"]["formula"])
    doc = json.loads(by_name["doc_verify_facts"].run(**DOC))
    print("verified", [v["fact"]["predicate"] for v in doc["verified"]])
    # Pass `tools` to Agent(tools=tools, ...) inside this block; the connection closes on exit.
```

```text
['calc_debt_sizing', 'doc_verify_facts']
max_loan 9750000 calc.debt_sizing@3
verified ['lease.security_deposit']
```

**CrewAI rewrites the schemas** into its own Pydantic models, and drops most constraints on the
way (see [schema results](#schema-results)). Calls with valid inputs still worked, all 129 vectors
through both paths, and FactLot validates every call, but the model sees fewer hints than
other frameworks give it.

## MCP Python SDK

`pip install mcp` installs 2.x. The 2.x client is `mcp.Client`; the `ClientSession` pattern of 1.x
still works on 1.x. Use the shared client factory with `import httpx2 as httpx` for 2.x.

```python
import asyncio, json
from mcp import Client
from mcp.client.streamable_http import streamable_http_client

from common import DEBT, DOC
from factlot_http import URL, client_factory   # factlot_http.py with `import httpx2 as httpx`

async def main():
    async with client_factory() as http:
        async with Client(streamable_http_client(URL, http_client=http)) as client:
            tools = (await client.list_tools()).tools
            print(len(tools), "tools")
            mine = [t for t in tools if t.name in {"calc_debt_sizing", "doc_verify_facts"}]
            loan = json.loads((await client.call_tool("calc_debt_sizing", DEBT)).content[0].text)
            print("max_loan", loan["value"]["max_loan"], loan["provenance"]["formula"])
            doc = json.loads((await client.call_tool("doc_verify_facts", DOC)).content[0].text)
            print("summary", doc["summary"])

asyncio.run(main())
```

```text
42 tools
max_loan 9750000 calc.debt_sizing@3
summary {'candidates': 2, 'verified': 1, 'needs_review': 1, 'rejected': 0}
```

With `mcp` 1.x, the same factory (plain `httpx`) goes to `streamablehttp_client`:

```python
from mcp import ClientSession
from mcp.client.streamable_http import streamablehttp_client

async with streamablehttp_client(URL, httpx_client_factory=client_factory) as (read, write, _):
    async with ClientSession(read, write) as session:
        await session.initialize()
        tools = (await session.list_tools()).tools
        result = await session.call_tool("calc_debt_sizing", DEBT)
```

A wrong API key surfaces as an `ExceptionGroup` wrapping `httpx.HTTPStatusError: 401` (1.x) or
`MCPError: Server returned an error response` (2.x).

## MCP TypeScript SDK

`npm i @modelcontextprotocol/client` (v2). The v1 package `@modelcontextprotocol/sdk` still works the
same way; its `callTool` takes the options as the third argument, not the second. Save this shared
file as `factlot-fetch.mjs`:

```js
// factlot-fetch.mjs: User-Agent, API key, 429 handling for every FactLot MCP client.
export const URL_ =
  process.env.FACTLOT_MCP_URL ?? "https://api.factlot.com/mcp";
const USER_AGENT = "my-agent/1.0 (you@example.com)"; // name your client
const API_KEY = process.env.FACTLOT_API_KEY; // paid tiers only; the free tier needs no key

// On HTTP 429, wait for Retry-After and send the same request again (at most twice).
export async function factlotFetch(input, init = {}) {
  for (let attempt = 0; ; attempt++) {
    const headers = new Headers(init.headers);
    headers.set("User-Agent", USER_AGENT);
    if (API_KEY) headers.set("Authorization", `Bearer ${API_KEY}`);
    const res = await fetch(input, { ...init, headers });
    if (res.status !== 429 || attempt === 2) return res;
    const wait =
      Number(res.headers.get("retry-after")) ||
      (await res
        .clone()
        .json()
        .then((b) => b.error?.data?.retry_after_seconds)
        .catch(() => 0)) ||
      60;
    await new Promise((r) => setTimeout(r, Math.min(wait, 70) * 1000));
  }
}

export const DEBT = {
  noi: 1_000_000,
  value: 15_000_000,
  rate_annual: 0.06,
  amortization_years: 30,
  max_ltv: 0.65,
  min_dscr: 1.25,
};
export const DOC = {
  document: {
    title: "Synthetic lease page (not a real lease)",
    pages: [
      "SYNTHETIC EXAMPLE - NOT A REAL LEASE. Tenant shall deposit the sum of $95,000.00 with Landlord. The Term shall expire on June 30, 2031.",
    ],
  },
  candidates: [
    {
      predicate: "lease.security_deposit",
      value: 95000,
      quote: "deposit the sum of $95,000.00 with Landlord",
      page: 1,
    },
    {
      predicate: "lease.expiration_date",
      value: "2033-06-30",
      quote: "shall expire on June 30, 2031",
      page: 1,
    }, // a deliberate misread
  ],
  as_of: "2026-11-06",
};
```

```js
import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import { DEBT, DOC, URL_, factlotFetch } from "./factlot-fetch.mjs";

const client = new Client({ name: "my-agent", version: "1.0.0" });
await client.connect(
  new StreamableHTTPClientTransport(new URL(URL_), { fetch: factlotFetch }),
);
try {
  const { tools } = await client.listTools(undefined, { timeout: 130_000 }); // longer than a 60 s Retry-After
  console.log(tools.length, "tools");
  const mine = tools.filter((t) =>
    ["calc_debt_sizing", "doc_verify_facts"].includes(t.name),
  ); // client-side filter

  const call = (name, args) =>
    client.callTool({ name, arguments: args }, { timeout: 130_000 });
  const loan = JSON.parse(
    (await call("calc_debt_sizing", DEBT)).content[0].text,
  );
  console.log("max_loan", loan.value.max_loan, loan.provenance.formula);
  const doc = JSON.parse((await call("doc_verify_facts", DOC)).content[0].text);
  console.log("summary", doc.summary);
} finally {
  await client.close();
}
```

```text
42 tools
max_loan 9750000 calc.debt_sizing@3
summary { candidates: 2, verified: 1, needs_review: 1, rejected: 0 }
```

The SDK's request timeout (60 s by default in v1) also covers the `Retry-After` sleep inside
`fetch`, and the hosted API says "retry in 60s", so give each request a longer timeout, as above.

## Vercel AI SDK

`npm i ai @ai-sdk/mcp`. `createMCPClient` is in the separate `@ai-sdk/mcp` package (it is also
exported as `experimental_createMCPClient`). Uses the same `factlot-fetch.mjs`.

```js
import { createMCPClient } from "@ai-sdk/mcp";
import { DEBT, DOC, URL_, factlotFetch } from "./factlot-fetch.mjs";

const client = await createMCPClient({
  transport: { type: "http", url: URL_, fetch: factlotFetch }, // fetch adds the User-Agent, key and 429 retry
});
try {
  const all = await client.tools(); // downloads the whole tools/list
  console.log(Object.keys(all).length, "tools");
  // Only some tools: pass this object to generateText({ tools: mine, ... }).
  const mine = Object.fromEntries(
    Object.entries(all).filter(([name]) =>
      ["calc_debt_sizing", "doc_verify_facts"].includes(name),
    ),
  );
  // execute() is what the AI SDK runs when a model returns a tool call.
  const run = (name, args) =>
    mine[name].execute(args, { toolCallId: "1", messages: [] });
  const loan = JSON.parse(
    (await run("calc_debt_sizing", DEBT)).content[0].text,
  );
  console.log("max_loan", loan.value.max_loan, loan.provenance.formula);
  const doc = JSON.parse((await run("doc_verify_facts", DOC)).content[0].text);
  console.log("summary", doc.summary);
} finally {
  await client.close();
}
```

```text
42 tools
max_loan 9750000 calc.debt_sizing@3
summary { candidates: 2, verified: 1, needs_review: 1, rejected: 0 }
```

Close the client when you are done with it. The AI SDK's session needs 9 requests before the first answer ([above](#know-these-before-you-start)),
so on the free tier budget about six AI SDK sessions a minute.

## Load only some tools

`tools/list` has no filter parameter on the server, so every client downloads all 42 tools (about
165 KB, roughly 40,000 tokens if you hand them all to a model). Filtering decides what the **model**
sees, which is the expensive part. Pick one:

| Client                    | How                                                                                                               |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Any                       | `[t for t in tools if t.name in WANTED]` after listing, or the prefix: `t.name.startswith(("calc_", "doc_"))`     |
| OpenAI Agents SDK         | `tool_filter=create_static_tool_filter(allowed_tool_names=[...])`, or `blocked_tool_names`; a callable also works |
| CrewAI `mcps=`            | `MCPServerHTTP(tool_filter=create_static_tool_filter(allowed_tool_names=[...]))`                                  |
| CrewAI `MCPServerAdapter` | tool names after the parameters: `MCPServerAdapter(params, "calc_irr", "doc_verify_facts")`                       |
| Vercel AI SDK             | filter the object `client.tools()` returns                                                                        |

Tool names group by prefix: `calc_*` (22 calculators), `doc_*` (document tools), `fact_*`, `id_*`,
`rules_*`, `lease_comp_validate`, and `search`, `fetch`, `schema_get`. For lease abstraction, `doc_*`
plus `fact_validate` and `id_document` is enough; for underwriting, the `calc_*` tools. Fewer tools
also means fewer wrong choices by the model.

## What to do on HTTP 429

The free tier is 60 requests a minute per IP address. Over it, the server answers HTTP 429 with a
`Retry-After` header (the hosted worker sets `retry-after: 60`) and, for `/mcp`, a JSON-RPC error body:

```json
{
  "jsonrpc": "2.0",
  "error": {
    "code": -32000,
    "message": "rate limit of 60 requests per minute exceeded for the anonymous tier; retry in 60s. ...",
    "data": { "error": "RateLimited", "retry_after_seconds": 60 }
  },
  "id": null
}
```

(The body above is the hosted worker's shape; the self-hosted server's message differs, but both put
`retry_after_seconds` in `error.data` and send `Retry-After`.) The policy that follows:

1. **Honour `Retry-After`** (fall back to `error.data.retry_after_seconds`, then 60 s). Do not retry
   sooner and do not retry in a tight loop.
2. **Retry the same request at most twice**, then fail loudly. A 429 is safe to retry: FactLot's
   tools are pure computations.
3. **Do it in the HTTP layer** (`factlot_http.py` and `factlot-fetch.mjs` above), because the
   frameworks hide the status.
4. **Give the client a timeout longer than the wait**: OpenAI Agents
   `client_session_timeout_seconds=130` (its default of 5 s fails the retry), TypeScript request
   `timeout: 130_000`.
5. **Prevent it**: keep a session open, cache the tool list, and run workers one at a time per
   address. A key raises the limit.

Tested against a local server limited to 6 requests a minute: the MCP Python SDK (2.x and 1.x),
LangChain, OpenAI Agents (both versions), CrewAI `MCPServerAdapter`, the TypeScript client and SDK
v1, and the Vercel AI SDK waited and then finished. No 429 occurred on the hosted API during the
tests, so its 60-second wait is from the worker's code, not an observation. CrewAI's `mcps=` path has no hook for this and was not covered.

## Set a User-Agent

Send a descriptive `User-Agent` such as `my-agent/1.0 (you@example.com)`, so the operator can tell
your traffic from a script's and contact you if it misbehaves. Default library agents, including
Python's `urllib`, are accepted. The recipes above set it in the HTTP client factory or the fetch
wrapper; CrewAI's `mcps=` takes it in `MCPServerHTTP(headers=...)`.

## Use an API key

The free tier needs no key. For a paid tier, send the key as a bearer token:
`Authorization: Bearer <key>`. Read it from the environment, never from source:

```bash
export FACTLOT_API_KEY=...        # the recipes above read it
```

The shared factory and fetch wrapper add the header when `FACTLOT_API_KEY` is set. Where a recipe
takes headers directly, use `{"Authorization": f"Bearer {key}"}`.

No real key was used for this guide. The header path was tested against a local server started with
`FACTLOT_API_KEY=<a made-up test value>`: every framework connected and called tools with the key,
and a wrong key failed as follows.

| Client                        | Error for a wrong key                                                                                 |
| ----------------------------- | ----------------------------------------------------------------------------------------------------- |
| MCP Python SDK 1.x, LangChain | `httpx.HTTPStatusError: Client error '401 Unauthorized'` inside an `ExceptionGroup`                   |
| MCP Python SDK 2.x            | `MCPError: Server returned an error response`                                                         |
| OpenAI Agents SDK             | `UserError: Failed to connect to MCP server 'factlot': HTTP error 401`                                |
| CrewAI `MCPServerAdapter`     | `RuntimeError: Failed to initialize MCP Adapter: Couldn't connect to the MCP server after 30 seconds` |
| Vercel AI SDK                 | `MCPClientError: ... POSTing to endpoint (HTTP 401)`, with the response body                          |

## Schema results

FactLot's input schemas use `oneOf` (14 places, in 10 tools), `const` (41 uses) and `propertyNames`
(7 tools), plus `exclusiveMinimum`, `pattern` and `format`. Each framework's converted schema was
compared with the server's.

| Framework                                  | Schema after conversion                                                                       | All 42 tools load | Calls with valid input |
| ------------------------------------------ | --------------------------------------------------------------------------------------------- | ----------------- | ---------------------- |
| MCP Python SDK, TypeScript SDK (v1 and v2) | identical (42 of 42)                                                                          | yes               | 129 of 129 vectors     |
| LangChain / LangGraph                      | identical (42 of 42); identical again after `convert_to_openai_tool`                          | yes               | 129 of 129             |
| OpenAI Agents SDK                          | identical when not strict; strict mode falls back for 8 tools and rewrites `oneOf` as `anyOf` | yes               | 129 of 129             |
| Vercel AI SDK                              | the same, plus `additionalProperties: false` added at the top of every tool                   | yes               | 129 of 129             |
| CrewAI (both paths)                        | **rewritten**: 0 of 42 identical                                                              | yes               | 129 of 129             |

CrewAI's Pydantic conversion, measured over the 42 tools, **dropped**: `oneOf` 14, `const` 6,
`propertyNames` 7, `minItems` 32, `maxItems` 51, `pattern` 31, `minimum` 11, `maximum` 15,
`exclusiveMinimum` 14, `exclusiveMaximum` 5, `minLength` 3, `maxLength` 8, `format` 1 and `required` 7. It **added** `anyOf` 317 (every optional field became "type or null"), `additionalProperties` 130
and `default` 147. The tools that lost `oneOf`/`const`: `calc_rent_schedule`,
`calc_net_effective_rent`, `calc_compare_proposals`, `calc_multifamily_rent_roll` (also `const`),
`calc_percentage_rent`, `calc_cam_reconciliation`, `calc_cam_reconciliation_batch`,
`calc_prepayment_and_defeasance`, `calc_lease_vs_own`, `calc_renew_vs_relocate` (also `const`). It
lost `propertyNames` on `fact_validate`, `doc_abstract_lease`, `doc_compare`,
`doc_check_use_conflict`, `fact_package_create`, `fact_package_verify` and `lease_comp_validate`.
No tool failed to convert. A model using CrewAI is shown a looser schema, so rely on FactLot's
rejection messages to correct it.

## Troubleshooting

| Symptom                                                                           | Cause and fix                                                                                                                                           |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ImportError: cannot import name 'RequestContext'`                                | `langchain-mcp-adapters` 0.3.1 with `mcp` 2.x. Install `langchain-mcp-adapters` 0.3.2 and `mcp<2`.                                                      |
| `MCP Python SDK v2 requires httpx_client_factory to return an httpx2.AsyncClient` | Use `import httpx2 as httpx` in the factory, or pin `mcp<2`.                                                                                            |
| `Error converting MCP schema to strict mode` (INFO, OpenAI Agents)                | Only with `convert_schemas_to_strict` on. Expected for 8 tools; they run non-strict.                                                                    |
| `expected number, received null` (CrewAI adapter)                                 | `crewai-tools` sends nulls for omitted optional fields; servers at 0.4.0 or earlier reject them. Use `drop_nulls`, the `mcps=` path, or the hosted API. |
| `Timed out while waiting for response ... Waited 5.0 seconds`                     | OpenAI Agents' default session timeout, hit while waiting out a 429. Set `client_session_timeout_seconds=130`.                                          |
| `Request timed out` (TypeScript) while a 429 retry waits                          | Raise the request `timeout` above the `Retry-After`.                                                                                                    |
| `invalid or inactive FactLot API key` (HTTP 401)                                  | The key is wrong or revoked. The free tier needs no key at all: unset `FACTLOT_API_KEY`.                                                                |

## Rerun the tests

The scripts that produced the results above are in
[`scripts/e2e/frameworks/`](../../scripts/e2e/frameworks/). They are not part of `npm test` or CI.
They need no LLM key; they call the MCP endpoint only.

```bash
REPO=$PWD
npm ci && npm run build
PORT=8791 HOST=127.0.0.1 node packages/server/dist/bin.js &    # a local server; stop it when done

# Python (3.13): the pinned packages in requirements.txt
python3.13 -m venv /tmp/factlot-fw && . /tmp/factlot-fw/bin/activate
pip install -r scripts/e2e/frameworks/requirements.txt
FACTLOT_MCP_URL=http://127.0.0.1:8791/mcp python scripts/e2e/frameworks/python_frameworks.py --vectors

# Node: copy the script next to the packages it imports
cd "$(mktemp -d)" && npm init -y >/dev/null
npm i @modelcontextprotocol/client @modelcontextprotocol/sdk @ai-sdk/mcp ai
cp "$REPO/scripts/e2e/frameworks/node_frameworks.mjs" .
FACTLOT_VECTORS_DIR="$REPO/spec/vectors/calc" FACTLOT_MCP_URL=http://127.0.0.1:8791/mcp node node_frameworks.mjs --vectors
```

Environment: `FACTLOT_MCP_URL` (default `http://127.0.0.1:8787/mcp`), `FACTLOT_API_KEY`,
`FACTLOT_USER_AGENT`, `FACTLOT_MIN_GAP_S` (minimum seconds between requests), `FACTLOT_BASELINE_FILE`
(cache the server's `tools/list`), `FACTLOT_VECTORS_DIR` (Node only). Name frameworks to run only those (`python_frameworks.py langchain
crewai-agent`; `node_frameworks.mjs ai-sdk`). A package that is not installed is skipped. Exit
status 1 if any check fails. `--json` prints the summary on one line.

**Against the hosted API**, never use `--vectors` (about 130 calls per framework). Use `--lean` (no
rent-schedule check, no second filter session), `FACTLOT_MIN_GAP_S=2.1` or more, one framework at a
time, and a User-Agent. A lean run costs the requests in the table
[above](#know-these-before-you-start), plus one for the baseline `tools/list` (cached by
`FACTLOT_BASELINE_FILE`); the hosted pass for this guide was 29 requests in all. To check the Vercel AI SDK on
the hosted API, run `node_frameworks.mjs --lean ai-sdk` once: 9 requests.
