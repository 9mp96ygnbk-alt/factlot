"""The lease predicate catalog (``doc_predicates``): each Ingest predicate's value shape as JSON
Schema, a valid example with a quote that states it, and which parts of the value are checked
against the quote and how.

The catalog is generated from the TypeScript tables the checks use (packages/tools/src/predicates.ts)
into ``schemas/predicates.json``, and this module serves that file as is, so both SDKs return the
same catalog. python/tests/test_predicates.py checks that it agrees with this SDK's own checks: every
predicate in ``factlot.ingest.verify`` is listed, and every example gets the outcome the catalog states.
"""

from __future__ import annotations

import copy
import json
import re
from functools import lru_cache
from importlib import resources
from typing import Any

from .docverify import DocInputError
from .ingest.extract import PREDICATES

_PREDICATE = re.compile(r"[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+")


@lru_cache(maxsize=None)
def catalog() -> dict[str, Any]:
    """spec/schemas/predicates.json: ``notes`` and ``predicates``."""
    data = json.loads(resources.files("factlot").joinpath("schemas/predicates.json").read_text("utf-8"))
    return {"notes": data["notes"], "predicates": data["predicates"]}


def doc_predicates(args: dict[str, Any]) -> dict[str, Any]:
    if "predicate" in args and "prefix" in args:
        raise DocInputError([{"path": "", "message": "give predicate or prefix, not both"}])
    cat = catalog()
    if "predicate" in args:
        picked = [p for p in cat["predicates"] if p["predicate"] == args["predicate"]]
    elif "prefix" in args:
        picked = [p for p in cat["predicates"] if p["predicate"].startswith(args["prefix"])]
    else:
        picked = list(cat["predicates"])
    out: dict[str, Any] = {"notes": copy.deepcopy(cat["notes"]), "predicates": copy.deepcopy(picked)}
    if "predicate" in args and not picked:
        from .tools import _suggest  # the unknown-field suggester, shared with run_tool

        p = args["predicate"]
        near = _suggest(p, list(PREDICATES))
        hint = f" (did you mean {near}?)" if near else ""
        out["note"] = (f"{p} is not an Ingest predicate{hint}; doc_verify_facts checks it with the generic rules in "
                       "notes.generic") if _PREDICATE.fullmatch(p) else f"{p} is not a dotted lower_snake predicate{hint}"
    return out
