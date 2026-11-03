"""Validate FactLot facts (mirrors the core rules of @factlot/schema; see docs/fact-model.md)."""

from __future__ import annotations

import re
from datetime import date
from typing import Any

METHODS = ("public_record", "extracted", "human_verified", "computed", "reported", "inferred")
# Matched with fullmatch (re's `$` also matches before a trailing newline, which @factlot/schema
# rejects), with \s spelled as ECMAScript whitespace and \d as ASCII digits, as in JavaScript.
_JS_WS = "\t\n\v\f\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff"
_SUBJECT = re.compile(rf"fl:[a-z]+:[^{_JS_WS}:]+(?::[^{_JS_WS}]+)?")
_PREDICATE = re.compile(r"[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+")


def _is_date(v: Any) -> bool:
    if not isinstance(v, str) or not re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}", v):
        return False
    try:
        date.fromisoformat(v)
        return True
    except ValueError:
        return False


def validate_fact(fact: Any) -> dict[str, Any]:
    """Return ``{"valid": bool, "issues": [{"path", "message"}]}``."""
    issues: list[dict[str, str]] = []

    def bad(path: str, message: str) -> None:
        issues.append({"path": path, "message": message})

    if not isinstance(fact, dict):
        return {"valid": False, "issues": [{"path": "", "message": "expected object"}]}
    if not isinstance(fact.get("subject"), str) or not _SUBJECT.fullmatch(fact["subject"]):
        bad("subject", "expected a FactLot URN (fl:<kind>:...)")
    if not isinstance(fact.get("predicate"), str) or not _PREDICATE.fullmatch(fact["predicate"]):
        bad("predicate", "dotted lower_snake predicate")
    if "value" not in fact:
        bad("value", "required")
    if not _is_date(fact.get("as_of")):
        bad("as_of", "expected YYYY-MM-DD")
    for key in ("valid_from", "valid_to"):
        if key in fact and not _is_date(fact[key]):
            bad(key, "expected YYYY-MM-DD")
    prov = fact.get("provenance")
    if not isinstance(prov, dict):
        bad("provenance", "required object")
    else:
        method = prov.get("method")
        if method not in METHODS:
            bad("provenance.method", f"expected one of {', '.join(METHODS)}")
        sources = prov.get("sources")
        if not isinstance(sources, list):
            bad("provenance.sources", "expected array")
        else:
            if method not in ("computed", "inferred") and not sources:
                bad("provenance.sources", "facts other than computed/inferred must cite at least one source")
            for i, s in enumerate(sources):
                if not isinstance(s, dict) or not isinstance(s.get("document_id"), str) or not s["document_id"]:
                    bad(f"provenance.sources.{i}.document_id", "required")
        conf = prov.get("confidence")
        if conf is not None and (isinstance(conf, bool) or not isinstance(conf, (int, float)) or not 0 <= conf <= 1):
            bad("provenance.confidence", "expected number between 0 and 1")
    rights = fact.get("rights")
    if rights is not None:
        if not isinstance(rights, dict):
            bad("rights", "expected object")
        else:
            if rights.get("ai_use") not in ("permitted", "prohibited", "unknown"):
                bad("rights.ai_use", "expected permitted, prohibited, or unknown")
            if rights.get("redistribution") not in ("permitted", "attribution_required", "prohibited", "unknown"):
                bad("rights.redistribution", "expected permitted, attribution_required, prohibited, or unknown")
    return {"valid": not issues, "issues": issues}
