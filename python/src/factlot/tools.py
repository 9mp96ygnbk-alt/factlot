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
import re
from functools import lru_cache
from importlib import resources
from typing import Any

from . import __version__
from ._core import CalcInputError, input_shape_issue, num_str
from .calc import CALCULATORS
from .rules import RULES
from . import docverify
from .ids import FactLotIdError, document_id, entity_id, parcel_id, parse, short_id, space_id


@lru_cache(maxsize=None)
def _load(path: str) -> Any:
    return json.loads(resources.files("factlot").joinpath(f"schemas/{path}").read_text("utf-8"))


def _edit_distance(a: str, b: str) -> int:
    row = list(range(len(b) + 1))
    for i in range(1, len(a) + 1):
        prev, row[0] = row[0], i
        for j in range(1, len(b) + 1):
            cur = row[j]
            row[j] = min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] != b[j - 1]))
            prev = cur
    return row[len(b)]


def _suggest(key: str, known: list[str]) -> str | None:
    best, best_d = None, None
    for k in known:
        d = _edit_distance(key.lower(), k.lower())
        if best_d is None or d < best_d:
            best, best_d = k, d
    return best if best is not None and best_d is not None and best_d <= max(2, len(key) // 3) else None


def _object_branches(schema: dict[str, Any]) -> list[dict[str, Any]]:
    union = schema.get("oneOf", schema.get("anyOf"))
    if union is None:
        return [schema] if "properties" in schema else []
    return [b for s in union for b in _object_branches(s)]


def unknown_fields(schema: dict[str, Any], value: Any, path: str = "") -> list[dict[str, str]]:
    """Fields in ``value`` that the tool's input schema does not define, with the nearest known name.

    Validation would otherwise ignore them, so a misspelled optional field ("controlable") changes
    the answer without any sign. Must match ``unknownFields`` in packages/tools/src/limits.ts.
    """
    if isinstance(value, list):
        items = schema.get("items")
        if not isinstance(items, dict):
            return []
        return [u for i, v in enumerate(value) for u in unknown_fields(items, v, f"{path}.{i}" if path else str(i))]
    if not isinstance(value, dict):
        return []
    branches = _object_branches(schema)
    if not branches:
        return []
    known: list[str] = []
    open_ = False
    for b in branches:
        for k in b["properties"]:
            if k not in known:
                known.append(k)
        if b.get("additionalProperties", False) is not False:
            open_ = True
    out: list[dict[str, str]] = []
    for k, v in value.items():
        at = f"{path}.{k}" if path else k
        if k not in known:
            if open_:
                continue
            near = _suggest(k, known)
            out.append({"path": at, "message": "unknown field" + (f' (did you mean "{near}"?)' if near else "")
                        + "; known fields here: " + ", ".join(known)})
            continue
        fewest: list[dict[str, str]] | None = None
        for b in branches:
            sub = b["properties"].get(k)
            if sub is None:
                continue
            found = unknown_fields(sub, v, at)
            if fewest is None or len(found) < len(fewest):
                fewest = found
            if not found:
                break
        if fewest:
            out.extend(fewest)
    return out


_RATE_KEY = re.compile(r"^(?:rate|rate_annual|.+_rate|.+_rate_annual)$")


def implausible_input_warnings(value: Any, path: str = "") -> list[str]:
    """Warnings for valid inputs that are almost certainly a unit slip (rate > 1, min_dscr > 10).

    Must match ``implausibleInputWarnings`` in packages/tools/src/limits.ts.
    """
    if isinstance(value, list):
        return [w for i, v in enumerate(value) for w in implausible_input_warnings(v, f"{path}.{i}" if path else str(i))]
    if not isinstance(value, dict):
        return []
    out: list[str] = []
    for k, v in value.items():
        at = f"{path}.{k}" if path else k
        if isinstance(v, (int, float)) and not isinstance(v, bool):
            if _RATE_KEY.match(k) and abs(v) > 1:
                out.append(f"{at} is {num_str(v)}: FactLot reads rates as decimals (0.03 = 3%). "
                           f"If you meant {num_str(v)}%, pass {num_str(v / 100)}.")
            elif k == "min_dscr" and v > 10:
                out.append(f"{at} is {num_str(v)}: DSCR is a ratio (1.25 = 1.25x coverage). "
                           f"If you meant {num_str(v / 100)}x, pass {num_str(v / 100)}.")
        else:
            out.extend(implausible_input_warnings(v, at))
    return out


_RATE_HINT = " (rates are decimals: pass 0.065 for 6.5%)"


def rate_hints(args: Any, issues: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Adds a hint to issues on rate fields whose value is above 1 (usually a whole-number percent).

    Must match ``withRateHints`` in packages/tools/src/limits.ts.
    """
    out = []
    for issue in issues:
        v: Any = args
        for part in str(issue.get("path", "")).split("."):
            if isinstance(v, list) and part.isdigit() and int(part) < len(v):
                v = v[int(part)]
            elif isinstance(v, dict):
                v = v.get(part)
            else:
                v = None
                break
        key = str(issue.get("path", "")).split(".")[-1]
        if _RATE_KEY.match(key) and isinstance(v, (int, float)) and not isinstance(v, bool) and abs(v) > 1:
            issue = {**issue, "message": issue["message"] + _RATE_HINT}
        out.append(issue)
    return out


@lru_cache(maxsize=None)
def _input_schemas() -> dict[str, dict[str, Any]]:
    return {t["name"]: t["input_schema"] for t in _load("tools.json")["tools"]}


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
    return docverify.validate_fact_full(docverify.js_json(args["fact"]))


# --- input schemas (for tools whose Python code reads nested input) ------------------------------

_JS_WS_CLASS = "\t\n\v\f\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff"


@lru_cache(maxsize=None)
def _js_pattern(pattern: str) -> re.Pattern[str]:
    """A JSON Schema (ECMAScript) pattern as Python reads it: \\d is 0-9, \\s is JavaScript's
    whitespace, and a final $ does not match before a trailing newline."""
    out, in_class, i = [], False, 0
    while i < len(pattern):
        c = pattern[i]
        if c == "\\" and i + 1 < len(pattern):
            nxt = pattern[i + 1]
            if nxt == "d":
                out.append("0-9" if in_class else "[0-9]")
            elif nxt == "s":
                out.append(_JS_WS_CLASS if in_class else f"[{_JS_WS_CLASS}]")
            else:
                out.append(c + nxt)
            i += 2
            continue
        if c == "[":
            in_class = True
        elif c == "]":
            in_class = False
        out.append(c)
        i += 1
    text = "".join(out)
    if text.endswith("$") and not text.endswith("\\$"):
        text = text[:-1] + r"\Z"
    return re.compile(text)


def input_schema_issues(schema: dict[str, Any], value: Any, path: str = "") -> list[dict[str, str]]:
    """Where ``value`` breaks a tool's generated input schema (the subset the catalog uses:
    types, required fields, lengths, item counts, bounds, patterns, enums). Unknown fields are
    reported earlier by ``unknown_fields``."""
    out: list[dict[str, str]] = []

    def bad(message: str) -> list[dict[str, str]]:
        return [{"path": path, "message": message}]

    t = schema.get("type")
    is_num = isinstance(value, (int, float)) and not isinstance(value, bool)
    if t == "object":
        if not isinstance(value, dict):
            return bad("expected object")
        for key in schema.get("required", []):
            if key not in value:
                out.append({"path": f"{path}.{key}" if path else key, "message": "required"})
        for key, sub in schema.get("properties", {}).items():
            if key in value:
                out.extend(input_schema_issues(sub, value[key], f"{path}.{key}" if path else key))
    elif t == "array":
        if not isinstance(value, list):
            return bad("expected array")
        if len(value) < schema.get("minItems", 0):
            return bad(f"expected at least {schema['minItems']} items")
        if "maxItems" in schema and len(value) > schema["maxItems"]:
            return bad(f"expected at most {schema['maxItems']} items")
        for i, item in enumerate(value):
            out.extend(input_schema_issues(schema.get("items", {}), item, f"{path}.{i}" if path else str(i)))
    elif t == "string":
        if not isinstance(value, str):
            return bad("expected string")
        if len(value) < schema.get("minLength", 0):
            return bad(f"expected at least {schema['minLength']} characters")
        if "maxLength" in schema and len(value) > schema["maxLength"]:
            return bad(f"expected at most {schema['maxLength']} characters")
        if "pattern" in schema and not _js_pattern(schema["pattern"]).search(value):
            return bad("invalid format")
    elif t in ("integer", "number"):
        if not is_num or (t == "integer" and not float(value).is_integer()):
            return bad(f"expected {'integer' if t == 'integer' else 'number'}")
        if "minimum" in schema and value < schema["minimum"]:
            return bad(f"expected at least {schema['minimum']}")
        if "maximum" in schema and value > schema["maximum"]:
            return bad(f"expected at most {schema['maximum']}")
        if "exclusiveMinimum" in schema and value <= schema["exclusiveMinimum"]:
            return bad(f"expected more than {schema['exclusiveMinimum']}")
    elif t == "boolean" and not isinstance(value, bool):
        return bad("expected boolean")
    if "enum" in schema and value not in schema["enum"]:
        return bad("expected one of " + ", ".join(map(str, schema["enum"])))
    return out


_PRODUCER = {"name": "factlot (python)", "version": __version__}
_DOC_TOOLS = {
    "doc_verify_facts": lambda a: docverify.verify_facts(a, _PRODUCER),
    "doc_abstract_lease": lambda a: docverify.abstract_lease(a, _PRODUCER),
    "doc_compare": docverify.compare,
    "doc_verify_claim": docverify.verify_claim,
}


class _MultiInputError(_InputError):
    def __init__(self, issues: list[dict[str, str]]) -> None:
        ValueError.__init__(self, "invalid input: " + "; ".join(f"{i['path'] or '(root)'}: {i['message']}" for i in issues))
        self.issues = issues


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
        raise _RegistryUnavailable(
            "this FactLot server has no registry loaded. Registry tools read a registry file: download one (sample: https://github.com/9mp96ygnbk-alt/fac"
            "tlot/releases/tag/registry-sample-dc-2026-11-03) and run FactLot yourself with FACTLOT_REGISTRY_DB pointing at it. The hosted API does not serve the registry yet.")
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
             or name in _OTHER_TOOLS or name in _DOC_TOOLS or name in _REGISTRY_TOOLS)
    if not known:
        return {"error": "UnknownTool", "message": f'no FactLot tool named "{name}"', "issues": []}
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
    # Unknown fields next (at most 20, as maxIssues in TypeScript): validation would ignore them, so a misspelled optional field would
    # change the answer with no sign.
    schema = _input_schemas().get(name)
    unknown = unknown_fields(schema, args)[:20] if schema is not None else []
    if unknown:
        return {"error": kind, "message": "invalid input: " + "; ".join(f"{u['path']}: {u['message']}" for u in unknown),
                "issues": unknown}
    try:
        if name.startswith("calc_") and name[5:] in CALCULATORS:
            fn, formula_id, version = CALCULATORS[name[5:]]
            out = fn(args)
            if isinstance(out.get("warnings"), list):
                out["warnings"].extend(implausible_input_warnings(args))
            return {
                **out,
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
        if name in _DOC_TOOLS:
            invalid = input_schema_issues(schema or {}, args)[:20]
            if invalid:
                raise _InputError(invalid[0]["path"], invalid[0]["message"]) if len(invalid) == 1 else \
                    _MultiInputError(invalid)
            return _DOC_TOOLS[name](docverify.js_json(args))
        if name in _REGISTRY_TOOLS:
            return _REGISTRY_TOOLS[name](args)
    except CalcInputError as e:
        issues = rate_hints(args, e.issues)
        message = str(e)
        if issues != e.issues:
            message = "invalid input: " + "; ".join(f"{i['path']}: {i['message']}" for i in issues)
        return {"error": "CalcInputError", "message": message, "issues": issues}
    except FactLotIdError as e:
        return {"error": "FactLotIdError", "message": str(e), "issues": []}
    except (_InputError, docverify.DocInputError) as e:
        return {"error": "InputError", "message": str(e), "issues": e.issues}
    except _RegistryUnavailable as e:
        return {"error": "RegistryUnavailable", "message": str(e), "issues": []}
    except _NotFound as e:
        return {"error": "NotFound", "message": str(e), "issues": []}
    return {"error": "UnknownTool", "message": f'no FactLot tool named "{name}"', "issues": []}
