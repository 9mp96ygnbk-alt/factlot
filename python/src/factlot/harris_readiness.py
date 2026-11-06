"""Caller-supplied format check for one Harris unequal-appraisal subject.

Pure. No network, no database, and no valuation. A filled field means the caller
supplied a value in a recognized shape. It does not mean the figure was read from
Harris County, and it is not a county-complete extract. ``verified_against_publisher``
is always false. The 400-day as-of line is a local validation policy, not an official
refresh standard.
"""

from __future__ import annotations

import math
import re
from datetime import date
from typing import Any

HARRIS_FIPS = "201"
ROLL_SOURCE = "tx-harris-cad"
ROLL_FILE = "Real_acct_owner.zip"
BUILDINGS_SOURCE = "tx-harris-cad-buildings"
BUILDINGS_FILE = "Real_building_land.zip"
STALE_AFTER_DAYS = 400
MAX_VALUE_USD = 50_000_000_000
MAX_AREA_SF = 500_000_000
TAX_YEAR_MIN = 1982
TAX_YEAR_MAX = 2100

_HOUSTON_CITY = re.compile(r"(?:^|,\s*)HOUSTON(?:\s+TX\b|\s*,|\s*$)", re.IGNORECASE)
_FIPS = re.compile(r"\d{3}")
_SAFE_NAME = re.compile(r"[a-z][a-z0-9_.]{0,80}")
_CLASS_ORDER = {
    "invalid": 0,
    "mismatched": 1,
    "uncited": 2,
    "stale": 3,
    "missing": 4,
    "refused": 5,
    "limitation": 6,
}
_CARD_KEYS = {
    "evaluation_date",
    "county_fips",
    "tax_year",
    "prefer",
    "facts",
    "requested",
    "owner_name",
    "owner_mailing_address",
    "owner",
}
_FACT_KEYS = {
    "predicate",
    "value",
    "unit",
    "source_id",
    "filename",
    "locator",
    "tax_year",
    "as_of",
}
_OWNER_KEYS = ("owner_name", "owner_mailing_address", "owner")
_SENTINEL_CODES = {"", "0", "0.0", "0.00"}
_SUPPORTED = {
    "parcel.tax_year",
    "parcel.appraised_value",
    "parcel.market_value",
    "parcel.improvement_area_sf",
    "parcel.land_area_sf",
    "parcel.situs_address",
    "parcel.neighborhood_code",
    "parcel.building_class",
}

_LABEL = (
    "Recognized citation labels are source_id tx-harris-cad and filename Real_acct_owner.zip. "
    "A matching label is a format check only and does not verify the figure against the publisher."
)
_VALUE_DEFINITION = {
    "appraised": (
        "Caller-cited parcel.appraised_value in USD (the HCAD tot_appr_val shape). "
        + _LABEL
        + " Not taxable value, not a sale price, and not NOI."
    ),
    "market": (
        "Caller-cited parcel.market_value in USD (the HCAD tot_mkt_val shape). "
        + _LABEL
        + " Not an appraised value, not a sale price, and not NOI."
    ),
}
_AREA_DEFINITION = {
    "parcel.improvement_area_sf": (
        "Caller-cited parcel.improvement_area_sf in square feet (the HCAD bld_ar shape). "
        + _LABEL
        + " Not rentable area and not a sum of building-section im_sq_ft."
    ),
    "parcel.land_area_sf": (
        "Caller-cited parcel.land_area_sf in square feet. "
        + _LABEL
        + " The roll adapter may convert acreage when land_ar is 0; this diagnostic does not "
        "convert units and cannot tell which column was used."
    ),
}
_YEAR_DEFINITION = (
    "Caller-cited parcel.tax_year (the HCAD yr shape). "
    + _LABEL
    + " Not the snapshot as-of date."
)
_FIPS_DEFINITION = (
    "Caller county_fips matched 201 (Harris County, Texas), the appraisal district. "
    "Not a taxing unit, not a tax rate, and not a parcel fact from the roll. Not a publisher check."
)
_GENERIC = (
    "This diagnostic only checks the format of caller-cited Harris subject fields for "
    "calc.tx_unequal_appraisal. It does not evaluate that input, does not fetch it, and does not "
    "treat unknown as zero."
)
_OWNER_MESSAGE = "Owner names and mailing addresses are not read and are not returned."
_UNKNOWN_INPUT = (
    "The input includes a property this diagnostic does not accept. That property was ignored "
    "and was not copied into the result."
)
_UNKNOWN_FACT = (
    "A fact includes a property this diagnostic does not accept. That fact was not used and was "
    "not copied into the result."
)
_FETCH = " Nothing is fetched."
_REFUSALS = {
    "tax_rate": (
        "tax_rate",
        "No tax rate is evaluated. A rate would have to be the adopted rate of each taxing unit for "
        "this account and tax year. A county-wide rate is not assumed. Unknown is not zero." + _FETCH,
    ),
    "parcel.tax_rate": (
        "tax_rate",
        "No tax rate is evaluated. A rate would have to be the adopted rate of each taxing unit for "
        "this account and tax year. A county-wide rate is not assumed. Unknown is not zero." + _FETCH,
    ),
    "exemption": (
        "exemption",
        'Exemption eligibility is not determined. Unknown is not "no exemption".' + _FETCH,
    ),
    "parcel.exemption": (
        "exemption",
        'Exemption eligibility is not determined. Unknown is not "no exemption".' + _FETCH,
    ),
    "zoning": (
        "zoning",
        "Zoning is not mapped. Unknown is not unrestricted, and the lack of conventional zoning in "
        "the City of Houston is not applied to every Harris municipality." + _FETCH,
    ),
    "parcel.zoning": (
        "zoning",
        "Zoning is not mapped. Unknown is not unrestricted, and the lack of conventional zoning in "
        "the City of Houston is not applied to every Harris municipality." + _FETCH,
    ),
    "noi": ("noi", "NOI is not on the appraisal roll and is not inferred." + _FETCH),
    "parcel.noi": ("noi", "NOI is not on the appraisal roll and is not inferred." + _FETCH),
    "cap_rate": ("cap_rate", "A cap rate is not inferred from roll values." + _FETCH),
    "parcel.cap_rate": ("cap_rate", "A cap rate is not inferred from roll values." + _FETCH),
    "rent": ("rent", "Rent is not on the appraisal roll and is not inferred." + _FETCH),
    "parcel.rent": ("rent", "Rent is not on the appraisal roll and is not inferred." + _FETCH),
    "lease.rent": ("rent", "Rent is not on the appraisal roll and is not inferred." + _FETCH),
    "sale_price": ("sale_price", "No sale price is read. Roll market value is not a sale." + _FETCH),
    "parcel.sale_price": (
        "sale_price",
        "No sale price is read. Roll market value is not a sale." + _FETCH,
    ),
    "transaction.sale": (
        "sale_price",
        "No sale price is read. Roll market value is not a sale." + _FETCH,
    ),
    "taxable_value": (
        "taxable_value",
        "Taxable value after exemptions is not the appraised value and is not filled." + _FETCH,
    ),
    "parcel.taxable_value": (
        "taxable_value",
        "Taxable value after exemptions is not the appraised value and is not filled." + _FETCH,
    ),
    "circuit_breaker_23_231": (
        "circuit_breaker_23_231",
        "circuit_breaker_23_231 is not set. Exemption and section 23.231 status are not accepted here. "
        "The calculator default of false is not applied, because false would mean not subject rather than unknown.",
    ),
    "parcel.circuit_breaker": (
        "circuit_breaker_23_231",
        "circuit_breaker_23_231 is not set. Exemption and section 23.231 status are not accepted here. "
        "The calculator default of false is not applied, because false would mean not subject rather than unknown.",
    ),
}


def _empty_side() -> dict[str, Any]:
    return {"status": "absent", "value": None, "unit": None, "evidence": "none"}


def _shell() -> dict[str, Any]:
    return {
        "calculator": "calc.tx_unequal_appraisal",
        "calculator_version": 1,
        "not_county_complete": True,
        "queryable": False,
        "verified_against_publisher": False,
        "publisher_content_checked": False,
        "coverage_claim": "field_diagnostic_only",
        "check_kind": "caller_cited_format",
        "freshness_policy": "local_limit_400_days",
        "freshness_is_official_standard": False,
        "county_fips": None,
        "jurisdiction_status": "unchecked",
        "tax_year": None,
        "evaluation_date": None,
        "prefer": None,
        "selected_value": None,
        "appraised_value": _empty_side(),
        "market_value": _empty_side(),
        "filled": [],
        "normalize_by_supported": [],
        "issues": [],
    }


def _issue(bucket: list[dict[str, str]], klass: str, code: str, field: str, message: str) -> None:
    item = {"class": klass, "code": code, "field": field, "message": message}
    if item not in bucket:
        bucket.append(item)


def _sort_issues(issues: list[dict[str, str]]) -> list[dict[str, str]]:
    return sorted(issues, key=lambda item: (_CLASS_ORDER[item["class"]], item["code"], item["field"], item["message"]))


def _leap(year: int) -> bool:
    return (year % 4 == 0 and year % 100 != 0) or year % 400 == 0


def _parse_iso(value: Any) -> str | None:
    if not isinstance(value, str) or re.fullmatch(r"\d{4}-\d{2}-\d{2}", value) is None:
        return None
    year, month, day = (int(value[0:4]), int(value[5:7]), int(value[8:10]))
    if month < 1 or month > 12 or day < 1:
        return None
    dim = [31, 29 if _leap(year) else 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    if day > dim[month - 1]:
        return None
    try:
        date(year, month, day)
    except ValueError:
        return None
    return value


def _utc_days(iso: str) -> int:
    year, month, day = (int(iso[0:4]), int(iso[5:7]), int(iso[8:10]))
    return (date(year, month, day) - date(1970, 1, 1)).days


def _is_int(value: Any) -> bool:
    return isinstance(value, int) and not isinstance(value, bool)


def _is_number(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def _blank(value: Any) -> bool:
    return value is None or (isinstance(value, str) and value.strip() == "")


def _ownerish(predicate: Any) -> bool:
    return isinstance(predicate, str) and (
        predicate.startswith("ownership.") or predicate in ("owner_name", "owner_mailing_address")
    )


def _note_owners(raw: dict[str, Any], issues: list[dict[str, str]]) -> None:
    if any(key in raw for key in _OWNER_KEYS):
        _issue(issues, "refused", "owner_not_returned", "ownership", _OWNER_MESSAGE)
    facts = raw.get("facts")
    if not isinstance(facts, list):
        return
    for fact in facts:
        if isinstance(fact, dict) and _ownerish(fact.get("predicate")):
            _issue(issues, "refused", "owner_not_returned", "ownership", _OWNER_MESSAGE)


def _refuse_name(name: str, issues: list[dict[str, str]]) -> None:
    known = _REFUSALS.get(name)
    if known is not None:
        _issue(issues, "refused", "unsupported", known[0], known[1])
        return
    _issue(issues, "refused", "unsupported", "requested", _GENERIC)


def _unit_issue(predicate: str, unit: Any) -> tuple[str, str] | None:
    if predicate in ("parcel.appraised_value", "parcel.market_value"):
        if unit != "USD":
            return ("unit", f'{predicate} must use unit "USD". Other units are not converted, and a missing unit is not assumed.')
    elif predicate in ("parcel.improvement_area_sf", "parcel.land_area_sf"):
        if unit != "sf":
            return ("unit", f'{predicate} must use unit "sf" (square feet). Acres and other units are not converted.')
    elif predicate == "parcel.tax_year":
        if unit is not None and unit != "year":
            return ("unit", f'{predicate} unit must be "year" or omitted.')
    elif predicate == "parcel.building_class" and unit is not None:
        return ("unit", f"{predicate} does not take a unit. A class code is not an area.")
    elif predicate in ("parcel.situs_address", "parcel.neighborhood_code") and unit is not None:
        return ("unit", f"{predicate} does not take a numeric unit.")
    return None


def _citation_ok(fact: dict[str, Any]) -> bool:
    if not isinstance(fact.get("source_id"), str) or fact.get("source_id") == "":
        return False
    if not isinstance(fact.get("filename"), str) or fact.get("filename") == "":
        return False
    locator = fact.get("locator")
    if not isinstance(locator, str) or locator.strip() == "":
        return False
    if "as_of" not in fact or fact.get("as_of") is None or fact.get("as_of") == "":
        return False
    if "tax_year" not in fact or fact.get("tax_year") is None:
        return False
    return True


def _pair_for(predicate: str) -> tuple[str, str]:
    if predicate == "parcel.building_class":
        return (BUILDINGS_SOURCE, BUILDINGS_FILE)
    return (ROLL_SOURCE, ROLL_FILE)


def _screen_fact(fact: dict[str, Any], predicate: str, requested_year: int, evaluation: str) -> dict[str, str] | None:
    if not _citation_ok(fact):
        return {
            "class": "uncited",
            "code": "uncited",
            "field": predicate,
            "message": (
                f"{predicate} has no complete citation. source_id, filename, locator, tax_year, and as_of "
                "are required. An uncited figure is not filled."
            ),
        }
    if not _is_int(fact.get("tax_year")):
        return {
            "class": "invalid",
            "code": "tax_year_type",
            "field": predicate,
            "message": f"{predicate} tax_year must be an integer. Text is not coerced.",
        }
    source_id = fact.get("source_id")
    filename = fact.get("filename")
    if predicate == "parcel.improvement_area_sf" and source_id == BUILDINGS_SOURCE and filename == BUILDINGS_FILE:
        return {
            "class": "mismatched",
            "code": "semantic",
            "field": predicate,
            "message": (
                f"{predicate} is cited with the buildings-file labels. Section im_sq_ft is not the account "
                "improvement area and is not copied into it. The label is not a publisher check."
            ),
        }
    if predicate == "parcel.land_area_sf" and source_id == BUILDINGS_SOURCE and filename == BUILDINGS_FILE:
        return {
            "class": "mismatched",
            "code": "semantic",
            "field": predicate,
            "message": (
                f"{predicate} is cited with the buildings-file labels. Land area is not taken from building "
                "sections. The label is not a publisher check."
            ),
        }
    pair = _pair_for(predicate)
    if source_id != pair[0] or filename != pair[1]:
        return {
            "class": "mismatched",
            "code": "unrecognized_citation_label",
            "field": predicate,
            "message": (
                f"{predicate} source_id and filename are not the recognized citation labels for that predicate. "
                "A recognized label is still only caller-cited format and is not a publisher check."
            ),
        }
    as_of = _parse_iso(fact.get("as_of"))
    if as_of is None:
        return {
            "class": "invalid",
            "code": "bad_as_of",
            "field": predicate,
            "message": f"{predicate} as_of is not a real calendar date YYYY-MM-DD.",
        }
    if as_of > evaluation:
        return {
            "class": "invalid",
            "code": "future_as_of",
            "field": predicate,
            "message": f"{predicate} as_of is after evaluation_date, so it is not usable as caller-cited evidence.",
        }
    if _utc_days(evaluation) - _utc_days(as_of) > STALE_AFTER_DAYS:
        return {
            "class": "stale",
            "code": "stale",
            "field": predicate,
            "message": (
                f"{predicate} as_of is more than 400 days before evaluation_date. The 400-day line is a local "
                "validation policy, not an official refresh standard and not a certification that a newer file "
                "is current. The fact is not filled."
            ),
        }
    if fact.get("tax_year") != requested_year:
        return {
            "class": "mismatched",
            "code": "tax_year",
            "field": predicate,
            "message": f"{predicate} tax_year does not match the requested tax year. A different year's value is not mixed in.",
        }
    unit = fact.get("unit")
    if unit == "":
        unit = None
    problem = _unit_issue(predicate, unit)
    if problem is not None:
        return {"class": "mismatched", "code": problem[0], "field": predicate, "message": problem[1]}
    return None


def _amount_issue(predicate: str, value: Any, kind: str) -> dict[str, str] | None:
    if _blank(value):
        return {"class": "missing", "code": "blank", "field": predicate, "message": f"{predicate} is blank. Blank is not a value."}
    if isinstance(value, bool) or not _is_number(value):
        return {
            "class": "invalid",
            "code": "wrong_type",
            "field": predicate,
            "message": f"{predicate} must be a number. Text, booleans, and non-finite values are not coerced into a value.",
        }
    if value == 0:
        return {
            "class": "invalid",
            "code": "zero",
            "field": predicate,
            "message": f"{predicate} is 0. Zero is not a usable value and is not treated as missing.",
        }
    if value < 0:
        return {
            "class": "invalid",
            "code": "negative",
            "field": predicate,
            "message": f"{predicate} is negative. A negative figure is not a usable value.",
        }
    limit = MAX_VALUE_USD if kind == "usd" else MAX_AREA_SF
    if value > limit:
        line = (
            "50000000000 USD, the registry audit's implausible-value line"
            if kind == "usd"
            else "500000000 sf, the registry audit's implausible-area line"
        )
        return {"class": "invalid", "code": "implausible", "field": predicate, "message": f"{predicate} exceeds {line}. It is not filled."}
    return None


def _cite(fact: dict[str, Any]) -> dict[str, Any]:
    return {
        "evidence": "caller_cited_format",
        "source_label_recognized": True,
        "filename_label_recognized": True,
        "locator_present": True,
        "tax_year": fact["tax_year"],
        "as_of": fact["as_of"],
        "verified_against_publisher": False,
    }


def _filled_fact(field: str, value: Any, unit: str, definition: str, fact: dict[str, Any], basis: str | None = None) -> dict[str, Any]:
    row = {
        "field": field,
        "value": value,
        "unit": unit,
        "definition": definition,
        "evidence": "caller_cited_format",
        "verified_against_publisher": False,
        "citation": _cite(fact),
    }
    if basis is not None:
        row["basis"] = basis
    return row


def _neighborhood_sentinel(value: Any) -> bool:
    if _blank(value):
        return True
    if _is_number(value) and value == 0:
        return True
    return isinstance(value, str) and value.strip() in _SENTINEL_CODES


def _fips_row() -> dict[str, Any]:
    return {
        "field": "subject.county_fips",
        "value": HARRIS_FIPS,
        "unit": None,
        "definition": _FIPS_DEFINITION,
        "evidence": "caller_asserted_jurisdiction",
        "verified_against_publisher": False,
        "citation": {
            "evidence": "caller_asserted_jurisdiction",
            "source_label_recognized": False,
            "filename_label_recognized": False,
            "locator_present": False,
            "tax_year": None,
            "as_of": None,
            "verified_against_publisher": False,
        },
    }


def harris_readiness(raw: Any) -> dict[str, Any]:
    """Format-check one caller-supplied card for calc.tx_unequal_appraisal's subject fields."""
    out = _shell()
    issues: list[dict[str, str]] = []
    if not isinstance(raw, dict):
        _issue(issues, "invalid", "input", "input", "input must be an object of caller-supplied fields.")
        out["issues"] = _sort_issues(issues)
        return out
    _note_owners(raw, issues)
    if any(key not in _CARD_KEYS for key in raw):
        _issue(issues, "invalid", "unknown_property", "input", _UNKNOWN_INPUT)
    requested = raw.get("requested", [])
    if requested is None:
        requested = []
    if not isinstance(requested, list):
        _issue(issues, "invalid", "requested", "requested", "requested must be a list of field names when it is present.")
        requested = []
    for name in requested:
        if isinstance(name, str):
            _refuse_name(name, issues)
        else:
            _issue(issues, "refused", "unsupported", "requested", _GENERIC)
    evaluation = _parse_iso(raw.get("evaluation_date"))
    if evaluation is None:
        _issue(
            issues,
            "invalid",
            "evaluation_date",
            "evaluation_date",
            "evaluation_date must be a real calendar date YYYY-MM-DD. The diagnostic does not substitute today's date.",
        )
        out["issues"] = _sort_issues(issues)
        return out
    out["evaluation_date"] = evaluation
    fips = raw.get("county_fips")
    if isinstance(fips, str) and _FIPS.fullmatch(fips):
        out["county_fips"] = fips
    if out["county_fips"] != HARRIS_FIPS:
        out["jurisdiction_status"] = "not_harris"
        _issue(
            issues,
            "mismatched",
            "jurisdiction",
            "county_fips",
            "This diagnostic is only for Harris County, Texas (FIPS 201). It does not assess other counties, "
            "does not use their published counts, and does not acquire their data.",
        )
        out["issues"] = _sort_issues(issues)
        return out
    out["jurisdiction_status"] = "harris"
    tax_year = raw.get("tax_year")
    if not _is_int(tax_year) or not (TAX_YEAR_MIN <= tax_year <= TAX_YEAR_MAX):
        _issue(
            issues,
            "invalid",
            "tax_year",
            "tax_year",
            "tax_year must be an integer from 1982 through 2100, the range calc.tx_unequal_appraisal accepts. "
            "A numeric string is not coerced.",
        )
        out["issues"] = _sort_issues(issues)
        return out
    out["tax_year"] = tax_year
    prefer = raw["prefer"] if "prefer" in raw else "appraised"
    if prefer not in ("appraised", "market"):
        _issue(issues, "invalid", "prefer", "prefer", 'prefer must be "appraised" or "market".')
        prefer = None
    out["prefer"] = prefer
    facts = raw.get("facts", [])
    if facts is None:
        facts = []
    if not isinstance(facts, list):
        _issue(issues, "invalid", "facts", "facts", "facts must be a list of caller-supplied fact objects.")
        facts = []
    grouped: dict[str, list[dict[str, Any]]] = {}
    for fact in facts:
        if not isinstance(fact, dict):
            _issue(issues, "invalid", "fact_shape", "facts", "Each fact must be an object. That entry was skipped.")
            continue
        if any(key not in _FACT_KEYS for key in fact):
            _issue(issues, "invalid", "unknown_property", "fact", _UNKNOWN_FACT)
            continue
        predicate = fact.get("predicate")
        if not isinstance(predicate, str) or _SAFE_NAME.fullmatch(predicate) is None:
            _issue(issues, "refused", "unsupported", "requested", _GENERIC)
            continue
        if _ownerish(predicate):
            continue
        if predicate in _REFUSALS or predicate not in _SUPPORTED:
            _refuse_name(predicate, issues)
            continue
        grouped.setdefault(predicate, []).append(fact)
    accepted: dict[str, dict[str, Any]] = {}

    def take(predicate: str) -> dict[str, Any] | None:
        rows = grouped.get(predicate, [])
        if not rows:
            return None
        if len(rows) > 1:
            _issue(issues, "mismatched", "duplicate", predicate, f"More than one {predicate} fact was supplied. None was selected.")
            return None
        fact = rows[0]
        if predicate == "parcel.neighborhood_code" and _neighborhood_sentinel(fact.get("value")):
            _issue(issues, "invalid", "not_a_code", predicate, "Neighborhood code 0.00 or blank is not a code. It is not stored as a neighborhood.")
            return None
        if predicate == "parcel.building_class" and _is_number(fact.get("value")):
            _issue(issues, "invalid", "wrong_type", predicate, "parcel.building_class must be text. A number is not improvement area and is not converted.")
            return None
        problem = _screen_fact(fact, predicate, tax_year, evaluation)
        if problem is not None:
            _issue(issues, problem["class"], problem["code"], problem["field"], problem["message"])
            return None
        value = fact.get("value")
        if predicate in ("parcel.appraised_value", "parcel.market_value"):
            amount = _amount_issue(predicate, value, "usd")
            if amount is not None:
                _issue(issues, amount["class"], amount["code"], amount["field"], amount["message"])
                return None
        elif predicate in ("parcel.improvement_area_sf", "parcel.land_area_sf"):
            amount = _amount_issue(predicate, value, "sf")
            if amount is not None:
                _issue(issues, amount["class"], amount["code"], amount["field"], amount["message"])
                return None
        elif predicate == "parcel.tax_year":
            if not _is_int(value):
                _issue(
                    issues,
                    "invalid",
                    "wrong_type",
                    predicate,
                    f"{predicate} must be an integer. Text, booleans, and non-finite values are not coerced into a value.",
                )
                return None
            if value != tax_year:
                _issue(
                    issues,
                    "mismatched",
                    "tax_year",
                    predicate,
                    f"{predicate} tax_year does not match the requested tax year. A different year's value is not mixed in.",
                )
                return None
        elif predicate in ("parcel.situs_address", "parcel.neighborhood_code"):
            if not isinstance(value, str) or value.strip() == "":
                _issue(issues, "invalid", "wrong_type", predicate, f"{predicate} must be text.")
                return None
        elif predicate == "parcel.building_class":
            if not isinstance(value, str) or value.strip() == "":
                _issue(issues, "invalid", "blank", predicate, "parcel.building_class is blank. Blank is not a class.")
                return None
        return fact

    for predicate in (
        "parcel.tax_year",
        "parcel.appraised_value",
        "parcel.market_value",
        "parcel.improvement_area_sf",
        "parcel.land_area_sf",
        "parcel.situs_address",
        "parcel.neighborhood_code",
        "parcel.building_class",
    ):
        got = take(predicate)
        if got is not None:
            accepted[predicate] = got
    if "parcel.tax_year" not in grouped:
        _issue(
            issues,
            "missing",
            "tax_year",
            "subject.tax_year",
            "parcel.tax_year is absent, so subject.tax_year is not filled. The requested tax year is not copied in as a fact.",
        )
    if "parcel.improvement_area_sf" not in grouped:
        _issue(
            issues,
            "missing",
            "area",
            "subject.improvement_area_sf",
            "parcel.improvement_area_sf is absent. normalize_by improvement_area_sf is blocked. Land area is not copied into it.",
        )
    if "parcel.land_area_sf" not in grouped:
        _issue(
            issues,
            "missing",
            "area",
            "subject.land_area_sf",
            "parcel.land_area_sf is absent. normalize_by land_area_sf is blocked. Improvement area is not copied into it.",
        )

    def side(predicate: str, present: bool) -> dict[str, Any]:
        if predicate not in grouped:
            return _empty_side()
        if not present:
            return {"status": "not_filled", "value": None, "unit": None, "evidence": "none"}
        return {
            "status": "caller_cited",
            "value": accepted[predicate]["value"],
            "unit": "USD",
            "evidence": "caller_cited_format",
        }

    appraised_ok = "parcel.appraised_value" in accepted
    market_ok = "parcel.market_value" in accepted
    out["appraised_value"] = side("parcel.appraised_value", appraised_ok)
    out["market_value"] = side("parcel.market_value", market_ok)
    selected_basis = None
    if prefer == "market" and market_ok:
        selected_basis = "market"
        out["market_value"]["status"] = "selected"
        if appraised_ok:
            out["appraised_value"]["status"] = "not_used"
    elif prefer == "appraised" and appraised_ok:
        selected_basis = "appraised"
        out["appraised_value"]["status"] = "selected"
        if market_ok:
            out["market_value"]["status"] = "not_used"
    elif market_ok and not appraised_ok:
        out["market_value"]["status"] = "available_not_selected"
    if selected_basis is None:
        _issue(
            issues,
            "missing",
            "value",
            "subject.value",
            "subject.value is not filled. No appraised value passed the caller-cited format checks, and market value was not relabeled as appraised.",
        )
    else:
        fact = accepted["parcel.market_value" if selected_basis == "market" else "parcel.appraised_value"]
        because = "caller_selected_market" if selected_basis == "market" else "statutory_comparison_uses_appraised"
        out["selected_value"] = {
            "field": "subject.value",
            "basis": selected_basis,
            "value": fact["value"],
            "unit": "USD",
            "evidence": "caller_cited_format",
            "selected_because": because,
            "verified_against_publisher": False,
        }
    filled = [_fips_row()]
    if "parcel.improvement_area_sf" in accepted:
        fact = accepted["parcel.improvement_area_sf"]
        filled.append(_filled_fact("subject.improvement_area_sf", fact["value"], "sf", _AREA_DEFINITION["parcel.improvement_area_sf"], fact))
    if "parcel.land_area_sf" in accepted:
        fact = accepted["parcel.land_area_sf"]
        filled.append(_filled_fact("subject.land_area_sf", fact["value"], "sf", _AREA_DEFINITION["parcel.land_area_sf"], fact))
    if "parcel.tax_year" in accepted:
        fact = accepted["parcel.tax_year"]
        filled.append(_filled_fact("subject.tax_year", fact["value"], "year", _YEAR_DEFINITION, fact))
    if selected_basis is not None:
        fact = accepted["parcel.market_value" if selected_basis == "market" else "parcel.appraised_value"]
        filled.append(_filled_fact("subject.value", fact["value"], "USD", _VALUE_DEFINITION[selected_basis], fact, selected_basis))
    out["filled"] = sorted(filled, key=lambda item: item["field"])
    supported = ["none"] if selected_basis is not None else []
    if selected_basis is not None and "parcel.improvement_area_sf" in accepted:
        supported.append("improvement_area_sf")
    if selected_basis is not None and "parcel.land_area_sf" in accepted:
        supported.append("land_area_sf")
    out["normalize_by_supported"] = supported
    situs = accepted.get("parcel.situs_address")
    if situs is not None and _HOUSTON_CITY.search(situs["value"]):
        _issue(
            issues,
            "limitation",
            "houston_zoning",
            "zoning",
            "Situs city is Houston. The City of Houston does not use a conventional zoning ordinance. "
            "That is not a fact that this parcel is unzoned, and it does not describe other municipalities "
            "in Harris County. This diagnostic does not assign a zoning district.",
        )
    if "parcel.neighborhood_code" in accepted:
        _issue(
            issues,
            "limitation",
            "neighborhood_not_subject",
            "parcel.neighborhood_code",
            "A neighborhood code passed the caller-cited format checks. It is not an unequal-appraisal subject field, "
            "it was not checked against HCAD's neighborhood list, and the code is not repeated here.",
        )
    if "parcel.building_class" in accepted:
        _issue(
            issues,
            "limitation",
            "building_class_not_area",
            "parcel.building_class",
            "A building class passed the caller-cited format checks. It is not an unequal-appraisal subject field, "
            "it is not an area, and the class text is not repeated here.",
        )
    out["issues"] = _sort_issues(issues)
    return out
