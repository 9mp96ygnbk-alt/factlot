"""Caller-supplied format check for one Harris commercial building area.

Pure. No network, no database, and no valuation. It does not compute a building
area, impute a missing figure, substitute one column for another, or sum building
rows. A filled_recognized value is the caller's own positive finite square-foot
base_ar (or a clearly labeled commercial Base Area / Building Area), echoed back.
It was not read from Harris County. ``not_county_complete`` is always true.
``verified_against_publisher`` is always false.

HCAD Definition_help: Base Area equals Building Area for commercial properties.
That equivalence is a label rule applied to caller-supplied fields. This module
does not open Definition_help or any HCAD file. ``act_ar`` is not a recommended
commercial Total Building Area fill. Agreement with ``bld_ar`` in an extract is
not semantic equivalence.
"""

from __future__ import annotations

import math
import re
from typing import Any

HARRIS_FIPS = "201"
MAX_AREA_SF = 500_000_000
_FIPS = re.compile(r"\d{3}")

_CLASS_ORDER = {
    "invalid": 0,
    "mismatched": 1,
    "missing": 2,
    "refused": 3,
    "limitation": 4,
}

_CARD_KEYS = {
    "county_fips",
    "building_row_count",
    "multi_building",
    "building_rows",
    "bld_ar",
    "base_ar",
    "act_ar",
    "unit",
    "label",
    "value",
    "commercial",
    "market_value",
    "appraised_value",
    "tot_mkt_val",
    "tot_appr_val",
    "acreage",
    "requested",
    "owner_name",
    "owner_mailing_address",
    "owner",
    "aggregation_rule",
}
_ROW_KEYS = {
    "bld_ar",
    "base_ar",
    "act_ar",
    "unit",
    "label",
    "value",
    "commercial",
    "market_value",
    "appraised_value",
    "tot_mkt_val",
    "tot_appr_val",
    "acreage",
}
_OWNER_KEYS = ("owner_name", "owner_mailing_address", "owner")
_MONEY_KEYS = ("market_value", "appraised_value", "tot_mkt_val", "tot_appr_val")
_MONEY_LABELS = {
    "market_value",
    "appraised_value",
    "tot_mkt_val",
    "tot_appr_val",
    "Market Value",
    "Appraised Value",
}
_ACT_LABELS = {"act_ar", "Actual Area", "Total Building Area"}
_ACRE_LABELS = {"acreage", "acres", "acre"}

_DEFINITION = (
    "Caller-supplied HCAD base_ar (Base Area). HCAD Definition_help states that Base Area equals "
    "Building Area for commercial properties. A recognized label is a caller-supplied format check "
    "only and does not verify the figure against the publisher. Not actual area (act_ar), not account "
    "bld_ar, not rentable area, and not a sum of building rows."
)
_OWNER_MESSAGE = "Owner names and mailing addresses are not read and are not returned."
_UNKNOWN_INPUT = (
    "The input includes a property this diagnostic does not accept. That property was ignored "
    "and was not copied into the result."
)
_UNKNOWN_ROW = (
    "A building row includes a property this diagnostic does not accept. That row was not used "
    "and was not copied into the result."
)
_INPUT_MESSAGE = "input must be an object of caller-supplied fields."
_BAD_FIPS = (
    "county_fips must be a 3-digit string. Harris County is 201. Other types are not coerced, "
    "and other counties are not assessed."
)
_JURISDICTION = (
    "This diagnostic is only for Harris County, Texas (FIPS 201). It does not assess other counties, "
    "does not use their published counts, and does not acquire their data."
)
_GENERIC = (
    "This diagnostic only checks the format of a caller-supplied Harris commercial building area. "
    "It does not compute an area, does not fetch county data, and does not treat unknown as zero."
)
_REQUESTED_TYPE = "requested must be a list of names when it is present."
_COMMERCIAL_TYPE = "commercial must be a boolean when it is present. Other types are not coerced."
_ROW_COUNT_TYPE = "building_row_count must be an integer of 0 or more. Text and booleans are not coerced."
_MULTI_TYPE = "multi_building must be a boolean when it is present."
_ROWS_TYPE = "building_rows must be a list when it is present."
_ROW_SHAPE = "Each building row must be an object. That row was not used."
_ROW_CONTRADICTION = (
    "The building-row count and the building-row list disagree. No area was selected and rows were not summed."
)
_MULTI = (
    "The caller indicated more than one building row or a multi-building account. No official aggregation "
    "rule is applied, so the rows are not summed and no building area is filled."
)
_AGGREGATION = (
    "An aggregation rule was supplied. It is not an official rule and was not applied. Building rows were not summed."
)
_NO_ROW = "The caller reported no building row. No building area was invented."
_ACT_AR = (
    "act_ar is not a recommended commercial Total Building Area fill. Empirical agreement with bld_ar is not "
    "semantic equivalence. The figure was not copied and was not substituted for base_ar."
)
_MONEY = "Market value and appraised value are not building area. They were not copied into the result."
_MONEY_LABEL = (
    "A market or appraised value was supplied as the area candidate. It is not a building area and was not copied."
)
_BLD_NOT_USED = (
    "Account bld_ar is not the commercial Base Area. It was not substituted for base_ar and was not summed with it."
)
_NOT_REPAIR = (
    "bld_ar is 0. The filled commercial candidate is the caller-supplied base area only. "
    "It does not repair or replace the zero account bld_ar."
)
_STRICT = (
    "Exactly one building row was asserted, bld_ar is 0, and base_ar is a positive finite square-foot figure. "
    "The commercial candidate label is recorded only. The figure was not copied into a filled value and is not "
    "a repair of bld_ar."
)
_SECOND = "A second area figure was not substituted for base_ar and was not summed with it."
_BLANK = "The commercial building-area candidate is blank. Blank is not a building area and was not copied."
_ZERO = (
    "The commercial building-area candidate is 0. Zero is not a building area and is not treated as missing. "
    "The figure was not copied."
)
_WRONG_TYPE = (
    "The commercial building-area candidate must be a number. Text, booleans, and other values are not "
    "coerced and were not copied."
)
_NON_FINITE = "The commercial building-area candidate is not finite. It was not coerced and was not copied."
_NEGATIVE = "The commercial building-area candidate is negative. A negative figure is not a building area and was not copied."
_IMPLAUSIBLE = (
    "The commercial building-area candidate exceeds 500000000 sf, the registry audit's implausible-area line. "
    "It is not filled."
)
_UNITS = (
    "The commercial building-area candidate is not in square feet. Acres are not converted, and an unrecognized "
    "unit is not assumed. The figure was not copied."
)
_MISSING = (
    "No caller-supplied commercial base_ar (Base Area) was recognized. act_ar and bld_ar are not substituted. "
    "Nothing was fetched."
)
_NOT_COMMERCIAL = (
    "The Building Area label is a commercial candidate only when commercial is true. The figure was not copied."
)
_ACREAGE_ONLY = (
    "Acreage was supplied without a square-foot commercial building area. Acres are not converted into "
    "building area and were not copied."
)
_ACREAGE_BESIDE = "Acreage was not converted into commercial building area and was not copied."
_UNRECOGNIZED = (
    "The supplied label is not a Harris commercial base-area or building-area field. The figure was not copied."
)
_UNLABELED = "An unlabeled value is not a commercial building area. It was not copied."

_REFUSALS = {
    "tax_rate": ("tax_rate", "No tax rate is evaluated. Nothing is fetched. Unknown is not zero."),
    "parcel.tax_rate": ("tax_rate", "No tax rate is evaluated. Nothing is fetched. Unknown is not zero."),
    "exemption": (
        "exemption",
        "Exemption eligibility is not determined. Unknown is not no exemption. Nothing is fetched.",
    ),
    "parcel.exemption": (
        "exemption",
        "Exemption eligibility is not determined. Unknown is not no exemption. Nothing is fetched.",
    ),
    "sale": ("sale", "No sale price is read. Roll market value is not a sale. Nothing is fetched."),
    "sale_price": ("sale", "No sale price is read. Roll market value is not a sale. Nothing is fetched."),
    "parcel.sale_price": ("sale", "No sale price is read. Roll market value is not a sale. Nothing is fetched."),
    "transaction.sale": ("sale", "No sale price is read. Roll market value is not a sale. Nothing is fetched."),
    "rent": ("rent", "Rent is not inferred. Nothing is fetched."),
    "parcel.rent": ("rent", "Rent is not inferred. Nothing is fetched."),
    "lease.rent": ("rent", "Rent is not inferred. Nothing is fetched."),
    "noi": ("noi", "NOI is not inferred. Nothing is fetched."),
    "parcel.noi": ("noi", "NOI is not inferred. Nothing is fetched."),
    "cap_rate": ("cap_rate", "A cap rate is not inferred. Nothing is fetched."),
    "parcel.cap_rate": ("cap_rate", "A cap rate is not inferred. Nothing is fetched."),
    "flood": ("flood", "Flood status is not determined. Nothing is fetched."),
    "parcel.flood": ("flood", "Flood status is not determined. Nothing is fetched."),
    "elevation": ("elevation", "Elevation is not determined. Nothing is fetched."),
    "parcel.elevation": ("elevation", "Elevation is not determined. Nothing is fetched."),
    "insurance": ("insurance", "Insurance conclusions are not made. Nothing is fetched."),
    "parcel.insurance": ("insurance", "Insurance conclusions are not made. Nothing is fetched."),
    "buildability": ("buildability", "Buildability is not determined. Nothing is fetched."),
    "parcel.buildability": ("buildability", "Buildability is not determined. Nothing is fetched."),
    "valuation": (
        "valuation",
        "No automatic valuation is made. This diagnostic does not conclude value. Nothing is fetched.",
    ),
    "automatic_valuation": (
        "valuation",
        "No automatic valuation is made. This diagnostic does not conclude value. Nothing is fetched.",
    ),
    "avm": (
        "valuation",
        "No automatic valuation is made. This diagnostic does not conclude value. Nothing is fetched.",
    ),
    "parcel.valuation": (
        "valuation",
        "No automatic valuation is made. This diagnostic does not conclude value. Nothing is fetched.",
    ),
}


def _is_object(value: Any) -> bool:
    return isinstance(value, dict)


def _is_int(value: Any) -> bool:
    return isinstance(value, int) and not isinstance(value, bool)


def _blank(value: Any) -> bool:
    return value is None or (isinstance(value, str) and value.strip() == "")


def _exact_zero(value: Any) -> bool:
    return (
        not isinstance(value, bool)
        and isinstance(value, (int, float))
        and math.isfinite(value)
        and value == 0
    )


def _shell() -> dict[str, Any]:
    return {
        "diagnostic": "harris_commercial_building_area_readiness",
        "not_county_complete": True,
        "queryable": False,
        "verified_against_publisher": False,
        "publisher_content_checked": False,
        "coverage_claim": "field_diagnostic_only",
        "check_kind": "caller_supplied_format",
        "computed": False,
        "imputed": False,
        "substituted": False,
        "summed": False,
        "repair_claimed": False,
        "act_ar_recommended_commercial_fill": False,
        "county_fips": None,
        "jurisdiction_status": "unchecked",
        "status": "invalid",
        "commercial_candidate_label": None,
        "filled": None,
        "issues": [],
    }


def _add(issues: list[dict[str, str]], klass: str, code: str, field: str, message: str) -> None:
    item = {"class": klass, "code": code, "field": field, "message": message}
    if item not in issues:
        issues.append(item)


def _sort_issues(issues: list[dict[str, str]]) -> list[dict[str, str]]:
    return sorted(
        issues,
        key=lambda item: (
            _CLASS_ORDER.get(item["class"], 9),
            item["code"],
            item["field"],
            item["message"],
        ),
    )


def _finish(out: dict[str, Any], issues: list[dict[str, str]], status: str) -> dict[str, Any]:
    out["status"] = status
    out["issues"] = _sort_issues(issues)
    return out


def _note_owners(card: dict[str, Any], issues: list[dict[str, str]]) -> None:
    if any(key in card for key in _OWNER_KEYS):
        _add(issues, "refused", "owner_not_returned", "ownership", _OWNER_MESSAGE)


def _refuse_requested(name: str, issues: list[dict[str, str]]) -> None:
    known = _REFUSALS.get(name)
    if known:
        _add(issues, "refused", "unsupported", known[0], known[1])
        return
    _add(issues, "refused", "unsupported", "requested", _GENERIC)


def _label_of(source: dict[str, Any]) -> tuple[str, str | None]:
    if "label" not in source:
        return "absent", None
    label = source["label"]
    if label in ("base_ar", "Base Area"):
        return "recognized", label
    if label == "Building Area":
        if source.get("commercial") is True:
            return "recognized", "Building Area"
        return "building_rejected", None
    if isinstance(label, str) and label in _ACT_LABELS:
        return "act", None
    if isinstance(label, str) and label in _MONEY_LABELS:
        return "money", None
    if isinstance(label, str) and label in _ACRE_LABELS:
        return "acre", None
    return "unrecognized", None


def _has_competing_area(card: dict[str, Any] | None) -> bool:
    return card is not None and ("base_ar" in card or "label" in card or "value" in card)


def _fold(signals: list[str]) -> str:
    if "multi" in signals:
        return "multi"
    if "bad" in signals:
        return "bad"
    concrete = None
    for signal in signals:
        if signal not in ("none", "single"):
            continue
        if concrete is None:
            concrete = signal
        elif concrete != signal:
            return "contradiction"
    if concrete is None:
        return "unspecified"
    return "none" if concrete == "none" else "single"


def _note_commercial(card: dict[str, Any] | None, issues: list[dict[str, str]]) -> None:
    if card is not None and "commercial" in card and not isinstance(card["commercial"], bool):
        _add(issues, "invalid", "commercial", "commercial", _COMMERCIAL_TYPE)


def _note_side(card: dict[str, Any], row: dict[str, Any] | None, issues: list[dict[str, str]]) -> None:
    if "act_ar" in card or (row is not None and "act_ar" in row):
        _add(issues, "limitation", "act_ar", "act_ar", _ACT_AR)
    if any(key in card for key in _MONEY_KEYS) or (
        row is not None and any(key in row for key in _MONEY_KEYS)
    ):
        _add(issues, "limitation", "not_building_area", "market_value", _MONEY)
    card_kind = _label_of(card)[0]
    row_kind = _label_of(row)[0] if row is not None else "absent"
    if card_kind == "act" or row_kind == "act":
        _add(issues, "limitation", "act_ar", "act_ar", _ACT_AR)


def _unit_state(source: dict[str, Any]) -> str:
    if "unit" not in source:
        return "sf"
    return "sf" if source["unit"] == "sf" else "bad"


def _classify(value: Any, unit: str, issues: list[dict[str, str]]) -> str:
    if _blank(value):
        _add(issues, "invalid", "blank", "commercial_building_area", _BLANK)
        return "blank"
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        _add(issues, "invalid", "wrong_type", "commercial_building_area", _WRONG_TYPE)
        return "invalid"
    if not math.isfinite(value):
        _add(issues, "invalid", "non_finite", "commercial_building_area", _NON_FINITE)
        return "invalid"
    if unit == "bad":
        _add(issues, "invalid", "units", "commercial_building_area", _UNITS)
        return "units_unknown"
    if value == 0:
        _add(issues, "invalid", "zero", "commercial_building_area", _ZERO)
        return "zero"
    if value < 0:
        _add(issues, "invalid", "negative", "commercial_building_area", _NEGATIVE)
        return "invalid"
    if value > MAX_AREA_SF:
        _add(issues, "invalid", "implausible", "commercial_building_area", _IMPLAUSIBLE)
        return "invalid"
    return "filled_recognized"


def _filled_row(label: str, value: Any) -> dict[str, Any]:
    return {
        "field": label,
        "value": value,
        "unit": "sf",
        "definition": _DEFINITION,
        "evidence": "caller_supplied_format",
        "verified_against_publisher": False,
    }


def _bld_value(card: dict[str, Any], row: dict[str, Any] | None) -> Any:
    if "bld_ar" in card:
        return card["bld_ar"]
    if row is not None and "bld_ar" in row:
        return row["bld_ar"]
    return None


def _bld_present(card: dict[str, Any], row: dict[str, Any] | None) -> bool:
    return "bld_ar" in card or (row is not None and "bld_ar" in row)


def _note_bld(issues: list[dict[str, str]], present: bool, zero_bld: bool, filled: bool) -> None:
    if not present:
        return
    if filled and zero_bld:
        _add(issues, "limitation", "not_a_repair", "bld_ar", _NOT_REPAIR)
        return
    _add(issues, "limitation", "not_substituted", "bld_ar", _BLD_NOT_USED)


def _choose(card: dict[str, Any], row: dict[str, Any] | None) -> dict[str, Any]:
    row_has = _has_competing_area(row)
    if "base_ar" in card:
        return {
            "kind": "recognized",
            "source": card,
            "label": "base_ar",
            "second": "label" in card or "value" in card or row_has,
        }
    card_kind, card_label = _label_of(card)
    if card_kind == "recognized" and card_label is not None:
        return {
            "kind": "recognized",
            "source": card,
            "label": card_label,
            "second": row_has,
        }
    if row is not None and "base_ar" in row:
        return {
            "kind": "recognized",
            "source": row,
            "label": "base_ar",
            "second": card_kind != "absent" or "value" in card or "label" in row or "value" in row,
        }
    if row is not None:
        row_kind, row_label = _label_of(row)
        if row_kind == "recognized" and row_label is not None:
            return {
                "kind": "recognized",
                "source": row,
                "label": row_label,
                "second": card_kind != "absent" or "value" in card,
            }
    if card_kind == "act":
        return {"kind": "act"}
    if card_kind == "money":
        return {"kind": "money"}
    if card_kind == "building_rejected":
        return {"kind": "building_rejected"}
    if card_kind == "acre":
        return {"kind": "acre"}
    if card_kind == "unrecognized":
        return {"kind": "unrecognized"}
    if "value" in card:
        return {"kind": "unlabeled"}
    if "acreage" in card:
        return {"kind": "acreage"}
    if row is not None:
        row_kind = _label_of(row)[0]
        if row_kind == "act":
            return {"kind": "act"}
        if row_kind == "money":
            return {"kind": "money"}
        if row_kind == "building_rejected":
            return {"kind": "building_rejected"}
        if row_kind == "acre":
            return {"kind": "acre"}
        if row_kind == "unrecognized":
            return {"kind": "unrecognized"}
        if "value" in row:
            return {"kind": "unlabeled"}
        if "acreage" in row:
            return {"kind": "acreage"}
    return {"kind": "none"}


def _input_issue() -> dict[str, str]:
    return {"class": "invalid", "code": "input", "field": "input", "message": _INPUT_MESSAGE}


def harris_building_area_readiness(raw: Any) -> dict[str, Any]:
    """Format-check one caller-supplied Harris commercial building area. Not a valuation."""
    out = _shell()
    if not _is_object(raw):
        return _finish(out, [_input_issue()], "invalid")
    return _run(out, raw)


def _run(out: dict[str, Any], card: dict[str, Any]) -> dict[str, Any]:
    issues: list[dict[str, str]] = []
    _note_owners(card, issues)
    if any(key not in _CARD_KEYS for key in card):
        _add(issues, "invalid", "unknown_property", "input", _UNKNOWN_INPUT)

    fips = card.get("county_fips")
    if isinstance(fips, str) and _FIPS.fullmatch(fips):
        out["county_fips"] = fips
    if out["county_fips"] != HARRIS_FIPS:
        if isinstance(out["county_fips"], str):
            out["jurisdiction_status"] = "not_harris"
            _add(issues, "mismatched", "jurisdiction", "county_fips", _JURISDICTION)
            return _finish(out, issues, "not_harris")
        _add(issues, "invalid", "county_fips", "county_fips", _BAD_FIPS)
        return _finish(out, issues, "invalid")
    out["jurisdiction_status"] = "harris"

    _note_commercial(card, issues)
    if "requested" in card:
        requested = card["requested"]
        if not isinstance(requested, list):
            _add(issues, "invalid", "requested", "requested", _REQUESTED_TYPE)
            return _finish(out, issues, "invalid")
        if len(requested) > 0:
            for name in requested:
                if isinstance(name, str):
                    _refuse_requested(name, issues)
                else:
                    _add(issues, "refused", "unsupported", "requested", _GENERIC)
            return _finish(out, issues, "refused")

    if "aggregation_rule" in card:
        _add(issues, "limitation", "aggregation", "aggregation_rule", _AGGREGATION)

    signals: list[str] = []
    seen_row = None
    usable_row = None
    if "multi_building" in card:
        if card["multi_building"] is True:
            signals.append("multi")
        elif card["multi_building"] is not False:
            _add(issues, "invalid", "multi_building", "multi_building", _MULTI_TYPE)
            signals.append("bad")
    if "building_row_count" in card:
        count = card["building_row_count"]
        if not _is_int(count) or count < 0:
            _add(issues, "invalid", "row_count", "building_row_count", _ROW_COUNT_TYPE)
            signals.append("bad")
        elif count > 1:
            signals.append("multi")
        elif count == 0:
            signals.append("none")
        else:
            signals.append("single")
    if "building_rows" in card:
        rows = card["building_rows"]
        if not isinstance(rows, list):
            _add(issues, "invalid", "building_rows", "building_rows", _ROWS_TYPE)
            signals.append("bad")
        elif len(rows) > 1:
            signals.append("multi")
        elif len(rows) == 0:
            signals.append("none")
        else:
            first = rows[0]
            if not _is_object(first):
                _add(issues, "invalid", "row_shape", "building_rows", _ROW_SHAPE)
                signals.append("bad")
            else:
                seen_row = first
                _note_owners(first, issues)
                if any(key not in _ROW_KEYS for key in first):
                    _add(issues, "invalid", "unknown_property", "building_row", _UNKNOWN_ROW)
                    signals.append("single")
                else:
                    _note_commercial(first, issues)
                    signals.append("single")
                    usable_row = first

    kind = _fold(signals)
    if kind == "multi":
        _note_side(card, None, issues)
        _add(issues, "limitation", "multi_row", "building_rows", _MULTI)
        return _finish(out, issues, "multi_row_unknown")
    if kind == "bad":
        _note_side(card, seen_row, issues)
        return _finish(out, issues, "invalid")
    if kind == "contradiction":
        _note_side(card, seen_row, issues)
        _add(issues, "invalid", "row_contradiction", "building_rows", _ROW_CONTRADICTION)
        return _finish(out, issues, "invalid")
    if kind == "none":
        _note_side(card, None, issues)
        _add(issues, "missing", "no_building_row", "building_rows", _NO_ROW)
        return _finish(out, issues, "no_building_row")

    _note_side(card, seen_row if seen_row is not None else usable_row, issues)
    found = _choose(card, usable_row)
    present = _bld_present(card, usable_row)
    zero_bld = _exact_zero(_bld_value(card, usable_row))
    kind_found = found["kind"]

    if kind_found == "none":
        _add(issues, "missing", "absent", "commercial_building_area", _MISSING)
        _note_bld(issues, present, zero_bld, False)
        return _finish(out, issues, "missing")
    if kind_found == "act":
        _add(issues, "limitation", "act_ar", "act_ar", _ACT_AR)
        _note_bld(issues, present, zero_bld, False)
        return _finish(out, issues, "missing")
    if kind_found == "money":
        _add(issues, "invalid", "not_building_area", "commercial_building_area", _MONEY_LABEL)
        _note_bld(issues, present, zero_bld, False)
        return _finish(out, issues, "invalid")
    if kind_found == "building_rejected":
        _add(issues, "invalid", "not_commercial", "commercial_building_area", _NOT_COMMERCIAL)
        _note_bld(issues, present, zero_bld, False)
        return _finish(out, issues, "invalid")
    if kind_found in ("acre", "acreage"):
        _add(issues, "invalid", "units", "acreage", _ACREAGE_ONLY)
        _note_bld(issues, present, zero_bld, False)
        return _finish(out, issues, "units_unknown")
    if kind_found == "unrecognized":
        _add(issues, "limitation", "unrecognized_label", "commercial_building_area", _UNRECOGNIZED)
        _note_bld(issues, present, zero_bld, False)
        return _finish(out, issues, "missing")
    if kind_found == "unlabeled":
        _add(issues, "limitation", "unlabeled", "commercial_building_area", _UNLABELED)
        _note_bld(issues, present, zero_bld, False)
        return _finish(out, issues, "missing")

    source = found["source"]
    label = found["label"]
    if found["second"]:
        _add(issues, "limitation", "not_substituted", "commercial_building_area", _SECOND)
    if "acreage" in source or "acreage" in card or (usable_row is not None and "acreage" in usable_row):
        _add(issues, "limitation", "acres", "acreage", _ACREAGE_BESIDE)

    out["commercial_candidate_label"] = label
    if "base_ar" not in source and "value" not in source:
        _add(issues, "missing", "absent", "commercial_building_area", _MISSING)
        _note_bld(issues, present, zero_bld, False)
        return _finish(out, issues, "missing")
    value = source["base_ar"] if "base_ar" in source else source["value"]
    status = _classify(value, _unit_state(source), issues)
    if status == "filled_recognized" and kind == "single" and zero_bld:
        _add(issues, "limitation", "candidate_label_only", "commercial_building_area", _STRICT)
        return _finish(out, issues, "strict_single_row_base_ar_candidate_label_only")
    if status == "filled_recognized":
        out["filled"] = _filled_row(label, value)
        _note_bld(issues, present, zero_bld, True)
        return _finish(out, issues, "filled_recognized")
    _note_bld(issues, present, zero_bld, False)
    return _finish(out, issues, status)
