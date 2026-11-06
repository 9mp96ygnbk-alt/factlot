#!/usr/bin/env python3
"""Run the connector-guide recipes for Python agent frameworks against a FactLot MCP endpoint.

This is NOT part of `npm test` or CI. It needs no LLM key: it tests the MCP connection layer
(connect, load tools, convert schemas, invoke tools through each framework's own tool object).
See connectors/frameworks/README.md for the recipes this script mirrors.

    python3.13 -m venv .venv && . .venv/bin/activate
    pip install -r scripts/e2e/frameworks/requirements.txt
    FACTLOT_MCP_URL=http://127.0.0.1:8787/mcp python scripts/e2e/frameworks/python_frameworks.py

Environment:
  FACTLOT_MCP_URL       MCP endpoint (default http://127.0.0.1:8787/mcp; hosted: https://api.factlot.com/mcp)
  FACTLOT_API_KEY       optional; sent as `Authorization: Bearer <key>`
  FACTLOT_USER_AGENT    User-Agent header (default factlot-framework-recipes/1.0)
  FACTLOT_MIN_GAP_S     minimum seconds between HTTP requests made through the shared client
                        (default 0; use 2 or more against the hosted free tier)
  FACTLOT_BASELINE_FILE optional path; the server's tools/list is cached there so a second run
                        (or the Node script) does not fetch it again

Options:  [framework ...]  limit to: mcp-sdk langchain openai-agents crewai-adapter crewai-agent
          --json           print the result summary as JSON on the last line
          --lean           fewest requests: skip the rent-schedule check and the second filter
                           server, and fetch only tools/list as the baseline (hosted free tier)
          --vectors        also replay every calculator case in spec/vectors/calc through each
                           framework's tool object and compare with a direct call (about 200 calls
                           per framework; for a local server, never the hosted API)
Frameworks whose packages are not installed are skipped. Exit status 1 if any check fails.

The hosted free tier allows 60 requests a minute per address, and every MCP call is at least one
HTTP request (a session is initialize + initialized + the calls). A full run is roughly 40 to 60
requests, so against api.factlot.com set FACTLOT_MIN_GAP_S and run one framework at a time.
"""

from __future__ import annotations

import asyncio
import copy
import importlib.metadata as md
import json
import os
import sys
import time
import traceback
from collections import Counter
from contextlib import AsyncExitStack

URL = os.environ.get("FACTLOT_MCP_URL", "http://127.0.0.1:8787/mcp")
API_KEY = os.environ.get("FACTLOT_API_KEY")
USER_AGENT = os.environ.get("FACTLOT_USER_AGENT", "factlot-framework-recipes/1.0")
MIN_GAP_S = float(os.environ.get("FACTLOT_MIN_GAP_S", "0"))
BASELINE_FILE = os.environ.get("FACTLOT_BASELINE_FILE")
LEAN = False  # --lean: fewest requests (hosted free tier); set in main()

# Inputs shared by every recipe. The lease page is SYNTHETIC test text, not a real lease.
DEBT_INPUT = {
    "noi": 1_000_000,
    "value": 15_000_000,
    "rate_annual": 0.06,
    "amortization_years": 30,
    "max_ltv": 0.65,
    "min_dscr": 1.25,
}
DOC_INPUT = {
    "document": {
        "title": "Synthetic lease page (not a real lease)",
        "pages": [
            "SYNTHETIC EXAMPLE - NOT A REAL LEASE. Tenant shall deposit the sum of $95,000.00 "
            "with Landlord. The Term shall expire on June 30, 2031."
        ],
    },
    "candidates": [
        {
            "predicate": "lease.security_deposit",
            "value": 95000,
            "quote": "deposit the sum of $95,000.00 with Landlord",
            "page": 1,
        },
        # A deliberate misread: the page says 2031, so this one must not come back verified.
        {
            "predicate": "lease.expiration_date",
            "value": "2033-06-30",
            "quote": "shall expire on June 30, 2031",
            "page": 1,
        },
    ],
    "as_of": "2026-11-06",
}
# A tool whose input uses oneOf/const (the `escalation` union). If a framework drops or rewrites
# the union, the bump disappears and the totals no longer match the direct call.
RENT_INPUT = {
    "commencement_date": "2026-01-01",
    "term_months": 60,
    "area_sf": 10000,
    "starting_rent_psf_annual": 30,
    "escalation": {"type": "percent", "rate": 0.03},
    "abated_months": [1, 2, 3],
}
VECTOR_CASES: list | None = None  # filled by main() when --vectors is given
WANTED = ["calc_debt_sizing", "calc_irr", "doc_verify_facts"]  # the "only some tools" demo

# JSON Schema keywords the framework conversion could drop or change.
TRACKED = [
    "oneOf", "anyOf", "const", "enum", "propertyNames", "additionalProperties", "required",
    "minItems", "maxItems", "minLength", "maxLength", "pattern", "format", "minimum", "maximum",
    "exclusiveMinimum", "exclusiveMaximum", "default",
]  # fmt: skip


# ---------------------------------------------------------------------------------------------
# Shared HTTP behaviour: User-Agent, bearer key, optional pacing, and the 429 policy.
# Used as `httpx_client_factory` by the MCP Python SDK 1.x and the frameworks built on it.
# ---------------------------------------------------------------------------------------------


def mcp_httpx():
    """The HTTP library the installed MCP SDK uses: httpx for 1.x, httpx2 for 2.x."""
    if int(md.version("mcp").split(".")[0]) >= 2:
        import httpx2

        return httpx2
    import httpx

    return httpx


def make_client_factory(httpx):
    """Return an `httpx_client_factory` for `httpx` (use `httpx2` with the MCP SDK 2.x)."""

    class FactLotTransport(httpx.AsyncHTTPTransport):
        """Honour Retry-After on HTTP 429 and keep a minimum gap between requests."""

        def __init__(self, *, max_retries: int = 2, max_wait: float = 70.0, **kw):
            super().__init__(**kw)
            self.max_retries, self.max_wait = max_retries, max_wait
            self._last = 0.0
            self._lock = asyncio.Lock()

        async def handle_async_request(self, request):
            for attempt in range(self.max_retries + 1):
                if MIN_GAP_S:
                    async with self._lock:
                        pause = self._last + MIN_GAP_S - time.monotonic()
                        if pause > 0:
                            await asyncio.sleep(pause)
                        self._last = time.monotonic()
                response = await super().handle_async_request(request)
                if response.status_code != 429 or attempt == self.max_retries:
                    return response
                wait = await retry_after_seconds(response)
                await response.aclose()
                print(f"  429 from server; waiting {wait:.0f}s (retry {attempt + 1})", flush=True)
                await asyncio.sleep(min(wait, self.max_wait))

    def factory(headers=None, timeout=None, auth=None):
        merged = {"User-Agent": USER_AGENT, **(headers or {})}
        if API_KEY:
            merged["Authorization"] = f"Bearer {API_KEY}"
        return httpx.AsyncClient(
            headers=merged,
            timeout=timeout or httpx.Timeout(30.0, read=300.0),
            auth=auth,
            transport=FactLotTransport(),
        )

    return factory


async def retry_after_seconds(response) -> float:
    """Seconds to wait: the Retry-After header, else data.retry_after_seconds in the body, else 60."""
    try:
        return float(response.headers["retry-after"])
    except (KeyError, ValueError):
        pass
    try:
        await response.aread()
        body = response.json()
        err = body.get("error", body)
        return float((err.get("data") or err)["retry_after_seconds"])
    except Exception:  # noqa: BLE001 - any parse failure falls back to the documented window
        return 60.0


def http_headers() -> dict:
    h = {"User-Agent": USER_AGENT}
    if API_KEY:
        h["Authorization"] = f"Bearer {API_KEY}"
    return h


# ---------------------------------------------------------------------------------------------
# Result checks and schema comparison
# ---------------------------------------------------------------------------------------------


def text_of(result) -> str:
    """Pull the JSON text out of whatever a framework returns for a tool call."""
    if isinstance(result, str):
        return result
    if isinstance(result, dict):
        return result.get("text") or "".join(text_of(c) for c in result.get("content", []))
    if isinstance(result, list):
        return "".join(text_of(c) for c in result)
    content = getattr(result, "content", None)
    if content is not None:
        return text_of(content)
    return getattr(result, "text", "") or str(result)


def check_debt(result) -> dict:
    body = json.loads(text_of(result))
    assert body["value"]["max_loan"] == 9_750_000, body["value"]
    assert body["provenance"]["formula"].startswith("calc.debt_sizing@"), body["provenance"]
    return {"max_loan": body["value"]["max_loan"], "formula": body["provenance"]["formula"]}


def check_doc(result) -> dict:
    body = json.loads(text_of(result))
    verified = [v["fact"]["predicate"] for v in body["verified"]]
    review = [(r["predicate"], r["reason"]) for r in body["needs_review"]]
    assert verified == ["lease.security_deposit"], body
    assert [p for p, _ in review] == ["lease.expiration_date"], body
    return {"verified": verified, "needs_review": review}


def check_rent(result, reference: dict) -> dict:
    body = json.loads(text_of(result))
    assert "value" in body, body
    assert body["value"] == reference["value"], "escalation union was not passed through unchanged"
    return {"total_rent_due": body["value"]["total_rent_due"]}


VECTOR_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "..", "spec", "vectors", "calc")


async def load_vector_cases() -> list[tuple[str, dict, dict]]:
    """(tool, input, direct-call result) for every calculator vector the server accepts."""
    import glob

    cases = []
    async with make_client_factory(mcp_httpx())() as c:
        for path in sorted(glob.glob(os.path.join(VECTOR_DIR, "*.json"))):
            doc = json.load(open(path))
            tool = doc["calculator"].replace(".", "_")
            for case in doc["cases"]:
                r = await c.post(
                    URL,
                    json={"jsonrpc": "2.0", "id": 1, "method": "tools/call",
                          "params": {"name": tool, "arguments": case["input"]}},
                    headers={"accept": "application/json, text/event-stream"},
                )
                body = r.json()["result"]
                if body.get("isError"):
                    continue  # an expect_error case: frameworks surface errors differently
                cases.append((tool, case["input"], json.loads(text_of(body["content"]))))
    return cases


def vector_summary(attempts: list[tuple[str, int, str | None]]) -> dict:
    bad = [a for a in attempts if a[2]]
    return {
        "cases": len(attempts),
        "matched": len(attempts) - len(bad),
        "failures": [f"{t}[{i}]: {e}" for t, i, e in bad[:8]],
    }


async def replay_vectors(call, cases) -> dict:
    attempts = []
    for i, (tool, args, ref) in enumerate(cases):
        try:
            got = json.loads(text_of(await call(tool, args)))
            attempts.append((tool, i, None if got == ref else "result differs from the direct call"))
        except Exception as exc:  # noqa: BLE001
            attempts.append((tool, i, f"{type(exc).__name__}: {exc}"[:240]))
    return vector_summary(attempts)


def replay_vectors_sync(call, cases) -> dict:
    attempts = []
    for i, (tool, args, ref) in enumerate(cases):
        try:
            got = json.loads(text_of(call(tool, args)))
            attempts.append((tool, i, None if got == ref else f"differs: {str(got)[:160]}"))
        except Exception as exc:  # noqa: BLE001
            attempts.append((tool, i, f"{type(exc).__name__}: {exc}"[:240]))
    return vector_summary(attempts)


def _walk(node, counts: Counter) -> None:
    """Count JSON Schema keywords, treating `properties` keys as names, not keywords."""
    if isinstance(node, list):
        for item in node:
            _walk(item, counts)
        return
    if not isinstance(node, dict):
        return
    for key, value in node.items():
        if key in ("properties", "$defs", "definitions", "patternProperties") and isinstance(value, dict):
            for sub in value.values():
                _walk(sub, counts)
            continue
        if key in TRACKED:
            counts[key] += 1
        _walk(value, counts)


def keyword_counts(schema) -> Counter:
    c: Counter = Counter()
    _walk(schema, c)
    return c


def compare_schemas(server_tools: dict[str, dict], converted: dict[str, dict]) -> dict:
    """How much of each server schema survives a framework's conversion (by keyword counts)."""
    missing = sorted(set(server_tools) - set(converted))
    exact = 0
    lost: Counter = Counter()
    gained: Counter = Counter()
    notable: dict[str, list[str]] = {}
    for name, original in server_tools.items():
        if name not in converted:
            continue
        got = converted[name]
        if got == original:
            exact += 1
        before, after = keyword_counts(original), keyword_counts(got)
        for kw in TRACKED:
            if before[kw] > after[kw]:
                lost[kw] += before[kw] - after[kw]
                if kw in ("oneOf", "const", "propertyNames"):
                    notable.setdefault(kw, []).append(name)
            elif after[kw] > before[kw]:
                gained[kw] += after[kw] - before[kw]
    return {
        "tools_missing": missing,
        "identical": exact,
        "of": len(server_tools),
        "lost": dict(lost),
        "gained": dict(gained),
        "tools_losing_oneOf_const_propertyNames": notable,
    }


async def baseline_from_server() -> tuple[dict[str, dict], dict]:
    """The server's own tools/list and a reference rent schedule, fetched with plain httpx
    (raw JSON-RPC, no framework) so every comparison has one baseline."""

    async def rpc(c, method: str, params: dict | None = None) -> dict:
        r = await c.post(
            URL,
            json={"jsonrpc": "2.0", "id": 1, "method": method, **({"params": params} if params else {})},
            headers={"accept": "application/json, text/event-stream", "content-type": "application/json"},
        )
        r.raise_for_status()
        body = r.text
        if body.lstrip().startswith(("event:", "data:")):
            body = next(line[5:] for line in body.splitlines() if line.startswith("data:"))
        return json.loads(body)["result"]

    async with make_client_factory(mcp_httpx())() as c:  # same UA, key, pacing and 429 policy
        if BASELINE_FILE and os.path.exists(BASELINE_FILE):
            tools = json.load(open(BASELINE_FILE))
        else:
            tools = (await rpc(c, "tools/list"))["tools"]
            if BASELINE_FILE:
                json.dump(tools, open(BASELINE_FILE, "w"))
        ref = None
        if not LEAN:
            ref = json.loads(text_of((await rpc(c, "tools/call", {"name": "calc_rent_schedule", "arguments": RENT_INPUT}))["content"]))
    return {t["name"]: t["inputSchema"] for t in tools}, ref


# ---------------------------------------------------------------------------------------------
# Recipes. Each returns a dict of findings and raises on a failed check.
# ---------------------------------------------------------------------------------------------


async def run_mcp_sdk(baseline, ref) -> dict:
    """Official MCP Python SDK, no framework. Handles both 2.x (Client) and 1.x (ClientSession)."""
    out: dict = {"version": md.version("mcp")}
    if int(out["version"].split(".")[0]) >= 2:
        import httpx2
        from mcp import Client
        from mcp.client.streamable_http import streamable_http_client

        factory = make_client_factory(httpx2)
        async with factory() as http:
            async with Client(streamable_http_client(URL, http_client=http)) as client:
                listed = (await client.list_tools()).tools
                out["tools"] = len(listed)
                out["filtered"] = sorted(t.name for t in listed if t.name in WANTED)
                out["schema"] = compare_schemas(baseline, {t.name: t.input_schema for t in listed})
                out["debt"] = check_debt(await client.call_tool("calc_debt_sizing", DEBT_INPUT))
                out["doc"] = check_doc(await client.call_tool("doc_verify_facts", DOC_INPUT))
                if not LEAN:
                    out["rent"] = check_rent(await client.call_tool("calc_rent_schedule", RENT_INPUT), ref)
                if VECTOR_CASES is not None:
                    out["vectors"] = await replay_vectors(client.call_tool, VECTOR_CASES)
    else:
        import httpx
        from mcp import ClientSession
        from mcp.client.streamable_http import streamablehttp_client

        async with streamablehttp_client(URL, httpx_client_factory=make_client_factory(httpx)) as (r, w, _):
            async with ClientSession(r, w) as session:
                await session.initialize()
                listed = (await session.list_tools()).tools
                out["tools"] = len(listed)
                out["filtered"] = sorted(t.name for t in listed if t.name in WANTED)
                out["schema"] = compare_schemas(baseline, {t.name: t.inputSchema for t in listed})
                out["debt"] = check_debt(await session.call_tool("calc_debt_sizing", DEBT_INPUT))
                out["doc"] = check_doc(await session.call_tool("doc_verify_facts", DOC_INPUT))
                if not LEAN:
                    out["rent"] = check_rent(await session.call_tool("calc_rent_schedule", RENT_INPUT), ref)
                if VECTOR_CASES is not None:
                    out["vectors"] = await replay_vectors(session.call_tool, VECTOR_CASES)
    assert set(out["filtered"]) == set(WANTED), out["filtered"]
    return out


async def run_langchain(baseline, ref) -> dict:
    import httpx
    from langchain_core.messages import AIMessage
    from langchain_core.utils.function_calling import convert_to_openai_tool
    from langchain_mcp_adapters.client import MultiServerMCPClient
    from langchain_mcp_adapters.tools import load_mcp_tools
    from langgraph.graph import END, START, MessagesState, StateGraph
    from langgraph.prebuilt import ToolNode

    out: dict = {"version": f"langchain-mcp-adapters {md.version('langchain-mcp-adapters')}, "
                 f"langgraph {md.version('langgraph')}, langchain-core {md.version('langchain-core')}"}
    client = MultiServerMCPClient(
        {
            "factlot": {
                "transport": "streamable_http",
                "url": URL,
                "headers": http_headers(),
                "httpx_client_factory": make_client_factory(httpx),
            }
        }
    )
    # One session for everything: get_tools() alone opens a fresh session for every tool call.
    async with client.session("factlot") as session:
        tools = await load_mcp_tools(session)
        out["tools"] = len(tools)
        out["filtered"] = sorted(t.name for t in tools if t.name in WANTED)
        by = {t.name: t for t in tools}
        out["schema"] = compare_schemas(baseline, {t.name: t.args_schema for t in tools})
        # What a chat model is given: LangChain's own OpenAI-format conversion of every tool.
        converted, failures = {}, {}
        for t in tools:
            try:
                converted[t.name] = convert_to_openai_tool(t)["function"]["parameters"]
            except Exception as exc:  # noqa: BLE001
                failures[t.name] = f"{type(exc).__name__}: {exc}"[:200]
        out["openai_format_schema"] = compare_schemas(baseline, converted)
        out["openai_format_failures"] = failures
        out["debt"] = check_debt(await by["calc_debt_sizing"].ainvoke(DEBT_INPUT))
        if not LEAN:
            out["rent"] = check_rent(await by["calc_rent_schedule"].ainvoke(RENT_INPUT), ref)
        if VECTOR_CASES is not None:
            out["vectors"] = await replay_vectors(lambda n, a: by[n].ainvoke(a), VECTOR_CASES)
        # The same tools in a LangGraph graph (START -> ToolNode -> END), driven by a hand-written
        # tool call where the model's message would be. No LLM is called.
        builder = StateGraph(MessagesState)
        builder.add_node("tools", ToolNode([by["calc_irr"], by["doc_verify_facts"]]))
        builder.add_edge(START, "tools")
        builder.add_edge("tools", END)
        graph = builder.compile()
        msg = AIMessage(
            content="",
            tool_calls=[{"name": "doc_verify_facts", "args": DOC_INPUT, "id": "call_1"}],
        )
        state = await graph.ainvoke({"messages": [msg]})
        tool_msg = state["messages"][-1]
        assert tool_msg.status != "error", tool_msg.content
        out["doc"] = check_doc(tool_msg.content)
    return out


async def run_openai_agents(baseline, ref) -> dict:
    from agents import Agent, RunContextWrapper
    from agents.mcp import MCPServerStreamableHttp, MCPUtil, create_static_tool_filter
    from agents.tool_context import ToolContext

    out: dict = {"version": f"openai-agents {md.version('openai-agents')}, mcp {md.version('mcp')}"}
    params = {
        "url": URL,
        "headers": http_headers(),
        "httpx_client_factory": make_client_factory(mcp_httpx()),
    }
    # client_session_timeout_seconds defaults to 5, which a Retry-After sleep would exceed.
    # A static allow-list. The SDK still downloads the full tools/list and drops the rest.
    async with AsyncExitStack() as stack:
        server = await stack.enter_async_context(
            MCPServerStreamableHttp(
                name="factlot-all", params=params, cache_tools_list=True, client_session_timeout_seconds=130
            )
        )
        some = None
        if not LEAN:  # a second server object is a second session (4 more requests)
            some = await stack.enter_async_context(
                MCPServerStreamableHttp(
                    name="factlot-some",
                    params=params,
                    cache_tools_list=True,
                    client_session_timeout_seconds=130,
                    tool_filter=create_static_tool_filter(allowed_tool_names=WANTED),
                )
            )
        agent = Agent(name="recipes", mcp_servers=[server])
        ctx = RunContextWrapper(context=None)
        listed = await server.list_tools()
        out["tools"] = len(listed)
        names = sorted(t.name for t in await (some or server).list_tools())
        out["filtered"] = names if some else [n for n in names if n in WANTED]
        non_strict = await MCPUtil.get_all_function_tools([server], False, ctx, agent)
        strict = await MCPUtil.get_all_function_tools([server], True, ctx, agent)
        out["schema"] = compare_schemas(baseline, {t.name: t.params_json_schema for t in non_strict})
        out["strict_mode_fallbacks"] = sorted(t.name for t in strict if not t.strict_json_schema)
        out["strict_mode_schema"] = compare_schemas(baseline, {t.name: t.params_json_schema for t in strict})
        by = {t.name: t for t in non_strict}

        async def invoke(name: str, args: dict):
            tc = ToolContext(
                context=None, tool_name=name, tool_call_id="call_1", tool_arguments=json.dumps(args)
            )
            return await by[name].on_invoke_tool(tc, tc.tool_arguments)

        out["debt"] = check_debt(await invoke("calc_debt_sizing", DEBT_INPUT))
        out["doc"] = check_doc(await invoke("doc_verify_facts", DOC_INPUT))
        if not LEAN:
            out["rent"] = check_rent(await invoke("calc_rent_schedule", RENT_INPUT), ref)
        if VECTOR_CASES is not None:
            out["vectors"] = await replay_vectors(invoke, VECTOR_CASES)
    return out


def without_nulls(value):
    """Recursively remove None values from dicts and lists."""
    if isinstance(value, dict):
        return {k: without_nulls(v) for k, v in value.items() if v is not None}
    if isinstance(value, list):
        return [without_nulls(v) for v in value]
    return value


def drop_nulls(tool):
    """crewai-tools turns every optional field into `anyOf [..., null]` with a null default and sends
    the nulls to the server, which rejects them. Strip None, at any depth, before the call."""
    inner = tool._run
    object.__setattr__(tool, "_run", lambda **kw: inner(**without_nulls(kw)))
    return tool


def run_crewai_adapter(baseline, ref) -> dict:
    from crewai_tools import MCPServerAdapter

    out: dict = {"version": f"crewai {md.version('crewai')}, crewai-tools {md.version('crewai-tools')}"}
    import httpx

    params = {
        "url": URL,
        "transport": "streamable-http",
        "headers": http_headers(),
        "httpx_client_factory": make_client_factory(httpx),
    }
    with MCPServerAdapter(params, connect_timeout=60) as tools:
        out["tools"] = len(tools)
        by = {t.name: t for t in tools}
        out["schema"] = compare_schemas(
            baseline, {t.name: t.args_schema.model_json_schema() for t in tools}
        )
        # Without the workaround the server sees explicit nulls for omitted optional fields.
        if not LEAN:
            raw = json.loads(text_of(by["calc_debt_sizing"].run(**DEBT_INPUT)))
            out["debt_without_drop_nulls"] = raw.get("message", "ok")[:200]
        for t in tools:
            drop_nulls(t)
        out["debt"] = check_debt(by["calc_debt_sizing"].run(**DEBT_INPUT))
        out["doc"] = check_doc(by["doc_verify_facts"].run(**DOC_INPUT))
        if not LEAN:
            out["rent"] = check_rent(by["calc_rent_schedule"].run(**RENT_INPUT), ref)
        if VECTOR_CASES is not None:
            out["vectors"] = replay_vectors_sync(lambda n, a: by[n].run(**a), VECTOR_CASES)
    if LEAN:
        out["filtered"] = sorted(n for n in by if n in WANTED)
    else:
        with MCPServerAdapter(params, *WANTED, connect_timeout=60) as some:
            out["filtered"] = sorted(t.name for t in some)
    return out


def run_crewai_agent(baseline, ref) -> dict:
    """CrewAI's native `mcps=[MCPServerHTTP(...)]` on an Agent. No LLM is called."""
    from crewai import Agent
    from crewai.mcp import MCPServerHTTP
    from crewai.mcp.filters import create_static_tool_filter

    out: dict = {"version": f"crewai {md.version('crewai')}"}
    headers = http_headers()
    cfg = MCPServerHTTP(url=URL, headers=headers, streamable=True, cache_tools_list=True)
    # The Agent needs an `llm` string to construct, but this script never runs it.
    os.environ.setdefault("OPENAI_API_KEY", "unused-placeholder")
    agent = Agent(role="recipes", goal="test", backstory="test", mcps=[cfg], llm="gpt-4o-mini")
    tools = agent.get_mcp_tools([cfg])
    out["tools"] = len(tools)
    # Native tools are named <server host>_<tool>; original_tool_name is the server's name.
    by = {t.original_tool_name: t for t in tools}
    out["tool_name_example"] = tools[0].name
    out["schema"] = compare_schemas(
        baseline,
        {n: t.args_schema.model_json_schema() for n, t in by.items() if t.args_schema is not None},
    )
    out["debt"] = check_debt(by["calc_debt_sizing"].run(**DEBT_INPUT))
    out["doc"] = check_doc(by["doc_verify_facts"].run(**DOC_INPUT))
    if not LEAN:
        out["rent"] = check_rent(by["calc_rent_schedule"].run(**RENT_INPUT), ref)
    if VECTOR_CASES is not None:
        out["vectors"] = replay_vectors_sync(lambda n, a: by[n].run(**a), VECTOR_CASES)
    some_cfg = MCPServerHTTP(
        url=URL,
        headers=headers,
        tool_filter=create_static_tool_filter(allowed_tool_names=WANTED),
    )
    if not LEAN:
        some = agent.get_mcp_tools([some_cfg])
        out["filtered"] = sorted(t.original_tool_name for t in some)
    return out


RUNNERS = {
    "mcp-sdk": run_mcp_sdk,
    "langchain": run_langchain,
    "openai-agents": run_openai_agents,
    "crewai-adapter": run_crewai_adapter,
    "crewai-agent": run_crewai_agent,
}
NEEDS = {
    "mcp-sdk": "mcp",
    "langchain": "langchain-mcp-adapters",
    "openai-agents": "openai-agents",
    "crewai-adapter": "crewai-tools",
    "crewai-agent": "crewai",
}


def main(argv: list[str]) -> int:
    as_json = "--json" in argv
    names = [a for a in argv if not a.startswith("--")] or list(RUNNERS)
    unknown = [n for n in names if n not in RUNNERS]
    if unknown:
        print(f"unknown framework(s) {unknown}; choose from {list(RUNNERS)}")
        return 2
    print(f"endpoint {URL}  user-agent {USER_AGENT!r}  key {'set' if API_KEY else 'not set'}")
    global VECTOR_CASES, LEAN
    LEAN = "--lean" in argv
    baseline, ref = asyncio.run(baseline_from_server())
    if "--vectors" in argv:
        VECTOR_CASES = asyncio.run(load_vector_cases())
        print(f"vector cases: {len(VECTOR_CASES)}")
    print(f"server tools/list: {len(baseline)} tools")
    summary: dict[str, dict] = {}
    failed = 0
    for name in names:
        try:
            md.version(NEEDS[name])
        except md.PackageNotFoundError:
            print(f"[{name}] SKIPPED: {NEEDS[name]} is not installed")
            summary[name] = {"skipped": True}
            continue
        started = time.monotonic()
        try:
            runner = RUNNERS[name]
            result = asyncio.run(runner(baseline, ref)) if asyncio.iscoroutinefunction(runner) else runner(baseline, ref)
            result["seconds"] = round(time.monotonic() - started, 1)
            result["ok"] = True
            summary[name] = result
            print(f"[{name}] OK in {result['seconds']}s")
        except BaseException as exc:  # noqa: BLE001 - report every failure, then continue
            failed += 1
            summary[name] = {"ok": False, "error": f"{type(exc).__name__}: {exc}"[:500]}
            print(f"[{name}] FAILED: {type(exc).__name__}: {str(exc)[:300]}")
            traceback.print_exc(limit=4)
    print(json.dumps(summary, indent=None if as_json else 2, default=str))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
