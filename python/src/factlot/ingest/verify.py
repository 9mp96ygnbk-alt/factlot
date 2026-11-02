"""Deterministic checks on extracted candidates. No model output is accepted without them."""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass
from datetime import date
from typing import Any

from .documents import LeaseDocument
from .extract import PREDICATES, Candidate

_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_QUOTE_CHARS = str.maketrans({"‘": "'", "’": "'", "“": '"', "”": '"', "–": "-", "—": "-",
                              " ": " "})


def _norm(text: str) -> str:
    text = unicodedata.normalize("NFKC", text).translate(_QUOTE_CHARS)
    return re.sub(r"\s+", " ", text).strip().lower()


def _is_date(v: Any) -> bool:
    if not isinstance(v, str) or not _DATE.match(v):
        return False
    try:
        date.fromisoformat(v)
        return True
    except ValueError:
        return False


def _num(v: Any) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def check_value(predicate: str, value: Any) -> str | None:
    """Return a reason the value has the wrong shape, or None if it is acceptable."""
    if predicate not in PREDICATES:
        return f"unknown predicate {predicate}"
    if predicate in ("lease.commencement_date", "lease.expiration_date"):
        return None if _is_date(value) else "expected YYYY-MM-DD date"
    if predicate in ("lease.rentable_area_sf", "lease.security_deposit"):
        return None if _num(value) and value > 0 else "expected positive number"
    if predicate == "lease.pro_rata_share":
        return None if _num(value) and 0 < value <= 1 else "expected number in (0, 1]"
    if predicate == "lease.base_rent_schedule":
        if not isinstance(value, list) or not value:
            return "expected non-empty array of rent steps"
        for step in value:
            if not (isinstance(step, dict) and _is_date(step.get("from")) and _is_date(step.get("to"))
                    and _num(step.get("annual_rent_psf"))):
                return "each rent step needs from, to (YYYY-MM-DD) and annual_rent_psf"
            if step["from"] > step["to"]:
                return "rent step ends before it starts"
        return None
    if predicate == "lease.cam_cap":
        ok = isinstance(value, dict) and value.get("method") in ("compounding_from_base", "simple_from_base",
                                                                  "year_over_year") and _num(value.get("rate"))
        return None if ok else "expected {method, rate} with an explicit cap method"
    if predicate in ("lease.free_rent", "lease.renewal_option", "lease.termination_option"):
        return None if isinstance(value, dict) and value else "expected object"
    return None if isinstance(value, str) and value.strip() else "expected non-empty string"


@dataclass
class Verdict:
    candidate: Candidate
    accepted: bool
    page: int | None  # verified page (may differ from the candidate's claim)
    reason: str | None = None
    page_corrected: bool = False


def verify(doc: LeaseDocument, c: Candidate, min_quote_chars: int = 12) -> Verdict:
    """Accept a candidate only if its quote appears verbatim (modulo whitespace/typography) in the document."""
    shape = check_value(c.predicate, c.value)
    if shape:
        return Verdict(c, False, None, shape)
    quote = _norm(c.quote)
    if len(quote) < min_quote_chars:
        return Verdict(c, False, None, f"quote shorter than {min_quote_chars} characters")
    claimed = doc.page(c.page)
    if claimed and quote in _norm(claimed.text):
        return Verdict(c, True, c.page)
    hits = [p.number for p in doc.pages if quote in _norm(p.text)]
    if len(hits) == 1:
        return Verdict(c, True, hits[0], f"quote found on page {hits[0]}, not {c.page}", page_corrected=True)
    if len(hits) > 1:
        return Verdict(c, False, None, f"quote appears on several pages {hits}; cannot cite a single page")
    return Verdict(c, False, None, "quote not found in the document")
