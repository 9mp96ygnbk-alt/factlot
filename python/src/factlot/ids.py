"""FactLot ID v0.1 — Python port of @factlot/id. See docs/id-spec.md."""

from __future__ import annotations

import hashlib
import os
import re
import time
from dataclasses import dataclass
from typing import Callable

ID_SPEC_VERSION = "0.1"

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


def normalize_apn(apn: str) -> str:
    n = _alnum(apn)
    if not n:
        raise FactLotIdError(f'APN "{apn}" is empty after normalization')
    return n


def parcel_id(state_fips: str, county_fips: str, apn: str, normalize: Callable[[str], str] | None = None) -> FactLotId:
    """Deterministic parcel ID: ``fl:parcel:us-<SSCCC>:<apn>``."""
    if not re.fullmatch(r"[0-9]{2}", state_fips):
        raise FactLotIdError("state_fips must be 2 digits")
    if not re.fullmatch(r"[0-9]{3}", county_fips):
        raise FactLotIdError("county_fips must be 3 digits")
    n = (normalize or normalize_apn)(apn)
    if not re.fullmatch(r"[a-z0-9]+", n):
        raise FactLotIdError("normalized APN must be lowercase alphanumerics")
    return _make("parcel", f"fl:parcel:us-{state_fips}{county_fips}:{n}")


def entity_id(jurisdiction: str, registry_number: str) -> FactLotId:
    """Deterministic legal-entity ID: ``fl:entity:<jurisdiction>:<number>``."""
    j = jurisdiction.lower()
    if not re.fullmatch(r"[a-z]{2}-[a-z0-9]{1,3}|lei", j):
        raise FactLotIdError(f'jurisdiction "{jurisdiction}" must look like "us-de" or "lei"')
    n = _alnum(registry_number)
    if not n:
        raise FactLotIdError("registry_number is empty after normalization")
    if j == "lei" and len(n) != 20:
        raise FactLotIdError("an LEI is 20 characters")
    return _make("entity", f"fl:entity:{j}:{n}")


def document_id(content: bytes | str) -> FactLotId:
    """Content-addressed document ID. ``str`` input is UTF-8 encoded."""
    data = content.encode() if isinstance(content, str) else content
    return _make("document", f"fl:document:sha256-{hashlib.sha256(data).hexdigest()}")


_FLOOR = (
    re.compile(rf"^([0-9]+)(?:st|nd|rd|th)?[{_JS_WS}]*(?:floor|fl\.?)$"),
    re.compile(rf"^(?:floor|fl\.?)[{_JS_WS}]*([0-9]+)$"),
)
_DESIGNATOR = re.compile(rf"^(?:suite|ste\.?|unit|space|spc\.?|room|rm\.?|no\.?|#)[{_JS_WS}]*")


def normalize_suite(suite: str) -> str:
    s = suite.strip(_JS_WS_CHARS).lower()
    for pattern in _FLOOR:
        m = pattern.match(s)
        if m:
            return f"f{int(m[1])}"
    n = _alnum(_DESIGNATOR.sub("", s, count=1))
    if not n:
        raise FactLotIdError(f'suite "{suite}" is empty after normalization')
    return n


def space_id(building: str | FactLotId, suite: str) -> FactLotId:
    kind, parts = parse(building if isinstance(building, str) else building.urn)
    if kind != "building":
        raise FactLotIdError("space_id requires a building ID")
    return _make("space", f"fl:space:{parts[0]}:{normalize_suite(suite)}")


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
# Matched with fullmatch: re's `$` also matches before a trailing newline, which @factlot/id rejects.
_URN_PATTERNS = {
    "parcel": re.compile(r"fl:parcel:(us-[0-9]{5}):([a-z0-9]+)"),
    "entity": re.compile(r"fl:entity:([a-z]{2}-[a-z0-9]{1,3}|lei):([a-z0-9]+)"),
    "building": re.compile(rf"fl:building:({_TOKEN})"),
    "space": re.compile(rf"fl:space:({_TOKEN}):([a-z0-9]+)"),
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
    return kind, list(m.groups())


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
