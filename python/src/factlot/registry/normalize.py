"""Name, address, and property-class normalization for the registry, plus name similarity."""

from __future__ import annotations

import re
from difflib import SequenceMatcher

# Texas State Property Tax Code categories kept by default (data policy §3):
# B multifamily, F1 commercial real property, F2 industrial/manufacturing real property.
COMMERCIAL_CATEGORIES = frozenset({"B", "F1", "F2"})

_SUFFIXES = [
    (r"\bLIMITED LIABILITY COMPANY\b", "LLC"),
    (r"\bL L C\b", "LLC"),
    (r"\bLIMITED LIABILITY PARTNERSHIP\b", "LLP"),
    (r"\bL L P\b", "LLP"),
    (r"\bLIMITED PARTNERSHIP\b", "LP"),
    (r"\bL P\b", "LP"),
    (r"\bINCORPORATED\b", "INC"),
    (r"\bCORPORATION\b", "CORP"),
    (r"\bCOMPANY\b", "CO"),
    (r"\bLIMITED\b", "LTD"),
]

# Tokens that mark an organisation rather than a natural person.
_ENTITY_TOKENS = re.compile(
    r"\b(LLC|LLP|LP|INC|CORP|CO|LTD|PLLC|PC|PARTNERS|PARTNERSHIP|PROPERTIES|PROPERTY|HOLDINGS|"
    r"REALTY|INVESTMENTS?|FUND|CAPITAL|VENTURES?|ASSOCIATES|GROUP|BANK|CHURCH|ASSOCIATION|"
    r"FOUNDATION|DISTRICT|AUTHORITY|ISD|COUNTY|CITY|STATE|UNIVERSITY|HOSPITAL|REIT|"
    r"REAL ESTATE INVESTMENT TRUST)\b"
)


def normalize_name(name: str) -> str:
    """Comparable key for an organisation name: 'Acme Properties, L.L.C.' -> 'ACME PROPERTIES LLC'."""
    s = name.upper().replace("&", " AND ")
    s = re.sub(r"[^A-Z0-9 ]+", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    for pattern, repl in _SUFFIXES:
        s = re.sub(pattern, repl, s)
    s = re.sub(r"^THE ", "", s)
    return re.sub(r"\s+", " ", s).strip()


def is_organization(name: str) -> bool:
    """Conservative: anything not clearly an organisation is treated as a natural person.

    Family and personal trusts ("SMITH FAMILY TRUST") are treated as persons; real estate
    investment trusts are organisations.
    """
    return bool(_ENTITY_TOKENS.search(normalize_name(name)))


# --- name similarity (fuzzy owner matching, backlog C2) ---------------------------------------

# Tokens too common in organisation names to identify one: entity-type suffixes and generic
# real-estate words. They are dropped from the token index and from the token-overlap score,
# but they still take part in the character-level ratio, so "PROPERTIES" vs "PROPERTY" costs a little.
NAME_STOP_TOKENS = frozenset(
    "LLC LP LLP LLLP INC CORP CO LTD PLLC PC PA NA AND OF THE A DBA ETAL ET AL TR TRUST TRUSTEE TRUSTEES "
    "PROPERTIES PROPERTY HOLDINGS HOLDING INVESTMENTS INVESTMENT PARTNERS PARTNERSHIP GROUP REALTY REAL "
    "ESTATE DEVELOPMENT MANAGEMENT ENTERPRISES ENTERPRISE VENTURES VENTURE CAPITAL ASSOCIATES ASSOCIATION "
    "FUND EQUITIES EQUITY LAND HOMES APARTMENTS APARTMENT CENTER PLAZA PARK INTERNATIONAL SERVICES SERVICE "
    "TX TEXAS USA US AMERICA AMERICAN NATIONAL FAMILY".split()
)

# How the fuzzy score is built; recorded with every candidate so a reviewer knows what 0.91 means.
NAME_MATCH_RULE = "fuzzy_name_v1"
NAME_RATIO_WEIGHT = 0.7
NAME_OVERLAP_WEIGHT = 0.3
_TOKEN_ALIKE_RATIO = 0.8


def distinctive_tokens(key: str) -> list[str]:
    """Tokens of a normalized name that can identify it, in order, without duplicates.

    ``distinctive_tokens("ACME PROPERTIES LLC") == ["ACME"]``. Names made only of stop tokens
    (``"TEXAS PROPERTIES LLC"``) have none, so they are never fuzzy-matched.
    """
    out: list[str] = []
    for t in key.split():
        if t not in NAME_STOP_TOKENS and t not in out:
            out.append(t)
    return out


def _tokens_alike(a: str, b: str) -> bool:
    """Equal, or (for tokens of four or more characters) a near-equal spelling: OFFICE / OFICE."""
    if a == b:
        return True
    if len(a) < 4 or len(b) < 4:
        return False
    return SequenceMatcher(None, a, b, autojunk=False).ratio() >= _TOKEN_ALIKE_RATIO


def name_similarity(key_a: str, key_b: str) -> dict:
    """Deterministic similarity of two normalized names, in [0, 1], with its reasons.

    ``score = 0.7 * ratio + 0.3 * token_overlap`` where

    - ``ratio`` is ``difflib.SequenceMatcher`` over the two names with their tokens sorted, so a
      transposed word costs nothing and a typo or a singular/plural drift costs a little;
    - ``token_overlap`` is the Jaccard overlap of the distinctive tokens (stop tokens removed),
      counting near-equal spellings as the same token. It is what separates "ACME PROPERTIES LLC"
      from "ACME PROPERTIES II LLC" (0.80) while leaving "ACME PROPERTY LLC" (0.92) a candidate.

    Standard library only; the same inputs always give the same score.
    """
    tokens_a, tokens_b = key_a.split(), key_b.split()
    dist_a = distinctive_tokens(key_a) or tokens_a
    dist_b = distinctive_tokens(key_b) or tokens_b
    used: set[int] = set()
    shared: list[str] = []
    for t in dist_a:
        for j, u in enumerate(dist_b):
            if j not in used and _tokens_alike(t, u):
                used.add(j)
                shared.append(t)
                break
    union = len(dist_a) + len(dist_b) - len(shared)
    overlap = len(shared) / union if union else 0.0
    ratio = SequenceMatcher(None, " ".join(sorted(tokens_a)), " ".join(sorted(tokens_b)), autojunk=False).ratio()
    return {
        "score": round(NAME_RATIO_WEIGHT * ratio + NAME_OVERLAP_WEIGHT * overlap, 4),
        "ratio": round(ratio, 4),
        "token_overlap": round(overlap, 4),
        "shared_tokens": shared,
        "rule": NAME_MATCH_RULE,
    }


_STREET = {
    "STREET": "ST", "AVENUE": "AVE", "ROAD": "RD", "DRIVE": "DR", "BOULEVARD": "BLVD",
    "LANE": "LN", "PARKWAY": "PKWY", "HIGHWAY": "HWY", "FREEWAY": "FWY", "COURT": "CT",
    "PLACE": "PL", "CIRCLE": "CIR", "TRAIL": "TRL", "SUITE": "STE", "NORTH": "N",
    "SOUTH": "S", "EAST": "E", "WEST": "W", "EXPRESSWAY": "EXPY",
}


def normalize_address(address: str) -> str:
    """Comparable key for a street address: '1200 Main Street, Suite 400' -> '1200 MAIN ST STE 400'."""
    s = re.sub(r"[^A-Z0-9 ]+", " ", address.upper())
    words = [_STREET.get(w, w) for w in s.split()]
    return " ".join(words)


def is_commercial(state_category: str | None) -> bool:
    """True for Texas state property categories in the registry's commercial scope.

    Appraisal districts subdivide the Comptroller's categories with extra digits: Harris codes
    multifamily B1–B4, Dallas codes F10, F20, B11, and B12. The letter and first digit decide;
    every subclass of category B is multifamily.
    """
    m = re.fullmatch(r"([A-Z])(\d*)", (state_category or "").strip().upper())
    if not m:
        return False
    letter, digits = m.groups()
    return letter == "B" or f"{letter}{digits[:1]}" in COMMERCIAL_CATEGORIES
