"""Classify one appraisal-roll or entity row, and neutralize a spreadsheet export cell.

Reason codes are stable and contain no owner names, mailing addresses, or other
personal data. A classification does not change which rows the registry stores:
ingest keeps the commercial-scope and identifier rules it already had and records
these codes beside them.

Parcel identity stays the FactLot parcel ID (``fl:parcel:``). The proposed
``flr1:`` scheme is not implemented: an existing ID must not change for the same
input.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any, Callable

from ..ids import FactLotIdError, entity_id, parcel_id
from .county_names import county_name
from .normalize import is_commercial

# Same bounds the audit treats as implausible (audit.py). A warning, not a dropped fact.
MAX_AREA_SF = 5e8
MAX_VALUE_USD = 5e10
MIN_YEAR_BUILT = 1700
MAX_YEAR_BUILT = 2100

# A point inside this box can be a US, Puerto Rico, or Alaska coordinate. Outside it is a
# warning. Missing coordinates are not a finding: most rolls do not publish them.
LAT_MIN, LAT_MAX = 13.0, 72.0
LON_MIN, LON_MAX = -180.0, -64.0

# An APN made only of letters, underscores and spaces is a column heading read as data.
_HEADER_LIKE_APN = re.compile(r"^[A-Za-z_ .#]+$")
_CATEGORY = re.compile(r"[A-Z]\d*")
_FORMULA_LEAD = ("=", "+", "@", "\t", "\r", "＝", "＋", "＠")
_SIGNED_NUMBER = re.compile(r"^-?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$")


@dataclass(frozen=True)
class RowClassification:
    """``disposition`` is what the existing ingest rules do. ``reasons`` are quality codes."""

    disposition: str  # keep | skip_out_of_scope | skip_invalid
    reasons: tuple[str, ...]
    urn: str | None = None


def category_disposition(state_category: str | None) -> str:
    """``in_scope``, ``out_of_scope`` (a real non-commercial class), or ``unknown`` (blank or not a class code)."""
    if is_commercial(state_category):
        return "in_scope"
    text = (state_category or "").strip().upper()
    if text and _CATEGORY.fullmatch(text):
        return "out_of_scope"
    return "unknown"


def _num(v: Any) -> float | None:
    if isinstance(v, bool) or v is None:
        return None
    if isinstance(v, (int, float)):
        n = float(v)
    else:
        try:
            n = float(str(v).strip())
        except (TypeError, ValueError):
            return None
    if n != n or abs(n) == float("inf"):
        return None
    return n


def _coordinate(record: Any) -> tuple[Any, Any]:
    lat = getattr(record, "latitude", None)
    lon = getattr(record, "longitude", None)
    for item in getattr(record, "extra_facts", None) or []:
        if not item:
            continue
        pred, val = item[0], item[1]
        if pred == "parcel.latitude":
            lat = val
        elif pred == "parcel.longitude":
            lon = val
    return lat, lon


def _coordinate_reasons(record: Any) -> list[str]:
    lat, lon = _coordinate(record)
    if lat is None and lon is None:
        return []
    lat_n, lon_n = _num(lat), _num(lon)
    if lat_n is None or lon_n is None or not (-90 <= lat_n <= 90 and -180 <= lon_n <= 180):
        return ["implausible_coordinate"]
    if lat_n == 0 and lon_n == 0:
        return ["null_island"]
    reasons = ["coordinates_present"]
    if not (LAT_MIN <= lat_n <= LAT_MAX and LON_MIN <= lon_n <= LON_MAX):
        reasons.append("coordinate_outside_us_box")
    return reasons


def _figure_reasons(record: Any) -> list[str]:
    reasons = []
    for attr, limit in (("land_area_sf", MAX_AREA_SF), ("improvement_area_sf", MAX_AREA_SF)):
        n = _num(getattr(record, attr, None))
        if n is None:
            continue
        if n <= 0 or n > limit:
            reasons.append("implausible_area")
            break
    year = getattr(record, "year_built", None)
    if isinstance(year, int) and not isinstance(year, bool) and (year < MIN_YEAR_BUILT or year > MAX_YEAR_BUILT):
        reasons.append("implausible_year")
    for attr in ("market_value", "appraised_value"):
        n = _num(getattr(record, attr, None))
        if n is not None and (n < 0 or n > MAX_VALUE_USD):
            reasons.append("implausible_value")
            break
    return reasons


def classify_parcel(record: Any, *, state_fips: str, seen_urns: set[str] | None = None,
                    urn_for: Callable[[str, str, str], str] | None = None,
                    include_all_categories: bool = False) -> RowClassification:
    """Classify one ``ParcelRecord``. Does not read or store the owner name."""
    seen = seen_urns if seen_urns is not None else set()
    apn = (getattr(record, "apn", None) or "").strip()
    county = (getattr(record, "county_fips", None) or "").strip()
    if not apn:
        return RowClassification("skip_invalid", ("missing_apn",))
    if not re.fullmatch(r"\d{3}", county):
        return RowClassification("skip_invalid", ("malformed_county_fips",))
    reasons: list[str] = []
    if county_name(f"{state_fips}{county}") is None:
        reasons.append("unknown_county")
    if _HEADER_LIKE_APN.match(apn):
        reasons.append("header_like_apn")
    cat = category_disposition(getattr(record, "state_category", None))
    if cat == "unknown":
        reasons.append("unknown_category")
    if cat != "in_scope" and not include_all_categories:
        code = "unknown_category" if cat == "unknown" else "out_of_scope"
        if code not in reasons:
            reasons.append(code)
        return RowClassification("skip_out_of_scope", tuple(reasons))
    if cat == "out_of_scope":
        reasons.append("out_of_scope")

    def default_urn(state: str, cty: str, raw: str) -> str:
        return parcel_id(state, cty, raw).urn

    try:
        urn = (urn_for or default_urn)(state_fips, county, record.apn)
    except FactLotIdError:
        reasons.append("invalid_parcel_id")
        return RowClassification("skip_invalid", tuple(reasons))
    if urn in seen:
        reasons.append("duplicate_identity")
    if not (getattr(record, "situs_address", None) or "").strip():
        reasons.append("missing_address")
    reasons.extend(_figure_reasons(record))
    reasons.extend(_coordinate_reasons(record))
    return RowClassification("keep", tuple(dict.fromkeys(reasons)), urn)


def classify_entity(record: Any, *, seen_urns: set[str] | None = None) -> RowClassification:
    """Classify one ``EntityRecord``. The legal name is not copied into a reason."""
    seen = seen_urns if seen_urns is not None else set()
    number = (getattr(record, "registry_number", None) or "").strip()
    name = (getattr(record, "legal_name", None) or "").strip()
    if not number:
        return RowClassification("skip_invalid", ("missing_registry_number",))
    if not name:
        return RowClassification("skip_invalid", ("missing_legal_name",))
    try:
        urn = entity_id(record.registry_jurisdiction, record.registry_number).urn
    except FactLotIdError:
        return RowClassification("skip_invalid", ("invalid_entity_id",))
    reasons: list[str] = []
    if urn in seen:
        reasons.append("duplicate_identity")
    return RowClassification("keep", tuple(reasons), urn)


def neutralize_export_cell(value: str) -> str:
    """Make one spreadsheet cell non-executing. Stored registry facts are not rewritten.

    A leading ``=``, ``+``, ``@``, tab, carriage return, or the fullwidth forms of those
    signs is prefixed with an apostrophe. A leading hyphen is prefixed only when the cell
    is not a plain signed number, so a negative quantity stays numeric.
    """
    if not isinstance(value, str) or not value:
        return value
    text = value.lstrip("\ufeff")
    stripped = text.lstrip(" \t")
    if not stripped:
        return value
    # Tabs and CRs are formula leads; strip only ASCII spaces so ``"\tname"`` is neutralized.
    probe = text.lstrip(" ")
    if not probe:
        return value
    formula_lead = probe[0]
    if formula_lead in _FORMULA_LEAD or (
        formula_lead == "－" and not _SIGNED_NUMBER.fullmatch(probe)
    ):
        return "'" + value
    lead = stripped[0]
    if lead == "-" and not _SIGNED_NUMBER.fullmatch(stripped.strip()):
        return "'" + value
    return value
