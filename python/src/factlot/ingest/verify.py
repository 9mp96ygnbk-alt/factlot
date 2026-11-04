"""Deterministic checks on extracted candidates. No model output is accepted without them.

Three checks, in order: the value has the right shape for its predicate (``check_value``), the
quote appears verbatim on the cited page (``verify``), and the value follows from the quote
(``check_consistency``: every checkable number, date, and verbatim string in the value is
written in the quote in some common form).

The same rules run in TypeScript (packages/tools/src/quotes.ts) for the hosted document tools,
and spec/vectors/documents.json pins both. The patterns are ASCII-only (``re.ASCII``: ``\\d`` is
0-9, ``\\b`` is an ASCII word boundary), as in JavaScript, so both read the same digits.
"""

from __future__ import annotations

import json
import re
import unicodedata
from dataclasses import dataclass
from datetime import date
from decimal import Decimal, InvalidOperation
from typing import Any

from .._core import js_number_str
from .documents import LeaseDocument
from .extract import PREDICATES, Candidate

_DATE = re.compile(r"[0-9]{4}-[0-9]{2}-[0-9]{2}")
_DATE_PREDICATES = ("lease.commencement_date", "lease.expiration_date", "lease.renewal_notice_deadline",
                    "lease.termination_notice_deadline", "lease.rent_commencement_date",
                    "lease.expansion_option_deadline")
# A guarantor is a name. Anything that reads as a street address or a postal code is rejected, so a
# natural person's address never becomes a fact (the same rule the registry applies to owners).
_ADDRESS = re.compile(r"\b\d+[a-z]?\s+[\w.'-]+(\s+[\w.'-]+)*\s+(street|st|avenue|ave|road|rd|drive|dr|lane|ln|"
                      r"boulevard|blvd|court|ct|place|pl|way|terrace|ter|circle|cir|highway|hwy|parkway|pkwy|"
                      r"suite|ste|apt|apartment|unit|floor|fl)\b\.?|\b\d{5}(-\d{4})?\b|\bp\.?o\.? box\b", re.I | re.A)
_QUOTE_CHARS = str.maketrans({"‘": "'", "’": "'", "“": '"', "”": '"', "–": "-", "—": "-",
                              " ": " "})


def _norm(text: str) -> str:
    text = unicodedata.normalize("NFKC", text).translate(_QUOTE_CHARS)
    return re.sub(r"\s+", " ", text).strip().lower()


def _is_date(v: Any) -> bool:
    if not isinstance(v, str) or not _DATE.fullmatch(v):
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
    if predicate in _DATE_PREDICATES:
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
        if ok and not 0 < value["rate"] <= 1:
            return "rate must be a fraction in (0, 1], e.g. 0.05 for 5%"
        return None if ok else "expected {method, rate} with an explicit cap method"
    if predicate in ("lease.free_rent", "lease.renewal_option", "lease.termination_option"):
        return None if isinstance(value, dict) and value else "expected object"
    if predicate == "lease.percentage_rent":
        if not isinstance(value, dict) or not (_num(value.get("rate")) and 0 < value["rate"] <= 1):
            return "expected {rate, breakpoint} with rate in (0, 1]"
        bp = value.get("breakpoint")
        if not isinstance(bp, dict) or bp.get("type") not in ("natural", "fixed"):
            return "expected breakpoint {type: natural | fixed, amount?}"
        if bp["type"] == "fixed" and not (_num(bp.get("amount")) and bp["amount"] > 0):
            return "a fixed breakpoint needs a positive amount"
        if "amount" in bp and not (_num(bp["amount"]) and bp["amount"] > 0):
            return "breakpoint amount must be a positive number"
        if "sales_exclusions" in value and not (isinstance(value["sales_exclusions"], str)
                                                and value["sales_exclusions"].strip()):
            return "sales_exclusions must be a non-empty string"
        return None
    if predicate == "lease.co_tenancy":
        if not isinstance(value, dict) or not all(_text(value.get(k)) for k in ("trigger", "remedy")):
            return "expected {trigger, remedy} as non-empty strings"
        if "cure_period_months" in value and not (_num(value["cure_period_months"]) and value["cure_period_months"] > 0):
            return "cure_period_months must be a positive number"
        return None
    if predicate == "lease.operating_expense_base_year":
        # A whole number; 2026.0 counts, since JSON (and JavaScript) cannot tell it from 2026.
        ok = _num(value) and float(value).is_integer() and 1900 <= value <= 2200
        return None if ok else "expected a four-digit integer year"
    if predicate == "lease.parking":
        if not isinstance(value, dict) or not (_num(value.get("spaces")) and value["spaces"] > 0):
            return "expected {spaces, rate_monthly?} with a positive number of spaces"
        if "rate_monthly" in value and not (_num(value["rate_monthly"]) and value["rate_monthly"] >= 0):
            return "rate_monthly must be a non-negative number"
        return None
    if predicate == "lease.guaranty":
        if not isinstance(value, dict) or not _text(value.get("guarantor")):
            return "expected {guarantor, cap?} with the guarantor's name"
        if _ADDRESS.search(value["guarantor"]):
            return "guarantor must be a name, not an address"
        if "cap" in value and not (_num(value["cap"]) and value["cap"] > 0):
            return "cap must be a positive number"
        return None
    return None if _text(value) else "expected non-empty string"


def _text(v: Any) -> bool:
    return isinstance(v, str) and bool(v.strip())


# ---------------------------------------------------------------------------------------------
# Value–quote consistency
#
# Which parts of each predicate's value can be checked against the quote, and how:
#   "number"  the number is written in the quote (24.5, 24.50, $24.50, 24.50/SF, 1,250,000, or
#             as a word such as "twelve"); "ratio" additionally accepts the percentage form
#             (0.0325 vs 3.25% or 3.25 percent); "date" the calendar date is written in the quote
#             in a common form (2027-03-01, March 1, 2027, Mar. 1, 2027, 3/1/2027, 1 March 2027,
#             1st day of March, 2027, first day of March, 2027); "string" the text appears in the
#             quote case-insensitively.
# A list spec applies to each element; dict keys that are not listed (enums such as a cap
# method, free-text summaries such as a renewal rent) are not checked. Predicates not listed
# here (free-text summaries) are never rejected by this check.
_CONSISTENCY: dict[str, Any] = {
    "lease.commencement_date": "date",
    "lease.expiration_date": "date",
    "lease.rentable_area_sf": "number",
    "lease.security_deposit": "number",
    "lease.pro_rata_share": "ratio",
    "lease.base_rent_schedule": [{"from": "date", "to": "date", "annual_rent_psf": "number"}],
    "lease.free_rent": {"months": "number"},
    "lease.cam_cap": {"rate": "ratio"},
    "lease.renewal_option": {"count": "number", "term_months": "number", "notice_months": "number"},
    "lease.termination_option": {"effective_date": "date", "notice_months": "number"},
    "lease.landlord": "string",
    "lease.tenant": "string",
    "lease.percentage_rent": {"rate": "ratio", "breakpoint": {"amount": "number"}},
    "lease.co_tenancy": {"cure_period_months": "number"},
    "lease.renewal_notice_deadline": "date",
    "lease.termination_notice_deadline": "date",
    "lease.rent_commencement_date": "date",
    "lease.expansion_option_deadline": "date",
    "lease.operating_expense_base_year": "number",
    "lease.parking": {"spaces": "number", "rate_monthly": "number"},
    "lease.guaranty": {"guarantor": "string", "cap": "number"},
}

_MONTHS = {m: i for i, m in enumerate(("january", "february", "march", "april", "may", "june", "july", "august",
                                       "september", "october", "november", "december"), start=1)}
_MONTHS.update({m[:3]: i for m, i in list(_MONTHS.items())})
_MONTHS["sept"] = 9
_MONTH_RE = "|".join(sorted(_MONTHS, key=len, reverse=True))
_UNITS = ("zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve",
          "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen")
_TENS = {"twenty": 20, "thirty": 30, "forty": 40, "fifty": 50, "sixty": 60, "seventy": 70, "eighty": 80,
         "ninety": 90}
_ORDINALS = {"first": 1, "second": 2, "third": 3, "fourth": 4, "fifth": 5, "sixth": 6, "seventh": 7, "eighth": 8,
             "ninth": 9, "tenth": 10, "eleventh": 11, "twelfth": 12, "thirteenth": 13, "fourteenth": 14,
             "fifteenth": 15, "sixteenth": 16, "seventeenth": 17, "eighteenth": 18, "nineteenth": 19,
             "twentieth": 20, "thirtieth": 30}
_NUMBER_TOKEN = re.compile(r"(?<![\d.])(\d[\d,]*(?:\.\d+)?|\.\d+)", re.A)
_TENS_RE = "|".join(_TENS)
_UNITS_RE = "|".join(_UNITS)
_NUMBER_WORD = re.compile(rf"\b(?:({_TENS_RE})(?:[ -]({_UNITS_RE}))?|({_UNITS_RE}))\b", re.A)
_ORDINAL_RE = "|".join(sorted(_ORDINALS, key=len, reverse=True))
_DATE_PATTERNS = (
    # 2027-03-01, 2027/03/01
    (re.compile(r"\b(\d{4})[-/](\d{1,2})[-/](\d{1,2})\b", re.A), lambda m: [(m[1], m[2], m[3])]),
    # 3/1/2027, 03-01-2027, 1.3.2027 (read both month-first and day-first)
    (re.compile(r"\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})\b", re.A), lambda m: [(m[3], m[1], m[2]), (m[3], m[2], m[1])]),
    # March 1, 2027; Mar. 1st 2027
    (re.compile(rf"\b({_MONTH_RE})\.? (\d{{1,2}})(?:st|nd|rd|th)?,? (\d{{4}})\b", re.A),
     lambda m: [(m[3], _MONTHS[m[1]], m[2])]),
    # 1 March 2027; 1st day of March, 2027
    (re.compile(rf"\b(\d{{1,2}})(?:st|nd|rd|th)? (?:day of )?({_MONTH_RE})\.?,? (\d{{4}})\b", re.A),
     lambda m: [(m[3], _MONTHS[m[2]], m[1])]),
    # first day of March, 2027; twenty-eighth day of February, 2031
    (re.compile(rf"\b(?:({_TENS_RE})[ -])?({_ORDINAL_RE}) day of ({_MONTH_RE})\.?,? (\d{{4}})\b", re.A),
     lambda m: [(m[4], _MONTHS[m[3]], (_TENS[m[1]] if m[1] else 0) + _ORDINALS[m[2]])]),
)


def _decimal(v: Any) -> Decimal | None:
    try:
        return Decimal(repr(v)) if isinstance(v, float) else Decimal(v)
    except (InvalidOperation, TypeError, ValueError):
        return None


def _numbers_in(quote: str) -> set[Decimal]:
    """Every number written in the (normalized) quote, in digits or as a word up to ninety-nine."""
    found: set[Decimal] = set()
    for token in _NUMBER_TOKEN.findall(quote):
        d = _decimal(token.replace(",", "").rstrip("."))
        if d is not None:
            found.add(d)
    for tens, unit, lone in _NUMBER_WORD.findall(quote):
        if lone:
            found.add(Decimal(_UNITS.index(lone)))
        else:
            found.add(Decimal(_TENS[tens] + (_UNITS.index(unit) if unit else 0)))
    return found


def _dates_in(quote: str) -> set[tuple[int, int, int]]:
    """Every calendar date written in the (normalized) quote, as (year, month, day)."""
    found: set[tuple[int, int, int]] = set()
    for pattern, read in _DATE_PATTERNS:
        for m in pattern.finditer(quote):
            for y, mo, d in read(m):
                try:
                    found.add((date(int(y), int(mo), int(d)).year, int(mo), int(d)))
                except ValueError:
                    continue
    return found


def _missing(kind: str, value: Any, quote: str) -> bool:
    """True when ``value`` of the given kind cannot be found in the normalized quote."""
    if kind == "string":
        return not (isinstance(value, str) and _norm(value) and _norm(value) in quote)
    if kind == "date":
        if not _is_date(value):
            return False  # not checkable; the shape check reports malformed dates
        d = date.fromisoformat(value)
        return (d.year, d.month, d.day) not in _dates_in(quote)
    if kind in ("number", "ratio"):
        if not _num(value):
            return False
        wanted = _decimal(value)
        numbers = _numbers_in(quote)
        if wanted in numbers:
            return False
        if kind == "ratio" and ("%" in quote or "percent" in quote) and wanted * 100 in numbers:
            return False
        return True
    return False


def show_value(value: Any) -> str:
    """A value as it appears in a reason: JSON, with numbers written as JavaScript writes them."""
    if _num(value):
        return js_number_str(value)
    return json.dumps(value, ensure_ascii=False)


def _walk(spec: Any, value: Any, quote: str, path: str) -> str | None:
    if isinstance(spec, str):
        if _missing(spec, value, quote):
            where = f" ({path})" if path else ""
            return f"value {show_value(value)}{where} not found in quote"
        return None
    if isinstance(spec, list):
        if not isinstance(value, list):
            return None
        for item in value:
            reason = _walk(spec[0], item, quote, path)
            if reason:
                return reason
        return None
    if isinstance(spec, dict):
        if not isinstance(value, dict):
            return None
        for key, sub in spec.items():
            if key in value:
                reason = _walk(sub, value[key], quote, f"{path}.{key}" if path else key)
                if reason:
                    return reason
    return None


def check_consistency(predicate: str, value: Any, quote: str) -> str | None:
    """Return a reason the value does not follow from the quote, or None if it does (or cannot be checked).

    Conservative by design: only numbers, ratios, dates, and verbatim strings listed in
    ``_CONSISTENCY`` are checked, in the written forms described there. Anything else (enums,
    free-text summaries, unknown predicates) passes.
    """
    spec = _CONSISTENCY.get(predicate)
    if spec is None:
        return None
    return _walk(spec, value, _norm(quote), "")


# Names of the checks, in the order ``verify`` runs them. A verdict names the one that failed.
CHECK_VALUE, CHECK_QUOTE, CHECK_CONSISTENCY = "value", "quote", "consistency"


@dataclass
class Verdict:
    candidate: Candidate
    accepted: bool
    page: int | None  # page the quote was found on (may differ from the candidate's claim)
    reason: str | None = None
    page_corrected: bool = False
    check: str | None = None  # the check that failed: "value", "quote", or "consistency"


def verify(doc: LeaseDocument, c: Candidate, min_quote_chars: int = 12) -> Verdict:
    """Accept a candidate only if its quote appears verbatim (modulo whitespace/typography) in the
    document and its value follows from the quote (``check_consistency``).

    A rejected verdict names the failing check. A consistency failure still reports the page
    the quote was found on, since the quote itself verified; the review queue uses that."""
    shape = check_value(c.predicate, c.value)
    if shape:
        return Verdict(c, False, None, shape, check=CHECK_VALUE)
    quote = _norm(c.quote)
    if len(quote) < min_quote_chars:
        return Verdict(c, False, None, f"quote shorter than {min_quote_chars} characters", check=CHECK_QUOTE)
    claimed = doc.page(c.page)
    if claimed and quote in _norm(claimed.text):
        page, corrected = c.page, False
    else:
        hits = [p.number for p in doc.pages if quote in _norm(p.text)]
        if len(hits) > 1:
            return Verdict(c, False, None, f"quote appears on several pages {hits}; cannot cite a single page",
                           check=CHECK_QUOTE)
        if not hits:
            return Verdict(c, False, None, "quote not found in the document", check=CHECK_QUOTE)
        page, corrected = hits[0], True
    mismatch = check_consistency(c.predicate, c.value, c.quote)
    if mismatch:
        return Verdict(c, False, page, mismatch, page_corrected=corrected, check=CHECK_CONSISTENCY)
    if corrected:
        return Verdict(c, True, page, f"quote found on page {page}, not {c.page}", page_corrected=True)
    return Verdict(c, True, page)
