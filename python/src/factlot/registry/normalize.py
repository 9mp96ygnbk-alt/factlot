"""Name, address, and property-class normalization for the registry, plus name similarity."""

from __future__ import annotations

import re
from difflib import SequenceMatcher

from ..ids import address_tokens

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

# Tokens that mark an organisation rather than a natural person. "CO" followed by a fiduciary or
# ownership role is a person's role ("SMITH JOHN CO-TRUSTEE", "DOE JANE CO TRS"), not "Company".
_ENTITY_TOKENS = re.compile(
    r"\b(LLC|LLP|LP|INC|CORP|CO(?! (?:TRUSTEES?|TRS?|TTEES?|OWNERS?|TENANTS?|EXECUTORS?|EXRS?|"
    r"EXECUTRIX|ADMINISTRATORS?|ADMRS?|PERSONAL REPRESENTATIVES?)\b)|LTD|PLLC|PC|PARTNERS|PARTNERSHIP|PROPERTIES|PROPERTY|HOLDINGS|"
    r"REALTY|INVESTMENTS?|FUND|CAPITAL|VENTURES?|ASSOCIATES|GROUP|BANK|CHURCH|ASSOCIATION|"
    r"FOUNDATION|DISTRICT|AUTHORITY|ISD|COUNTY|CITY|STATE|UNIVERSITY|HOSPITAL|REIT|"
    r"REAL ESTATE INVESTMENT TRUST)\b"
)


# Apostrophes are dropped, not turned into spaces: rolls write "OREILLY" and "CHILDRENS" where the
# registration says "O'REILLY" and "CHILDREN'S".
_APOSTROPHES = re.compile("['\u2018\u2019`\u00b4]")

# What follows the owner on a roll but is not part of the owner's name: a "doing business as" trade
# name, "ET AL" (other co-owners are listed elsewhere), and a connector left dangling when the
# publisher truncated the line ("ACME HOLDINGS LLC &", "SMITH FAMILY LP THE").
_NAME_TAIL = re.compile(r"\s(?:DBA|D B A|ET AL|ETAL|ET UX|ETUX|ET VIR|ETVIR)\b.*$")
_DANGLING = re.compile(r"\s(?:AND|THE)$")
# "NO 1" and "1" name the same series entity.
_NUMBER_WORD = re.compile(r"\b(?:NO|NUMBER)\s+(?=\d)")

# One spelling per abbreviation that publishers use inconsistently, applied to whole tokens on both
# sides of a comparison (so the choice of spelling does not matter, only that it is single). Words
# whose abbreviation is ambiguous (ASSOC: associates or association; INV: investment or
# investments) and words that are also initials (directions) are left alone.
NAME_TOKEN_CANON = {
    "PPTY": "PROPERTY", "PPTIES": "PROPERTIES", "PPRTIES": "PROPERTIES", "PPTYS": "PROPERTIES",
    "CTR": "CENTER", "CTRS": "CENTERS", "PTNR": "PARTNER", "PTNRS": "PARTNERS", "PRTNRS": "PARTNERS",
    "PTNRSHP": "PARTNERSHIP", "PTNRSHIP": "PARTNERSHIP", "PRTNRSHP": "PARTNERSHIP", "APTS": "APARTMENTS",
    "MGMT": "MANAGEMENT", "MGT": "MANAGEMENT", "DEVEL": "DEVELOPMENT", "BLDG": "BUILDING",
    "BLDGS": "BUILDINGS", "INTL": "INTERNATIONAL", "HLDGS": "HOLDINGS", "HLDG": "HOLDING", "RLTY": "REALTY",
    # street types, to the short form addresses use ("123 MAIN STREET LLC" is "123 MAIN ST LLC")
    "STREET": "ST", "AVENUE": "AVE", "ROAD": "RD", "DRIVE": "DR", "BOULEVARD": "BLVD", "PARKWAY": "PKWY",
    "HIGHWAY": "HWY",
}


def _canonical_tokens(s: str) -> str:
    return " ".join(NAME_TOKEN_CANON.get(t, t) for t in s.split())


def _join_initials(s: str) -> str:
    """Run together consecutive single letters: ``W G G PROPERTIES`` (from ``W.G.G.``) is ``WGG PROPERTIES``."""
    out: list[str] = []
    run = ""
    for t in s.split():
        if len(t) == 1 and "A" <= t <= "Z":
            run += t
            continue
        if run:
            out.append(run)
            run = ""
        out.append(t)
    if run:
        out.append(run)
    return " ".join(out)


def normalize_name(name: str) -> str:
    """Comparable key for an organisation name: 'Acme Properties, L.L.C.' -> 'ACME PROPERTIES LLC'.

    Besides case, punctuation and entity-type suffixes (LLC, LP, INC, ...), the key drops what a
    roll appends to an owner ("ET AL", a "DBA" trade name, a dangling "&" or "THE"), removes
    apostrophes, reads "NO 1" as "1", runs consecutive initials together ("W.G.G." and "WGG"), and
    spells common abbreviations one way (``NAME_TOKEN_CANON``).
    The TypeScript mirror (``normalizeName`` in packages/tools) must agree; ``spec/registry/normalize.json``
    holds the shared vectors.
    """
    s = _APOSTROPHES.sub("", name.upper()).replace("&", " AND ")
    s = re.sub(r"[^A-Z0-9 ]+", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    for pattern, repl in _SUFFIXES:
        s = re.sub(pattern, repl, s)
    s = re.sub(r"^THE ", "", s)
    if (tail := _NAME_TAIL.sub("", s)):  # never reduce a name to nothing
        s = tail
    while (trimmed := _DANGLING.sub("", s)) != s and trimmed:
        s = trimmed
    s = _NUMBER_WORD.sub("", s)
    return _canonical_tokens(_join_initials(re.sub(r"\s+", " ", s).strip()))


# A "doing business as" marker (DBA, D/B/A, D.B.A.): what follows it is a trade name.
_DBA = re.compile(r"\bD\s*[/.]?\s*B\s*[/.]?\s*A\b")
# "L.P." written with a dot is a partnership; bare spaced "L P" is usually a person's initials.
_DOTTED_LP = re.compile(r"\bL\s*\.\s*P\b")


# Words that mark a spaced "L P" as a partnership rather than a person's two middle initials when
# the name has no number ("BROAD PLAZA L P"). Only words a surname is unlikely to be belong here.
_LP_CONTEXT = frozenset(
    "PLAZA CENTER CENTERS TOWER TOWERS ENTERPRISES ENTERPRISE ASSOC ASSOCS ASSOCIATES INVESTORS INTERESTS "
    "APARTMENTS APARTMENT APTS APT STREET ST AVENUE AVE ROAD RD VILLAGE COMMONS TERRACE GARDENS MANOR HOUSING "
    "SENIORS OPERATING OPERATIONS MANAGEMENT DEVELOPMENT ACQUISITIONS ACQUISITION MEDICAL OFFICE BUILDING "
    "BUILDINGS TELEVISION VIDEO PIPELINE LANDFILL STABLES MARINA HOMES TOWNHOMES CAPITAL RESIDENCE HOTEL "
    "RETAIL INDUSTRIAL WAREHOUSE STORAGE PARKING".split()
)
_SPACED_LP = re.compile(r"\bL P\b")


# A trust named for a person ("DOE JANE SEPARATE PROPERTY TRUST", "SMITH JOHN A REVOCABLE REALTY") is that
# person's holding, and the words PROPERTY and REALTY in it do not make it a business. Without a word
# that makes the owner a company (below), such a name is read as a person.
_PERSONAL_TRUST = re.compile(
    r"\b(?:SEPARATE PROPERTY|COMMUNITY PROPERTY|REVOCABLE|IRREVOCABLE|LIVING TRUST|LIFE ESTATE|ESTATE OF|HEIRS|"
    r"DECEASED|TESTAMENTARY|BYPASS TRUST|SURVIVORS? TRUST)\b")
_COMPANY_WORD = re.compile(
    r"\b(?:LLC|LLP|LP|INC|CORP|LTD|PLLC|PC|BANK|CHURCH|FUND|ASSOCIATION|FOUNDATION|REIT|COMPANY|PARTNERSHIP|"
    r"PARTNERS|VENTURES?|CAPITAL|GROUP)\b")


def _spaced_lp_is_partnership(s: str) -> bool:
    """Whether the last bare ``L P`` in a cleaned name is "L.P." written without dots.

    A person's roll entry can end in two middle initials ("GARCIA MARIA L P", "LOPEZ MARIA ELENA L P"),
    so the name is read as a partnership only on evidence: a number ("400 NUECES L P") or a word
    that names a property or a business ("BROAD PLAZA L P"). A name with neither ("GSGB L P") stays
    unread, which loses a partnership's owner name but never stores a person's.
    """
    matches = list(_SPACED_LP.finditer(s))
    if not matches:
        return False
    head = s[: matches[-1].start()].split()
    if not head:
        return False
    if any(any(c.isdigit() for c in t) for t in head):
        return True
    return any(t in _LP_CONTEXT for t in head)


def is_organization(name: str) -> bool:
    """Conservative: anything not clearly an organisation is treated as a natural person.

    Family and personal trusts ("SMITH FAMILY TRUST") are treated as persons; real estate
    investment trusts are organisations. Only the part before a "DBA" counts, since a sole
    proprietor's trade name ("JOHN SMITH DBA SMITH PROPERTIES") does not make them an
    organisation. An apostrophe separates words here ("OWNERS'CORP" ends in CORP), unlike in
    ``normalize_name``, where it is dropped. "L.P." with a dot, "LP", and "Limited Partnership" are partnerships. A bare spaced
    "L P" is a partnership only with evidence (``_spaced_lp_is_partnership``), because it is also
    how a roll writes a person's initials ("GARCIA MARIA L P").
    """
    raw = _DBA.split(name.upper().replace("&", " AND "), maxsplit=1)[0]
    s = re.sub(r"\s+", " ", re.sub(r"[^A-Z0-9 ]+", " ", raw)).strip()
    spaced_lp = bool(_SPACED_LP.search(s)) and not _DOTTED_LP.search(raw) and _spaced_lp_is_partnership(s)
    for pattern, repl in _SUFFIXES:
        if pattern == r"\bL P\b" and not (_DOTTED_LP.search(raw) or spaced_lp):
            continue
        s = re.sub(pattern, repl, s)
    s = _canonical_tokens(s)
    if _PERSONAL_TRUST.search(s) and not _COMPANY_WORD.search(s):
        return False
    return bool(_ENTITY_TOKENS.search(s))


def legacy_name_key(name: str) -> str:
    """The key ``normalize_name`` made before 2026-11-03 (name key version 1).

    Kept so a registry built under it can be re-keyed in place (``Registry.rebuild_name_index``):
    a stored key is rewritten only if it is this function's output for the entity's current name.
    """
    s = name.upper().replace("&", " AND ")
    s = re.sub(r"[^A-Z0-9 ]+", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    for pattern, repl in _SUFFIXES:
        s = re.sub(pattern, repl, s)
    s = re.sub(r"^THE ", "", s)
    return re.sub(r"\s+", " ", s).strip()


NAME_KEY_VERSION = "2"


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


# Address search keys. Version 2 (2026-11-03) reads directionals and drops a unit, suite, "#" or
# floor designator with its value (``address_tokens`` in factlot.ids, shared with building IDs);
# a file built before keeps version 1 keys until ``Registry.rebuild_address_index`` re-keys it.
ADDRESS_KEY_VERSION = "2"

_STREET = {
    "STREET": "ST", "AVENUE": "AVE", "ROAD": "RD", "DRIVE": "DR", "BOULEVARD": "BLVD",
    "LANE": "LN", "PARKWAY": "PKWY", "HIGHWAY": "HWY", "FREEWAY": "FWY", "COURT": "CT",
    "PLACE": "PL", "CIRCLE": "CIR", "TRAIL": "TRL", "SUITE": "STE", "NORTH": "N",
    "SOUTH": "S", "EAST": "E", "WEST": "W", "EXPRESSWAY": "EXPY",
}


def normalize_address(address: str) -> str:
    """Comparable key for a street address: '1200 Main Street NW, Suite 400' -> '1200 MAIN ST NW'.

    "Northwest", "North West" and "N.W." are "NW" (all eight directionals, before or after the
    street); a unit, suite, apartment, "#" or floor designator and its value are dropped. The
    TypeScript mirror (``normalizeAddress`` in packages/tools) must agree; ``spec/registry/normalize.json``
    holds the shared vectors.
    """
    return " ".join(address_tokens(address))


def legacy_address_key(address: str) -> str:
    """The key ``normalize_address`` made before 2026-11-03 (address key version 1)."""
    s = re.sub(r"[^A-Z0-9 ]+", " ", address.upper())
    return " ".join(_STREET.get(w, w) for w in s.split())


# --- building roll-up: the street line and ZIP code of a situs address --------------------------

# Street types that end a street name, for situs lines written without a comma before the city.
_STREET_TYPES = frozenset("ST AVE RD DR BLVD LN PKWY HWY FWY EXPY CT PL CIR TRL TER SQ PLZ ALY WAY".split())
_DIRECTIONALS = frozenset("N S E W NE NW SE SW".split())
_ZIP_AFTER_COMMA = re.compile(r"\b([0-9]{5})(?:[- ]?[0-9]{1,4})?\s*$")
_STATE_ZIP_TAIL = re.compile(r"\s([A-Z]{2})\s+([0-9]{5}(?:[- ]?[0-9]{1,4})?|[0-9]{1,4})\s*$")


def situs_street_and_zip(situs: str | None) -> tuple[str, str, str] | None:
    """``(street line, ZIP code, how the street line was found)`` of a situs address, or None.

    With a comma, the street line is what precedes the first comma (``"before_comma"``). Without
    one ("208 MASSACHUSETTS AVE NE # E WASHINGTON DC 20002"), the line must end in a state and ZIP
    code, and the street is taken to end at the first street type after the street name, with a
    directional right after it (``"street_type_end"``): an inference, labelled as such. The ZIP
    code is its first five digits; where the publisher cut the line short inside the ZIP code
    ("... WASHINGTON DC 2003") it is the one to four digits left, which the building roll-up may
    complete from other parcels at the same street line. A situs with no ZIP digits, or no street
    type to end on, gives None.
    """
    if not situs:
        return None
    s = situs.upper()
    if "," in s:
        street, rest = s.split(",", 1)
        m = _ZIP_AFTER_COMMA.search(rest)
        return (street.strip(), m.group(1), "before_comma") if m else None
    m = _STATE_ZIP_TAIL.search(s)
    if not m or m.group(1).lower() not in STATES:
        return None
    tokens = address_tokens(s[:m.start()])
    end = next((i for i in range(2, len(tokens)) if tokens[i] in _STREET_TYPES), None)
    if end is None or not tokens[0][:1].isdigit():
        return None
    if end + 1 < len(tokens) and tokens[end + 1] in _DIRECTIONALS:
        end += 1
    return " ".join(tokens[:end + 1]), m.group(2)[:5], "street_type_end"


_UNIT_MARK = re.compile(r"(?:^|\s)(?:#|STE|SUITE|UNIT|APT|APARTMENT)(?:\s|\.|$)")


def situs_names_unit(situs: str | None) -> bool:
    """True when a situs address carries a unit, suite, apartment or "#" designator."""
    return bool(situs) and bool(_UNIT_MARK.search(situs.upper().replace("#", " # ")))


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


# --- US states, for owner linking across jurisdictions ------------------------------------------

STATE_BY_FIPS = {
    "01": "al", "02": "ak", "04": "az", "05": "ar", "06": "ca", "08": "co", "09": "ct", "10": "de",
    "11": "dc", "12": "fl", "13": "ga", "15": "hi", "16": "id", "17": "il", "18": "in", "19": "ia",
    "20": "ks", "21": "ky", "22": "la", "23": "me", "24": "md", "25": "ma", "26": "mi", "27": "mn",
    "28": "ms", "29": "mo", "30": "mt", "31": "ne", "32": "nv", "33": "nh", "34": "nj", "35": "nm",
    "36": "ny", "37": "nc", "38": "nd", "39": "oh", "40": "ok", "41": "or", "42": "pa", "44": "ri",
    "45": "sc", "46": "sd", "47": "tn", "48": "tx", "49": "ut", "50": "vt", "51": "va", "53": "wa",
    "54": "wv", "55": "wi", "56": "wy", "72": "pr",
}
STATES = frozenset(STATE_BY_FIPS.values())
_STATE_ZIP = re.compile(r"\b([A-Z]{2})(?:\s+\d{5}(?:\s?-?\s?\d{4})?)?\s*$")


def parcel_state(parcel_urn: str) -> str | None:
    """Two-letter state of a parcel URN (``fl:parcel:us-48201:…`` → ``tx``), or None."""
    m = re.match(r"fl:parcel:us-(\d{2})\d{3}:", parcel_urn)
    return STATE_BY_FIPS.get(m.group(1)) if m else None


def entity_state(entity_urn: str) -> str | None:
    """Registry state of an entity URN (``fl:entity:us-ny:…`` → ``ny``), or None (e.g. ``lei``)."""
    m = re.match(r"fl:entity:us-([a-z]{2}):", entity_urn)
    return m.group(1) if m and m.group(1) in STATES else None


def address_state(address: str | None) -> str | None:
    """State at the end of a US mailing address (``PO BOX 1, HOUSTON, TX 77002-1234`` → ``tx``), or None."""
    if not address:
        return None
    s = re.sub(r"[^A-Z0-9 ]+", " ", address.upper()).strip()
    m = _STATE_ZIP.search(s)
    st = m.group(1).lower() if m else None
    return st if st in STATES else None


# --- entity standing, for disambiguating same-name entities ------------------------------------

# Status words the adapters write (lower case, underscores), grouped by whether the entity still
# exists as a legal person. A status that fits neither group is unknown and never used to decide.
_ENDED = re.compile(r"dissol|revoked|withdrawn|merge|converted|consolidated|terminated|cancel|expired|"
                    r"forfeit|inactive|surrender|closed|struck|liquidat|effectiveness_prevented|domesticated|dead")
_LIVE = re.compile(r"active|good_standing|exists|listed|delinquent|noncompliant|current|registered|"
                   r"in_existence|pending|resigned|reinstated|suspended")
# Texas "forfeited franchise tax": the right to transact business is forfeited, the entity is not.
# A negated status ("not_in_good_standing", "unregistered") says nothing reliable either way.
_UNDECIDED = re.compile(r"franchise|(?:^|_)not_|(?:^|_)un(?!der)")


def entity_standing(status: str | None) -> str | None:
    """``"live"`` or ``"ended"`` from an adapter's status word, or None when it says neither.

    Ended wins when both match ("active_pending_dissolution" is ended); "domesticated" counts as
    ended in the registry that used it (the entity continues under another registration); a
    Texas franchise-tax forfeiture is neither, since the entity still exists.
    """
    if not status:
        return None
    s = status.strip().lower().replace(" ", "_").replace("-", "_")
    if _UNDECIDED.search(s):
        return None
    if _ENDED.search(s):
        return "ended"
    return "live" if _LIVE.search(s) else None
