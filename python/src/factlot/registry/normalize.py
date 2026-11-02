"""Name, address, and property-class normalization for the registry."""

from __future__ import annotations

import re

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

    Appraisal districts subdivide the Comptroller's categories: Harris codes multifamily as
    B1–B4 (apartments, duplex, triplex, fourplex), all of which are category B.
    """
    code = (state_category or "").strip().upper()
    return code in COMMERCIAL_CATEGORIES or (code[:1] == "B" and code[1:].isdigit())
