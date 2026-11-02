"""Drop-in agent tools: FactLot calculators as function-calling tool definitions.

    import anthropic, factlot
    client.messages.create(..., tools=factlot.anthropic_tools())
    # when the model calls a tool:
    result = factlot.run_tool(block.name, block.input)

Tool definitions are generated from the TypeScript source of truth
(``spec/schemas/tools.json``), so Python and MCP agents see identical tools.
"""

from __future__ import annotations

import copy
import json
from functools import lru_cache
from importlib import resources
from typing import Any

from . import __version__
from ._core import CalcInputError
from .calc import CALCULATORS


@lru_cache(maxsize=1)
def _definitions() -> list[dict[str, Any]]:
    data = json.loads(resources.files("factlot").joinpath("schemas/tools.json").read_text("utf-8"))
    return data["tools"]


def _schema(tool: dict[str, Any]) -> dict[str, Any]:
    schema = copy.deepcopy(tool["input_schema"])
    schema.pop("$schema", None)
    return schema


def tool_definitions() -> list[dict[str, Any]]:
    """Raw definitions: name, title, description, formula, input_schema."""
    return copy.deepcopy(_definitions())


def anthropic_tools() -> list[dict[str, Any]]:
    """Tool definitions for the Claude Messages API ``tools`` parameter."""
    return [
        {"name": t["name"], "description": _describe(t), "input_schema": _schema(t)}
        for t in _definitions()
    ]


def openai_tools() -> list[dict[str, Any]]:
    """Tool definitions in the OpenAI-compatible ``{"type": "function", ...}`` shape."""
    return [
        {"type": "function", "function": {"name": t["name"], "description": _describe(t), "parameters": _schema(t)}}
        for t in _definitions()
    ]


def _describe(tool: dict[str, Any]) -> str:
    return (
        f"{tool['description']} Deterministic: use this instead of doing the math yourself, and cite "
        f"formula {tool['formula']['id']}@{tool['formula']['version']} and the returned steps."
    )


def run_tool(name: str, arguments: dict[str, Any]) -> dict[str, Any]:
    """Execute a FactLot tool by name.

    Returns the calculator result plus ``provenance`` for a FactLot ``computed`` fact.
    Invalid input returns ``{"error": ..., "message": ..., "issues": [...]}`` instead of
    raising, so the agent can read the problem and retry.
    """
    calc_name = name.removeprefix("calc_")
    if calc_name not in CALCULATORS:
        return {"error": "UnknownTool", "message": f"no FactLot tool named {name!r}", "issues": []}
    fn, formula_id, version = CALCULATORS[calc_name]
    try:
        result = fn(arguments)
    except CalcInputError as e:
        return {"error": "CalcInputError", "message": str(e), "issues": e.issues}
    return {
        **result,
        "provenance": {
            "method": "computed",
            "formula": f"{formula_id}@{version}",
            "producer": {"name": "factlot (python)", "version": __version__},
            "sources": [],
        },
    }
