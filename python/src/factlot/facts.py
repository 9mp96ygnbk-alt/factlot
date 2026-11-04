"""Validate FactLot facts: the same rules, issue paths and messages as the ``Fact`` schema in
@factlot/schema (packages/schema/src/index.ts, published as spec/schemas/fact.json).

The TypeScript schema is zod, so this mirrors how zod reports: fields in schema order, then the
object's unknown fields, then the object's own rules (a source is required, valid_from is not
after valid_to, ...). Like zod, an object's rules are skipped when a value inside it has the wrong
type, since they could not be read; a wrong format or range does not skip them.
"""

from __future__ import annotations

import json
import re
from typing import Any, Callable

METHODS = ("public_record", "extracted", "human_verified", "computed", "reported", "inferred")
AI_USE = ("permitted", "prohibited", "unknown")
REDISTRIBUTION = ("permitted", "attribution_required", "prohibited", "unknown")
# Matched with fullmatch (re's `$` also matches before a trailing newline, which @factlot/schema
# rejects), with \s spelled as ECMAScript whitespace and \d as ASCII digits, as in JavaScript.
_JS_WS = "\t\n\v\f\r    -     　﻿"
_JS_WS_CHARS = "".join(chr(c) for c in range(0x2000, 0x200B)) + "\t\n\v\f\r       　﻿"
_SUBJECT = re.compile(rf"fl:[a-z]+:[^{_JS_WS}:]+(?::[^{_JS_WS}]+)?")
_PREDICATE = re.compile(r"[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+")
_SHA256 = re.compile(r"[a-f0-9]{64}")
# zod's z.iso.date() and z.iso.datetime({ offset: true }) patterns, as published in fact.json.
_DATE_BODY = (r"(?:(?:[0-9][0-9][2468][048]|[0-9][0-9][13579][26]|[0-9][0-9]0[48]|[02468][048]00|[13579][26]00)-02-29"
              r"|[0-9]{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12][0-9]|3[01])|(?:0[469]|11)-(?:0[1-9]|[12][0-9]|30)"
              r"|(?:02)-(?:0[1-9]|1[0-9]|2[0-8])))")
_ISO_DATE = re.compile(_DATE_BODY)
_ISO_DATETIME = re.compile(_DATE_BODY + r"T(?:(?:[01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](?:\.[0-9]+)?"
                           r"(?:Z|([+-](?:[01][0-9]|2[0-3]):[0-5][0-9])))")
_MAX_SAFE = 2**53 - 1

Check = Callable[[Any, str, "_Issues"], None]


def is_iso_date(v: Any) -> bool:
    """A date @factlot/schema accepts (zod's ISO date pattern, so year 0000 counts)."""
    return isinstance(v, str) and _ISO_DATE.fullmatch(v) is not None


class _Missing:
    """A required field that is absent (JavaScript's undefined)."""


_MISSING = _Missing()


def _js_type(v: Any) -> str:
    """The type name zod reports for a JSON value."""
    if v is _MISSING:
        return "undefined"
    if v is None:
        return "null"
    if isinstance(v, bool):
        return "boolean"
    if isinstance(v, (int, float)):
        return "number"
    if isinstance(v, str):
        return "string"
    if isinstance(v, list):
        return "array"
    return "object"


def js_key_order(keys: list[str]) -> list[str]:
    """JavaScript's own-key order: array-index keys ascending, then the rest in insertion order."""
    index = [k for k in keys if re.fullmatch(r"0|[1-9][0-9]*", k) and int(k) < 2**32 - 1]
    return sorted(index, key=int) + [k for k in keys if k not in index]


def _is_url(v: str) -> bool:
    """What zod's z.string().url() accepts (WHATWG URL parsing), for the URLs facts carry."""
    t = re.sub(r"[\t\n\r]", "", v.strip(_JS_WS_CHARS))
    m = re.match(r"[A-Za-z][A-Za-z0-9+.\-]*:", t)
    if not m:
        return False
    scheme, rest = m[0][:-1].lower(), t[len(m[0]):]
    if scheme not in ("http", "https", "ws", "wss", "ftp"):
        return True
    authority = re.split(r"[/?#\\]", rest.lstrip("/\\"), maxsplit=1)[0]
    host = authority.rsplit("@", 1)[-1]
    if host.startswith("["):
        hostname, _, port = host[1:].partition("]")
        port = port[1:] if port.startswith(":") else port
    else:
        hostname, _, port = host.partition(":")
    if not hostname or re.search(r"[\s#%/:<>?@\[\\\]^|]", hostname):
        return False
    return port == "" or (port.isascii() and port.isdigit() and int(port) <= 65535)


class _Issues:
    """Issues in zod's order, each marked whether it stops the enclosing objects' rules."""

    def __init__(self) -> None:
        self.items: list[tuple[str, str, bool]] = []

    def add(self, path: str, message: str, abort: bool = False) -> None:
        self.items.append((path, message, abort))

    def aborted_since(self, start: int) -> bool:
        return any(abort for _, _, abort in self.items[start:])


def _at(path: str, key: str | int) -> str:
    return f"{path}.{key}" if path else str(key)


def _bad_type(out: _Issues, path: str, expected: str, v: Any) -> None:
    out.add(path, f"Invalid input: expected {expected}, received {_js_type(v)}", True)


def _object(v: Any, path: str, out: _Issues, fields: list[tuple[str, Check, bool]],
            rules: tuple[Callable[[dict[str, Any], str, _Issues], None], ...] = ()) -> None:
    """A strict object: each (key, check, required) in order, then unknown keys, then rules."""
    if not isinstance(v, dict):
        _bad_type(out, path, "object", v)
        return
    start = len(out.items)
    for key, check, required in fields:
        if key in v:
            check(v[key], _at(path, key), out)
        elif required:
            check(_MISSING, _at(path, key), out)
    known = {f[0] for f in fields}
    extra = js_key_order([k for k in v if k not in known])
    if extra:
        names = ", ".join(json.dumps(k, ensure_ascii=False) for k in extra)
        out.add(path, f"Unrecognized key{'s' if len(extra) > 1 else ''}: {names}")
    if not out.aborted_since(start):
        for rule in rules:
            rule(v, path, out)


def _string(v: Any, path: str, out: _Issues) -> None:
    if not isinstance(v, str):
        _bad_type(out, path, "string", v)


def _pattern(pattern: re.Pattern[str], message: str) -> Check:
    def check(v: Any, path: str, out: _Issues) -> None:
        if not isinstance(v, str):
            _bad_type(out, path, "string", v)
        elif not pattern.fullmatch(v):
            out.add(path, message)
    return check


def _enum(options: tuple[str, ...]) -> Check:
    def check(v: Any, path: str, out: _Issues) -> None:
        if not isinstance(v, str) or v not in options:
            out.add(path, "Invalid option: expected one of " + "|".join(f'"{o}"' for o in options), True)
    return check


def _is_number(v: Any) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def _integer(minimum: int, *, exclusive: bool) -> Check:
    def check(v: Any, path: str, out: _Issues) -> None:
        if not _is_number(v):
            _bad_type(out, path, "number", v)
            return
        if not float(v).is_integer():
            out.add(path, "Invalid input: expected int, received number", True)
            return
        if (v <= minimum) if exclusive else (v < minimum):
            out.add(path, f"Too small: expected number to be {'>' if exclusive else '>='}{minimum}")
        if v > _MAX_SAFE:
            out.add(path, f"Too big: expected int to be <={_MAX_SAFE}")
    return check


def _array(item: Check) -> Check:
    def check(v: Any, path: str, out: _Issues) -> None:
        if not isinstance(v, list):
            _bad_type(out, path, "array", v)
            return
        for i, x in enumerate(v):
            item(x, _at(path, i), out)
    return check


def _boolean(v: Any, path: str, out: _Issues) -> None:
    if not isinstance(v, bool):
        _bad_type(out, path, "boolean", v)


def _json_value(v: Any, path: str, out: _Issues) -> None:
    if v is _MISSING:
        out.add(path, "Invalid input", True)


def _document_id(v: Any, path: str, out: _Issues) -> None:
    if not isinstance(v, str):
        _bad_type(out, path, "string", v)
    elif v == "":
        out.add(path, "Too small: expected string to have >=1 characters")


def _uri(v: Any, path: str, out: _Issues) -> None:
    if not isinstance(v, str):
        _bad_type(out, path, "string", v)
    elif not _is_url(v):
        out.add(path, "Invalid URL")


def _confidence(v: Any, path: str, out: _Issues) -> None:
    if not _is_number(v):
        _bad_type(out, path, "number", v)
    elif v < 0:
        out.add(path, "Too small: expected number to be >=0")
    elif v > 1:
        out.add(path, "Too big: expected number to be <=1")


def _span_rule(v: dict[str, Any], path: str, out: _Issues) -> None:
    if v["end"] < v["start"]:
        out.add(_at(path, "end"), "span ends before it starts")


def _span(v: Any, path: str, out: _Issues) -> None:
    _object(v, path, out, [("start", _integer(0, exclusive=False), True),
                           ("end", _integer(0, exclusive=False), True)], (_span_rule,))


def _source(v: Any, path: str, out: _Issues) -> None:
    _object(v, path, out, [
        ("document_id", _document_id, True), ("uri", _uri, False), ("title", _string, False),
        ("page", _integer(0, exclusive=True), False), ("section", _string, False),
        ("quote", _string, False), ("ocr", _boolean, False), ("span", _span, False),
        ("sha256", _pattern(_SHA256, "Invalid string: must match pattern /^[a-f0-9]{64}$/"), False),
        ("retrieved_at", _pattern(_ISO_DATETIME, "Invalid ISO datetime"), False),
    ])


def _producer(v: Any, path: str, out: _Issues) -> None:
    _object(v, path, out, [("name", _string, True), ("version", _string, True)])


def _sources_rule(p: dict[str, Any], path: str, out: _Issues) -> None:
    # An inferred fact cites the evidence it was inferred from.
    if p["method"] != "computed" and not p["sources"]:
        out.add(_at(path, "sources"), "facts other than computed must cite at least one source")


def _formula_rule(p: dict[str, Any], path: str, out: _Issues) -> None:
    if p["method"] == "computed" and "formula" not in p and not p["sources"]:
        out.add(_at(path, "formula"), "a computed fact names its formula or cites a source")


def _provenance(v: Any, path: str, out: _Issues) -> None:
    _object(v, path, out, [
        ("method", _enum(METHODS), True), ("sources", _array(_source), True),
        ("producer", _producer, False), ("formula", _string, False),
        ("inputs", _array(_string), False), ("confidence", _confidence, False),
        ("verified_by", _string, False), ("verified_at", _pattern(_ISO_DATETIME, "Invalid ISO datetime"), False),
    ], (_sources_rule, _formula_rule))


def _rights(v: Any, path: str, out: _Issues) -> None:
    _object(v, path, out, [("ai_use", _enum(AI_USE), True), ("redistribution", _enum(REDISTRIBUTION), True),
                           ("license", _string, False), ("attribution", _string, False)])


def _dates_rule(f: dict[str, Any], path: str, out: _Issues) -> None:
    a, b = f.get("valid_from"), f.get("valid_to")
    if is_iso_date(a) and is_iso_date(b) and a > b:
        out.add(_at(path, "valid_to"), "valid_to is before valid_from")


_FACT_FIELDS: list[tuple[str, Check, bool]] = [
    ("id", _string, False),
    ("subject", _pattern(_SUBJECT, "expected a FactLot URN (fl:<kind>:...)"), True),
    ("predicate", _pattern(_PREDICATE, "dotted lower_snake predicate"), True),
    ("value", _json_value, True),
    ("unit", _string, False),
    ("as_of", _pattern(_ISO_DATE, "Invalid ISO date"), True),
    ("valid_from", _pattern(_ISO_DATE, "Invalid ISO date"), False),
    ("valid_to", _pattern(_ISO_DATE, "Invalid ISO date"), False),
    ("provenance", _provenance, True),
    ("rights", _rights, False),
    ("supersedes", _array(_string), False),
]


def schema_issues(fact: Any) -> list[dict[str, str]]:
    """Issues against the published fact schema, in @factlot/schema's order and wording."""
    out = _Issues()
    _object(fact, "", out, _FACT_FIELDS, (_dates_rule,))
    return [{"path": p, "message": m} for p, m, _ in out.items]


def validate_fact(fact: Any) -> dict[str, Any]:
    """Return ``{"valid": bool, "issues": [{"path", "message"}]}`` against the fact schema.

    The fact_validate tool also checks values for Ingest predicates (``docverify.validate_fact_full``).
    """
    issues = schema_issues(fact)
    return {"valid": not issues, "issues": issues}
