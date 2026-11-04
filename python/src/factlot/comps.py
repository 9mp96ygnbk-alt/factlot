"""lease_comp_validate: check a shared lease comparable and derive its net effective rent.

A comp is a ``lease.comp`` fact whose value is a ``LeaseComp`` (packages/schema/src/index.ts, published in
spec/schemas/fact.json). The check reuses fact_validate for the fact itself, adds the comp's own rules (shape,
term, concessions within the term, no contact details), and computes the net effective rent with
calc.net_effective_rent so every shared comp carries a derived NER with its formula ID. This is the same code as
packages/tools/src/comps.ts; spec/vectors/lease_comps.json pins both, including the issue paths and messages.
"""

from __future__ import annotations

import math
import re
from datetime import date
from typing import Any

from . import docverify
from .calc import net_effective_rent
from .facts import (
    _ISO_DATE,
    _JS_WS,
    _Issues,
    _bad_type,
    _enum,
    _is_number,
    _object,
    _pattern,
    is_iso_date,
)

COMP_TYPES = ("new", "renewal", "extension", "expansion", "sublease", "amendment", "holdover", "other")
PROPERTY_TYPES = ("office", "industrial", "retail", "medical_office", "flex", "mixed_use", "datacenter",
                  "self_storage", "hotel", "multifamily", "land", "other")
TENANT_TYPES = ("government_federal", "government_state_local", "corporate", "professional_services", "medical",
                "retail_national", "retail_local", "nonprofit", "other", "unknown")
EXPENSE_BASES = ("full_service", "modified_gross", "industrial_gross", "base_year", "nnn", "absolute_net", "ground",
                 "not_full_service", "unknown")
CONFIRMING_PARTIES = ("landlord", "tenant", "landlord_broker", "tenant_broker", "both_parties", "public_record",
                      "appraiser", "lender", "other")
VERIFICATIONS = ("unverified", "party_confirmed", "document_verified", "public_record")

_PERSONAL_DATA = (
    re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}"),
    re.compile(r"(?:\+?1[\s.-]?)?\(?[0-9]{3}\)?[\s.-][0-9]{3}[\s.-][0-9]{4}"),
    re.compile(r"\b[0-9]{3}-[0-9]{2}-[0-9]{4}\b"),
)
_SHARE_METHODS = ("reported", "human_verified", "extracted", "public_record")
_DAYS_PER_MONTH = 30.4375
_BUILDING = re.compile(rf"fl:building:[^{_JS_WS}]+")
_STATE = re.compile(r"[A-Z]{2}")


def _n(x: float) -> str:
    return str(int(x)) if float(x).is_integer() else repr(x)


def _number(*, gt: float | None = None, ge: float | None = None, lt: float | None = None, le: float | None = None,
            integer: bool = False):
    """z.number() with the checks zod chains, in zod's order (int, then lower bound, then upper bound)."""
    def check(v: Any, path: str, out: _Issues) -> None:
        if not _is_number(v):
            _bad_type(out, path, "number", v)
            return
        if integer and not float(v).is_integer():
            out.add(path, "Invalid input: expected int, received number", True)
            return
        if gt is not None and v <= gt:
            out.add(path, f"Too small: expected number to be >{_n(gt)}")
        if ge is not None and v < ge:
            out.add(path, f"Too small: expected number to be >={_n(ge)}")
        if lt is not None and v >= lt:
            out.add(path, f"Too big: expected number to be <{_n(lt)}")
        if le is not None and v > le:
            out.add(path, f"Too big: expected number to be <={_n(le)}")
    return check


def _max_string(n: int):
    def check(v: Any, path: str, out: _Issues) -> None:
        if not isinstance(v, str):
            _bad_type(out, path, "string", v)
        elif len(v) > n:
            out.add(path, f"Too big: expected string to have <={n} characters")
    return check


_DATE = _pattern(_ISO_DATE, "Invalid ISO date")
_ESCALATION = [
    ("type", _enum(("none", "percent", "fixed_psf")), True),
    ("rate", _number(gt=-1, lt=10), False),
    ("amount", _number(), False),
    ("every_months", _number(gt=0, integer=True), False),
]
_RENEWAL = [("count", _number(ge=0, integer=True), True), ("term_months", _number(gt=0, integer=True), False)]
_FIELDS = [
    ("comp_type", _enum(COMP_TYPES), True),
    ("property_type", _enum(PROPERTY_TYPES), False),
    ("tenant_type", _enum(TENANT_TYPES), False),
    ("area_sf", _number(gt=0), True),
    ("area_basis", _enum(("rentable", "usable", "gross", "unknown")), False),
    ("commencement_date", _DATE, True),
    ("expiration_date", _DATE, False),
    ("term_months", _number(gt=0, le=1200, integer=True), False),
    ("early_termination_date", _DATE, False),
    ("starting_rent_psf_yr", _number(ge=0), False),
    ("current_rent_psf_yr", _number(ge=0), False),
    ("escalation", lambda v, p, o: _object(v, p, o, _ESCALATION), False),
    ("free_rent_months", _number(ge=0, integer=True), False),
    ("free_rent_applies_to", _enum(("base_rent", "gross_rent")), False),
    ("ti_allowance_psf", _number(ge=0), False),
    ("leasing_commissions_usd", _number(ge=0), False),
    ("other_concessions_usd", _number(ge=0), False),
    ("expense_basis", _enum(EXPENSE_BASES), False),
    ("opex_psf_yr", _number(ge=0), False),
    ("renewal_options", lambda v, p, o: _object(v, p, o, _RENEWAL), False),
    ("building", _pattern(_BUILDING, "expected a FactLot building URN"), False),
    ("submarket", _max_string(120), False),
    ("state", _pattern(_STATE, "expected a two-letter state code"), False),
    ("confirming_party", _enum(CONFIRMING_PARTIES), True),
    ("verification", _enum(VERIFICATIONS), True),
    ("notes", _max_string(1000), False),
]


def _day(iso: Any) -> int | None:
    if not is_iso_date(iso):
        return None
    try:
        return date.fromisoformat(iso).toordinal()
    except ValueError:
        return None


def implied_term_months(commencement: str, expiration: str) -> int:
    """Months from commencement through expiration (both days inclusive), rounded half up."""
    return math.floor((_day(expiration) - _day(commencement) + 1) / _DAYS_PER_MONTH + 0.5)  # type: ignore[operator]


def _num(v: Any) -> bool:
    return _is_number(v)


def lease_comp_value_issues(value: Any) -> list[dict[str, str]]:
    """Issues in a ``LeaseComp`` value: its shape, then the rules that need two fields (paths relative to the value)."""
    out = _Issues()
    _object(value, "", out, _FIELDS)
    issues = [{"path": p, "message": m} for p, m, _ in out.items]
    if not isinstance(value, dict):
        return issues
    v = value

    def add(path: str, message: str) -> None:
        issues.append({"path": path, "message": message})

    commencement = v.get("commencement_date") if _day(v.get("commencement_date")) is not None else None
    expiration = v.get("expiration_date") if _day(v.get("expiration_date")) is not None else None
    term_given = v.get("term_months") if _num(v.get("term_months")) else None
    if "starting_rent_psf_yr" not in v and "current_rent_psf_yr" not in v:
        add("starting_rent_psf_yr", "give starting_rent_psf_yr (the deal's first-year base rent) or "
                                    "current_rent_psf_yr (an observed rent)")
    if "term_months" not in v and "expiration_date" not in v:
        add("term_months", "give term_months or expiration_date")
    term = term_given
    if commencement and expiration:
        if _day(expiration) <= _day(commencement):  # type: ignore[operator]
            add("expiration_date", "expiration_date is not after commencement_date")
        else:
            implied = implied_term_months(commencement, expiration)
            if term_given is not None:
                exact = (_day(expiration) - _day(commencement) + 1) / _DAYS_PER_MONTH  # type: ignore[operator]
                if abs(term_given - exact) > 1.5:
                    add("term_months", f"term_months {_n(term_given)} does not match commencement_date to "
                                       f"expiration_date (about {implied} months)")
            else:
                term = implied
    early = v.get("early_termination_date") if _day(v.get("early_termination_date")) is not None else None
    if early and commencement and _day(early) < _day(commencement):  # type: ignore[operator]
        add("early_termination_date", "early_termination_date is before commencement_date")
    if early and expiration and _day(early) > _day(expiration):  # type: ignore[operator]
        add("early_termination_date", "early_termination_date is after expiration_date")
    esc = v.get("escalation") if isinstance(v.get("escalation"), dict) else None
    if esc is not None and esc.get("type") == "percent" and not _num(esc.get("rate")):
        add("escalation.rate", "an escalation of type percent needs rate (0.03 for 3%)")
    if esc is not None and esc.get("type") == "fixed_psf" and not _num(esc.get("amount")):
        add("escalation.amount", "an escalation of type fixed_psf needs amount (USD per SF per year)")
    free = v.get("free_rent_months") if _num(v.get("free_rent_months")) else None
    if free is not None and term is not None and free > term:
        add("free_rent_months", "free_rent_months is longer than the term")
    for key in ("notes", "submarket"):
        text = v.get(key)
        if isinstance(text, str) and any(r.search(text) for r in _PERSONAL_DATA):
            add(key, "looks like an email address, phone number or ID number; a comp carries no personal data")
    return issues


def _ner_schedule(v: dict[str, Any], term: int) -> dict[str, Any]:
    esc = v.get("escalation") if isinstance(v.get("escalation"), dict) else {"type": "none"}
    if esc["type"] == "percent":
        escalation = {"type": "percent", "rate": esc["rate"], "every_months": esc.get("every_months", 12)}
    elif esc["type"] == "fixed_psf":
        escalation = {"type": "fixed_psf", "amount": esc["amount"], "every_months": esc.get("every_months", 12)}
    else:
        escalation = {"type": "none"}
    free = min(v["free_rent_months"], term) if _num(v.get("free_rent_months")) else 0
    return {
        "commencement_date": v["commencement_date"],
        "term_months": term,
        "area_sf": v["area_sf"],
        "starting_rent_psf_annual": v["starting_rent_psf_yr"],
        "escalation": escalation,
        "abated_months": list(range(1, int(free) + 1)),
    }


def validate_lease_comp(args: dict[str, Any], producer: dict[str, str]) -> dict[str, Any]:
    fact = args["fact"]
    profile = args.get("profile", "share")
    discount = args.get("discount_rate_annual", 0.08)
    issues: list[dict[str, str]] = list(docverify.validate_fact_full(fact)["issues"])
    warnings: list[str] = []
    if fact.get("predicate") != "lease.comp":
        issues.append({"path": "predicate", "message": 'expected "lease.comp"'})
    subject = fact.get("subject")
    if not isinstance(subject, str) or not subject.startswith("fl:lease:"):
        issues.append({"path": "subject", "message": "a lease comp is about a lease: expected an fl:lease: URN"})
    value = fact.get("value")
    for i in lease_comp_value_issues(value):
        issues.append({"path": f"value.{i['path']}" if i["path"] else "value", "message": i["message"]})
    v: dict[str, Any] = value if isinstance(value, dict) else {}
    rights = fact.get("rights") if isinstance(fact.get("rights"), dict) else None
    prov = fact.get("provenance") if isinstance(fact.get("provenance"), dict) else None

    if profile == "share" and isinstance(value, dict):
        need = (
            ("starting_rent_psf_yr", "a shared comp states the deal's starting rent (current_rent_psf_yr alone is "
                                     "an observed rent)"),
            ("escalation", "state the escalations (type none if the rent is flat)"),
            ("free_rent_months", "state the free rent (0 if none)"),
            ("ti_allowance_psf", "state the tenant improvement allowance (0 if none)"),
            ("property_type", "state the property type"),
        )
        for key, message in need:
            if key not in v:
                issues.append({"path": f"value.{key}", "message": message})
        if "expense_basis" not in v or v["expense_basis"] == "unknown":
            issues.append({"path": "value.expense_basis",
                           "message": "state the expense basis (full_service, nnn, ...): rent means little without it"})
        if rights is None:
            issues.append({"path": "rights", "message": "a shared comp states its rights: ai_use and redistribution "
                                                        "(permitted, attribution_required, prohibited or unknown)"})
        if prov is not None and isinstance(prov.get("method"), str) and prov["method"] not in _SHARE_METHODS:
            issues.append({"path": "provenance.method",
                           "message": f"a comp is {', '.join(_SHARE_METHODS)}; {prov['method']} facts are not shared as comps"})
        if v.get("verification") == "document_verified":
            sources = prov["sources"] if prov is not None and isinstance(prov.get("sources"), list) else []
            hashed = any(isinstance(s, dict) and (isinstance(s.get("sha256"), str) or (
                isinstance(s.get("document_id"), str) and s["document_id"].startswith("fl:document:sha256-")))
                for s in sources)
            if not hashed:
                issues.append({"path": "provenance.sources",
                               "message": "verification document_verified needs a source with the document's sha256 "
                                          "(or an fl:document:sha256- document_id)"})
    if rights is not None and (rights.get("ai_use") == "unknown" or rights.get("redistribution") == "unknown"):
        warnings.append("rights say unknown for ai_use or redistribution: other firms cannot tell what they may do "
                        "with this comp, and a cautious reader will treat unknown as prohibited")
    rent = v.get("starting_rent_psf_yr")
    if _num(rent) and (rent > 500 or (0 < rent < 1)):
        warnings.append(f"starting_rent_psf_yr {_n(rent)} is outside the usual 1 to 500 USD per SF per year: "
                        "check it is annual, not monthly")
    if _num(v.get("free_rent_months")) and _num(v.get("term_months")) and v["free_rent_months"] == v["term_months"]:
        warnings.append("free_rent_months equals term_months: no base rent is ever payable, so the NER is negative")
    if _num(v.get("area_sf")) and v["area_sf"] > 5_000_000:
        warnings.append(f"area_sf {_n(v['area_sf'])} is above 5,000,000: check the unit")

    valid = not issues
    ner = None
    reason = None
    if valid and "starting_rent_psf_yr" not in v:
        reason = ("no starting_rent_psf_yr: net effective rent needs the deal's starting rent, and an observed "
                  "current rent is not one")
    elif valid:
        term = int(v["term_months"]) if _num(v.get("term_months")) else implied_term_months(
            v["commencement_date"], v["expiration_date"])
        result = net_effective_rent({
            "schedule": _ner_schedule(v, term),
            "ti_allowance_psf": v.get("ti_allowance_psf", 0),
            "leasing_commissions": v.get("leasing_commissions_usd", 0),
            "other_concessions": v.get("other_concessions_usd", 0),
            "discount_rate_annual": discount,
        })
        formula = f"{result['formula']['id']}@{result['formula']['version']}"
        warnings.extend(result["warnings"])
        if v.get("free_rent_applies_to") == "gross_rent":
            warnings.append("free rent applies to gross rent, but the NER abates base rent only: the NER is higher "
                            "than the tenant's true saving")
        provenance: dict[str, Any] = {"method": "computed", "sources": [], "formula": formula, "producer": producer}
        if isinstance(fact.get("id"), str):
            provenance["inputs"] = [fact["id"]]
        ner_fact: dict[str, Any] = {
            "subject": fact["subject"],
            "predicate": "lease.net_effective_rent",
            "value": {
                "net_effective_rent_psf": result["value"]["net_effective_rent_psf"],
                "discounted_net_effective_rent_psf": result["value"]["discounted_net_effective_rent_psf"],
                "effective_rent_psf": result["value"]["effective_rent_psf"],
                "discount_rate_annual": discount,
                "term_months": term,
                "expense_basis": v.get("expense_basis", "unknown"),
            },
            "unit": "USD/sf/yr",
            "as_of": fact["as_of"],
            "provenance": provenance,
        }
        if rights is not None:
            ner_fact["rights"] = rights
        ner = {"formula": formula, "fact": ner_fact}
    out: dict[str, Any] = {"valid": valid, "profile": profile, "issues": issues, "warnings": warnings, "ner": ner}
    if reason:
        out["ner_reason"] = reason
    return out
