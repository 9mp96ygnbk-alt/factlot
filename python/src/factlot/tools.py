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
from datetime import date
from functools import lru_cache
from importlib import resources
from typing import Any

from . import __version__
from ._core import CalcInputError, input_shape_issue, num_str
from .calc import CALCULATORS
from .rules import RULES
from . import comps, comps_search, docverify, factpackage, predicates, statements, uses
from .ids import FactLotIdError, building_id, document_id, entity_id, parcel_id, parse, short_id, space_id


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


def without_nulls(schema: dict[str, Any], value: Any) -> Any:
    """``value`` without the nulls the schema has no use for: a named field sent as null is left out.

    Some agent frameworks (crewai-tools' MCP adapter) send null for every optional field the model
    skips, and no FactLot input accepts null. Open objects (facts, fact packages) keep their nulls:
    they are data, and a package's signature covers them. Must match ``withoutNulls`` in
    packages/tools/src/limits.ts.
    """
    if isinstance(value, list):
        items = schema.get("items")
        if not isinstance(items, dict):
            return value
        return [without_nulls(items, v) for v in value]
    if not isinstance(value, dict):
        return value
    branches = _object_branches(schema)
    if not branches or any(b.get("additionalProperties", False) is not False for b in branches):
        return value
    out: dict[str, Any] = {}
    for k, v in value.items():
        sub = next((b["properties"][k] for b in branches if k in b["properties"]), None)
        if sub is None:
            out[k] = v
        elif v is not None:
            out[k] = without_nulls(sub, v)
    return out


# Rate fields are decimal fractions (0.065 for 6.5%); share and ratio fields likewise. A minimum DSCR is
# a coverage ratio (1.25 for 1.25x). Must match RATE_KEY, SHARE_KEY and DSCR_MAX in packages/tools/src/limits.ts.
_RATE_KEY = re.compile(r"^(?:rate|rate_annual|.+_rate|.+_rate_annual|until_irr)$")
_SHARE_KEY = re.compile(r"^(?:share|.+_share|ltv|.+_ltv|(?:.+_)?occupancy(?:_.+)?|(?:.+_)?debt_yield|.+_pct)$")
_DSCR_KEY = "min_dscr"
_DSCR_MAX = 10


def _unit_slip(key: str, v: Any) -> tuple[str | None, str | None]:
    """(rejection message, hint) for a whole-number percent in a numeric field, else (None, None).

    One policy for every surface: a rate above 1 in absolute value, or a min_dscr above 10, is a unit
    slip (8 for 8%, 130 for 1.3x) and the tool rejects it. Share and ratio fields are bounded by each
    tool's schema; the hint is added when that bound rejects them. Must match ``unitSlip`` in
    packages/tools/src/limits.ts.
    """
    if not isinstance(v, (int, float)) or isinstance(v, bool):
        return None, None
    if _RATE_KEY.match(key) and abs(v) > 1:
        hint = f"rates are decimals: pass {num_str(v / 100)} for {num_str(v)}%"
        return f"must be a decimal between -1 and 1 but is {num_str(v)} ({hint})", f" ({hint})"
    if key == _DSCR_KEY and v > _DSCR_MAX:
        return (f"must be at most {_DSCR_MAX} but is {num_str(v)} (DSCR is a ratio: pass {num_str(v / 100)} "
                f"for {num_str(v / 100)}x coverage)"), None
    if _SHARE_KEY.match(key) and v > 1:
        return None, f" (shares and ratios are decimals: pass {num_str(v / 100)} for {num_str(v)}%)"
    return None, None


def applies_unit_policy(tool_name: str) -> bool:
    """Tools the whole-number-percent rejection covers: every calculator and lease_comp_validate.

    Must match ``appliesUnitPolicy`` in packages/tools/src/limits.ts.
    """
    return tool_name.startswith("calc_") or tool_name == "lease_comp_validate"


def unit_slip_issues(value: Any, path: str = "") -> list[dict[str, str]]:
    """Every rate field above 1 (or min_dscr above 10) anywhere in the arguments, as input issues.

    Must match ``unitSlipIssues`` in packages/tools/src/limits.ts.
    """
    if isinstance(value, list):
        return [i for n, v in enumerate(value) for i in unit_slip_issues(v, f"{path}.{n}" if path else str(n))]
    if not isinstance(value, dict):
        return []
    out: list[dict[str, str]] = []
    for k, v in value.items():
        at = f"{path}.{k}" if path else k
        if isinstance(v, (int, float)) and not isinstance(v, bool):
            message = _unit_slip(k, v)[0]
            if message is not None:
                out.append({"path": at, "message": message})
        else:
            out.extend(unit_slip_issues(v, at))
    return out


def rate_hints(args: Any, issues: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Adds a hint to issues on rate, share and ratio fields whose value is above 1 (usually a
    whole-number percent).

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
        hint = _unit_slip(key, v)[1]
        if hint is not None:
            issue = {**issue, "message": issue["message"] + hint}
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
    """OpenAPI document: "3.1" lists every tool; "3.0" is the Custom GPT Actions subset (at most 30 operations).

    "3.0-bedrock" is the Amazon Bedrock Agents action-group document (no ``enum``, the 11 operations
    Bedrock allows per agent). For every tool in OpenAPI 3.0 (Microsoft plugins), fetch a server's
    ``/openapi-3.0.json?operations=all``, or ``?profile=bedrock&operations=all`` for Bedrock.
    """
    name = "openapi-3.1.json" if version.startswith("3.1") else (
        "openapi-3.0-bedrock.json" if version == "3.0-bedrock" else "openapi-3.0.json"
    )
    doc = copy.deepcopy(_load(name))
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
    "entity_urn": 500, "query": 500, "zip": 16, "street": 300,
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

    if "anyOf" in schema:
        # As zod's union: valid if one branch is; else the issues of the one branch that fails only
        # on lengths, counts, bounds or format, if there is exactly one; else one issue here.
        tried = [input_schema_issues(b, value, path) for b in schema["anyOf"]]
        if any(not x for x in tried):
            return []
        soft = [x for x in tried if all(i["message"].startswith(("expected at least", "expected at most",
                                                                     "expected more than", "invalid format"))
                                        for i in x)]
        return soft[0] if len(soft) == 1 else bad("Invalid input")

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
    "lease_comp_validate": lambda a: comps.validate_lease_comp(a, _PRODUCER),
    "lease_comp_search": lambda a: comps_search.search(a, _PRODUCER),
    "doc_spread_statement": lambda a: statements.spread_statement(a),
    "doc_check_use_conflict": lambda a: uses.check_use_conflict(a),
    "doc_predicates": lambda a: predicates.doc_predicates(a),
    "fact_package_create": lambda a: factpackage.create_fact_package(a),
    "fact_package_verify": lambda a: factpackage.verify_fact_package(a),
}


class _MultiInputError(_InputError):
    def __init__(self, issues: list[dict[str, str]]) -> None:
        ValueError.__init__(self, "invalid input: " + "; ".join(f"{i['path'] or '(root)'}: {i['message']}" for i in issues))
        self.issues = issues


class _RegistryUnavailable(RuntimeError):
    pass


class _NotFound(LookupError):
    def __init__(self, message: str, coverage: dict[str, Any] | None = None) -> None:
        super().__init__(message)
        self.coverage = coverage


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
            "tlot/releases/tag/registry-sample-dc-2026-11-07) and run FactLot yourself with FACTLOT_REGISTRY_DB pointing at it. The hosted API at https://api.factlot.com serves the regions listed by registry_coverage.")
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


def _record_miss(reg: Any, urn: str) -> dict[str, Any]:
    """The ``coverage`` object of a ``registry_get`` miss for a well-formed URN."""
    from .registry import coverage

    kind, parts = parse(urn)
    cov = reg.coverage()
    if kind == "parcel":
        return coverage.parcel_miss(cov, parts[0][3:5], parts[0][5:8])
    if kind == "entity":
        return coverage.entity_miss(cov, parts[0], False)
    if kind == "building" and len(parts) == 3:
        return coverage.building_miss(cov, parts[0][3:5], parts[0][5:8])
    return coverage.other_kind_miss(kind)


def _as_of(args: dict[str, Any]) -> str | None:
    """Optional ``as_of`` date: YYYY-MM-DD, a real calendar date (as ``IsoDate`` in @factlot/calc)."""
    if "as_of" not in args:
        return None
    v = args.get("as_of")
    m = re.fullmatch(r"([0-9]{4})-([0-9]{2})-([0-9]{2})", v) if isinstance(v, str) else None
    try:
        if not m:
            raise ValueError
        date(int(m[1]), int(m[2]), int(m[3]))
    except ValueError:
        raise _InputError("as_of", "expected a valid YYYY-MM-DD date") from None
    return v


def _registry_get(args: dict[str, Any]) -> dict[str, Any]:
    urn = _str(args, "urn")
    hist = args.get("include_history", False)
    if not isinstance(hist, bool):
        raise _InputError("include_history", "expected boolean")
    as_of = _as_of(args)
    reg = _registry()
    parse(urn)  # a malformed URN is a format error, not a miss
    record = reg.get(urn, as_of)
    if record is None:
        cov = _record_miss(reg, urn)
        raise _NotFound(f"no registry record for {urn}: {cov['message']}", cov)
    if hist is not True:
        return record
    from .registry.store import capped_recorded_facts

    return {**record, "history": capped_recorded_facts(reg.facts(urn, history=True, as_of=as_of))[0]}


def _nonempty(args: dict[str, Any], key: str) -> str:
    v = _str(args, key)
    if not v:
        raise _InputError(key, "must not be empty")
    return v


def _address_search_input(args: dict[str, Any]) -> tuple[str, int, dict[str, str]]:
    """registry_search_address's query (or address), limit and place parameters, validated as the TypeScript
    schema does: field types and lengths first, then exactly one of query or address, then the place parameters."""
    from .registry.normalize import address_where_issues, address_where_of

    issues: list[dict[str, str]] = []
    for key, lo, hi in (("query", 1, 500), ("address", 1, 500), ("state", 2, 40), ("city", 1, 100),
                        ("postal_code", 5, 10), ("county_fips", 3, 5)):
        if key not in args:
            continue
        v = args[key]
        if not isinstance(v, str):
            issues.append({"path": key, "message": "expected string"})
        elif len(v) < lo:
            issues.append({"path": key, "message": f"expected at least {lo} character{'s' if lo > 1 else ''}"})
        elif len(v) > hi:
            issues.append({"path": key, "message": f"expected at most {hi} characters"})
    limit = _limit(args)
    if issues:
        raise _MultiInputError(issues)
    if ("query" in args) == ("address" in args):
        issues.append({"path": "", "message": "provide exactly one of query or address"})
    where = address_where_of(args)
    issues += address_where_issues(where)
    if issues:
        raise _MultiInputError(issues)
    return args["query"] if "query" in args else args["address"], limit, where


def _search(kind: str):
    def run(args: dict[str, Any]) -> dict[str, Any]:
        from .registry import coverage

        if kind == "entities":
            query, limit = _nonempty(args, "query"), _limit(args)  # validate before touching the registry
            reg = _registry()
            results = reg.search_entities(query, limit)
            return {"results": results} if results else {"results": results,
                                                          "coverage": coverage.entities_miss(reg.coverage())}
        query, limit, where = _address_search_input(args)
        reg = _registry()
        results, hint = reg.search_address_hint(query, limit, where)
        if results:
            return {"results": results}
        return {"results": results, "coverage": coverage.address_miss(reg.coverage(), query, where, hint)}

    return run


def _resolve_parcel(args: dict[str, Any]) -> dict[str, Any]:
    from .registry import coverage

    sf, cf, apn = _str(args, "state_fips"), _str(args, "county_fips"), _str(args, "apn")
    reg = _registry()
    urn = reg.resolve_parcel(sf, cf, apn)
    return {"urn": urn} if urn else {"urn": None, "coverage": coverage.parcel_miss(reg.coverage(), sf, cf)}


def _resolve_external(args: dict[str, Any]) -> dict[str, Any]:
    from .registry import coverage

    system, ext = _str(args, "system"), _str(args, "external_id")
    reg = _registry()
    urn = reg.resolve_external(system, ext)
    return {"urn": urn} if urn else {"urn": None, "coverage": coverage.external_miss(reg.coverage(), system, ext)}


def _owned_by(args: dict[str, Any]) -> dict[str, Any]:
    from .registry import buildings, coverage

    urn = _str(args, "entity_urn")
    reg = _registry()
    kind, parts = parse(urn)
    if kind != "entity":
        raise FactLotIdError(f'"{urn}" is a {kind} URN; registry_owned_by needs an entity URN')
    results = reg.parcels_owned_by(urn)
    out: dict[str, Any] = {"results": results, "buildings": buildings.owned_buildings(reg.db, results)}
    if not results:
        known = reg.db.execute("SELECT 1 FROM subjects WHERE urn = ?", (urn,)).fetchone() is not None
        out["coverage"] = coverage.entity_miss(reg.coverage(), parts[0], known)
    return out


def _registry_coverage(args: dict[str, Any]) -> dict[str, Any]:
    from .registry import coverage

    reg = _registry()
    return coverage.tool_result(reg.db, reg.coverage(), fields=args.get("fields") is True)


def _bounded(args: dict[str, Any], key: str, default: Any, lo: float, hi: float, *, integer: bool,
             above: bool = False) -> Any:
    """An optional number in [lo, hi] (``(lo, hi]`` with ``above``), bounded as the TypeScript schema bounds it."""
    if key not in args:
        return default
    v = args[key]
    if isinstance(v, bool) or not isinstance(v, (int, float)) or v != v or abs(v) == float("inf"):
        raise _InputError(key, "expected number")
    if integer and not float(v).is_integer():
        raise _InputError(key, "expected integer")
    if (v <= lo if above else v < lo) or v > hi:
        raise _InputError(key, f"expected {'above' if above else 'at least'} {num_str(lo)} and at most {num_str(hi)}")
    return int(v) if integer else v


def _flag(args: dict[str, Any], key: str) -> bool:
    """An optional boolean, false when absent."""
    if key not in args:
        return False
    if not isinstance(args[key], bool):
        raise _InputError(key, "expected boolean")
    return args[key]


def _use_codes(args: dict[str, Any], most: int) -> list[str] | None:
    """``local_use_codes``: 1 to ``most`` codes of 1 to 64 characters, or None when absent."""
    if "local_use_codes" not in args:
        return None
    v = args["local_use_codes"]
    if not isinstance(v, list):
        raise _InputError("local_use_codes", "expected array")
    if not 1 <= len(v) <= most:
        raise _InputError("local_use_codes", f"expected at least 1 and at most {most} items")
    for i, c in enumerate(v):
        if not isinstance(c, str):
            raise _InputError(f"local_use_codes.{i}", "expected string")
        if not 1 <= len(c) <= 64:
            raise _InputError(f"local_use_codes.{i}", "expected at least 1 and at most 64 characters")
    return list(v)


def _tx_equity_candidates(args: dict[str, Any]) -> dict[str, Any]:
    from .registry import tx_equity

    by_apn = {k for k in ("state_fips", "county_fips", "apn") if k in args}
    if ("urn" in args) == bool(by_apn) or (by_apn and not {"county_fips", "apn"} <= by_apn):
        raise _InputError("", tx_equity.WHICH_PARCEL)
    params = {
        "area_band": _bounded(args, "area_band", tx_equity.DEFAULTS["area_band"], 0, 1, integer=False, above=True),
        "year_band": _bounded(args, "year_band", tx_equity.DEFAULTS["year_band"], 0, 100, integer=True),
        "min_matches": _bounded(args, "min_matches", tx_equity.DEFAULTS["min_matches"], 1, 200, integer=True),
        "limit": _bounded(args, "limit", tx_equity.DEFAULTS["limit"], 1, 200, integer=True),
        "tax_year": _bounded(args, "tax_year", None, 1900, 2100, integer=True),
        "same_building_class": _flag(args, "same_building_class"),
        "same_local_use_code": _flag(args, "same_local_use_code"),
        "local_use_codes": _use_codes(args, tx_equity.USE_CODES_MAX),
    }
    if "urn" in args:
        urn = _str(args, "urn")
        kind, parts = parse(urn)
        if kind != "parcel":
            raise FactLotIdError(f'"{urn}" is a {kind} URN; registry_tx_equity_candidates needs a parcel URN')
        state, county, field, county_field = parts[0][3:5], parts[0][5:8], "urn", "urn"
    else:
        state = _str(args, "state_fips") if "state_fips" in args else tx_equity.TEXAS_FIPS
        county, apn, field, county_field = _str(args, "county_fips"), _str(args, "apn"), "state_fips", "county_fips"
    if state != tx_equity.TEXAS_FIPS:
        raise _InputError(field, tx_equity.texas_only(state))
    if county in tx_equity.WITHHELD_COUNTIES:
        raise _InputError(county_field, tx_equity.WITHHELD_COUNTIES[county])
    reg = _registry()
    if "urn" not in args:
        urn = reg.parcel_urn(state, county, apn)
    if reg.db.execute("SELECT 1 FROM subjects WHERE urn = ?", (urn,)).fetchone() is None:
        cov = _record_miss(reg, urn)
        raise _NotFound(f"no registry record for {urn}: {cov['message']}", cov)
    return tx_equity.equity_candidates(reg, urn, **params)


def _subject_error(err: Exception) -> dict[str, Any]:
    """A batch subject's error, as ``run_tool`` returns it for the single tool (``errorOutcome`` in TS)."""
    if isinstance(err, FactLotIdError):
        return {"error": "FactLotIdError", "message": str(err), "issues": []}
    if isinstance(err, _InputError):
        issues = err.issues
        return {"error": "InputError",
                "message": "invalid input: " + "; ".join(f"{i['path'] or '(root)'}: {i['message']}" for i in issues),
                "issues": issues}
    if isinstance(err, _NotFound):
        out = {"error": "NotFound", "message": str(err), "issues": []}
        if err.coverage is not None:
            out["coverage"] = err.coverage
        return out
    raise err


def _tx_equity_candidates_batch(args: dict[str, Any]) -> dict[str, Any]:
    from .registry import tx_equity

    invalid = input_schema_issues(_input_schemas()["registry_tx_equity_candidates_batch"], args)[:20]
    if not invalid:
        seen: set[str] = set()
        for i, s in enumerate(args["subjects"]):
            if s["id"] in seen:
                invalid.append({"path": f"subjects.{i}.id", "message": f'duplicate id "{s["id"]}"'})
            seen.add(s["id"])
    if invalid:
        raise _MultiInputError(invalid[:20])
    shared = {k: args[k] for k in tx_equity.BATCH_PARAMS if k in args}
    results = []
    for s in args["subjects"]:
        subject = {k: v for k, v in s.items() if k != "id"}
        try:
            answer = _tx_equity_candidates({**subject, **shared})
        except (FactLotIdError, _InputError, _NotFound) as e:
            # No registry is no answer for any subject: _RegistryUnavailable fails the call, as for the single tool.
            results.append({"id": s["id"], "error": _subject_error(e)})
            continue
        results.append({"id": s["id"], **tx_equity.batch_answer(answer)})
    errors = sum(1 for r in results if "error" in r)
    return {
        "results": results,
        "summary": {"subjects": len(results), "answered": len(results) - errors, "errors": errors},
        "rule": tx_equity.RULE,
        "notice": tx_equity.NOTICE,
    }


def _recorded_facts(args: dict[str, Any]) -> dict[str, Any]:
    from .registry.store import (RECORDED_CURSOR_HELP, RECORDED_PAGE_DEFAULT, RECORDED_PAGE_MAX, RECORDED_PREDICATES,
                                 parse_recorded_cursor, recorded_page)

    urn = _str(args, "urn")
    predicate = args.get("predicate")
    if predicate is not None and predicate not in RECORDED_PREDICATES:
        raise _InputError("predicate", "expected one of " + ", ".join(RECORDED_PREDICATES))
    cursor = args.get("cursor")
    if cursor is not None and not isinstance(cursor, str):
        raise _InputError("cursor", "expected string")
    limit = args.get("limit", RECORDED_PAGE_DEFAULT)
    if isinstance(limit, bool) or not isinstance(limit, int) or not 1 <= limit <= RECORDED_PAGE_MAX:
        raise _InputError("limit", f"expected integer 1–{RECORDED_PAGE_MAX}")
    reg = _registry()
    parse(urn)
    if reg.db.execute("SELECT 1 FROM subjects WHERE urn = ?", (urn,)).fetchone() is None:
        cov = _record_miss(reg, urn)
        raise _NotFound(f"no registry record for {urn}: {cov['message']}", cov)
    lists = reg.recorded_lists(urn)
    totals = {p: len(v) for p, v in lists.items()}
    offsets = parse_recorded_cursor(cursor, totals)
    if offsets is None:
        raise _InputError("cursor", RECORDED_CURSOR_HELP)
    slices = {p: lists.get(p, [])[o:o + limit] for p, o in zip(RECORDED_PREDICATES, offsets)}
    return recorded_page(urn, predicate, totals, offsets, slices, limit)


# registry_lookup_batch (lookup_batch.ts in @factlot/tools): each item is answered by the single registry tools,
# registry_get for a URN, registry_resolve_parcel for an account, registry_search_address for an address, then
# registry_get on the URN found, and read into a compact row.
LOOKUP_BATCH_SEARCH_LIMIT = 20
LOOKUP_BATCH_CANDIDATES = 5
LOOKUP_BATCH_NOTICE = (
    "Each row is the parcel's current facts as its sources publish them, each cited: not an appraisal, a valuation "
    "opinion or advice. Owners of record are organisations as the source names them; natural persons are not stored. "
    "Relay each source's rights (ai_use, redistribution) with its facts.")
LOOKUP_WHICH_PARCEL = ("give exactly one of urn, apn (with state_fips and county_fips, or a 5-digit county_fips) "
                       "or address")
_LOOKUP_MODES = {"urn": [], "apn": ["state_fips", "county_fips"],
                 "address": ["state", "city", "postal_code", "county_fips"]}
_LOOKUP_BY = {"urn": "urn", "apn": "account", "address": "address"}
_LOOKUP_FIELDS = ["urn", "apn", "address", "state_fips", "county_fips", "state", "city", "postal_code"]
_LOOKUP_ROW_FACTS = [("account", "parcel.apn"), ("property_category", "parcel.state_property_category"),
                     ("use_code", "parcel.local_use_code"), ("improvement_area_sf", "parcel.improvement_area_sf"),
                     ("year_built", "parcel.year_built"), ("owner_of_record", "ownership.owner_of_record")]


def _lookup_input_error(issues: list[dict[str, str]]) -> dict[str, Any]:
    return {"error": "InputError",
            "message": "invalid input: " + "; ".join(f"{i['path'] or '(root)'}: {i['message']}" for i in issues),
            "issues": issues}


def _is_error(outcome: Any) -> bool:
    return isinstance(outcome, dict) and isinstance(outcome.get("error"), str) and "issues" in outcome


def lookup_exact(query: str, label: Any) -> bool:
    """Whether a search result has the item's address exactly (``lookupExact`` in TS)."""
    from .registry.normalize import address_query_with_place, address_unit, normalize_address

    if not isinstance(label, str):
        return False
    line = lambda a: normalize_address(a.split(",")[0])  # noqa: E731
    return line(address_query_with_place(query)) == line(label) and address_unit(query) == address_unit(label)


def _lookup_text(v: Any) -> str | None:
    if isinstance(v, str) and v != "":
        return v
    if isinstance(v, (int, float)) and not isinstance(v, bool) and v == v and abs(v) != float("inf"):
        return num_str(v)
    return None


def _lookup_finite(v: Any) -> Any:
    ok = isinstance(v, (int, float)) and not isinstance(v, bool) and v == v and abs(v) != float("inf")
    return v if ok else None


def lookup_row(record: dict[str, Any]) -> dict[str, Any]:
    """The compact row of a parcel from registry_get's answer (``lookupRow`` in TS)."""
    facts = record.get("facts") if isinstance(record.get("facts"), list) else []

    def first(p: str) -> dict[str, Any] | None:
        return next((f for f in facts if f.get("predicate") == p), None)

    def src(f: dict[str, Any]) -> dict[str, Any]:
        return ((f.get("provenance") or {}).get("sources") or [{}])[0]

    citations: dict[str, Any] = {}
    docs: list[Any] = []
    for field, p in _LOOKUP_ROW_FACTS:
        f = first(p)
        if f is None:
            continue
        s = src(f)
        c = {"fact_id": f.get("id"), "document_id": s.get("document_id"), "locator": s.get("section"),
             "as_of": f.get("as_of")}
        citations[field] = c
        if c["document_id"] is not None and c["document_id"] not in docs:
            docs.append(c["document_id"])
    history = record.get("value_history") if isinstance(record.get("value_history"), list) else []
    value = history[0] if history else None
    for c in ((value or {}).get("citations") or {}).values():
        if c and c.get("document_id") is not None and c["document_id"] not in docs:
            docs.append(c["document_id"])

    def source(doc: Any) -> dict[str, Any]:
        f = next((x for x in facts if src(x).get("document_id") == doc), None)
        if f is None:
            return {"document_id": doc}
        s, rights = src(f), f.get("rights") or {}
        out = {"document_id": doc, "title": s.get("title"), "uri": s.get("uri"), "retrieved_at": s.get("retrieved_at"),
               "as_of": f.get("as_of"), "license": rights.get("license"), "ai_use": rights.get("ai_use"),
               "redistribution": rights.get("redistribution")}
        if "attribution" in rights:
            out["attribution"] = rights["attribution"]
        return out

    owner = first("ownership.owner_of_record")
    rels = record.get("relationships") if isinstance(record.get("relationships"), list) else []
    link = next((r for r in rels if r.get("type") == "owns" and r.get("to_urn") == record.get("urn")), None)

    def fact_value(p: str) -> Any:
        f = first(p)
        return None if f is None else f.get("value")

    return {
        "urn": record.get("urn"),
        "label": record.get("label"),
        "record_status": record.get("status"),
        "account": _lookup_text(fact_value("parcel.apn")),
        "property_category": _lookup_text(fact_value("parcel.state_property_category")),
        "use_code": _lookup_text(fact_value("parcel.local_use_code")),
        "improvement_area_sf": _lookup_finite(fact_value("parcel.improvement_area_sf")),
        "year_built": _lookup_finite(fact_value("parcel.year_built")),
        "value": value,
        "owner_of_record": None if owner is None else {
            "name": owner.get("value"),
            "entity_urn": link["from_urn"] if link and isinstance(link.get("from_urn"), str) else None,
        },
        "citations": citations,
        "sources": [source(d) for d in docs],
        "warnings": record.get("warnings") if isinstance(record.get("warnings"), list) else [],
    }


class _LookupUnavailable(Exception):
    def __init__(self, outcome: dict[str, Any]) -> None:
        super().__init__(outcome["message"])
        self.outcome = outcome


def _lookup_call(tool: str, args: dict[str, Any]) -> dict[str, Any]:
    out = run_tool(tool, args)
    if _is_error(out) and out["error"] == "RegistryUnavailable":
        raise _LookupUnavailable(out)
    return out


def _lookup_item(item: dict[str, Any], index: int) -> dict[str, Any]:
    """One item of registry_lookup_batch (``lookupItem`` in TS)."""
    head: dict[str, Any] = {"index": index}
    if "ref" in item:
        head["ref"] = item["ref"]
    modes = [m for m in _LOOKUP_MODES if m in item]
    if len(modes) != 1:
        return {**head, "status": "error", "error": _lookup_input_error([{"path": "", "message": LOOKUP_WHICH_PARCEL}])}
    mode = modes[0]
    head["by"] = _LOOKUP_BY[mode]
    allowed = {mode, *_LOOKUP_MODES[mode]}
    stray = [k for k in _LOOKUP_FIELDS if k in item and k not in allowed]
    if stray:
        takes = ", ".join(_LOOKUP_MODES[mode]) if _LOOKUP_MODES[mode] else "nothing else"
        return {**head, "status": "error", "error": _lookup_input_error(
            [{"path": k, "message": f"not used with {mode}; {mode} takes {takes}"} for k in stray])}

    def fail(error: dict[str, Any]) -> dict[str, Any]:
        return {**head, "status": "error", "error": error}

    def miss(coverage: Any, error: dict[str, Any] | None = None) -> dict[str, Any]:
        message = (coverage or {}).get("message") if isinstance(coverage, dict) else None
        out = {**head, "status": "not_found",
               "message": str(message if message is not None else (error or {}).get("message", "")),
               "coverage": coverage}
        if error is not None:
            out["error"] = error
        return out

    match = None
    if mode == "urn":
        urn = item["urn"]
        try:
            kind, _ = parse(urn)
            if kind != "parcel":
                raise FactLotIdError(f'"{urn}" is a {kind} URN; registry_lookup_batch needs a parcel URN')
        except FactLotIdError as e:
            return fail({"error": "FactLotIdError", "message": str(e), "issues": []})
    elif mode == "apn":
        county = item.get("county_fips")
        if county is None:
            return fail(_lookup_input_error([{"path": "county_fips", "message": (
                "required with apn: a 3-digit county_fips with state_fips, or a 5-digit county_fips")}]))
        if "state_fips" in item:
            args = {"state_fips": item["state_fips"], "county_fips": county, "apn": item["apn"]}
        elif isinstance(county, str) and re.fullmatch(r"[0-9]{5}", county):
            args = {"state_fips": county[:2], "county_fips": county[2:], "apn": item["apn"]}
        else:
            return fail(_lookup_input_error([{"path": "state_fips", "message": (
                "required with a 3-digit county_fips; or give a 5-digit county_fips alone")}]))
        out = _lookup_call("registry_resolve_parcel", args)
        if _is_error(out):
            return fail(out)
        if not isinstance(out.get("urn"), str):
            return miss(out.get("coverage"))
        urn = out["urn"]
    else:
        args = {"address": item["address"], **{k: item[k] for k in _LOOKUP_MODES["address"] if k in item},
                "limit": LOOKUP_BATCH_SEARCH_LIMIT}
        out = _lookup_call("registry_search_address", args)
        if _is_error(out):
            return fail(out)
        results = out.get("results") if isinstance(out.get("results"), list) else []
        if not results:
            return miss(out.get("coverage"))
        query = item["address"]
        exact = [r for r in results if lookup_exact(query, r.get("label"))]
        if len(results) > 1 and len(exact) != 1:
            rest = [r for r in results if not any(r is e for e in exact)]
            more = " or more" if len(results) >= LOOKUP_BATCH_SEARCH_LIMIT else ""
            message = (
                f"{len(exact)} parcels have this address exactly (separate accounts at one address); send the urn, "
                "or the apn with its county, of the one you mean" if len(exact) > 1 else
                f"{len(results)}{more} parcels match this address and none has it exactly; send the urn, or the apn "
                "with its county, of the one you mean, or a fuller address")
            return {**head, "status": "ambiguous", "matches": len(results),
                    "candidates": (exact + rest)[:LOOKUP_BATCH_CANDIDATES], "message": message}
        chosen = exact[0] if exact else results[0]
        urn = str(chosen["urn"])
        match = {"exact": len(exact) == 1, "matches": len(results)}

    got = _lookup_call("registry_get", {"urn": urn})
    if _is_error(got):
        if got["error"] == "NotFound":
            return miss(got.get("coverage"), {"error": "NotFound", "message": got["message"], "issues": got["issues"]})
        return fail(got)
    out = {**head, "status": "found", "parcel": lookup_row(got)}
    if match is not None:
        out["match"] = match
    return out


def _lookup_batch(args: dict[str, Any]) -> dict[str, Any]:
    invalid = input_schema_issues(_input_schemas()["registry_lookup_batch"], args)[:20]
    if invalid:
        raise _MultiInputError(invalid)
    try:
        entries = [_lookup_item(item, k) for k, item in enumerate(args["items"])]
    except _LookupUnavailable as e:
        # No registry is no answer for any item: the whole call fails, as the single tools do.
        raise _RegistryUnavailable(e.outcome["message"]) from None
    count = lambda s: sum(1 for e in entries if e["status"] == s)  # noqa: E731
    return {
        "results": entries,
        "summary": {"items": len(entries), "found": count("found"), "not_found": count("not_found"),
                    "ambiguous": count("ambiguous"), "errors": count("error")},
        "notice": LOOKUP_BATCH_NOTICE,
    }


_REGISTRY_TOOLS = {
    "registry_get": _registry_get,
    "registry_resolve_parcel": _resolve_parcel,
    "registry_resolve_external": _resolve_external,
    "registry_search_address": _search("address"),
    "registry_search_entities": _search("entities"),
    "registry_owned_by": _owned_by,
    "registry_recorded_facts": _recorded_facts,
    "registry_coverage": _registry_coverage,
    "registry_tx_equity_candidates": _tx_equity_candidates,
    "registry_tx_equity_candidates_batch": _tx_equity_candidates_batch,
    "registry_lookup_batch": _lookup_batch,
}

_OTHER_TOOLS = {
    "id_parcel": lambda a: parcel_id(_str(a, "state_fips"), _str(a, "county_fips"), _str(a, "apn")).as_dict(),
    "id_entity": lambda a: entity_id(_str(a, "jurisdiction"), _str(a, "registry_number")).as_dict(),
    "id_space": lambda a: space_id(_str(a, "building_urn"), _str(a, "suite")).as_dict(),
    "id_building": lambda a: building_id(_str(a, "state_fips"), _str(a, "county_fips"), _str(a, "zip"),
                                         _str(a, "street")).as_dict(),
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
    schema = _input_schemas().get(name)
    # A null for a named field is the field left out (agent frameworks send null for skipped optionals);
    # every later check, and the tool itself, sees the input without it.
    if schema is not None:
        args = without_nulls(schema, args)
    # Unknown fields next (at most 20, as maxIssues in TypeScript): validation would ignore them, so a misspelled optional field would
    # change the answer with no sign.
    unknown = unknown_fields(schema, args)[:20] if schema is not None else []
    if unknown:
        return {"error": kind, "message": "invalid input: " + "; ".join(f"{u['path']}: {u['message']}" for u in unknown),
                "issues": unknown}
    # Whole-number percents next (rate above 1, min_dscr above 10): one policy for every calculator and
    # lease_comp_validate, ahead of each tool's own bounds.
    if applies_unit_policy(name):
        slips = unit_slip_issues(args)[:20]
        if slips:
            return {"error": kind, "message": "invalid input: " + "; ".join(f"{i['path']}: {i['message']}" for i in slips),
                    "issues": slips}
    try:
        if name.startswith("calc_") and name[5:] in CALCULATORS:
            fn, formula_id, version = CALCULATORS[name[5:]]
            out = fn(args)
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
        out = {"error": "NotFound", "message": str(e), "issues": []}
        if e.coverage is not None:
            out["coverage"] = e.coverage
        return out
    return {"error": "UnknownTool", "message": f'no FactLot tool named "{name}"', "issues": []}
