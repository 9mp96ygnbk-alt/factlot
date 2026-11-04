"""FactLot ID v0.3 — Python port of @factlot/id. See docs/id-spec.md."""

from __future__ import annotations

import hashlib
import os
import re
import time
from dataclasses import dataclass
from typing import Callable

ID_SPEC_VERSION = "0.3"

SHORT_PREFIX = {
    "parcel": "flp",
    "entity": "fle",
    "building": "flb",
    "space": "fls",
    "lease": "fll",
    "document": "fld",
    "loan": "fln",
}
_CROCKFORD = "0123456789abcdefghjkmnpqrstvwxyz"
_SHORT_LEN = 24


class FactLotIdError(ValueError):
    pass


@dataclass(frozen=True)
class FactLotId:
    kind: str
    urn: str
    short: str

    def as_dict(self) -> dict[str, str]:
        return {"kind": self.kind, "urn": self.urn, "short": self.short}


def _base32(data: bytes, length: int) -> str:
    bits = "".join(f"{b:08b}" for b in data)
    return "".join(_CROCKFORD[int(bits[i : i + 5], 2)] for i in range(0, length * 5, 5))


def short_id(urn: str) -> str:
    """Compact short ID: prefix + first 120 bits of SHA-256(urn), Crockford base32."""
    kind = parse(urn)[0]
    return f"{SHORT_PREFIX[kind]}_{_base32(hashlib.sha256(urn.encode()).digest(), _SHORT_LEN)}"


def _make(kind: str, urn: str) -> FactLotId:
    return FactLotId(kind, urn, short_id(urn))


# ECMAScript whitespace (what String.prototype.trim and RegExp \s match in @factlot/id). Python's
# str.strip() and re \s differ: they also match U+001C-U+001F and U+0085 but not U+FEFF, and re
# \d matches every Unicode digit. Spelling the classes out keeps both SDKs on the same IDs.
_JS_WS = "\t\n\v\f\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff"
_JS_WS_CHARS = "".join(chr(c) for c in range(0x2000, 0x200B)) + "\t\n\v\f\r \u00a0\u1680\u2028\u2029\u202f\u205f\u3000\ufeff"


def _alnum(s: str) -> str:
    return re.sub(r"[^a-z0-9]", "", s.lower())


def normalize_apn_v1(apn: str) -> str:
    """The APN key of ID spec 0.1 and 0.2 (parcel rule 1): every character outside ``a-z0-9`` dropped."""
    n = _alnum(apn)
    if not n:
        raise FactLotIdError(f'APN "{apn}" is empty after normalization')
    return n


# --- parcel rule 2 (ID spec 0.3); see COUNTY_APN_RULES in @factlot/id ---------------------------
# A county with a documented APN format: an APN in it becomes its fields zero-padded to their fixed
# widths and run together. Every other APN keeps one hyphen per run of separators, so "12-34" and
# "1-234" stay two parcels. These formats are part of the ID rule.

_SEP = "[^a-z0-9]+"


@dataclass(frozen=True)
class _ApnFormat:
    pattern: re.Pattern[str]  # fullmatched against the lowercased APN without leading/trailing separators
    widths: tuple[int, ...] | None = None  # None: the key is the match with its separators removed


@dataclass(frozen=True)
class _CountyApnRule:
    name: str
    formats: tuple[_ApnFormat, ...]
    borough: str | None = None  # NYC: the borough digit a BBL in this county starts with
    county: str = ""


def _nyc_bbl(borough: str, county: str) -> _CountyApnRule:
    return _CountyApnRule(
        "New York City BBL: borough (1 digit), tax block (5), tax lot (4), optional easement letter",
        (_ApnFormat(re.compile(f"([1-5]){_SEP}([0-9]{{1,5}}){_SEP}([0-9]{{1,4}})(?:{_SEP})?([a-z]?)"), (1, 5, 4, 0)),
         _ApnFormat(re.compile("([1-5])([0-9]{5})([0-9]{4})([a-z]?)"), (1, 5, 4, 0))),
        borough, county)


def _digit_fields(widths: tuple[int, ...]) -> tuple[_ApnFormat, ...]:
    return (_ApnFormat(re.compile(_SEP.join(f"([0-9]{{1,{w}}})" for w in widths)), widths),
            _ApnFormat(re.compile("".join(f"([0-9]{{{w}}})" for w in widths)), widths))


COUNTY_APN_RULES: dict[str, _CountyApnRule] = {
    "06037": _CountyApnRule("Los Angeles County AIN: map book (4 digits), page (3), parcel (3)", _digit_fields((4, 3, 3))),
    "11001": _CountyApnRule(
        "District of Columbia SSL: square (4 digits) and suffix (up to 4 letters), lot (4 digits), in fixed-width "
        "fields padded with spaces; PAR and 8 digits for a parcel outside a square",
        (_ApnFormat(re.compile(f"([0-9]{{4}})(?:{_SEP})?([a-z]{{0,4}}){_SEP}([0-9]{{1,4}})"), (4, 0, 4)),
         _ApnFormat(re.compile(f"(par){_SEP}([0-9]{{8}})"), (0, 8)),
         # Any other SSL as the roll writes it: fixed-width fields padded with spaces.
         _ApnFormat(re.compile("[a-z0-9]+(?: +[a-z0-9]+)*")))),
    "17031": _CountyApnRule("Cook County PIN: area (2 digits), subarea (2), block (3), parcel (3), unit (4)",
                            _digit_fields((2, 2, 3, 3, 4))),
    "36005": _nyc_bbl("2", "the Bronx (36005)"),
    "36047": _nyc_bbl("3", "Brooklyn (36047)"),
    "36061": _nyc_bbl("1", "Manhattan (36061)"),
    "36081": _nyc_bbl("4", "Queens (36081)"),
    "36085": _nyc_bbl("5", "Staten Island (36085)"),
}
_EDGE_SEPARATORS = re.compile(rf"\A{_SEP}|{_SEP}\Z")
_SEPARATORS = re.compile(_SEP)


def normalize_apn(apn: str, county: str | None = None) -> str:
    """APN key (parcel rule 2, ID spec 0.3): see ``normalizeApn`` in @factlot/id.

    ``county`` is the 5-digit state and county FIPS; a county in ``COUNTY_APN_RULES`` turns an APN
    in its documented format into zero-padded fields run together. Any other APN keeps one hyphen
    per run of separators ("12-34" and "1-234" differ); leading and trailing separators are dropped.
    """
    core = _EDGE_SEPARATORS.sub("", apn.lower())
    if not core:
        raise FactLotIdError(f'APN "{apn}" is empty after normalization')
    rule = COUNTY_APN_RULES.get(county) if county is not None else None
    for fmt in rule.formats if rule else ():
        m = fmt.pattern.fullmatch(core)
        if not m:
            continue
        if fmt.widths is None:
            return _alnum(core)
        fields = [f or "" for f in m.groups()]
        if rule is not None and rule.borough is not None and fields[0] != rule.borough:
            raise FactLotIdError(f'APN "{apn}" is not a valid {rule.name}: a BBL in {rule.county} starts with '
                                 f"borough {rule.borough}, not {fields[0]}")
        return "".join(f.rjust(w, "0") for f, w in zip(fields, fmt.widths))
    return _SEPARATORS.sub("-", core)


def _check_fips(state_fips: str, county_fips: str) -> None:
    if not re.fullmatch(r"[0-9]{2}", state_fips):
        raise FactLotIdError("state_fips must be 2 digits")
    if not re.fullmatch(r"[0-9]{3}", county_fips):
        raise FactLotIdError("county_fips must be 3 digits")


def parcel_id(state_fips: str, county_fips: str, apn: str, normalize: Callable[[str], str] | None = None) -> FactLotId:
    """Deterministic parcel ID: ``fl:parcel:us-<SSCCC>:<apn>``."""
    _check_fips(state_fips, county_fips)
    n = normalize(apn) if normalize else normalize_apn(apn, state_fips + county_fips)
    if not re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", n):
        raise FactLotIdError("normalized APN must be lowercase alphanumerics, with single hyphens between them")
    return _make("parcel", f"fl:parcel:us-{state_fips}{county_fips}:{n}")


def entity_id(jurisdiction: str, registry_number: str) -> FactLotId:
    """Deterministic legal-entity ID: ``fl:entity:<jurisdiction>:<number>``."""
    j = jurisdiction.lower()
    if not re.fullmatch(r"[a-z]{2}-[a-z0-9]{1,3}|lei", j):
        raise FactLotIdError(f'jurisdiction "{jurisdiction}" must look like "us-de" or "lei"')
    n = _alnum(registry_number)
    if not n:
        raise FactLotIdError("registry_number is empty after normalization")
    if j == "lei":
        _check_lei(n, registry_number)
    return _make("entity", f"fl:entity:{j}:{n}")


def _check_lei(n: str, given: str) -> None:
    """ISO 17442: 18 alphanumerics and 2 check digits; the code read as a number (A = 10 … Z = 35) is 1 mod 97."""
    if len(n) != 20:
        raise FactLotIdError(f'"{given}" is not an LEI: an LEI is 20 characters (ISO 17442), got {len(n)}')
    if not re.fullmatch("[0-9]{2}", n[18:]):
        raise FactLotIdError(f'"{given}" is not an LEI: its last two characters are check digits (ISO 17442)')
    rem = 0
    for c in n:
        v = int(c, 36)
        rem = (rem * 10 + v if v < 10 else rem * 100 + v) % 97
    if rem != 1:
        raise FactLotIdError(f'"{given}" is not a valid LEI: its check digits do not match (ISO 17442, ISO 7064 '
                             "MOD 97-10); check for a mistyped character")


def document_id(content: bytes | str) -> FactLotId:
    """Content-addressed document ID. ``str`` input is UTF-8 encoded."""
    data = content.encode() if isinstance(content, str) else content
    return _make("document", f"fl:document:sha256-{hashlib.sha256(data).hexdigest()}")


# Ordinal words for whole floors ("Third Floor" is "3rd Floor").
_ORDINAL_WORDS = ("first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth",
                  "eleventh", "twelfth", "thirteenth", "fourteenth", "fifteenth", "sixteenth", "seventeenth",
                  "eighteenth", "nineteenth", "twentieth")
_FLOOR_WORD = r"(?:floor|flr\.?|fl\.?)"
_FLOOR = (
    re.compile(rf"^([0-9]+)(?:st|nd|rd|th)?[{_JS_WS}]*{_FLOOR_WORD}$"),
    re.compile(rf"^{_FLOOR_WORD}[{_JS_WS}]*([0-9]+)$"),
)
_ORDINAL_FLOOR = re.compile(rf"^({'|'.join(_ORDINAL_WORDS)})[{_JS_WS}]*{_FLOOR_WORD}$")
_DESIGNATOR = re.compile(rf"^(?:suite|ste\.?|unit|apartment|apt\.?|space|spc\.?|room|rm\.?|no\.?|#)[{_JS_WS}]*")
_SEPARATOR = re.compile(r"[^a-z0-9]+")
_DIGITS = "0123456789"


def normalize_suite(suite: str) -> str:
    """Suite rule 2 (ID spec 0.2): see ``normalizeSuite`` in @factlot/id.

    Whole floors are ``f<n>`` ("3rd Floor", "Third Floor", "FL 3", "3rd Flr"); a separator between
    two digits is kept as one hyphen ("1-20" is not "120"); other separators are dropped; leading
    zeros are kept.
    """
    s = suite.strip(_JS_WS_CHARS).lower()
    for pattern in _FLOOR:
        m = pattern.match(s)
        if m:
            return f"f{int(m[1])}"
    m = _ORDINAL_FLOOR.match(s)
    if m:
        return f"f{_ORDINAL_WORDS.index(m[1]) + 1}"
    v = _DESIGNATOR.sub("", s, count=1)
    n = _SEPARATOR.sub(lambda m: "-" if 0 < m.start() and m.end() < len(v) and v[m.start() - 1] in _DIGITS
                       and v[m.end()] in _DIGITS else "", v)
    if not n:
        raise FactLotIdError(f'suite "{suite}" is empty after normalization')
    return n


_FLOOR_V1 = (
    re.compile(rf"^([0-9]+)(?:st|nd|rd|th)?[{_JS_WS}]*(?:floor|fl\.?)$"),
    re.compile(rf"^(?:floor|fl\.?)[{_JS_WS}]*([0-9]+)$"),
)
_DESIGNATOR_V1 = re.compile(rf"^(?:suite|ste\.?|unit|space|spc\.?|room|rm\.?|no\.?|#)[{_JS_WS}]*")


def normalize_suite_v1(suite: str) -> str:
    """The suite key of ID spec 0.1 (suite rule 1), kept so earlier space IDs can be recomputed."""
    s = suite.strip(_JS_WS_CHARS).lower()
    for pattern in _FLOOR_V1:
        m = pattern.match(s)
        if m:
            return f"f{int(m[1])}"
    n = _alnum(_DESIGNATOR_V1.sub("", s, count=1))
    if not n:
        raise FactLotIdError(f'suite "{suite}" is empty after normalization')
    return n


# --- street addresses (building IDs, ID spec 0.2) ---------------------------------------------
# These tables are part of the ID rule (see addressTokens in @factlot/id): changing them changes
# building IDs, so they change only with a new ID spec version.

_DIRECTIONAL = {"NORTH": "N", "SOUTH": "S", "EAST": "E", "WEST": "W",
                "NORTHEAST": "NE", "NORTHWEST": "NW", "SOUTHEAST": "SE", "SOUTHWEST": "SW"}


def _ordinal(n: int) -> str:
    suffix = "th" if 11 <= n % 100 <= 13 else {1: "st", 2: "nd", 3: "rd"}.get(n % 10, "th")
    return f"{n}{suffix}".upper()


_STREET_WORD = {
    "STREET": "ST", "AVENUE": "AVE", "AV": "AVE", "ROAD": "RD", "DRIVE": "DR", "BOULEVARD": "BLVD",
    "LANE": "LN", "PARKWAY": "PKWY", "HIGHWAY": "HWY", "FREEWAY": "FWY", "EXPRESSWAY": "EXPY",
    "COURT": "CT", "PLACE": "PL", "CIRCLE": "CIR", "TRAIL": "TRL", "TERRACE": "TER", "SQUARE": "SQ",
    "PLAZA": "PLZ", "ALLEY": "ALY", "BUILDING": "BLDG",
    **{w.upper(): _ordinal(i + 1) for i, w in enumerate(_ORDINAL_WORDS)},
}
# A unit designator and the one token after it are not part of the street address; a floor word
# only before a one- or two-digit number or after an ordinal ("FL" is also Florida's postal code);
# "RM" is left out (Texas Ranch-to-Market roads, "RM 620").
_UNIT_WORDS = frozenset({"#", "STE", "SUITE", "UNIT", "APT", "APARTMENT", "ROOM", "SPC"})
_FLOOR_WORDS = frozenset({"FL", "FLR", "FLOOR"})
_ORDINAL_NUMBER = re.compile(r"[0-9]{1,3}(?:ST|ND|RD|TH)")
_JS_SPLIT = re.compile(f"[{_JS_WS}]+")


def address_tokens(address: str) -> list[str]:
    """The comparable tokens of a street address (see ``addressTokens`` in @factlot/id)."""
    raw = [t for t in _JS_SPLIT.split(address.upper().replace("#", " # ")) if t]
    kept: list[str] = []
    i = 0
    while i < len(raw):
        t = raw[i][:-1] if raw[i].endswith(".") else raw[i]
        nxt = raw[i + 1] if i + 1 < len(raw) else ""
        if nxt[-1:] in (".", ","):
            nxt = nxt[:-1]
        if t in _UNIT_WORDS:
            while i + 1 < len(raw) and raw[i + 1] == "#":
                i += 1
            i += 2  # the designator and the unit's value
            continue
        if (t in _FLOOR_WORDS and re.fullmatch(r"[0-9]{1,2}", nxt)) or (
                _ORDINAL_NUMBER.fullmatch(t) and nxt in _FLOOR_WORDS):
            i += 2
            continue
        kept.append(raw[i])
        i += 1
    words = [w for w in re.sub(r"[^A-Z0-9 ]+", " ", " ".join(kept)).split(" ") if w]
    out: list[str] = []
    for w in (_DIRECTIONAL.get(w) or _STREET_WORD.get(w) or w for w in words):
        if out and out[-1] in ("N", "S") and w in ("E", "W"):
            out[-1] += w
        else:
            out.append(w)
    return out


_STATE_AND_ZIP = re.compile(r"(?:^|-)[a-z]{2}-[0-9]{5}(?:-[0-9]{4})?$")


def normalize_street(street: str) -> str:
    """Street key of a building ID: ``"208 Massachusetts Avenue Northeast, Suite 2"`` → ``"208-massachusetts-ave-ne"``."""
    key = "-".join(address_tokens(street.split(",")[0])).lower()
    if not re.match(r"[0-9][a-z0-9]*-[a-z0-9]", key):
        raise FactLotIdError(f'street "{street}" must start with a house number followed by a street name')
    if _STATE_AND_ZIP.search(key):
        raise FactLotIdError(f'street "{street}" seems to include a state and ZIP code: pass the street line only, '
                             "or put a comma before the city")
    return key


_ZIP = re.compile(rf"[{_JS_WS}]*([0-9]{{5}})(?:-?[0-9]{{4}})?[{_JS_WS}]*")


def building_id(state_fips: str, county_fips: str, zip_code: str, street: str) -> FactLotId:
    """Deterministic building ID from a street address: ``fl:building:us-<SSCCC>:<zip5>:<street key>``."""
    _check_fips(state_fips, county_fips)
    m = _ZIP.fullmatch(zip_code)
    if not m:
        raise FactLotIdError("zip must be a 5-digit ZIP code (or ZIP+4)")
    return _make("building", f"fl:building:us-{state_fips}{county_fips}:{m[1]}:{normalize_street(street)}")


def space_id(building: str | FactLotId, suite: str) -> FactLotId:
    """Space ID within a building: ``fl:space:<building>:<suite>`` (``<building>`` follows ``fl:building:``)."""
    urn = building if isinstance(building, str) else building.urn
    kind, _parts = parse(urn)
    if kind != "building":
        raise FactLotIdError("space_id requires a building ID")
    return _make("space", f"fl:space:{urn[len('fl:building:'):]}:{normalize_suite(suite)}")


def mint(kind: str, now_ms: int | None = None) -> FactLotId:
    """Mint an opaque, time-sortable ID (ULID layout) for building, lease, or loan."""
    if kind not in ("building", "lease", "loan"):
        raise FactLotIdError("mint supports building, lease, loan")
    t = int(time.time() * 1000) if now_ms is None else now_ms
    if t < 0 or t >= 2**48:
        raise FactLotIdError("timestamp must be a non-negative 48-bit integer (ms)")
    stamp = ""
    for _ in range(10):
        stamp = _CROCKFORD[t % 32] + stamp
        t //= 32
    return _make(kind, f"fl:{kind}:{stamp}{_base32(os.urandom(10), 16)}")


_TOKEN = "[0-9a-hjkmnp-tv-z]{26}"
# An address building: region, ZIP code, street key (house number first, words joined by hyphens).
_ADDRESS_BUILDING = r"(us-[0-9]{5}):([0-9]{5}):([0-9][a-z0-9]*(?:-[a-z0-9]+)+)"
# Matched with fullmatch: re's `$` also matches before a trailing newline, which @factlot/id rejects.
_URN_PATTERNS = {
    "parcel": re.compile(r"fl:parcel:(us-[0-9]{5}):([a-z0-9]+(?:-[a-z0-9]+)*)"),
    "entity": re.compile(r"fl:entity:([a-z]{2}-[a-z0-9]{1,3}|lei):([a-z0-9]+)"),
    "building": re.compile(rf"fl:building:(?:({_TOKEN})|{_ADDRESS_BUILDING})"),
    "space": re.compile(rf"fl:space:(?:({_TOKEN})|{_ADDRESS_BUILDING}):([a-z0-9]+(?:-[a-z0-9]+)*)"),
    "lease": re.compile(rf"fl:lease:({_TOKEN})"),
    "loan": re.compile(rf"fl:loan:({_TOKEN})"),
    "document": re.compile(r"fl:document:(sha256-[a-f0-9]{64})"),
}


def parse(urn: str) -> tuple[str, list[str]]:
    """Validate a canonical URN; returns ``(kind, parts)``."""
    pieces = urn.split(":")
    kind = pieces[1] if len(pieces) > 1 else ""
    if not urn.startswith("fl:") or kind not in _URN_PATTERNS:
        raise FactLotIdError(f'"{urn}" is not a FactLot URN')
    m = _URN_PATTERNS[kind].fullmatch(urn)
    if not m:
        raise FactLotIdError(f'"{urn}" is not a valid {kind} URN')
    return kind, [g for g in m.groups() if g is not None]


def is_factlot_urn(value: str) -> bool:
    try:
        parse(value)
        return True
    except FactLotIdError:
        return False


def short_id_kind(short: str) -> str:
    m = re.fullmatch(r"(fl[a-z])_([0-9a-hjkmnp-tv-z]{24})", short)
    kind = next((k for k, p in SHORT_PREFIX.items() if m and p == m[1]), None)
    if kind is None:
        raise FactLotIdError(f'"{short}" is not a FactLot short ID')
    return kind
