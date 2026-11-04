"""Document verification tools: the caller's agent reads a document and proposes values with
quotes; FactLot checks each one deterministically against the page text and returns cited
FactLot facts. No model runs here.

The checks are the Ingest verifier's (``factlot.ingest.verify``). This module adds what the
hosted tools need around them: generic predicates, character spans, a hint for words hyphenated
at a line break, lease abstracts with amendment precedence, comparisons and claim checks. It is
the same code as packages/tools/src/documents.ts and quotes.ts; spec/vectors/documents.json pins
both languages.
"""

from __future__ import annotations

import hashlib
import re
import unicodedata
from decimal import Decimal
from typing import Any

from ._core import js_number_str
from .facts import _JS_WS, is_iso_date, js_key_order, schema_issues
from .ids import _base32, document_id
from .ingest.extract import PREDICATES
from .ingest.verify import (
    _CONSISTENCY,
    _DATE_PATTERNS,
    _dates_in,
    _is_date,
    _missing,
    _norm,
    _num,
    _numbers_in,
    PHRASES,
    check_value,
    missing_reason,
    show_value,
    text_number_missing,
)

DOC_LIMITS = {
    "pages_per_document": 2_000,
    "characters_per_page": 100_000,
    "characters_per_call": 2_000_000,
    "candidates_per_document": 500,
    "candidates_per_call": 2_000,
    "documents_per_abstract": 50,
    "quote_characters": 5_000,
    "facts_per_call": 2_000,
    "asserted_per_call": 500,
}
REVIEW_CONFIDENCE_THRESHOLD = 0.8
MIN_QUOTE_CHARS = 12
_PREDICATE = re.compile(r"[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+")
_SUBJECT = re.compile(rf"fl:[a-z]+:[^{_JS_WS}:]+(?::[^{_JS_WS}]+)?")


class DocInputError(ValueError):
    """Input that passed the schema but cannot be used; run_tool reports InputError."""

    def __init__(self, issues: list[dict[str, str]]) -> None:
        super().__init__("invalid input: " + "; ".join(f"{i['path'] or '(root)'}: {i['message']}" for i in issues))
        self.issues = issues


def js_json(v: Any) -> Any:
    """A JSON value as JavaScript holds it: whole numbers below 1e21 as ints (2026.0 is 2026),
    integers beyond 2**53 rounded to a double, and object keys in JavaScript's order."""
    if isinstance(v, bool) or v is None or isinstance(v, str):
        return v
    if isinstance(v, (int, float)):
        try:
            f = float(v)
        except OverflowError:
            return v
        return int(f) if f.is_integer() and abs(f) < 1e21 else f
    if isinstance(v, list):
        return [js_json(x) for x in v]
    if isinstance(v, dict):
        return {k: js_json(v[k]) for k in js_key_order(list(v))}
    return v


# --- predicates and value parts ------------------------------------------------------------------


def is_ingest_predicate(predicate: str) -> bool:
    return predicate in PREDICATES


def _text(v: Any) -> bool:
    return isinstance(v, str) and bool(v.strip())


def check_any_value(predicate: str, value: Any) -> str | None:
    """Ingest predicates get ``check_value``; any other dotted lower_snake predicate needs a value
    that is not null and, if a string, not blank (packages/tools/src/quotes.ts ``checkAnyValue``)."""
    if is_ingest_predicate(predicate):
        return check_value(predicate, value)
    if not _PREDICATE.fullmatch(predicate):
        return "predicate must be dotted lower_snake, e.g. lease.expiration_date"
    if value is None:
        return "expected a value"
    if isinstance(value, str) and not _text(value):
        return "expected non-empty string"
    return None


def _checkable(kind: str, value: Any) -> bool:
    if kind == "text":
        # A text is checked for the numbers written in digits in it; one without digits is not checked.
        return isinstance(value, str) and any(c in "0123456789" for c in _norm(value))
    if kind == "phrase":
        return isinstance(value, str) and value in PHRASES
    if kind == "string":
        return isinstance(value, str)
    if kind == "date":
        return _is_date(value)
    return _num(value)


def _generic_kind(value: Any) -> str | None:
    if _num(value):
        return "ratio" if 0 < value <= 1 else "number"
    if _is_date(value):
        return "date"
    return None


def value_parts(predicate: str, value: Any) -> list[dict[str, Any]]:
    """Every leaf of the value with the kind it is checked as ("as"), or none when it is not
    checked. Paths start at "value" and include array indexes; "reason_path" is the path the
    Ingest reason names (no array indexes)."""
    out: list[dict[str, Any]] = []

    def join(a: str, b: Any) -> str:
        return f"{a}.{b}" if a else str(b)

    def leaves(v: Any, path: str, rp: str) -> None:
        if isinstance(v, list):
            for i, x in enumerate(v):
                leaves(x, join(path, i), rp)
        elif isinstance(v, dict):
            for k in js_key_order(list(v)):
                leaves(v[k], join(path, k), join(rp, k))
        else:
            out.append({"path": path, "value": v, "reason_path": rp})

    def known(spec: Any, v: Any, path: str, rp: str) -> None:
        if isinstance(spec, str):
            if _checkable(spec, v):
                out.append({"path": path, "as": spec, "value": v, "reason_path": rp})
            else:
                leaves(v, path, rp)
        elif isinstance(spec, list):
            if not isinstance(v, list):
                leaves(v, path, rp)
            else:
                for i, x in enumerate(v):
                    known(spec[0], x, join(path, i), rp)
        elif spec is None or not isinstance(v, dict):
            leaves(v, path, rp)
        else:
            # Spec order first (the order check_consistency checks, so the first failure is the same).
            for k, inner in spec.items():
                if k in v:
                    known(inner, v[k], join(path, k), join(rp, k))
            for k in js_key_order(list(v)):
                if k not in spec:
                    leaves(v[k], join(path, k), join(rp, k))

    def generic(v: Any, path: str) -> None:
        if isinstance(v, list):
            for i, x in enumerate(v):
                generic(x, join(path, i))
        elif isinstance(v, dict):
            for k in js_key_order(list(v)):
                generic(v[k], join(path, k))
        else:
            part: dict[str, Any] = {"path": path, "value": v, "reason_path": path}
            kind = _generic_kind(v)
            if kind:
                part["as"] = kind
            out.append(part)

    if is_ingest_predicate(predicate):
        known(_CONSISTENCY.get(predicate), value, "", "")
    else:
        generic(value, "")
    for p in out:
        p["path"] = "value" if not p["path"] else f"value.{p['path']}"
    return out


def check_consistency_any(predicate: str, value: Any, quote: str) -> str | None:
    """``check_consistency`` for any predicate: Ingest predicates use their table; any other has
    its numbers, ratios (0 < x <= 1) and dates checked wherever they sit in the value."""
    q = _norm(quote)
    for p in value_parts(predicate, value):
        if p.get("as") and _missing(p["as"], p["value"], q):
            return missing_reason(p["as"], p["value"], p["reason_path"], q)
    return None


# --- quotes on pages ----------------------------------------------------------------------------

_PY_WS = re.compile(r"\s")
_BROKEN = re.compile(r"([A-Za-z])-[ \t]*(?:\r\n|\r|\n)[ \t]*([A-Za-z])")
_TYPOGRAPHIC = str.maketrans({"‘": "'", "’": "'", "“": '"', "”": '"', "–": "-", "—": "-"})


def _hyphen_readings(text: str) -> list[str]:
    """The page with a word hyphenated at a line break written without the break, and joined
    (soft hyphens removed). Only to explain why a quote was not found; never to accept one."""
    return [_BROKEN.sub(r"\1-\2", text), _BROKEN.sub(r"\1\2", text).replace("­", "")]


def _span_map(page: str) -> tuple[str, list[int], list[int]]:
    """The normalization piece by piece (a base character with its combining marks), with the
    original code-point range of every output character (quotes.ts ``spanMap``)."""
    clusters: list[list[Any]] = []
    for cp, ch in enumerate(page):
        if clusters and unicodedata.category(ch).startswith("M"):
            clusters[-1][0] += ch
            clusters[-1][2] = cp + 1
        else:
            clusters.append([ch, cp, cp + 1])
    out: list[list[Any]] = []  # [char, start, end, is_space]
    for text, s, e in clusters:
        for ch in unicodedata.normalize("NFKC", text).translate(_TYPOGRAPHIC):
            if not _PY_WS.match(ch):
                out.append([ch, s, e, False])
            elif out and out[-1][3]:
                out[-1][2] = e
            else:
                out.append([" ", s, e, True])
    while out and out[0][3]:
        out.pop(0)
    while out and out[-1][3]:
        out.pop()
    text_out: list[str] = []
    start: list[int] = []
    end: list[int] = []
    for ch, s, e, _ in out:
        lower = ch.lower()
        text_out.append(lower)
        start.extend([s] * len(lower))
        end.extend([e] * len(lower))
    return "".join(text_out), start, end


class PageText:
    """A document's pages, normalized once."""

    def __init__(self, pages: list[str]) -> None:
        self.pages = pages
        self.normalized = [_norm(p) for p in pages]
        self._hyphenated: list[list[str]] | None = None
        self._maps: dict[int, tuple[str, list[int], list[int]]] = {}

    def hyphenation_hits(self, q: str) -> list[int]:
        if self._hyphenated is None:
            self._hyphenated = [[_norm(t) for t in _hyphen_readings(p)] for p in self.pages]
        return [i + 1 for i, readings in enumerate(self._hyphenated) if any(q in t for t in readings)]

    def span(self, page: int, q: str) -> dict[str, int] | None:
        """Code-point offsets of the normalized quote within the document text (pages joined by \\f)."""
        if page not in self._maps:
            self._maps[page] = _span_map(self.pages[page - 1])
        text, start, end = self._maps[page]
        if text != self.normalized[page - 1]:
            return None
        at = text.find(q)
        if at < 0:
            return None
        offset = sum(len(p) + 1 for p in self.pages[: page - 1])
        return {"start": offset + start[at], "end": offset + end[at + len(q) - 1]}


def locate_quote(doc: PageText, quote: str, claimed_page: int) -> dict[str, Any]:
    """Where the quote is (the quote part of ``factlot.ingest.verify.verify``)."""
    q = _norm(quote)
    if len(q) < MIN_QUOTE_CHARS:
        return {"ok": False, "reason": f"quote shorter than {MIN_QUOTE_CHARS} characters"}
    if 1 <= claimed_page <= len(doc.normalized) and q in doc.normalized[claimed_page - 1]:
        return {"ok": True, "page": claimed_page, "corrected": False, "q": q}
    hits = [i + 1 for i, t in enumerate(doc.normalized) if q in t]
    if len(hits) > 1:
        return {"ok": False, "reason": f"quote appears on several pages [{', '.join(map(str, hits))}]; "
                                       f"cannot cite a single page"}
    if not hits:
        joined = doc.hyphenation_hits(q)
        if joined:
            return {"ok": False, "reason": f"quote not found in the document; it matches page{'s' if len(joined) > 1 else ''} "
                                           f"{', '.join(map(str, joined))} only if a word hyphenated at a line break is "
                                           f"rejoined. Quote the text as printed: keep the hyphen and the line break (a "
                                           f'space will do), e.g. "com- mencement"'}
        return {"ok": False, "reason": "quote not found in the document"}
    return {"ok": True, "page": hits[0], "corrected": True, "q": q}


# --- shared ---------------------------------------------------------------------------------------


def fact_id(subject: str, predicate: str, document: str, quote: str) -> str:
    """The fact ID Ingest gives a cited fact (``factlot.ingest.pipeline._fact_id``)."""
    digest = hashlib.sha256("\x1f".join((subject, predicate, document, quote)).encode()).digest()
    return f"flf_{_base32(digest, 24)}"


def _characters(pages: list[str]) -> int:
    return sum(len(p) for p in pages)


def _cap_characters(total: int) -> None:
    if total > DOC_LIMITS["characters_per_call"]:
        raise DocInputError([{"path": "", "message": (
            f"pages hold {total} characters in all; the limit is {DOC_LIMITS['characters_per_call']} per call. "
            "Verify long documents in several calls (doc_abstract_lease accepts the facts from each)")}])


def _load_document(d: dict[str, Any], path: str = "document") -> dict[str, Any]:
    """A document input as pages to check; ``path`` names it in an error (e.g. "document")."""
    pages = d["pages"]
    beyond = next((p for p in d.get("ocr_pages", []) if p > len(pages)), None)
    if beyond is not None:
        raise DocInputError([{"path": f"{path}.ocr_pages", "message": (
            f"page {beyond} is listed as OCR, but the document has {len(pages)} page{'' if len(pages) == 1 else 's'}")}])
    sha = d.get("sha256")
    doc: dict[str, Any] = {
        "id": f"fl:document:sha256-{sha}" if sha else document_id("\f".join(d["pages"])).urn,
        "basis": "sha256" if sha else "page_text",
        "text": PageText(d["pages"]),
    }
    if "title" in d:
        doc["title"] = d["title"]
    if sha:
        doc["sha256"] = sha
    doc["ocr"] = set(d.get("ocr_pages", []))
    return doc


def _describe(doc: dict[str, Any]) -> dict[str, Any]:
    out = {"document_id": doc["id"], "document_id_basis": doc["basis"]}
    if "title" in doc:
        out["title"] = doc["title"]
    out["pages"] = len(doc["text"].pages)
    if doc["ocr"]:
        out["ocr_pages"] = sorted(doc["ocr"])
    return out


def _predicate_note(predicate: str) -> str | None:
    if is_ingest_predicate(predicate) or not predicate.startswith("lease."):
        return None
    from .tools import _suggest  # the unknown-field suggester, shared with run_tool

    near = _suggest(predicate, list(PREDICATES))
    if not near:
        return None
    return (f"{predicate} is not an Ingest predicate (did you mean {near}?); its numbers, ratios and dates were "
            "checked with the generic rules")


def _coverage(predicate: str, value: Any) -> dict[str, Any]:
    parts = value_parts(predicate, value)
    return {"checked": [{"path": p["path"], "as": p["as"]} for p in parts if p.get("as")],
            "not_checked": [p["path"] for p in parts if not p.get("as")]}


def _build_fact(ctx: dict[str, Any], predicate: str, value: Any, document: str, quote: str,
                provenance: dict[str, Any]) -> dict[str, Any]:
    fact: dict[str, Any] = {"id": fact_id(ctx["subject"], predicate, document, quote), "subject": ctx["subject"],
                            "predicate": predicate, "value": value, "as_of": ctx["as_of"]}
    if ctx.get("valid_from") is not None:
        fact["valid_from"] = ctx["valid_from"]
    fact["provenance"] = provenance
    issues = schema_issues(fact)
    if issues:  # defensive: the tools must only emit valid facts
        raise AssertionError(f"document tools built an invalid fact: {issues}")
    return fact


def _verify_candidate(doc: dict[str, Any], c: dict[str, Any], ctx: dict[str, Any], label: dict[str, Any],
                      out: dict[str, list[Any]]) -> None:
    """One candidate through the Ingest checks, in order: value shape, quote on page, value in
    quote, confidence."""
    base = {**label, "predicate": c["predicate"]}
    value = c["value"]
    shape = check_any_value(c["predicate"], value)
    if shape:
        out["rejected"].append({**base, "value": value, "page": c["page"], "check": "value", "reason": shape})
        return
    loc = locate_quote(doc["text"], c["quote"], c["page"])
    if not loc["ok"]:
        out["rejected"].append({**base, "value": value, "page": c["page"], "check": "quote", "reason": loc["reason"]})
        return
    notes: list[str] = []
    if loc["corrected"]:
        notes.append(f"quote found on page {loc['page']}, not {c['page']}")
    note = _predicate_note(c["predicate"])
    if note:
        notes.append(note)

    def review(check: str, reason: str) -> None:
        item = {**base, "value": value, "quote": c["quote"], "page": loc["page"]}
        if "section" in c:
            item["section"] = c["section"]
        item.update({"check": check, "reason": reason})
        if notes:
            item["notes"] = notes
        out["needs_review"].append(item)

    mismatch = check_consistency_any(c["predicate"], value, c["quote"])
    if mismatch:
        return review("consistency", mismatch)
    if c.get("confidence") is not None and c["confidence"] < REVIEW_CONFIDENCE_THRESHOLD:
        return review("confidence", f"extractor confidence {show_value(c['confidence'])} is below "
                                    f"{js_number_str(REVIEW_CONFIDENCE_THRESHOLD)}")
    span = doc["text"].span(loc["page"], loc["q"])
    source: dict[str, Any] = {"document_id": doc["id"]}
    if "title" in doc:
        source["title"] = doc["title"]
    source["page"] = loc["page"]
    if "section" in c:
        source["section"] = c["section"]
    source["quote"] = c["quote"]
    if loc["page"] in doc["ocr"]:
        source["ocr"] = True
    if span:
        source["span"] = span
    if "sha256" in doc:
        source["sha256"] = doc["sha256"]
    provenance: dict[str, Any] = {"method": "extracted", "sources": [source], "producer": dict(ctx["producer"])}
    if c.get("confidence") is not None:
        provenance["confidence"] = c["confidence"]
    fact = _build_fact(ctx, c["predicate"], value, doc["id"], c["quote"], provenance)
    out["facts"].append(fact)
    item = {**label, "fact": fact, **_coverage(c["predicate"], value)}
    if notes:
        item["notes"] = notes
    out["verified"].append(item)


def _outcome() -> dict[str, list[Any]]:
    return {"verified": [], "needs_review": [], "rejected": [], "facts": []}


# --- fact_validate --------------------------------------------------------------------------------


def fact_value_issues(fact: Any) -> list[dict[str, str]]:
    """fact_validate's checks beyond the schema, for Ingest predicates: the value's shape, and that
    every source quote supports the value (the Ingest consistency check)."""
    if not isinstance(fact, dict) or not isinstance(fact.get("predicate"), str):
        return []
    predicate = fact["predicate"]
    if not is_ingest_predicate(predicate) or "value" not in fact:
        return []
    shape = check_value(predicate, fact["value"])
    if shape:
        return [{"path": "value", "message": f"value does not fit {predicate}: {shape}"}]
    if predicate not in _CONSISTENCY:
        return []
    prov = fact.get("provenance")
    if not isinstance(prov, dict) or not isinstance(prov.get("sources"), list):
        return []
    out = []
    for i, s in enumerate(prov["sources"]):
        if not isinstance(s, dict) or not isinstance(s.get("quote"), str):
            continue
        reason = check_consistency_any(predicate, fact["value"], s["quote"])
        if reason:
            out.append({"path": f"provenance.sources.{i}.quote", "message": f"value not supported by quote: {reason}"})
    return out


def validate_fact_full(fact: Any) -> dict[str, Any]:
    """fact_validate: the published schema (unknown fields, citations, date order), then the value checks."""
    issues = schema_issues(fact) + fact_value_issues(fact)
    return {"valid": not issues, "issues": issues}


# --- doc_verify_facts ------------------------------------------------------------------------------


def verify_facts(args: dict[str, Any], producer: dict[str, str]) -> dict[str, Any]:
    _cap_characters(_characters(args["document"]["pages"]))
    doc = _load_document(args["document"])
    out = _outcome()
    ctx = {"subject": args.get("subject", doc["id"]), "as_of": args["as_of"], "producer": producer}
    for i, c in enumerate(args["candidates"]):
        _verify_candidate(doc, c, ctx, {"candidate": i}, out)
    return {"document": _describe(doc), "verified": out["verified"], "needs_review": out["needs_review"],
            "rejected": out["rejected"],
            "summary": {"candidates": len(args["candidates"]), "verified": len(out["verified"]),
                        "needs_review": len(out["needs_review"]), "rejected": len(out["rejected"])}}


# --- doc_abstract_lease ------------------------------------------------------------------------------


def json_equal(a: Any, b: Any) -> bool:
    """JSON equality: numbers by value, no type coercion (True is not 1), objects regardless of key order."""
    if isinstance(a, list) or isinstance(b, list):
        return isinstance(a, list) and isinstance(b, list) and len(a) == len(b) and all(
            json_equal(x, y) for x, y in zip(a, b))
    if isinstance(a, dict) or isinstance(b, dict):
        return isinstance(a, dict) and isinstance(b, dict) and len(a) == len(b) and all(
            k in b and json_equal(a[k], b[k]) for k in a)
    if isinstance(a, bool) or isinstance(b, bool):
        return isinstance(a, bool) and isinstance(b, bool) and a == b
    if _num(a) and _num(b):
        return a == b
    return type(a) is type(b) and a == b


def _role(docs: list[dict[str, Any]], i: int) -> str:
    return docs[i].get("role") or ("original" if i == 0 else "amendment")


def _apply_order(docs: list[dict[str, Any]]) -> list[int]:
    """Original first, then amendments by effective date (input order breaks ties), or in input
    order if any amendment is undated (``factlot.ingest.pipeline.document_order``)."""
    originals = [i for i in range(len(docs)) if _role(docs, i) == "original"]
    amendments = [i for i in range(len(docs)) if _role(docs, i) != "original"]
    if all(docs[i].get("effective_date") for i in amendments):
        amendments.sort(key=lambda i: (docs[i]["effective_date"], i))
    return originals + amendments


def _citation(s: dict[str, Any]) -> dict[str, Any]:
    src = s["fact"]["provenance"]["sources"][0]
    out: dict[str, Any] = {"document": s["document"], "document_id": src["document_id"]}
    for k in ("title", "page", "section", "quote", "span"):
        if src.get(k) is not None:
            out[k] = src[k]
    out["quote_on_page"] = s["quote_on_page"]
    out["fact_id"] = s["fact"]["id"]
    return out


def _first_issue(issues: list[dict[str, str]]) -> str:
    i = issues[0]
    more = f" (and {len(issues) - 1} more)" if len(issues) > 1 else ""
    return f"not a valid fact: {i['path'] or '(root)'}: {i['message']}{more}"


def abstract_lease(args: dict[str, Any], producer: dict[str, str]) -> dict[str, Any]:
    docs = args["documents"]
    total = 0
    candidates = 0
    for i, d in enumerate(docs):
        if "pages" not in d and not d.get("facts"):
            raise DocInputError([{"path": f"documents.{i}", "message": "give pages with candidates or facts, or facts alone"}])
        if "pages" in d and not d.get("candidates") and not d.get("facts"):
            raise DocInputError([{"path": f"documents.{i}", "message": "pages need candidates (or facts) to verify"}])
        if "pages" not in d and d.get("candidates"):
            raise DocInputError([{"path": f"documents.{i}.candidates", "message": "candidates need the document's pages"}])
        total += _characters(d.get("pages", []))
        candidates += len(d.get("candidates", [])) + len(d.get("facts", []))
    _cap_characters(total)
    if candidates > DOC_LIMITS["candidates_per_call"]:
        raise DocInputError([{"path": "documents", "message": (
            f"{candidates} candidates and facts in all; the limit is {DOC_LIMITS['candidates_per_call']} per call")}])

    order = _apply_order(docs)
    loaded = [_load_document(d, f"documents.{i}") if "pages" in d else None for i, d in enumerate(docs)]

    def doc_id(i: int) -> str | None:
        if loaded[i] is not None:
            return loaded[i]["id"]
        if docs[i].get("sha256"):
            return f"fl:document:sha256-{docs[i]['sha256']}"
        for f in docs[i].get("facts", []):
            prov = f.get("provenance")
            src = prov["sources"][0] if isinstance(prov, dict) and isinstance(prov.get("sources"), list) \
                and prov["sources"] else None
            if isinstance(src, dict) and isinstance(src.get("document_id"), str) and src["document_id"]:
                return src["document_id"]
        return None

    ids = [doc_id(i) for i in range(len(docs))]
    subject = args.get("subject")
    if subject is None:
        subject = ids[order[0]] or next((x for x in ids if x is not None), None)
    if subject is None or not _SUBJECT.fullmatch(subject):
        raise DocInputError([{"path": "subject", "message": (
            "no FactLot document ID to use as the subject; pass subject (your lease's fl:lease:… URN)")}])

    facts: list[dict[str, Any]] = []
    needs_review: list[dict[str, Any]] = []
    rejected: list[dict[str, Any]] = []
    statements: list[dict[str, Any]] = []
    documents: list[dict[str, Any]] = []
    for o, di in enumerate(order):
        d, doc = docs[di], loaded[di]
        ctx = {"subject": subject, "as_of": args["as_of"], "valid_from": d.get("effective_date"), "producer": producer}
        out = _outcome()
        placed: list[dict[str, Any]] = []
        if doc is not None:
            for i, c in enumerate(d.get("candidates", [])):
                _verify_candidate(doc, c, ctx, {"document": di, "candidate": i}, out)
        for i, f in enumerate(d.get("facts", [])):
            label = {"document": di, "fact": i}
            predicate = f["predicate"] if isinstance(f.get("predicate"), str) else ""

            def reject(reason: str) -> None:
                out["rejected"].append({**label, "predicate": predicate, "check": "fact", "reason": reason})

            check = validate_fact_full(f)
            if not check["valid"]:
                reject(_first_issue(check["issues"]))
                continue
            prov = f["provenance"]
            src = prov["sources"][0]
            if not isinstance(src.get("quote"), str) or not _num(src.get("page")):
                reject("the fact's first source needs a quote and a page")
                continue
            if src["document_id"] != ids[di]:
                reject(f"the fact cites {src['document_id']}, but this document is {ids[di]}")
                continue
            if doc is not None:
                cand: dict[str, Any] = {"predicate": predicate, "value": f["value"], "quote": src["quote"],
                                        "page": src["page"]}
                if isinstance(src.get("section"), str):
                    cand["section"] = src["section"]
                if _num(prov.get("confidence")):
                    cand["confidence"] = prov["confidence"]
                _verify_candidate(doc, cand, ctx, label, out)
                continue
            if predicate and not is_ingest_predicate(predicate):
                reason = check_consistency_any(predicate, f["value"], src["quote"])
                if reason:
                    reject(f"value not supported by quote: {reason}")
                    continue
            fact = _build_fact(ctx, predicate, f["value"], ids[di], src["quote"], dict(prov))
            placed.append({"fact": fact, "quote_on_page": False})
        ordered = [{"fact": fact, "quote_on_page": True} for fact in out["facts"]] + placed
        for p in ordered:
            facts.append(p["fact"])
            statements.append({**p, "document": di, "order": o})
        needs_review.extend(out["needs_review"])
        rejected.extend(out["rejected"])
        entry: dict[str, Any] = {"document": di, "applied": o + 1, "role": _role(docs, di)}
        if d.get("effective_date") is not None:
            entry["effective_date"] = d["effective_date"]
        if doc is not None:
            entry.update(_describe(doc))
        else:
            entry.update({"document_id": ids[di], "document_id_basis": "sha256" if d.get("sha256") else "facts"})
            if "title" in d:
                entry["title"] = d["title"]
        entry.update({"verified": len(ordered), "needs_review": len(out["needs_review"]),
                      "rejected": len(out["rejected"])})
        documents.append(entry)

    # Supersession: a later document's statement of a predicate controls; earlier ones are history.
    fields: dict[str, dict[str, Any]] = {}
    for s in statements:
        predicate = s["fact"]["predicate"]
        f = fields.get(predicate)
        if f is None:
            fields[predicate] = {"current": s, "history": [], "conflicts": []}
            continue
        if f["current"]["order"] == s["order"]:
            if not json_equal(f["current"]["fact"]["value"], s["fact"]["value"]) and not any(
                    json_equal(c["fact"]["value"], s["fact"]["value"]) for c in f["conflicts"]):
                f["conflicts"].append(s)
            continue
        s["fact"]["supersedes"] = [f["current"]["fact"]["id"]]
        f["history"].extend([f["current"], *f["conflicts"]])
        f["current"], f["conflicts"] = s, []
    order_of = {di: o for o, di in enumerate(order)}
    open_items = [{**x, "status": "needs_review"} for x in needs_review] + [{**x, "status": "rejected"} for x in rejected]
    result_fields = []
    for predicate, f in fields.items():
        items = []
        for x in open_items:
            if x["predicate"] == predicate and order_of[x["document"]] >= f["current"]["order"]:
                item: dict[str, Any] = {"document": x["document"]}
                if "candidate" in x:
                    item["candidate"] = x["candidate"]
                else:
                    item["fact"] = x["fact"]
                item.update({"status": x["status"], "check": x["check"], "reason": x["reason"]})
                items.append(item)

        def short(s: dict[str, Any]) -> dict[str, Any]:
            return {"value": s["fact"]["value"], **_citation(s)}

        field: dict[str, Any] = {"predicate": predicate, "value": f["current"]["fact"]["value"],
                                 "source": _citation(f["current"]), "history": [short(s) for s in f["history"]]}
        if f["conflicts"]:
            field["conflicts"] = [short(s) for s in f["conflicts"]]
        if items:
            field["open_items"] = items
        result_fields.append(field)
    return {"subject": subject, "as_of": args["as_of"], "documents": documents, "fields": result_fields,
            "facts": facts, "needs_review": needs_review, "rejected": rejected,
            "summary": {"documents": len(docs), "fields": len(result_fields), "facts": len(facts),
                        "needs_review": len(needs_review), "rejected": len(rejected),
                        "conflicts": sum(1 for f in result_fields if "conflicts" in f)}}


# --- doc_compare -------------------------------------------------------------------------------------


def _differences(a: Any, lease: Any, path: str, out: list[dict[str, Any]]) -> None:
    if len(out) >= 20:
        return
    if isinstance(a, dict) and isinstance(lease, dict):
        for k in js_key_order(list(a)):
            if k not in lease:
                out.append({"path": f"{path}.{k}", "asserted": a[k]})
            else:
                _differences(a[k], lease[k], f"{path}.{k}", out)
        return
    if isinstance(a, list) and isinstance(lease, list) and len(a) == len(lease):
        for i, (x, y) in enumerate(zip(a, lease)):
            _differences(x, y, f"{path}.{i}", out)
        return
    if not json_equal(a, lease):
        out.append({"path": path, "asserted": a, "lease": lease})


def compare(args: dict[str, Any]) -> dict[str, Any]:
    issues: list[dict[str, str]] = []
    for i, f in enumerate(args["lease_facts"]):
        for x in validate_fact_full(f)["issues"]:
            issues.append({"path": f"lease_facts.{i}" + (f".{x['path']}" if x["path"] else ""), "message": x["message"]})
    for i, a in enumerate(args["asserted"]):
        if not _PREDICATE.fullmatch(a["predicate"]):
            issues.append({"path": f"asserted.{i}.predicate", "message": "dotted lower_snake predicate"})
        elif is_ingest_predicate(a["predicate"]):
            shape = check_value(a["predicate"], a["value"])
            if shape:
                issues.append({"path": f"asserted.{i}.value", "message": shape})
    if issues:
        raise DocInputError(issues[:20])

    superseded = {x for f in args["lease_facts"] for x in f.get("supersedes", [])}
    current: dict[str, list[dict[str, Any]]] = {}
    for f in args["lease_facts"]:
        if "id" in f and f["id"] in superseded:
            continue
        group = current.setdefault(f["predicate"], [])
        if not any(json_equal(g["value"], f["value"]) for g in group):
            group.append(f)

    def cite(f: dict[str, Any]) -> dict[str, Any]:
        src = f["provenance"]["sources"][0] if f["provenance"]["sources"] else {}
        out: dict[str, Any] = {"fact_id": f["id"]} if "id" in f else {}
        for k in ("document_id", "title", "page", "section", "quote"):
            if src.get(k) is not None:
                out[k] = src[k]
        return out

    summary = {"match": 0, "mismatch": 0, "not_in_lease": 0, "ambiguous_in_lease": 0}
    results = []
    for i, a in enumerate(args["asserted"]):
        base: dict[str, Any] = {"asserted": i}
        if "label" in a:
            base["label"] = a["label"]
        base.update({"predicate": a["predicate"], "value": a["value"]})
        lease = current.get(a["predicate"], [])
        if not lease:
            summary["not_in_lease"] += 1
            results.append({**base, "status": "not_in_lease"})
            continue
        if len(lease) > 1:
            summary["ambiguous_in_lease"] += 1
            results.append({**base, "status": "ambiguous_in_lease",
                            "lease": [{"value": f["value"], "citation": cite(f)} for f in lease]})
            continue
        f = lease[0]
        diffs: list[dict[str, Any]] = []
        _differences(a["value"], f["value"], "value", diffs)
        status = "mismatch" if diffs else "match"
        summary[status] += 1
        item = {**base, "status": status, "lease_value": f["value"]}
        if diffs:
            item["differences"] = diffs
        item["citation"] = cite(f)
        results.append(item)
    return {"results": results, "summary": summary}


# --- doc_verify_claim ----------------------------------------------------------------------------------


def _decimal_number(d: Decimal) -> int | float:
    return int(d) if d == d.to_integral_value() and abs(d) < Decimal("1e21") else float(d)


def _iso(ymd: tuple[int, int, int]) -> str:
    return f"{ymd[0]:04d}-{ymd[1]:02d}-{ymd[2]:02d}"


def _date_ranges(text: str) -> list[tuple[int, int]]:
    out = []
    for pattern, read in _DATE_PATTERNS:
        for m in pattern.finditer(text):
            if any(_valid_ymd(y, mo, d) for y, mo, d in read(m)):
                out.append((m.start(), m.end()))
    return out


def _valid_ymd(y: Any, mo: Any, d: Any) -> bool:
    return is_iso_date(f"{int(y):04d}-{int(mo):02d}-{int(d):02d}") and int(y) >= 1


def _sorted_numbers(found: set[Decimal]) -> list[int | float]:
    return sorted((_decimal_number(d) for d in found), key=float)


def verify_claim(args: dict[str, Any]) -> dict[str, Any]:
    _cap_characters(_characters(args["document"]["pages"]))
    claim = args["claim"]
    by_value = "predicate" in claim or "value" in claim
    if by_value == ("text" in claim) or (by_value and ("predicate" not in claim or "value" not in claim)):
        raise DocInputError([{"path": "claim", "message": "give either predicate and value, or text"}])
    if by_value:
        shape = check_any_value(claim["predicate"], claim["value"])
        if shape:
            path = "claim.value" if _PREDICATE.fullmatch(claim["predicate"]) else "claim.predicate"
            raise DocInputError([{"path": path, "message": shape}])
    doc = _load_document(args["document"])
    evidence: dict[str, Any] = {"document_id": doc["id"], "document_id_basis": doc["basis"], "page": args["page"],
                                "quote": args["quote"]}
    loc = locate_quote(doc["text"], args["quote"], args["page"])
    if not loc["ok"]:
        return {"status": "unverifiable", "reason": loc["reason"], "evidence": evidence, "checked": []}
    evidence["page"] = loc["page"]
    if loc["page"] in doc["ocr"]:
        evidence["ocr"] = True
    span = doc["text"].span(loc["page"], loc["q"])
    if span:
        evidence["span"] = span
    if loc["corrected"]:
        evidence["note"] = f"quote found on page {loc['page']}, not {args['page']}"
    q = loc["q"]
    states = {"dates": sorted(_iso(d) for d in _dates_in(q))[:20], "numbers": _sorted_numbers(_numbers_in(q))[:20]}

    not_checked: list[str] = []
    if by_value:
        every = value_parts(claim["predicate"], claim["value"])
        parts = [{"path": p["path"], "as": p["as"], "value": p["value"]} for p in every if p.get("as")]
        not_checked = [p["path"] for p in every if not p.get("as")]
    else:
        # Dates first; numbers are read from the rest of the sentence, so "June 30, 2031" is one
        # date and not also the numbers 30 and 2031.
        t = _norm(claim["text"])
        masked = t
        for s, e in _date_ranges(t):
            masked = masked[:s] + " " * (e - s) + masked[e:]
        parts = [{"as": "date", "value": v} for v in sorted(_iso(d) for d in _dates_in(t))]
        parts += [{"as": "number", "value": v} for v in _sorted_numbers(_numbers_in(masked))]
    if not parts:
        result: dict[str, Any] = {
            "status": "unverifiable",
            "reason": ("nothing in this value can be checked against a quote: FactLot checks numbers, ratios, dates and "
                       "verbatim names, not enums or free text") if by_value else
                      ("the claim text has no number or date to check; pass claim.predicate and claim.value to check a "
                       "name, or read the quote yourself"),
            "evidence": evidence, "checked": []}
        if not_checked:
            result["not_checked"] = not_checked
        return result
    checked = [{**p, "found": not _missing(p["as"], p["value"], q)} for p in parts]
    absent = [p for p in checked if not p["found"]]

    def stated(kind: str) -> list[Any]:
        return states["dates"] if kind == "date" else [] if kind in ("string", "phrase") else states["numbers"]

    def shown(p: dict[str, Any]) -> str:
        if p["as"] == "text":
            return f"number {text_number_missing(p['value'], q)} in {show_value(p['value'])}"
        return show_value(p["value"])

    def where(p: dict[str, Any]) -> str:
        return f" ({p['path'][len('value.'):]})" if p.get("path") and p["path"] != "value" else ""

    contradicting = next((p for p in absent if stated(p["as"])), None)
    if not absent:
        status = "supported"
        reason = ("every checked part of the value is written in the quote, and the quote is on the page" if by_value
                  else "every number and date in the claim is written in the quote, and the quote is on the page; "
                       "FactLot does not read the sentence's meaning")
    elif contradicting is not None:
        status = "contradicted"
        kind = "dates" if contradicting["as"] == "date" else "numbers"
        listed = ", ".join(js_number_str(v) if _num(v) else str(v) for v in stated(contradicting["as"]))
        reason = f"{shown(contradicting)}{where(contradicting)} is not written in the quote; the quote states {kind}: {listed}"
    else:
        status = "unverifiable"
        p = absent[0]
        if p["as"] == "string":
            reason = (f"{show_value(p['value'])}{where(p)} is not written in the quote; FactLot cannot tell whether the "
                      "quote names someone else")
        elif p["as"] == "phrase":
            reason = (f"{show_value(p['value'])}{where(p)} is not worded in the quote as FactLot recognises it "
                      "(docs/document-verification.md lists the phrases); read the quote")
        else:
            reason = (f"{show_value(p['value'])}{where(p)} is not written in the quote, and the quote states no "
                      f"{'date' if p['as'] == 'date' else 'number'} to compare it with")
    result = {"status": status, "reason": reason, "evidence": evidence, "checked": checked}
    if not_checked:
        result["not_checked"] = not_checked
    if status == "contradicted":
        result["quote_states"] = states
    return result

