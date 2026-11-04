"""doc_check_use_conflict: compare a proposed use with a center's verified exclusive-use and
prohibited-use facts, by use category (the vocabulary in schemas/vocabularies/use-categories.json)
and shared words. Deterministic and textual: every hit is a potential conflict for a person to
review, never a legal conclusion. packages/tools/src/uses.ts is the same code;
spec/vectors/documents.json pins both."""

from __future__ import annotations

import json
import re
from functools import lru_cache
from importlib import resources
from typing import Any

from .docverify import DocInputError, validate_fact_full
from .words import KeywordIndex, words

CONFLICT_LABEL = "potential conflict — needs human review"
USE_CONFLICT_NOTE = (
    "Potential conflicts only. FactLot compares the proposed use with each restriction by use category (the published "
    "vocabulary, spec/schemas/vocabularies/use-categories.json) and by shared words. It does not interpret the lease, "
    "decide whether a carve-out applies, or give a legal conclusion: every item needs review by a person, and an "
    "empty list does not mean there is no conflict.")
_DIGITS = re.compile(r"[0-9]+")


@lru_cache(maxsize=None)
def vocabulary() -> dict[str, Any]:
    """The use-category vocabulary (generated from packages/tools/src/vocabularies.ts)."""
    path = resources.files("factlot").joinpath("schemas/vocabularies/use-categories.json")
    return json.loads(path.read_text("utf-8"))


@lru_cache(maxsize=None)
def _index() -> tuple[KeywordIndex, frozenset[str], dict[str, str], dict[str, int]]:
    cats = vocabulary()["categories"]
    index = KeywordIndex((c["id"], c["keywords"]) for c in cats)
    stop = frozenset(w for s in vocabulary()["stopwords"] for w in words(s))
    return index, stop, {c["id"]: c["label"] for c in cats}, {c["id"]: i for i, c in enumerate(cats)}


def _categories_of(text: str) -> dict[str, list[str]]:
    """Categories whose keywords appear in the text, in vocabulary order, with the keywords found."""
    index, _, _, order = _index()
    found: dict[str, list[str]] = {}
    for m in index.find(words(text)):
        hits = found.setdefault(m["key"], [])
        if m["keyword"] not in hits:
            hits.append(m["keyword"])
    return dict(sorted(found.items(), key=lambda kv: order[kv[0]]))


def _significant(text: str) -> list[str]:
    """Words that can carry a use: not a stopword, three letters or more, not a bare number."""
    stop = _index()[1]
    out: list[str] = []
    for w in words(text):
        if len(w) >= 3 and not _DIGITS.fullmatch(w) and w not in stop and w not in out:
            out.append(w)
    return out


def _match(proposed: dict[str, Any], restriction: str) -> dict[str, list[str]] | None:
    categories = [c for c in _categories_of(restriction) if c in proposed["categories"]]
    own = _significant(restriction)
    shared = [w for w in own if w in proposed["words"]]
    hit = bool(categories) or len(shared) >= 2 or (len(shared) >= 1 and len(shared) == len(own))
    return {"categories": categories, "shared": shared} if hit else None


def _citation(fact: dict[str, Any]) -> dict[str, Any]:
    sources = fact["provenance"]["sources"]
    src = sources[0] if sources else {}
    return {k: src[k] for k in ("document_id", "title", "page", "section", "quote", "ocr") if k in src}


def check_use_conflict(args: dict[str, Any]) -> dict[str, Any]:
    from .tools import _suggest  # the unknown-field suggester, shared with run_tool

    _, _, labels, order = _index()
    issues: list[dict[str, str]] = []
    for i, f in enumerate(args["facts"]):
        for x in validate_fact_full(f)["issues"]:
            issues.append({"path": f"facts.{i}" + (f".{x['path']}" if x["path"] else ""), "message": x["message"]})
    use = args["proposed_use"]
    text, category, naics = use["text"], use.get("category"), use.get("naics")
    if category is not None and category not in labels:
        near = _suggest(category, list(labels))
        issues.append({"path": "proposed_use.category",
                       "message": "unknown use category" + (f' (did you mean "{near}"?)' if near else "")
                                  + "; see spec/schemas/vocabularies/use-categories.json"})
    if issues:
        raise DocInputError(issues[:20])

    # The proposed use's categories: the one given, those under the NAICS code, and keyword hits.
    basis: dict[str, list[str]] = {}

    def add(cid: str, why: str) -> None:
        hits = basis.setdefault(cid, [])
        if why not in hits:
            hits.append(why)

    if category is not None:
        add(category, "category given")
    if naics is not None:
        for c in vocabulary()["categories"]:
            for code in c.get("naics", []):
                if code.startswith(naics) or naics.startswith(code):
                    add(c["id"], f"NAICS {code}")
    for cid, keywords in _categories_of(text).items():
        for k in keywords:
            add(cid, f'keyword "{k}"')
    proposed_categories = sorted(basis, key=lambda c: order[c])
    proposed = {"categories": set(proposed_categories), "words": _significant(text)}

    superseded = {x for f in args["facts"] for x in (f.get("supersedes") or [])}
    conflicts: list[dict[str, Any]] = []
    checked = {"exclusive_use": 0, "prohibited_uses": 0, "ignored": 0}

    def named(ids: list[str]) -> list[dict[str, Any]]:
        return [{"id": c, "label": labels[c]} for c in ids]

    for i, f in enumerate(args["facts"]):
        if "id" in f and f["id"] in superseded:
            checked["ignored"] += 1
            continue

        def base(restriction: str, restricted: str) -> dict[str, Any]:
            out: dict[str, Any] = {"status": "potential_conflict", "label": CONFLICT_LABEL, "restriction": restriction,
                                   "fact": i}
            if "id" in f:
                out["fact_id"] = f["id"]
            out["subject"] = f["subject"]
            out["restricted_use"] = restricted
            return out

        if f["predicate"] == "lease.exclusive_use":
            checked["exclusive_use"] += 1
            v = f["value"]
            restricted = v["protected_use"] if isinstance(v, dict) else v
            carve_outs = v["carve_outs"] if isinstance(v, dict) and isinstance(v.get("carve_outs"), list) else []
            m = _match(proposed, restricted)
            if not m:
                continue
            may_apply = [c for c in carve_outs if _match(proposed, c)]
            item = {**base("exclusive_use", restricted), "matched_categories": named(m["categories"]),
                    "shared_words": m["shared"]}
            if carve_outs:
                item["carve_outs"] = carve_outs
            if may_apply:
                item["carve_outs_that_may_apply"] = may_apply
            item["citation"] = _citation(f)
            conflicts.append(item)
        elif f["predicate"] == "lease.prohibited_uses":
            for restricted in f["value"]:
                checked["prohibited_uses"] += 1
                m = _match(proposed, restricted)
                if m:
                    conflicts.append({**base("prohibited_use", restricted), "matched_categories": named(m["categories"]),
                                      "shared_words": m["shared"], "citation": _citation(f)})
        else:
            checked["ignored"] += 1
    return {
        "proposed_use": {"text": text,
                         "categories": [{"id": c, "label": labels[c], "basis": basis[c]} for c in proposed_categories],
                         "words": proposed["words"]},
        "potential_conflicts": conflicts,
        "checked": checked,
        "summary": {"potential_conflicts": len(conflicts)},
        "note": USE_CONFLICT_NOTE,
    }
