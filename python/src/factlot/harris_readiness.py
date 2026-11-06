"""Caller-supplied readiness for one Harris unequal-appraisal subject.

Pure. No network, no database, and no valuation. A filled field is a cited
roll figure the caller already holds. It is not a county-complete extract and
not a hosted lookup. See docs/registry/quality/harris-calculator-input-audit.md.
"""

from __future__ import annotations

import re
from datetime import date
from typing import Any

CALCULATOR = "calc.tx_unequal_appraisal"
CALCULATOR_VERSION = 1
HARRIS_FIPS = "201"
ROLL_SOURCE = "tx-harris-cad"
ROLL_FILE = "Real_acct_owner.zip"
BUILDINGS_SOURCE = "tx-harris-cad-buildings"
BUILDINGS_FILE = "Real_building_land.zip"
# Same age line the registry audit warns on. Above 400 days is not filled.
STALE_AFTER_DAYS = 400
MAX_VALUE_USD = 50_000_000_000
MAX_AREA_SF = 500_000_000
TAX_YEAR_MIN = 1982
TAX_YEAR_MAX = 2100
AUDIT_FILE = "docs/registry/quality/audit-2026-11-03/after-texas.json"

_HOUSTON_CITY = re.compile(r"(?:^|,\s*)HOUSTON(?:\s+TX\b|\s*,|\s*$)", re.IGNORECASE)
_FIPS = re.compile(r"^\d{3}$")
_SAFE_NAME = re.compile(r"^[a-z][a-z0-9_.]{0,80}$")
_CLASS_ORDER = {
    "invalid": 0,
    "mismatched": 1,
    "uncited": 2,
    "stale": 3,
    "missing": 4,
    "refused": 5,
    "limitation": 6,
}
_OWNER_KEYS = ("owner_name", "owner_mailing_address", "owner")
_OWNER_PREDICATES = {"owner_name", "owner_mailing_address"}
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

_REFUSALS = {
    "tax_rate": (
        "tax_rate",
        "No tax rate is evaluated. A rate would have to be the adopted rate of each taxing unit "
        "for this account and tax year. A county-wide rate is not assumed. Unknown is not zero.",
    ),
    "parcel.tax_rate": (
        "tax_rate",
        "No tax rate is evaluated. A rate would have to be the adopted rate of each taxing unit "
        "for this account and tax year. A county-wide rate is not assumed. Unknown is not zero.",
    ),
    "exemption": (
        "exemption",
        'Exemption eligibility is not determined. Unknown is not "no exemption".',
    ),
    "parcel.exemption": (
        "exemption",
        'Exemption eligibility is not determined. Unknown is not "no exemption".',
    ),
    "zoning": (
        "zoning",
        "Zoning is not mapped. Unknown is not unrestricted, and the lack of conventional zoning "
        "in the City of Houston is not applied to every Harris municipality.",
    ),
    "parcel.zoning": (
        "zoning",
        "Zoning is not mapped. Unknown is not unrestricted, and the lack of conventional zoning "
        "in the City of Houston is not applied to every Harris municipality.",
    ),
    "noi": ("noi", "NOI is not on the appraisal roll and is not inferred."),
    "parcel.noi": ("noi", "NOI is not on the appraisal roll and is not inferred."),
    "cap_rate": ("cap_rate", "A cap rate is not inferred from roll values."),
    "parcel.cap_rate": ("cap_rate", "A cap rate is not inferred from roll values."),
    "rent": ("rent", "Rent is not on the appraisal roll and is not inferred."),
    "parcel.rent": ("rent", "Rent is not on the appraisal roll and is not inferred."),
    "lease.rent": ("rent", "Rent is not on the appraisal roll and is not inferred."),
    "sale_price": ("sale_price", "No sale price is read. Roll market value is not a sale."),
    "parcel.sale_price": ("sale_price", "No sale price is read. Roll market value is not a sale."),
    "transaction.sale": ("sale_price", "No sale price is read. Roll market value is not a sale."),
    "taxable_value": (
        "taxable_value",
        "Taxable value after exemptions is not the appraised value and is not filled.",
    ),
    "parcel.taxable_value": (
        "taxable_value",
        "Taxable value after exemptions is not the appraised value and is not filled.",
    ),
    "circuit_breaker_23_231": (
        "circuit_breaker_23_231",
        "circuit_breaker_23_231 is not set. Exemption and section 23.231 status are not accepted "
        "here. The calculator default of false is not applied, because false would mean not "
        "subject rather than unknown.",
    ),
    "parcel.circuit_breaker": (
        "circuit_breaker_23_231",
        "circuit_breaker_23_231 is not set. Exemption and section 23.231 status are not accepted "
        "here. The calculator default of false is not applied, because false would mean not "
        "subject rather than unknown.",
    ),
}

_VALUE_DEFINITION = {
    "appraised": (
        "Roll appraised value (HCAD tot_appr_val as parcel.appraised_value), USD. "
        "Not taxable value, not a sale price, and not NOI."
    ),
    "market": (
        "Roll market value (HCAD tot_mkt_val as parcel.market_value), USD. "
        "Not an appraised value, not a sale price, and not NOI."
    ),
}
_AREA_DEFINITION = {
    "parcel.improvement_area_sf": (
        "Account improvement area (HCAD bld_ar as parcel.improvement_area_sf), square feet. "
        "Not rentable area and not a sum of building-section im_sq_ft."
    ),
    "parcel.land_area_sf": (
        "Account land area in square feet as stored (parcel.land_area_sf). The roll adapter may "
        "have converted acreage when land_ar was 0. This diagnostic does not convert units and "
        "cannot tell which column was used."
    ),
}

# Copied from docs/registry/quality/audit-2026-11-03/after-texas.json. Not remeasured.
_FIGURES = "Figures are copied from docs/registry/quality/audit-2026-11-03/after-texas.json. This function does not remeasure them and does not download anything."
_NOT_COMPLETE = "Not county-complete. The counts are the commercial extract in that audit (state categories B, F1, and F2), not every account in the county."
_NOT_QUERY = "Not queryable. Hosted lookup is not opened by this diagnostic."
_REDIST = "Redistribution is unknown and is not treated as granted."
_OUTSIDE = "Tax rates, exemptions, taxable value, sales, rent, NOI, cap rates, and zoning are outside this diagnostic. Unknown is not zero."
_ATTEST_OK = "Caller attestation matches those published figures. parcel_count and audit_violations were ignored. Neither a parcel count nor zero audit violations certifies the county."
_ATTEST_BAD = "Caller attestation does not match the published audit. The caller's figures were not adopted."

_PUBLISHED = {
    "201": {
        "status": "cited_subject_fields_only",
        "source_id": ROLL_SOURCE,
        "as_of": "2026-11-01",
        "license_reviewed": "2026-11-02",
        "redistribution": "unknown",
        "fields": {
            "parcel.appraised_value": {"present": 87462, "missing": 255},
            "parcel.improvement_area_sf": {"present": 75796, "missing": 11921},
            "parcel.market_value": {"present": 87462, "missing": 255},
            "parcel.tax_year": {"present": 87717, "missing": 0},
        },
        "blockers": [
            _FIGURES,
            _NOT_COMPLETE,
            _NOT_QUERY,
            _REDIST,
            _OUTSIDE,
            "parcel.appraised_value is missing on 255 accounts in the published audit. Market value is not a substitute.",
            "parcel.improvement_area_sf is missing on 11921 accounts in the published audit. Those accounts cannot be normalized by improvement area.",
        ],
    },
    "453": {
        "status": "cited_subject_fields_only",
        "source_id": "tx-travis-cad",
        "as_of": "2026-10-06",
        "license_reviewed": "2026-11-02",
        "redistribution": "unknown",
        "fields": {
            "parcel.appraised_value": {"present": 30555, "missing": 0},
            "parcel.improvement_area_sf": {"present": 29150, "missing": 1405},
            "parcel.market_value": {"present": 30555, "missing": 0},
            "parcel.tax_year": {"present": 30555, "missing": 0},
        },
        "blockers": [
            _FIGURES,
            _NOT_COMPLETE,
            _NOT_QUERY,
            _REDIST,
            _OUTSIDE,
            "The current snapshot in that audit is as_of 2026-10-06. An older 2026-07-18 snapshot is in the same file and is not the figure used here.",
            "parcel.improvement_area_sf is missing on 1405 accounts in the current extract.",
        ],
    },
    "085": {
        "status": "cited_subject_fields_only",
        "source_id": "tx-collin-cad",
        "as_of": "2026-11-02",
        "license_reviewed": "2026-11-02",
        "redistribution": "unknown",
        "fields": {
            "parcel.appraised_value": {"present": 17795, "missing": 240},
            "parcel.improvement_area_sf": {"present": 17125, "missing": 910},
            "parcel.market_value": {"present": 17795, "missing": 240},
            "parcel.tax_year": {"present": 17795, "missing": 240},
        },
        "blockers": [
            _FIGURES,
            _NOT_COMPLETE,
            _NOT_QUERY,
            _REDIST,
            _OUTSIDE,
            "parcel.tax_year is missing on 240 accounts in the published audit. Those accounts must not be given a guessed tax year.",
            "parcel.appraised_value is missing on 240 accounts in the published audit. Market value is not a substitute.",
            "parcel.improvement_area_sf is missing on 910 accounts in the published audit.",
        ],
    },
    "113": {
        "status": "not_ready",
        "source_id": "tx-dallas-cad",
        "as_of": "2026-10-12",
        "license_reviewed": "2026-11-02",
        "redistribution": "unknown",
        "fields": {
            "parcel.appraised_value": {"present": 0, "missing": 59645},
            "parcel.improvement_area_sf": {"present": 59292, "missing": 353},
            "parcel.market_value": {"present": 59645, "missing": 0},
            "parcel.tax_year": {"present": 59645, "missing": 0},
        },
        "blockers": [
            _FIGURES,
            "Not ready for the appraised-value subject. parcel.appraised_value is present on 0 accounts and missing on 59645 in the published audit.",
            "parcel.market_value is present on 59645 accounts. It is not relabeled as appraised value.",
            "Not queryable and not county-complete. This diagnostic does not download Dallas.",
        ],
    },
    "439": {
        "status": "not_ready",
        "source_id": "tx-tarrant-ad",
        "as_of": "2026-11-02",
        "license_reviewed": "2026-11-02",
        "redistribution": "unknown",
        "fields": {
            "parcel.appraised_value": {"present": 44934, "missing": 1042},
            "parcel.improvement_area_sf": {"present": 39635, "missing": 6341},
            "parcel.market_value": {"present": 44934, "missing": 1042},
            "parcel.tax_year": {"present": 45976, "missing": 0},
        },
        "blockers": [
            _FIGURES,
            "Not ready. Tarrant Appraisal District data is not served to agents until that district's published signals allow it. Field counts do not lift the hold.",
            "Not queryable and not county-complete. This diagnostic does not download Tarrant.",
        ],
    },
}


def _empty_side() -> dict[str, Any]:
    return {"status": "absent", "value": None, "unit": None}


def _shell() -> dict[str, Any]:
    return {
        "calculator": CALCULATOR,
        "calculator_version": CALCULATOR_VERSION,
        "not_county_complete": True,
        "queryable": False,
        "verified_against_publisher": False,
        "coverage_claim": "field_diagnostic_only",
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
    return sorted(issues, key=lambda i: (_CLASS_ORDER[i["class"]], i["code"], i["field"], i["message"]))


def _leap(year: int) -> bool:
    return (year % 4 == 0 and year % 100 != 0) or year % 400 == 0


def _parse_iso(value: Any) -> date | None:
    if not isinstance(value, str) or len(value) != 10 or value[4] != "-" or value[7] != "-":
        return None
    if not (value[:4].isdigit() and value[5:7].isdigit() and value[8:].isdigit()):
        return None
    year, month, day = int(value[:4]), int(value[5:7]), int(value[8:])
    if month < 1 or month > 12 or day < 1:
        return None
    dim = [31, 29 if _leap(year) else 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    if day > dim[month - 1]:
        return None
    return date(year, month, day)


def _is_int(value: Any) -> bool:
    return isinstance(value, int) and not isinstance(value, bool)


def _is_number(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and value == value and value not in (float("inf"), float("-inf"))


def _blank(value: Any) -> bool:
    return value is None or (isinstance(value, str) and value.strip() == "")


def _ownerish(predicate: Any) -> bool:
    return isinstance(predicate, str) and (predicate.startswith("ownership.") or predicate in _OWNER_PREDICATES)


def _note_owners(raw: dict[str, Any], issues: list[dict[str, str]]) -> None:
    if any(key in raw for key in _OWNER_KEYS):
        _issue(issues, "refused", "owner_not_returned", "ownership", "Owner names and mailing addresses are not read and are not returned.")
    facts = raw.get("facts")
    if not isinstance(facts, list):
        return
    for fact in facts:
        if isinstance(fact, dict) and _ownerish(fact.get("predicate")):
            _issue(issues, "refused", "owner_not_returned", "ownership", "Owner names and mailing addresses are not read and are not returned.")


def _refuse_name(name: str, issues: list[dict[str, str]]) -> None:
    if name in _REFUSALS:
        field, message = _REFUSALS[name]
        _issue(issues, "refused", "unsupported", field, message)
        return
    field = name if _SAFE_NAME.fullmatch(name) else "fact"
    _issue(
        issues,
        "refused",
        "unsupported",
        field,
        "This diagnostic only checks cited Harris subject fields for calc.tx_unequal_appraisal. "
        "It does not evaluate that input, and unknown is not zero.",
    )


def _unit_issue(predicate: str, unit: Any) -> tuple[str, str] | None:
    if predicate in ("parcel.appraised_value", "parcel.market_value"):
        if unit != "USD":
            return ("unit", f'{predicate} must use unit "USD". Other units are not converted, and a missing unit is not assumed.')
    elif predicate in ("parcel.improvement_area_sf", "parcel.land_area_sf"):
        if unit != "sf":
            return ("unit", f'{predicate} must use unit "sf" (square feet). Acres and other units are not converted.')
    elif predicate == "parcel.tax_year":
        if unit not in (None, "year"):
            return ("unit", f'{predicate} unit must be "year" or omitted.')
    elif predicate == "parcel.building_class" and unit not in (None,):
        return ("unit", f"{predicate} does not take a unit. A class code is not an area.")
    elif predicate in ("parcel.situs_address", "parcel.neighborhood_code") and unit not in (None,):
        return ("unit", f"{predicate} does not take a numeric unit.")
    return None


def _citation_ok(fact: dict[str, Any]) -> bool:
    if not isinstance(fact.get("source_id"), str) or fact["source_id"] == "":
        return False
    if not isinstance(fact.get("filename"), str) or fact["filename"] == "":
        return False
    locator = fact.get("locator")
    if not isinstance(locator, str) or locator.strip() == "":
        return False
    if _parse_iso(fact.get("as_of")) is None and not isinstance(fact.get("as_of"), str):
        return False
    if "as_of" not in fact or fact.get("as_of") in (None, ""):
        return False
    if "tax_year" not in fact or fact.get("tax_year") is None:
        return False
    return True


def _screen_fact(fact: dict[str, Any], predicate: str, requested_year: int, evaluation: date, pair: tuple[str, str]) -> dict[str, str] | None:
    """Return an issue if the fact cannot be used, else None. Does not read owner text."""
    if not _citation_ok(fact):
        return {"class": "uncited", "code": "uncited", "field": predicate,
                "message": f"{predicate} has no complete citation. source_id, filename, locator, tax_year, and as_of are required. An uncited figure is not filled."}
    tax_meta = fact.get("tax_year")
    if not _is_int(tax_meta):
        return {"class": "invalid", "code": "tax_year_type", "field": predicate,
                "message": f"{predicate} tax_year must be an integer. Text is not coerced."}
    source_id, filename = fact.get("source_id"), fact.get("filename")
    if predicate == "parcel.improvement_area_sf" and (source_id, filename) == (BUILDINGS_SOURCE, BUILDINGS_FILE):
        return {"class": "mismatched", "code": "semantic", "field": predicate,
                "message": f"{predicate} is cited to the buildings file. Section im_sq_ft is not the account improvement area and is not copied into it."}
    if predicate == "parcel.land_area_sf" and (source_id, filename) == (BUILDINGS_SOURCE, BUILDINGS_FILE):
        return {"class": "mismatched", "code": "semantic", "field": predicate,
                "message": f"{predicate} is cited to the buildings file. Land area is not taken from building sections."}
    if (source_id, filename) != pair:
        return {"class": "mismatched", "code": "untrusted_source", "field": predicate,
                "message": f"{predicate} does not cite the known Harris source and filename for this predicate. Other metadata is not treated as verified evidence."}
    as_of = _parse_iso(fact.get("as_of"))
    if as_of is None:
        return {"class": "invalid", "code": "bad_as_of", "field": predicate,
                "message": f"{predicate} as_of is not a real calendar date YYYY-MM-DD."}
    if as_of > evaluation:
        return {"class": "invalid", "code": "future_as_of", "field": predicate,
                "message": f"{predicate} as_of is after evaluation_date, so it is not usable evidence."}
    if (evaluation - as_of).days > STALE_AFTER_DAYS:
        return {"class": "stale", "code": "stale", "field": predicate,
                "message": f"{predicate} as_of is more than 400 days before evaluation_date. The registry audit warns above 400 days. A stale fact is not filled."}
    if tax_meta != requested_year:
        return {"class": "mismatched", "code": "tax_year", "field": predicate,
                "message": f"{predicate} tax_year does not match the requested tax year. A different year's value is not mixed in."}
    unit = fact.get("unit", None)
    if unit == "":
        unit = None
    unit_problem = _unit_issue(predicate, unit)
    if unit_problem is not None:
        code, message = unit_problem
        return {"class": "mismatched", "code": code, "field": predicate, "message": message}
    return None


def _amount_issue(predicate: str, value: Any, kind: str) -> dict[str, str] | None:
    if _blank(value):
        return {"class": "missing", "code": "blank", "field": predicate, "message": f"{predicate} is blank. Blank is not a value."}
    if isinstance(value, bool) or not _is_number(value):
        return {"class": "invalid", "code": "wrong_type", "field": predicate,
                "message": f"{predicate} must be a number. Text and booleans are not coerced into a value."}
    if value == 0:
        return {"class": "invalid", "code": "zero", "field": predicate, "message": f"{predicate} is 0. Zero is not a usable value."}
    if value < 0:
        return {"class": "invalid", "code": "negative", "field": predicate, "message": f"{predicate} is negative. A negative figure is not a usable value."}
    limit = MAX_VALUE_USD if kind == "usd" else MAX_AREA_SF
    if value > limit:
        line = "50000000000 USD, the registry audit's implausible-value line" if kind == "usd" else "500000000 sf, the registry audit's implausible-area line"
        return {"class": "invalid", "code": "implausible", "field": predicate, "message": f"{predicate} exceeds {line}. It is not filled."}
    return None


def _pair_for(predicate: str) -> tuple[str, str]:
    if predicate == "parcel.building_class":
        return (BUILDINGS_SOURCE, BUILDINGS_FILE)
    return (ROLL_SOURCE, ROLL_FILE)


def _cite(fact: dict[str, Any]) -> dict[str, Any]:
    return {
        "source_id": fact["source_id"],
        "filename": fact["filename"],
        "locator": fact["locator"],
        "tax_year": fact["tax_year"],
        "as_of": fact["as_of"],
        "verified_against_publisher": False,
    }


def _neighborhood_sentinel(value: Any) -> bool:
    if _blank(value):
        return True
    if _is_number(value) and value == 0:
        return True
    return isinstance(value, str) and value.strip() in _SENTINEL_CODES


def harris_readiness(raw: Any) -> dict[str, Any]:
    """Diagnose one caller-supplied card for calc.tx_unequal_appraisal's subject fields."""
    out = _shell()
    issues: list[dict[str, str]] = []
    if not isinstance(raw, dict):
        _issue(issues, "invalid", "input", "input", "input must be an object of caller-supplied fields.")
        out["issues"] = _sort_issues(issues)
        return out
    _note_owners(raw, issues)
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
            _issue(issues, "refused", "unsupported", "requested",
                   "This diagnostic only checks cited Harris subject fields for calc.tx_unequal_appraisal. It does not evaluate that input, and unknown is not zero.")

    evaluation = _parse_iso(raw.get("evaluation_date"))
    if evaluation is None:
        _issue(issues, "invalid", "evaluation_date", "evaluation_date",
               "evaluation_date must be a real calendar date YYYY-MM-DD. The diagnostic does not substitute today's date.")
        out["issues"] = _sort_issues(issues)
        return out
    out["evaluation_date"] = raw["evaluation_date"]

    fips = raw.get("county_fips")
    if isinstance(fips, str) and _FIPS.fullmatch(fips):
        out["county_fips"] = fips
    if out["county_fips"] != HARRIS_FIPS:
        out["jurisdiction_status"] = "not_harris"
        _issue(issues, "mismatched", "jurisdiction", "county_fips",
               "This diagnostic is only for Harris County, Texas (FIPS 201). It does not assess other counties and does not acquire their data.")
        out["issues"] = _sort_issues(issues)
        return out
    out["jurisdiction_status"] = "harris"

    tax_year = raw.get("tax_year")
    if not _is_int(tax_year) or not (TAX_YEAR_MIN <= tax_year <= TAX_YEAR_MAX):
        _issue(issues, "invalid", "tax_year", "tax_year",
               "tax_year must be an integer from 1982 through 2100, the range calc.tx_unequal_appraisal accepts.")
        out["issues"] = _sort_issues(issues)
        return out
    out["tax_year"] = tax_year

    prefer = raw.get("prefer", "appraised")
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
        predicate = fact.get("predicate")
        if not isinstance(predicate, str) or not _SAFE_NAME.fullmatch(predicate):
            _issue(issues, "refused", "unsupported", "fact",
                   "This diagnostic only checks cited Harris subject fields for calc.tx_unequal_appraisal. It does not evaluate that input, and unknown is not zero.")
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
        problem = _screen_fact(fact, predicate, tax_year, evaluation, _pair_for(predicate))
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
                _issue(issues, "invalid", "wrong_type", predicate,
                       f"{predicate} must be an integer. Text and booleans are not coerced into a value.")
                return None
            if value != tax_year:
                _issue(issues, "mismatched", "tax_year", predicate,
                       f"{predicate} tax_year does not match the requested tax year. A different year's value is not mixed in.")
                return None
        elif predicate == "parcel.situs_address":
            if not isinstance(value, str) or value.strip() == "":
                _issue(issues, "invalid", "wrong_type", predicate, "parcel.situs_address must be text.")
                return None
        elif predicate == "parcel.neighborhood_code":
            if not isinstance(value, str) or value.strip() == "":
                _issue(issues, "invalid", "wrong_type", predicate, "parcel.neighborhood_code must be text.")
                return None
        elif predicate == "parcel.building_class":
            if not isinstance(value, str) or value.strip() == "":
                _issue(issues, "invalid", "blank", predicate, "parcel.building_class is blank. Blank is not a class.")
                return None
        return fact

    for predicate in (
        "parcel.tax_year", "parcel.appraised_value", "parcel.market_value",
        "parcel.improvement_area_sf", "parcel.land_area_sf", "parcel.situs_address",
        "parcel.neighborhood_code", "parcel.building_class",
    ):
        got = take(predicate)
        if got is not None:
            accepted[predicate] = got

    if "parcel.tax_year" not in grouped:
        _issue(issues, "missing", "tax_year", "subject.tax_year",
               "parcel.tax_year is absent, so subject.tax_year is not filled. The requested tax year is not copied in as a fact.")
    if "parcel.improvement_area_sf" not in grouped:
        _issue(issues, "missing", "area", "subject.improvement_area_sf",
               "parcel.improvement_area_sf is absent. normalize_by improvement_area_sf is blocked. Land area is not copied into it.")
    if "parcel.land_area_sf" not in grouped:
        _issue(issues, "missing", "area", "subject.land_area_sf",
               "parcel.land_area_sf is absent. normalize_by land_area_sf is blocked. Improvement area is not copied into it.")

    def side(predicate: str, present: bool) -> dict[str, Any]:
        if predicate not in grouped:
            return _empty_side()
        if not present:
            return {"status": "not_filled", "value": None, "unit": None}
        return {"status": "usable", "value": accepted[predicate]["value"], "unit": "USD"}

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
        _issue(issues, "missing", "value", "subject.value",
               "subject.value is not filled. No appraised value was usable, and market value was not relabeled as appraised.")
    else:
        fact = accepted["parcel.market_value" if selected_basis == "market" else "parcel.appraised_value"]
        because = "caller_selected_market" if selected_basis == "market" else "statutory_comparison_uses_appraised"
        out["selected_value"] = {
            "field": "subject.value",
            "basis": selected_basis,
            "value": fact["value"],
            "unit": "USD",
            "selected_because": because,
        }

    filled: list[dict[str, Any]] = [{
        "field": "subject.county_fips",
        "value": HARRIS_FIPS,
        "unit": None,
        "definition": "Caller county_fips matched 201 (Harris County, Texas), the appraisal district. Not a taxing unit, not a tax rate, and not a parcel fact from the roll.",
        "citation": {"source_id": None, "filename": None, "locator": None, "tax_year": None, "as_of": None, "verified_against_publisher": False},
    }]
    if "parcel.improvement_area_sf" in accepted:
        fact = accepted["parcel.improvement_area_sf"]
        filled.append({"field": "subject.improvement_area_sf", "value": fact["value"], "unit": "sf",
                       "definition": _AREA_DEFINITION["parcel.improvement_area_sf"], "citation": _cite(fact)})
    if "parcel.land_area_sf" in accepted:
        fact = accepted["parcel.land_area_sf"]
        filled.append({"field": "subject.land_area_sf", "value": fact["value"], "unit": "sf",
                       "definition": _AREA_DEFINITION["parcel.land_area_sf"], "citation": _cite(fact)})
    if "parcel.tax_year" in accepted:
        fact = accepted["parcel.tax_year"]
        filled.append({"field": "subject.tax_year", "value": fact["value"], "unit": "year",
                       "definition": "Tax year of the roll values (HCAD yr as parcel.tax_year). Not the snapshot as-of date.",
                       "citation": _cite(fact)})
    if selected_basis is not None:
        fact = accepted["parcel.market_value" if selected_basis == "market" else "parcel.appraised_value"]
        filled.append({"field": "subject.value", "value": fact["value"], "unit": "USD",
                       "basis": selected_basis, "definition": _VALUE_DEFINITION[selected_basis], "citation": _cite(fact)})
    out["filled"] = sorted(filled, key=lambda item: item["field"])

    supported = ["none"] if selected_basis is not None else []
    if selected_basis is not None and "parcel.improvement_area_sf" in accepted:
        supported.append("improvement_area_sf")
    if selected_basis is not None and "parcel.land_area_sf" in accepted:
        supported.append("land_area_sf")
    out["normalize_by_supported"] = supported

    situs = accepted.get("parcel.situs_address")
    if situs is not None and _HOUSTON_CITY.search(situs["value"]):
        _issue(issues, "limitation", "houston_zoning", "zoning",
               "Situs city is Houston. The City of Houston does not use a conventional zoning ordinance. "
               "That is not a fact that this parcel is unzoned, and it does not describe other municipalities "
               "in Harris County. This diagnostic does not assign a zoning district.")
    if "parcel.neighborhood_code" in accepted:
        _issue(issues, "limitation", "neighborhood_not_subject", "parcel.neighborhood_code",
               "A neighborhood code is not an unequal-appraisal subject field and was not checked against HCAD's neighborhood list.")
    if "parcel.building_class" in accepted:
        _issue(issues, "limitation", "building_class_not_area", "parcel.building_class",
               "Building class is not an unequal-appraisal subject field and is not an area.")
    out["issues"] = _sort_issues(issues)
    return out


def _source_block(row: dict[str, Any] | None) -> dict[str, Any] | None:
    if row is None:
        return None
    return {
        "source_id": row["source_id"],
        "as_of": row["as_of"],
        "audit_file": AUDIT_FILE,
        "license_reviewed": row["license_reviewed"],
        "redistribution": row["redistribution"],
    }


def _attestation_matches(row: dict[str, Any], attestation: Any) -> bool:
    if not isinstance(attestation, dict):
        return False
    if attestation.get("source_id") != row["source_id"] or attestation.get("as_of") != row["as_of"]:
        return False
    if attestation.get("queryable") is not False:
        return False
    fields = attestation.get("fields")
    if not isinstance(fields, dict) or set(fields) != set(row["fields"]):
        return False
    for name, expected in row["fields"].items():
        got = fields.get(name)
        if not isinstance(got, dict):
            return False
        if set(got) != {"present", "missing"}:
            return False
        if not _is_int(got.get("present")) or not _is_int(got.get("missing")):
            return False
        if got["present"] != expected["present"] or got["missing"] != expected["missing"]:
            return False
    return True


def county_evidence_gate(raw: Any) -> dict[str, Any]:
    """Evidence gate for the same subject-field diagnostic. Does not download a county."""
    fips = raw.get("county_fips") if isinstance(raw, dict) else None
    if not isinstance(fips, str) or not _FIPS.fullmatch(fips):
        fips_out = None
    else:
        fips_out = fips
    row = _PUBLISHED.get(fips_out) if fips_out else None
    blockers = list(row["blockers"]) if row else [
        "No bundled field audit for this county. This diagnostic does not download rolls and does not treat a parcel count as readiness."
    ]
    status = row["status"] if row else "not_ready"
    attestation_state = "not_supplied"
    if isinstance(raw, dict) and "attestation" in raw:
        if row is not None and _attestation_matches(row, raw.get("attestation")):
            attestation_state = "matches_published_audit"
            blockers = [*blockers, _ATTEST_OK]
        else:
            attestation_state = "does_not_match_published_audit"
            status = "not_ready"
            blockers = [_ATTEST_BAD, *blockers]
    return {
        "diagnostic": "county_evidence_gate",
        "calculator": CALCULATOR,
        "county_fips": fips_out,
        "status": status,
        "not_county_complete": True,
        "queryable": False,
        "verified_against_publisher": False,
        "figures_remeasured": False,
        "source": _source_block(row),
        "published_fields": None if row is None else {k: dict(v) for k, v in row["fields"].items()},
        "ignored_for_status": ["audit_violations", "parcel_count"],
        "attestation": attestation_state,
        "blockers": blockers,
    }
