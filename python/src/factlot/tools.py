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
import os
from functools import lru_cache
from importlib import resources
from typing import Any

from . import __version__
from ._core import CalcInputError, input_shape_issue
from .calc import CALCULATORS
from .rules import RULES
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


# Length caps on identifier and query strings (the same .max() values as the TypeScript catalog).
_STRING_CAPS = {
    "state_fips": 16, "county_fips": 16, "apn": 200, "jurisdiction": 64, "registry_number": 200,
    "building_urn": 500, "suite": 200, "urn": 500, "system": 100, "external_id": 200,
    "entity_urn": 500, "query": 500,
}


def _str(args: dict[str, Any], key: str) -> str:
    v = args.get(key)
    if not isinstance(v, str):
        raise _InputError(key, "expected string")
    cap = _STRING_CAPS.get(key)
    if cap is not None and len(v) > cap:
        raise _InputError(key, f"expected at most {cap} characters")
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


class _RegistryUnavailable(RuntimeError):
    pass


class _NotFound(LookupError):
    pass


_registry_cache: dict[str, Any] = {}


def configure_registry(path: str | None) -> None:
    """Point registry_* tools at a SQLite file (None: fall back to FACTLOT_REGISTRY_DB)."""
    _registry_cache.clear()
    if path is None:
        _registry_cache.pop("override", None)
    else:
        _registry_cache["override"] = path


def _registry():
    path = _registry_cache.get("override") or os.environ.get("FACTLOT_REGISTRY_DB")
    if not path:
        raise _RegistryUnavailable("no FactLot Registry configured (set FACTLOT_REGISTRY_DB)")
    if _registry_cache.get("path") != path:
        from .registry import Registry

        try:
            _registry_cache["db"] = Registry.open_readonly(path)
        except (FileNotFoundError, OSError):
            # No path or OS message: agents and remote callers see this text (same as TypeScript).
            raise _RegistryUnavailable("cannot open the FactLot Registry configured in FACTLOT_REGISTRY_DB") from None
        _registry_cache["path"] = path
    return _registry_cache["db"]


def _limit(args: dict[str, Any]) -> int:
    v = args.get("limit", 20)
    if isinstance(v, bool) or not isinstance(v, int) or not 1 <= v <= 100:
        raise _InputError("limit", "expected integer 1–100")
    return v


def _registry_get(args: dict[str, Any]) -> dict[str, Any]:
    urn = _str(args, "urn")
    hist = args.get("include_history", False)
    if not isinstance(hist, bool):
        raise _InputError("include_history", "expected boolean")
    record = _registry().get(urn)
    if record is None:
        raise _NotFound(f"no registry record for {urn}")
    return {**record, "history": _registry().facts(urn, history=True)} if hist is True else record


def _nonempty(args: dict[str, Any], key: str) -> str:
    v = _str(args, key)
    if not v:
        raise _InputError(key, "must not be empty")
    return v


def _search(kind: str):
    def run(args: dict[str, Any]) -> dict[str, Any]:
        query, limit = _nonempty(args, "query"), _limit(args)  # validate before touching the registry
        reg = _registry()
        return {"results": reg.search_address(query, limit) if kind == "address" else reg.search_entities(query, limit)}

    return run


def _resolve_parcel(args: dict[str, Any]) -> dict[str, Any]:
    sf, cf, apn = _str(args, "state_fips"), _str(args, "county_fips"), _str(args, "apn")
    return {"urn": _registry().resolve_parcel(sf, cf, apn)}


def _resolve_external(args: dict[str, Any]) -> dict[str, Any]:
    system, ext = _str(args, "system"), _str(args, "external_id")
    return {"urn": _registry().resolve_external(system, ext)}


def _owned_by(args: dict[str, Any]) -> dict[str, Any]:
    urn = _str(args, "entity_urn")
    return {"results": _registry().parcels_owned_by(urn)}


_REGISTRY_TOOLS = {
    "registry_get": _registry_get,
    "registry_resolve_parcel": _resolve_parcel,
    "registry_resolve_external": _resolve_external,
    "registry_search_address": _search("address"),
    "registry_search_entities": _search("entities"),
    "registry_owned_by": _owned_by,
}

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
    if not isinstance(name, str):
        return {"error": "UnknownTool", "message": f"no FactLot tool named {name!r}", "issues": []}
    known = ((name.startswith("calc_") and name[5:] in CALCULATORS) or (name.startswith("rules_") and name[6:] in RULES)
             or name in _OTHER_TOOLS or name in _REGISTRY_TOOLS)
    if not known:
        return {"error": "UnknownTool", "message": f"no FactLot tool named {name!r}", "issues": []}
    kind = "CalcInputError" if name.startswith(("calc_", "rules_")) else "InputError"
    args: Any = {} if arguments is None else arguments
    # Structural caps first, as in TypeScript: agents can send any JSON.
    shape = input_shape_issue(args)
    if shape is not None:
        return {"error": kind, "message": f"invalid input: {shape['path'] or '(root)'}: {shape['message']}",
                "issues": [shape]}
    if not isinstance(args, dict):
        return {"error": kind, "message": "invalid input: (root): expected object",
                "issues": [{"path": "", "message": "expected object"}]}
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
        if name.startswith("rules_") and name[6:] in RULES:
            fn, rule_id, version = RULES[name[6:]]
            return {
                **fn(args),
                "provenance": {
                    "method": "computed",
                    "formula": f"{rule_id}@{version}",
                    "producer": {"name": "factlot (python)", "version": __version__},
                    "sources": [],
                },
            }
        if name in _OTHER_TOOLS:
            return _OTHER_TOOLS[name](args)
        if name in _REGISTRY_TOOLS:
            return _REGISTRY_TOOLS[name](args)
    except CalcInputError as e:
        return {"error": "CalcInputError", "message": str(e), "issues": e.issues}
    except FactLotIdError as e:
        return {"error": "FactLotIdError", "message": str(e), "issues": []}
    except _InputError as e:
        return {"error": "InputError", "message": str(e), "issues": e.issues}
    except _RegistryUnavailable as e:
        return {"error": "RegistryUnavailable", "message": str(e), "issues": []}
    except _NotFound as e:
        return {"error": "NotFound", "message": str(e), "issues": []}
    return {"error": "UnknownTool", "message": f"no FactLot tool named {name!r}", "issues": []}
