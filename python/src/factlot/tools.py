"""Drop-in tools for every major AI platform, plus a single dispatcher.

    import factlot
    tools = factlot.anthropic_tools()        # Claude Messages API
    tools = factlot.openai_tools()           # OpenAI Chat Completions, Mistral, xAI, DeepSeek, Groq, ...
    tools = factlot.openai_responses_tools() # OpenAI Responses API
    tools = factlot.gemini_tools()           # Google Gemini (google-genai `tools=`)
    cfg   = factlot.bedrock_tool_config()    # Amazon Bedrock Converse `toolConfig`
    # when the model calls a tool:
    result = factlot.run_tool(name, arguments)

Definitions are generated from the TypeScript catalog (``spec/schemas``), so every
platform and both SDKs see identical tool names and inputs.
"""

from __future__ import annotations

import base64
import binascii
import copy
import json
from functools import lru_cache
from importlib import resources
from typing import Any

from . import __version__
from ._core import CalcInputError
from .calc import CALCULATORS
from .facts import validate_fact
from .ids import FactLotIdError, document_id, entity_id, parcel_id, parse, short_id, space_id


@lru_cache(maxsize=None)
def _load(path: str) -> Any:
    return json.loads(resources.files("factlot").joinpath(f"schemas/{path}").read_text("utf-8"))


def tool_definitions() -> list[dict[str, Any]]:
    """Canonical definitions: name, title, description, path, formula, input_schema."""
    return copy.deepcopy(_load("tools.json")["tools"])


def anthropic_tools() -> list[dict[str, Any]]:
    """Claude Messages API ``tools`` (also via Bedrock, Vertex AI, and Foundry Anthropic clients)."""
    return copy.deepcopy(_load("providers/anthropic.json")["tools"])


def openai_tools() -> list[dict[str, Any]]:
    """OpenAI Chat Completions ``tools`` — also Mistral, xAI, DeepSeek, Groq, and other OpenAI-compatible APIs."""
    return copy.deepcopy(_load("providers/openai-chat.json")["tools"])


def openai_responses_tools() -> list[dict[str, Any]]:
    """OpenAI Responses API ``tools`` (flat function shape)."""
    return copy.deepcopy(_load("providers/openai-responses.json")["tools"])


def gemini_tools() -> list[dict[str, Any]]:
    """Google Gemini ``tools``: ``[{"functionDeclarations": [...]}]`` with a conservative schema subset."""
    return copy.deepcopy(_load("providers/gemini.json")["tools"])


def bedrock_tool_config() -> dict[str, Any]:
    """Amazon Bedrock Converse API ``toolConfig``."""
    return copy.deepcopy(_load("providers/bedrock-converse.json")["toolConfig"])


def openapi(version: str = "3.1", server_url: str | None = None) -> dict[str, Any]:
    """OpenAPI document ("3.1" for Custom GPT Actions, "3.0" for Bedrock Agents / Microsoft plugins)."""
    doc = copy.deepcopy(_load("openapi-3.1.json" if version.startswith("3.1") else "openapi-3.0.json"))
    if server_url:
        doc["servers"] = [{"url": server_url}]
    return doc


# --- dispatch --------------------------------------------------------------------------------


class _InputError(ValueError):
    def __init__(self, path: str, message: str) -> None:
        super().__init__(f"invalid input: {path}: {message}")
        self.issues = [{"path": path, "message": message}]


def _str(args: dict[str, Any], key: str) -> str:
    v = args.get(key)
    if not isinstance(v, str):
        raise _InputError(key, "expected string")
    return v


def _id_document(args: dict[str, Any]) -> dict[str, Any]:
    has_b64, has_text = args.get("content_base64") is not None, args.get("text") is not None
    if has_b64 == has_text:
        raise _InputError("", "provide exactly one of content_base64 or text")
    if has_b64:
        try:
            data = base64.b64decode(_str(args, "content_base64"))
        except (binascii.Error, ValueError):
            raise _InputError("content_base64", "invalid base64") from None
        return document_id(data).as_dict()
    return document_id(_str(args, "text")).as_dict()


def _id_parse(args: dict[str, Any]) -> dict[str, Any]:
    urn = _str(args, "urn")
    kind, parts = parse(urn)
    return {"kind": kind, "parts": parts, "urn": urn, "short": short_id(urn)}


def _fact_validate(args: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(args.get("fact"), dict):
        raise _InputError("fact", "expected object")
    return validate_fact(args["fact"])


_OTHER_TOOLS = {
    "id_parcel": lambda a: parcel_id(_str(a, "state_fips"), _str(a, "county_fips"), _str(a, "apn")).as_dict(),
    "id_entity": lambda a: entity_id(_str(a, "jurisdiction"), _str(a, "registry_number")).as_dict(),
    "id_space": lambda a: space_id(_str(a, "building_urn"), _str(a, "suite")).as_dict(),
    "id_document": _id_document,
    "id_parse": _id_parse,
    "fact_validate": _fact_validate,
}


def run_tool(name: str, arguments: dict[str, Any] | None) -> dict[str, Any]:
    """Execute a FactLot tool by name, exactly as the MCP server and REST API do.

    Returns the tool result. Calculator results include ``provenance`` for a FactLot
    ``computed`` fact. Invalid input returns ``{"error", "message", "issues"}`` instead of
    raising, so the model can read the problem and retry.
    """
    args = arguments if isinstance(arguments, dict) else {}
    try:
        if name.startswith("calc_") and name[5:] in CALCULATORS:
            fn, formula_id, version = CALCULATORS[name[5:]]
            return {
                **fn(args),
                "provenance": {
                    "method": "computed",
                    "formula": f"{formula_id}@{version}",
                    "producer": {"name": "factlot (python)", "version": __version__},
                    "sources": [],
                },
            }
        if name in _OTHER_TOOLS:
            return _OTHER_TOOLS[name](args)
    except CalcInputError as e:
        return {"error": "CalcInputError", "message": str(e), "issues": e.issues}
    except FactLotIdError as e:
        return {"error": "FactLotIdError", "message": str(e), "issues": []}
    except _InputError as e:
        return {"error": "InputError", "message": str(e), "issues": e.issues}
    return {"error": "UnknownTool", "message": f"no FactLot tool named {name!r}", "issues": []}
